/**
 * Ordering of verdicts. Ready: fit first (not a long shot), then the larger award, then the
 * sooner deadline. Gaps: programs with a real change first, then rule-only ones (R18b); rule-only ones naming one
 * of the project's mainnet chains first, then chain-agnostic ones, then the rest (R18e); within each, fewest gaps, then
 * lowest effort, then the larger award. Pure.
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
/** R18e: 0 names one of the project's mainnet chains, 1 chain-agnostic, 2 the rest. */
const reach = (v: Verdict, m: Programs, mainnets: ReadonlySet<string>) => {
  const f = m.get(v.program_id)?.file;
  if (!f) return 2;
  return f.chains.some((c) => mainnets.has(c)) ? 0 : f.any_chain ? 1 : 2;
};

export function rankReady(v: Verdict[], programs: Programs): Verdict[] {
  return [...v].sort(
    (a, b) =>
      cmp(Number(a.long_shot !== null), Number(b.long_shot !== null)) ||
      byAward(a, b, programs) ||
      cmp(endsAt(a, programs), endsAt(b, programs)),
  );
}

/** `mainnets`: the chains the project reported on mainnet (R18e); none puts chain-agnostic rule-only programs first. */
export function rankGaps(v: Verdict[], programs: Programs, mainnets: ReadonlySet<string> = new Set()): Verdict[] {
  return [...v].sort(
    (a, b) =>
      cmp(Number(rulesOnly(a.gaps)), Number(rulesOnly(b.gaps))) ||
      (rulesOnly(a.gaps) && rulesOnly(b.gaps) ? cmp(reach(a, programs, mainnets), reach(b, programs, mainnets)) : 0) ||
      cmp(a.gaps.length, b.gaps.length) || cmp(effortOf(a), effortOf(b)) || byAward(a, b, programs),
  );
}

/**
 * The gap list shown (R18b): all of it when `all`; else the first `max` with at most one rule-only program, the
 * first-ranked one, after the real changes (it takes the last slot when there are more real changes). In-person
 * programs never appear in the default list (R18d, R18f); `filter.all` shows them and `more` counts them. Input in
 * rankGaps order. Pure.
 */
export function shownGapsOf(gapV: Verdict[], all: boolean, max: number, inPerson: (v: Verdict) => boolean): Verdict[] {
  if (all) return gapV;
  const remote = gapV.filter((v) => !inPerson(v));
  const real = remote.filter((v) => !rulesOnly(v.gaps));
  const rule = remote.find((v) => rulesOnly(v.gaps));
  return rule ? [...real.slice(0, max - 1), rule] : real.slice(0, max);
}
