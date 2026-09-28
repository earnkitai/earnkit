/** Remote MCP clients can be browser-based (e.g. inspectors), so these endpoints allow any origin. */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { ...CORS, 'Cache-Control': 'no-store', ...headers },
  });

export const preflight = () =>
  new Response(null, { status: 204, headers: CORS });

/** Reads a form or JSON body as URLSearchParams. */
export async function readParams(request: Request) {
  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return new URLSearchParams(
      Object.entries(body).map(([k, v]) => [k, String(v)]),
    );
  }
  return new URLSearchParams(await request.text());
}
