import { sql } from '../db';
import { mcpCall, type McpResult } from './mcp-call';
import type { ToolContext } from '../tools';

/**
 * v4.8 Task 6: whole conversations as the merge gate. `converse` plays a lazy builder's turns through the real MCP
 * tools (find and tell, formatted as the route formats them) and keeps what the builder sees; `gateFailures` checks
 * every reply against the merge gate (implementer contract, "The merge gate"). The fixture test
 * (v48-conversation.test.ts) and the snapshot replay (scripts/converse-replay.mts) share both.
 */

export type Turn = (
  | { find: { ask?: 'standing' | 'programs'; program?: string } }
  | { tell: Record<string, unknown> }
  | { wait: number }
) & {
  /** What the builder says, for the transcript ("sure", "sent"). */
  says?: string;
  /** Work done outside EarnKit before this turn (the agent pushed a change); the fixture's fake GitHub, never a network. */
  before?: () => Promise<void> | void;
};

export type Reply = {
  /** The turn's index in `turns`. */
  turn: number;
  /** Counted from 0; a `wait` starts the next one. */
  session: number;
  /** The first reply of its session. */
  first: boolean;
  /** A hook reply: it said a new `hook:<program>` part this session (standing_seen.said, the structured marker). */
  hook: boolean;
  tool: 'find' | 'tell';
  input: Record<string, unknown>;
  says?: string;
  /** What the builder sees: show_to_builder, formatted as the route formats it. */
  show: string;
  /** The parts this reply said for the first time this session (standing_seen.said keys). */
  said: string[];
  /** The tool's whole JSON reply (null for an error text). */
  reply: Record<string, unknown> | null;
};

export type Call = (tool: 'find' | 'tell', args: Record<string, unknown>) => Promise<McpResult>;

async function saidKeys(id: number): Promise<{ at: string | null; keys: string[] }> {
  const [r] = await sql()<{ s: { said?: { at?: unknown; keys?: unknown } } | null }[]>`
    SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`;
  const said = r?.s?.said;
  return {
    at: typeof said?.at === 'string' ? said.at : null,
    keys: Array.isArray(said?.keys) ? said.keys.filter((k): k is string => typeof k === 'string') : [],
  };
}

/** The wait: the session's last activity moves `ms` into the past (the "Since" tests' back-dating), so the next call is a new session. */
async function wait(id: number, ms: number): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('said', jsonb_build_object(
      'at', to_char((COALESCE((standing_seen->'said'->>'at')::timestamptz, now()) - ${`${ms} milliseconds`}::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'keys', COALESCE(standing_seen->'said'->'keys', '[]'::jsonb)))
    WHERE builder_id = ${id} AND standing_seen ? 'said'`;
}

/**
 * One builder's conversation, a turn at a time (the replay picks each next turn from the last reply, as a lazy agent
 * would). `target` is the tool context (or an installation id, which is its own builder). A `wait` back-dates the
 * session and returns null; `o.call` replaces the call (a test's env, the replay's stubs).
 */
export function conversation(target: ToolContext | number, o: { call?: Call; builderId?: number } = {}) {
  const ctx = typeof target === 'number' ? ({ installationId: target, ownInstallationId: target, sharedClient: false } as ToolContext) : target;
  const id = o.builderId ?? ctx.installationId;
  const call: Call = o.call ?? ((tool, args) => mcpCall(ctx, tool, args, { format: true }));
  let session = 0;
  let first = true;
  let n = 0;
  return async (t: Turn): Promise<Reply | null> => {
    const i = n++;
    await t.before?.();
    if ('wait' in t) {
      await wait(id, t.wait);
      session++;
      first = true;
      return null;
    }
    const [tool, input] = 'find' in t ? (['find', t.find] as const) : (['tell', t.tell] as const);
    const was = await saidKeys(id).catch(() => ({ at: null, keys: [] as string[] }));
    const r = await call(tool, input);
    const now = await saidKeys(id).catch(() => ({ at: null, keys: [] as string[] }));
    // A reset (the session's said keys started over) counts every key now held as new.
    const fresh = now.at !== was.at && now.keys.length < was.keys.length;
    const said = fresh ? now.keys : now.keys.filter((k) => !was.keys.includes(k));
    const reply: Reply = {
      turn: i, session, first, hook: said.some((k) => k.startsWith('hook:')), tool, input, says: t.says,
      show: typeof r.reply?.show_to_builder === 'string' ? r.reply.show_to_builder : '', said, reply: r.reply,
    };
    first = false;
    return reply;
  };
}

/** Plays `turns` in order for one builder (conversation, every turn given up front); the replies, waits left out. */
export async function converse(target: ToolContext | number, turns: readonly Turn[], o: { call?: Call; builderId?: number } = {}): Promise<Reply[]> {
  const turn = conversation(target, o);
  const out: Reply[] = [];
  for (const t of turns) {
    const r = await turn(t);
    if (r) out.push(r);
  }
  return out;
}

/** A transcript for people: each turn's input (what the builder said, the call) and what the builder sees. */
export const transcript = (rs: readonly Reply[]) =>
  rs.map((r) => `[session ${r.session}] ${r.says ? `Builder: "${r.says}"` : '(builder says nothing)'} -> ${r.tool} ${JSON.stringify(r.input)}\n${r.show}`).join('\n\n---\n\n');

/*
 * The merge gate, rule by rule, on what the builder sees (Reply.show). Each failure names the turn, the rule and why.
 */
export type GateRule = 'empty' | 'easy_reply' | 'repeat' | 'proof' | 'copy' | 'claim';
export type GateFailure = { turn: number; rule: GateRule; reason: string };

const paragraphs = (s: string) => s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const isTable = (p: string) => p.split('\n').every((l) => l.trim().startsWith('|'));
/** The text a second "?" may not hide in: quoted lines ("> ..."), table rows and "quoted" words left out. */
const unquoted = (s: string) =>
  s.split('\n').filter((l) => !/^\s*[>|]/.test(l)).join('\n').replace(/"[^"\n]*"/g, '""').replace(/“[^”\n]*”/g, '""');

/**
 * Rule 1's easy replies that are not a yes/no question: a number, one named word ("sent", ok), the draft's blanks
 * ("Reply with both"), and the one sign-in link (the builder's reply is connecting).
 */
const EASY_FORMS: RegExp[] = [
  /\bReply with a number\b/i,
  /\bReply "[^"\s]+"/i,
  /\bsay (?:ok|yes|"[^"\s]+")\b/i,
  /\bReply with (?:both|them|it)\b/i,
  /\bconnect here\b[^\n]*: https?:\/\/\S+$/i,
];
/** A question a yes answers: it opens on a yes/no word. */
const YES_NO = /^(?:want|should|shall|can|could|do|does|did|is|are|will|would|go|draft|ready|start|ok|okay|add|shall)\b/i;
const OPEN = /^(?:what|which|how|why|where|when|who|whom|whose|anything)\b|\banything else\b|, or\b/i;

/** Where a paragraph's easy reply starts: its last question with what follows it, else its last sentence (0: all of it). */
function askStart(p: string): number {
  const q = p.lastIndexOf('?');
  const head = q >= 0 ? p.slice(0, q) : p.replace(/[.!]\s*$/, '');
  const ends = [...head.matchAll(/[.!:?]\s+/g)];
  const e = ends.at(-1);
  return e ? e.index + e[0].length : 0;
}

/** Rule 1: the last paragraph is one easy reply, and the visible text asks one question at most. */
function easyReply(show: string): string | null {
  const asks = (unquoted(show).match(/\?/g) ?? []).length;
  if (asks > 1) return `${asks} questions`;
  const last = paragraphs(show).at(-1) ?? '';
  const q = last.lastIndexOf('?');
  if (q >= 0) {
    const question = last.slice(0, q + 1).split(/(?<=[.!:?])\s+/).at(-1)!.trim();
    if (OPEN.test(question)) return `an open question: "${question}"`;
    if (YES_NO.test(question)) return null;
    if (EASY_FORMS.some((r) => r.test(last))) return null;
    return `not a yes/no question: "${question}"`;
  }
  return EASY_FORMS.some((r) => r.test(last)) ? null : `no easy reply at the end: "${last}"`;
}

/**
 * Rule 4's proof, an EarnKit-only fact from the builder's record. The structured marker first: the reply said a
 * `proof:` part (standing_seen.said, written by conversation.ts pathReply). Otherwise this conservative pattern list,
 * each a fact only the record holds: a streak or weeks shipping, a score, a rank, a live product, an onchain fact,
 * a commit count.
 */
export const PROOF_PATTERNS: RegExp[] = [
  /\b\d+ weeks? (?:in a row|shipping|shipped)\b/i,
  /\bstreak\b/i,
  /\bscore (?:is )?(?:up to |down to |now )?\d+\b/i,
  /#\d+ of \d+\b/,
  /\b(?:is|are|you're|you are|it's) live\b/i,
  /\blive (?:on|at|since)\b/i,
  /\b\d[\d,]* (?:transactions?|txs?)\b/i,
  /\bonchain\b|\bon-chain\b/i,
  /\b\d[\d,]* commits?\b/i,
];
const hasProof = (r: Reply) => r.said.some((k) => k.startsWith('proof:')) || PROOF_PATTERNS.some((p) => p.test(r.show));
/** A builder with no record yet: the signed-out opener (its said marker, or its own words), where no fact exists to show. */
const noRecord = (r: Reply) => r.said.includes('opener') || /^I'm EarnKit\. I get builders funded for what they ship\b/.test(r.show);

/** Rule 5: an em dash, "coin" or "points" (whole words), an emoji. */
const COPY: [RegExp, string][] = [[/—/, 'an em dash'], [/\bcoins?\b/i, '"coin"'], [/\bpoints?\b/i, '"points"'], [/\p{Extended_Pictographic}/u, 'an emoji']];
/** Rule 6: telling them they qualify or are eligible, or that EarnKit sent or submitted it. */
const CLAIMS: RegExp[] = [
  /\byou(?:'re| are)? (?:now |already )?(?:qualify|qualified)\b/i,
  /\byou(?:'re| are) (?:now |already )?eligible\b/i,
  /\bI(?:'ve| have)? (?:just )?(?:submitted|sent|applied)\b/i,
  /\b(?:application|it) (?:was|has been|is now) (?:sent|submitted)\b/i,
];

/** Every reply that breaks the merge gate (implementer contract), with its turn and why; [] when all pass. */
export function gateFailures(replies: readonly Reply[]): GateFailure[] {
  const out: GateFailure[] = [];
  /** Per session: each paragraph said, and whether it was the easy reply (last). */
  const said = new Map<number, Map<string, boolean>>();
  for (const r of replies) {
    const fail = (rule: GateRule, reason: string) => out.push({ turn: r.turn, rule, reason });
    if (!r.show.trim()) {
      fail('empty', 'nothing for the builder to see');
      continue;
    }
    const why = easyReply(r.show);
    if (why) fail('easy_reply', why);
    const seen = said.get(r.session) ?? new Map<string, boolean>();
    said.set(r.session, seen);
    const ps = paragraphs(r.show);
    // The last paragraph's last sentence is the easy reply: it may repeat while it is the same pending step (it was the
    // easy reply before, too); the rest of that paragraph is compared like any paragraph.
    const lastP = ps.at(-1)!;
    const cut = askStart(lastP);
    const units: [string, boolean][] = [
      ...ps.slice(0, -1).map((p) => [p, false] as [string, boolean]),
      ...(cut > 0 ? [[lastP.slice(0, cut).trim(), false], [lastP.slice(cut), true]] as [string, boolean][] : [[lastP, true]] as [string, boolean][]),
    ];
    const repeats: string[] = [];
    for (const [p, ask] of units) {
      // A table's header row may repeat; its body may not.
      const key = norm(isTable(p) ? p.split('\n').slice(1).filter((l) => !/^\s*\|[\s|:-]*\|\s*$/.test(l)).join('\n') : p);
      if (!key) continue;
      if (seen.has(key) && !(ask && seen.get(key))) repeats.push(p);
      seen.set(key, ask && (seen.get(key) ?? true));
    }
    if (repeats.length) fail('repeat', `said already this session: "${repeats[0]}"`);
    if ((r.first || r.hook) && !noRecord(r) && !hasProof(r)) fail('proof', `${r.first ? 'a session opener' : 'a hook'} with no fact from the record`);
    const copy = COPY.filter(([re]) => re.test(r.show)).map(([, w]) => w);
    if (copy.length) fail('copy', copy.join(', '));
    const claim = CLAIMS.map((re) => r.show.match(re)?.[0]).find(Boolean);
    if (claim) fail('claim', `"${claim}"`);
  }
  return out;
}
