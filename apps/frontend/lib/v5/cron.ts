/**
 * POST /api/cron, once a day (v6.1.16 Task 16: the daily run tells the truth). Steps, in order, each in its own try:
 * the freshness walk (links, page changes, status moves by date), the sweeps (repo cache over 30 days, project reports
 * over 180, screen jobs over 180 and those no reviewer can read, link codes, sessions and spent OAuth codes over a day,
 * OAuth clients over 30 days that never exchanged a code, the evidence cache over 180 days, rate windows over 2 days,
 * results-question markers over 30 days), the queue's share (5 minutes at most, within the run's budget), then the
 * owner's digest; a run that answers 200 stores its time (`cron_state`, v6.1.17 L30-14), which /api/stats shows and the
 * next digest checks for a gap. One `deadline = start + RUN_BUDGET_MS`; the walk has its own
 * share (HEALTH_BUDGET_MS); health and the queue start only before the deadline (else `failed` with `budget`); the
 * sweeps and the digest always run. Every failure is in `failed: [{ id, step, error }]` (a program's id, or null for a
 * whole step; `error` one of db, fetch, timeout, budget, catalog, error by the error's class, the message only
 * in the server log); the answer is 200 with the list, 500 only when every step failed. A JSON body { job_id } is the
 * owner's trigger: that job's queue only. Bearer CRON_SECRET only (503 while it is unset).
 */
import { sweepEvidence } from '../v6/evidence';
import { sweepScreens } from '../v6/screen-jobs';
import { SCREEN_BATCH, SCREEN_DAILY_MS, SCREEN_TRIGGER_MAX, SCREEN_TRIGGER_MS, workQueue } from '../v6/screen-worker';
import { sql } from './db';
import { bearerMatches, json, readBody } from './http';
import { errorCode, errorWords, runHealth, type ErrorCode, type HealthRun, type LinkCheck } from './health';
import type { Mailer } from './mail';
import { sendOwnerDigest } from './owner-digest';
import { programsChanged } from './programs-api';
import { sweepWindows } from './rate-limit';
import { sweepRepoCache } from './repo-facts';
import { sweepReports } from './ledger';
import type { Resolver, Transport } from './safe-fetch';

/** v6.1.16 Task 16: the whole daily run's budget (the workflow's curl waits 540 s). */
export const RUN_BUDGET_MS = 420_000;
export { PROBE_MS, PROBE_PARALLEL } from './health';
/** The queue's share ends this long before the run's deadline, for its last read and the digest. */
const SCREEN_TAIL_MS = 20_000;
/**
 * Fix round 1 (M1): the walk's own share of the run. Its probes end by `start + HEALTH_BUDGET_MS` (a probe starts only
 * when it can finish), so the queue always keeps at least RUN_BUDGET_MS - HEALTH_BUDGET_MS - SCREEN_TAIL_MS (220 s).
 */
export const HEALTH_BUDGET_MS = 180_000;

export type Step =
  | 'health' | 'sweep_repo' | 'sweep_reports' | 'sweep_screens' | 'sweep_auth' | 'sweep_evidence' | 'sweep_windows' | 'sweep_asks' | 'screen' | 'digest'
  | 'last_run';
/** The run's steps; `last_run` (storing the run's time) comes after the answer's status and is not one of them. */
const STEPS: Step[] = ['health', 'sweep_repo', 'sweep_reports', 'sweep_screens', 'sweep_auth', 'sweep_evidence', 'sweep_windows', 'sweep_asks', 'screen', 'digest'];
/** `error` is a code from a fixed set chosen by the error's class; the message is only in the server log. */
export type RunFailure = { id: string | null; step: Step; error: ErrorCode };

export type CronDeps = {
  /** The link check of the walk (tests); else probeLink over `resolve` and `transport`. */
  link?: LinkCheck;
  resolve?: Resolver;
  transport?: Transport;
  mailer?: Mailer;
  now?: Date;
  /** Epoch ms for the budget (default Date.now); tests pass a fake clock. */
  clock?: () => number;
  limit?: number;
  runHealth?: typeof runHealth;
  sendDigest?: typeof sendOwnerDigest;
  workQueue?: typeof workQueue;
};

/**
 * The job id of an owner-triggered run; null for an empty body (the daily run); 'bad' for any other body; a 408
 * Response for a body slower than 5 s (v6.1.16 Task 5 fix round 1, I2).
 */
async function triggeredJob(request: Request): Promise<{ jobId: string } | null | 'bad' | Response> {
  const text = await readBody(request, 1_024, () => json({ error: 'the body came too slowly' }, 408));
  if (text instanceof Response) return text;
  if (text === null) return 'bad';
  if (!text.trim()) return null;
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).join() !== 'job_id') return 'bad';
    const id = (body as { job_id: unknown }).job_id;
    return typeof id === 'string' && id.length > 0 && id.length <= 40 ? { jobId: id } : 'bad';
  } catch {
    return 'bad';
  }
}

const failed = (step: string, err: unknown): Response => {
  const name = err instanceof Error ? err.name.replace(/[^\w]/g, '').slice(0, 40) : 'unknown';
  console.error(`[cron] ${step} failed: ${name}`);
  return json({ error: `${step} failed` }, 500);
};

const DAY = 86_400_000;

/**
 * Link codes and sessions that expired over a day ago, spent OAuth codes exchanged over a day ago (v6.1.16 Task 5: a
 * code lives 5 minutes), and registered OAuth clients over 30 days old that never exchanged a code (Task 16: no
 * installation came from them; `used_at` is set at the first exchange); how many of each went.
 */
async function sweepAuth(now: Date): Promise<{ link_codes: number; sessions: number; oauth_codes: number; oauth_clients: number }> {
  const cutoff = new Date(now.getTime() - DAY);
  const codes = await sql()`DELETE FROM link_codes WHERE expires_at < ${cutoff}`;
  const sessions = await sql()`DELETE FROM sessions WHERE expires_at < ${cutoff}`;
  const spent = await sql()`DELETE FROM oauth_codes_spent WHERE at < ${cutoff}`;
  const clients = await sql()`DELETE FROM oauth_clients WHERE created_at < ${new Date(now.getTime() - 30 * DAY)} AND used_at IS NULL`;
  return { link_codes: codes.count, sessions: sessions.count, oauth_codes: spent.count, oauth_clients: clients.count };
}

/** v6.1.16 Task 9 N5 (v6.1.17 Task 3): results-question markers asked over this many days ago go. */
export const ASKS_KEEP_DAYS = 30;

/** `outcome_asks` rows whose day is over ASKS_KEEP_DAYS before `now`'s UTC day; how many went. */
async function sweepAsks(now: Date): Promise<number> {
  const before = new Date(now.getTime() - ASKS_KEEP_DAYS * DAY).toISOString().slice(0, 10);
  return (await sql()`DELETE FROM outcome_asks WHERE asked_on < ${before}::date`).count;
}

/**
 * L30-14 (v6.1.17): the time of the last run that answered 200; never moves back. Fix round 1 (M2): the first run of a
 * new UTC day also keeps the last run before it (`prev_run_at`) and itself (`day_first_at`), so the digest measures one
 * gap for the whole day and a second run that day builds the same body.
 */
async function storeLastRun(now: Date): Promise<void> {
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  await sql()`INSERT INTO cron_state (id, last_run_at, day_first_at) VALUES (true, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      prev_run_at = CASE WHEN cron_state.last_run_at < ${dayStart} THEN cron_state.last_run_at ELSE cron_state.prev_run_at END,
      day_first_at = CASE WHEN cron_state.last_run_at < ${dayStart} THEN EXCLUDED.last_run_at ELSE cron_state.day_first_at END,
      last_run_at = GREATEST(cron_state.last_run_at, EXCLUDED.last_run_at)`;
}

/** The last daily run that answered 200, or null before the first. */
export async function lastRunAt(): Promise<Date | null> {
  const [r] = await sql()<{ last_run_at: Date }[]>`SELECT last_run_at FROM cron_state WHERE id`;
  return r?.last_run_at ?? null;
}

export async function cronPost(request: Request, deps: CronDeps = {}): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron is not set up' }, 503);
  // L13-11 (v6.1.14): a secret under 32 characters never matches (secretMatches), so the job is not set up: 503 and
  // one ops line, never a 401 that reads like a wrong secret. The length is in the log only.
  if (secret.length < 32) {
    console.error('[cron] CRON_SECRET is under 32 characters; set one of at least 32 so the daily job can run');
    return json({ error: 'cron is not set up' }, 503);
  }
  if (!bearerMatches(request.headers.get('authorization'), secret)) return json({ error: 'unauthorized' }, 401);
  const now = deps.now ?? new Date();
  const clock = deps.clock ?? Date.now;
  const work = deps.workQueue ?? workQueue;
  const trigger = await triggeredJob(request);
  if (trigger === 'bad') return json({ error: 'bad body' }, 400);
  if (trigger instanceof Response) return trigger;
  if (trigger) {
    const { jobId } = trigger;
    try {
      const screen = await work({ now, limit: SCREEN_TRIGGER_MAX, jobId, deadline: clock() + SCREEN_TRIGGER_MS, clock });
      return json({ screen });
    } catch (err) {
      return failed('screen', err);
    }
  }

  const start = clock();
  const deadline = start + RUN_BUDGET_MS;
  const fails: RunFailure[] = [];
  /** Runs one step in its own try; a throw is listed and the run goes on. */
  const step = async <T>(name: Step, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (err) {
      console.error(`[cron] ${name} failed: ${errorWords(err)}`);
      fails.push({ id: null, step: name, error: errorCode(err) });
      return null;
    }
  };
  /** Health and the queue start only before the deadline. */
  const inBudget = (name: Step): boolean => {
    if (clock() < deadline) return true;
    fails.push({ id: null, step: name, error: 'budget' });
    return false;
  };

  let health: HealthRun | null = null;
  if (inBudget('health')) {
    health = await step('health', () => (deps.runHealth ?? runHealth)(now, {
      link: deps.link, resolve: deps.resolve, transport: deps.transport, limit: deps.limit, deadline: start + HEALTH_BUDGET_MS, clock,
    }));
    if (health) {
      for (const f of health.failed) fails.push({ ...f, step: 'health' });
      for (const id of [...health.closed, ...health.opened]) programsChanged(id);
    }
  }

  const swept = {
    repo_cache: await step('sweep_repo', () => sweepRepoCache(now)),
    reports: await step('sweep_reports', () => sweepReports(now)),
    screens: await step('sweep_screens', () => sweepScreens(now)),
    ...((await step('sweep_auth', () => sweepAuth(now))) ?? { link_codes: null, sessions: null, oauth_codes: null, oauth_clients: null }),
    evidence: await step('sweep_evidence', () => sweepEvidence(now)),
    windows: await step('sweep_windows', () => sweepWindows(now)),
    outcome_asks: await step('sweep_asks', () => sweepAsks(now)),
  };

  const screen = inBudget('screen')
    ? await step('screen', () => work({
      now, limit: SCREEN_BATCH, clock,
      deadline: Math.min(clock() + SCREEN_DAILY_MS, deadline - SCREEN_TAIL_MS),
    }))
    : null;

  // The digest names the rows the walk could not read (L30-18) and, from the stored time, a gap since the last run.
  const digest = await step('digest', () => (deps.sendDigest ?? sendOwnerDigest)(now, deps.mailer, { unreadable: health?.unreadable ?? [] }));

  const whole = new Set(fails.filter((f) => f.id === null).map((f) => f.step));
  const status = STEPS.every((s) => whole.has(s)) ? 500 : 200;
  if (status === 200) await step('last_run', () => storeLastRun(now));
  // v6.1.17 L30-13: the answer says what the run did; its shape is pinned in cron.test.ts.
  return json({
    health: health && {
      checked: health.checked, stale: health.stale.length, changed: health.changed.length, closed: health.closed.length,
      opened: health.opened.length, unreadable: health.unreadable.length,
    },
    swept, screen, digest, failed: fails,
  }, status);
}
