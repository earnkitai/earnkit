/**
 * The link from agent to builder: a one-time code the agent shows (/link/<code>) sends the builder
 * to GitHub sign-in; the callback links the installation, starts a session and lands on /me.
 * Both routes are rate limited per IP. Nothing here logs a token, a code or a secret.
 */
import { randomBytes } from 'node:crypto';
import { sql } from '../v5/db';
import { publicOrigin } from '../v5/oauth';
import { RateLimitError, clientIp, enforce } from '../v5/rate-limit';
import { linkInstallation, upsertBuilder } from './builders';
import { GitHubAuthError, type GitHubUser, authorizeUrl, exchangeCode, oauthConfigured, signState, verifyState } from './github-auth';
import { createSession } from './sessions';

const TTL_MS = 15 * 60_000;
const NOT_SET_UP = 'GitHub sign-in is not set up yet.';
const EXPIRED = 'This link has expired. Ask your agent for a new one.';
const FAILED = 'Sign-in failed. Ask your agent for a new link.';
/** A code as createLinkCode makes it: 16 bytes in base64url. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{22}$/;

const page = (text: string, status: number, headers: Record<string, string> = {}) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

function secret() {
  const s = process.env.EARNKIT_AUTH_SECRET;
  if (!s) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return s;
}

/** The installation's live code, or a new one (16 random bytes, 15 minutes). */
export async function createLinkCode(installationId: number, now: Date): Promise<string> {
  const [live] = await sql()<{ code: string }[]>`
    SELECT code FROM link_codes WHERE installation_id = ${installationId} AND used_at IS NULL AND expires_at > ${now}
    ORDER BY expires_at DESC LIMIT 1`;
  if (live) return live.code;
  const code = randomBytes(16).toString('base64url');
  await sql()`INSERT INTO link_codes (code, installation_id, created_at, expires_at)
    VALUES (${code}, ${installationId}, ${now}, ${new Date(now.getTime() + TTL_MS)})`;
  return code;
}

/** The unused, unexpired code's installation, or null. */
async function liveCode(code: string, now: Date): Promise<number | null> {
  if (!CODE_SHAPE.test(code)) return null;
  const [r] = await sql()<{ installation_id: number }[]>`
    SELECT installation_id FROM link_codes WHERE code = ${code} AND used_at IS NULL AND expires_at > ${now}`;
  return r?.installation_id ?? null;
}

const limit = (request: Request) => enforce('linkGet', clientIp(request.headers), 'Too many sign-ins from this address.');

/** Runs a route behind the setup check and the IP limit. */
async function guarded(request: Request, fn: () => Promise<Response>): Promise<Response> {
  if (!oauthConfigured()) return page(NOT_SET_UP, 503);
  try {
    await limit(request);
  } catch (err) {
    if (err instanceof RateLimitError) return page(err.message, 429, { 'Retry-After': String(err.retryAfter) });
    throw err;
  }
  return fn();
}

/** GET /link/<code>: a live code goes to GitHub with the code in the signed state. */
export function linkGet(request: Request, code: string, deps: { now?: Date } = {}): Promise<Response> {
  return guarded(request, async () => {
    const now = deps.now ?? new Date();
    if ((await liveCode(code, now)) === null) return page(EXPIRED, 404);
    const state = signState({ code, exp: now.getTime() + TTL_MS }, secret());
    return new Response(null, { status: 302, headers: { Location: authorizeUrl(state, publicOrigin(request)), 'Cache-Control': 'no-store' } });
  });
}

/** GET /auth/github/callback: the GitHub user becomes the builder the code's installation links to. */
export function callbackGet(request: Request, deps: { now?: Date; gh?: typeof fetch } = {}): Promise<Response> {
  return guarded(request, async () => {
    const now = deps.now ?? new Date();
    const q = new URL(request.url).searchParams;
    const linked = verifyState(q.get('state') ?? '', secret(), now);
    const ghCode = q.get('code');
    // The state proves the code was live at /link; here it only has to be unused.
    const unused = linked && (await sql()`SELECT 1 FROM link_codes WHERE code = ${linked.code} AND used_at IS NULL`).length > 0;
    if (!linked || !ghCode || !unused) return page(FAILED, 400);
    let user: GitHubUser;
    try {
      user = await exchangeCode(ghCode, publicOrigin(request), process.env, deps.gh ?? fetch);
    } catch (err) {
      if (!(err instanceof GitHubAuthError)) throw err;
      console.warn(`[link] ${err.message}`);
      return page(FAILED, 400);
    }
    const builder = await upsertBuilder(user, now);
    // Single use: only the first callback to mark the code goes on.
    const [used] = await sql()<{ installation_id: number }[]>`
      UPDATE link_codes SET used_at = ${now} WHERE code = ${linked.code} AND used_at IS NULL RETURNING installation_id`;
    if (!used) return page(FAILED, 400);
    await linkInstallation(used.installation_id, builder.id, now);
    const { cookie } = await createSession(builder.id, now);
    return new Response(null, { status: 302, headers: { Location: '/me', 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
  });
}
