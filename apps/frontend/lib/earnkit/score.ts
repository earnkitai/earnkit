import type { Calibration } from './score-calibration';

/**
 * v2.12 spec 4: the builder score, formula v1. Absolute 0 to 100 within a calibration: it does not
 * move when others join (the percentile does). Inputs are already through anti-farming
 * (anti-farming.ts), per project (one project_key). Commits alone score 0: consistency counts only
 * on projects with an outside user, and is 0 with no outcome anywhere. Pure.
 */
export const FORMULA = 'v1';
export const MAX = { users: 45, money: 20, staying: 15, recency: 10, consistency: 10 } as const;
const HALF_LIFE_DAYS = 90;
const DAY_MS = 86_400_000;

export type Outcome = { at: Date; weight: number };
export type ProjectInput = {
  key: string;
  /** What the project is called on the profile (repo name, site host, package name). */
  title: string;
  /** U for this project after anti-farming (weighted outside users, PR credit, downloads/50). */
  users: number;
  /** M for this project: verified fees + 0.01 x volume, USD, last 365 days, after the fee cap. */
  money_usd: number;
  /** Dated outcomes (a counted user, a day of money), each with its weight, for recency. */
  outcomes: Outcome[];
  first_outcome_at: Date | null;
  /** The last day the project was seen live or used. */
  last_used_at: Date | null;
  /** ISO weeks (YYYY-Www) with commits in the last 52, own non-fork non-template repos only. */
  commit_weeks: string[];
};
export type Part = { points: number; raw: Record<string, number> };
export type Parts = { users: Part; money: Part; staying: Part; recency: Part; consistency: Part };
export type Scored = { score: number; parts: Parts; top: ProjectInput | null };

const scaled = (max: number, x: number, bar: number) => (x <= 0 ? 0 : max * Math.min(1, Math.log10(1 + x) / Math.log10(1 + bar)));
const strength = (p: ProjectInput) => p.users + p.money_usd / 10;

export function computeScore(projects: ProjectInput[], cal: Calibration, now: Date): Scored {
  const U = projects.reduce((n, p) => n + Math.max(0, p.users), 0);
  const M = projects.reduce((n, p) => n + Math.max(0, p.money_usd), 0);
  const withOutcome = projects.filter((p) => p.users > 0 || p.money_usd > 0);
  const top = withOutcome.length === 0 ? null : [...withOutcome].sort((a, b) => strength(b) - strength(a) || a.key.localeCompare(b.key))[0];

  // Staying power: best project counts double.
  let num = 0;
  let den = 0;
  for (const p of withOutcome) {
    const w = p === top ? 2 : 1;
    const stayed = p.first_outcome_at && p.last_used_at && (p.last_used_at.getTime() - p.first_outcome_at.getTime()) / DAY_MS >= cal.staying_days;
    num += stayed ? w : 0;
    den += w;
  }
  const share = den === 0 ? 0 : num / den;

  // Recency: 90-day half-life.
  let recent = 0;
  let all = 0;
  for (const p of withOutcome)
    for (const o of p.outcomes) {
      const age = Math.max(0, (now.getTime() - o.at.getTime()) / DAY_MS);
      recent += o.weight * 0.5 ** (age / HALF_LIFE_DAYS);
      all += o.weight;
    }

  // Consistency: union of commit weeks on projects with an outside user.
  const weeks = new Set(projects.filter((p) => p.users > 0).flatMap((p) => p.commit_weeks)).size;

  const parts: Parts = {
    users: { points: scaled(MAX.users, U, cal.users), raw: { U } },
    money: { points: scaled(MAX.money, M, cal.money_usd), raw: { M } },
    staying: { points: MAX.staying * share, raw: { stayed: num, weighted: den } },
    recency: { points: all === 0 ? 0 : MAX.recency * Math.min(1, recent / Math.max(1, all)), raw: { recent, all } },
    consistency: { points: top === null ? 0 : MAX.consistency * Math.min(1, weeks / cal.weeks), raw: { weeks } },
  };
  const sum = Object.values(parts).reduce((n, p) => n + p.points, 0);
  return { score: Math.min(100, Math.round(sum)), parts, top };
}

/** Share (0 to 100) of `all` strictly below `score`. Pure. */
export function percentileOf(score: number, all: readonly number[]): number {
  if (all.length === 0) return 0;
  return (100 * all.filter((s) => s < score).length) / all.length;
}

/** "Top N%": N = max(1, ceil(100 - percentile)). Pure. */
export const topPercent = (percentile: number): number => Math.max(1, Math.ceil(100 - percentile));

/** Points moved per part since `before` (null: all of now). Pure. */
export function partDeltas(now: Parts, before: Parts | null): Record<keyof Parts, number> {
  const keys = Object.keys(now) as (keyof Parts)[];
  return Object.fromEntries(keys.map((k) => [k, now[k].points - (before?.[k]?.points ?? 0)])) as Record<keyof Parts, number>;
}
