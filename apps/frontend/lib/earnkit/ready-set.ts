import { INVESTOR_WINDOW_MS, NOW_WINDOW_MS, type MoveCtx, type MoveProgram } from './conversation';
import { usdCompact } from './pool';

/*
 * v4.10 Task 2 (R2, R3): the ready set. Instead of leading with one program (conversation.ts bestMove, which this file
 * never changes), a session start picks up to READY_MAX programs to draft together and says what they are worth.
 */
/** At most this many programs in the ready set. */
export const READY_MAX = 3;
/**
 * v4.10.2 Task 1 (R1, owner answer 1): at most this many answers only the builder can give across the whole set, so the
 * set fits one short reply.
 */
export const READY_ANSWERS_MAX = 4;
/** v4.10.2 Task 1: how many ranked programs find drafts to fill the set from (readySet's `max` there). */
export const READY_CANDIDATES = 6;
/**
 * One program of the ready set. `kind` is why it is in it: a real fit, a grant one step away (`step` 'codes': the agent
 * adds Builder Codes), an investor program closing within INVESTOR_WINDOW_MS, or a long shot. `why` is a long shot's
 * reason (the fit cell's, "they look for apps on Arc"); `needs` what only the builder can give, a short phrase ("your
 * team list": ready-copy.ts needsPhrase), null here and filled by find (v4.10 Task 4, decision f).
 */
export type ReadyProgram = {
  id: string; title: string; amount: string | null; max_usd: number | null;
  kind: 'fit' | 'one_step' | 'investor' | 'long_shot';
  why: string | null; ends_at: string | null; zone: string; step: 'codes' | null; needs: string | null;
};
const KIND_ORDER: Record<ReadyProgram['kind'], number> = { fit: 0, one_step: 1, investor: 2, long_shot: 3 };
const closeAt = (p: { ends_at: string | null }) => (p.ends_at ? Date.parse(p.ends_at) : Infinity);

/**
 * The programs to draft together, at most READY_MAX (R2): real fits, then grants one agent-doable step away (or with no
 * gap known), then investor programs closing within INVESTOR_WINDOW_MS, then long shots (a tagged long shot, or a grant
 * the fit bar calls one: MoveProgram.longShot); within a kind the larger `max_usd` first, then the sooner close (rolling
 * last). Left out, as bestMove leaves them out: anything in `skip` (declined, parked, applied to, drafted within
 * DECLINE_MS, entered or hidden: bench-find.ts pathSkip), a close already passed, a not-eligible program (v4.10.2
 * Task 2, R3: MoveProgram.notEligible), and a grant with a gap the agent
 * can't do that closes within NOW_WINDOW_MS. A grant with several gaps is no long shot's company: it is left out unless
 * it is a long shot itself. Unlisted and upcoming programs never reach the ctx (showable). Pure.
 */
export function readySet(ctx: MoveCtx & { now: Date }, max = READY_MAX): ReadyProgram[] {
  const t = ctx.now.getTime();
  // v4.10.2 Task 2 (R3): a not-eligible program (its rule requires a chain the project doesn't use) never enters.
  const open = (p: MoveProgram) => !ctx.skip.has(p.id) && (p.ends_at ? Date.parse(p.ends_at) : Infinity) > t && p.notEligible !== true;
  const soon = (p: MoveProgram, ms: number) => (p.ends_at ? Date.parse(p.ends_at) : Infinity) - t <= ms;
  const of = (p: MoveProgram, kind: ReadyProgram['kind'], more: { step?: 'codes' | null; needs?: string | null } = {}): ReadyProgram => ({
    id: p.id, title: p.title, amount: p.amount, max_usd: p.max_usd ?? null, kind,
    why: kind === 'long_shot' ? p.why ?? null : null, ends_at: p.ends_at, zone: p.zone, step: more.step ?? null, needs: more.needs || null,
  });
  const fits = ctx.fits.filter((p) => open(p) && !p.investment).map((p) => of(p, p.longShot === true ? 'long_shot' : 'fit'));
  const grants = ctx.grants.filter((g) => open(g) && !g.investment).flatMap((g): ReadyProgram[] => {
    // bestMove's rule (final review F2): a gap the agent can't do, closing within NOW_WINDOW_MS, can't be done in time.
    if (g.gaps.length > 0 && !g.doable && soon(g, NOW_WINDOW_MS)) return [];
    // v4.10 Task 4 (decision d): a long shot one doable codes gap away carries the step too. (f): `needs` is find's.
    const step = g.gaps.length === 1 && g.doable && g.gaps[0] === 'codes' ? ('codes' as const) : null;
    if (g.longShot === true) return [of(g, 'long_shot', { step })];
    if (g.gaps.length === 0) return [of(g, 'fit')];
    return g.gaps.length === 1 && g.doable ? [of(g, 'one_step', { step })] : [];
  });
  const investors = ctx.investors.filter((p) => open(p) && p.investment && soon(p, INVESTOR_WINDOW_MS)).map((p) => of(p, 'investor'));
  const seen = new Set<string>();
  return [...fits, ...grants, ...investors]
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.max_usd ?? -1) - (a.max_usd ?? -1) || closeAt(a) - closeAt(b))
    .slice(0, max);
}

/**
 * v4.10.2 Task 1 (R1): the set that fits one short reply. `ranked` is readySet's order (every eligibility rule is
 * readySet's: this only counts answers); `answersOf` names the answers only the builder can give for a program (one
 * key each, so an answer two programs ask is counted once). Greedy in rank order: a program joins while the set's
 * distinct answers stay at most `cap`, up to `max` programs. A program left out for its answers is `out`, with its own
 * count (it alone needs more than `cap`, or it doesn't fit beside the ones before it). Pure.
 */
export function fitReadySet<T>(
  ranked: readonly T[], answersOf: (p: T) => readonly string[], max = READY_MAX, cap = READY_ANSWERS_MAX,
): { set: T[]; out: { program: T; answers: number }[] } {
  const set: T[] = [];
  const out: { program: T; answers: number }[] = [];
  let held = new Set<string>();
  for (const p of ranked) {
    if (set.length >= max) break;
    const own = new Set(answersOf(p));
    const next = new Set([...held, ...own]);
    if (own.size > cap || next.size > cap) {
      out.push({ program: p, answers: own.size });
      continue;
    }
    set.push(p);
    held = next;
  }
  return { set, out };
}

/**
 * v4.10.3 Task 1 (R1, R2): the grant money in a list of programs, in whole dollars: each program's `max_usd`, never a
 * long shot's (longShotWorth says it apart) nor an investor program's (an investor program's money is never added to a
 * grant total; investorWorth says it apart). A program with no number adds nothing. Pure.
 */
export function grantTotal(set: readonly Pick<ReadyProgram, 'kind' | 'max_usd'>[]): number {
  return set.reduce((n, p) => n + (p.kind !== 'long_shot' && p.kind !== 'investor' && p.max_usd && p.max_usd > 0 ? p.max_usd : 0), 0);
}
/**
 * R3: what the set is worth, "$1.1M", "$105.5K" (pool.ts usdCompact, the money line's figure: one decimal, rounded
 * down so it never overstates): grantTotal. None with a number: null. v4.10.1 Task 2 (R3): a long shot adds nothing
 * (longShotWorth says it apart); v4.10.3 Task 1 (R1): nor an investor program (investorWorth says it apart). Pure.
 */
export function worthUpTo(set: readonly Pick<ReadyProgram, 'kind' | 'max_usd'>[]): string | null {
  const total = grantTotal(set);
  return total > 0 ? usdCompact(total) : null;
}

/** The money of one kind, said apart from the worth: summed `max_usd` (usdCompact) and how many have a number. Pure. */
function apartWorth(set: readonly Pick<ReadyProgram, 'kind' | 'max_usd'>[], kind: 'long_shot' | 'investor'): { usd: string; n: number } | null {
  const some = set.filter((p) => p.kind === kind && p.max_usd && p.max_usd > 0);
  const total = some.reduce((n, p) => n + (p.max_usd ?? 0), 0);
  return total > 0 ? { usd: usdCompact(total), n: some.length } : null;
}
/**
 * v4.10.1 Task 2 (R3): the long shots' money, said apart from the worth ("plus a $100K long shot"): their summed
 * `max_usd` (usdCompact) and how many have a number; none with a number: null. Pure.
 */
export const longShotWorth = (set: readonly Pick<ReadyProgram, 'kind' | 'max_usd'>[]) => apartWorth(set, 'long_shot');
/** v4.10.3 Task 1 (R1): the investor programs' money, said apart from the worth ("plus a $1M accelerator"), as longShotWorth. Pure. */
export const investorWorth = (set: readonly Pick<ReadyProgram, 'kind' | 'max_usd'>[]) => apartWorth(set, 'investor');

/**
 * v4.10.3 Task 1 (R1): an investor program is named in the also-open lead's money line this close to its close (its own
 * amount and kind, and its close). Never a move (bestMove keeps v4.8.1 R1's INVESTOR_WINDOW_MS) and never in a total.
 */
export const INVESTOR_NAME_MS = 30 * 86_400_000;
/**
 * v4.10.3 Task 1 (R1): the one investor program the money line names: an investment, open, closing within
 * INVESTOR_NAME_MS (a rolling one never), not in `skip`; the soonest to close. Null with none. Pure.
 */
export function namedInvestor<P extends { id: string; investment: boolean; ends_at: string | null }>(programs: readonly P[], now: Date, skip: ReadonlySet<string>): P | null {
  const t = now.getTime();
  const left = (p: P) => (p.ends_at ? Date.parse(p.ends_at) - t : NaN);
  return programs
    .filter((p) => p.investment && !skip.has(p.id) && left(p) > 0 && left(p) <= INVESTOR_NAME_MS)
    .sort((a, b) => left(a) - left(b))[0] ?? null;
}
