/**
 * GET /api/stats, public: nine counts from the database. No installation, program application or
 * person is ever named. The money is the open grants' and prizes' top amount summed, investments left out.
 */
import { sql } from './db';
import { json } from './http';
import { categoryOf } from './program-file';
import { listOpenPrograms, type ProgramRow } from './programs';

export const STATS_KEYS = [
  'programs_open', 'open_money_usd', 'installs', 'installs_active_7d', 'finds_7d', 'applications', 'applications_7d', 'won', 'won_usd',
] as const;
export type Stats = Record<(typeof STATS_KEYS)[number], number>;

const WEEK_MS = 7 * 86_400_000;

/**
 * The money open to win: over the open programs that are not investments, each one's `max_award_usd`
 * when set, else its `pool_usd` (a hackathon's prize pool), else 0, summed. An investment is not money
 * to win, so it counts nothing. Pure.
 */
export const openMoneyUsd = (rows: ProgramRow[]): number =>
  rows
    .filter((r) => categoryOf(r.file) !== 'investment')
    .reduce((sum, r) => sum + (r.file.max_award_usd ?? r.file.pool_usd ?? 0), 0);

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
    db<{ sent: string; sent_week: string; won: string; won_usd: string | null }[]>`
      SELECT count(*) FILTER (WHERE status = ANY(${SENT})) AS sent,
             count(*) FILTER (WHERE status = ANY(${SENT}) AND at >= ${week}) AS sent_week,
             count(*) FILTER (WHERE status = 'won') AS won,
             sum(amount_usd) FILTER (WHERE status = 'won') AS won_usd
      FROM applications`,
  ]);
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
