/**
 * POST /api/cron, once a day (v6.1.16 Task 16: the daily run tells the truth). Steps, in order, each in its own try:
 * the freshness walk (links, page changes, status moves by date), the sweeps (repo cache over 30 days, project reports
 * over 180, screen jobs over 180, link codes, sessions and spent OAuth codes over a day, OAuth clients over 30 days with
 * no installation, the evidence cache over 180 days, rate windows over 2 days), the queue's share (5 minutes at most,
 * within the run's budget), then the owner's digest. One `deadline = start + RUN_BUDGET_MS`; health and the queue
 * start only before it (else `failed` with `budget`); the sweeps and the digest always run. Every failure is in
 * `failed: [{ id, step, error }]` (a program's id, or null for a whole step); the answer is 200 with the list, 500 only
 * when every step failed. A JSON body { job_id } is the owner's trigger: that job's queue only. Bearer CRON_SECRET only
 * (503 while it is unset).
 */
import { sweepEvidence } from '../v6/evidence';
import { sweepScreens } from '../v6/screen-jobs';
import { SCREEN_BATCH, SCREEN_DAILY_MS, SCREEN_TRIGGER_MAX, SCREEN_TRIGGER_MS, workQueue } from '../v6/screen-worker';
import { sql } from './db';
import { bearerMatches, json, readBody } from './http';
import { errorWords, runHealth, type HealthRun, type LinkCheck } from './health';
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

export type Step = 'health' | 'sweep_repo' | 'sweep_reports' | 'sweep_screens' | 'sweep_auth' | 'sweep_evidence' | 'sweep_windows' | 'screen' | 'digest';
const STEPS: Step[] = ['health', 'sweep_repo', 'sweep_reports', 'sweep_screens', 'sweep_auth', 'sweep_evidence', 'sweep_windows', 'screen', 'digest'];
export type RunFailure = { id: string | null; step: Step; error: string };

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

  const deadline = clock() + RUN_BUDGET_MS;
  const fails: RunFailure[] = [];
  /** Runs one step in its own try; a throw is listed and the run goes on. */
  const step = async <T>(name: Step, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (err) {
      const error = errorWords(err);
      console.error(`[cron] ${name} failed: ${error}`);
      fails.push({ id: null, step: name, error });
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
      link: deps.link, resolve: deps.resolve, transport: deps.transport, limit: deps.limit, deadline, clock,
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
  };

  const screen = inBudget('screen')
    ? await step('screen', () => work({
      now, limit: SCREEN_BATCH, clock,
      deadline: Math.min(clock() + SCREEN_DAILY_MS, deadline - SCREEN_TAIL_MS),
    }))
    : null;

  const digest = await step('digest', () => (deps.sendDigest ?? sendOwnerDigest)(now, deps.mailer));

  const whole = new Set(fails.filter((f) => f.id === null).map((f) => f.step));
  const status = STEPS.every((s) => whole.has(s)) ? 500 : 200;
  return json({
    health: health && { checked: health.checked, stale: health.stale.length, changed: health.changed.length, closed: health.closed.length, opened: health.opened.length },
    swept, screen, digest, failed: fails,
  }, status);
}
