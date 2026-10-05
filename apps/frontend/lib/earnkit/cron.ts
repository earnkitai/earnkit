import { INDEX_FAILED_RUNS, runBonusLedger, type BonusDeps } from './bonus-ledger';
import { advanceRounds } from './bonus-payout';
import { sql } from './db';
import { FINAL_GRACE_MS, REVIEW_MS, type CampaignConfig, type EarnKitCampaign } from './campaigns';
import { scoreCampaignEntries, type ScoreDeps, type ScoreRow } from './campaign-score';
import { FEE_TTL_MS, launchedCreatorWallets, refreshFees } from './fees';
import { bearerMatches, json } from './http';
import {
  NOT_MAINNET,
  NO_PAYOUT_KEY,
  PAY_FAILED,
  PAY_FAILED_RUNS,
  STEP_FAILED,
  TERMS_CHANGED,
  fromTerms,
  needsOwner,
  payCampaign,
  sameTerms,
  termsOf,
  type FrozenTerms,
  type PayDeps,
} from './payout';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { withScoringLock } from './sponsor';
import { recheckSubmissionProofs } from './submission-proof';
import { scoreOpenRounds, type TractionDeps } from './traction';
import type { Candidate, RunState } from './winners';

/** Work per cron call; the hourly run picks up the rest. */
export const CRON_BUDGET_MS = 4 * 60_000;

/** How old a running score may get: 20 h, or 1 h in the campaign's last day (v2.4 §3 Scheduler). Pure. */
export const scoreMaxAge = (endsAt: Date, now: Date) =>
  endsAt.getTime() - now.getTime() <= 86_400_000 ? 3_600_000 : 20 * 3_600_000;

export type Step = 'score' | 'freeze' | 'review' | 'wait' | 'pay' | 'done';

/** What the cron does for one EarnKit campaign now (v2.4 §3): its state machine. Pure; exported for tests. */
export function nextStep(a: { state: RunState; now: Date; endsAt: Date; reviewUntil: Date | null; allFinal: boolean }): Step {
  if (a.state === 'paid') return 'done';
  if (a.state === 'paying') return 'pay';
  if (a.state === 'review') return a.reviewUntil && a.now >= a.reviewUntil ? 'pay' : 'wait';
  if (a.now.getTime() < a.endsAt.getTime() + FINAL_GRACE_MS) return 'score';
  return a.allFinal ? 'review' : 'freeze';
}

type Program = {
  id: string;
  starts_at: Date;
  ends_at: Date;
  campaign: CampaignConfig;
  state: RunState | null;
  review_until: Date | null;
};
type Entry = ScoreRow &
  Candidate & { prize_raw_tx: string | null; score_partial: boolean; payout_reverts: number; payout_stale_at: Date | null };

// score_attempted_at drives scoring rotation (a slow entry goes last next pass); score_partial is
// flagged in the review (a final score whose reads were capped stays payable).
const entriesOf = (programId: string) => sql()<Entry[]>`
  SELECT id, contracts, payout_wallet, deployers, score, scored_at, scored_through, score_final,
    score_attempted_at, score_partial, submitted_at, installation_id, vetoed_at, payout_status,
    prize_tx, prize_raw_tx, payout_reverts, payout_stale_at
  FROM projects
  WHERE program_id = ${programId} AND payout_wallet IS NOT NULL AND contracts IS NOT NULL
  ORDER BY id`;

/** Injection for the e2e (scoring reads, payout chain and wallet, the fee source). */
export type CronDeps = {
  score?: ScoreDeps;
  pay?: PayDeps;
  refreshFees?: (wallets: string[]) => Promise<number>;
  /** The builder bonus ledger's chain, wallet and contracts (v2.5). */
  bonus?: BonusDeps;
  /** The daily submission-proof re-check's fetch (v2.5 §3, Ruling 11). */
  proofRecheck?: { fetchText?: (url: string) => Promise<string> };
  /** The builder bonus traction scoring's reads (v2.5 §3; `only`: these round keys). */
  traction?: TractionDeps & Pick<NonNullable<Parameters<typeof scoreOpenRounds>[0]>, 'only' | 'score'>;
  /** The builder bonus payout's sanctions screen (default: the v2.4 screen); `only`: these round keys. */
  rounds?: { listed?: (wallet: string) => Promise<boolean>; only?: string[] };
};

/** Opens the 48 h review (once: only from 'running') and freezes the payout terms with it. */
const openReview = (p: Program, now: Date) => sql()`
  UPDATE campaign_runs SET state = 'review', frozen_at = ${now},
    review_until = ${new Date(now.getTime() + REVIEW_MS)},
    terms = ${sql().json(termsOf(p.campaign as EarnKitCampaign))}, updated_at = now()
  WHERE program_id = ${p.id} AND state = 'running'`;

export { PAY_FAILED, PAY_FAILED_RUNS, STEP_FAILED, TERMS_CHANGED };
/**
 * needs_owner when the bonus ledger can't run (the payout key missing or malformed, or off Base
 * mainnet) while the builder bonus can earn (bonusLive).
 */
export const BONUS_WALLET_UNSET = 'bonus-rounds: payout wallet not configured';

/**
 * Whether the builder bonus can earn money now (Ruling 20): an active program with a builder bonus
 * (submission_proof), an EarnKit coin (coin_address), or an ended round not paid or empty.
 */
export async function bonusLive(now: Date) {
  const [r] = await sql()<{ live: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM programs WHERE status = 'active' AND submission_proof IS NOT NULL)
      OR EXISTS (SELECT 1 FROM projects WHERE coin_address IS NOT NULL)
      OR EXISTS (SELECT 1 FROM bonus_rounds WHERE state NOT IN ('paid', 'empty') AND ends_at <= ${now}) AS live`;
  return r.live;
}
/** A pay step that threw, with how many have failed in a row (campaign_runs.pay_failures). */
class PayStepFailed extends Error {
  readonly failures: number;
  constructor(failures: number, cause: unknown) {
    super('pay step failed', { cause });
    this.failures = failures;
  }
}

/** Final scores whose reads were capped or never finished (score_partial): payable, flagged in the review. */
const partialIds = (entries: Entry[]) => entries.filter((e) => e.score_final && e.score_partial).map((e) => e.id);

/**
 * One campaign, one step. After a freeze pass that leaves every entry final, the review opens in
 * the same call. The entries are read again after the review closes, so a last-minute veto counts.
 */
async function advance(p: Program, now: Date, deadline: number, deps: CronDeps) {
  await sql()`INSERT INTO campaign_runs (program_id) VALUES (${p.id}) ON CONFLICT DO NOTHING`;
  const entries = await entriesOf(p.id);
  const step = nextStep({
    state: p.state ?? 'running',
    now,
    endsAt: p.ends_at,
    reviewUntil: p.review_until,
    allFinal: entries.every((e) => e.score_final),
  });
  if (step === 'score') {
    const out = await scoreCampaignEntries(p, entries, { now, deadline, final: false, maxAgeMs: scoreMaxAge(p.ends_at, now) }, deps.score);
    return { step, scored: out.filter((o) => o.result === 'scored').length, failed: out.filter((o) => o.result === 'failed').length };
  }
  if (step === 'freeze') {
    // Ruling 35: one unfinished entry at a time with the whole budget, rotating by last attempt;
    // after 3 failed final attempts an entry is frozen with its last score, flagged partial.
    const out = await scoreCampaignEntries(p, entries, { now, deadline, final: true, maxAgeMs: 0 }, deps.score);
    const frozen = await entriesOf(p.id);
    const review = frozen.every((e) => e.score_final);
    if (review) await openReview(p, now);
    return {
      step,
      final: out.filter((o) => o.result === 'final').length,
      failed: out.filter((o) => o.result === 'failed').length,
      gave_up: out.filter((o) => o.result === 'gave_up').map((o) => o.id),
      review,
      partial: partialIds(frozen),
    };
  }
  if (step === 'review') {
    await openReview(p, now);
    return { step, partial: partialIds(entries) };
  }
  if (step === 'pay') {
    // Terms frozen when the review opened; a run opened before they were stored freezes them now.
    const [run] = await sql()<{ terms: FrozenTerms }[]>`
      UPDATE campaign_runs SET state = 'paying', updated_at = now(),
        terms = COALESCE(terms, ${sql().json(termsOf(p.campaign as EarnKitCampaign))})
      WHERE program_id = ${p.id} AND state IN ('review', 'paying')
      RETURNING terms`;
    if (!run) return { step };
    // A step that completes (whatever its note) resets the failure count.
    const setNote = (note: string | null, done = false) => sql()`
      UPDATE campaign_runs SET state = ${done ? 'paid' : 'paying'}, note = ${note}, pay_failures = 0, updated_at = now()
      WHERE program_id = ${p.id}`;
    const changed = !sameTerms(run.terms, termsOf(p.campaign as EarnKitCampaign));
    let r: { done: boolean; note: string | null };
    try {
      const fresh = (await entriesOf(p.id)).filter((e) => e.score_final || e.prize_tx);
      // Changed terms: transfers already in flight (signed under the frozen terms) are still
      // followed to paid or failed; nothing new is signed.
      r = await payCampaign(fromTerms(run.terms), fresh, { deadline, now, ...deps.pay, followOnly: changed });
      if (changed) r = { done: false, note: TERMS_CHANGED };
    } catch (err) {
      const [row] = await sql()<{ pay_failures: number }[]>`
        UPDATE campaign_runs SET note = ${PAY_FAILED}, pay_failures = pay_failures + 1, updated_at = now()
        WHERE program_id = ${p.id} RETURNING pay_failures`.catch(() => []);
      throw new PayStepFailed(row?.pay_failures ?? 0, err);
    }
    await setNote(r.note, r.done);
    return { step, done: r.done, note: r.note };
  }
  return { step };
}

/** Fee wallets refreshed per read (one WETH price read each). */
const FEE_BATCH = 10;

/**
 * Refreshes the token fees of creator wallets not read within FEE_TTL_MS (or never), in batches,
 * until `deadline` (Ruling 5: the 6 h cache holds; the hourly cron only fills in what is stale).
 * Returns how many were read.
 */
async function refreshStaleFees(now: Date, deadline: number, refresh: (wallets: string[]) => Promise<number>) {
  if (Date.now() >= deadline) return 0;
  const wallets = await launchedCreatorWallets();
  if (wallets.length === 0) return 0;
  const fresh = await sql()<{ wallet: string }[]>`
    SELECT wallet FROM token_fees
    WHERE wallet IN ${sql()(wallets)} AND read_at > ${new Date(now.getTime() - FEE_TTL_MS)}`;
  const skip = new Set(fresh.map((r) => r.wallet));
  const stale = wallets.filter((w) => !skip.has(w));
  let read = 0;
  for (let i = 0; i < stale.length && Date.now() < deadline; i += FEE_BATCH)
    read += await refresh(stale.slice(i, i + FEE_BATCH));
  return read;
}

/**
 * The daily jobs (v2.4 §3, §4), idempotent: for every active EarnKit campaign not yet paid out
 * (and one closed after it ended or after its review opened), one lifecycle step under the campaign's lease (a second concurrent call gets 'busy');
 * one campaign's failure never stops the others; then the token-fee refresh for creator wallets
 * whose cached fees are over 6 h old; between them, the builder bonus: traction scoring
 * (traction.ts scoreOpenRounds), then the ledger (bonus-ledger.ts) with the rounds' freeze,
 * review and WETH payouts (bonus-payout.ts).
 * `needs_owner` lists the campaigns whose payout waits on the
 * owner (cronPost answers 503 for them). `now` is injectable for the e2e (production: the real
 * time); `only` limits the run to these program ids (tests and the e2e).
 */
export async function runCron(
  opts: { now?: Date; budgetMs?: number; deps?: CronDeps; only?: string[] } = {},
) {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? CRON_BUDGET_MS);
  const deps = opts.deps ?? {};
  const programs = await sql()<Program[]>`
    SELECT p.id, p.starts_at, p.ends_at, p.campaign, r.state, r.review_until
    FROM programs p LEFT JOIN campaign_runs r ON r.program_id = p.id
    WHERE p.campaign->>'kind' = 'earnkit' AND p.starts_at IS NOT NULL AND p.ends_at IS NOT NULL
      AND COALESCE(r.state, 'running') <> 'paid'
      -- M6: a closed campaign is still frozen and paid out once it has ended (its run row exists
      -- only if it was ever active), or once its review opened. Never launched: no row, skipped.
      AND (p.status = 'active' OR r.state IN ('review', 'paying') OR (r.state = 'running' AND p.ends_at <= ${now}))
      ${opts.only ? sql()`AND p.id IN ${sql()(opts.only)}` : sql()``}
    ORDER BY p.ends_at`;
  const campaigns: Record<string, unknown>[] = [];
  for (const p of programs) {
    try {
      const r = await withScoringLock(p.id, () => advance(p, now, deadline, deps), (opts.budgetMs ?? CRON_BUDGET_MS) + 60_000);
      campaigns.push({ id: p.id, ...(r === 'busy' ? { step: 'busy' } : r) });
    } catch (err) {
      console.error('[cron]', p.id, err instanceof PayStepFailed ? err.cause : err);
      campaigns.push({
        id: p.id,
        step: 'error',
        note: STEP_FAILED,
        ...(err instanceof PayStepFailed && { pay_failures: err.failures }),
      });
    }
  }
  // v2.5 builder bonus traction (Task 7 carry): every run scores the open rounds (each entry is
  // read at most once a day; after a round's end, its final reads), with at most half the budget
  // left so the ledger and payouts below always get time. Under its own lease.
  let bonusScoring: unknown;
  const scoringStalled: string[] = [];
  if (!opts.only || deps.traction) {
    try {
      const half = Math.min(deadline, Date.now() + (deadline - Date.now()) / 2);
      const r = await withScoringLock(
        'bonus-scoring',
        () => scoreOpenRounds({ now, deadline: half, ...deps.traction, needsOwner: scoringStalled }),
        (opts.budgetMs ?? CRON_BUDGET_MS) + 60_000,
      );
      bonusScoring = r === 'busy' ? { step: 'busy' } : r;
    } catch (err) {
      console.error('[cron] bonus scoring', err);
      bonusScoring = { step: 'error', note: STEP_FAILED };
    }
  }
  // v2.5 builder bonus ledger: index, collect near a round's end, claim, the rounds (freeze, review,
  // pay: bonus-payout.ts), sweep to the Safe. After the campaigns' scoring and payouts, before the
  // fee refresh. Runs with `only` (tests, the e2e) only when its deps are given.
  let bonus: Record<string, unknown> | undefined;
  if (!opts.only || deps.bonus) {
    try {
      bonus = await runBonusLedger({
        now,
        deadline,
        // The ledger's own state (followOnly, the run's nonce floor) always wins over test deps (M14).
        rounds: (account, d) => advanceRounds(account, { ...deps.rounds, ...d }),
        ...deps.bonus,
      });
    } catch (err) {
      console.error('[cron] bonus', err);
      bonus = { step: 'error', note: STEP_FAILED };
    }
  }
  // v2.5 §3, Ruling 11: the daily re-check of a submission proof that hasn't passed yet, until its
  // program's round ends. Same `only`/deps gating as the bonus ledger step.
  let proofRecheck: { checked: number; passed: number } | undefined;
  if (!opts.only || deps.proofRecheck) {
    try {
      proofRecheck = await recheckSubmissionProofs(now, deadline, deps.proofRecheck);
    } catch (err) {
      console.error('[cron] proof-recheck', err);
    }
  }
  let fees = 0;
  try {
    fees = await refreshStaleFees(now, deadline, deps.refreshFees ?? refreshFees);
  } catch (err) {
    console.error('[cron] fees', err);
  }
  // Campaigns whose payout waits on the owner (manual check, changed terms, a wallet short of the
  // prize or of gas, or PAY_FAILED_RUNS failed pay steps in a row): the endpoint answers 503.
  const needs_owner = campaigns
    .filter((c) => needsOwner(c.note as string | null | undefined) || Number(c.pay_failures ?? 0) >= PAY_FAILED_RUNS)
    .map((c) => c.id as string);
  // A bonus sweep that can't be proven dead or sent waits on the owner, like a stuck payout.
  // So does an index step that failed INDEX_FAILED_RUNS runs in a row (deposits would go unbooked).
  if (
    needsOwner((bonus?.sweep as { result?: string } | undefined)?.result) ||
    Number(bonus?.index_failures ?? 0) >= INDEX_FAILED_RUNS
  )
    needs_owner.push('bonus-ledger');
  // A builder bonus round waiting on the owner: a pay note that does, failed pay steps in a row, or
  // flagged entries in its review (bonus-payout.ts advanceRounds).
  const rounds = bonus?.rounds as { needs_owner?: string[] } | undefined;
  for (const key of rounds?.needs_owner ?? []) needs_owner.push(`bonus:${key}`);
  // Ruling 23: an ended round whose final scoring failed (once per round).
  for (const key of scoringStalled) if (!needs_owner.includes(`bonus:${key}`)) needs_owner.push(`bonus:${key}`);
  // Rulings 19 and 20: the ledger (and so the rounds step) was skipped for want of a usable payout
  // key (missing or malformed) or of Base mainnet while the bonus can earn: an active program with
  // a builder bonus, an EarnKit coin, or an ended unpaid round. Nothing is indexed, claimed or
  // paid until the owner acts, so it waits on the owner. A failed check counts as yes (never silent).
  const skipped = bonus?.skipped;
  if (skipped === NO_PAYOUT_KEY || skipped === NOT_MAINNET) {
    const live = await bonusLive(now).catch((err: unknown) => {
      console.error('[cron] bonus live check', err);
      return true;
    });
    if (live) {
      needs_owner.push(BONUS_WALLET_UNSET);
      bonus!.note = BONUS_WALLET_UNSET;
    }
  }
  return {
    now: now.toISOString(),
    campaigns,
    ...(bonusScoring !== undefined && { bonus_scoring: bonusScoring }),
    ...(bonus && { bonus }),
    ...(proofRecheck && { proof_recheck: proofRecheck }),
    fee_wallets: fees,
    needs_owner,
  };
}

/**
 * POST /api/cron (app/api/cron/route.ts calls it): rate limited per IP, then Bearer CRON_SECRET
 * compared in constant time, then the jobs. 200 normally; 503 (same body) when a campaign's payout
 * waits on the owner (`needs_owner`), so the GitHub Actions run fails and GitHub emails the owner.
 * `deps` for tests.
 */
export async function cronPost(
  request: Request,
  deps: { limit?: (ip: string) => Promise<unknown>; run?: () => Promise<unknown> } = {},
) {
  try {
    await (deps.limit ?? ((ip: string) => enforce('cron', ip, 'Too many cron calls from this address.')))(
      clientIp(request.headers),
    );
  } catch (err) {
    if (err instanceof RateLimitError)
      return json({ error: err.message }, 429, { 'Retry-After': String(err.retryAfter) });
    throw err;
  }
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET))
    return json({ error: 'unauthorized' }, 401);
  try {
    const out = await (deps.run ?? (() => runCron()))();
    const stuck = (out as { needs_owner?: unknown } | null)?.needs_owner;
    // The ledger reports block numbers as bigints; Response.json can't serialize them.
    const plain: unknown = JSON.parse(JSON.stringify(out, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
    return json(plain, Array.isArray(stuck) && stuck.length > 0 ? 503 : 200);
  } catch (err) {
    console.error('[cron]', err);
    return json({ error: 'The cron run failed; see the server log.' }, 500);
  }
}
