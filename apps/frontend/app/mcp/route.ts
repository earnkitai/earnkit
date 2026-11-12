import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { BodyTimeoutError, CORS, bodyTimedOut, json, notAllowed, preflight } from '../../lib/v5/http';
import { connectInstallation, type Caller } from '../../lib/v5/installations';
import { createMcpServer } from '../../lib/v5/mcp';
import { answerOldTools } from '../../lib/v5/old-tools';
import { publicOrigin, resourceOf } from '../../lib/v5/oauth';
import { clientIp } from '../../lib/v5/rate-limit';
import { BODY_TOO_LARGE, MAX_ARG_DEPTH, readCapped, scrubToolCalls, withScrubNotes } from '../../lib/v5/secrets';
import { UNREADABLE_REQUEST, answerUnreadable, plainErrors } from '../../lib/v5/tool-input';

/** What /mcp answers to every method it does not serve (L19-1). */
const ALLOW = 'POST, DELETE, OPTIONS';

/**
 * L19-7: a JSON-RPC id that is an object, an array, a non-integer number or a number beyond the safe integers.
 * Strings, safe integers, null and absent ids are left to the transport. Pure.
 */
function badId(m: unknown): boolean {
  if (!m || typeof m !== 'object' || Array.isArray(m) || !('id' in m)) return false;
  const id = (m as { id: unknown }).id;
  if (typeof id === 'number') return !Number.isSafeInteger(id);
  return typeof id === 'object' && id !== null;
}
const INVALID_ID = { jsonrpc: '2.0', id: null, error: { code: -32600, message: UNREADABLE_REQUEST } } as const;

/**
 * L19-3: an Accept that is absent, any type, or names JSON or the event stream is served JSON (the transport needs both
 * named, and answers JSON: enableJsonResponse); null for any other, which is a 406. Pure.
 */
function servedAccept(accept: string | null): string | null {
  const both = 'application/json, text/event-stream';
  if (!accept?.trim()) return both;
  const types = accept.split(',').map((t) => t.split(';')[0].trim().toLowerCase());
  return types.some((t) => ['*/*', 'application/*', 'application/json', 'text/event-stream'].includes(t)) ? both : null;
}

/** The request with one header set; a body is passed on as a stream. */
function withHeader(request: Request, name: string, value: string): Request {
  const headers = new Headers(request.headers);
  headers.set(name, value);
  if (!request.body) return new Request(request.url, { method: request.method, headers });
  return new Request(request.url, { method: request.method, headers, body: request.body, duplex: 'half' } as RequestInit);
}

/**
 * A POSTed JSON body over 1 MB is answered 413 before it is parsed; each `tools/call`'s arguments
 * are scrubbed of secret keys before the transport sees them (only the count is logged), and
 * `scrubbed` holds those calls' ids so their replies lead with the scrub line.
 */
async function scrubbed(request: Request): Promise<{ request: Request | null; ids: Set<string | number>; old: unknown[]; batch: boolean } | Response> {
  const none = new Set<string | number>();
  const old: unknown[] = [];
  let batch = false;
  if (request.method !== 'POST' || !/application\/json/i.test(request.headers.get('content-type') ?? '')) return { request, ids: none, old, batch };
  let raw: string | null;
  try {
    raw = await readCapped(request);
  } catch (err) {
    // L19-10: a body that has not finished within 5 s.
    if (err instanceof BodyTimeoutError) return bodyTimedOut();
    throw err;
  }
  if (raw === null) return json(BODY_TOO_LARGE, 413);
  const again = (body: string, headers: Headers) => new Request(request.url, { method: request.method, headers, body });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { request: again(raw, request.headers), ids: none, old, batch };
  }
  // L19-7: a bad id is answered -32600 here: alone, a 400; in a batch, that member's answer (batches stay accepted).
  if (badId(parsed)) return json(INVALID_ID, 400);
  if (Array.isArray(parsed) && parsed.some(badId)) {
    old.push(...parsed.filter(badId).map(() => INVALID_ID));
    parsed = parsed.filter((m) => !badId(m));
    if ((parsed as unknown[]).length === 0) return { request: null, ids: none, old, batch: true };
  }
  // Old tool names are answered here; only the rest goes on (nothing: see handle).
  batch = Array.isArray(parsed);
  const split = answerOldTools(parsed);
  if (split.answers.length > 0) {
    console.log(`[mcp] old tool ${split.names.join(',')}`);
    old.push(...split.answers);
    parsed = split.rest;
    if (parsed === null) return { request: null, ids: none, old, batch };
  }
  // Too deep, or arguments that are not an object: one plain line here, before any walk (v6.1.7, B4, C35).
  const unread = answerUnreadable(parsed, MAX_ARG_DEPTH);
  if (unread.answers.length > 0 || unread.rest !== parsed) {
    console.log(`[mcp] unreadable ${unread.answers.length}`);
    old.push(...unread.answers);
    parsed = unread.rest;
    if (parsed === null) return { request: null, ids: none, old, batch };
  }
  const scrub = scrubToolCalls(parsed);
  if (scrub.removed === 0 && old.length === 0) return { request: again(raw, request.headers), ids: none, old, batch };
  if (scrub.removed > 0) console.log(`[mcp] scrubbed ${scrub.removed}`);
  // The rewritten body has its own length.
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return { request: again(JSON.stringify(scrub.body), headers), ids: scrub.ids, old, batch };
}

/**
 * The hosted EarnKit MCP server (Streamable HTTP, stateless, a server per request). Requires an
 * installation token. Tool calls are rate limited per installation and per client IP (mcp.ts).
 */
async function handle(incoming: Request) {
  let request = incoming;
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  let caller: Caller | null = null;
  try {
    caller = token ? await connectInstallation(token) : null;
  } catch {
    // A database blip is a retry, never a bare 500 (some clients then restart sign-in).
    console.error('[mcp] installation lookup failed');
    return json({ error: 'temporarily_unavailable', error_description: 'EarnKit is busy. Try again in a minute.' }, 503, { 'Retry-After': '30' });
  }
  // L19-5: a token issued for another resource is refused like no token; a null audience (before v6.1.16) is accepted.
  if (caller === null || (caller.audience !== null && caller.audience !== resourceOf(publicOrigin(request)))) {
    const metadata = `${publicOrigin(request)}/.well-known/oauth-protected-resource/mcp`;
    return json({ error: 'invalid_token', error_description: 'Sign in to EarnKit from your agent to use it.' }, 401, {
      'WWW-Authenticate': `Bearer resource_metadata="${metadata}"`,
    });
  }
  // L19-3: 406 only when Accept names neither JSON nor the event stream.
  const accept = servedAccept(request.headers.get('accept'));
  if (accept === null) return json({ error: 'not_acceptable', error_description: 'Accept application/json.' }, 406);
  if (accept !== request.headers.get('accept')) request = withHeader(request, 'accept', accept);

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createMcpServer({ installationId: caller.id, builderId: caller.builderId, ip: clientIp(request.headers) }).connect(transport);
  const s = await scrubbed(request);
  if (s instanceof Response) return s;
  if (s.request === null) return s.old.length > 0 ? json(s.batch ? s.old : s.old[0], 200) : new Response(null, { status: 202, headers: CORS });
  let response: Response;
  try {
    // A refusal by the MCP library is one plain line; its detail goes to the log only (v6.1.7, C35).
    response = await plainErrors(await withScrubNotes(await transport.handleRequest(s.request), s.ids));
  } catch (err) {
    // Input shape never answers a bare 500.
    console.error('[mcp] request failed', err instanceof Error ? err.name : typeof err);
    return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: UNREADABLE_REQUEST } }, 400);
  }
  if (s.old.length > 0) {
    // A batch with an old call: its answers join the transport's replies.
    const rest = (await response.clone().json().catch(() => [])) as unknown;
    response = json([...s.old, ...(Array.isArray(rest) ? rest : [rest])], 200);
  }
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

/** EarnKit never pushes, so there is no event stream to open (v6.1.7, B6). */
export const GET = (_request?: Request) => notAllowed(ALLOW, 'EarnKit does not push. Send requests with POST.');
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
export const PUT = () => notAllowed(ALLOW);
export const PATCH = () => notAllowed(ALLOW);
