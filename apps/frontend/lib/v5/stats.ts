/**
 * GET /api/stats, public: the counts from the database. No installation, program application or
 * person is ever named. The money is the open grants' and prizes' pool, else top award, summed, investments left out.
 */
import { sql } from './db';
import { json } from './http';
import { categoryOf } from './program-file';
import { listOpenPrograms, type ProgramRow } from './programs';

export const STATS_KEYS = [
  'programs_open', 'open_money_usd', 'installs', 'installs_active_7d', 'finds_7d', 'applications', 'applications_7d', 'applications_via_earnkit',
  'won', 'won_usd', 'won_other', 'won_without_amount', 'last_run_at', 'last_check_ok', 'read_at',
] as const;
/**
 * L22-1 (v6.1.16): `won_usd` is the US dollar part of the wins only; `won_other` sums each other currency (never
 * converted), and `won_without_amount` counts wins kept with no amount, so the three describe every win.
 */
/**
 * v6.1.17 Task 3 (L30-14): `last_run_at` is when the daily run last finished (ISO, or null before the first), so a day
 * with no run shows.
 */
/**
 * v6.1.18 Task 5 (L36-3, L36-4): `applications_via_earnkit` counts the sends EarnKit made or drafted (an agent's, plus
 * a builder's that an EarnKit start preceded, `throughEarnkit`), all time; `read_at` is the read's `now` (the clock
 * passed in; the route caches the read for 10 minutes).
 */
/**
 * v6.1.19 (L44-10): `last_check_ok` is false when the latest run's link check failed (after the last run that finished
 * it); `last_run_at` stays the last run that finished its check.
 */
export type Stats = Record<Exclude<(typeof STATS_KEYS)[number], 'won_other' | 'last_run_at' | 'last_check_ok' | 'read_at'>, number> & {
  won_other: { currency: string; amount: number }[];
  last_run_at: string | null;
  last_check_ok: boolean;
  read_at: string;
};

const WEEK_MS = 7 * 86_400_000;

/**
 * The money open to win: over the open programs that are not investments, each one's `pool_usd` when
 * set (the whole pool is open; the max award is one winner's share), else its `max_award_usd`, else 0,
 * summed. An investment is not money to win, so it counts nothing. Pure.
 * Since v6.1.5, `open_money_usd` as /api/stats publishes it counts stated pools (before, max awards only);
 * the key set is unchanged.
 */
export const openMoneyUsd = (rows: ProgramRow[]): number =>
  rows
    .filter((r) => categoryOf(r.file) !== 'investment')
    .reduce((sum, r) => sum + (r.file.pool_usd ?? r.file.max_award_usd ?? 0), 0);

/** The statuses of an application the builder sent: applied, or any result (the owner's list and digest count the same, v6.1.18 L18-5). */
export const SENT = ['applied', 'won', 'rejected', 'no_result'];

type Sql = ReturnType<typeof sql>;

/**
 * v6.1.19 Task 1 (L42-1, L42-2): SQL over `applications a`: when the send was made. `sent_at` when kept; else an agent's
 * row (`submitted_by` 'agent' or null, from before v6.1.9) reads its own `at`, as `applicationsOf` does; a builder's row
 * with no send time (a send made outside EarnKit, recorded with its win) has none: null. A result never moves it.
 */
export const sendTime = (db: Sql) => db`CASE WHEN a.sent_at IS NOT NULL THEN a.sent_at WHEN COALESCE(a.submitted_by, 'agent') = 'agent' THEN a.at END`;

/**
 * v6.1.18 Task 5 (L36-3): SQL over `applications a`: the send went through EarnKit. An agent sent it (`submitted_by`
 * null is the agent's, as track.ts's L29-23 reads it), or an EarnKit start (a claim in `application_history`, same
 * owner, program and project) came before its send time. v6.1.19 (L42-5): a hold is not an EarnKit start; a builder's
 * send after a hold is reported. Fix round 1: the start is compared with `sendTime`, so a send with none (an outside
 * win recorded over a claim) is never through EarnKit.
 */
/**
 * v6.1.19.1 (L47-3): also a builder's send made the draft way (no start; the agent recorded `applied` with submitted_by
 * builder, so `sent_by_installation_id` is that agent) when that installation found the program for the project first:
 * a saved find report for the owner and project (`project_reports`, by key; its time moves with each find, so it is not
 * compared), or a track by that installation on the program before the send (a rule confirmed, a skip, an unskip; a
 * hold stays reported, L42-5). A send with no send time stays reported, and a /me send with no agent linked names none.
 */
export const throughEarnkit = (db: Sql) => db`(COALESCE(a.submitted_by, 'agent') = 'agent' OR EXISTS (
  SELECT 1 FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id
    AND COALESCE(h.project_id, '') = COALESCE(a.project_id, '') AND h.status = 'started' AND h.at < ${sendTime(db)})
  OR (a.submitted_by = 'builder' AND a.sent_by_installation_id IS NOT NULL AND ${sendTime(db)} IS NOT NULL AND (
    EXISTS (SELECT 1 FROM project_reports r WHERE r.owner = a.owner AND r.project_key = COALESCE(a.project_id, '') AND r.project_key <> '')
    OR EXISTS (SELECT 1 FROM application_history h WHERE h.installation_id = a.sent_by_installation_id AND h.program_id = a.program_id
      AND h.status IN ('gap_done', 'skipped', 'unskip') AND h.at < ${sendTime(db)}))))`;

/** Every send (applied or any result) with its send time (`sendTime`, null for an undated one) and `through` (throughEarnkit). */
export const sendRows = (db: Sql) => db`
  SELECT a.program_id, a.title, a.submitted_by, a.auto_applied, ${sendTime(db)} AS sent_time, ${throughEarnkit(db)} AS through
  FROM applications a WHERE a.status = ANY(${SENT})`;

/**
 * The counts over `s` (sendRows): `agent` sent by an agent (`submitted_by` 'agent' or null); `drafted` a builder
 * pressed send on an EarnKit draft; `reported` a builder's send EarnKit had no part in. agent + drafted + reported = all. A fragment for `WITH s AS (sendRows) SELECT ...`.
 */
export const sendCounts = (db: Sql) => db`count(*) AS all, count(*) FILTER (WHERE COALESCE(submitted_by, 'agent') = 'agent') AS agent,
  count(*) FILTER (WHERE submitted_by = 'builder' AND through) AS drafted,
  count(*) FILTER (WHERE submitted_by = 'builder' AND NOT through) AS reported,
  count(*) FILTER (WHERE auto_applied) AS auto`;

/** L28-2 (v6.1.16 Task 14): every application with `counted`: false only for a later win of a repo key's program. */
const wonOnce = (db: ReturnType<typeof sql>) => db`
  SELECT status, at, amounts, amount_usd,
         (repo_key IS NULL OR status <> 'won' OR row_number() OVER (PARTITION BY program_id, COALESCE(repo_id::text, repo_key), (status = 'won') ORDER BY at, owner) = 1) AS counted
  FROM applications`;

export async function readStats(now: Date = new Date()): Promise<Stats> {
  const db = sql();
  const week = new Date(now.getTime() - WEEK_MS);
  const [open, [i], [a], [v]] = await Promise.all([
    listOpenPrograms(now),
    db<{ installs: string; active: string; finds: string }[]>`
      SELECT count(*) AS installs,
             count(*) FILTER (WHERE last_seen_at >= ${week}) AS active,
             count(*) FILTER (WHERE last_find_at >= ${week}) AS finds
      FROM installations`,
    // L28-2 (v6.1.16 Task 14): a win counts once per repo (its GitHub id when known, fix round 1 M2, else its key) and program (its earliest win row), plus once per row
    // with no repo key; `counted` marks those rows.
    db<{ sent: string; won: string; won_usd: string | null; won_none: string }[]>`
      WITH a AS (${wonOnce(db)})
      SELECT count(*) FILTER (WHERE status = ANY(${SENT})) AS sent,
             count(*) FILTER (WHERE status = 'won' AND counted) AS won,
             sum(COALESCE((amounts->>'USD')::numeric, CASE WHEN amounts IS NULL THEN amount_usd END)) FILTER (WHERE status = 'won' AND counted) AS won_usd,
             count(*) FILTER (WHERE status = 'won' AND counted AND (amounts IS NULL OR amounts = '{}'::jsonb) AND amount_usd IS NULL) AS won_none
      FROM a`,
    // L42-1 (v6.1.19): the week counts sends by their send time, so a result today on an older send moves nothing,
    // and an undated send (outside EarnKit) is in no week.
    db<{ via: string; sent_week: string }[]>`
      WITH s AS (${sendRows(db)})
      SELECT count(*) FILTER (WHERE COALESCE(submitted_by, 'agent') = 'agent' OR (submitted_by = 'builder' AND through)) AS via,
             count(*) FILTER (WHERE sent_time >= ${week}) AS sent_week FROM s`,
  ]);
  const [run] = await db<{ last_run_at: Date | null; last_check_failed_at: Date | null }[]>`SELECT last_run_at, last_check_failed_at FROM cron_state WHERE id`;
  const failedAt = run?.last_check_failed_at ?? null;
  const other = await db<{ currency: string; amount: string }[]>`
    WITH w AS (${wonOnce(db)})
    SELECT e.key AS currency, sum(e.value::numeric) AS amount FROM w a, jsonb_each_text(a.amounts) e
    WHERE a.status = 'won' AND a.counted AND a.amounts IS NOT NULL AND e.key <> 'USD' GROUP BY e.key ORDER BY e.key`;
  return {
    programs_open: open.length,
    open_money_usd: openMoneyUsd(open),
    installs: Number(i.installs),
    installs_active_7d: Number(i.active),
    finds_7d: Number(i.finds),
    applications: Number(a.sent),
    applications_7d: Number(v.sent_week),
    applications_via_earnkit: Number(v.via),
    won: Number(a.won),
    won_usd: Number(a.won_usd ?? 0),
    won_other: other.map((r) => ({ currency: r.currency, amount: Number(r.amount) })),
    won_without_amount: Number(a.won_none),
    last_run_at: run?.last_run_at?.toISOString() ?? null,
    last_check_ok: !failedAt || (run?.last_run_at != null && run.last_run_at > failedAt),
    read_at: now.toISOString(),
  };
}

/**
 * The route's answer: the stats, or 503 (never cached) when the read fails. `read` may be cached; v6.1.18 Task 5 (L36-4):
 * the header says the 10 minutes the route caches the read for, and `read_at` when it was read.
 */
export async function statsGet(read: () => Promise<Stats> = () => readStats()): Promise<Response> {
  try {
    return json(await read(), 200, { 'Cache-Control': 'public, max-age=600' });
  } catch (err) {
    console.error('[stats] read failed', (err as { name?: string } | null)?.name ?? 'unknown');
    return json({ error: 'stats unavailable, try again shortly' }, 503, { 'Retry-After': '30' });
  }
}
