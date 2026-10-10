/**
 * v2.10 item 4: the 8 v2.9 tool names, kept as hidden aliases of the 4 new tools for 30 days (R17).
 * `app/mcp/route.ts` rewrites an old name in a `tools/call` body before the MCP transport sees it,
 * so old names never appear in `tools/list` and each old call reaches the handler its new form does
 * (Review Focus 2). Pure: no database, no network.
 */

export const OLD_TOOL_NAMES = [
  'list_programs',
  'get_program',
  'prepare_submission',
  'confirm_entry',
  'record_submission',
  'launch_token',
  'tell_earnkit',
  'pick_up_entries',
] as const;

/** R17: 30 days after the spec's approval, plus one. After it an old name is an unknown tool. The owner may move it. */
export const ALIASES_UNTIL = new Date('2026-11-09T00:00:00Z');

type Args = Record<string, unknown>;
export type AliasedCall = { name: 'find' | 'prepare' | 'confirm' | 'tell'; args: Args };

/** submission_data as answers: strings, lists joined with ", " (projects.ts answersOf). */
const answersOf = (d: unknown) =>
  Object.fromEntries(
    Object.entries((d && typeof d === 'object' ? d : {}) as Args)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]),
  );

const pick = (a: Args, keys: string[]): Args => Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));

/**
 * v2.8.1 §E18: a yes or no in any form an agent passes it (a boolean, 1/0, "yes", "sure", "nope",
 * "not now"); null when unclear. Pure; tools.ts re-exports it.
 */
export function yesNo(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === 0) return v === 1;
  const t = typeof v === 'string' ? v.trim().toLowerCase().replace(/[.!]+$/, '') : '';
  if (['yes', 'y', 'true', 'yeah', 'yep', 'sure', 'ok', 'okay'].includes(t)) return true;
  if (['no', 'n', 'false', 'nope', 'not now'].includes(t)) return false;
  return null;
}

/** pick_up_entries' answer as tell's "yes" or "no"; an unclear one passes as given (tell refuses it). */
const pickupOf = (v: unknown) => {
  const a = yesNo(v);
  return a === null ? v : a ? 'yes' : 'no';
};

/**
 * An old tool call as its new tool and arguments, until ALIASES_UNTIL (R17); null for any other name
 * or after the date. Pre-flight P15: a skip, like a go, needs builder_confirmed (v2.9 showed the offer
 * without it); record_submission with both builder_confirmed and builder_submitted confirms the entry
 * and marks it submitted (confirm's `submitted`); an "I submitted" carries the given project and answers
 * for an entry that doesn't exist yet (tell.submitted's fallback).
 */
export function aliasCall(name: string, a: Args, now = new Date()): AliasedCall | null {
  if (now >= ALIASES_UNTIL) return null;
  const yes = a.builder_confirmed === true;
  const go = yes && a.decision !== 'skip' && { yes: true };
  const skip = yes && a.decision === 'skip' && { skip_token: true };
  const check = a.check_back === true && { check: true };
  switch (name) {
    case 'list_programs':
      return { name: 'find', args: a };
    case 'get_program':
      return { name: 'find', args: pick(a, ['program_id', 'repo']) };
    case 'prepare_submission':
      return { name: 'prepare', args: a };
    case 'confirm_entry':
      return {
        name: 'confirm',
        args: { ...pick(a, ['program_id', 'project', 'answers', 'token', 'wallet', 'agent', 'signed_in']), ...go, ...skip, ...check },
      };
    case 'launch_token': {
      const o = a.offer as { program_id?: unknown; repo_url?: unknown; project_name?: unknown } | undefined;
      const links = pick(a, ['live_url', 'repo_url']);
      const base = {
        ...(a.name !== undefined || a.symbol !== undefined ? { token: pick(a, ['name', 'symbol']) } : {}),
        ...pick(a, ['signed_in', 'image_data', 'image_url', 'builder_x', 'agent']),
        ...(a.creator_wallet !== undefined && { wallet: a.creator_wallet }),
        ...go,
        ...skip,
        ...check,
      };
      return {
        name: 'confirm',
        args:
          o && typeof o === 'object'
            ? { ...base, program_id: o.program_id, project: { name: o.project_name, repo_url: o.repo_url }, answers: {} }
            : { ...base, project_id: a.project_id, ...(Object.keys(links).length > 0 && { project: links }) },
      };
    }
    case 'record_submission': {
      if (a.builder_submitted === true && !yes)
        return {
          name: 'tell',
          args: {
            submitted: pick(a, ['program_id', 'external_submission_url', 'project', 'submission_data']),
            ...pick(a, ['signed_in']),
          },
        };
      const t = a.token && typeof a.token === 'object' ? (a.token as Args) : null;
      // v2.9 runTokenFlow launched to the token's own creator_wallet before the payout wallet.
      const wallet = t?.creator_wallet ?? a.payout_wallet;
      return {
        name: 'confirm',
        args: {
          ...pick(a, ['program_id', 'project', 'contracts', 'deployer_signature', 'signed_in']),
          answers: answersOf(a.submission_data),
          ...(t && (t.name !== undefined || t.symbol !== undefined) && { token: pick(t, ['name', 'symbol']) }),
          ...(t && pick(t, ['image_url', 'image_data', 'builder_x'])),
          ...(wallet !== undefined && { wallet }),
          ...(yes && a.token !== 'skip' && { yes: true }),
          // P15a: a skip, like a yes, needs builder_confirmed (v2.9 record_submission never confirmed one).
          ...(yes && a.token === 'skip' && { skip_token: true }),
          ...check,
          ...(a.builder_submitted === true && { submitted: pick(a, ['external_submission_url']) }),
        },
      };
    }
    case 'tell_earnkit':
      return { name: 'tell', args: a };
    case 'pick_up_entries':
      return { name: 'tell', args: { pickup: pickupOf(a.answer) } };
    default:
      return null;
  }
}

type Message = { method?: unknown; params?: { name?: unknown; arguments?: unknown } };

/** One JSON-RPC message with an old tool name rewritten, or the same object when nothing changes. */
function rewriteOne(m: unknown, now: Date, log?: (old: string, next: string) => void): { msg: unknown; changed: boolean } {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { msg: m, changed: false };
  const { method, params } = m as Message;
  if (method !== 'tools/call' || !params || typeof params !== 'object' || typeof params.name !== 'string') return { msg: m, changed: false };
  const args = params.arguments ?? {};
  if (typeof args !== 'object' || Array.isArray(args) || args === null) return { msg: m, changed: false };
  const next = aliasCall(params.name, args as Args, now);
  if (!next) return { msg: m, changed: false };
  log?.(params.name, next.name);
  return { msg: { ...(m as object), params: { ...params, name: next.name, arguments: next.args } }, changed: true };
}

/**
 * v2.10 item 4: a POSTed MCP body (one JSON-RPC message or a batch) with each old `tools/call` name
 * rewritten to its new tool and arguments. `log` gets the old and new names only, never arguments.
 * Everything else is returned as the same objects (byte-equal once serialized).
 */
export async function rewriteAliases(
  body: unknown,
  now = new Date(),
  log?: (old: string, next: string) => void,
): Promise<{ body: unknown; changed: boolean }> {
  if (Array.isArray(body)) {
    const out = body.map((m) => rewriteOne(m, now, log));
    return out.some((o) => o.changed) ? { body: out.map((o) => o.msg), changed: true } : { body, changed: false };
  }
  const one = rewriteOne(body, now, log);
  return { body: one.msg, changed: one.changed };
}

/**
 * v2.10.1 B5: a client that calls an old name still has the v2.9 tool list (claude.ai keeps a
 * connector's list until it is refreshed or reconnected), so replies to it name only the tools it can
 * see, in their v2.9 argument words. The new tool each reply names maps to the old one the caller used
 * where that is the same step, else to the v2.9 tool for that step. Builder text (show_to_*) never
 * names a tool and is left alone. Pure.
 */
const STEP_OLD: Record<AliasedCall['name'], (used: string) => string> = {
  find: (used) => (used === 'get_program' ? 'get_program' : 'list_programs'),
  prepare: () => 'prepare_submission',
  confirm: (used) => (['launch_token', 'record_submission', 'confirm_entry'].includes(used) ? used : 'confirm_entry'),
  tell: (used) => (used === 'pick_up_entries' ? 'pick_up_entries' : 'tell_earnkit'),
};

/** One agent-facing string in v2.9 words for a client that called `used`. Pure; exported for tests. */
export function inOldWords(text: string, used: string): string {
  const old = (step: AliasedCall['name']) => STEP_OLD[step](used);
  return (
    text
      // Argument words first, while the new tool names are still there to anchor them.
      .replace(/\btell with submitted(?:: \{ ?([^}]*?) ?\})?/g, (_m, inner?: string) => `record_submission with builder_submitted: true${inner ? ` and ${inner}` : ''}`)
      .replace(/\btell with pickup: "yes"/g, 'pick_up_entries with answer: "yes"')
      .replace(/\bconfirm with project_id\b/g, 'launch_token with project_id')
      .replace(/\bskip_token: true\b/g, 'builder_confirmed: true and decision: "skip"')
      .replace(/\byes: true\b/g, 'builder_confirmed: true')
      .replace(/\bcheck: true\b/g, 'check_back: true')
      .replace(/\(find, prepare, confirm, tell\)/g, `(${OLD_TOOL_NAMES.join(', ')})`)
      // Then each new name where it is a tool: "call find", "find's", "then confirm again", "to tell as".
      .replace(/\b(call|Call|calling|Calling|then|or|before) (find|prepare|confirm|tell)\b(?! (me|you|it|them|the builder)\b)/g, (_m, w: string, t: AliasedCall['name']) => `${w} ${old(t)}`)
      .replace(/\bto (find|prepare|confirm|tell) as\b/g, (_m, t: AliasedCall['name']) => `to ${old(t)} as`)
      .replace(/\b(find|prepare|confirm|tell)'s\b/g, (_m, t: AliasedCall['name']) => `${old(t)}'s`)
  );
}

/** Keys whose strings are builder text: never rewritten (they never name a tool). */
const BUILDER_KEY = /^show_to_|^question$/;

function oldWordsIn(v: unknown, used: string, key = ''): unknown {
  if (typeof v === 'string') return BUILDER_KEY.test(key) ? v : inOldWords(v, used);
  if (Array.isArray(v)) return v.map((x) => oldWordsIn(x, used, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, oldWordsIn(x, used, k)]));
  return v;
}

/**
 * v2.10.1 B5: what a stale client is told once per reply: its tool list is old. Agent-facing; names
 * no tool. The builder refreshes the connector's tools (or reconnects it) once.
 */
export const STALE_TOOLS_NOTE =
  "EarnKit's tools changed and this connection still lists the old ones; they keep working until Nov 9, 2026. " +
  "Tell the builder once: refresh EarnKit's tool list in their connector settings, or disconnect and reconnect EarnKit.";

/**
 * v2.10.1 B5: one JSON-RPC result of an aliased tools/call, rewritten for the caller's old tool list:
 * the tool reply's JSON (content[].text) in v2.9 words, plus `tools_note`. A text that isn't JSON (an
 * error line) is rewritten as text. Pure.
 */
export function forOldClient(message: unknown, used: string): unknown {
  const m = message as { result?: { content?: { type?: string; text?: unknown }[]; structuredContent?: unknown } };
  if (!m || typeof m !== 'object' || !m.result || !Array.isArray(m.result.content)) return message;
  const content = m.result.content.map((c) => {
    if (c?.type !== 'text' || typeof c.text !== 'string') return c;
    let parsed: unknown;
    try {
      parsed = JSON.parse(c.text);
    } catch {
      return { ...c, text: inOldWords(c.text, used) };
    }
    const rewritten = oldWordsIn(parsed, used);
    const withNote = rewritten && typeof rewritten === 'object' && !Array.isArray(rewritten) ? { ...rewritten, tools_note: STALE_TOOLS_NOTE } : rewritten;
    return { ...c, text: JSON.stringify(withNote) };
  });
  return { ...m, result: { ...m.result, content, ...(m.result.structuredContent !== undefined && { structuredContent: oldWordsIn(m.result.structuredContent, used) }) } };
}

/** v2.10.1 B5: the old names a POSTed body called (by JSON-RPC id), before rewriteAliases. Pure. */
export function aliasedIds(body: unknown, now = new Date()): Map<string | number, string> {
  const out = new Map<string | number, string>();
  for (const m of Array.isArray(body) ? body : [body]) {
    const msg = m as { id?: unknown; method?: unknown; params?: { name?: unknown } };
    if (!msg || typeof msg !== 'object' || msg.method !== 'tools/call' || typeof msg.params?.name !== 'string') continue;
    if ((typeof msg.id === 'string' || typeof msg.id === 'number') && aliasCall(msg.params.name, {}, now)) out.set(msg.id, msg.params.name);
  }
  return out;
}
