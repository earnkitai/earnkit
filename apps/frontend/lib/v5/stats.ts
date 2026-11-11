/**
 * GET /api/stats, public: the counts from the database. No installation, program application or
 * person is ever named. The money is the open grants' and prizes' pool, else top award, summed, investments left out.
 */
import { sql } from './db';
import { json } from './http';
import { categoryOf } from './program-file';
import { listOpenPrograms, type ProgramRow } from './programs';

export const STATS_KEYS = [
  'programs_open', 'open_money_usd', 'installs', 'installs_active_7d', 'finds_7d', 'applications', 'applications_7d', 'won', 'won_usd',
  'won_other', 'won_without_amount',
] as const;
/**
 * L22-1 (v6.1.16): `won_usd` is the US dollar part of the wins only; `won_other` sums each other currency (never
 * converted), and `won_without_amount` counts wins kept with no amount, so the three describe every win.
 */
export type Stats = Record<Exclude<(typeof STATS_KEYS)[number], 'won_other'>, number> & { won_other: { currency: string; amount: number }[] };

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

/** The statuses of an application the builder sent: applied, or any result. */
const SENT = ['applied', 'won', 'rejected', 'no_result'];

export async function readStats(now: Date = new Date()): Promise<Stats> {
  const db = sql();
  const week = new Date(now.getTime() - WEEK_MS);
  const [open, [i], [a]] = await Promise.all([
    listOpenPrograms(now),
    db<{ installs: string; active: string; finds: string }[]>`
      SELECT count(*) AS installs,
             count(*) FILTER (WHERE last_seen_at >= ${week}) AS active,
             count(*) FILTER (WHERE last_find_at >= ${week}) AS finds
      FROM installations`,
    db<{ sent: string; sent_week: string; won: string; won_usd: string | null; won_none: string }[]>`
      SELECT count(*) FILTER (WHERE status = ANY(${SENT})) AS sent,
             count(*) FILTER (WHERE status = ANY(${SENT}) AND at >= ${week}) AS sent_week,
             count(*) FILTER (WHERE status = 'won') AS won,
             sum(COALESCE((amounts->>'USD')::numeric, CASE WHEN amounts IS NULL THEN amount_usd END)) FILTER (WHERE status = 'won') AS won_usd,
             count(*) FILTER (WHERE status = 'won' AND (amounts IS NULL OR amounts = '{}'::jsonb) AND amount_usd IS NULL) AS won_none
      FROM applications`,
  ]);
  const other = await db<{ currency: string; amount: string }[]>`
    SELECT e.key AS currency, sum(e.value::numeric) AS amount FROM applications a, jsonb_each_text(a.amounts) e
    WHERE a.status = 'won' AND a.amounts IS NOT NULL AND e.key <> 'USD' GROUP BY e.key ORDER BY e.key`;
  return {
    programs_open: open.length,
    open_money_usd: openMoneyUsd(open),
    installs: Number(i.installs),
    installs_active_7d: Number(i.active),
    finds_7d: Number(i.finds),
    applications: Number(a.sent),
    applications_7d: Number(a.sent_week),
    won: Number(a.won),
    won_usd: Number(a.won_usd ?? 0),
    won_other: other.map((r) => ({ currency: r.currency, amount: Number(r.amount) })),
    won_without_amount: Number(a.won_none),
  };
}

/** The route's answer: the stats, or 503 (never cached) when the read fails. `read` may be cached. */
export async function statsGet(read: () => Promise<Stats> = () => readStats()): Promise<Response> {
  try {
    return json(await read(), 200, { 'Cache-Control': 'public, max-age=60' });
  } catch (err) {
    console.error('[stats] read failed', (err as { name?: string } | null)?.name ?? 'unknown');
    return json({ error: 'stats unavailable, try again shortly' }, 503, { 'Retry-After': '30' });
  }
}
