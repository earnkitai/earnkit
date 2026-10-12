import { createHash, timingSafeEqual } from 'node:crypto';

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

/**
 * Whether `given` equals `secret`, in constant time (both hashed first, so lengths don't leak). An
 * unset secret, or one under 32 characters, never matches (v2.4 §8). Pure; exported for tests.
 */
export function secretMatches(given: string | null | undefined, secret: string | undefined) {
  if (!secret || secret.length < 32 || !given) return false;
  return timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(secret).digest(),
  );
}

/** "Authorization: Bearer <secret>". Pure. */
export const bearerMatches = (header: string | null, secret: string | undefined) =>
  secretMatches(/^Bearer (\S+)$/.exec(header ?? '')?.[1], secret);

/**
 * A query parameter as one string: Next gives `?key=a&key=b` as an array, which is never a key.
 * Pure.
 */
export const oneParam = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
