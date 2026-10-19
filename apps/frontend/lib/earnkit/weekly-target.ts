import { sql } from './db';
import { benchPool } from './person-score';
import { weekGains, type WeekGains } from './score-v2';

/**
 * Launch ready L5: one weekly target, the ranked builder's one next step. The score counts active weeks, so the
 * target is this week's ship, from the Shipping math (score-v2.ts weekGains) and the next rank up in the
 * leaderboard's pool (benchPool). Only the rank is named, never another builder: their X name is text they control,
 * so it never reaches an MCP reply (prompt injection) or the public page.
 */
export type Above = {
  /** That builder's rank (1 + those scoring higher; ties share a number). */
  rank: number;
  score: number;
};
export type TargetIn = { gains: WeekGains; score: number; rank: number | null; above: Above | null };

/**
 * The one line (pure):
 * - this week done: "Done this week: +14 points. Next week adds up to 13 more."
 * - #1 (no one scores higher): "Ship code this week: +14 points to hold #1."
 * - someone above, and this week's points pass them: "Ship code this week: +14 points, enough to pass #2."; not
 *   enough (a tie is not a pass): "Ship code this week: +14 points, 20 behind #2."
 * - outside the pool (no rank shown): "Ship code this week: +14 points."
 * A week that adds nothing (never under today's weights, kept total): "Ship code this week to hold #3." /
 * "Done this week. Next week adds up to 13 more."
 * Launch ready L10 (L7): `voice: 'page'` is the public profile's line, read by visitors, so it states the math
 * instead of telling the reader to ship: "Code this week adds +14 points, enough to pass #2." / "Shipped this week:
 * +14 points. Next week adds up to 13 more."; null when the week adds nothing.
 */
export function weeklyTarget(t: TargetIn, voice?: 'reply'): string;
export function weeklyTarget(t: TargetIn, voice: 'reply' | 'page'): string | null;
export function weeklyTarget(t: TargetIn, voice: 'reply' | 'page' = 'reply'): string | null {
  const { gain, next } = t.gains;
  if (t.gains.active) {
    const head = voice === 'page' ? 'Shipped this week' : 'Done this week';
    const done = gain > 0 ? `${head}: +${gain} points.` : `${head}.`;
    return next > 0 ? `${done} Next week adds up to ${next} more.` : done;
  }
  if (gain <= 0) {
    if (voice === 'page') return null;
    return t.rank ? `Ship code this week to hold #${t.rank}.` : 'Ship code this week.';
  }
  const lead = voice === 'page' ? `Code this week adds +${gain} points` : `Ship code this week: +${gain} points`;
  if (t.rank === null) return `${lead}.`;
  if (!t.above) return `${lead} to hold #${t.rank}.`;
  const { above } = t;
  if (t.score + gain > above.score) return `${lead}, enough to pass #${above.rank}.`;
  return `${lead}, ${above.score - t.score} behind #${above.rank}.`;
}

/**
 * The person's place in the leaderboard's pool and the builder just above (the lowest score above theirs: its score and rank). Null rank: not in the pool (held, hidden, not claimed). Throws on a database error.
 */
export async function poolPlace(builderId: number, o: { only?: number[] } = {}): Promise<{ score: number; rank: number | null; above: Above | null }> {
  const db = sql();
  const [me] = await db<{ score: number }[]>`SELECT x.score::int AS score FROM ${benchPool(o.only)} x WHERE x.builder_id = ${builderId}`;
  if (!me) return { score: 0, rank: null, above: null };
  const [r] = await db<{ rank: number; above_score: number | null; above_rank: number | null }[]>`
    WITH pool AS (SELECT x.builder_id, x.score::int AS score FROM ${benchPool(o.only)} x WHERE x.builder_id <> ${builderId}),
    up AS (SELECT min(score) AS score FROM pool WHERE score > ${me.score})
    SELECT (1 + (SELECT count(*) FROM pool WHERE score > ${me.score}))::int AS rank,
      up.score AS above_score, (1 + (SELECT count(*) FROM pool WHERE score > up.score))::int AS above_rank
    FROM up`;
  const above = r.above_score === null ? null : { rank: r.above_rank!, score: r.above_score };
  return { score: me.score, rank: r.rank, above };
}

/**
 * Launch ready L6 (fix round 1): the weekly moment's line about the new week, from the same target: "This week starts
 * empty: ship code to add +14 points, enough to pass #2." / "... to hold #1." / "..., 20 behind #2.". Null once this
 * week has code or adds nothing (the moment then says nothing about it). No question, no link. Pure.
 */
export function weekStartLine(t: TargetIn): string | null {
  const { active, gain } = t.gains;
  if (active || gain <= 0) return null;
  const lead = `This week starts empty: ship code to add +${gain} points`;
  if (t.rank === null) return `${lead}.`;
  if (!t.above) return `${lead} to hold #${t.rank}.`;
  if (t.score + gain > t.above.score) return `${lead}, enough to pass #${t.above.rank}.`;
  return `${lead}, ${t.above.score - t.score} behind #${t.above.rank}.`;
}

/**
 * The weekly target's inputs for a ranked builder (`parts`: builder_live.parts), or null when Shipping's raw is
 * missing or the pool read failed. Never throws.
 */
export async function targetIn(builderId: number, parts: unknown, now: Date, o: { only?: number[] } = {}): Promise<TargetIn | null> {
  const gains = weekGains(parts, now);
  if (!gains) return null;
  try {
    return { gains, ...(await poolPlace(builderId, o)) };
  } catch (err) {
    console.error('[target] place', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * The weekly target line, or null (the caller keeps its plain step). The same math in replies and on the public
 * page (`voice: 'page'`, said to a visitor). Never throws.
 */
export async function targetFor(builderId: number, parts: unknown, now: Date, o: { only?: number[]; voice?: 'reply' | 'page' } = {}): Promise<string | null> {
  const t = await targetIn(builderId, parts, now, o);
  return t ? weeklyTarget(t, o.voice ?? 'reply') : null;
}
