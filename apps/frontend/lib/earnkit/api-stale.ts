import type { Db } from './db';

/**
 * v4.9 final fix (ruling 6): an API program whose `verified_at` is more than this many days old (UTC days) is stale. A
 * stale program is read as `unlisted`: off every list, match, offer, count and site page, and an unknown id to the
 * agent, until the bot writes it again with a fresh `verified_at`. Day 14 still shows; day 15 doesn't. File and sponsor
 * programs are never stale.
 */
export const API_STALE_DAYS = 14;
const DAY_MS = 86_400_000;

/** Whether a row is a stale API program at `now`. Pure. */
export function apiStale(p: { source: string; verified_at: Date | string | null }, now: Date = new Date()): boolean {
  if (p.source !== 'api') return false;
  if (p.verified_at === null) return true;
  const v = typeof p.verified_at === 'string' ? Date.parse(`${p.verified_at.slice(0, 10)}T00:00:00Z`) : p.verified_at.getTime();
  const todayUtc = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  return v < todayUtc - API_STALE_DAYS * DAY_MS;
}

/** What a read treats as unlisted: an unlisted row, or a stale API program (apiStale). Pure. */
export const hiddenProgram = (p: { status: string; source: string; verified_at: Date | string | null }, now: Date = new Date()) =>
  p.status === 'unlisted' || apiStale(p, now);

/**
 * The SQL twin of `!apiStale`: true for every row except a stale API program. `alias` is the programs table's alias in
 * the query (null when unaliased); `now` defaults to the database's now(). verified_at is a date, compared with the
 * UTC day.
 */
export function freshSql(db: Db, alias: string | null = null, now?: Date) {
  const col = (c: string) => (alias ? db`${db(alias)}.${db(c)}` : db`${db(c)}`);
  const at = now ? db`${now}::timestamptz` : db`now()`;
  return db`NOT (${col('source')} = 'api' AND (${col('verified_at')} IS NULL OR ${col('verified_at')} < (${at} AT TIME ZONE 'UTC')::date - ${API_STALE_DAYS}::int))`;
}
