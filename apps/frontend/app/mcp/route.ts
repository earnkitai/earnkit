import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CORS, json, preflight } from '@/lib/earnkit/http';
import { touchInstallation } from '@/lib/earnkit/installations';
import { createMcpServer } from '@/lib/earnkit/mcp';
import { publicOrigin } from '@/lib/earnkit/oauth';

/** Hosted EarnKit MCP server (Streamable HTTP, stateless). Requires an installation token. */
async function handle(request: Request) {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  const installationId = token ? await touchInstallation(token) : null;
  if (installationId === null) {
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
  await createMcpServer({ installationId }).connect(transport);
  const response = await transport.handleRequest(request);

  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
