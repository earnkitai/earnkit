import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { aliasedIds, forOldClient, rewriteAliases } from '../../lib/earnkit/aliases';
import { CORS, json, preflight } from '../../lib/earnkit/http';
import { connectInstallation, type Caller } from '../../lib/earnkit/installations';
import { earnkitCampaignOpen } from '../../lib/earnkit/leaderboard';
import { createMcpServer } from '../../lib/earnkit/mcp';
import { publicOrigin } from '../../lib/earnkit/oauth';

/**
 * v2.10 item 4 (R17): a POSTed JSON body with an old tool name in a `tools/call` is rewritten to the
 * new tool and its arguments before the transport sees it, and each use is logged by name only (never
 * an argument). A body that isn't JSON passes through untouched.
 */
type Aliased = { request: Request; old: Map<string | number, string> };

async function withAliases(request: Request): Promise<Aliased> {
  const none = new Map<string | number, string>();
  if (request.method !== 'POST' || !/application\/json/i.test(request.headers.get('content-type') ?? '')) return { request, old: none };
  const raw = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { request: new Request(request.url, { method: request.method, headers: request.headers, body: raw }), old: none };
  }
  const now = new Date();
  // v2.10.1 B5: which calls used an old name, so their replies name only the tools that client lists.
  const old = aliasedIds(parsed, now);
  const { body, changed } = await rewriteAliases(parsed, now, (o, next) => console.log(`[mcp] alias ${o} -> ${next}`));
  if (!changed) return { request: new Request(request.url, { method: request.method, headers: request.headers, body: raw }), old: none };
  // The rewritten body has its own length.
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return { request: new Request(request.url, { method: request.method, headers, body: JSON.stringify(body) }), old };
}

/**
 * v2.10.1 B5, fix round 1 (I3): the reply to a call made with an old tool name. That client may still
 * list the v2.9 tools, or may have refreshed: each tool reply names every tool in both forms and
 * carries `tools_note` (aliases.ts forOldClient). Plain JSON, as every other reply (no list_changed
 * stream: a client that obeys it mid-reply would hold a list the reply's words don't match). Any other
 * response passes through.
 */
async function forOldNames(response: Response, old: Map<string | number, string>): Promise<Response> {
  if (old.size === 0 || response.status !== 200 || !/application\/json/i.test(response.headers.get('content-type') ?? '')) return response;
  const parsed = (await response.json()) as unknown;
  const one = (m: unknown) => {
    const id = (m as { id?: unknown })?.id;
    const used = typeof id === 'string' || typeof id === 'number' ? old.get(id) : undefined;
    return used ? forOldClient(m, used) : m;
  };
  const body = Array.isArray(parsed) ? parsed.map(one) : one(parsed);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: 200, headers });
}

/** Hosted EarnKit MCP server (Streamable HTTP, stateless). Requires an installation token. */
async function handle(request: Request) {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  let caller: Caller | null = null;
  try {
    caller = token ? await connectInstallation(token) : null;
  } catch {
    // Audit row 19: a database blip is a retry, never a bare 500 (some clients then restart sign-in).
    console.error('[mcp] installation lookup failed');
    return json({ error: 'temporarily_unavailable', error_description: 'EarnKit is busy. Try again in a minute.' }, 503, {
      'Retry-After': '30',
    });
  }
  if (caller === null) {
    const metadata = `${publicOrigin(request)}/.well-known/oauth-protected-resource/mcp`;
    return json(
      {
        error: 'invalid_token',
        error_description: 'Connect EarnKit to get a token',
      },
      401,
      {
        'WWW-Authenticate': `Bearer resource_metadata="${metadata}"`,
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  // v2.8 Ruling 23 (plan): campaign-only text shows only while an EarnKit campaign is open.
  const campaignOpen = await earnkitCampaignOpen().catch(() => {
    console.error('[mcp] campaign check failed');
    return false;
  });
  // v2.8.1 §E17/E18: the tools act as the group's root; ownInstallationId is the token's own installation,
  // and the hosted-agent rules (sharedClient) the whole group's. v2.14: the token's X account.
  await createMcpServer(
    { installationId: caller.id, ownInstallationId: caller.own, sharedClient: caller.shared },
    { campaignOpen },
  ).connect(transport);
  const aliased = await withAliases(request);
  const response = await forOldNames(await transport.handleRequest(aliased.request), aliased.old);

  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
