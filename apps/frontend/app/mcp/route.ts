import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CORS, json, preflight } from '../../lib/v5/http';
import { connectInstallation, type Caller } from '../../lib/v5/installations';
import { createMcpServer } from '../../lib/v5/mcp';
import { publicOrigin } from '../../lib/v5/oauth';
import { BODY_TOO_LARGE, readCapped, scrubToolCalls, withScrubNotes } from '../../lib/v5/secrets';

/**
 * A POSTed JSON body over 1 MB is answered 413 before it is parsed; each `tools/call`'s arguments
 * are scrubbed of secret keys before the transport sees them (only the count is logged), and
 * `scrubbed` holds those calls' ids so their replies lead with the scrub line.
 */
async function scrubbed(request: Request): Promise<{ request: Request; ids: Set<string | number> } | Response> {
  const none = new Set<string | number>();
  if (request.method !== 'POST' || !/application\/json/i.test(request.headers.get('content-type') ?? '')) return { request, ids: none };
  const raw = await readCapped(request);
  if (raw === null) return json(BODY_TOO_LARGE, 413);
  const again = (body: string, headers: Headers) => new Request(request.url, { method: request.method, headers, body });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { request: again(raw, request.headers), ids: none };
  }
  const scrub = scrubToolCalls(parsed);
  if (scrub.removed === 0) return { request: again(raw, request.headers), ids: none };
  console.log(`[mcp] scrubbed ${scrub.removed}`);
  // The scrubbed body has its own length.
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return { request: again(JSON.stringify(scrub.body), headers), ids: scrub.ids };
}

/** The hosted EarnKit MCP server (Streamable HTTP, stateless, a server per request). Requires an installation token. */
async function handle(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  let caller: Caller | null = null;
  try {
    caller = token ? await connectInstallation(token) : null;
  } catch {
    // A database blip is a retry, never a bare 500 (some clients then restart sign-in).
    console.error('[mcp] installation lookup failed');
    return json({ error: 'temporarily_unavailable', error_description: 'EarnKit is busy. Try again in a minute.' }, 503, { 'Retry-After': '30' });
  }
  if (caller === null) {
    const metadata = `${publicOrigin(request)}/.well-known/oauth-protected-resource/mcp`;
    return json({ error: 'invalid_token', error_description: 'Connect EarnKit to get a token' }, 401, {
      'WWW-Authenticate': `Bearer resource_metadata="${metadata}"`,
    });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createMcpServer({ installationId: caller.id }).connect(transport);
  const s = await scrubbed(request);
  if (s instanceof Response) return s;
  const response = await withScrubNotes(await transport.handleRequest(s.request), s.ids);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
