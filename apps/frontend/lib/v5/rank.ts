/**
 * Ordering of verdicts. Ready: fit first (not a long shot), then the larger award (or pool), then the
 * sooner deadline. Gaps: programs with a real change first, then rule-only ones (R18b); rule-only ones naming one
 * of the project's mainnet chains first, then chain-agnostic ones, then the rest (R18e); within each, fewest gaps (real
 * changes only for a program with one: a rule is not a change, v6.1.8), then
 * lowest effort, then the larger award; rule-only ones on the project's chains that state no award put one naming the
 * project's first reported chain first (v6.1.7), then keep catalog (input) order. Pure.
 */
import { rulesOnly, type Effort, type Gap, type Verdict } from './eligibility';
import type { ProgramRow } from './programs';

const EFFORT_RANK: Record<Effort, number> = { minutes: 0, hours: 1, days: 2, weeks: 3 };
type Programs = Map<string, ProgramRow>;

/** The money a program puts up (C60, v6.1.8): the larger of its top award and its pool, null when it states neither. */
const award = (v: Verdict, m: Programs) => {
  const f = m.get(v.program_id)?.file;
  const top = Math.max(f?.max_award_usd ?? -1, f?.pool_usd ?? -1);
  return top < 0 ? null : top;
};
const endsAt = (v: Verdict, m: Programs) => {
  const e = m.get(v.program_id)?.file.ends_at;
  return e ? Date.parse(e) : Infinity;
};
const byAward = (a: Verdict, b: Verdict, m: Programs) => (award(b, m) ?? -1) - (award(a, m) ?? -1);
const effortOf = (gaps: Gap[]) => Math.max(-1, ...gaps.map((g) => EFFORT_RANK[g.effort]));
/** The gaps a program is ranked by (fix round 1, v6.1.8): its real changes, since a rule is a yes, not a change; a
 *  rule-only program keeps its rules (ranked among rule-only programs as before). */
const changes = (v: Verdict): Gap[] => (rulesOnly(v.gaps) ? v.gaps : v.gaps.filter((g) => g.kind !== 'rule'));
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

/** 0 when the program's chains include `first` (the project's first reported chain), else 1. */
const onFirst = (v: Verdict, m: Programs, first: string | undefined) => (first && m.get(v.program_id)?.file.chains.includes(first) ? 0 : 1);

/**
 * `mainnets`: the chains the project reported on mainnet (R18e); none puts chain-agnostic rule-only programs first.
 * `first`: the project's first reported chain, the tie-break among rule-only programs on its chains with no award.
 */
export function rankGaps(v: Verdict[], programs: Programs, mainnets: ReadonlySet<string> = new Set(), first?: string): Verdict[] {
  const firstTie = (a: Verdict, b: Verdict) =>
    rulesOnly(a.gaps) && rulesOnly(b.gaps) && reach(a, programs, mainnets) === 0 && award(a, programs) === null && award(b, programs) === null
      ? cmp(onFirst(a, programs, first), onFirst(b, programs, first))
      : 0;
  return [...v].sort(
    (a, b) =>
      cmp(Number(rulesOnly(a.gaps)), Number(rulesOnly(b.gaps))) ||
      (rulesOnly(a.gaps) && rulesOnly(b.gaps) ? cmp(reach(a, programs, mainnets), reach(b, programs, mainnets)) : 0) ||
      cmp(changes(a).length, changes(b).length) || cmp(effortOf(changes(a)), effortOf(changes(b))) || byAward(a, b, programs) || firstTie(a, b),
  );
}

/** Whether a gap program carries a rule to confirm, with or without a real change. Pure. */
const ruleBearing = (v: Verdict) => v.gaps.some((g) => g.kind === 'rule');

/**
 * The gap list shown (R18b, v6.1.8 fix round 2): all of it when `all`; else at most one program that carries an
 * unconfirmed rule (a real change plus a rule, or rules only), the best-ranked one, in the last slot, and the other
 * slots filled by rule-free programs in rank order. A list with no rule-free programs shows the one rule-bearing
 * program alone. In-person programs never appear in the default list (R18d, R18f); `filter.all` shows them and
 * `more` counts every program left out. Input in rankGaps order. Pure.
 */
export function shownGapsOf(gapV: Verdict[], all: boolean, max: number, inPerson: (v: Verdict) => boolean): Verdict[] {
  if (all) return gapV;
  const remote = gapV.filter((v) => !inPerson(v));
  const free = remote.filter((v) => !ruleBearing(v));
  const rule = remote.find(ruleBearing);
  return rule ? [...free.slice(0, max - 1), rule] : free.slice(0, max);
}
