import { sql } from './db';

/**
 * A minimal fixed-window request counter in Postgres (`rate_windows`), so it holds across
 * instances. Used by POST /api/sponsor/[ref]/check; v2.2 §5 generalizes it.
 */

/** The start of the fixed window `now` falls in. Pure; exported for tests. */
export const windowStart = (now: Date, windowMs: number) =>
  new Date(Math.floor(now.getTime() / windowMs) * windowMs);

/**
 * The caller's IP: the rightmost `x-forwarded-for` entry, the one our proxy appended (entries to
 * its left are whatever the client sent). Pure; exported for tests.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last || headers.get('x-real-ip') || 'unknown';
}

/** Counts one request for `key`; false once it is over `limit` in the current window. */
export async function allowRequest(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const start = windowStart(new Date(), windowMs);
  const [row] = await sql()<{ count: number }[]>`
    INSERT INTO rate_windows (key, window_start, count) VALUES (${key}, ${start}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_windows.count + 1
    RETURNING count`;
  // The first request of a window clears this key's older windows.
  if (row.count === 1)
    await sql()`DELETE FROM rate_windows WHERE key = ${key} AND window_start < ${start}`;
  return row.count <= limit;
}
