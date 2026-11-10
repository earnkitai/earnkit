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

/** N-4 (v6.1.9): the place in `chains` (the project's own: reported first, then read) of the first one the program
 *  names; `chains.length` when it names none. */
const ownChain = (v: Verdict, m: Programs, chains: readonly string[]) => {
  const named = m.get(v.program_id)?.file.chains ?? [];
  const i = chains.findIndex((c) => named.includes(c));
  return i < 0 ? chains.length : i;
};

/**
 * `mainnets`: the chains the project reported on mainnet (R18e); none puts chain-agnostic rule-only programs first.
 * `first`: the project's first reported chain, the tie-break among rule-only programs on its chains with no award.
 * `chains` (N-4, v6.1.9): the project's own chains, reported then read; a program on one of them ranks before every
 * other, the earlier chain first, so a deploy on another chain comes after every same-chain program.
 */
export function rankGaps(v: Verdict[], programs: Programs, mainnets: ReadonlySet<string> = new Set(), first?: string, chains: readonly string[] = []): Verdict[] {
  const firstTie = (a: Verdict, b: Verdict) =>
    rulesOnly(a.gaps) && rulesOnly(b.gaps) && reach(a, programs, mainnets) === 0 && award(a, programs) === null && award(b, programs) === null
      ? cmp(onFirst(a, programs, first), onFirst(b, programs, first))
      : 0;
  return [...v].sort(
    (a, b) =>
      cmp(ownChain(a, programs, chains), ownChain(b, programs, chains)) ||
      cmp(Number(rulesOnly(a.gaps)), Number(rulesOnly(b.gaps))) ||
      (rulesOnly(a.gaps) && rulesOnly(b.gaps) ? cmp(reach(a, programs, mainnets), reach(b, programs, mainnets)) : 0) ||
      cmp(changes(a).length, changes(b).length) || cmp(effortOf(changes(a)), effortOf(changes(b))) || byAward(a, b, programs) || firstTie(a, b),
  );
}

/** Whether a gap program carries a rule to confirm, with or without a real change. Pure. */
const ruleBearing = (v: Verdict) => v.gaps.some((g) => g.kind === 'rule');

/**
 * The gap list shown (R18b, v6.1.8 fix rounds 2 and 3, v6.1.9): all of it when `all`. Else, first the programs the
 * builder acted on (`pinned`: a step marked done or a live claim, N-3), in rank order, whatever they carry; then at
 * most one program that carries an unconfirmed rule (a real change plus a rule, or rules only; none when a pinned one
 * carries one), and rule-free programs in rank order (N-4's own-chain-first order) for the other slots. That one
 * program is the first rule-bearing program (in rank order) naming `chains[0]`, else `chains[1]`, and so on (`names`:
 * whether a program names a chain), else the first in rank order. It takes only the last slot (N-2, which beats N-4
 * for a rule-bearing program): after `max - 1` rule-free programs, or alone as a list of one when nothing else is
 * shown; with some rule-free programs but fewer than the slots before it, the list is those and leaves it to
 * `filter.all`. In-person programs never appear in the default list (R18d, R18f); `filter.all` shows them and `more`
 * counts every program left out. Input in rankGaps order. Pure.
 */
export function shownGapsOf(
  gapV: Verdict[], all: boolean, max: number, inPerson: (v: Verdict) => boolean,
  chains: readonly string[] = [], names: (v: Verdict, chain: string) => boolean = () => false,
  pinned: (v: Verdict) => boolean = () => false,
): Verdict[] {
  if (all) return gapV;
  const remote = gapV.filter((v) => !inPerson(v));
  const top = remote.filter(pinned).slice(0, max);
  const rest = remote.filter((v) => !pinned(v));
  const room = max - top.length;
  if (room <= 0) return top;
  const free = rest.filter((v) => !ruleBearing(v));
  const bearing = top.some(ruleBearing) ? [] : rest.filter(ruleBearing);
  const rule = chains.map((c) => bearing.find((v) => names(v, c))).find((v) => v !== undefined) ?? bearing[0];
  const last = rule && (free.length >= room - 1 || (free.length === 0 && top.length === 0));
  return [...top, ...(last ? [...free.slice(0, room - 1), rule] : free.slice(0, room))];
}
