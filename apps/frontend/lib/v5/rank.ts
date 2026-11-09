/**
 * Ordering of verdicts. Ready: fit first (not a long shot), then the larger award, then the
 * sooner deadline. Gaps: programs with a real change first, then rule-only ones (R18b); within each, fewest
 * gaps, then lowest effort, then the larger award. Pure.
 */
import { rulesOnly, type Effort, type Verdict } from './eligibility';
import type { ProgramRow } from './programs';

const EFFORT_RANK: Record<Effort, number> = { minutes: 0, hours: 1, days: 2, weeks: 3 };
type Programs = Map<string, ProgramRow>;

const award = (v: Verdict, m: Programs) => m.get(v.program_id)?.file.max_award_usd ?? null;
const endsAt = (v: Verdict, m: Programs) => {
  const e = m.get(v.program_id)?.file.ends_at;
  return e ? Date.parse(e) : Infinity;
};
const byAward = (a: Verdict, b: Verdict, m: Programs) => (award(b, m) ?? -1) - (award(a, m) ?? -1);
const effortOf = (v: Verdict) => Math.max(-1, ...v.gaps.map((g) => EFFORT_RANK[g.effort]));
const cmp = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

export function rankReady(v: Verdict[], programs: Programs): Verdict[] {
  return [...v].sort(
    (a, b) =>
      cmp(Number(a.long_shot !== null), Number(b.long_shot !== null)) ||
      byAward(a, b, programs) ||
      cmp(endsAt(a, programs), endsAt(b, programs)),
  );
}

export function rankGaps(v: Verdict[], programs: Programs): Verdict[] {
  return [...v].sort(
    (a, b) =>
      cmp(Number(rulesOnly(a.gaps)), Number(rulesOnly(b.gaps))) ||
      cmp(a.gaps.length, b.gaps.length) || cmp(effortOf(a), effortOf(b)) || byAward(a, b, programs),
  );
}

/**
 * The gap list shown (R18b): all of it when `all`; else the first `max` with at most one rule-only program, the
 * first-ranked one that is not in person (R18d), after the real changes (it takes the last slot when there are more
 * real changes). Input in rankGaps order. Pure.
 */
export function shownGapsOf(gapV: Verdict[], all: boolean, max: number, inPerson: (v: Verdict) => boolean): Verdict[] {
  if (all) return gapV;
  const real = gapV.filter((v) => !rulesOnly(v.gaps));
  const rule = gapV.find((v) => rulesOnly(v.gaps) && !inPerson(v));
  return rule ? [...real.slice(0, max - 1), rule] : real.slice(0, max);
}
