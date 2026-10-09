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

/** pick_up_entries read yes and no in any form; tell takes "yes" or "no" (anything else passes as given). */
const yesNo = (v: unknown) => {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : v;
  return t === true || t === 'yes' || t === 'y' ? 'yes' : t === false || t === 'no' || t === 'n' ? 'no' : v;
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
      const wallet = a.payout_wallet ?? t?.creator_wallet;
      return {
        name: 'confirm',
        args: {
          ...pick(a, ['program_id', 'project', 'contracts', 'deployer_signature', 'signed_in']),
          answers: answersOf(a.submission_data),
          ...(t && (t.name !== undefined || t.symbol !== undefined) && { token: pick(t, ['name', 'symbol']) }),
          ...(t && pick(t, ['image_url', 'image_data', 'builder_x'])),
          ...(wallet !== undefined && { wallet }),
          ...(yes && a.token !== 'skip' && { yes: true }),
          ...(a.token === 'skip' && { skip_token: true }),
          ...check,
          ...(a.builder_submitted === true && { submitted: pick(a, ['external_submission_url']) }),
        },
      };
    }
    case 'tell_earnkit':
      return { name: 'tell', args: a };
    case 'pick_up_entries':
      return { name: 'tell', args: { pickup: yesNo(a.answer) } };
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
