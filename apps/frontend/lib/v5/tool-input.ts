/**
 * Unreadable tool input at the MCP layer (v6.1.7, C35/C21), five jobs:
 * - `lenient`: track, record and screen are registered with a lenient copy of their strict schema, so the MCP library
 *   never refuses an argument with its own validation dump; each tool validates with its strict schema and answers
 *   one builder line;
 * - `readLoosely`: find's and track's read of wrong-typed arguments before that check (v6.1.14, L13-4);
 * - `inputDetail`: that strict check's detail, for the agent note;
 * - `answerUnreadable`: the route's split of a body into calls answered at once (too deep, not an object) and the rest;
 * - `plainErrors`: the response rewrite that replaces library error codes with plain words.
 */
import { z } from 'zod';
import { tooDeep } from './secrets';
import { cleanText } from './controls';

/**
 * L45-19 (v6.1.19): a further payment's key as compared: hidden and control characters removed and the ends trimmed, so
 * `k1` and `k1` with a zero-width space are one key; a key empty after that is refused. Track's and the screen's.
 */
export const PaymentKeyInput = z
  .object({ key: z.string().transform((x) => cleanText(x, Infinity)).pipe(z.string().min(1, 'empty after removing hidden characters').max(80)) })
  .strict();

export const TOO_DEEP_NOTE = 'The arguments were nested too deep.';
export const NOT_OBJECT_NOTE = 'Send the arguments as an object.';

/**
 * L29-9 (v6.1.16 Task 15): a refusal: its usual builder text and agent note, marked `refused`, which the MCP layer
 * (`run`) answers with `isError: true` and the same content (HTTP stays 200). Every tool's refusals return through
 * this mark. Pure.
 */
export type Refused = { refused: true };
export function refuse<T extends { show_to_builder: string; agent_note: string }>(r: T): T & Refused {
  return { ...r, refused: true };
}
/** Whether a tool's reply is a refusal (`refuse`). Pure. */
export const isRefused = (v: unknown): boolean => !!v && typeof v === 'object' && (v as { refused?: unknown }).refused === true;
/**
 * L29-10 (v6.1.16 Task 15): an input error: no builder text, and the agent note says what to fix and to call again.
 * `what` is the detail (`inputDetail`, or a plain sentence). Pure.
 */
export const inputErrorNote = (what: string): string => `${what.trim().replace(/[.;\s]+$/, '')}; fix it and call again.`;
export function inputError(what: string): { show_to_builder: ''; agent_note: string } & Refused {
  return { show_to_builder: '', agent_note: inputErrorNote(what), refused: true };
}

/**
 * A schema that accepts any value for every field and any extra key, but describes itself to agents exactly as
 * `strict` does (each field's JSON Schema, the required list, no extra keys): the tool list is unchanged. Pure.
 */
export function lenient(strict: z.ZodObject): z.ZodObject {
  const json = z.toJSONSchema(strict, { io: 'input' }) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  const shape: Record<string, z.ZodType> = {};
  for (const k of Object.keys(strict.shape)) shape[k] = z.unknown().optional().meta(json.properties?.[k] ?? {});
  return z.looseObject(shape).meta({ ...(json.required?.length ? { required: json.required } : {}), additionalProperties: false });
}

/** How a tool's arguments are read before its strict check (`readLoosely`). Paths are a key or `parent.key`. */
export type LooseRules = {
  /** Text fields: a finite number is its text. */
  text?: string[];
  /** Text fields cut to this many characters, so an over-long id reads as no match, never a refusal. */
  cut?: Record<string, number>;
  /** Object fields: anything else is dropped and named. */
  objects?: string[];
  /** Boolean fields: "true" and "false" (any case) are those; anything else is dropped and named. */
  booleans?: string[];
  /** Fields with fixed values: a value in any case is that value; anything else is dropped and named. */
  enums?: Record<string, readonly string[]>;
};

/**
 * L13-4, L12-4 (v6.1.14): a tool's arguments read leniently before its strict check, as track, record and screen read
 * theirs since v6.1.7, so a wrong type gets the tool's plain lines, never the library's validation text: a null field
 * is a field left out (at the top and inside an object field), and `rules` say what each field may be. `problems` name
 * what was dropped, for the agent note only. Pure.
 */
export function readLoosely(input: unknown, rules: LooseRules): { args: Record<string, unknown>; problems: string[] } {
  const args: Record<string, unknown> = input && typeof input === 'object' && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  const problems: string[] = [];
  const drop = (o: Record<string, unknown>, k: string, path: string, why: string) => {
    delete o[k];
    problems.push(`${path} dropped: ${why}`);
  };
  for (const k of Object.keys(args)) if (args[k] === null) delete args[k];
  for (const path of rules.objects ?? []) {
    const v = args[path];
    if (v === undefined) continue;
    if (typeof v !== 'object' || Array.isArray(v)) drop(args, path, path, 'not an object');
    else {
      const copy = { ...(v as Record<string, unknown>) };
      for (const k of Object.keys(copy)) if (copy[k] === null) delete copy[k];
      args[path] = copy;
    }
  }
  /** The object holding a path's field, and the field's key; null when its parent is not an object. */
  const at = (path: string): [Record<string, unknown>, string] | null => {
    const [a, b] = path.split('.');
    if (b === undefined) return [args, a];
    const parent = args[a];
    return parent && typeof parent === 'object' && !Array.isArray(parent) ? [parent as Record<string, unknown>, b] : null;
  };
  for (const path of rules.text ?? []) {
    const p = at(path);
    if (p && typeof p[0][p[1]] === 'number' && Number.isFinite(p[0][p[1]])) p[0][p[1]] = String(p[0][p[1]]);
  }
  for (const [path, max] of Object.entries(rules.cut ?? {})) {
    const p = at(path);
    const v = p?.[0][p[1]];
    if (p && typeof v === 'string' && v.length > max) p[0][p[1]] = v.slice(0, max);
  }
  for (const path of rules.booleans ?? []) {
    const p = at(path);
    const v = p?.[0][p[1]];
    if (!p || v === undefined || typeof v === 'boolean') continue;
    const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (t === 'true' || t === 'false') p[0][p[1]] = t === 'true';
    else drop(p[0], p[1], path, 'not true or false');
  }
  for (const [path, values] of Object.entries(rules.enums ?? {})) {
    const p = at(path);
    const v = p?.[0][p[1]];
    if (!p || v === undefined) continue;
    const t = typeof v === 'string' ? v.trim().toLowerCase() : null;
    const hit = values.find((x) => x.toLowerCase() === t);
    if (hit !== undefined) p[0][p[1]] = hit;
    else drop(p[0], p[1], path, `not one of ${values.join(', ')}`);
  }
  return { args, problems };
}

/** A strict schema's refusal as one agent-note sentence: the first five issues, at most 300 characters. Pure. */
export function inputDetail(error: z.ZodError): string {
  const issues = error.issues.slice(0, 5).map((i) => `${i.path.map(String).join('.') || 'input'}: ${i.message}`);
  const more = error.issues.length > 5 ? `; and ${error.issues.length - 5} more` : '';
  const text = (issues.join('; ') + more).replace(/\s+/g, ' ');
  return `${text.length > 300 ? `${text.slice(0, 299)}…` : text}.`;
}

/** L45-19 (v6.1.19): the builder line when an argument held bytes that are not UTF-8. */
export const NOT_UTF8 = 'I could not read that.';
export const NOT_UTF8_NOTE = 'Nothing was done. Part of the arguments was not valid UTF-8; send the text as UTF-8 and call again.';
/** Whether any key or text in `v` holds U+FFFD, the mark of bytes that were not UTF-8 (the depth is capped by the caller). Pure. */
function hasReplacement(v: unknown): boolean {
  if (typeof v === 'string') return v.includes('\uFFFD');
  if (!v || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some(hasReplacement);
  return Object.entries(v).some(([k, x]) => k.includes('\uFFFD') || hasReplacement(x));
}

/** The one line a request the MCP library (or the route) cannot read gets as its JSON-RPC error message. */
export const UNREADABLE_REQUEST = 'I could not read that request.';

type Id = string | number;
type Msg = { id?: unknown; method?: unknown; params?: { arguments?: unknown } };
const idOf = (m: Msg): Id | null => (typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null);
// L29-9, L29-10 (v6.1.16 Task 15): an input error, isError true, with no builder text.
const toolLine = (id: Id, agent_note: string) => ({
  jsonrpc: '2.0',
  id,
  result: { content: [{ type: 'text', text: JSON.stringify(inputError(agent_note)) }], isError: true },
});

/**
 * Splits a parsed JSON-RPC body (v6.1.7, B4/C35): a `tools/call` whose arguments nest past `max` levels, or are
 * not an object, gets the tool's plain line here; any other message nested past `max + 3` levels gets the one-line
 * JSON-RPC error. `answers` are those replies (a notification gets none), `rest` what still goes on (null when
 * nothing is left). The walk never goes past the cap, and nothing deep reaches JSON.stringify or the library. Pure.
 */
export function answerUnreadable(body: unknown, max: number): { answers: unknown[]; rest: unknown | null } {
  const items = Array.isArray(body) ? body : [body];
  const answers: unknown[] = [];
  const rest: unknown[] = [];
  for (const raw of items) {
    const m = (raw && typeof raw === 'object' ? raw : {}) as Msg;
    const args = m.method === 'tools/call' && m.params && typeof m.params === 'object' ? m.params.arguments : undefined;
    const note =
      args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))
        ? NOT_OBJECT_NOTE
        : args !== undefined && tooDeep(args, max)
          ? TOO_DEEP_NOTE
          : null;
    const id = idOf(m);
    // L45-19 (v6.1.19): text that was not UTF-8 (read as U+FFFD) is never matched or echoed: one plain line.
    if (!note && args !== undefined && hasReplacement(args)) {
      if (id !== null) answers.push({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(refuse({ show_to_builder: NOT_UTF8, agent_note: NOT_UTF8_NOTE })) }], isError: true } });
    } else if (note) {
      if (id !== null) answers.push(toolLine(id, note));
    } else if (tooDeep(raw, max + 3)) {
      if (id !== null) answers.push({ jsonrpc: '2.0', id, error: { code: -32600, message: UNREADABLE_REQUEST } });
    } else rest.push(raw);
  }
  if (rest.length === items.length) return { answers, rest: body };
  return { answers, rest: rest.length === 0 ? null : Array.isArray(body) ? rest : rest[0] };
}

/** The library codes whose messages carry its parse or validation detail: parse, invalid request, params, internal. */
const LIBRARY_CODES = new Set([-32700, -32600, -32602, -32603]);

/**
 * The transport's JSON answer with each library refusal's message replaced by UNREADABLE_REQUEST; the detail goes
 * to the server log only (cut to 300 characters). Anything else passes through unchanged.
 */
export async function plainErrors(response: Response): Promise<Response> {
  if (!/application\/json/i.test(response.headers.get('content-type') ?? '')) return response;
  const parsed = (await response.clone().json().catch(() => undefined)) as unknown;
  if (parsed === undefined) return response;
  let changed = false;
  const one = (m: unknown) => {
    const e = (m as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (!e || typeof e !== 'object' || !LIBRARY_CODES.has(e.code as number) || e.message === UNREADABLE_REQUEST) return m;
    console.log(`[mcp] request refused ${String(e.code)}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 300)}`);
    changed = true;
    return { ...(m as object), error: { code: e.code, message: UNREADABLE_REQUEST } };
  };
  const body = Array.isArray(parsed) ? parsed.map(one) : one(parsed);
  if (!changed) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: response.status, headers });
}
