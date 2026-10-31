import { sql } from './db';
import { zoneParts } from './deadline';

/**
 * v4.8 "the launch conversation" (docs/design-docs-and-implementation-plans/v4.8-target-conversation.md): EarnKit leads.
 * Each builder walks one path toward a submitted application (standing_seen.path), every reply ends in one easy reply
 * (a yes, a number or "sent"), and a part already said in this session is never said again (standing_seen.said).
 * bench-find.ts gathers the facts (fits, open grants and their gaps, investor programs, what to skip); everything here is
 * pure except setPath and markSaid, the two writes. Task 1 builds the `hook` stage only; Tasks 2 to 5 add the rest.
 */

/** The path's stages: hook (an open program named for them), gap, draft, submit (waiting for "sent"), track. */
export type Stage = 'hook' | 'gap' | 'draft' | 'submit' | 'track';
export const STAGES: readonly Stage[] = ['hook', 'gap', 'draft', 'submit', 'track'];
/**
 * standing_seen.path. `program_id` may be set before the builder is ranked (Task 4: a new builder's pick), and is null
 * when the path has no program yet. `picked`: the builder chose the program (Task 4), so the path keeps it even at the
 * hook stage; a hook EarnKit chose is picked again on every reply (bestMove).
 */
export type Path = { stage: Stage; program_id: string | null; at: string; picked?: true };

/** The stored path, or null when there is none or it isn't one EarnKit wrote. Pure. */
export function readPath(seen: { path?: unknown } | null | undefined): Path | null {
  const p = seen?.path;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const { stage, program_id, at } = p as Record<string, unknown>;
  if (typeof stage !== 'string' || !(STAGES as readonly string[]).includes(stage)) return null;
  if (program_id !== null && program_id !== undefined && typeof program_id !== 'string') return null;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  return { stage: stage as Stage, program_id: program_id ?? null, at, ...((p as { picked?: unknown }).picked === true && { picked: true as const }) };
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
 * Records `keys` as said in this session and stamps it `now` (an empty list only keeps the session alive). Keys said
 * before SESSION_MS of quiet are dropped first, in the same UPDATE. Never throws.
 */
export async function markSaid(id: number, keys: string[], now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - SESSION_MS).toISOString();
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('said', jsonb_build_object(
      'at', ${now.toISOString()}::text,
      'keys', COALESCE((SELECT jsonb_agg(DISTINCT k) FROM jsonb_array_elements_text(
        CASE WHEN standing_seen->'said'->>'at' > ${cutoff} AND jsonb_typeof(standing_seen->'said'->'keys') = 'array'
          THEN standing_seen->'said'->'keys' ELSE '[]'::jsonb END || ${sql().json(keys as never)}::jsonb) AS k), '[]'::jsonb)))
    WHERE builder_id = ${id}`.catch((err: unknown) => {
    console.error('[conversation] mark said', err instanceof Error ? err.name : 'error');
  });
}

/**
 * The agent note on every path reply (architecture, exact copy): the agent rewords EarnKit's facts in the mentor's
 * voice, keeps every fact exactly, asks for the one reply given, and does a step it can do on a yes.
 */
export const MENTOR_NOTE =
  "Say this in your own words as EarnKit, a mentor who wants them funded: keep every fact, amount, date and link exactly, ask for only the one reply given and put it last. When they say yes to a step you can do, do it, then call find. Don't show this note.";

/** An open program as the path names it. `when` is fundWhen's ("rolling", "closes Nov 1"); `zone` its IANA zone. */
export type MoveProgram = {
  id: string; title: string;
  /** The prize part as the program states it ("up to $5,000", "up to $1M"), null when unknown. */
  amount: string | null;
  when: string; ends_at: string | null; zone: string; investment: boolean;
};
/**
 * An open grant the project doesn't fit, with what it needs: `gaps` (each a step; none known: it can apply now), `gap`
 * (the sentence naming them, bench-reply.ts qualifyGap or needsWhy), `passed` (the builder passed on these steps within
 * DECLINE_MS) and `doable` (its one gap is a step the agent can do in the repo, like Builder Codes; never a chain
 * deployment such as "on Arc mainnet", a live product or making a repo public).
 */
export type GapGrant = MoveProgram & { gaps: string[]; gap: string; passed: boolean; doable: boolean };
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
  path: Path | null;
};
export type Move =
  | { kind: 'fit'; program: MoveProgram }
  /** Closing within NOW_WINDOW_MS with no gap: a grant with none known, or an investor program. */
  | { kind: 'now'; program: MoveProgram | InvestorProgram }
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
 * The program the path leads with, in this order (fix round 1, controller ruling R1):
 * 1. a real fit not applied to or drafted, closing first (rolling last);
 * 2. a program (grant or investor) closing within NOW_WINDOW_MS (48 hours) the builder can apply to now with no gap;
 * 3. a grant one step away where that step is one the agent can do in the repo (`doable`: Builder Codes; a chain
 *    deployment never counts), not a step the builder passed on;
 * 4. an investor program closing within INVESTOR_WINDOW_MS, soonest first, with its odds when stated;
 * 5. the closest grant by number of gaps (a passed step only when it is the one gap, and only once);
 * 6. otherwise quiet: the reply's older asks (check-in, wallet, token, new repo, titles, then the ship line).
 * Anything in `skip` is never a move. A program on the stored path that is still one of 1 to 4 keeps its place when
 * the builder is on it: they picked it, or said yes past the hook (gap, draft, submit, track). An investor program is
 * never a fit. Pure.
 */
export function bestMove(ctx: MoveCtx): Move {
  const t = ctx.now.getTime();
  const open = <P extends MoveProgram>(p: P) => !ctx.skip.has(p.id) && closeAt(p) > t;
  const fits = ctx.fits.filter((p) => open(p) && !p.investment).sort(byClose);
  const soon = (p: MoveProgram, ms: number) => closeAt(p) - t <= ms;
  const noGap = ctx.grants.filter((g) => open(g) && !g.investment && g.gaps.length === 0 && soon(g, NOW_WINDOW_MS));
  const grants = ctx.grants.filter((g) => open(g) && !g.investment && g.gaps.length > 0);
  const investors = ctx.investors.filter((p) => open(p) && p.investment && soon(p, INVESTOR_WINDOW_MS)).sort(byClose);
  const now: (MoveProgram | InvestorProgram)[] = [...noGap, ...investors.filter((p) => soon(p, NOW_WINDOW_MS))].sort(byClose);
  const oneStep = grants.filter((g) => g.gaps.length === 1 && g.doable && !g.passed).sort(byClose);
  const closest = grants
    .filter((g) => !g.passed || (g.gaps.length === 1 && !ctx.raised.has(g.id)))
    .sort((a, b) => a.gaps.length - b.gaps.length || byClose(a, b));
  const moves: Exclude<Move, { kind: 'quiet' }>[] = [
    ...fits.map((program) => ({ kind: 'fit' as const, program })),
    ...now.map((program) => ({ kind: 'now' as const, program })),
    ...oneStep.map((program) => ({ kind: 'one_step' as const, program })),
    ...investors.map((program) => ({ kind: 'investor' as const, program })),
    ...closest.filter((g) => !oneStep.includes(g)).map((program) => ({ kind: 'closest' as const, program, raise: program.passed })),
  ];
  const on = ctx.path?.program_id && (ctx.path.picked || ctx.path.stage !== 'hook') ? ctx.path.program_id : null;
  const kept = on ? moves.find((m) => m.program.id === on) : undefined;
  return kept ?? moves[0] ?? { kind: 'quiet' };
}

/** A program's name in a sentence: its title before any ':' and without a trailing " Program". Pure. */
export const programName = (title: string) => title.split(':')[0].trim().replace(/\s+Program$/i, '');

/**
 * When a dated program closes, in the program's zone, as a person says it: "tonight" or "today", "tomorrow night" or
 * "tomorrow", else its day ("Nov 5"). Night is a close at 6 PM or later. Pure.
 */
export function closeWords(endsAt: string, zone: string, now: Date): string {
  const end = zoneParts(new Date(endsAt), zone);
  const night = end.hour >= 18;
  if (end.day === zoneParts(now, zone).day) return night ? 'tonight' : 'today';
  if (end.day === zoneParts(new Date(now.getTime() + 86_400_000), zone).day) return night ? 'tomorrow night' : 'tomorrow';
  return end.day;
}

/** "6 weeks", "1 week". Pure. */
const weeks = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;
/**
 * The proof line: a fact only EarnKit holds (the shipping streak, the project live), or null with neither. For an
 * investor program it says why it matters to them. Pure.
 */
export function proofLine(p: { name: string; live: boolean }, streak: number, investor: boolean): string | null {
  const parts = [streak > 0 ? `You've shipped ${weeks(streak)} in a row` : null, p.live ? `${p.name} is live` : null].filter((x): x is string => x !== null);
  if (parts.length === 0) return null;
  const line = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0];
  return `${line}${investor ? ', which is the traction they ask about' : ''}.`;
}

/** The hook's easy replies: a draft (fit, investor) or the steps (a grant with a gap). */
export const START_ASK = 'Want me to start?';
export const STEPS_ASK = 'Want the steps?';
export const draftOffer = (live: boolean) => `I can draft your application from your commits${live ? ' and live product' : ''} in a few minutes. ${START_ASK}`;

export type PathCtx = {
  now: Date;
  /** The builder's first name (bench-reply.ts firstName). */
  first: string;
  project: { name: string; live: boolean };
  streak: number;
  move: Exclude<Move, { kind: 'quiet' }>;
  /** What this session already said (sessionOf). */
  said: Set<string>;
};
export type PathReply = {
  stage: Stage; program_id: string;
  show_to_builder: string;
  /** The parts this reply says, for markSaid. */
  said: string[];
  /** The easy reply it ends with. */
  reply: 'start' | 'steps';
};

/**
 * The path's reply. Task 1: the `hook` stage for every move (the later stages fall back to it until Tasks 2 to 5):
 * - a fit or an investor program: "{first}, {program} closes {when}: {amount}." + the proof line, then the draft offer
 *   ending "Want me to start?" (A's opener);
 * - a grant with a gap: its money and the gap sentence + the proof line, then "Want the steps?".
 * The same hook a second time in a session is one line that points back, with the same easy reply. A proof line said
 * already this session is left out. Pure.
 */
export function pathReply(c: PathCtx): PathReply {
  const m = c.move;
  const p = m.program;
  const name = programName(p.title);
  const reply: PathReply['reply'] = m.kind === 'fit' || m.kind === 'now' || m.kind === 'investor' ? 'start' : 'steps';
  const ask = reply === 'start' ? START_ASK : STEPS_ASK;
  const hookKey = `hook:${p.id}`;
  // Merge gate (Task 6), fix round 1 ruling R2: a pointer (the same step again within a session) is exempt from the
  // proof-line rule; it is one line that points back, with the same easy reply.
  if (c.said.has(hookKey)) {
    const point = reply === 'start' ? `Your ${name} application is still the next move.` : `${name} is still your closest money.`;
    return { stage: 'hook', program_id: p.id, show_to_builder: `${point} ${ask}`, said: [], reply };
  }
  const proof = proofLine(c.project, c.streak, p.investment);
  const proofKey = proof ? `proof:${proof}` : null;
  const proofSaid = proofKey !== null && c.said.has(proofKey);
  const dated = p.ends_at !== null && p.when !== 'rolling';
  const closes = dated ? closeWords(p.ends_at!, p.zone, c.now) : null;
  let money: string;
  if (reply === 'start') {
    money = closes ? `${c.first}, ${name} closes ${closes}${p.amount ? `: ${p.amount}` : ''}.` : `${c.first}, ${name} is open now${p.amount ? `: ${p.amount}` : ''}.`;
  } else {
    const g = p as GapGrant;
    const head = m.kind === 'closest' ? `${c.first}, your closest money is ${name}` : `${c.first}, ${name}`;
    const pays = p.amount ? (m.kind === 'closest' ? `: ${p.amount}` : ` pays ${p.amount}`) : m.kind === 'closest' ? '' : ' is open';
    money = `${head}${pays}${closes ? `, closing ${closes}` : ''}. ${g.gap}`;
  }
  const first = [money, proof && !proofSaid ? proof : null].filter(Boolean).join(' ');
  const second = reply === 'start' ? draftOffer(c.project.live) : STEPS_ASK;
  return {
    stage: 'hook', program_id: p.id,
    show_to_builder: `${first}\n\n${second}`,
    said: [hookKey, `money:${p.id}`, ...(proofKey && !proofSaid ? [proofKey] : [])],
    reply,
  };
}
