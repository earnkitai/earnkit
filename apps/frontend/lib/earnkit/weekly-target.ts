import { sql } from './db';
import { benchPool } from './person-score';
import { RANK_MIN_POOL } from './rank';
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
 * The one line (pure), the rank only: points never appear (v3.1 F4).
 * - this week done: "Done this week."
 * - no gain, a rank: "Ship code this week to hold #3."; no rank (outside the pool or under RANK_MIN_POOL): "Ship code this week."
 * - #1 (no one scores higher): "Ship code this week to hold #1."
 * - someone above: this week's points pass them: "Ship code this week to pass #2."; not enough (a tie is not a
 *   pass): "Ship code this week to move toward #2."
 * - no rank: "Ship code this week."
 * `voice: 'page'` is the public profile's line, read by visitors, so it states the fact instead of telling the
 * reader to ship: "Shipped this week." / "Code this week holds #1." / "passes #2." / "moves toward #2."; null when the
 * week adds nothing or there is no rank.
 */
export function weeklyTarget(t: TargetIn, voice?: 'reply'): string;
export function weeklyTarget(t: TargetIn, voice: 'reply' | 'page'): string | null;
export function weeklyTarget(t: TargetIn, voice: 'reply' | 'page' = 'reply'): string | null {
  const page = voice === 'page';
  const { gain } = t.gains;
  if (t.gains.active) return page ? 'Shipped this week.' : 'Done this week.';
  if (gain <= 0) {
    if (page) return null;
    return t.rank ? `Ship code this week to hold #${t.rank}.` : 'Ship code this week.';
  }
  if (t.rank === null) return page ? null : 'Ship code this week.';
  const move = rankMove(t, gain);
  const pageVerb = { hold: 'holds', pass: 'passes', 'move toward': 'moves toward' }[move.verb];
  return page ? `Code this week ${pageVerb} #${move.rank}.` : `Ship code this week to ${move.verb} #${move.rank}.`;
}

/** What this week's ship does to the rank: hold it (no one above), pass the one above, or move toward it. */
function rankMove(t: TargetIn, gain: number): { verb: 'hold' | 'pass' | 'move toward'; rank: number } {
  if (!t.above) return { verb: 'hold', rank: t.rank! };
  return { verb: t.score + gain > t.above.score ? 'pass' : 'move toward', rank: t.above.rank };
}

/**
 * Final fix I3: how many more points after this week's would pass the rank above (a tie is not a pass). Exported, unused by copy (v3.1 F4).
 */
export const shortOf = (score: number, gain: number, aboveScore: number) => aboveScore - (score + gain) + 1;

/**
 * The person's place in the leaderboard's pool and the builder just above (the lowest score above theirs: its score and rank), and
 * the pool's size (`total`, the person included). Null rank: not in the pool (held, hidden, not claimed). Throws on a database error.
 */
export async function poolPlace(builderId: number, o: { only?: number[] } = {}): Promise<{ score: number; rank: number | null; above: Above | null; total: number }> {
  const db = sql();
  const [me] = await db<{ score: number }[]>`SELECT x.score::int AS score FROM ${benchPool(o.only)} x WHERE x.builder_id = ${builderId}`;
  if (!me) return { score: 0, rank: null, above: null, total: 0 };
  const [r] = await db<{ rank: number; above_score: number | null; above_rank: number | null; total: number }[]>`
    WITH pool AS (SELECT x.builder_id, x.score::int AS score FROM ${benchPool(o.only)} x WHERE x.builder_id <> ${builderId}),
    up AS (SELECT min(score) AS score FROM pool WHERE score > ${me.score})
    SELECT (1 + (SELECT count(*) FROM pool WHERE score > ${me.score}))::int AS rank,
      up.score AS above_score, (1 + (SELECT count(*) FROM pool WHERE score > up.score))::int AS above_rank,
      (1 + (SELECT count(*) FROM pool))::int AS total
    FROM up`;
  const above = r.above_score === null ? null : { rank: r.above_rank!, score: r.above_score };
  return { score: me.score, rank: r.rank, above, total: r.total };
}

/**
 * Launch ready L6 (fix round 1): the weekly moment's line about the new week, from the same target, the rank only:
 * "This week starts at Shipping 50: ship code to pass #2." / "... to hold #1." / "... to move toward #2." / no rank:
 * "... ship code to climb." Null once this week has code or adds nothing (the moment then says nothing about it).
 * No question, no link. Pure.
 */
export function weekStartLine(t: TargetIn): string | null {
  const { active, gain } = t.gains;
  if (active || gain <= 0) return null;
  // Final fix M2: the new week's score is named, so the drop from last week reads as the new week, not a loss.
  const lead = `This week starts at Shipping ${t.score}: ship code`;
  if (t.rank === null) return `${lead} to climb.`;
  const move = rankMove(t, gain);
  return `${lead} to ${move.verb} #${move.rank}.`;
}

/**
 * The weekly target's inputs for a ranked builder (`parts`: builder_live.parts), or null when Shipping's raw is
 * missing or the pool read failed. v3.1 R14: under RANK_MIN_POOL ranked builders no rank is named (rank and above
 * null: "Ship code this week."). Never throws.
 */
export async function targetIn(builderId: number, parts: unknown, now: Date, o: { only?: number[] } = {}): Promise<TargetIn | null> {
  const gains = weekGains(parts, now);
  if (!gains) return null;
  try {
    const { total, ...place } = await poolPlace(builderId, o);
    return { gains, ...place, ...(total < RANK_MIN_POOL && { rank: null, above: null }) };
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
