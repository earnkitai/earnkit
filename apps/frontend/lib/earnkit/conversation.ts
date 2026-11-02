import { sql } from './db';
import { hoursLeft, submitBy, zoneParts } from './deadline';
// v4.8.1 final fix (R-3): both moved to deadline.ts, so the emails and alerts share them; re-exported for callers here.
export { hoursLeft, submitBy };
import { table } from './present';
import { MORE_ASK } from './bench-reply';
import { possessive } from './submit-kit';

/**
 * v4.8 "the launch conversation" (docs/design-docs-and-implementation-plans/v4.8-target-conversation.md): EarnKit leads.
 * Each builder walks one path toward a submitted application (standing_seen.path), every reply ends in one easy reply
 * (a yes, a number or "sent"), and a part already said in this session is never said again (standing_seen.said).
 * bench-find.ts gathers the facts (fits, open grants and their gaps, investor programs, what to skip); everything here is
 * pure except setPath and markSaid, the two writes. Task 1 builds the `hook` stage; Task 2 the `gap` and `draft` stages
 * (below); Task 3 `submit`, `track` and the fresh session's "Since {day}" (at the end); Tasks 4 and 5 add the rest.
 */

/** The path's stages: hook (an open program named for them), gap, draft, submit (waiting for "sent"), track. */
export type Stage = 'hook' | 'gap' | 'draft' | 'submit' | 'track';
export const STAGES: readonly Stage[] = ['hook', 'gap', 'draft', 'submit', 'track'];
/**
 * standing_seen.path. `program_id` may be set before the builder is ranked (Task 4: a new builder's pick), and is null
 * when the path has no program yet. `picked`: the builder chose the program (Task 4), so the path keeps it even at the
 * hook stage; a hook EarnKit chose is picked again on every reply (bestMove).
 */
export type Path = {
  stage: Stage; program_id: string | null; at: string; picked?: true;
  /** v4.8 Task 4 fix round 1 (8): the hook asked for the steps (target B's closest money), so its pointer does too. */
  steps?: true;
};

/** The stored path, or null when there is none or it isn't one EarnKit wrote. Pure. */
export function readPath(seen: { path?: unknown } | null | undefined): Path | null {
  const p = seen?.path;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const { stage, program_id, at } = p as Record<string, unknown>;
  if (typeof stage !== 'string' || !(STAGES as readonly string[]).includes(stage)) return null;
  if (program_id !== null && program_id !== undefined && typeof program_id !== 'string') return null;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  return {
    stage: stage as Stage, program_id: program_id ?? null, at,
    ...((p as { picked?: unknown }).picked === true && { picked: true as const }),
    ...((p as { steps?: unknown }).steps === true && { steps: true as const }),
  };
}

/** Writes the builder's path (standing_seen.path), stamped `now`. Never throws. */
export async function setPath(id: number, path: { stage: Stage; program_id: string | null; picked?: boolean }, now: Date): Promise<void> {
  const value: Path = { stage: path.stage, program_id: path.program_id, at: now.toISOString(), ...(path.picked && { picked: true as const }) };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('path', ${sql().json(value as never)}::jsonb)
    WHERE builder_id = ${id}`.catch((err: unknown) => {
    console.error('[conversation] set path', err instanceof Error ? err.name : 'error');
  });
}

/** A session ends after this much quiet (no find reply): standing_seen.said starts again. */
export const SESSION_MS = 2 * 60 * 60_000;
/** The session's memory: `fresh` (nothing said for SESSION_MS, or never) and the parts said in it. */
export type Session = { fresh: boolean; said: Set<string> };

/** The session as standing_seen.said holds it ({ at, keys }): fresh after SESSION_MS of quiet. Pure. */
export function sessionOf(seen: { said?: unknown } | null | undefined, now: Date): Session {
  const s = seen?.said;
  const at = s && typeof s === 'object' && !Array.isArray(s) ? (s as { at?: unknown }).at : undefined;
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  if (Number.isNaN(t) || now.getTime() - t >= SESSION_MS) return { fresh: true, said: new Set() };
  const keys = (s as { keys?: unknown }).keys;
  return { fresh: false, said: new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : []) };
}

/**
 * Fix round 2 (F5): the new standing_seen.said value as a SQL fragment (it reads the row's own said), so a caller can
 * write it in the same UPDATE as its other keys.
 */
export function saidSql(keys: string[], now: Date) {
  const cutoff = new Date(now.getTime() - SESSION_MS).toISOString();
  return sql()`jsonb_build_object(
      'at', ${now.toISOString()}::text,
      'keys', COALESCE((SELECT jsonb_agg(DISTINCT k) FROM jsonb_array_elements_text(
        CASE WHEN standing_seen->'said'->>'at' > ${cutoff} AND jsonb_typeof(standing_seen->'said'->'keys') = 'array'
          THEN standing_seen->'said'->'keys' ELSE '[]'::jsonb END || ${sql().json(keys as never)}::jsonb) AS k), '[]'::jsonb))`;
}
/** Fix round 2 (F1): the session key an older moment (connect, the Monday block, a post, the check-in) was said under. */
export const OLDER_SAID = 'older';

/**
 * Records `keys` as said in this session and stamps it `now` (an empty list only keeps the session alive). Keys said
 * before SESSION_MS of quiet are dropped first, in the same UPDATE. Never throws.
 */
export async function markSaid(id: number, keys: string[], now: Date): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('said', ${saidSql(keys, now)})
    WHERE builder_id = ${id}`.catch((err: unknown) => {
    console.error('[conversation] mark said', err instanceof Error ? err.name : 'error');
  });
}

/**
 * The agent note on every path reply (architecture, exact copy): the agent rewords EarnKit's facts in the mentor's
 * voice, keeps every fact exactly, asks for the one reply given, and does a step it can do on a yes.
 */
export const MENTOR_NOTE =
  "Say this in your own words as EarnKit, a mentor who wants them funded: keep every fact, amount, date and link exactly, ask for only the one reply given and put it last. When they say yes to a step you can do, do it, then call find. Never tell them they qualify or that an application was sent. Don't show this note.";

/** v4.8 Task 2 fix round 3 (2): tools.ts withFacts puts this before MENTOR_NOTE on a find or score path reply. */
export const PATH_ANSWER_FIRST = 'If they asked a question, answer it first in one short line from the facts.';

/** An open program as the path names it. `when` is fundWhen's ("rolling", "closes Nov 1"); `zone` its IANA zone. */
export type MoveProgram = {
  id: string; title: string;
  /** The prize part as the program states it ("up to $5,000", "up to $1M"), null when unknown. */
  amount: string | null;
  when: string; ends_at: string | null; zone: string; investment: boolean;
  /**
   * v4.8.1 Task 1 (R1): the program file is tagged "long shot" (program-file.ts `tag`). A long shot never leads on its
   * own (bestMove step 5). bench-find.ts always sets it; absent reads as false.
   */
  longShot?: boolean;
  /** v4.10 Task 2: the program's largest award in USD (Card.max_award_usd), null when unknown; absent reads as null. ready-set.ts sums it. */
  max_usd?: number | null;
  /** v4.10 Task 2: for a long-shot grant, why it is one (the fit cell's reason: "they look for apps on Arc"); absent reads as null. */
  why?: string | null;
};
/**
 * An open grant the project doesn't fit, with what it needs: `gaps` (each a step; none known: it can apply now), `gap`
 * (the sentence naming them, bench-reply.ts qualifyGap or needsWhy), `passed` (the builder passed on these steps within
 * DECLINE_MS) and `doable` (its one gap is a step the agent can do in the repo, like Builder Codes; never a chain
 * deployment such as "on Arc mainnet", a live product or making a repo public).
 */
export type GapGrant = MoveProgram & {
  gaps: string[]; gap: string; passed: boolean; doable: boolean;
  /** v4.8 Task 3: when the builder passed on the step (iso), for the passed-step line; absent when unknown. */
  passedAt?: string | null;
};
/** An investor program, with its odds sentence only when the program file states them (difficulty_override.basis). */
export type InvestorProgram = MoveProgram & { odds: string | null };
export type MoveCtx = {
  now: Date;
  /** The project's real fits (never an investment, a company-only program or a long shot). */
  fits: MoveProgram[];
  /** Open grants it doesn't fit, with their gaps. */
  grants: GapGrant[];
  investors: InvestorProgram[];
  /** Never named: entered or hidden, told EarnKit about (applied, any status), drafted, or a no within DECLINE_MS. */
  skip: Set<string>;
  /** Grants whose passed step was already raised once (standing_seen.path_raised). */
  raised: Set<string>;
  /**
   * Task 3 fix round 1 (1): of those, the ones raised in this session: while the path is on one of them, it stays the
   * move (its pointer is the reply), so a second find never drops the step the builder was just asked.
   */
  raisedNow?: Set<string>;
  path: Path | null;
};
export type Move =
  | { kind: 'fit'; program: MoveProgram }
  /** Closing within NOW_WINDOW_MS with no gap known: a grant only (v4.8.1 R1: never an investor program). */
  | { kind: 'now'; program: MoveProgram }
  | { kind: 'one_step'; program: GapGrant }
  | { kind: 'investor'; program: InvestorProgram }
  /** `raise`: the one gap is a step the builder passed on, raised this once. */
  | { kind: 'closest'; program: GapGrant; raise: boolean }
  | { kind: 'quiet' };

/** An investor program is a move only this close to its deadline. */
export const INVESTOR_WINDOW_MS = 7 * 86_400_000;
/** Fix round 1 (R1): a program the builder can apply to now with no gap leads when it closes this soon. */
export const NOW_WINDOW_MS = 48 * 60 * 60_000;
const closeAt = (p: Pick<MoveProgram, 'ends_at'>) => (p.ends_at ? Date.parse(p.ends_at) : Infinity);
const byClose = <P extends Pick<MoveProgram, 'ends_at'>>(a: P, b: P) => closeAt(a) - closeAt(b);

/**
 * The program the path leads with, in this order (v4.8.1 Task 1, controller ruling R1: investor programs and long shots
 * never lead on their own):
 * 1. a real fit not applied to or drafted, closing first (rolling last); fits already exclude investors and long shots;
 * 2. a grant, not a long shot, closing within NOW_WINDOW_MS (48 hours) the builder can apply to now with no gap;
 * 3. a grant, not a long shot, one step away where that step is one the agent can do in the repo (`doable`: Builder
 *    Codes; a chain deployment never counts), not a step the builder passed on;
 * 4. the closest grant, not a long shot, by number of gaps, the agent-doable one first at equal gaps (a passed step
 *    only when it is the one gap, and only once); never one whose gap the agent can't do that closes within
 *    NOW_WINDOW_MS (final review F2);
 * 5. only when 1 to 4 are all empty: an investor program (with its odds when stated) or a long-shot grant closing
 *    within INVESTOR_WINDOW_MS, soonest first;
 * 6. otherwise quiet: the reply's older asks (check-in, wallet, token, new repo, titles, then the ship line).
 * Anything in `skip` is never a move. A program on the stored path keeps its place, wherever it ranks, while it is
 * still one of 1 to 5 (a long-shot grant at any close) and the builder is on it: they picked it, or said yes past the
 * hook (gap, draft, submit, track). An investor program is never a fit. Pure.
 * bench-find.ts (fix rounds 2 and 3, v4.8.1 fix round 1): the path leads on steps 1 to 3. On a closest grant or an
 * investor program (steps 4 and 5) an older moment (connect, the Monday block, a post, the check-in) may answer first,
 * once a session, and only at the hook while the path is not already on that program; a builder mid-path (past the
 * hook, or already hooked on it) always gets the path.
 */
export function bestMove(ctx: MoveCtx): Move {
  const t = ctx.now.getTime();
  const open = <P extends MoveProgram>(p: P) => !ctx.skip.has(p.id) && closeAt(p) > t;
  const fits = ctx.fits.filter((p) => open(p) && !p.investment).sort(byClose);
  const soon = (p: MoveProgram, ms: number) => closeAt(p) - t <= ms;
  const now = ctx.grants.filter((g) => open(g) && !g.investment && g.gaps.length === 0 && soon(g, NOW_WINDOW_MS)).sort(byClose);
  const grants = ctx.grants.filter((g) => open(g) && !g.investment && g.gaps.length > 0);
  const investors = ctx.investors.filter((p) => open(p) && p.investment && soon(p, INVESTOR_WINDOW_MS)).sort(byClose);
  const oneStep = grants.filter((g) => g.gaps.length === 1 && g.doable && !g.passed).sort(byClose);
  // Task 2 fix round 2: a grant the builder said yes to past the hook (gap, draft) stays a move even once its passed
  // step was raised (they took it up).
  const onPast = (g: GapGrant) => ctx.path?.program_id === g.id && ctx.path.stage !== 'hook';
  // Final review F2: a grant whose gap the agent can't do (a chain deployment, a live product) and that closes within
  // NOW_WINDOW_MS can't be won in time, so it never leads (unless the builder is already on it); at equal gaps, the
  // agent-doable one comes first, then the close.
  const closest = grants
    .filter((g) => g.doable || onPast(g) || !soon(g, NOW_WINDOW_MS))
    .filter((g) => !g.passed || onPast(g) || (g.gaps.length === 1 && (!ctx.raised.has(g.id) || (ctx.path?.program_id === g.id && ctx.raisedNow?.has(g.id) === true))))
    .sort((a, b) => a.gaps.length - b.gaps.length || Number(b.doable) - Number(a.doable) || byClose(a, b));
  const grantMoves: Exclude<Move, { kind: 'quiet' }>[] = [
    ...now.map((program) => ({ kind: 'now' as const, program })),
    ...oneStep.map((program) => ({ kind: 'one_step' as const, program })),
    ...closest.filter((g) => !oneStep.includes(g)).map((program) => ({ kind: 'closest' as const, program, raise: program.passed })),
  ];
  // v4.8.1 R1: long shots and investor programs go last (step 5), soonest first; a long-shot grant keeps its own kind.
  const longShots = grantMoves.filter((m) => m.program.longShot === true);
  const last = [
    ...investors.map((program) => ({ kind: 'investor' as const, program })),
    ...longShots.filter((m) => soon(m.program, INVESTOR_WINDOW_MS)),
  ].sort((a, b) => byClose(a.program, b.program));
  const moves: Exclude<Move, { kind: 'quiet' }>[] = [
    ...fits.map((program) => ({ kind: 'fit' as const, program })),
    ...grantMoves.filter((m) => m.program.longShot !== true),
    ...last,
  ];
  const on = ctx.path?.program_id && (ctx.path.picked || ctx.path.stage !== 'hook') ? ctx.path.program_id : null;
  // The builder's own long-shot grant keeps its place whatever its close.
  const kept = on ? [...moves, ...longShots].find((m) => m.program.id === on) : undefined;
  return kept ?? moves[0] ?? { kind: 'quiet' };
}

/** A program's name in a sentence: its title before any ':' and without a trailing " Program". Pure. */
export const programName = (title: string) => title.split(':')[0].trim().replace(/\s+Program$/i, '');

/**
 * When a dated program closes: under 48 hours, the time left (hoursLeft: "in 20 hours", "in under an hour"); otherwise
 * its day in the program's zone ("Nov 5"). v4.8.1 Task 2 (R2): never "tonight" or "tomorrow", which read wrong in the
 * builder's own zone. Every caller puts "closes", "closing" or "until it closes" before it. Pure.
 */
export function closeWords(endsAt: string, zone: string, now: Date): string {
  return hoursLeft(endsAt, now) ?? zoneParts(new Date(endsAt), zone).day;
}

/*
 * v4.8.1 Task 2 (R3): the money line. The first path reply of a session (a hook, the gap's step, the draft offer, a fresh
 * session's "Since" opener; never the setup steps, the held submit pointer or a direct answer) says the open total, as its
 * own paragraph just before the easy reply, once a session (MONEY_SAID).
 */
/** The session key the money line is said under. */
export const MONEY_SAID = 'money:total';
/** v4.8.2 Task 2 (R3): the money line names programs closing this soon (under 48 hours, so hoursLeft always has words). */
export const CLOSING_SOON_MS = 48 * 60 * 60_000;
/** v4.8.2 Task 2 (R3): at most this many programs in the money line's "Closing soon". */
export const CLOSING_SOON_MAX = 2;
/** A program as the money line's "Closing soon" names it (bench-find.ts closingPrograms builds these from live cards). */
export type ClosingProgram = Pick<MoveProgram, 'id' | 'title' | 'amount' | 'ends_at' | 'zone' | 'investment'>;
/**
 * v4.8.2 Task 2 (R3): the programs the money line's "Closing soon" names, any category: open, closing within
 * CLOSING_SOON_MS, never in `skip` (applied to, declined, parked, drafted, entered or hidden: bench-find.ts pathSkip)
 * and never in `led` (the program the reply is about, and a program the builder picked or is past the hook on: the
 * v4.8.1 ruling's "led on"); soonest first, at most CLOSING_SOON_MAX. Unlisted and upcoming programs never reach it
 * (bench-find.ts closingPrograms reads only open curated cards). One name is said once (the sooner). Pure.
 */
export function closingSoon<P extends ClosingProgram>(programs: readonly P[], now: Date, skip: ReadonlySet<string>, led: ReadonlySet<string | null>): P[] {
  const t = now.getTime();
  return programs
    .filter((p) => !skip.has(p.id) && !led.has(p.id) && closeAt(p) > t && closeAt(p) - t < CLOSING_SOON_MS)
    .sort(byClose)
    // Two programs with one name (two rounds of "Arc Microgrants: ..."): only the sooner is named, never "Arc and Arc".
    .filter((p, i, all) => all.findIndex((q) => programName(q.title) === programName(p.title)) === i)
    .slice(0, CLOSING_SOON_MAX);
}
/** "Arc Microgrants (500 USDC × 8 grants, in 14 hours)", "a16z speedrun SR008 (investor program, up to $1M, in 19 hours)". Pure. */
const closingName = (p: ClosingProgram, now: Date) =>
  `${programName(p.title)} (${[p.investment ? 'investor program' : null, p.amount, closeWords(p.ends_at!, p.zone, now)].filter(Boolean).join(', ')})`;
/**
 * "Open now: {total} in grants. Closing soon: {A} ({amount}, in N hours)[ and {B} (...)]." (v4.8.2 Task 2, R3; it
 * replaced v4.8.1's one investor clause). `total` is moneyText(openMoneyNow(now, cards)), /api/stats' figure, null at 0
 * (the first sentence left out); `closing` is closingSoon's list (none: the second sentence left out; a close already
 * passed is dropped). Neither: no line. Pure.
 */
export function moneyLine(total: string | null, closing: readonly ClosingProgram[], now: Date): string | null {
  const names = closing.filter((p) => p.ends_at && Date.parse(p.ends_at) > now.getTime()).map((p) => closingName(p, now));
  const parts = [total ? `Open now: ${total} in grants.` : null, names.length > 0 ? `Closing soon: ${names.join(' and ')}.` : null];
  return parts.filter(Boolean).join(' ') || null;
}
/** Words a period ends without ending the sentence ("e.g.", "U.S."). */
const NO_END = /(?:^|\s)(?:e\.g|i\.e|vs|etc|Mr|Mrs|Ms|Dr|St|Inc|Ltd|[A-Z](?:\.[A-Z])*)\.$/;
/**
 * A one-paragraph reply split before its last sentence (its easy reply): [the rest, the last sentence], or null when it
 * is one sentence. A sentence ends at ".", "?" or "!" followed by a space and a capital or a quote, or at a line break
 * before one, never inside a URL
 * or an amount ("$5,000." then a capital still ends one; "earnkit.com/x" never does) or after an abbreviation. A last
 * sentence under 3 words ("Go?") keeps the sentence before it. Pure.
 */
function splitLast(p: string): [string, string] | null {
  // Final review 8: a line break before a capital also ends a sentence (the gap step's guide link ends its line).
  const cuts = [...p.matchAll(/[.?!]\s+(?=[A-Z"])|\n(?=[A-Z"])/g)]
    .filter((m) => m[0] === '\n' || !NO_END.test(p.slice(0, m.index + 1)))
    .map((m) => (m[0] === '\n' ? { end: m.index, next: m.index + 1 } : { end: m.index + 1, next: m.index + m[0].length }));
  // A bare "Go?" keeps the offer it answers ("I can add Builder Codes ... about 10 minutes. Go?") as one easy reply.
  const short = (c: { end: number; next: number }) => p.slice(c.next).split(/\s+/).length < 3;
  const cut = cuts.length > 1 && short(cuts.at(-1)!) ? cuts.at(-2) : cuts.at(-1);
  return cut ? [p.slice(0, cut.end), p.slice(cut.next)] : null;
}
/**
 * The money line as its own paragraph just before the reply's last one. Fix round 1 (controller ruling a): it never goes
 * above the greeting, so a one-paragraph reply is split before its last sentence (its easy reply) and the line goes
 * between the two; a one-sentence reply gets the line first. Pure.
 */
export function withMoneyLine(show: string, line: string | null): string {
  if (!line) return show;
  const ps = show.split('\n\n');
  if (ps.length === 1) {
    const two = splitLast(ps[0]);
    return two ? `${two[0]}\n\n${line}\n\n${two[1]}` : `${line}\n\n${ps[0]}`;
  }
  return [...ps.slice(0, -1), line, ps.at(-1)!].join('\n\n');
}

/** "6 weeks", "1 week". Pure. */
const weeks = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;
/**
 * The proof line: a fact only EarnKit holds (the shipping streak, the project live), or null with neither. For an
 * investor program it says why it matters to them. Pure.
 */
export function proofLine(p: { name: string; live: boolean }, streak: number, investor: boolean): string | null {
  return proofOf(p, streak, investor, new Set())?.line ?? null;
}
/** A proof line and the facts it says, as session parts (`proof:streak=6`, `proof:live=earnkit`, `proof:base=live`). */
export type Proof = { line: string; keys: string[] };
/**
 * Task 6 fix round 1 (review 4, 10): proofLine's facts not said this session (`said`), keyed on the facts, never the
 * wording, so the same fact is said once a session however it is worded. A streak under 2 weeks is no proof. Pure.
 */
export function proofOf(p: { name: string; live: boolean }, streak: number, investor: boolean, said: ReadonlySet<string>): Proof | null {
  const facts = [
    streak >= 2 ? { key: `proof:streak=${streak}`, text: `You've shipped ${weeks(streak)} in a row` } : null,
    p.live && p.name ? { key: `proof:live=${p.name.toLowerCase()}`, text: `${p.name} is live` } : null,
  ].filter((f): f is { key: string; text: string } => f !== null && !said.has(f.key));
  if (facts.length === 0) return null;
  const line = facts.length === 2 ? `${facts[0].text} and ${facts[1].text}` : facts[0].text;
  return { line: `${line}${investor ? ', which is the traction they ask about' : ''}.`, keys: facts.map((f) => f.key) };
}

/** The hook's easy replies: a draft (fit, investor) or the steps (a grant with a gap). */
export const START_ASK = 'Want me to start?';
export const STEPS_ASK = 'Want the steps?';
export const draftOffer = (live: boolean) => `I can draft your application from your commits${live ? ' and live product' : ''} in a few minutes. ${START_ASK}`;

export type PathCtx = {
  now: Date;
  /** The builder's first name from X (bench-reply.ts firstName); null without one: the reply greets no name (F9). */
  first: string | null;
  project: { name: string; live: boolean };
  streak: number;
  move: Exclude<Move, { kind: 'quiet' }>;
  /** What this session already said (sessionOf). */
  said: Set<string>;
  /** Fix round 2 (F10): the caller's agent has no folder of the code (agent-reach.ts hosted): it does no step itself. */
  hosted?: boolean;
  /** v4.8 Task 4: the hook asks for the steps (target B's closest money after a pick that doesn't fit), never "Go?". */
  steps?: boolean;
  /**
   * v4.8 Task 5 fix round 1 (5): a direct answer came first, so the step is C's short pointer ("Your a16z speedrun SR008
   * application is the next move. Want me to start?"), never the hook's money and proof again; the hook counts as said.
   */
  brief?: boolean;
  /**
   * Task 6 fix round 1 (review 4): Base's remaining steps when the move is Base's grant (gapProofOf): its fact is the
   * hook's proof once the streak and live facts were said this session.
   */
  baseSteps?: readonly string[] | null;
  /** v4.8.1 Task 3 (R4): the path's stage on this program (null: not on it), for the pointer's reason. */
  stage?: Stage | null;
  /** v4.8.1 Task 3 (R4): a draft of this program was made (the pointer's "your draft is ready"). */
  drafted?: boolean;
  /** Fix round 1 (minor 1): the stage's own ask after "your draft is ready" (PointerFacts.readyAsk). */
  readyAsk?: string | null;
};

/*
 * v4.8.1 Task 3 (R4), v4.8.2 Task 1 (R1): the pointer, the same step pointed back to within a session. The first time it
 * says why the program is still the move; from the second, it is the quiet reply's MORE_ASK (bench-reply.ts), stored as
 * the 'more' ask (pointerReply's `more`), so "more" or a yes is the programs answer and never the program's own step. A
 * no to the first pointer parks the program through the existing no handling (its stored ask's no).
 */
/** The second and later pointers' easy reply: bench-reply.ts MORE_ASK, "more" is the programs answer. */
export const POINT_MORE = MORE_ASK;
/** Fix round 1 (minor 1): the submit stage's own ask on a pointer. */
export const SENT_SHORT = `Reply "sent" once it's in.`;
/** What the pointer reads of the program and the path. */
export type PointerFacts = Pick<MoveProgram, 'id' | 'title' | 'amount' | 'when' | 'ends_at' | 'zone'> & {
  /** The gaps left (0: none, or not a grant with gaps). */
  gaps: number;
  /** The path's stage on this program, null when not on it. */
  stage: Stage | null;
  /** A draft was made; only then does a draft or submit stage say "your draft is ready". */
  drafted: boolean;
  /**
   * Fix round 1 (minor 1): the stage's own ask when the reason is "your draft is ready" (submit: SENT_SHORT; a draft:
   * its blanks ask), never "Want me to start?". Absent: the caller's ask.
   */
  readyAsk?: string | null;
};
/**
 * The pointer's reason, in this order: "one step away" (one gap); "{n} steps away"; "your draft is ready" (the draft or
 * submit stage, drafted); "closes {closeWords}" (a dated program still open). Null with none. Pure.
 */
export function pointerWhy(p: PointerFacts, now: Date): string | null {
  if (p.gaps === 1) return 'one step away';
  if (p.gaps > 1) return `${p.gaps} steps away`;
  if ((p.stage === 'draft' || p.stage === 'submit') && p.drafted) return 'your draft is ready';
  if (p.ends_at && p.when !== 'rolling' && Date.parse(p.ends_at) > now.getTime()) return `closes ${closeWords(p.ends_at, p.zone, now)}`;
  return null;
}
/**
 * The pointer and the session parts it says (markSaid). First (`point:{id}` not said): "{Program} is still your best
 * move: {money}, {why}. {ask}" (an unknown amount or reason is left out with its comma). Second and later: POINT_MORE,
 * `more` set (the caller stores the 'more' ask), said as `more:{id}`. `ready`: the reason is "your draft is ready" (its
 * ask is readyAsk). v4.8.2 final fix (F1): `again`, the "more" line was said already this session (the caller's agent
 * note then tells the agent to wait for the builder: bench-reply.ts WAIT_NOTE). Pure.
 */
export type Pointer = { text: string; said: string[]; more: boolean; ready: boolean; again: boolean };
export function pointerReply(p: PointerFacts, ask: string, said: ReadonlySet<string>, now: Date): Pointer {
  const name = programName(p.title);
  if (!said.has(`point:${p.id}`)) {
    const why = pointerWhy(p, now);
    const ready = why === 'your draft is ready';
    const facts = [p.amount, why].filter((x): x is string => Boolean(x));
    return { text: `${name} is still your best move${facts.length > 0 ? `: ${facts.join(', ')}` : ''}. ${ready && p.readyAsk ? p.readyAsk : ask}`, said: [`point:${p.id}`], more: false, ready, again: false };
  }
  return { text: POINT_MORE, said: [`more:${p.id}`], more: true, ready: false, again: said.has(`more:${p.id}`) };
}
/** Fix round 2 (F10): a local agent's offer for a grant whose one gap is Builder Codes (target A). */
/** v4.8.1 final fix (R-2): it names its step, so it reads right after the money line or alone in a pointer. */
export const CODES_OFFER = 'I can add Builder Codes and push the change, about 10 minutes. Go?';
export type PathReply = {
  stage: Stage; program_id: string;
  show_to_builder: string;
  /** The parts this reply says, for markSaid. */
  said: string[];
  /** The easy reply it ends with. */
  reply: 'start' | 'steps' | 'go';
  /** v4.8.1 Task 3 fix round 1: a pointer's MORE_ASK (stored as the 'more' ask) or "your draft is ready" (its own ask). */
  pointer?: { more: boolean; ready: boolean; again: boolean };
};

/**
 * The path's reply. Task 1: the `hook` stage for every move (the later stages fall back to it until Tasks 2 to 5):
 * - a fit or an investor program: "{first}, {program} closes {when}: {amount}." + the proof line, then the draft offer
 *   ending "Want me to start?" (A's opener);
 * - a grant with a gap: its money and the gap sentence + the proof line, then "Want the steps?".
 * The same hook a second time in a session is pointerReply (v4.8.1 R4: the reason once, then short, never the same
 * line twice). A proof line said already this session is left out. Pure.
 */
export function pathReply(c: PathCtx): PathReply {
  const m = c.move;
  const p = m.program;
  const name = programName(p.title);
  // Fix round 2 (F10): one gap the agent can do (Builder Codes) and a local agent: the hook offers to do it, "Go?".
  const doIt = (m.kind === 'one_step' || m.kind === 'closest') && m.program.doable && m.program.gaps.length === 1 && c.hosted !== true && c.steps !== true;
  const reply: PathReply['reply'] = m.kind === 'fit' || m.kind === 'now' || m.kind === 'investor' ? 'start' : doIt ? 'go' : 'steps';
  const ask = reply === 'start' ? START_ASK : reply === 'go' ? CODES_OFFER : STEPS_ASK;
  const hookKey = `hook:${p.id}`;
  // Merge gate (Task 6), fix round 1 ruling R2: a pointer (the same step again within a session) is exempt from the
  // proof-line rule; it is one line that points back, with the same easy reply.
  if (c.said.has(hookKey) || c.brief) {
    // Task 5 fix round 1 (5): the brief pointer (after a direct answer) says no "still" and counts the hook as said.
    if (c.said.has(hookKey)) {
      // v4.8.1 Task 3 (R4): the same step pointed back to says why once, then is short, never the same line twice.
      const gaps = m.kind === 'one_step' || m.kind === 'closest' ? (p as GapGrant).gaps.length : 0;
      const pt = pointerReply({ ...p, gaps, stage: c.stage ?? null, drafted: c.drafted === true, readyAsk: c.readyAsk ?? null }, ask, c.said, c.now);
      return { stage: 'hook', program_id: p.id, show_to_builder: pt.text, said: pt.said, reply, pointer: { more: pt.more, ready: pt.ready, again: pt.again } };
    }
    const point = reply === 'start' ? `Your ${name} application is the next move.` : reply === 'go' ? `${name} is one step away.` : `${name} is your closest money.`;
    return { stage: 'hook', program_id: p.id, show_to_builder: `${point} ${ask}`, said: [hookKey, `money:${p.id}`], reply };
  }
  // Task 6 fix round 1 (review 4): one proof a session per fact; with the streak and live said, Base's own fact.
  const proofOut = proofOf(c.project, c.streak, p.investment, c.said) ?? (c.baseSteps ? baseProof(c.baseSteps, c.said) : null);
  const proof = proofOut?.line ?? null;
  const dated = p.ends_at !== null && p.when !== 'rolling';
  const closes = dated ? closeWords(p.ends_at!, p.zone, c.now) : null;
  const hi = c.first ? `${c.first}, ` : '';
  let money: string;
  if (reply === 'start') {
    money = `${hi}${closes ? `${name} closes ${closes}${p.amount ? `: ${p.amount}` : ''}.` : `${name} is open now${p.amount ? `: ${p.amount}` : ''}.`}`;
  } else {
    const g = p as GapGrant;
    const head = m.kind === 'closest' ? (c.first ? `${c.first}, your closest money is ${name}` : `Your closest money is ${name}`) : `${hi}${name}`;
    const pays = p.amount ? (m.kind === 'closest' ? `: ${p.amount}` : ` pays ${p.amount}`) : m.kind === 'closest' ? '' : ' is open';
    money = `${head}${pays}${closes ? `, closing ${closes}` : ''}. ${g.gap}`;
    // Task 3: a passed step raised (its one gap, once: path_raised) says so, once (target A).
    if (m.kind === 'closest' && m.raise) money += ` ${passedLine(g.gaps.length === 1 && g.gaps[0] === 'codes')}`;
  }
  const first = [money, proof].filter(Boolean).join(' ');
  const second = reply === 'start' ? draftOffer(c.project.live) : ask;
  return {
    stage: 'hook', program_id: p.id,
    show_to_builder: `${first}\n\n${second}`,
    said: [hookKey, `money:${p.id}`, ...(proofOut?.keys ?? [])],
    reply,
  };
}

/*
 * v4.8 Task 2: the gap and draft stages.
 * - gap: a yes to the hook's "Want the steps?" gives the steps (Base: base-qualify.ts's; another grant: programNeeds'
 *   gaps and the program file's setup), each step the agent can do marked, ending in one easy reply. A yes to that is
 *   the agent doing the step, then calling find (MENTOR_NOTE). When the last gap is closed, the path moves to `draft`.
 * - draft: a yes to "Want me to start?" is the draft: the verified record (ship-log-facts.ts shipLogBlock: score,
 *   streak, live link, page link, revenue under its own rules), and the blanks only the builder can fill, asked once.
 */

/**
 * One step toward a grant: its line, the guide link (shown after the mark), whether the agent can do it in the repo,
 * and (fix round 1, T2-2) the offer said before "Go?" when it is the one step ("I can add Builder Codes and push the
 * change, about 10 minutes.").
 */
export type GapStep = { text: string; link?: string; doable: boolean; offer?: string };
/** The gap stage's easy replies: one step the agent can do; the first of several it can do; help (it can do none). */
export const GAP_GO = 'Go?';
export const GAP_FIRST_ASK = 'Want me to do the first one now?';
export const GAP_HELP_ASK = 'Want help with step 1 now?';
export const GAP_HELP_ASK_ONE = 'Want help with it now?';
/** The mark on a step the agent can do (target conversation B). */
export const CAN_DO = 'I can do this.';
export type GapReply = { show_to_builder: string; reply: 'go' | 'first' | 'help'; steps: GapStep[] };

/**
 * The gap stage's reply: "Your next step toward {program}:" (or "Your next {n} steps"), the numbered steps, each one
 * the agent can do marked "I can do this." and listed first, then one easy reply: "Go?" (one step, the agent can do
 * it), "Want me to do the first one now?" (several, the first one the agent's), else the help ask. A `hosted` agent
 * (agent-reach.ts: no folder of the code) can do none, so nothing is marked (fix F3). Pure.
 */
export function gapReply(program: string, steps: GapStep[], hosted: boolean, proof: string | null = null): GapReply {
  const can = (s: GapStep) => s.doable && !hosted;
  const ordered = [...steps.filter(can), ...steps.filter((s) => !can(s))];
  const n = ordered.length;
  const head = `${n === 1 ? 'Your next step' : `Your next ${n} steps`} toward ${programName(program)}:`;
  const lines = ordered.map((s, i) => `${i + 1}. ${s.text}${can(s) ? ` ${CAN_DO}` : ''}${s.link ? ` Guide: ${s.link}` : ''}`);
  const reply: GapReply['reply'] = ordered.length > 0 && can(ordered[0]) ? (n === 1 ? 'go' : 'first') : 'help';
  const ask = reply === 'go' ? (ordered[0].offer ? `${ordered[0].offer} ${GAP_GO}` : GAP_GO) : reply === 'first' ? GAP_FIRST_ASK : n === 1 ? GAP_HELP_ASK_ONE : GAP_HELP_ASK;
  // Fix round 1 (T2-6): one proof line, before the easy reply.
  return { show_to_builder: `${[head, ...lines].join('\n')}\n\n${proof ? `${proof} ` : ''}${ask}`, reply, steps: ordered };
}

/** Fix round 1 (T2-4): the mid-gap ask (steps already given): the agent can do the step, else help with it. */
export const GAP_DO_IT_ASK = 'Want me to do it now?';
/**
 * Fix round 1 (T2-4): a find while the path is at `gap` (the steps already given): "Still on {program}: {first
 * remaining step}. {proof} Want me to do it now?" (help, when the agent can't do it), never "Want the steps?" again. Pure.
 */
/** Final review F5: the money a fresh session's gap opener says once ("{first}, ", the amount, the close words). */
export type GapMoney = { first: string | null; amount: string | null; closes: string | null };
export function gapStillReply(program: string, steps: GapStep[], hosted: boolean, proof: string | null, money: GapMoney | null = null): { show_to_builder: string; reply: 'go' | 'help' } {
  const can = (s: GapStep) => s.doable && !hosted;
  const step = steps.find(can) ?? steps[0];
  const text = step.text.replace(/\.$/, '');
  const reply = can(step) ? 'go' : 'help';
  const words = `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  const name = programName(program);
  // Final review F5: a fresh session says the money once: "Base Builder Grant pays up to $5,000, and you're one step
  // away: {step}." (several: "you're 2 steps away. First: {step}.").
  const head = money
    ? `${money.first ? `${money.first}, ` : ''}${name} ${money.amount ? `pays ${money.amount}` : 'is open'}${money.closes ? `, closing ${money.closes}` : ''}, and you're ${steps.length === 1 ? `one step away: ${words}` : `${steps.length} steps away. First: ${words}`}.`
    : `Still on ${name}: ${words}.`;
  const rest = [proof, reply === 'go' ? GAP_DO_IT_ASK : GAP_HELP_ASK_ONE].filter(Boolean).join(' ');
  // Final review 8: the guide link ends its line, so the next sentence never runs into the URL (and no period is glued
  // to it, which would break the link); the reply stays one paragraph.
  return { show_to_builder: step.link ? `${head} Guide: ${step.link}\n${rest}` : `${head} ${rest}`, reply };
}

/** Task 6 fix round 1 (review 1): the help yes's one easy reply; its ok re-checks the step. */
export const HELP_DONE_ASK = "Say ok once it's done, and I'll check it.";
const helpStepWords = (s: GapStep) => {
  const t = s.text.replace(/\.$/, '');
  return `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
};
/** The yes to "Want help with it now?": "Let's do it now: {step}. Guide: {link}", then HELP_DONE_ASK. Pure. */
export const helpReply = (step: GapStep) => `Let's do it now: ${helpStepWords(step)}.${step.link ? ` Guide: ${step.link}` : ''}\n\n${HELP_DONE_ASK}`;
/**
 * Final review F3 (the parked T4 copy): a find while the agent is helping with a step (before their ok): one short line
 * that never says the step again, then HELP_DONE_ASK. Pure.
 */
export const helpWaiting = (title: string) => `Take your time with the ${programName(title)} step. ${HELP_DONE_ASK}`;
/**
 * Task 6 fix round 2 (1): a help park whose step is met since: what changed, so the program is back on. "You're on Arc
 * now, so Arc Microgrants is back on." (a chain's mainnet); "Builder Codes are in, so ..."; else "That step is done, so
 * ...". Pure.
 */
export function backOnLine(step: string, title: string): string {
  const chain = /^on (.+?) mainnet$/i.exec(step)?.[1];
  const what = chain ? `You're on ${chain} now` : step === 'codes' ? 'Builder Codes are in' : 'That step is done';
  return `${what}, so ${programName(title)} is back on.`;
}
/**
 * v4.8 re-review minor (N4): a picked grant closing within NOW_WINDOW_MS on a step the agent can't do, said once before
 * the closer money's hook: "{program} closes too soon to get {step} done, so here's closer money." Pure.
 */
export const tooSoonLine = (title: string, step: string) => `${programName(title)} closes too soon to get ${step} done, so here's closer money.`;
/** Not done after a second check: the program waits (parked), and the path moves on. Pure. */
export const helpParked = (title: string) => `I'll keep ${programName(title)} for when it's done.`;

/** The draft offer once a grant's last gap is closed: "Want me to draft the Base application next?". */
export const draftNextAsk = (org: string) => `Want me to draft the ${org} application next?`;
/**
 * The reply once the path's gap is closed (the path moves to `draft`). Base, Builder Codes confirmed in the code
 * (target conversation A, exact): "Builder Codes are in. You now meet Base's first requirement. Want me to draft the
 * Base application next?". Another grant: "{program}'s steps are done." and the same offer. Pure.
 */
export function gapClosedReply(c: { org: string; title: string; codes: boolean; proof?: string | null }): string {
  const done = c.codes ? `Builder Codes are in. You now meet ${possessive(c.org)} first requirement.` : `${possessive(programName(c.title))} steps are done.`;
  // Fix round 1 (T2-6): one proof line, before the offer.
  return [done, c.proof, draftNextAsk(c.org)].filter(Boolean).join(' ');
}

/** An investor program with no public questions: the founder brief's two blanks (target conversation A, exact). */
export const FOUNDER_BLANKS: readonly string[] = ["who's on the team", "any money you've raised"];
/** Fix round 2 (F9): one list style at any count: "a", "a, and b", "a, b, and c". Pure. */
export const andComma = (xs: readonly string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}`);
/** Task 6 fix round 1b: the blanks' one approved reply line: "Reply with it|both|them and I'll finish it.". Pure. */
const finishLine = (n: number) => `Reply with ${n === 1 ? 'it' : n === 2 ? 'both' : 'them'} and I'll finish it.`;
/**
 * Fix round 2 (F5): a yes to the draft with its blanks still empty: "I need {blanks}. Reply with both and I'll finish
 * it." (it, both or them, as blanksAsk; Task 6 fix round 1b). Pure.
 */
export const blanksAgain = (blanks: readonly string[]) => `I need ${andComma(blanks)}. ${finishLine(blanks.length)}`;
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/**
 * The draft's one easy reply: the blanks only the builder can fill, asked as one reply. Two (target A, exact): "Two
 * blanks only you can fill: who's on the team, and any money you've raised. Reply with both and I'll finish it." None:
 * "Want me to finish it?". Pure.
 */
export function blanksAsk(blanks: readonly string[]): string {
  const n = blanks.length;
  if (n === 0) return 'Want me to finish it?';
  const count = COUNT[n] ?? String(n);
  const list = andComma(blanks);
  return `${count} ${n === 1 ? 'blank' : 'blanks'} only you can fill: ${list}. ${finishLine(n)}`;
}
/** The draft stage's reply: "Here's your draft:", the verified record's lines, then the blanks ask (last). Pure. */
export const draftReply = (record: readonly string[], blanks: readonly string[]) =>
  [`Here's your draft:`, record.join('\n'), blanksAsk(blanks)].filter((x) => x.length > 0).join('\n\n');

/** A submission requirement as the draft reads it (program-file.ts SubmissionRequirement). */
type DraftReq = { key: string; label: string; required: boolean; from: 'project' | 'builder'; kind?: string; todo?: string };
/** Fix round 2 (F1): at most this many blanks in one reply; the rest wait for prepare's own round. */
export const MAX_BLANKS = 2;
/** Fix round 2 (F1): builder-only kinds the agent can't draft (the team, a demo video, usage numbers), asked in this order. */
const ASK_KINDS = ['team', 'traction', 'demo_video'] as const;
/**
 * Fix round 2 (F1): a builder field (`from: 'builder'`) the agent can't draft: the team, usage numbers, a demo video, a
 * link, a choice they consent to, or an amount, location or code only they know. Other builder fields (how it makes
 * money, a GTM plan, the main challenge) the agent drafts from the repo and record, marked for the builder to check. Pure.
 */
const mustAsk = (r: DraftReq & { type?: string }) =>
  (ASK_KINDS as readonly string[]).includes(r.kind ?? '') || r.type === 'url' || r.type === 'choice'
  || /amount|usd|location|wallet|consent|\b(builder|referral|invite|promo|access|discount) code\b/i.test(`${r.key.replace(/_/g, ' ')} ${r.label}`);
/**
 * v4.10.1 Task 1: the kinds the agent drafts honestly from the repo and the record (what it is, the problem, how it
 * works, its links, why the builder): every other builder field is the builder's to give (coach.ts AGENT_DRAFTS' idea).
 */
const AGENT_DRAFTABLE = ['name', 'one_liner', 'problem', 'solution', 'how_it_works', 'links', 'why_you'] as const;
/**
 * v4.10.1 Task 1: a plan or a claim the record can't show (a roadmap, grant milestones, the use of funds, money raised,
 * the team, usage numbers): the builder's to give whatever the program file's `from` says.
 */
const PLAN_KINDS = ['milestones', 'use_of_funds', 'raised', 'team', 'traction'] as const;
/**
 * A GTM plan field. v4.10.2 Task 1 (owner answer 2): a forward plan is a claim the record can't show, so it is the
 * builder's to give, as one line the agent expands (ready-copy.ts READY_YES_NOTE); v4.10.1's agent-drafted ruling R1 is
 * reversed.
 */
const GTM = /\bgtm\b|go[- ]to[- ]market/i;
export const isGtm = (r: Pick<DraftReq, 'key' | 'label'>) => GTM.test(`${r.key.replace(/_/g, ' ')} ${r.label}`);
/**
 * v4.10.1 Task 1 fix round 1: a contract address is a fact EarnKit holds (heldAnswers: the builder's owned contracts) or
 * the builder gives, never one the agent writes, whatever `from` says.
 */
const CONTRACT = /contract address/i;
/**
 * v4.10.1 Task 1: a required, not contact field the agent can't truthfully draft, so the builder must give it:
 * - a builder field (`from: 'builder'`) the agent can't draft (mustAsk: the team, usage, a demo video, a link, a
 *   choice or several, an amount, location or code), or of any kind outside AGENT_DRAFTABLE (how it makes money, the
 *   credits wanted, an integration; v4.10.2 Task 1: a GTM plan too);
 * - any field, whatever its `from`, that is a plan or a claim the record can't show (PLAN_KINDS: a GTM plan's kind),
 *   or a contract address EarnKit doesn't hold (fix round 1).
 * Pure.
 */
export function mustGive(r: DraftReq & { type?: string }): boolean {
  if (r.kind === 'contact') return false;
  if ((PLAN_KINDS as readonly string[]).includes(r.kind ?? '') || CONTRACT.test(r.label)) return true;
  if (r.from !== 'builder') return false;
  return mustAsk(r) || r.type === 'multi_choice' || !(AGENT_DRAFTABLE as readonly string[]).includes(r.kind ?? 'other');
}
/**
 * What the draft is and which blanks only the builder can fill (fix round 2, F1):
 * - an investor program with no public questions (every required field is a contact detail): a short founder brief,
 *   whose blanks are FOUNDER_BLANKS;
 * - otherwise the required fields EarnKit doesn't hold (`held`: the confirmed Builder Code, verified usage and revenue,
 *   the answer bank) and the agent can't truthfully draft (mustGive, v4.10.1), team first, at most MAX_BLANKS; `later`
 *   holds the rest. Contact details (name, email, handles) are typed when they submit, for every program, so never a
 *   blank. `drafted`: the builder fields the agent drafts for them to check. Pure.
 */
export function draftBlanks(
  p: { investment: boolean; submission_requirements: readonly (DraftReq & { type?: string })[] }, held: Record<string, string>,
): { brief: boolean; blanks: string[]; later: string[]; drafted: string[] } {
  const required = p.submission_requirements.filter((r) => r.required);
  if (p.investment && required.every((r) => r.kind === 'contact')) return { brief: true, blanks: [...FOUNDER_BLANKS], later: [], drafted: [] };
  const open = required.filter((r) => r.from === 'builder' && r.kind !== 'contact' && !held[r.key]?.trim());
  const ask = builderOnly(p, held).map((r) => r.todo ?? r.label.toLowerCase());
  return { brief: false, blanks: ask.slice(0, MAX_BLANKS), later: ask.slice(MAX_BLANKS), drafted: open.filter((r) => !mustGive(r)).map((r) => r.label) };
}
/**
 * v4.10 Task 4 (R5): the required fields only the builder can give (draftBlanks' blanks, as fields): not a contact
 * detail, not held, and one the agent can't truthfully draft (mustGive, v4.10.1 Task 1), the team, usage numbers and
 * demo video first, then the form's order. None for an investor program with no public questions (its founder brief's
 * blanks are the agent's to ask). Pure.
 */
export function builderOnly<R extends DraftReq & { type?: string }>(
  p: { investment: boolean; submission_requirements: readonly R[] }, held: Record<string, string>,
): R[] {
  const required = p.submission_requirements.filter((r) => r.required);
  if (p.investment && required.every((r) => r.kind === 'contact')) return [];
  const rank = (r: DraftReq) => {
    const i = (ASK_KINDS as readonly string[]).indexOf(r.kind ?? '');
    return i < 0 ? ASK_KINDS.length : i;
  };
  return required.filter((r) => !held[r.key]?.trim()).filter(mustGive).sort((a, b) => rank(a) - rank(b));
}

/**
 * Fix round 1 (T2-6): the gap stage's proof line, from what EarnKit knows. Base, with its remaining steps: neither
 * "put it on Base" nor "get people using it" left, "You're live on Base."; only Base's met, "You're on Base."; else
 * (and for another grant) proofLine's streak and live line. Null with nothing known. Pure.
 */
export function gapProof(p: { name: string; live: boolean }, streak: number, baseSteps: readonly string[] | null): string | null {
  return gapProofOf(p, streak, baseSteps, new Set())?.line ?? null;
}
/** Base's own fact, unless said this session: every step met but codes, "You're live on Base."; only Base's met, "You're on Base.". */
function baseProof(baseSteps: readonly string[], said: ReadonlySet<string>): Proof | null {
  if (baseSteps.includes('base')) return null;
  const [key, line] = baseSteps.includes('use') ? ['proof:base=on', "You're on Base."] : ['proof:base=live', "You're live on Base."];
  return said.has(key) ? null : { line, keys: [key] };
}
/** Task 6 fix round 1 (review 4): gapProof with its facts keyed and those said this session left out (proofOf). Pure. */
export function gapProofOf(p: { name: string; live: boolean }, streak: number, baseSteps: readonly string[] | null, said: ReadonlySet<string>): Proof | null {
  return (baseSteps ? baseProof(baseSteps, said) : null) ?? proofOf(p, streak, false, said);
}

/*
 * v4.8 Task 3: submit, track and the fresh session's "Since {day}" opener.
 * - submit: the finished draft's submit link and deadline in the program's own zone, the contact fields typed on the
 *   form (Task 2 ruling T2-1), then one easy reply: "sent".
 * - track: "sent" is `tell program_status applied`; the reply acknowledges it, gives the program file's odds when it
 *   states them (difficulty_override.basis), then hooks the next bestMove program.
 * - a fresh session: what changed since the last one (stored facts only) leads, then the path's current step.
 */

/** The submit stage's one easy reply (target conversation A, exact). */
export const SENT_ASK = `Reply "sent" once it's in, and I'll keep track of it for you.`;

/**
 * The submit stage's reply (target conversation A): "Done, it's ready to paste. Submit at {link} before {by}." then
 * the contact details the form asks for (typed there, never a draft blank: ruling T2-1), then SENT_ASK. A program with
 * no link or no deadline leaves that part out. Pure.
 */
export function submitReply(c: { link: string | null; by: string | null; contacts: readonly string[] }): string {
  const where = c.link ? ` Submit at ${c.link}${c.by ? ` before ${c.by}` : ''}.` : c.by ? ` Submit it before ${c.by}.` : '';
  const form = c.contacts.length > 0 ? ` The form also asks for ${andComma(c.contacts)}.` : '';
  return `Done, it's ready to paste.${where}${form}\n\n${SENT_ASK}`;
}

/**
 * A later find while the path waits at submit (never the full draft again): "Your {program} application is ready to
 * submit, closes {when}. Reply "sent" once it's in." (a rolling program: no close). Pure.
 */
export function submitPointer(p: Pick<MoveProgram, 'title' | 'when' | 'ends_at' | 'zone'>, now: Date): string {
  const closes = p.ends_at && p.when !== 'rolling' ? `, closes ${closeWords(p.ends_at, p.zone, now)}` : '';
  return `Your ${programName(p.title)} application is ready to submit${closes}. ${SENT_SHORT}`;
}

/**
 * v4.8 re-review blocker 2: the first no to the submit ask (not yet): "No rush, it stays ready until {close}. Reply
 * "sent" once it's in." (a rolling program: "No rush, it stays ready."). Pure.
 */
export function submitNoRush(p: Pick<MoveProgram, 'when' | 'ends_at' | 'zone'>, now: Date): string {
  // v4.8.1 Task 2: the time left reads "until it closes in 20 hours", a day "until Nov 5".
  const words = p.ends_at && p.when !== 'rolling' ? closeWords(p.ends_at, p.zone, now) : null;
  const until = words ? ` until ${words.startsWith('in ') ? `it closes ${words}` : words}` : '';
  return `No rush, it stays ready${until}. Reply "sent" once it's in.`;
}

/** v4.8 last ruling 2: the second no at submit's lead, before the next program. Pure. */
export const keepDraftLine = (title: string) => `I'll keep your ${programName(title)} draft ready.`;

/** Task 3 fix round 1 (2): a plain yes or ok to the submit ask is never "sent": the one easy reply again. */
export const SENT_AGAIN = `Once it's submitted, reply "sent" and I'll keep track of it.`;
/** The track stage's acknowledgement (target conversation A, exact). */
export const TRACK_ACK = "Nice, I'm tracking it.";
/**
 * The track reply's lead: TRACK_ACK, then the program file's odds (difficulty_override.basis, as written, its first letter
 * raised) and, when the next program is hooked in the same reply (`next`), "so let's line up money that's closer.". No
 * odds stated: the acknowledgement alone (never an invented rate). Pure.
 */
export function trackLead(odds: string | null, next: boolean): string {
  const o = odds?.trim().replace(/\.$/, '');
  if (!o) return TRACK_ACK;
  return `${TRACK_ACK} ${o.charAt(0).toUpperCase()}${o.slice(1)}${next ? ", so let's line up money that's closer." : '.'}`;
}

/** Whole UTC days from `at` to `now`. Pure. */
const daysAgo = (at: string, now: Date) => Math.round((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(new Date(at).toISOString().slice(0, 10))) / 86_400_000);
const weekday = (at: string) => new Date(at).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const monthDay = (at: string) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/**
 * The passed-step line (target A, said once: bestMove raises a passed step once, standing_seen.path_raised): "It's now the
 * only gap to that money." (`codes`: the one gap is Builder Codes, "That's now ...", v4.8.2 final fix F5).
 * v4.8.2 Task 1 (R2): it never says when or that the builder passed (no guilt). Pure.
 */
export const passedLine = (codes = false) => (codes ? "That's now the only gap to that money." : "It's now the only gap to that money.");

/** "Since earlier today", "Since yesterday", "Since Thursday" (within a week), else "Since Oct 24" (UTC days). Pure. */
export function sinceDay(at: string, now: Date): string {
  const days = daysAgo(at, now);
  if (days <= 0) return 'Since earlier today';
  if (days === 1) return 'Since yesterday';
  return `Since ${days < 7 ? weekday(at) : monthDay(at)}`;
}

/**
 * What changed since the last session, from stored facts only (bench-find.ts sinceFacts). Each part is present only
 * when EarnKit holds both sides of the change: `streak` (then and now, streak.ts over the stored commit weeks), `score`
 * (the last public daily score on or before the last session's day, builder_scores, and the page's score now),
 * `opened` (programs the path names that opened since, new to this builder) and `closing` (the path's program, closing
 * within 48 hours, when the step's own words don't already say it). Announced results lead find on their own (alerts).
 */
export type SinceFacts = {
  last: string;
  streak?: { before: number; now: number } | null;
  score?: { before: number; now: number } | null;
  opened?: string[];
  closing?: { program: string; when: string } | null;
};
/**
 * The fresh session's lead (target A, "Two days later"): "Since {day}: 1 more week shipped, so your streak is 7 weeks
 * and your score is up to 79." then any opened program or close, each a short sentence. Null when nothing
 * changed (the step alone answers). Never a guessed change: a side EarnKit doesn't hold leaves that part out. Pure.
 */
export function sinceLine(f: SinceFacts, now: Date): string | null {
  const more = f.streak ? f.streak.now - f.streak.before : 0;
  const ship = f.streak && more > 0 ? `${more} more ${more === 1 ? 'week' : 'weeks'} shipped, so your streak is ${weeks(f.streak.now)}` : null;
  const score = f.score && f.score.now !== f.score.before ? `your score is ${f.score.now > f.score.before ? 'up' : 'down'} to ${f.score.now}` : null;
  const first = ship && score ? `${ship} and ${score}` : ship ?? score;
  const parts = [
    first ? `${first}.` : null,
    ...(f.opened ?? []).map((p) => `${p} opened.`),
    f.closing ? `${f.closing.program} closes ${f.closing.when}.` : null,
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? `${sinceDay(f.last, now)}: ${parts.join(' ')}` : null;
}

/** The fresh session's draft offer once the path's gap is closed (target A, "Two days later", exact ask). */
/** Task 6 fix round 1 (review 2): target A's offer, its question last (the easy reply ends the message). */
export const DRAFT_NOW_ASK = 'It takes me a few minutes. Draft it now?';
/** "Base Builder Grant is still open and you now meet its first requirement." (the closed gap, in a fresh session). Pure. */
export const stillOpenLine = (title: string, codes: boolean) =>
  `${programName(title)} is still open${codes ? ' and you now meet its first requirement' : ' and its steps are done'}.`;

/*
 * v4.8 Task 4: the new builder (target conversation B).
 * - Before GitHub is connected, the first reply is the opener: what EarnKit does and the grants total, three numbered
 *   open programs (bench-find.ts openerPrograms, target B's order: Base Builder Grants, else the best rolling grant;
 *   the largest other open grant; the soonest investor program) and the one link the signed-out reply already uses.
 *   The numbered list is kept (standing_seen.opener).
 * - A number or a program's name (find {program}) picks one: the path's program at `hook`, `picked`.
 * - The first path reply after connecting says the profile and the tracking line once a builder (connected_said),
 *   then the pick's fit (pickHook): the pick whenever it is a move on its own; otherwise why not, in one line from the
 *   program's own facts, then the path's real top move without it (the closest money, "Want the steps?" for a grant).
 *   Never a claim that they qualify.
 */

/** A program the opener numbers: its title, its money ("up to $5,000", "$5K to $100K"), when ("rolling", "closes Nov 1"). */
export type OpenerProgram = { id: string; title: string; amount: string | null; when: string; investment: boolean };
/** The opener's first line: what EarnKit does, and the open grants' total when there is one. Pure. */
export const openerHead = (total: string | null) =>
  `I'm EarnKit. I get builders funded for what they ship${total ? `, and there's ${total} in grants open right now` : ''}.`;
/** "1. Base Builder Grant: up to $5,000, rolling"; an investor program says so. Pure. */
const openerLine = (p: OpenerProgram, i: number) =>
  `${i + 1}. ${programName(p.title)}${p.investment ? ' (investor program)' : ''}: ${p.amount ? `${p.amount}, ` : ''}${p.when}`;
/**
 * What the one link does, in words: the repo picker's link (X sign-in off) connects GitHub; the X sign-in link is the
 * first step of connecting, so it is never called GitHub (ruling: the copy never says a link does what it doesn't). Pure.
 */
const connectWords = (github: boolean) => (github ? 'connect GitHub here' : 'connect here');
const fitsAsk = (github: boolean, link: string) => `${connectWords(github)} so I can check if your work fits: ${link}`;
/** Target B's opener: the head, the numbered programs, then the number and the one link (last). Pure. */
export function openerReply(o: { total: string | null; programs: readonly OpenerProgram[]; link: string; github: boolean }): string {
  return `${openerHead(o.total)}\n\n${o.programs.map(openerLine).join('\n')}\n\nReply with a number, and ${fitsAsk(o.github, o.link)}`;
}
/** "1 for A, 2 for B or 3 for C". Pure. */
const orList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);
/**
 * The list again in one short line (a number outside it, or the opener already said this session): "Reply 1 for
 * Circle Developer Grants, 2 for Base Builder Grant or 3 for a16z speedrun SR008, and connect here ...: {link}". Pure.
 */
export const openerAgain = (programs: readonly Pick<OpenerProgram, 'title'>[], link: string, github: boolean) =>
  `Reply ${orList(programs.map((p, i) => `${i + 1} for ${programName(p.title)}`))}, and ${fitsAsk(github, link)}`;
/** A pick before connecting: "Got it: Base Builder Grant. Connect here so I can check if your work fits: {link}". Pure. */
export const pickedReply = (title: string, link: string, github: boolean) => {
  const ask = fitsAsk(github, link);
  return `Got it: ${programName(title)}. ${ask.charAt(0).toUpperCase()}${ask.slice(1)}`;
};
/**
 * The builder's pick against the numbered list shown: "2", "#2" or "2." is that program ('outside' past the list); a
 * name is the program whose name it holds, or that holds it (3 letters or more). Null when nothing matches. Pure.
 */
export function resolvePick(input: string, list: readonly Pick<OpenerProgram, 'id' | 'title'>[]): string | 'outside' | null {
  const t = input.trim().toLowerCase();
  const num = /^#?(\d{1,3})\.?$/.exec(t);
  if (num) {
    const i = Number(num[1]) - 1;
    return i >= 0 && i < list.length ? list[i].id : 'outside';
  }
  // Fix round 1 (6): a generic word names no program; a name more than one program holds is no pick either.
  if (t.length < 3 || GENERIC_PICK.test(t)) return null;
  const hits = list.filter((p) => {
    const name = programName(p.title).toLowerCase();
    return name.includes(t) || t.includes(name) || p.title.toLowerCase().includes(t);
  });
  return hits.length === 1 ? hits[0].id : null;
}
/** Words every program name could hold ("the grant", "investor program", "builder"): never a pick on their own. */
const GENERIC_PICK = /^(?:the |a |an )?(?:grants?|programs?|investor(?: programs?)?|investments?|builders?|developers?|funds?|funding|money)$/;
/**
 * Fix round 1 (2): what the first reply after connecting hooks for a pick. The pick itself whenever it is a move on its
 * own (a real fit, an investor program inside the window, a grant whose gap the path names), whatever else ranks above
 * it (`pick`). Otherwise the path's real top move without the pick and without investor programs (the closest money:
 * a real fit still beats a gap grant), a one-step grant shown as the closest, asked for the steps (`steps`); with no
 * grant or fit, any move. Null with nothing to hook. Pure.
 */
export function pickHook(ctx: MoveCtx, pick: string): { move: Exclude<Move, { kind: 'quiet' }>; pick: boolean; steps: boolean } | null {
  const only = <P extends { id: string }>(xs: P[]) => xs.filter((x) => x.id === pick);
  // v4.8.1 fix round 1: the pick as a stored hook path, so a picked long shot is kept whatever its close (bestMove's kept).
  const picked: Path = { stage: 'hook', program_id: pick, at: ctx.now.toISOString(), picked: true };
  const own = bestMove({ ...ctx, fits: only(ctx.fits), grants: only(ctx.grants), investors: only(ctx.investors), path: picked });
  if (own.kind !== 'quiet') return { move: own, pick: true, steps: false };
  const skip = new Set([...ctx.skip, pick]);
  const near = bestMove({ ...ctx, investors: [], skip, path: null });
  const alt = near.kind !== 'quiet' ? near : bestMove({ ...ctx, skip, path: null });
  if (alt.kind === 'quiet') return null;
  if (alt.kind === 'one_step') return { move: { kind: 'closest', program: alt.program, raise: false }, pick: false, steps: true };
  return { move: alt, pick: false, steps: alt.kind === 'closest' };
}
/**
 * The first line after connecting (target B, said once a builder): "Connected. I'll track every commit you push, so your
 * profile stays current without you lifting a finger: earnkit.com/maya, score 54, #3 of 40 builders." (the rank only
 * with 2 or more builders). Fix round 0 (4): a score of 0 or none says neither the score nor the rank: "... so your
 * profile fills in without you lifting a finger: earnkit.com/maya.". Pure.
 */
export function connectedLine(o: { page: string; score: number | null; rank: { n: number; m: number } | null }): string {
  if (o.score === null || o.score <= 0) return `Connected. I'll track every commit you push, so your profile fills in without you lifting a finger: ${o.page}.`;
  const parts = [o.page, `score ${o.score}`, o.rank && o.rank.m >= 2 ? `#${o.rank.n} of ${o.rank.m} builders` : null];
  return `Connected. I'll track every commit you push, so your profile stays current without you lifting a finger: ${parts.filter(Boolean).join(', ')}.`;
}
/** Fix round 0 (7): a picked investor program not within the path's window, said before the closest money. Pure. */
export const investorLater = (title: string) => `${programName(title)} is an investor program, so I'll help you prepare when it gets closer.`;
/**
 * Why the pick doesn't fit, in one line, from the program's own facts: its one chain the project isn't on ("they fund
 * apps on Arc, and EarnKit isn't on Arc yet."), programNeeds' gaps ("EarnKit isn't on Arc mainnet yet."), or the
 * path's gap sentence (Base's qualifyGap). Pure.
 */
export function noFitWhy(title: string, w: { name: string; chain?: string; needs?: readonly string[]; gap?: string }): string {
  const why = w.chain ? `they fund apps on ${w.chain}, and ${w.name} isn't on ${w.chain} yet.`
    : w.needs?.length ? `${w.name} isn't ${andComma(w.needs)} yet.` : (w.gap ?? '');
  return `For ${programName(title)}: ${why}`;
}
/** The opener's agent note: a number or a program's name goes back to find as `program`. */
export const OPENER_NOTE = "When they reply with a number or a program's name, call find with program set to their reply.";

/*
 * v4.8 Task 5: the direct questions (target conversation C). find {ask: 'standing'} and {ask: 'programs'} are answered
 * in one short reply, then the path's step (its own words, or its pointer) with its one easy reply, last. The same ask
 * again in a session is one line that points back (`ask:standing`, `ask:programs` in standing_seen.said).
 */
/**
 * The key a direct answer is said under: the question and what the answer said (fix round 1 (3)), so the same ask with
 * changed facts is a new answer, never "Same as". Reset with the session (SESSION_MS), as every said part.
 */
export const ASK_SAID = (ask: 'standing' | 'programs', said: string) => `ask:${ask}:${said}`;
/** The standing answer's facts: the page's score and rank (rank.ts rankWords, listed only), the streak, the page. */
export type StandingFacts = {
  score: number | null; rank: string | null; streak: number;
  /** The live link's host ("earnkit.com"), only when EarnKit checked the link (live-check.ts); else no live clause. */
  liveAt: string | null;
  /** The builder's page (reserved-routes.ts pageUrl). */
  page: string;
};
const PROFILE_FILLS = 'Your profile fills in as your commits come in.';
const hasScore = (f: Pick<StandingFacts, 'score'>) => f.score !== null && f.score > 0;
/** What a standing answer said, for its repeat key: the score and the rank (a score of 0 or none says neither). Pure. */
export const standingSaid = (f: Pick<StandingFacts, 'score' | 'rank'> & Partial<StandingFacts>) => (hasScore(f) ? `${f.score}|${f.rank ?? ''}` : '-');
/**
 * Target C (exact): "Score 77, #1 of 1 builders so far. It comes from your GitHub: 6 weeks shipping in a row, live at
 * earnkit.com. Programs see it at earnkit.com/jenilt." A part not known is left out. A score of 0 or unknown: no score
 * and no rank, "Your profile fills in as your commits come in." and the page. Pure.
 */
export function standingAnswer(f: StandingFacts): string {
  const where = `Programs see it at ${f.page}.`;
  if (!hasScore(f)) return `${PROFILE_FILLS} ${where}`;
  const parts = [
    f.streak >= 2 ? `${f.streak} weeks shipping in a row` : f.streak === 1 ? '1 week shipping' : null,
    f.liveAt ? `live at ${f.liveAt}` : null,
  ].filter((x): x is string => x !== null);
  return `Score ${f.score}${f.rank ? `, ${f.rank}` : ''}. It comes from your GitHub${parts.length > 0 ? `: ${parts.join(', ')}` : ''}. ${where}`;
}
/** The standing asked again in the session, nothing changed: "Same as earlier: #1 of 1, score 77." Pure. */
export function standingAgain(f: Pick<StandingFacts, 'score' | 'rank'>): string {
  if (!hasScore(f)) return `Same as earlier: ${PROFILE_FILLS.charAt(0).toLowerCase()}${PROFILE_FILLS.slice(1)}`;
  const rank = f.rank?.replace(/ builders so far$/, '') ?? null;
  return `Same as earlier: ${rank ? `${rank}, ` : ''}score ${f.score}.`;
}
/** Fix round 1 (8): a reply whose show_to_builder already opens with the answer; the note never asks for a second one. */
export const ANSWERED_FIRST = 'Their question is already answered first in show_to_builder: keep it first and answer it only once.';

/** The programs asked again in the session, the same list. */
export const PROGRAMS_AGAIN = 'Same list as earlier.';
/** The mentor line after the investor programs (owner decision 2026-10-31: an offer to help prepare). */
export const PREPARE_LINE = 'If one of these is your plan, I can help you prepare.';
/** Final review 9 (the parked T5 line): PREPARE_LINE with one investor program. */
export const PREPARE_LINE_ONE = "If it's your plan, I can help you prepare.";
/** A grant's step as the fit cell says it: Base's steps (bench-reply.ts QualifyStep) and programNeeds' gaps. */
const STEP_WORDS: Record<string, string> = {
  codes: 'add Builder Codes', base: 'put the app on Base', use: 'get people using it', 'in a public repo': 'make the repo public', 'live at a link': 'go live at a link',
};
const stepWords = (g: string) => STEP_WORDS[g] ?? g.replace(/^on (.+ mainnet)$/, 'deploy on $1');
/**
 * Fix round 1 (1): what EarnKit knows of a grant the project doesn't fit, the one rule behind Task 4's pick why line
 * (bench-find.ts pickWhy) and the programs answer's fit cell: its gaps (steps) first; else the one chain it funds that
 * the project isn't on; else none known (`gaps` read, empty) or unknown (not read). The fit cell adds drafted and every
 * step met (Base). `chainName` names a chain id ("arc" as "Arc"). Pure.
 */
export type GrantFact =
  | { kind: 'steps'; gaps: readonly string[] } | { kind: 'chain'; chain: string } | { kind: 'none' } | { kind: 'unknown' }
  | { kind: 'drafted' } | { kind: 'met' };
export function grantFact(gaps: readonly string[] | null, chains: readonly string[], mine: ReadonlySet<string>, chainName: (c: string) => string): GrantFact {
  if (gaps && gaps.length > 0) return { kind: 'steps', gaps };
  if (chains.length === 1 && !mine.has(chains[0].toLowerCase())) return { kind: 'chain', chain: chainName(chains[0]) };
  return gaps ? { kind: 'none' } : { kind: 'unknown' };
}
/**
 * The grants' "Your fit", from stored facts only: "Fits" (a real fit), "1 step: {step}", "{n} steps", "Drafted", "Steps
 * met", else "Not yet: {why}" ("they look for apps on Arc"; "EarnKit can't see its needs yet"; "not checked yet"). Never "qualify". Pure.
 */
export function fitCell(fits: boolean, f: GrantFact): string {
  if (fits) return 'Fits';
  if (f.kind === 'drafted') return 'Drafted';
  if (f.kind === 'met') return 'Steps met';
  if (f.kind === 'steps') return f.gaps.length === 1 ? `1 step: ${stepWords(f.gaps[0])}` : `${f.gaps.length} steps`;
  // v4.8.1 Task 3 (R5): what the program looks for, never a bare "needs".
  if (f.kind === 'chain') return `Not yet: they look for apps on ${f.chain}`;
  return `Not yet: ${f.kind === 'none' ? "EarnKit can't see its needs yet" : 'not checked yet'}`;
}
/** The grants' order: fits, drafted, steps met, fewest steps, a chain away, then nothing known. Pure. */
export function fitOrder(fits: boolean, f: GrantFact): number {
  if (fits) return 0;
  return f.kind === 'drafted' ? 1 : f.kind === 'met' ? 2 : f.kind === 'steps' ? 2 + f.gaps.length : f.kind === 'chain' ? 50 : f.kind === 'none' ? 60 : 99;
}
export type GrantRow = { title: string; amount: string | null; when: string; fit: string };
export type InvestorRow = { title: string; amount: string | null; when: string; what: string };
const closesCell = (when: string) => (when === 'rolling' ? 'Rolling' : when.replace(/^closes\s+/, ''));
const moneyCell = (a: string | null) => a ?? 'Not stated';
/** A table only when comparing more than two (Voice; fix round 1 (4) ruling): from this many rows. */
export const TABLE_FROM = 3;
const lowerFirst = (x: string) => `${x.charAt(0).toLowerCase()}${x.slice(1)}`;
/** One grant as a line: "Base Builder Grant: up to $5,000, rolling. Your fit: 1 step, add Builder Codes." Pure. */
const grantLine = (r: GrantRow) =>
  `${programName(r.title)}: ${[r.amount, r.when].filter(Boolean).join(', ')}. ${r.fit === 'Fits' ? 'It fits.' : `Your fit: ${lowerFirst(r.fit).replace(': ', ', ')}.`}`;
/** One investor program as a line: "a16z speedrun SR008 (investor program): up to $1M, closes Nov 1. {what it is}" Pure. */
const investorLine = (r: InvestorRow) =>
  `${programName(r.title)} (investor program): ${[r.amount, r.when].filter(Boolean).join(', ')}.${r.what === INVESTOR_WHAT ? '' : ` ${r.what}`}`;
/** whatItIs with no description: the class alone (a line says it already). */
const INVESTOR_WHAT = 'Investor program';
/**
 * Target C's "what can I apply to": the open grants (from TABLE_FROM rows a table, Grant | Money | Closes | Your fit;
 * fewer, one line each), then the open investor programs apart (a table, Program | Money | Closes | What it is, or one
 * line each, "(investor program)") and the mentor line. Never a total. No grants open: one line. Pure.
 */
export function programsAnswer(grants: readonly GrantRow[], investors: readonly InvestorRow[]): string {
  const g = grants.length === 0 ? 'No grants are open right now.'
    : grants.length >= TABLE_FROM
      ? `Grants open now:\n\n${table(['Grant', 'Money', 'Closes', 'Your fit'], grants.map((r) => [programName(r.title), moneyCell(r.amount), closesCell(r.when), r.fit]))}`
      : `Grants open now:\n\n${grants.map(grantLine).join('\n')}`;
  if (investors.length === 0) return g;
  const i = investors.length >= TABLE_FROM
    ? `Investor programs:\n\n${table(['Program', 'Money', 'Closes', 'What it is'], investors.map((r) => [programName(r.title), moneyCell(r.amount), closesCell(r.when), r.what]))}`
    : investors.map(investorLine).join('\n');
  return `${g}\n\n${i}\n\n${investors.length === 1 ? PREPARE_LINE_ONE : PREPARE_LINE}`;
}
/** A program file's description as "What it is": its first sentence, else "Investor program". Pure. */
export function whatItIs(description: string | null | undefined): string {
  const d = description?.trim();
  if (!d) return INVESTOR_WHAT;
  const m = /^(.+?[.!?])(\s|$)/.exec(d);
  return m ? m[1] : d;
}
