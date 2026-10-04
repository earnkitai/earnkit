import { sql } from './db';
import { FINAL_GRACE_MS, REVIEW_MS, type CampaignConfig, type EarnKitCampaign } from './campaigns';
import { scoreCampaignEntries, type ScoreDeps, type ScoreRow } from './campaign-score';
import { FEE_TTL_MS, launchedCreatorWallets, refreshFees } from './fees';
import { bearerMatches, json } from './http';
import { payCampaign, type PayDeps } from './payout';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { withScoringLock } from './sponsor';
import type { Candidate, RunState } from './winners';

/** Work per cron call; the hourly run picks up the rest. */
export const CRON_BUDGET_MS = 4 * 60_000;
/** An entry still unscorable this long after the end is frozen with its last score (its error shown in the review). */
export const FREEZE_GIVE_UP_MS = 24 * 3_600_000;

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
type Entry = ScoreRow & Candidate & { prize_raw_tx: string | null; score_partial: boolean };

// score_attempted_at drives scoring rotation (a slow entry goes last next pass); score_partial is
// flagged in the review (a final score whose reads were capped stays payable).
const entriesOf = (programId: string) => sql()<Entry[]>`
  SELECT id, contracts, payout_wallet, deployers, score, scored_at, scored_through, score_final,
    score_attempted_at, score_partial, submitted_at, installation_id, vetoed_at, payout_status,
    prize_tx, prize_raw_tx
  FROM projects
  WHERE program_id = ${programId} AND payout_wallet IS NOT NULL AND contracts IS NOT NULL
  ORDER BY id`;

/** Injection for the e2e (scoring reads, payout chain and wallet, the fee source). */
export type CronDeps = { score?: ScoreDeps; pay?: PayDeps; refreshFees?: (wallets: string[]) => Promise<number> };

/** Opens the 48 h review (once: only from 'running'). */
const openReview = (programId: string, now: Date) => sql()`
  UPDATE campaign_runs SET state = 'review', frozen_at = ${now},
    review_until = ${new Date(now.getTime() + REVIEW_MS)}, updated_at = now()
  WHERE program_id = ${programId} AND state = 'running'`;

/** Final scores whose reads were capped (score_partial): payable, flagged in the review. */
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
    const out = await scoreCampaignEntries(p, entries, { now, deadline, final: true, maxAgeMs: 0 }, deps.score);
    if (now.getTime() >= p.ends_at.getTime() + FREEZE_GIVE_UP_MS)
      await sql()`
        UPDATE projects SET score_final = true
        WHERE program_id = ${p.id} AND payout_wallet IS NOT NULL AND NOT score_final`;
    const frozen = await entriesOf(p.id);
    const review = frozen.every((e) => e.score_final);
    if (review) await openReview(p.id, now);
    return {
      step,
      final: out.filter((o) => o.result === 'final').length,
      failed: out.filter((o) => o.result === 'failed').length,
      review,
      partial: partialIds(frozen),
    };
  }
  if (step === 'review') {
    await openReview(p.id, now);
    return { step, partial: partialIds(entries) };
  }
  if (step === 'pay') {
    await sql()`UPDATE campaign_runs SET state = 'paying', updated_at = now() WHERE program_id = ${p.id} AND state = 'review'`;
    const fresh = (await entriesOf(p.id)).filter((e) => e.score_final);
    const r = await payCampaign(p.campaign as EarnKitCampaign, fresh, { deadline, ...deps.pay });
    await sql()`
      UPDATE campaign_runs SET state = ${r.done ? 'paid' : 'paying'}, note = ${r.note}, updated_at = now()
      WHERE program_id = ${p.id}`;
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
 * The daily jobs (v2.4 §3, §4), idempotent: for every EarnKit campaign that is live or not yet
 * paid out, one lifecycle step under the campaign's lease (a second concurrent call gets 'busy');
 * one campaign's failure never stops the others; then the token-fee refresh for creator wallets
 * whose cached fees are over 6 h old. `now` is injectable for the e2e (production: the real
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
      AND p.status = 'active' AND COALESCE(r.state, 'running') <> 'paid'
      ${opts.only ? sql()`AND p.id IN ${sql()(opts.only)}` : sql()``}
    ORDER BY p.ends_at`;
  const campaigns: Record<string, unknown>[] = [];
  for (const p of programs) {
    try {
      const r = await withScoringLock(p.id, () => advance(p, now, deadline, deps), (opts.budgetMs ?? CRON_BUDGET_MS) + 60_000);
      campaigns.push({ id: p.id, ...(r === 'busy' ? { step: 'busy' } : r) });
    } catch (err) {
      console.error('[cron]', p.id, err);
      campaigns.push({ id: p.id, step: 'error', note: String(err).slice(0, 200) });
    }
  }
  let fees = 0;
  try {
    fees = await refreshStaleFees(now, deadline, deps.refreshFees ?? refreshFees);
  } catch (err) {
    console.error('[cron] fees', err);
  }
  return { now: now.toISOString(), campaigns, fee_wallets: fees };
}

/**
 * POST /api/cron (app/api/cron/route.ts calls it): rate limited per IP, then Bearer CRON_SECRET
 * compared in constant time, then the jobs. `deps` for tests.
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
  return json(await (deps.run ?? (() => runCron()))());
}
