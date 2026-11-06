/**
 * POST /api/cron, once a day: the freshness probe, the repo cache sweep (rows over 30 days), the screen
 * jobs over 90 days swept and the queue's share (10 minutes at most), then the owner's digest. A JSON body { job_id } is the owner's trigger: that job's queue
 * only. Bearer CRON_SECRET only (503 while it is unset). A step that throws answers 500 with its name.
 */
import { sweepScreens } from '../v6/screen-jobs';
import { SCREEN_BATCH, SCREEN_DAILY_MS, SCREEN_TRIGGER_MAX, SCREEN_TRIGGER_MS, workQueue } from '../v6/screen-worker';
import { bearerMatches, json, readCapped } from './http';
import { runHealth } from './health';
import type { Mailer } from './mail';
import { sendOwnerDigest } from './owner-digest';
import { programsChanged } from './programs-api';
import { sweepRepoCache } from './repo-facts';
import type { Probe } from './safe-fetch';

export type CronDeps = {
  probe?: Probe;
  page?: (url: string) => Promise<string>;
  mailer?: Mailer;
  now?: Date;
  limit?: number;
  runHealth?: typeof runHealth;
  sendDigest?: typeof sendOwnerDigest;
  workQueue?: typeof workQueue;
};

/** The job id of an owner-triggered run; null for an empty body (the daily run); 'bad' for any other body. */
async function triggeredJob(request: Request): Promise<{ jobId: string } | null | 'bad'> {
  const text = await readCapped(request, 1_024).catch(() => null);
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

export async function cronPost(request: Request, deps: CronDeps = {}): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron is not set up' }, 503);
  if (!bearerMatches(request.headers.get('authorization'), secret)) return json({ error: 'unauthorized' }, 401);
  const now = deps.now ?? new Date();
  const work = deps.workQueue ?? workQueue;
  const trigger = await triggeredJob(request);
  if (trigger === 'bad') return json({ error: 'bad body' }, 400);
  if (trigger) {
    const { jobId } = trigger;
    try {
      const screen = await work({ now, limit: SCREEN_TRIGGER_MAX, jobId, deadline: Date.now() + SCREEN_TRIGGER_MS });
      return json({ screen });
    } catch (err) {
      return failed('screen', err);
    }
  }

  let health: Awaited<ReturnType<typeof runHealth>>;
  try {
    health = await (deps.runHealth ?? runHealth)({ probe: deps.probe, page: deps.page, now }, deps.limit);
  } catch (err) {
    return failed('health', err);
  }
  for (const id of health.closed) programsChanged(id);

  let swept: number;
  try {
    swept = await sweepRepoCache(now);
  } catch (err) {
    return failed('sweep', err);
  }

  let screen: Awaited<ReturnType<typeof workQueue>> & { swept: number };
  try {
    // Jobs past the 90-day window of the counts across programs go first.
    const screensSwept = await sweepScreens(now);
    screen = { swept: screensSwept, ...(await work({ now, limit: SCREEN_BATCH, deadline: Date.now() + SCREEN_DAILY_MS })) };
  } catch (err) {
    return failed('screen', err);
  }

  let digest: 'sent' | 'none';
  try {
    digest = await (deps.sendDigest ?? sendOwnerDigest)(now, deps.mailer);
  } catch (err) {
    return failed('digest', err);
  }
  return json({ health: { checked: health.checked, stale: health.stale.length, changed: health.changed.length, closed: health.closed.length }, swept, screen, digest });
}
