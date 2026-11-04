/**
 * Ordering of verdicts. Ready: fit first (not a long shot), then the larger award, then the
 * sooner deadline. Gaps: fewest gaps, then lowest effort, then the larger award. Pure.
 */
import type { Effort, Verdict } from './eligibility';
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
  return [...v].sort((a, b) => cmp(a.gaps.length, b.gaps.length) || cmp(effortOf(a), effortOf(b)) || byAward(a, b, programs));
}
