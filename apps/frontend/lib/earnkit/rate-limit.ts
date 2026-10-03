import { sql } from './db';

/**
 * Fixed-window request counters in Postgres (`rate_windows`), so they hold across instances
 * (v2.2 §5). One atomic upsert per hit; the first hit of a window clears that key's older windows,
 * and now and then the whole table's stale windows.
 */

/** The limits (v2.2 §5). Keys are `<name>:<installation id or IP>`. */
export const LIMITS = {
  /** sponsor_campaign create, per installation. */
  sponsorCreate: { limit: 5, windowSeconds: 86_400 },
  /** record_submission, per installation. */
  recordSubmission: { limit: 20, windowSeconds: 86_400 },
  /** POST /oauth/register, per client IP. */
  oauthRegister: { limit: 20, windowSeconds: 3_600 },
  /** list_programs with GitHub matching (a user or repos), per installation. */
  githubMatching: { limit: 30, windowSeconds: 3_600 },
  /** Chain reads: POST /api/sponsor/[ref]/check per IP, sponsor_campaign status per installation. */
  chainChecks: { limit: 60, windowSeconds: 60 },
} as const;

/** Campaign entries one installation may record in one campaign (checked in recordSubmission). */
export const ENTRIES_PER_CAMPAIGN = 3;

/** The start of the fixed window `now` falls in. Pure; exported for tests. */
export const windowStart = (now: Date, windowMs: number) =>
  new Date(Math.floor(now.getTime() / windowMs) * windowMs);

export type Hit = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window ends (when a refused caller can try again). */
  retryAfter: number;
};

/** What a hit means once the window's count is known. Pure; exported for tests. */
export function hitResult(
  count: number,
  limit: number,
  windowSeconds: number,
  now: Date,
): Hit {
  const windowMs = windowSeconds * 1000;
  const end = windowStart(now, windowMs).getTime() + windowMs;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, Math.ceil((end - now.getTime()) / 1000)),
  };
}

/** "a minute", "12 minutes", "3 hours": a readable retry-after. Pure; exported for tests. */
export function retryText(seconds: number) {
  if (seconds <= 60) return 'a minute';
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)} minutes`;
  const hours = Math.ceil(seconds / 3_600);
  return hours === 1 ? 'an hour' : `${hours} hours`;
}

/**
 * The caller's IP: the rightmost `x-forwarded-for` entry, the one our proxy appended (entries to
 * its left are whatever the client sent). Pure; exported for tests.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last || headers.get('x-real-ip') || 'unknown';
}

/** Counts one request for `key` in the current `windowSeconds` window. */
export async function hit(
  key: string,
  limit: number,
  windowSeconds: number,
  now = new Date(),
): Promise<Hit> {
  const start = windowStart(now, windowSeconds * 1000);
  const [row] = await sql()<{ count: number }[]>`
    INSERT INTO rate_windows (key, window_start, count) VALUES (${key}, ${start}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_windows.count + 1
    RETURNING count`;
  if (row.count === 1) {
    await sql()`DELETE FROM rate_windows WHERE key = ${key} AND window_start < ${start}`;
    // Keys that never come back (one-off IPs) are swept now and then; no window is over a day.
    if (Math.random() < 0.01)
      await sql()`DELETE FROM rate_windows WHERE window_start < now() - interval '2 days'`;
  }
  return hitResult(row.count, limit, windowSeconds, now);
}

/** A refused call: the message says what was limited and when to try again. */
export class RateLimitError extends Error {
  constructor(
    what: string,
    readonly retryAfter: number,
  ) {
    super(`${what} Try again in ${retryText(retryAfter)}.`);
  }
}

/** Counts one call against `LIMITS[name]` for `who`; throws a RateLimitError when over it. */
export async function enforce(
  name: keyof typeof LIMITS,
  who: string | number,
  what: string,
) {
  const { limit, windowSeconds } = LIMITS[name];
  const r = await hit(`${name}:${who}`, limit, windowSeconds);
  if (!r.allowed) throw new RateLimitError(what, r.retryAfter);
  return r;
}
