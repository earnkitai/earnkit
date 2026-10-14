import './env.mts';
import { parseArgs } from 'node:util';
import { sql } from '../lib/earnkit/db';
import { FREE_LIMITS, type Provider } from '../lib/earnkit/read-usage';

/**
 * v2.12.1 weekly metric (spec 3b, "Scale", acceptance test). Shown, never a target. Owner-run only,
 * never from predeploy or the cron; read-only (one READ ONLY transaction):
 *
 *   pnpm exec tsx apps/frontend/scripts/v2121-metric.mts [--as-of <ISO time>] [--days 7]
 *
 * - Coin offers, per ISO week in the window: shown (coin_offered events), accepted (coin_answered
 *   events whose detail.answer is yes) and launched (entries with a launched token that a coin moment
 *   names: the coin program's own entry, or the build path's entry its built_live yes recorded).
 *   builder_events has rows only while EARNKIT_EVENT_LOG=on, so shown and accepted read 0 before that.
 * - Reads per day, per source, against each free limit (read-usage.ts FREE_LIMITS).
 * - Claimed pages: claimed in the window, and in total.
 * - Leaderboard: the real builders on it (ranked, claimed, not hidden, not held), against the goal of
 *   20 the spec reports it with. Shown, not a target.
 */
const { values } = parseArgs({ options: { 'as-of': { type: 'string' }, days: { type: 'string' } } });
const asOf = values['as-of'] ? new Date(values['as-of']) : new Date();
const days = Number(values.days ?? 7);
if (Number.isNaN(asOf.getTime()) || !Number.isInteger(days) || days < 1) {
  console.error('Usage: v2121-metric.mts [--as-of <ISO time>] [--days <n>]');
  process.exit(2);
}
const since = new Date(asOf.getTime() - days * 86_400_000);
const LEADERBOARD_GOAL = 20;
const week = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'IYYY-"W"IW')`;

const db = sql();
try {
  const out = await db.begin('read only', async (tx) => {
    const coins = await tx<{ week: string; shown: number; accepted: number; launched: number }[]>`
      WITH shown AS (
        SELECT ${tx.unsafe(week('at'))} AS week, count(*)::int AS n FROM builder_events
        WHERE type = 'coin_offered' AND at > ${since} AND at <= ${asOf} GROUP BY 1),
      accepted AS (
        SELECT ${tx.unsafe(week('at'))} AS week, count(*)::int AS n FROM builder_events
        WHERE type = 'coin_answered' AND detail->>'answer' = 'yes' AND at > ${since} AND at <= ${asOf} GROUP BY 1),
      launched AS (
        SELECT ${tx.unsafe(week('p.coin_launched_at'))} AS week, count(DISTINCT p.id)::int AS n
        FROM projects p JOIN coin_moments m ON m.project_id = p.id
        WHERE p.token_status = 'launched' AND p.coin_launched_at > ${since} AND p.coin_launched_at <= ${asOf} GROUP BY 1),
      weeks AS (SELECT week FROM shown UNION SELECT week FROM accepted UNION SELECT week FROM launched)
      SELECT w.week, COALESCE(s.n, 0) AS shown, COALESCE(a.n, 0) AS accepted, COALESCE(l.n, 0) AS launched
      FROM weeks w LEFT JOIN shown s USING (week) LEFT JOIN accepted a USING (week) LEFT JOIN launched l USING (week)
      ORDER BY w.week`;
    const reads = await tx<{ day: string; provider: string; reads: number }[]>`
      SELECT day::text AS day, provider, reads FROM read_usage
      WHERE day > (${since}::timestamptz AT TIME ZONE 'UTC')::date AND day <= (${asOf}::timestamptz AT TIME ZONE 'UTC')::date
      ORDER BY day, provider`;
    const [claims] = await tx<{ window: number; total: number }[]>`
      SELECT count(*) FILTER (WHERE claimed_at > ${since} AND claimed_at <= ${asOf})::int AS window,
        count(*) FILTER (WHERE claimed_at <= ${asOf})::int AS total
      FROM builder_profiles WHERE claimed_at IS NOT NULL`;
    const [board] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM builder_live l JOIN builder_profiles p ON p.builder_id = l.builder_id
      WHERE l.ranked AND p.x_user_id IS NOT NULL AND NOT p.hidden AND NOT p.held`;
    return { coins, reads, claims, board };
  });
  console.log(`v2.12.1 metric, ${since.toISOString()} to ${asOf.toISOString()}. Shown, never a target.`);
  console.log('');
  console.log('Coin offers (per ISO week)');
  if (out.coins.length === 0) console.log('Coin offers: shown 0, accepted 0, launched 0');
  for (const c of out.coins) console.log(`${c.week} Coin offers: shown ${c.shown}, accepted ${c.accepted}, launched ${c.launched}`);
  console.log('');
  console.log('Reads per day (against each free limit)');
  if (out.reads.length === 0) console.log('No reads in the window.');
  for (const r of out.reads) {
    const limit = FREE_LIMITS[r.provider as Provider]?.perDay ?? null;
    const of = limit ? `${((100 * r.reads) / limit).toFixed(2)}% of ${limit.toLocaleString('en-US')}` : 'no published limit';
    console.log(`${r.day} ${r.provider}: ${r.reads} (${of})`);
  }
  console.log('');
  console.log(`Claimed pages: ${out.claims.window} in the window, ${out.claims.total} in total`);
  console.log(`Leaderboard: ${out.board.n} real builders (goal ${LEADERBOARD_GOAL}, shown, not a target)`);
} finally {
  await db.end();
}
