import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CORS, json, preflight } from '@/lib/earnkit/http';
import { connectInstallation, type Caller } from '@/lib/earnkit/installations';
import { earnkitCampaignOpen } from '@/lib/earnkit/leaderboard';
import { createMcpServer } from '@/lib/earnkit/mcp';
import { publicOrigin } from '@/lib/earnkit/oauth';

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
  // v2.8.1 §E17/E18: the tools act as the group's root; the pickup offer and the hosted-agent rules
  // read the token's own installation.
  await createMcpServer(
    { installationId: caller.id, ownInstallationId: caller.own, sharedClient: caller.shared },
    { campaignOpen },
  ).connect(transport);
  const response = await transport.handleRequest(request);

  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
