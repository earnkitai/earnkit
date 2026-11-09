/**
 * Tool input at the MCP layer (v6.1.7, C35/C21): track, record and screen are registered with a lenient copy of
 * their strict schema, so the MCP library never refuses an argument with its own validation dump. Each tool then
 * validates with its strict schema and answers one builder line, the detail going to the agent note.
 */
import { z } from 'zod';
import { tooDeep as depthOver } from './secrets';

/** The builder line for arguments that could not be read at all (too deep, or not an object). */
export const COULD_NOT_READ = 'I could not read that.';
export const TOO_DEEP_NOTE = 'The arguments were nested too deep.';
export const NOT_OBJECT_NOTE = 'Send the arguments as an object.';

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

/** A strict schema's refusal as one agent-note sentence: the first five issues, at most 300 characters. Pure. */
export function inputDetail(error: z.ZodError): string {
  const issues = error.issues.slice(0, 5).map((i) => `${i.path.map(String).join('.') || 'input'}: ${i.message}`);
  const more = error.issues.length > 5 ? `; and ${error.issues.length - 5} more` : '';
  const text = (issues.join('; ') + more).replace(/\s+/g, ' ');
  return `${text.length > 300 ? `${text.slice(0, 299)}…` : text}.`;
}

/** The one line a request the MCP library (or the route) cannot read gets as its JSON-RPC error message. */
export const UNREADABLE_REQUEST = 'I could not read that request.';

type Id = string | number;
type Msg = { id?: unknown; method?: unknown; params?: { arguments?: unknown } };
const idOf = (m: Msg): Id | null => (typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null);
const toolLine = (id: Id, agent_note: string) => ({
  jsonrpc: '2.0',
  id,
  result: { content: [{ type: 'text', text: JSON.stringify({ show_to_builder: COULD_NOT_READ, agent_note }) }] },
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
        : args !== undefined && depthOver(args, max)
          ? TOO_DEEP_NOTE
          : null;
    const id = idOf(m);
    if (note) {
      if (id !== null) answers.push(toolLine(id, note));
    } else if (depthOver(raw, max + 3)) {
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
