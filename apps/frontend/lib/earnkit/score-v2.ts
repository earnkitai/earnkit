import { isoWeekOf } from './weeks';

/**
 * Scoring and clarity (owner ruling 2026-10-19, replacing R1 to R3): one score, Shipping, 0 to 100,
 * from the one project's confirmed data only.
 *   Shipping = round(90 x sum(w_i x active_i) / sum(w_i)) + live bonus
 * where i = 0..11 is a week's age (0 = this ISO week, Monday to Sunday UTC), active_i = 1 when the
 * repo has commits that week, and w_i = 12 - i (recent weeks weigh more; the weights sum to 78). The
 * live bonus is 10 when any live ship exists (a live site, a contract deploy, a published package).
 * Used and Earned are no longer scored, and R16b stopped counting people and money at all. `parts` holds { shipping } and leaves room for a separate 0 to 100
 * { originality } a later change adds (never summed into Shipping). Pure.
 */
export const FORMULA_V2 = 'v2';
export const SHIPPING_MAX = 100;
export const CODE_MAX = 90;
export const LIVE_BONUS = 10;
export const SHIPPING_WEEKS = 12;
const WEIGHT_SUM = (SHIPPING_WEEKS * (SHIPPING_WEEKS + 1)) / 2; // 78
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** One live ship; `key` names it once ('site:<host>', 'contract:<chain>:<address>', 'package:<kind>:<name>'). */
export type Ship = { key: string; kind: 'site' | 'contract' | 'package' };
export type ScoreInput = { ships: Ship[]; commitWeeks: string[] };
export type ScorePart = { points: number; raw: Record<string, number> };
/**
 * `shipping.raw`: mask (bit i set: commits in the week i weeks before this one; bit 0 is this week),
 * monday (that week's Monday as whole days since the epoch, UTC), weeks (of the last 12), recent (of
 * the last 4), live_ships (distinct). scoreWhy reads them.
 * `originality`: reserved for a later, separate value.
 */
export type ScoreParts = { shipping: ScorePart; originality?: ScorePart };
export type V2Scored = { score: number; parts: ScoreParts; shipped: number };

const LAST12 = (1 << SHIPPING_WEEKS) - 1;
const LAST4 = 0b1111;
/** The 12-bit mask of the last 12 ISO weeks with commits (bit 0: the week of `now`). Pure. */
export function weekMask(commitWeeks: Iterable<string>, now: Date): number {
  const have = new Set(commitWeeks);
  let mask = 0;
  for (let i = 0; i < SHIPPING_WEEKS; i++) if (have.has(isoWeekOf(new Date(now.getTime() - i * WEEK_MS)))) mask |= 1 << i;
  return mask;
}
const bits = (m: number) => {
  let n = 0;
  for (let x = m; x; x &= x - 1) n++;
  return n;
};

/** Shipping from a week mask and the distinct live ships. Pure. */
export function shippingOf(mask: number, liveShips: number): number {
  const m = Number.isInteger(mask) ? mask & LAST12 : 0;
  let w = 0;
  for (let i = 0; i < SHIPPING_WEEKS; i++) if (m & (1 << i)) w += SHIPPING_WEEKS - i;
  return Math.min(SHIPPING_MAX, Math.round((CODE_MAX * w) / WEIGHT_SUM) + (liveShips > 0 ? LIVE_BONUS : 0));
}

/** The Monday of `now`'s ISO week, as whole days since the epoch (UTC). Pure. */
export const mondayDay = (now: Date): number => {
  const day = Math.floor(now.getTime() / DAY_MS);
  return day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);
};

export function computeScoreV2(i: ScoreInput, now: Date): V2Scored {
  const live = new Set(i.ships.map((s) => s.key)).size;
  const mask = weekMask(i.commitWeeks, now);
  const score = shippingOf(mask, live);
  const raw = { mask, monday: mondayDay(now), weeks: bits(mask), recent: bits(mask & LAST4), live_ships: live };
  return { score, parts: { shipping: { points: score, raw } }, shipped: live };
}

/**
 * Shipping as stored in `builder_live.parts` (jsonb), or null when the row has none (an empty
 * placeholder, a malformed row, or one from an older formula: its shipped, used, earned and
 * consistency keys are ignored).
 */
export function storedShipping(j: unknown): { points: number; mask: number; monday: number | null; liveShips: number } | null {
  if (!j || typeof j !== 'object') return null;
  const sh = (j as Record<string, unknown>).shipping as { points?: unknown; raw?: Record<string, unknown> } | undefined;
  const points = sh?.points;
  const mask = sh?.raw?.mask;
  if (typeof points !== 'number' || !Number.isFinite(points) || typeof mask !== 'number' || !Number.isInteger(mask) || mask < 0) return null;
  const live = sh?.raw?.live_ships;
  const monday = sh?.raw?.monday;
  return {
    points: Math.max(0, Math.min(SHIPPING_MAX, Math.round(points))),
    mask: mask & LAST12,
    monday: typeof monday === 'number' && Number.isInteger(monday) ? monday : null,
    liveShips: typeof live === 'number' && Number.isFinite(live) && live > 0 ? Math.floor(live) : 0,
  };
}

/**
 * One plain sentence on why Shipping is what it is, and what raises it: "Code in 7 of the last 12
 * weeks, 3 of the last 4. Ship code this week to add up to 14 points." The points are what an active
 * week adds by the formula: this week while it has no commits yet, else next week (over next week
 * without commits). A row scored in an earlier week is read as of `now`'s week (its mask shifted by the
 * weeks since), so "this week" is never last week's. Null for parts without Shipping's raw. Pure.
 */
export function scoreWhy(parts: unknown, now: Date): string | null {
  const p = storedShipping(parts);
  if (!p) return null;
  const gone = p.monday === null ? 0 : Math.max(0, Math.round((mondayDay(now) - p.monday) / 7));
  const mask = gone >= SHIPPING_WEEKS ? 0 : (p.mask << gone) & LAST12;
  const { liveShips } = p;
  const w12 = bits(mask);
  const why = w12 === 0 ? 'No code in the last 12 weeks.' : `Code in ${w12} of the last 12 weeks, ${bits(mask & LAST4)} of the last 4.`;
  if ((mask & 1) === 0) return `${why} Ship code this week to add up to ${shippingOf(mask | 1, liveShips) - shippingOf(mask, liveShips)} points.`;
  const next = (mask << 1) & LAST12;
  return `${why} Ship code next week to add up to ${shippingOf(next | 1, liveShips) - shippingOf(next, liveShips)} points.`;
}
