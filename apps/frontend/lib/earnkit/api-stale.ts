import { sql, type Db } from './db';

/**
 * v4.9 final fix (ruling 6, follow-up): an API program whose `verified_at` is more than this many days old (UTC days)
 * is stale. A stale program leaves discovery only (lists, matches, offers, counts, the landing, the sitemap and the
 * new-program emails) until the bot writes it again with a fresh `verified_at`. A builder who entered, applied to or
 * drafted it keeps it (entries, standing, closing nudges and alerts, find, prepare and get_program: `connectedSql`,
 * `hiddenFor`), and its guide page keeps working. Day 14 still shows; day 15 doesn't. File and sponsor programs are
 * never stale.
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

/**
 * The program ids the builder group of `installationId` is connected to: an entry (projects), a program they told
 * EarnKit they applied to (builder_program_status), or a draft in hand (builder_profiles.standing_seen.apply_yes). A
 * stale API program stays readable for these builders.
 */
export const connectedSql = (db: Db, installationId: number) => db`
  WITH grp AS (SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${installationId}),
    members AS (SELECT i.id FROM installations i, grp WHERE COALESCE(i.builder_id, i.id) = grp.root)
  SELECT program_id FROM projects WHERE installation_id IN (SELECT id FROM members)
  UNION SELECT program_id FROM builder_program_status WHERE installation_id IN (SELECT id FROM members) AND status = 'applied'
  UNION SELECT jsonb_object_keys(COALESCE(bp.standing_seen->'apply_yes', '{}'::jsonb)) FROM builder_profiles bp, grp
    WHERE bp.builder_id = grp.root AND jsonb_typeof(bp.standing_seen->'apply_yes') = 'object'`;

/**
 * Whether a program read by id is gone for this builder: unlisted (R15), or a stale API program the builder isn't
 * connected to (connectedSql). With no installation, a stale program is gone.
 */
export async function hiddenFor(
  p: { id: string; status: string; source: string; verified_at: Date | string | null },
  installationId: number | null,
  now: Date = new Date(),
): Promise<boolean> {
  if (p.status === 'unlisted') return true;
  if (!apiStale(p, now)) return false;
  if (installationId === null) return true;
  const db = sql();
  const [row] = await db<{ n: number }[]>`SELECT 1 AS n FROM (${connectedSql(db, installationId)}) c WHERE c.program_id = ${p.id} LIMIT 1`;
  return row === undefined;
}
