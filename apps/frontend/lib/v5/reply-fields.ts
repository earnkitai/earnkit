/**
 * v3.8 E13 (plan 23.6): `status` and `state` on every tool reply, behind `reply_fields`, so a host branches on data and
 * never on the builder line. Off, nothing here runs and every reply is byte for byte what it was.
 *
 * - `status`: `ok`, `needs_builder` (the reply asks the builder for something: a sign-in, a yes, a result), `refused`
 *   (the call was turned down: a refusal, an input error, a limit) or `error` (EarnKit failed: busy, unreadable input).
 * - `state`: where the builder is after the call, one value of `REPLY_STATES` (the journey of plan 23.5). A refusal or
 *   an error changes nothing, so its state is `unchanged`.
 *
 * Errors that were one plain line (busy, invalid input, a rate limit, an unknown tool) become the same JSON shape as a
 * tool's reply: `show_to_builder`, `agent_note`, `status`, `state`. Pure, apart from the flag read.
 */
import { flagOn } from './flags';

export const REPLY_STATUSES = ['ok', 'needs_builder', 'refused', 'error'] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

export const REPLY_STATES = [
  'not_signed_in', 'signed_in', 'nothing_ready', 'ready', 'needs_fact', 'needs_build', 'found', 'registered', 'started',
  'sent', 'interview', 'waiting', 'won', 'delivered', 'rejected', 'on_hold', 'skipped', 'listed', 'checked', 'screening',
  'screened', 'unchanged',
] as const;
export type ReplyState = (typeof REPLY_STATES)[number];

export type ReplyFields = { status: ReplyStatus; state: ReplyState };
export type ToolName = 'find' | 'track' | 'record' | 'screen';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const some = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/** Whether the new reply fields are on (`reply_fields`). */
export const replyFieldsOn = (): boolean => flagOn('reply_fields');

/** A track status as the journey state it leaves the builder in. */
const TRACK_STATE: Record<string, ReplyState> = {
  started: 'started', applied: 'sent', won: 'won', rejected: 'rejected', no_result: 'waiting', held: 'on_hold',
  skipped: 'skipped', unskip: 'ready', gap_done: 'needs_fact', found: 'found', registered: 'registered',
  needs_build: 'needs_build', interview: 'interview', delivered: 'delivered',
};

/** find's reply (the list, or one program): where the builder stands and whether the line asks them for something. */
function findFields(r: Obj): ReplyFields {
  if ('program' in r) {
    const verdict = obj(r.verdict).status;
    if (r.linked === false && typeof r.sign_in === 'string') return { status: 'needs_builder', state: 'not_signed_in' };
    if (verdict === 'ready') return { status: 'needs_builder', state: 'ready' };
    if (verdict === 'gap') return { status: 'needs_builder', state: 'needs_fact' };
    return { status: 'ok', state: r.linked === false ? 'not_signed_in' : 'nothing_ready' };
  }
  if ('programs' in r && 'next_cursor' in r) return { status: 'ok', state: 'listed' };
  const asks = some(r.ask_outcome) || some(r.ask_sent);
  const linked = r.linked !== false && !('sign_in' in r && typeof r.sign_in === 'string');
  const state: ReplyState = some(r.ready) || some(r.you_send) ? 'ready' : some(r.gaps) ? 'needs_fact' : linked ? 'nothing_ready' : 'not_signed_in';
  return { status: asks || state === 'ready' || state === 'needs_fact' || !linked ? 'needs_builder' : 'ok', state };
}

function trackFields(r: Obj, args: Obj): ReplyFields {
  if (args.action === 'list') return { status: 'ok', state: 'listed' };
  if (args.action === 'check') return { status: 'ok', state: 'checked' };
  const state = TRACK_STATE[typeof args.status === 'string' ? args.status : ''] ?? 'unchanged';
  return { status: r.next ? 'needs_builder' : 'ok', state };
}

function recordFields(r: Obj): ReplyFields {
  // Unlinked, every record line asks the builder to sign in.
  if (r.linked === false) return { status: 'needs_builder', state: 'not_signed_in' };
  return { status: 'ok', state: 'signed_in' };
}

function screenFields(r: Obj): ReplyFields {
  if (r.results) return { status: 'ok', state: 'screened' };
  return { status: 'ok', state: typeof r.job_id === 'string' ? 'screening' : 'unchanged' };
}

/** The status and state of one tool's reply, given the arguments it was called with. Pure. */
export function replyFieldsOf(tool: ToolName, reply: unknown, args: unknown): ReplyFields {
  const r = obj(reply);
  // A refusal (tool-input.ts `refuse`, `inputError`), read here so tool-input.ts can import this file.
  if (r.refused === true) return { status: 'refused', state: 'unchanged' };
  if (tool === 'find') return findFields(r);
  if (tool === 'track') return trackFields(r, obj(args));
  if (tool === 'record') return recordFields(r);
  return screenFields(r);
}

/** The reply with `status` and `state` added after its own keys (the reply's own keys are never changed). Pure. */
export function withReplyFields<T>(tool: ToolName, reply: T, args: unknown): T & ReplyFields {
  return { ...reply, ...replyFieldsOf(tool, reply, args) };
}

/** A plain error line as a tool reply's JSON: the line for the builder, a note for the agent, and the fields. Pure. */
export function errorReply(show: string, note: string, status: 'refused' | 'error', extra: Obj = {}): Obj {
  return { show_to_builder: show, agent_note: note, ...extra, status, state: 'unchanged' };
}
