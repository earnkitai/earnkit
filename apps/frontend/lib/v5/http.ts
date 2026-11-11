/**
 * HTTP helpers for the route handlers: JSON answers and the CORS preflight (any origin may read
 * them, never cached), form or JSON params, constant-time secret and Bearer checks, a request
 * body read under a size cap and a time limit, and the 405 answer.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** Agents and their inspectors can be browser-based, so these endpoints allow any origin. */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

/** The CORS preflight answer. */
export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** A form or JSON body as URLSearchParams, read under `max` bytes; null when over it. */
export async function readParams(request: Request, max: number): Promise<URLSearchParams | null> {
  const text = await readCapped(request, max);
  if (text === null) return null;
  if (request.headers.get('content-type')?.includes('application/json')) {
    let body: unknown = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    return new URLSearchParams(Object.entries(typeof body === 'object' && body !== null ? body : {}).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(text);
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...headers } });

/** 405 with `Allow` and CORS (L19-1, L19-10). `description` only where a route has its own reason. */
export const notAllowed = (allow: string, description?: string) =>
  json({ error: 'method_not_allowed', ...(description && { error_description: description }) }, 405, { Allow: allow });

/** A request body that did not finish within readCapped's time limit (L19-10). */
export class BodyTimeoutError extends Error {
  constructor() {
    super('body read timed out');
    this.name = 'BodyTimeoutError';
  }
}

/** The OAuth-style 408 answer to a BodyTimeoutError, with its one log line (L19-10). */
export function bodyTimedOut(): Response {
  console.warn('[http] body read timed out');
  return requestTimeout();
}
const requestTimeout = () => json({ error: 'request_timeout', error_description: 'The request body came too slowly.' }, 408);

/**
 * readCapped for a route (v6.1.16 Task 5 fix round 1, I2): the text, null over `max`, or, for a body not finished
 * within `timeoutMs`, the caller's 408 (`slow`, default bodyTimedOut's JSON) after the one log line. Any other error
 * is thrown, so a real 413 stays a 413 and nothing else is swallowed.
 */
export async function readBody(
  request: Pick<Request, 'headers' | 'body'>,
  max: number,
  slow: () => Response = requestTimeout,
  timeoutMs = 5_000,
): Promise<string | null | Response> {
  try {
    return await readCapped(request, max, timeoutMs);
  } catch (err) {
    if (!(err instanceof BodyTimeoutError)) throw err;
    console.warn('[http] body read timed out');
    return slow();
  }
}

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

/**
 * The body (of a request or a response) as text, or null when it is (or declares itself) over `max` bytes; reading
 * stops at the cap. A body not finished within `timeoutMs` throws BodyTimeoutError, the reader cancelled (L19-10).
 */
export async function readCapped(request: Pick<Request, 'headers' | 'body'>, max: number, timeoutMs = 5_000): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const deadline = Date.now() + timeoutMs;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), Math.max(0, deadline - Date.now()));
    });
    const next = await Promise.race([reader.read(), late]).finally(() => clearTimeout(timer));
    if (next === 'late') {
      reader.cancel().catch(() => undefined);
      throw new BodyTimeoutError();
    }
    const { done, value } = next;
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
