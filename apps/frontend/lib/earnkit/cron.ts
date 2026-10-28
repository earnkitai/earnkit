import { INDEX_FAILED_RUNS, NEEDS_GAS, runBonusLedger, type BonusDeps } from './bonus-ledger';
import { sql } from './db';
import { FINAL_GRACE_MS, REVIEW_MS, type CampaignConfig, type EarnKitCampaign } from './campaigns';
import { scoreCampaignEntries, type ScoreDeps, type ScoreRow } from './campaign-score';
import { FEE_TTL_MS, launchedCreatorWallets, refreshFees } from './fees';
import { digestEnabled, sendDigests, type Mailer } from './digest';
import { gasAlerts, ownerGasMail } from './owner-mail';
import { safeWatch, type SafeWatchDeps } from './safe-watch';
import { usageChecks, type UsageDeps } from './events';
import { cleanDeploys, expireSites, sitesInReview } from './hosting';
import { bearerMatches, json } from './http';
import { heldPeople, runScoreSteps, scoreSliceEnd, type ScoreCronDeps } from './builder-score';
import { xHandleConflicts } from './profiles';
import {
  NOT_MAINNET,
  NO_PAYOUT_KEY,
  PAY_FAILED,
  PAY_FAILED_RUNS,
  STEP_FAILED,
  TERMS_CHANGED,
  fromTerms,
  needsOwner,
  payoutAccount,
  payCampaign,
  sameTerms,
  termsOf,
  type FrozenTerms,
  type PayDeps,
} from './payout';
import { r2Enabled, type R2 } from './r2';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { stuckLaunches } from './tokens';
import { stuckBuilderTokens } from './builder-token';
import { sweepVerifyNonces } from './github-verify';
import { DEPLOY_CAPS, deployChains, deployEnabled, deployerAddress, nativeUsd, viemDeployChain, weiToMicroUsd, type DeployDeps } from './deploy';
import { githubAppEnabled } from './github-app';
import { runBuilderCodes } from './builder-codes-check';
import { backfillContractOrigins } from './contract-origins';
import { runUsedBy } from './used-by';
import type { AlchemyCall } from './alchemy';
import { peopleSignals } from './people-signals';
import type { ContractOrigin } from './source-readers';
import { sweepPublicReads } from './repo-cache';
import { sweepRateWindows } from './rate-limit';
import { withScoringLock } from './scoring-lock';
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
  /** v2.13: the ledger itself (tests record what the cron hands it; default bonus-ledger.ts runBonusLedger). */
  ledger?: (deps: BonusDeps) => Promise<Record<string, unknown>>;
  /** v2.8.1 §A1: the projects whose launch claim is older than 10 minutes (default tokens.ts stuckLaunches). */
  stuckLaunches?: (now: Date) => Promise<number[]>;
  /** v4 fix round 1: builder tokens 'unknown' or 'launching' over 10 minutes (default builder-token.ts stuckBuilderTokens). */
  stuckBuilderTokens?: (now: Date) => Promise<number[]>;
  /** v2.9 C13: the hosted sites' R2 (default: r2.ts r2Client); with `only`, the step runs only when given. */
  /** `only`: tests limit the hosting steps to their own slugs. */
  hosting?: { r2?: R2; only?: string[] };
  /** v2.9 E19: the weekly email's mailer and installations (tests); with `only`, the step runs only when given. */
  digest?: { mail?: Mailer; only?: number[] };
  /**
   * v2.10 fix round 1: the cleanup step (expired sign-in links over a day old, public repo reads past
   * their 7 days), at most `limit` rows each a run; with `only`, the step runs only when given.
   */
  cleanup?: { limit?: number };
  /** v2.10 item 13: the deployer's chains and price (tests); with `only`, the step runs only when given. */
  deployer?: Pick<DeployDeps, 'chain' | 'usdPerNative'>;
  /** v2.11 T11: the usage checks' reads and `only` (deployed event ids); with `only`, the step runs only when given. */
  usage?: UsageDeps;
  /** v2.12 spec 6: the builder score's reads and people (tests); with `only`, the steps run only when given. */
  builderScore?: ScoreCronDeps;
  /** v3.1 Highlights: the Builder Codes step's GitHub fetch and builders (tests); with `only`, the step runs only when given. */
  builderCodes?: { fetch?: typeof fetch; only?: number[] };
  /** v3.1 Highlights fix round 1: the contract origins backfill's read and builders (tests); with `only`, the step runs only when given. */
  contractOrigins?: { origin?: (ref: string) => Promise<ContractOrigin>; only?: number[] };
  /** v3.1 Used by: the step's Alchemy calls, CDP fetch and builders (tests); with `only`, the step runs only when given. */
  usedBy?: { callFor?: (network: string) => AlchemyCall; fetch?: typeof fetch; only?: number[]; limit?: number };
  /** v4 Task 12: the Safe watch's reads, price and mailer (tests); with `only`, the step runs only when given. */
  safeWatch?: SafeWatchDeps;
  /** v4 Task 12: the gas-low email's mailer (tests); with `only`, the gas emails go only when given. */
  ownerMail?: Mailer;
};

/** v3.1 Highlights fix round 1: the Builder Codes step's time, at most a minute and never past the run's deadline. */
export const BUILDER_CODES_SLICE_MS = 60_000;
/** When the Builder Codes step stops starting checks: BUILDER_CODES_SLICE_MS from `start`, or the run's deadline if sooner. Pure. */
export const builderCodesSliceEnd = (start: number, deadline: number) => Math.min(deadline, start + BUILDER_CODES_SLICE_MS);

/** Opens the 48 h review (once: only from 'running') and freezes the payout terms with it. */
const openReview = (p: Program, now: Date) => sql()`
  UPDATE campaign_runs SET state = 'review', frozen_at = ${now},
    review_until = ${new Date(now.getTime() + REVIEW_MS)},
    terms = ${sql().json(termsOf(p.campaign as EarnKitCampaign))}, updated_at = now()
  WHERE program_id = ${p.id} AND state = 'running'`;

export { PAY_FAILED, PAY_FAILED_RUNS, STEP_FAILED, TERMS_CHANGED };
/**
 * needs_owner when the bonus ledger can't run (the payout key missing or malformed, or off Base
 * mainnet) while there are coin fees to claim (bonusLive).
 */
export const BONUS_WALLET_UNSET = 'bonus-rounds: payout wallet not configured';

/**
 * Whether there are coin fees to index and claim (Ruling 20; v2.14: the builder bonus program and round
 * clauses went with the rounds): an EarnKit coin exists (coin_address). bonus-ledger.ts still indexes,
 * claims and sweeps those fees to the Safe, so a missing payout key with a coin waits on the owner.
 */
export async function bonusLive(_now: Date) {
  const [r] = await sql()<{ live: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM projects WHERE coin_address IS NOT NULL) AS live`;
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
 * whose cached fees are over 6 h old; between them, the fee ledger (bonus-ledger.ts: claims, the
 * sweep and the Safe index; v2.14: no builder bonus, so no scoring, rounds or proof re-check).
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
  // The fee ledger (bonus-ledger.ts): index, claim, sweep to the Safe, the creator and MINI claims and
  // the Safe index (v2.14: no builder bonus, so no rounds). After the campaigns' scoring and payouts,
  // before the fee refresh. Runs with `only` (tests, the e2e) only when its deps are given.
  let bonus: Record<string, unknown> | undefined;
  if (!opts.only || deps.bonus) {
    try {
      bonus = await (deps.ledger ?? runBonusLedger)({
        now,
        deadline,
        ...deps.bonus,
      });
    } catch (err) {
      console.error('[cron] bonus', err);
      bonus = { step: 'error', note: STEP_FAILED };
    }
  }
  let fees = 0;
  try {
    fees = await refreshStaleFees(now, deadline, deps.refreshFees ?? refreshFees);
  } catch (err) {
    console.error('[cron] fees', err);
  }
  // v2.9 C13, Ruling 10: hosted sites past their expiry end (bounded per run), only while hosting
  // is on (the R2 variables are set). Same `only`/deps gating as the bonus steps.
  const hostingOn = r2Enabled() && (!opts.only || deps.hosting !== undefined);
  let hosting: Record<string, unknown> | undefined;
  if (hostingOn) {
    try {
      hosting = { ...(await expireSites(now, deps.hosting)), ...(await cleanDeploys(now, deps.hosting)) };
    } catch (err) {
      console.error('[cron] hosting', err instanceof Error ? err.name : 'error');
      hosting = { step: 'error', note: STEP_FAILED };
    }
  }
  // v2.10 fix round 1: bounded cleanup of expired sign-in links and stale public repo reads.
  let cleanup: { nonces: number; public_reads: number; rate_windows: number } | { step: 'error'; note: string } | undefined;
  if (!opts.only || deps.cleanup) {
    try {
      const limit = deps.cleanup?.limit;
      cleanup = {
        nonces: await sweepVerifyNonces(now, limit),
        public_reads: await sweepPublicReads(now, limit),
        rate_windows: await sweepRateWindows(now, limit),
      };
    } catch (err) {
      console.error('[cron] cleanup', err instanceof Error ? err.name : 'error');
      cleanup = { step: 'error', note: STEP_FAILED };
    }
  }
  // v2.10 item 13: the deployer's gas per chain, and deploys waiting on the owner.
  let deployer: Awaited<ReturnType<typeof deployerGas>> | undefined;
  if (!opts.only || deps.deployer) {
    try {
      deployer = await deployerGas(now, deps.deployer);
    } catch (err) {
      console.error('[cron] deployer', err instanceof Error ? err.name : 'error');
    }
  }
  // v2.11 T11 (spec 7): the 30- and 90-day usage checks on deployed contracts, at most 20 a run
  // (free reads: Blockscout on Base, the public RPC on Arc). Off while the event log is off. A failed
  // read is retried at most once per 20 hours (this cron is hourly) and never waits on the owner.
  let usage: Awaited<ReturnType<typeof usageChecks>> | { step: 'error'; note: string } | undefined;
  if (!opts.only || deps.usage) {
    try {
      usage = await usageChecks(now, { deadline, ...deps.usage });
    } catch (err) {
      console.error('[cron] usage', err instanceof Error ? err.name : 'error');
      usage = { step: 'error', note: STEP_FAILED };
    }
  }
  // v2.12 spec 6: the builder score's four steps (discover and read, score, ranks, the empty-profile
  // check), with at most 40% of what remains (no new schedule).
  // A hold waits on the owner quietly (listed, never a 503).
  const needs_owner_extra: string[] = [];
  let builderScore: Record<string, unknown> | undefined;
  if (!opts.only || deps.builderScore) {
    try {
      builderScore = await runScoreSteps(now, scoreSliceEnd(Date.now(), deadline), deps.builderScore);
      // Every current hold, not only this run's: a hold waits until the owner releases it.
      for (const id of await heldPeople(deps.builderScore?.only)) needs_owner_extra.push(`score-hold:${id}${QUIET_OWNER}`);
      // v2.12 T7 review: an X handle two people's GitHub profiles list (cleared at /admin/scores).
      for (const c of await xHandleConflicts(deps.builderScore?.only)) needs_owner_extra.push(`${c.line}${QUIET_OWNER}`);
    } catch (err) {
      console.error('[cron] builder score', err instanceof Error ? err.name : 'error');
      builderScore = { step: 'error', note: STEP_FAILED };
    }
  }
  // v2.9 E19: the weekly email, Mondays from DIGEST_HOUR_UTC (sendDigests decides who is due), within
  // Resend's free caps, with what is left of the budget. Off without RESEND_API_KEY. v3 Stage 1 (spec 5.4):
  // after the score steps, so the weekly job writes last week (the email's moment) first within one run.
  let digest: Awaited<ReturnType<typeof sendDigests>> | { step: 'error'; note: string } | undefined;
  if (digestEnabled() && (!opts.only || deps.digest !== undefined)) {
    try {
      digest = await sendDigests(now, { ...deps.digest, budgetMs: Math.max(0, deadline - Date.now()) });
    } catch (err) {
      console.error('[cron] digest', err instanceof Error ? err.name : 'error');
      digest = { step: 'error', note: STEP_FAILED };
    }
  }
  // v4 Task 12: one email to the owner when the Safe holds $5,000 or more (safe-watch.ts; two free reads and the cached price).
  let safe: Awaited<ReturnType<typeof safeWatch>> | 'error' | undefined;
  if (!opts.only || deps.safeWatch) {
    try {
      safe = await safeWatch(now, deps.safeWatch);
    } catch (err) {
      console.error('[cron] safe watch', err instanceof Error ? err.name : 'error');
      safe = 'error';
    }
  }
  // v3.1 Highlights: the Builder Codes check for App-proven Base repos that are due (each at most one attempt a day,
  // at most BUILDER_CODES_PER_RUN a run), so the profile's item does not wait on the builder calling find or prepare.
  // After the weekly email (fix round 1: Monday's send is never squeezed) and within its own slice
  // (builderCodesSliceEnd). Off without the GitHub App.
  let builderCodes: Awaited<ReturnType<typeof runBuilderCodes>> | { step: 'error'; note: string } | undefined;
  if (githubAppEnabled() && (!opts.only || deps.builderCodes)) {
    try {
      builderCodes = await runBuilderCodes(now, { ...deps.builderCodes, deadline: builderCodesSliceEnd(Date.now(), deadline) });
    } catch (err) {
      console.error('[cron] builder codes', err instanceof Error ? err.name : 'error');
      builderCodes = { step: 'error', note: STEP_FAILED };
    }
  }
  // v3.1 Highlights fix round 1: "First deployed" for contracts verified before their creation time was kept
  // (contract-origins.ts: Blockscout, free, at most ORIGIN_READS_PER_RUN a run, each contract once), after the email,
  // in its own slice.
  let origins: Awaited<ReturnType<typeof backfillContractOrigins>> | { step: 'error'; note: string } | undefined;
  if (!opts.only || deps.contractOrigins) {
    try {
      origins = await backfillContractOrigins(now, { ...deps.contractOrigins, deadline: builderCodesSliceEnd(Date.now(), deadline) });
    } catch (err) {
      console.error('[cron] contract origins', err instanceof Error ? err.name : 'error');
      origins = { step: 'error', note: STEP_FAILED };
    }
  }
  // v3.1 Used by (2026-10-27): how many people used each Bench-confirmed builder's work in the last 30 days (used-by.ts:
  // the one Builder Code query of the day on the CDP SQL API, then the contracts on Alchemy, each builder once a UTC day,
  // at most USED_PER_RUN a run), after the Builder Codes step (its scan keeps the code strings), in its own slice.
  let usedBy: Awaited<ReturnType<typeof runUsedBy>> | { step: 'error'; note: string } | undefined;
  if (!opts.only || deps.usedBy) {
    try {
      usedBy = await runUsedBy(now, { ...deps.usedBy, deadline: builderCodesSliceEnd(Date.now(), deadline) });
    } catch (err) {
      console.error('[cron] used by', err instanceof Error ? err.name : 'error');
      usedBy = { step: 'error', note: STEP_FAILED };
    }
  }
  // v3.1 owner people view: GitHub account ages and wallet histories for the owner's private view (people-signals.ts;
  // once a UTC day, capped, free), after the email, in its own slice. Full runs only (a scoped test run skips it).
  let people: Awaited<ReturnType<typeof peopleSignals>> | { step: 'error'; note: string } | undefined;
  if (!opts.only) {
    try {
      people = await peopleSignals(now, builderCodesSliceEnd(Date.now(), deadline));
    } catch (err) {
      console.error('[cron] people signals', err instanceof Error ? err.name : 'error');
      people = { step: 'error', note: STEP_FAILED };
    }
  }
  // Campaigns whose payout waits on the owner (manual check, changed terms, a wallet short of the
  // prize or of gas, or PAY_FAILED_RUNS failed pay steps in a row): the endpoint answers 503.
  const needs_owner = campaigns
    .filter((c) => needsOwner(c.note as string | null | undefined) || Number(c.pay_failures ?? 0) >= PAY_FAILED_RUNS)
    .map((c) => c.id as string);
  // A bonus sweep that can't be proven dead or sent waits on the owner, like a stuck payout.
  // So does an index step that failed INDEX_FAILED_RUNS runs in a row (deposits would go unbooked).
  // v2.9 D17: so does a payout wallet low on ETH for gas, or a claim it couldn't pay gas for.
  if (bonusWaitsOnOwner(bonus)) needs_owner.push('bonus-ledger');
  // Rulings 19 and 20: the ledger was skipped for want of a usable payout key (missing or malformed)
  // or of Base mainnet while there are fees to index (bonusLive: an EarnKit coin). Nothing is indexed, claimed or swept to the Safe until the owner acts,
  // so it waits on the owner. A failed check counts as yes (never silent).
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
  // v2.8.1 §A1: a token launch still pending after 10 minutes waits on the owner (the runbook
  // "a token stuck in pending" decides launched or released). A failed read never stops the run.
  let stuck: number[] = [];
  if (!opts.only || deps.stuckLaunches) {
    try {
      stuck = await (deps.stuckLaunches ?? stuckLaunches)(now);
    } catch (err) {
      console.error('[cron] stuck launches', err);
    }
  }
  for (const id of stuck) needs_owner.push(`token-pending:${id}`);
  // v4 fix round 1: a builder token whose launch answer was unclear ('unknown'), or still 'launching' after 10
  // minutes (the process stopped mid-launch; the row blocks a later launch), waits on the owner the same way.
  if (!opts.only || deps.stuckBuilderTokens) {
    try {
      for (const id of await (deps.stuckBuilderTokens ?? stuckBuilderTokens)(now)) needs_owner.push(`builder-token:${id}`);
    } catch (err) {
      console.error('[cron] stuck builder tokens', err instanceof Error ? err.name : 'error');
    }
  }
  // v2.9 C14, P46: a flagged upload waits on the owner's review (the takedown route kills or approves it).
  if (hostingOn) {
    const review = await sitesInReview().catch((err: unknown) => {
      console.error('[cron] host review', err instanceof Error ? err.name : 'error');
      return [] as string[];
    });
    for (const slug of review) needs_owner.push(`host-review:${slug}`);
  }
  for (const key of deployer?.needs_owner ?? []) needs_owner.push(key);
  needs_owner.push(...needs_owner_extra);
  // v2.14 final fix 9: X sign-in and the GitHub App are hard prerequisites (full runs only; a scoped test run skips it).
  if (!opts.only) needs_owner.push(...missingPrerequisites());
  // v4 Task 12: a gas line (the payout wallet's or the deployer's) also emails the owner, once a UTC day per line.
  if (!opts.only || deps.ownerMail) {
    let payout: string | null = null;
    try {
      payout = deps.bonus?.account?.address ?? payoutAccount(deps.bonus?.env)?.address ?? null;
    } catch {
      payout = null;
    }
    for (const a of gasAlerts(needs_owner, bonusGasLow(bonus), payout, deployEnabled() ? deployerAddress() : null)) {
      try {
        await ownerGasMail(a, now, deps.ownerMail);
      } catch (err) {
        console.error('[cron] gas mail', err instanceof Error ? err.name : 'error');
      }
    }
  }
  return {
    now: now.toISOString(),
    campaigns,
    ...(stuck.length > 0 && { stuck_launches: stuck }),
    ...(bonus && { bonus }),
    fee_wallets: fees,
    ...(hosting && { hosting }),
    ...(digest && { digest }),
    ...(safe && { safe_watch: safe }),
    ...(cleanup && { cleanup }),
    ...(deployer && Object.keys(deployer.deployer_gas).length > 0 && { deployer_gas: deployer.deployer_gas }),
    ...(usage && { usage_checks: usage }),
    ...(builderScore && { builder_score: builderScore }),
    ...(builderCodes && { builder_codes: builderCodes }),
    ...(origins && { contract_origins: origins }),
    ...(usedBy && { used_by: usedBy }),
    ...(people && { people_signals: people }),
    needs_owner,
  };
}

/**
 * v2.14 final fix 9: the hard prerequisites. Sign in with X at install (the person is the X account) and the read-only
 * GitHub App (the only proof) need these; each one unset (or a key that doesn't parse) is a needs_owner line naming
 * it, `env-missing:<VAR>` or `env-invalid:GITHUB_APP_PRIVATE_KEY`, which alerts (503) until the owner sets it. No new
 * service: the hourly cron already runs. Pure; exported for tests.
 */
export const PREREQ_VARS = ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'] as const;
export function missingPrerequisites(env: Record<string, string | undefined> = process.env): string[] {
  const missing = PREREQ_VARS.filter((v) => !env[v]?.trim()).map((v) => `env-missing:${v}`);
  // All App and GitHub sign-in values set, yet the App is off: the private key doesn't parse.
  const appSet = PREREQ_VARS.slice(2).every((v) => env[v]?.trim());
  if (appSet && !githubAppEnabled(env)) missing.push('env-invalid:GITHUB_APP_PRIVATE_KEY');
  return missing;
}

/**
 * Ruling H11: a needs_owner line with this suffix is listed without the 503 (no hourly alert).
 * cronPost answers 503 only for lines without it.
 */
export const QUIET_OWNER = ':quiet';

/**
 * v2.10 item 13 (R18): while deploys are on, the deployer's balance on each chain in DEPLOY_CHAINS
 * (v2.10.3; unset is Arc and Base; one read each),
 * priced like a deploy; under one capped deploy's worth ($0.25) adds `deployer-gas:<chain>` (note
 * TOP_UP: the owner tops it up by hand); a failed price or balance read adds `deployer-price:<chain>`
 * (note PRICE_UNKNOWN, fix round 1 M3). Always: the last 7 days' deploys whose owner isn't the builder
 * (`deploy-owner:<id>`) or whose outcome is unknown (`deploy-unknown:<id>`, including a reservation
 * left 'sent' over 10 minutes). Ruling H11: a deploy flag alerts (503) for its first 24 hours, then
 * stays listed with QUIET_OWNER.
 */
export async function deployerGas(now: Date, deps: Pick<DeployDeps, 'chain' | 'usdPerNative'> = {}) {
  const needs_owner: string[] = [];
  const deployer_gas: Record<string, { usd?: number; note?: string }> = {};
  const address = deployEnabled() ? deployerAddress() : null;
  if (address)
    for (const c of deployChains()) {
      const chain = (deps.chain ?? viemDeployChain)(c);
      if (!chain) continue;
      try {
        const wei = await chain.balance(address);
        const micro = weiToMicroUsd(wei, await (deps.usdPerNative ?? nativeUsd)(c));
        const low = micro < BigInt(Math.round(DEPLOY_CAPS.perDeployUsd * 1_000_000));
        deployer_gas[c] = { usd: Number(micro) / 1_000_000, ...(low && { note: 'TOP_UP' }) };
        if (low) needs_owner.push(`deployer-gas:${c}`);
      } catch (err) {
        console.error('[cron] deployer gas', c, err instanceof Error ? err.name : 'error');
        deployer_gas[c] = { note: 'PRICE_UNKNOWN' };
        needs_owner.push(`deployer-price:${c}`);
      }
    }
  const rows = await sql()<{ id: number; unknown: boolean; fresh: boolean }[]>`
    SELECT id, (status = 'unknown' OR status = 'sent') AS unknown, created_at > ${new Date(now.getTime() - 86_400_000)} AS fresh
    FROM contract_deploys
    WHERE created_at > ${new Date(now.getTime() - 7 * 86_400_000)}
      AND (owner_ok = false OR status = 'unknown' OR (status = 'sent' AND created_at < ${new Date(now.getTime() - 10 * 60_000)}))
    ORDER BY id`;
  for (const r of rows) needs_owner.push(`${r.unknown ? 'deploy-unknown' : 'deploy-owner'}:${r.id}${r.fresh ? '' : QUIET_OWNER}`);
  return { deployer_gas, needs_owner };
}

/**
 * Whether the bonus ledger's run waits on the owner (the cron answers 503): its sweep's note does
 * (needsOwner), its index (or, v2.13.2, its Safe index) failed INDEX_FAILED_RUNS runs in a row, or (v2.9 D17) the payout wallet is
 * low on ETH for gas, or a claim result (its own or a creator's or MINI's) says it needs ETH for gas
 * (v2.14: the near-end collect is gone). Pure.
 */
export function bonusWaitsOnOwner(bonus: Record<string, unknown> | undefined) {
  return (
    needsOwner((bonus?.sweep as { result?: string } | undefined)?.result) ||
    Number(bonus?.index_failures ?? 0) >= INDEX_FAILED_RUNS ||
    // v2.13.2 review M3: the Safe index failing as many runs in a row.
    Number(bonus?.safe_index_failures ?? 0) >= INDEX_FAILED_RUNS ||
    bonusGasLow(bonus)
  );
}

/** v4 Task 12: the gas part of bonusWaitsOnOwner (the payout wallet low on ETH, or a claim it couldn't pay gas for). Pure. */
export function bonusGasLow(bonus: Record<string, unknown> | undefined) {
  const gasOut = (results: unknown) =>
    Array.isArray(results) && results.some((r) => String((r as { result?: unknown } | null)?.result ?? '').includes(NEEDS_GAS));
  return (bonus?.gas as { low?: boolean } | undefined)?.low === true || gasOut(bonus?.claim) || gasOut(bonus?.claim_others);
}

/**
 * POST /api/cron (app/api/cron/route.ts calls it): rate limited per IP, then Bearer CRON_SECRET
 * compared in constant time, then the jobs. 200 normally; 503 (same body) when a campaign's payout
 * waits on the owner (`needs_owner`, except QUIET_OWNER lines, Ruling H11), so the GitHub Actions run
 * fails and GitHub emails the owner.
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
    // Ruling H11: a quiet line is listed, never a 503.
    const alerting = Array.isArray(stuck) && stuck.some((k) => !String(k).endsWith(QUIET_OWNER));
    // The ledger reports block numbers as bigints; Response.json can't serialize them.
    const plain: unknown = JSON.parse(JSON.stringify(out, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
    return json(plain, alerting ? 503 : 200);
  } catch (err) {
    console.error('[cron]', err);
    return json({ error: 'The cron run failed; see the server log.' }, 500);
  }
}
