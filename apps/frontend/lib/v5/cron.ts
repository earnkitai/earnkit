/**
 * POST /api/cron, once a day: the freshness probe, then the owner's digest. Bearer CRON_SECRET
 * only (503 while it is unset). A step that throws answers 500 with its name; the log names only
 * the error type.
 */
import { bearerMatches, json } from './http';
import { runHealth } from './health';
import type { Mailer } from './mail';
import { sendOwnerDigest } from './owner-digest';
import { programsChanged } from './programs-api';
import type { Probe } from './safe-fetch';

export type CronDeps = {
  probe?: Probe;
  page?: (url: string) => Promise<string>;
  mailer?: Mailer;
  now?: Date;
  limit?: number;
  runHealth?: typeof runHealth;
  sendDigest?: typeof sendOwnerDigest;
};

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

  let health: Awaited<ReturnType<typeof runHealth>>;
  try {
    health = await (deps.runHealth ?? runHealth)({ probe: deps.probe, page: deps.page, now }, deps.limit);
  } catch (err) {
    return failed('health', err);
  }
  for (const id of health.closed) programsChanged(id);

  let digest: 'sent' | 'none';
  try {
    digest = await (deps.sendDigest ?? sendOwnerDigest)(now, deps.mailer);
  } catch (err) {
    return failed('digest', err);
  }
  return json({ health: { checked: health.checked, stale: health.stale.length, changed: health.changed.length, closed: health.closed.length }, digest });
}
