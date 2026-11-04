/**
 * HTTP helpers for the route handlers: JSON answers and the CORS preflight (any origin may read
 * them, never cached), form or JSON params, constant-time secret and Bearer checks, and a request
 * body read under a size cap.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** Agents and their inspectors can be browser-based, so these endpoints allow any origin. */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

/** The CORS preflight answer. */
export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** A form or JSON body as URLSearchParams. */
export async function readParams(request: Request): Promise<URLSearchParams> {
  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(body ?? {}).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await request.text());
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...headers } });

/**
 * Whether `given` equals `secret`, in constant time (both hashed first, so lengths don't leak). An
 * unset secret, or one under 32 characters, never matches. Pure.
 */
export function secretMatches(given: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !given) return false;
  return timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(secret).digest());
}

/** "Authorization: Bearer <secret>". Pure. */
export const bearerMatches = (header: string | null, secret: string | undefined): boolean =>
  secretMatches(/^Bearer (\S+)$/.exec(header ?? '')?.[1], secret);

/** The body as text, or null when it is (or declares itself) over `max` bytes; reading stops at the cap. */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
