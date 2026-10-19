import { sql } from './db';
import { benchPool } from './person-score';
import { displayName } from './page-data';
import { weekGains, type WeekGains } from './score-v2';

/**
 * Launch ready L5: one weekly target, the ranked builder's one next step. The score counts active weeks, so the
 * target is this week's ship, from the Shipping math (score-v2.ts weekGains) and the next rank up in the
 * leaderboard's pool (benchPool). Replies name the builder above; the public profile names only the rank.
 */
export type Above = {
  /** That builder's rank (1 + those scoring higher; ties share a number). */
  rank: number;
  score: number;
  /** Their display name (page-data displayName); null on the public page (never another builder's name there). */
  name: string | null;
};
export type TargetIn = { gains: WeekGains; score: number; rank: number | null; above: Above | null };

/**
 * The one line (pure):
 * - this week done: "Done this week: +14. Next week adds up to 13."
 * - #1 (no one scores higher): "Ship code this week: +14 points to hold #1."
 * - someone above, and this week's points pass them: "Ship code this week: +14 points, enough to pass Ana for #2."
 *   (public: "... enough to reach #2."); not enough (a tie is not a pass): "Ship code this week: +14 points, 20 behind #2."
 * - outside the pool (no rank shown): "Ship code this week: +14 points."
 * A week that adds nothing (never under today's weights, kept total): "Ship code this week to hold #3." /
 * "Done this week. Next week adds up to 13."
 */
export function weeklyTarget(t: TargetIn): string {
  const { gain, next } = t.gains;
  if (t.gains.active) {
    const done = gain > 0 ? `Done this week: +${gain}.` : 'Done this week.';
    return next > 0 ? `${done} Next week adds up to ${next}.` : done;
  }
  if (gain <= 0) return t.rank ? `Ship code this week to hold #${t.rank}.` : 'Ship code this week.';
  const lead = `Ship code this week: +${gain} points`;
  if (t.rank === null) return `${lead}.`;
  if (!t.above) return `${lead} to hold #${t.rank}.`;
  const { above } = t;
  if (t.score + gain > above.score) return above.name ? `${lead}, enough to pass ${above.name} for #${above.rank}.` : `${lead}, enough to reach #${above.rank}.`;
  return `${lead}, ${above.score - t.score} behind #${above.rank}.`;
}

/**
 * The person's place in the leaderboard's pool and the builder just above (the lowest score above theirs; among a
 * tie there, the first handle). Null rank: not in the pool (held, hidden, not claimed). Throws on a database error.
 */
export async function poolPlace(builderId: number, o: { names: boolean; only?: number[] }): Promise<{ score: number; rank: number | null; above: Above | null }> {
  const db = sql();
  const [me] = await db<{ score: number }[]>`SELECT x.score::int AS score FROM ${benchPool(o.only)} x WHERE x.builder_id = ${builderId}`;
  if (!me) return { score: 0, rank: null, above: null };
  const [r] = await db<{ rank: number; above_score: number | null; above_rank: number | null; x_name: string | null; x_handle: string | null }[]>`
    WITH pool AS (SELECT x.builder_id, x.score::int AS score FROM ${benchPool(o.only)} x WHERE x.builder_id <> ${builderId}),
    up AS (
      SELECT pool.score, p.x_name, p.x_handle FROM pool JOIN builder_profiles p USING (builder_id)
      WHERE pool.score > ${me.score} ORDER BY pool.score ASC, p.x_handle ASC LIMIT 1
    )
    SELECT (1 + (SELECT count(*) FROM pool WHERE score > ${me.score}))::int AS rank,
      up.score AS above_score, (1 + (SELECT count(*) FROM pool WHERE score > up.score))::int AS above_rank, up.x_name, up.x_handle
    FROM (SELECT 1) one LEFT JOIN up ON true`;
  const above = r.above_score === null || r.above_rank === null
    ? null
    : { rank: r.above_rank, score: r.above_score, name: o.names && r.x_handle ? displayName(r.x_name, r.x_handle) : null };
  return { score: me.score, rank: r.rank, above };
}

/**
 * The weekly target for a ranked builder (`parts`: builder_live.parts), or null when Shipping's raw is missing
 * (the caller keeps its plain step). `names`: false on the public page. Never throws (a failed read is null).
 */
export async function targetFor(builderId: number, parts: unknown, now: Date, o: { names: boolean; only?: number[] }): Promise<string | null> {
  const gains = weekGains(parts, now);
  if (!gains) return null;
  try {
    const place = await poolPlace(builderId, o);
    return weeklyTarget({ gains, ...place });
  } catch (err) {
    console.error('[target] place', err instanceof Error ? err.name : 'error');
    return null;
  }
}
