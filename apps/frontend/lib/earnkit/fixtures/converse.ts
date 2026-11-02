import { sql } from '../db';
import { mcpCall, type McpResult } from './mcp-call';
import type { ToolContext } from '../tools';
import { SESSION_MS, sessionOf } from '../conversation';
import { READY_AGAIN_ASK, READY_ASK } from '../ready-copy';

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

async function seenOf(id: number): Promise<{ said?: unknown } | null> {
  const [r] = await sql()<{ s: { said?: unknown } | null }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`;
  return r?.s ?? null;
}
async function saidKeys(id: number): Promise<{ at: string | null; keys: string[] }> {
  const said = ((await seenOf(id)) ?? {}).said as { at?: unknown; keys?: unknown } | undefined;
  return {
    at: typeof said?.at === 'string' ? said.at : null,
    keys: Array.isArray(said?.keys) ? said.keys.filter((k): k is string => typeof k === 'string') : [],
  };
}

/**
 * The wait: the session's last activity moves `ms` into the past (the "Since" tests' back-dating), so the next call is
 * a new session. Throws when it isn't (no session to move, or `ms` under SESSION_MS), so the gate's sessions always
 * match the product's.
 */
async function wait(id: number, ms: number): Promise<void> {
  const rows = await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('said', jsonb_build_object(
      'at', to_char(((standing_seen->'said'->>'at')::timestamptz - ${`${ms} milliseconds`}::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'keys', COALESCE(standing_seen->'said'->'keys', '[]'::jsonb)))
    WHERE builder_id = ${id} AND standing_seen->'said'->>'at' IS NOT NULL RETURNING 1`;
  if (rows.length !== 1) throw new Error(`converse wait: builder ${id} has no session to end`);
  if (!sessionOf(await seenOf(id), new Date()).fresh) throw new Error(`converse wait: ${ms} ms did not start a new session (SESSION_MS is ${SESSION_MS})`);
}

type MoveUp = { kind?: unknown; project_key?: unknown };
const moveUpOf = (r: Reply | null) => (r?.reply?.move_up as MoveUp | undefined) ?? null;
const lastParagraph = (show: string) => paragraphs(show).at(-1) ?? '';

/**
 * Review 5: a tell turn must answer the previous reply's structured ask, as a lazy agent would: a move_up answer names
 * that reply's move_up kind and project_key; "sent" as program_status follows a reply that asked for "sent". Null when
 * it does; else why not.
 */
export function askMismatch(prev: Reply | null, tell: Record<string, unknown>): string | null {
  const asked = moveUpOf(prev);
  const m = tell.move_up as MoveUp | undefined;
  if (m) {
    if (!asked) return 'the previous reply asked nothing (no move_up)';
    if (m.kind !== asked.kind || (m.project_key ?? null) !== (asked.project_key ?? null))
      return `answers ${JSON.stringify({ kind: m.kind, project_key: m.project_key ?? null })}, the reply asked ${JSON.stringify({ kind: asked.kind, project_key: asked.project_key ?? null })}`;
    return null;
  }
  if (Array.isArray(tell.program_status)) return /\breply "sent"/i.test(lastParagraph(prev?.show ?? '')) ? null : 'program_status without a "sent" ask';
  return null;
}

/**
 * Review 5: the lazy agent's next turn from the reply's structured ask (the replay's driver): the reply's own word
 * ("sent", the blanks) or a yes to its move_up. 'real_work' when the next step is work outside EarnKit (a push the
 * replay can't make); null when the reply asks for nothing EarnKit can take.
 */
export function lazyNext(r: Reply, o: { blanks: string; pushed: string; skip?: number[] }): Turn | 'real_work' | null {
  const m = moveUpOf(r);
  const end = lastParagraph(r.show);
  if (end.includes(o.pushed)) return 'real_work';
  if (!m) return null;
  const ask = { kind: m.kind, project_key: m.project_key ?? null };
  if (/\breply "sent"/i.test(end)) return { says: 'sent', tell: { move_up: { ...ask, answer: 'sent' } } };
  if (BLANKS_REPLY.test(sentences(end).at(-1) ?? '')) return { says: o.blanks, tell: { move_up: { ...ask, answer: 'yes', blanks: o.blanks } } };
  // v4.10 Task 3 (R5): the ready set's one ask: yes, or the numbers the walk skips. Task 4: once its pages are open the
  // ask is "sent" (above), never another yes.
  if (m.kind === 'ready') {
    return o.skip?.length
      ? { says: `skip ${o.skip.join(', ')}`, tell: { move_up: { ...ask, answer: 'skip', skip: o.skip } } }
      : { says: 'yes', tell: { move_up: { ...ask, answer: 'yes' } } };
  }
  if (/\?$/.test(end) || /\bsay ok\b/i.test(end)) return { says: 'ok', tell: { move_up: { ...ask, answer: 'yes' } } };
  return null;
}

/**
 * One builder's conversation, a turn at a time (the replay picks each next turn from the last reply, as a lazy agent
 * would). `target` is the tool context (or an installation id, which is its own builder); `o.ctx` reads it fresh each
 * call (a test that connects the builder between turns). A `wait` ends the session (and checks it ended) and returns
 * null; `o.call` replaces the call (a test's env). `first` is the product's own: the session was fresh before the call.
 * A tell that doesn't answer the previous reply's ask throws (askMismatch).
 */
export function conversation(target: ToolContext | number, o: { call?: Call; builderId?: number; ctx?: () => ToolContext } = {}) {
  const base = typeof target === 'number' ? ({ installationId: target, ownInstallationId: target, sharedClient: false } as ToolContext) : target;
  const ctxNow = o.ctx ?? (() => base);
  const id = o.builderId ?? base.installationId;
  const call: Call = o.call ?? ((tool, args) => mcpCall(ctxNow(), tool, args, { format: true }));
  let session = 0;
  let n = 0;
  let prev: Reply | null = null;
  return async (t: Turn): Promise<Reply | null> => {
    const i = n++;
    await t.before?.();
    if ('wait' in t) {
      await wait(id, t.wait);
      session++;
      return null;
    }
    const [tool, input] = 'find' in t ? (['find', t.find] as const) : (['tell', t.tell] as const);
    if (tool === 'tell') {
      const why = askMismatch(prev, input);
      if (why) throw new Error(`converse turn ${i}: the tell doesn't answer the previous reply's ask: ${why}`);
    }
    const before = await seenOf(id).catch(() => null);
    const first = sessionOf(before, new Date()).fresh;
    const was = await saidKeys(id).catch(() => ({ at: null, keys: [] as string[] }));
    const r = await call(tool, input);
    const now = await saidKeys(id).catch(() => ({ at: null, keys: [] as string[] }));
    // A fresh session's said keys start over: every key now held is new.
    const said = first ? now.keys : now.keys.filter((k) => !was.keys.includes(k));
    const reply: Reply = {
      turn: i, session, first, hook: said.some((k) => k.startsWith('hook:')), tool, input, says: t.says,
      show: typeof r.reply?.show_to_builder === 'string' ? r.reply.show_to_builder : '', said, reply: r.reply,
    };
    prev = reply;
    return reply;
  };
}

/** Plays `turns` in order for one builder (conversation, every turn given up front); the replies, waits left out. */
export async function converse(target: ToolContext | number, turns: readonly Turn[], o: { call?: Call; builderId?: number; ctx?: () => ToolContext } = {}): Promise<Reply[]> {
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
export type GateRule = 'empty' | 'easy_reply' | 'repeat' | 'proof' | 'copy' | 'claim' | 'step';
export type GateFailure = { turn: number; rule: GateRule; reason: string };

function paragraphs(s: string) {
  return s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const isTable = (p: string) => p.split('\n').every((l) => l.trim().startsWith('|'));
/** The text a second "?" may not hide in: quoted lines ("> ..."), table rows and "quoted" words left out. */
const unquoted = (s: string) =>
  s.split('\n').filter((l) => !/^\s*[>|]/.test(l)).join('\n').replace(/"[^"\n]*"/g, '""').replace(/“[^”\n]*”/g, '""');
/** A paragraph's sentences (a "." inside a link or a number never ends one). */
const sentences = (p: string) => norm(p).split(/(?<=[.!?])\s+/).filter(Boolean);

/**
 * The approved blanks ask (target A, and its 1 and 3+ forms, fix round 1b), the one easy reply that is neither a yes
 * nor a word: exactly "Reply with it|both|them and I'll finish it.".
 */
export const BLANKS_REPLY = /^Reply with (?:it|both|them) and I'll finish it\.$/;
/** A question a yes answers: it opens on a yes/no word, and offers no choice and asks for nothing open. */
const YES_NO = /^(?:want|should|shall|can|could|do|does|did|is|are|will|would|go|draft|ready|start|ok|okay|add)\b/i;
const NOT_YES_NO = /\bor\b|\b(?:tell me|let me know|what|which|something|anything|who|whom|whose|how|why|where|when)\b/i;
/** One named word, as the last sentence: reply "sent", say ok, a number. */
const ONE_WORD: RegExp[] = [
  /^(?:Once [^,.?]+, )?reply "[^"\s]+"(?: once [^,.?]+)?(?:,? and I'll [^.?]+)?\.$/i,
  /^(?:[^.?]*,\s*then )?say (?:ok|yes)(?: once [^,.?]+)?(?:, and I'll [^.?]+)?\.$/i,
  // Fix round 2 (minor 3): the number alone; with the sign-in link, SIGN_IN_FORMS.
  /^Reply with a number\.$/i,
  // v4.8 last ruling 1: the quiet path's reply right after the programs answer.
  /^Reply with a program's name and I'll start on it\.$/,
];
const REQUEST = /\b(?:also|tell me|let me know|or)\b/i;
/**
 * Fix round 2 (minor 3): the sign-in reply's last sentence: "Reply with a number" or "Reply 1 for A, 2 for B or 3 for
 * C", then ", and connect (GitHub) here so I can check if your work fits: <link>"; or a pick's "Connect here so I can
 * check if your work fits: <link>". Group 1: the numbered list, which may ask for nothing more.
 */
const SIGN_IN_FORM = /^(?:Reply with a number|Reply (\d+ for .+)), and connect (?:GitHub )?here so I can check if your work fits: \S+$|^Connect (?:GitHub )?here so I can check if your work fits: \S+$/;
const REQUEST_IN_PICK = /\b(?:and|also|tell me|let me know|describe|explain|share|send)\b/i;
/** EarnKit's own sign-in link: its host, /signin/ and the stored token's shape. */
const signInLink = () => {
  const host = (() => {
    try {
      return new URL(process.env.EARNKIT_URL ?? 'https://earnkit.com').host;
    } catch {
      return 'earnkit.com';
    }
  })();
  return new RegExp(String.raw`https:\/\/${host.replace(/\./g, '\\.')}\/signin\/[A-Za-z0-9_-]{16,}$`);
};

/**
 * Rule 1: the last sentence is one easy reply, and the visible text asks one question at most. The easy replies: a
 * yes/no question (last, nothing after it, no choice, nothing open asked for), one named word (reply "sent", say ok, a
 * number), the approved blanks ask (BLANKS_REPLY, exact), or a last line that ends in EarnKit's sign-in link while the reply's
 * stored ask is sign_in (the builder's reply is the tap).
 */
function easyReply(r: Reply): string | null {
  const asks = (unquoted(r.show).match(/\?/g) ?? []).length;
  if (asks > 1) return `${asks} questions`;
  const last = lastParagraph(r.show);
  const line = last.split('\n').at(-1)!.trim();
  if (signInLink().test(line)) {
    if (moveUpOf(r)?.kind !== 'sign_in') return 'a sign-in link, but the stored ask is not sign_in';
    if (last.includes('?')) return 'a question before the sign-in link';
    // Fix round 2 (minor 3): the number clause (or a pick's "Connect here"), then the sign-in clause, nothing else.
    const s = sentences(last).at(-1) ?? '';
    const m = SIGN_IN_FORM.exec(s);
    if (!m || (m[1] && REQUEST_IN_PICK.test(m[1]))) return `not the sign-in form: "${s}"`;
    return null;
  }
  const s = sentences(last).at(-1) ?? '';
  if (BLANKS_REPLY.test(s)) return null;
  // v4.10 Task 3 (R5): the ready set's one ask, exactly, as the last line; Task 4 (decision c): only while the stored ask
  // is the ready one, and its status reply's "Reply yes and I'll finish them." (or "it") likewise.
  if ((line === READY_ASK || s === READY_AGAIN_ASK || s === "Reply yes and I'll finish it.") && moveUpOf(r)?.kind === 'ready') return null;
  if (s.endsWith('?')) {
    if (!YES_NO.test(s)) return `not a yes/no question: "${s}"`;
    if (NOT_YES_NO.test(s)) return `a choice or an open question: "${s}"`;
    return null;
  }
  if (last.includes('?')) return `text after the question: "${s}"`;
  if (ONE_WORD.some((re) => re.test(s)) && !REQUEST.test(s.replace(/^Once [^,]+, /i, ''))) return null;
  return `no easy reply at the end: "${s}"`;
}

/**
 * Rule 4's proof, an EarnKit-only fact from the builder's own record. The structured marker first: the reply said a
 * `proof:` part (standing_seen.said; conversation.ts keys it on its facts). Otherwise this pattern list, each with the
 * builder (or their project) as its subject: their streak, score, rank, a live product, their onchain use, their
 * commits. Also rule 3: a fact matched twice in one session is a repeat.
 */
export const PROOF_PATTERNS: RegExp[] = [
  // Fix round 2 (minor 2): "{name} is live" is proofLiveOf, for the builder's own project name or handle only.
  /\byou(?:'ve| have) shipped \d+ weeks? in a row\b/gi,
  /\byour (?:shipping )?streak (?:is|of) \d+ weeks?\b/gi,
  /\byour GitHub: \d+ weeks? shipping in a row\b/gi,
  /\byour score (?:is )?(?:up to |down to |now )?\d+\b/gi,
  /(?:^|\n|\. )Score \d+, #\d+ of \d+\b/g,
  // The standing line a quiet reply opens with ("Score 0 · Top 22% of builders. 6 weeks shipping in a row."): the builder's.
  /(?:^|\n)Score \d+\b[^\n]*?\b\d+ weeks? shipping in a row\b/g,
  /\byou(?:'re| are) #\d+ of \d+\b/gi,
  /\b[Yy]ou(?:'re| are) (?:live )?on [A-Z]\w+\b/g,
  /\byour (?:app|project|product|contract)[^.]*\b\d[\d,]* (?:transactions?|txs?|users?)\b/gi,
  /\byour (?:repo|code|GitHub)[^.]*\b\d[\d,]* commits?\b/gi,
];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "{name} is live" for the builder's own names only (fix round 2, minor 2); none known, none matched. */
const proofLiveOf = (names: readonly string[]) =>
  names.filter((n) => n.trim()).length ? new RegExp(String.raw`\b(?:${names.filter((n) => n.trim()).map(escapeRe).join('|')}) is live\b`, 'gi') : null;
const proofFacts = (show: string, names: readonly string[] = []) => {
  const live = proofLiveOf(names);
  return [...PROOF_PATTERNS, ...(live ? [live] : [])].flatMap((p) => [...show.matchAll(p)].map((m) => norm(m[0].replace(/^[\n. ]+/, '')).toLowerCase()));
};
const hasProof = (r: Reply, names: readonly string[]) => r.said.some((k) => k.startsWith('proof:')) || proofFacts(r.show, names).length > 0;
/** A builder with no record yet: only the signed-out opener (its `opener` said part), where no fact exists to show. */
const noRecord = (r: Reply) => r.said.includes('opener');

/** Rule 5: an em dash, "coin" or "points" (whole words), an emoji. */
const COPY: [RegExp, string][] = [[/—/, 'an em dash'], [/\bcoins?\b/i, '"coin"'], [/\bpoints?\b/i, '"points"'], [/\p{Extended_Pictographic}/u, 'an emoji']];
/** Rule 6: telling them they qualify or are eligible, or that EarnKit sent, submitted or filed it, or that it's in. */
const CLAIMS: RegExp[] = [
  /\byou(?:'re| are)? (?:now |already )?(?:qualify|qualified)\b/i,
  /\byou(?:'re| are) (?:now |already )?eligible\b/i,
  /\bI(?:'ve| have)? (?:just )?(?:submitted|sent|applied|filed)\b/i,
  /\b(?:application|it) (?:was|has been|is now) (?:sent|submitted|filed)\b/i,
  /(?<!\bonce )\b(?:your application|application|it)(?:'s| is) in\b(?!\s+(?:your|the|a|an|their)\b)/i,
  /\bfiled\b/i,
  /\bsubmitted (?:it |this |your application )?for you\b/i,
];

/**
 * Final review F3: the steps a reply names, lowercased: the numbered lines under "Your next step(s) toward ...", and the
 * step after "Let's do it now:", "Not done yet:", "Still on {program}:", "one step away:" or "First:" (up to its first
 * period). A step in the gap stage's own words, so the same step in new wording around it is still the same step.
 */
// A new step template in the replies must be added here (or to the numbered-list shape), or the rule can't count it.
const STEP_AFTER = /(?:Let's do it now|Not done yet|Still on [^:\n]+|one step away|First): ([^.\n]+)/g;
function stepsNamed(show: string): string[] {
  const listed = /\bnext (?:\d+ )?steps? toward\b/i.test(show) ? [...show.matchAll(/^\s*\d+\.\s+([^.\n]+)/gm)].map((m) => m[1]) : [];
  return [...listed, ...[...show.matchAll(STEP_AFTER)].map((m) => m[1])].map((x) => norm(x).toLowerCase()).filter((x) => x.length >= 8);
}
/** Final review F3: one step may be said in at most this many replies of one session. */
export const STEP_MAX_REPLIES = 2;

/**
 * Every reply that breaks the merge gate (implementer contract), with its turn and why; [] when all pass. `names`: the
 * builder's own project name and handle, the only subjects "{name} is live" counts as proof for (fix round 2, minor 2).
 */
export function gateFailures(replies: readonly Reply[], o: { names?: readonly string[] } = {}): GateFailure[] {
  const names = o.names ?? [];
  const out: GateFailure[] = [];
  /** Per session: each paragraph said (and whether it was the easy reply), the proof facts said, and whether one was. */
  const said = new Map<number, { units: Map<string, boolean>; facts: Set<string>; proof: boolean }>();
  // Final review F3 (rule 3, the step): every step named in a session, then how many of its replies say each one.
  const steps = new Map<number, Set<string>>();
  for (const r of replies) for (const st of stepsNamed(r.show)) steps.set(r.session, (steps.get(r.session) ?? new Set()).add(st));
  const stepCount = new Map<string, number>();
  for (const r of replies) {
    const low = norm(r.show).toLowerCase();
    for (const st of steps.get(r.session) ?? []) {
      if (!low.includes(st)) continue;
      const k = `${r.session}|${st}`;
      const c = (stepCount.get(k) ?? 0) + 1;
      stepCount.set(k, c);
      if (c === STEP_MAX_REPLIES + 1) out.push({ turn: r.turn, rule: 'step', reason: `the step "${st}" in more than ${STEP_MAX_REPLIES} replies this session` });
    }
  }
  for (const r of replies) {
    const fail = (rule: GateRule, reason: string) => out.push({ turn: r.turn, rule, reason });
    if (!r.show.trim()) {
      fail('empty', 'nothing for the builder to see');
      continue;
    }
    const why = easyReply(r);
    if (why) fail('easy_reply', why);
    const mem = said.get(r.session) ?? { units: new Map<string, boolean>(), facts: new Set<string>(), proof: false };
    said.set(r.session, mem);
    const ps = paragraphs(r.show);
    // The last sentence is the easy reply: it may repeat while it is the same pending step (it was the easy reply
    // before, too); the rest of the last paragraph is compared like any paragraph.
    const lastP = ps.at(-1)!;
    const ss = sentences(lastP);
    const units: [string, boolean][] = [
      ...ps.slice(0, -1).map((p) => [p, false] as [string, boolean]),
      // v4.10 Task 5: the ready set's pending ask may repeat whole, its status sentence too ("Your 3 applications are still ready. Reply yes ...").
      ...(ss.length > 1 && moveUpOf(r)?.kind !== 'ready' ? [[ss.slice(0, -1).join(' '), false], [ss.at(-1)!, true]] as [string, boolean][] : [[lastP, true]] as [string, boolean][]),
    ];
    const repeats: string[] = [];
    for (const [p, ask] of units) {
      // A table's header row may repeat; its body may not.
      const key = norm(isTable(p) ? p.split('\n').slice(1).filter((l) => !/^\s*\|[\s|:-]*\|\s*$/.test(l)).join('\n') : p);
      if (!key) continue;
      if (mem.units.has(key) && !(ask && mem.units.get(key))) repeats.push(`"${p}"`);
      mem.units.set(key, ask && (mem.units.get(key) ?? true));
    }
    // Review 4: a proof fact said twice in one session, whatever sentence carries it.
    const facts = proofFacts(r.show, names);
    for (const f of new Set(facts)) if (mem.facts.has(f)) repeats.push(`the proof "${f}"`);
    if (repeats.length) fail('repeat', `said already this session: ${repeats[0]}`);
    const proof = hasProof(r, names);
    // A session opener carries its own proof; a later hook may lean on the session's (fix round 1, ruling R6-8: a proof
    // is said once a session, so the next program's hook has no new fact to say).
    if (r.first && !noRecord(r) && !proof) fail('proof', 'a session opener with no fact from the record');
    else if (!r.first && r.hook && !proof && !mem.proof) fail('proof', 'a hook with no fact from the record, none said this session');
    for (const f of facts) mem.facts.add(f);
    mem.proof ||= proof;
    const copy = COPY.filter(([re]) => re.test(r.show)).map(([, w]) => w);
    if (copy.length) fail('copy', copy.join(', '));
    const claim = CLAIMS.map((re) => r.show.match(re)?.[0]).find(Boolean);
    if (claim) fail('claim', `"${claim}"`);
  }
  return out.sort((a, b) => a.turn - b.turn);
}
