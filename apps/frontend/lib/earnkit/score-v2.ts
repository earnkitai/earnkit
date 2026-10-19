import type { CalibrationV2 } from './score-calibration';
import { isoWeekOf } from './weeks';

/**
 * Scoring and clarity (R1 to R3): the score out of 100 in two parts, from confirmed data only (the
 * caller passes only the one project's confirmed ships and commit weeks).
 * - Shipped (max 50): 10 per week with commits in the last 4 weeks, this week included (max 40),
 *   plus 5 per live ship: a live site, a contract deploy, a published package (max 10).
 * - Consistency (max 50): round(50 x weeks with commits in the last 12 weeks, this week included, / 12).
 * Weeks are ISO weeks (Monday to Sunday, UTC). Used and Earned are no longer part of the score; the
 * people and money a project has are still counted for its stored row (countUse). Pure.
 */
export const FORMULA_V2 = 'v2';
export const MAX_V2 = { shipped: 50, consistency: 50 } as const;
export const CODE_WEEK_POINTS = 10;
export const SHIPPED_WEEKS = 4;
export const LIVE_SHIP_POINTS = 5;
export const LIVE_SHIPS_MAX = 2;
export const CONSISTENCY_WEEKS = 12;
export const HALF_LIFE_DAYS = 90;
export const STAR_FORK_CAP = 5;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** One live ship; `key` names it once ('site:<host>', 'contract:<chain>:<address>', 'package:<kind>:<name>'). */
export type Ship = { key: string; kind: 'site' | 'contract' | 'package' };
export type ScoreInput = { ships: Ship[]; commitWeeks: string[] };
export type ScorePart = { points: number; raw: Record<string, number> };
/**
 * `shipped.raw`: code_weeks (of the last 4), live_ships (distinct, before the cap). `consistency.raw`:
 * weeks (of the last 12) and mask (bit i set: commits in the week i weeks before this one; bit 0 is
 * this week), which scoreWhy reads.
 */
export type ScoreParts = { shipped: ScorePart; consistency: ScorePart };
export type V2Scored = { score: number; parts: ScoreParts; shipped: number };

/** The 12-bit mask of the last 12 ISO weeks with commits (bit 0: the week of `now`). Pure. */
export function weekMask(commitWeeks: Iterable<string>, now: Date): number {
  const have = new Set(commitWeeks);
  let mask = 0;
  for (let i = 0; i < CONSISTENCY_WEEKS; i++) if (have.has(isoWeekOf(new Date(now.getTime() - i * WEEK_MS)))) mask |= 1 << i;
  return mask;
}
const bits = (m: number) => {
  let n = 0;
  for (let x = m; x; x &= x - 1) n++;
  return n;
};
const LAST4 = (1 << SHIPPED_WEEKS) - 1;
const LAST12 = (1 << CONSISTENCY_WEEKS) - 1;

/** Both parts from a week mask and the distinct live ships. Pure. */
export function partsOf(mask: number, liveShips: number): ScoreParts {
  const m = Number.isInteger(mask) ? mask & LAST12 : 0;
  const live = Number.isFinite(liveShips) && liveShips > 0 ? Math.floor(liveShips) : 0;
  const w4 = bits(m & LAST4);
  const w12 = bits(m);
  return {
    shipped: { points: CODE_WEEK_POINTS * w4 + LIVE_SHIP_POINTS * Math.min(LIVE_SHIPS_MAX, live), raw: { code_weeks: w4, live_ships: live } },
    consistency: { points: Math.round((MAX_V2.consistency * w12) / CONSISTENCY_WEEKS), raw: { weeks: w12, mask: m } },
  };
}
const total = (p: ScoreParts) => p.shipped.points + p.consistency.points;

export function computeScoreV2(i: ScoreInput, now: Date): V2Scored {
  const live = new Set(i.ships.map((s) => s.key)).size;
  const parts = partsOf(weekMask(i.commitWeeks, now), live);
  return { score: Math.min(100, Math.max(0, total(parts))), parts, shipped: live };
}

/**
 * The two parts of a stored `builder_live.parts` (jsonb), or null when it has none (an empty
 * placeholder, or a malformed row). A row stored by the old four-part formula still reads: its
 * `used` and `earned` keys are ignored, and without the two-part raw it reads as its points alone.
 */
export function storedParts(j: unknown): { shipped: number; consistency: number; mask: number | null; liveShips: number } | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, { points?: unknown; raw?: Record<string, unknown> } | undefined>;
  const pts = (k: 'shipped' | 'consistency') => (typeof o[k]?.points === 'number' && Number.isFinite(o[k]!.points) ? Math.round(o[k]!.points as number) : null);
  const s = pts('shipped');
  const c = pts('consistency');
  if (s === null || c === null) return null;
  const mask = o.consistency?.raw?.mask;
  const live = o.shipped?.raw?.live_ships;
  return {
    shipped: Math.max(0, Math.min(MAX_V2.shipped, s)),
    consistency: Math.max(0, Math.min(MAX_V2.consistency, c)),
    mask: typeof mask === 'number' && Number.isInteger(mask) && mask >= 0 ? mask & LAST12 : null,
    liveShips: typeof live === 'number' && Number.isFinite(live) && live > 0 ? Math.floor(live) : 0,
  };
}

const ships = (n: number) => `${n} live ${n === 1 ? 'ship' : 'ships'}`;
/**
 * R7: one plain sentence on why the score is what it is, and what raises it. With no commits this
 * week yet: what shipping code this week adds (Shipped's 10 plus the Consistency step). With commits
 * this week: what shipping code next week adds over not shipping (or that it keeps every point,
 * once next week can add nothing). Null for stored parts without the two-part raw (scoreWhy needs
 * the week mask). Pure.
 */
export function scoreWhy(parts: unknown): string | null {
  const p = storedParts(parts);
  if (!p || p.mask === null) return null;
  const { mask, liveShips } = p;
  const w4 = bits(mask & LAST4);
  const w12 = bits(mask);
  const live = liveShips > 0 ? ships(liveShips) : null;
  const why =
    w12 === 0 ? (live ? `${live}, but no code in the last 12 weeks.` : 'No code in the last 12 weeks.')
      : `${w4 === 0 ? `Code in ${w12} of the last 12 weeks, none in the last 4` : `Code in ${w4} of the last 4 weeks and ${w12} of the last 12`}${live ? `, plus ${live}` : ''}.`;
  const now = total(partsOf(mask, liveShips));
  if ((mask & 1) === 0) return `${why} Ship code this week to add up to ${total(partsOf(mask | 1, liveShips)) - now} points.`;
  // Next week's window drops its oldest week: shipping then adds what that week held back, or keeps it all.
  const over = total(partsOf(((mask << 1) & LAST12) | 1, liveShips)) - now;
  return over > 0 ? `${why} Ship code next week to add up to ${over} points.` : `${why} Ship code next week to keep all ${now} points.`;
}

// ---- People and money (not scored): the stored builder_projects.people and money_usd -------------

export type UseTouch = { project: string; actor: string; at: Date; weight: number; kind: 'caller' | 'tagged' | 'trader' | 'star' | 'fork' };
export type UseInput = {
  touches: UseTouch[];
  packages: { project: string; users: number; at: Date }[];
  earned: { project: string; usd: number; kind: 'coin_fees' | 'contract_fees' | 'prize' }[];
};
export type UseCounted = { U: number; people: number; packages: number; star_fork: number; E: number; perProject: Map<string, { people: number; usd: number }> };

const time = (d: Date | null | undefined): number => (d instanceof Date ? d.getTime() : NaN);
/** 1 for now, 0.5 at the half-life; 0 for an invalid date (an unreadable date counts nothing). */
export const fade = (at: Date, now: Date): number => {
  const a = time(at);
  const n = time(now);
  if (!Number.isFinite(a) || !Number.isFinite(n)) return 0;
  return 0.5 ** (Math.max(0, n - a) / DAY_MS / HALF_LIFE_DAYS);
};
const fin = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * The people and money a project has, as the old Used and Earned parts counted them (kept for the
 * stored project rows, never in the score): each account once per project (its best weight, faded
 * by its newest touch with a 90-day half-life), a real use winning over a star or fork by the same
 * account, stars and forks capped at STAR_FORK_CAP; USD unfaded. Pure.
 */
export function countUse(i: UseInput, cal: CalibrationV2, now: Date): UseCounted {
  const best = new Map<string, { w: number; kind: UseTouch['kind']; project: string }>();
  for (const t of i.touches) {
    const k = `${t.project}\u0000${t.actor.toLowerCase()}`;
    const w = fin(t.weight) * fade(t.at, now);
    const cur = best.get(k);
    const sf = t.kind === 'star' || t.kind === 'fork';
    const curSf = cur !== undefined && (cur.kind === 'star' || cur.kind === 'fork');
    if (!cur || (curSf && !sf) || (curSf === sf && cur.w < w)) best.set(k, { w, kind: t.kind, project: t.project });
  }
  let people = 0;
  let starFork = 0;
  const perProject = new Map<string, { people: number; usd: number }>();
  const bump = (p: string, n: number, usd: number) => {
    const x = perProject.get(p) ?? { people: 0, usd: 0 };
    perProject.set(p, { people: x.people + n, usd: x.usd + usd });
  };
  for (const { w, kind, project } of best.values()) {
    if (kind === 'star' || kind === 'fork') starFork += w;
    else {
      people += w;
      if (w > 0) bump(project, 1, 0);
    }
  }
  const pkg = i.packages.reduce((n, p) => {
    const u = Math.min(cal.package_users, fin(p.users)) * fade(p.at, now);
    if (u >= 1) bump(p.project, Math.floor(u), 0);
    return n + u;
  }, 0);
  const capped = Math.min(STAR_FORK_CAP, starFork);
  const E = i.earned.reduce((n, e) => {
    bump(e.project, 0, fin(e.usd));
    return n + fin(e.usd);
  }, 0);
  return { U: people + pkg + capped, people, packages: pkg, star_fork: capped, E, perProject };
}
