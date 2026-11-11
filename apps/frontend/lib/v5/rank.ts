/**
 * Ordering of verdicts. Ready: fit first (not a long shot), then the larger award (or pool), then the
 * sooner deadline. Gaps (L1c-3, v6.1.10): programs on the project's own chains first (the reported chain before the
 * read one), rule-free before rule-bearing; then chain-agnostic ones, rule-free before rule-bearing; then programs on
 * other chains (their deploys). Within each: real changes before rule-only ones (R18b); rule-only ones naming one of
 * the project's mainnet chains first, then chain-agnostic, then the rest (R18e); fewest gaps (real changes only for a
 * program with one: a rule is not a change, v6.1.8), then lowest effort, then the larger award; rule-only ones on the
 * project's chains that state no award put one naming the project's first reported chain first (v6.1.7), then keep
 * catalog (input) order. Pure.
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

/** Whether a gap program carries a rule to confirm, with or without a real change. Pure. */
const ruleBearing = (v: Verdict) => v.gaps.some((g) => g.kind === 'rule');
/** A keyword hit (N1, v6.1.12): a rule-bearing program whose rule keyword the project names. */
type Hit = (v: Verdict) => boolean;

/**
 * `mainnets`: the chains the project reported on mainnet (R18e); none puts chain-agnostic rule-only programs first.
 * `first`: the project's first reported chain, the tie-break among rule-only programs on its chains with no award.
 * `chains` (N-4, v6.1.9): the project's own chains, reported then read (with none given, its mainnets stand in); a
 * program on one of them ranks before every other, the earlier chain first, rule-free before rule-bearing (L1c-3,
 * v6.1.10); then chain-agnostic programs, rule-free before rule-bearing; a deploy on another chain comes last.
 * `hit` (N1, v6.1.12): a keyword hit ranks as a rule-free step does (own chain first, then real-gap count, effort,
 * money), never behind the rule-free ones for its rule.
 */
export function rankGaps(v: Verdict[], programs: Programs, mainnets: ReadonlySet<string> = new Set(), first?: string, chains: readonly string[] = [], hit: Hit = () => false): Verdict[] {
  const bears = (x: Verdict) => ruleBearing(x) && !hit(x);
  const only = (x: Verdict) => rulesOnly(x.gaps) && !hit(x);
  const firstTie = (a: Verdict, b: Verdict) =>
    rulesOnly(a.gaps) && rulesOnly(b.gaps) && reach(a, programs, mainnets) === 0 && award(a, programs) === null && award(b, programs) === null
      ? cmp(onFirst(a, programs, first), onFirst(b, programs, first))
      : 0;
  // L1c-3: [group, own chain's place, rule-bearing]; group 0 own chain, 1 chain-agnostic, 2 another chain.
  const own = (x: Verdict) => (chains.length > 0 ? ownChain(x, programs, chains) : reach(x, programs, mainnets) === 0 ? 0 : 1);
  const owned = chains.length > 0 ? chains.length : 1;
  const key = (x: Verdict): number[] => {
    const at = own(x);
    if (at < owned) return [0, at, Number(bears(x))];
    const f = programs.get(x.program_id)?.file;
    return f && (f.any_chain || f.chains.length === 0) ? [1, 0, Number(bears(x))] : [2, 0, 0];
  };
  const byKey = (a: Verdict, b: Verdict) => {
    const [ka, kb] = [key(a), key(b)];
    return cmp(ka[0], kb[0]) || cmp(ka[1], kb[1]) || cmp(ka[2], kb[2]);
  };
  return [...v].sort(
    (a, b) =>
      byKey(a, b) ||
      cmp(Number(only(a)), Number(only(b))) ||
      (only(a) && only(b) ? cmp(reach(a, programs, mainnets), reach(b, programs, mainnets)) : 0) ||
      cmp(changes(a).length, changes(b).length) || cmp(effortOf(changes(a)), effortOf(changes(b))) || byAward(a, b, programs) || firstTie(a, b),
  );
}

/**
 * L12-7 (v6.1.14): a deploy on another chain: the program names chains, takes no other chain, and names none of the
 * project's own `chains` (reported, then read); never one when the project has no chain. Pure.
 */
export const offChain = (v: Verdict, m: Programs, chains: readonly string[]): boolean => {
  const f = m.get(v.program_id)?.file;
  return chains.length > 0 && !!f && !f.any_chain && f.chains.length > 0 && !f.chains.some((c) => chains.includes(c));
};

/**
 * The gap list shown (R18b, v6.1.8 fix rounds 2 and 3, v6.1.9, v6.1.10): all of it when `all`. Else, first the
 * programs the builder acted on (`pinned`: a step marked done or a live claim, N-3), in rank order, whatever they
 * carry; then every program closing soon (`soon`, O1: within 7 days), ahead of the cap; then at most one program that
 * carries an unconfirmed rule and no keyword hit (a keyworded rule with no hit is `unlikely` and already left out:
 * L1e-2, v6.1.13) (none when one already shown carries one) among rule-free programs in
 * rank order for the other slots; a keyword hit (`hit`, N1, v6.1.12) is no rule-slot program but takes its own slot in
 * rank order as a rule-free one does. A program whose rule is unlikely to be the project's (`unlikely`, L1c-2: its keywords named nowhere)
 * is left out unless acted on. The one rule-bearing program is the first (in rank order) naming `chains[0]`, else
 * `chains[1]`, and so on (`names`: whether a program names a chain), else the first in rank order. On one of the
 * project's chains it takes its place in rank order (L1c-3). Off them it is shown only after `max - 1` other programs,
 * or alone as a list of one when nothing else is shown (N-2); with some others but fewer than that, the list is those
 * and leaves it to `filter.all`. In-person programs never appear here (R18d, R18f; a rule-only one is in the In person
 * block, find.ts); `filter.all` shows them and `more` counts every program left out. A deploy on another chain
 * (`offChain`, L12-7, v6.1.14) is left out too unless acted on, closing soon or not: `filter.all` shows it. Input in
 * rankGaps order. Pure.
 */
export function shownGapsOf(
  gapV: Verdict[], all: boolean, max: number, inPerson: (v: Verdict) => boolean,
  chains: readonly string[] = [], names: (v: Verdict, chain: string) => boolean = () => false,
  pinned: (v: Verdict) => boolean = () => false,
  o: { unlikely?: (v: Verdict) => boolean; soon?: (v: Verdict) => boolean; hit?: Hit; offChain?: (v: Verdict) => boolean } = {},
): Verdict[] {
  if (all) return gapV;
  const off = o.offChain ?? (() => false);
  const unlikely = (v: Verdict) => off(v) || (o.unlikely ?? (() => false))(v);
  const soon = o.soon ?? (() => false);
  const hit = o.hit ?? (() => false);
  // The one rule slot is for rule-bearing programs with no keyword hit; a hit competes as a rule-free step.
  const slotted = (v: Verdict) => ruleBearing(v) && !hit(v);
  const remote = gapV.filter((v) => !inPerson(v));
  const top = remote.filter(pinned).slice(0, max);
  const likely = remote.filter((v) => !pinned(v) && !unlikely(v));
  const head = [...top, ...likely.filter(soon)];
  const rest = likely.filter((v) => !soon(v));
  const room = max - head.length;
  if (room <= 0) return head;
  const free = rest.filter((v) => !slotted(v));
  // L1e-2 (v6.1.13): a rule still to confirm that carries keywords leaves the slot through `unlikely` (no hit: the full
  // list only) or competes as a step (a hit), so the no-hit slot holds rules with no keywords.
  const bearing = head.some(slotted) ? [] : rest.filter(slotted);
  const rule = chains.map((c) => bearing.find((v) => names(v, c))).find((v) => v !== undefined) ?? bearing[0];
  const own = rule !== undefined && chains.some((c) => names(rule, c));
  if (!rule || !(own || free.length >= room - 1 || (free.length === 0 && head.length === 0))) return [...head, ...free.slice(0, room)];
  const pick = new Set(own ? rest.filter((v) => v === rule || !slotted(v)).slice(0, room) : [...free.slice(0, room - 1), rule]);
  return [...head, ...rest.filter((v) => pick.has(v))];
}
