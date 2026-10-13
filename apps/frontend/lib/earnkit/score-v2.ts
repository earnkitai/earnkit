import type { CalibrationV2 } from './score-calibration';

/**
 * v2.12.1 spec "Score": 0 to 100 in four parts, confirmed data only (the caller passes only
 * confirmed ships and use, already through anti-farming, the builder's own accounts excluded).
 * Shipped is front-loaded (the first ship is half of it) and keeps at least half its value
 * forever; Used and Consistency fade with a 90-day half-life; Earned does not fade. Ranked = at
 * least one confirmed ship. Stars and forks by other people count at most STAR_FORK_CAP toward
 * Used. Raw inputs are stored unscaled in each part's `raw`. Inputs come from untrusted readings:
 * an invalid date fades to 0 and a non-finite number counts as 0, so the score is never NaN. Pure.
 */
export const FORMULA_V2 = 'v2';
export const MAX_V2 = { shipped: 20, used: 40, earned: 20, consistency: 20 } as const;
export const HALF_LIFE_DAYS = 90;
export const STAR_FORK_CAP = 5;
const DAY_MS = 86_400_000;

export type Ship = { key: string; at: Date; alive_at: Date | null };
export type UseTouch = { project: string; actor: string; at: Date; weight: number; kind: 'caller' | 'tagged' | 'trader' | 'star' | 'fork' };
export type V2Input = {
  ships: Ship[];
  touches: UseTouch[];
  packages: { project: string; users: number; at: Date }[];
  earned: { project: string; usd: number; kind: 'coin_fees' | 'contract_fees' | 'prize' }[];
  weeks: { week: string; at: Date }[];
};
export type V2Part = { points: number; raw: Record<string, number> };
export type V2Parts = { shipped: V2Part; used: V2Part; earned: V2Part; consistency: V2Part };
export type V2Scored = { score: number; parts: V2Parts; ranked: boolean; shipped: number; perProject: Map<string, { people: number; usd: number }> };

const time = (d: Date | null | undefined): number => (d instanceof Date ? d.getTime() : NaN);
/** 1 for now, 0.5 at the half-life; 0 for an invalid date (an unreadable date earns nothing). */
export const fade = (at: Date, now: Date): number => {
  const a = time(at);
  const n = time(now);
  if (!Number.isFinite(a) || !Number.isFinite(n)) return 0;
  return 0.5 ** (Math.max(0, n - a) / DAY_MS / HALF_LIFE_DAYS);
};
const fin = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
const scaled = (max: number, x: number, bar: number) => (x <= 0 ? 0 : max * Math.min(1, Math.log10(1 + x) / Math.log10(1 + bar)));

export function computeScoreV2(i: V2Input, cal: CalibrationV2, now: Date): V2Scored {
  // Shipped: 20 x (1 - 0.5^S), kept at max(0.5, fade(newest day any ship was alive)).
  const S = new Set(i.ships.map((s) => s.key)).size;
  const alive = i.ships.reduce<number>((n, s) => {
    const t = time(s.alive_at ?? s.at);
    return Number.isFinite(t) ? Math.max(n, t) : n;
  }, 0);
  const keep = S === 0 ? 0 : Math.max(0.5, fade(new Date(alive), now));
  const shipped = MAX_V2.shipped * (1 - 0.5 ** S) * keep;

  // Used: each account once per project (its best weight, faded by its newest touch).
  const best = new Map<string, { w: number; kind: UseTouch['kind']; project: string }>();
  for (const t of i.touches) {
    const k = `${t.project}\u0000${t.actor.toLowerCase()}`;
    const w = fin(t.weight) * fade(t.at, now);
    if (!best.has(k) || best.get(k)!.w < w) best.set(k, { w, kind: t.kind, project: t.project });
  }
  let people = 0;
  let starFork = 0;
  const perProject = new Map<string, { people: number; usd: number }>();
  const bump = (p: string, people: number, usd: number) => {
    const x = perProject.get(p) ?? { people: 0, usd: 0 };
    perProject.set(p, { people: x.people + people, usd: x.usd + usd });
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
  const U = people + pkg + capped;

  // Earned: unfaded USD.
  const E = i.earned.reduce((n, e) => {
    bump(e.project, 0, fin(e.usd));
    return n + fin(e.usd);
  }, 0);

  // Consistency: distinct weeks, each faded by its age.
  const weekAt = new Map<string, Date>();
  for (const w of i.weeks) if (!weekAt.has(w.week) || weekAt.get(w.week)! < w.at) weekAt.set(w.week, w.at);
  const W = [...weekAt.values()].reduce((n, at) => n + fade(at, now), 0);

  const parts: V2Parts = {
    shipped: { points: shipped, raw: { S, keep } },
    used: { points: scaled(MAX_V2.used, U, cal.users), raw: { U, people, packages: pkg, star_fork: capped } },
    earned: { points: scaled(MAX_V2.earned, E, cal.money_usd), raw: { E } },
    consistency: { points: MAX_V2.consistency * Math.min(1, W / cal.weeks), raw: { W, weeks: weekAt.size } },
  };
  const sum = parts.shipped.points + parts.used.points + parts.earned.points + parts.consistency.points;
  return { score: Math.min(100, Math.max(0, Math.round(Number.isFinite(sum) ? sum : 0))), parts, ranked: S >= 1, shipped: S, perProject };
}
