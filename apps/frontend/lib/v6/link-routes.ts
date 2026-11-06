/**
 * The link from agent to builder: a one-time code the agent shows (/link/<code>) opens a confirm
 * page; its button (POST) binds this browser with a nonce cookie and goes to GitHub sign-in; the
 * callback checks the nonce, links the installation, starts a session and lands on /me. Rate
 * limited per IP; only the code's hash is stored; nothing logs a token, a code or a secret.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from '../v5/db';
import { publicOrigin } from '../v5/oauth';
import { escapeHtml } from '../v5/programs-pending';
import { RateLimitError, clientIp, enforce } from '../v5/rate-limit';
import { SITE } from '../v5/site-theme';
import { LinkRefused, linkInstallation, upsertBuilder } from './builders';
import { GitHubAuthError, type GitHubUser, authorizeUrl, exchangeCode, oauthConfigured, signState, verifyState } from './github-auth';
import { cookieOf, cookieValue, createSession } from './sessions';

const TTL_MS = 15 * 60_000;
const LINK_COOKIE = 'ek_link';
const NOT_SET_UP = 'GitHub sign-in is not set up yet.';
const EXPIRED = 'This link has expired. Ask your agent for a new one.';
const FAILED = 'Sign-in failed. Ask your agent for a new link.';
const OTHER = 'This agent is already linked to another account. Install EarnKit again for a fresh link.';
/** A code as createLinkCode makes it: 16 bytes in base64url. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{22}$/;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const page = (text: string, status: number, headers: Record<string, string> = {}) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

function secret() {
  const s = process.env.EARNKIT_AUTH_SECRET;
  if (!s) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return s;
}

/** A new code for the installation (16 random bytes, 15 minutes); its earlier live code stops working. */
export async function createLinkCode(installationId: number, now: Date): Promise<string> {
  const code = randomBytes(16).toString('base64url');
  await sql().begin(async (tx) => {
    const [inst] = await tx<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${installationId} FOR UPDATE`;
    if (inst?.builder_id != null) throw new LinkRefused('already_linked');
    await tx`UPDATE link_codes SET expires_at = ${now} WHERE installation_id = ${installationId} AND used_at IS NULL AND expires_at > ${now}`;
    await tx`INSERT INTO link_codes (code, installation_id, created_at, expires_at)
      VALUES (${hash(code)}, ${installationId}, ${now}, ${new Date(now.getTime() + TTL_MS)})`;
  });
  return code;
}

type Live = { installation_id: number; client_name: string | null; created_at: Date };
/** The unused, unexpired code's installation, or null. */
async function liveCode(code: string, now: Date): Promise<Live | null> {
  if (!CODE_SHAPE.test(code)) return null;
  const [r] = await sql()<Live[]>`
    SELECT l.installation_id, i.client_name, i.created_at FROM link_codes l JOIN installations i ON i.id = l.installation_id
    WHERE l.code = ${hash(code)} AND l.used_at IS NULL AND l.expires_at > ${now}`;
  return r ?? null;
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

const day = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);

/** The confirm page: one button, no script, never framed. Pure. */
function confirmPage(live: Live): Response {
  const who = live.client_name ? `the agent <strong>${escapeHtml(live.client_name)}</strong>` : 'your agent';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Link your agent</title></head>
<body style="margin:0;background:${SITE.page};color:#E8EAF2;font-family:system-ui,sans-serif">
<main style="max-width:480px;margin:15vh auto 0;padding:0 16px">
<p style="font-size:18px;line-height:1.5">Link ${who}, first seen ${day(live.created_at)}, to your GitHub account?</p>
<form method="post"><button type="submit" style="background:${SITE.blue};color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:16px;cursor:pointer">Continue with GitHub</button></form>
<p style="color:#9AA0B4;font-size:14px;line-height:1.5">If you did not ask your agent for this link, close this page.</p>
</main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'",
    },
  });
}

/** GET /link/<code>: the confirm page for a live code. */
export function linkGet(request: Request, code: string, deps: { now?: Date } = {}): Promise<Response> {
  return guarded(request, async () => {
    const live = await liveCode(code, deps.now ?? new Date());
    return live ? confirmPage(live) : page(EXPIRED, 404);
  });
}

/** POST /link/<code>: binds this browser (the ek_link nonce, in a cookie and the signed state) and goes to GitHub. */
export function linkPost(request: Request, code: string, deps: { now?: Date } = {}): Promise<Response> {
  return guarded(request, async () => {
    const now = deps.now ?? new Date();
    const origin = publicOrigin(request);
    // The button is on our page; a form posted from another site is refused.
    const from = request.headers.get('origin');
    if (from && from !== origin) return page(FAILED, 403);
    if (!(await liveCode(code, now))) return page(EXPIRED, 404);
    const nonce = randomBytes(16).toString('base64url');
    const state = signState({ code, nonce, exp: now.getTime() + TTL_MS }, secret());
    return new Response(null, {
      status: 302,
      headers: { Location: authorizeUrl(state, origin), 'Set-Cookie': cookieOf(LINK_COOKIE, nonce, TTL_MS / 1000), 'Cache-Control': 'no-store' },
    });
  });
}

/** Equal strings, in constant time. Pure. */
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** GET /auth/github/callback: the GitHub user becomes the builder the code's installation links to. */
export function callbackGet(request: Request, deps: { now?: Date; gh?: typeof fetch } = {}): Promise<Response> {
  return guarded(request, async () => {
    const now = deps.now ?? new Date();
    const q = new URL(request.url).searchParams;
    const linked = verifyState(q.get('state') ?? '', secret(), now);
    const nonce = cookieValue(request.headers.get('cookie'), LINK_COOKIE);
    const ghCode = q.get('code');
    if (!linked || !nonce || !same(nonce, linked.nonce) || !ghCode) return page(FAILED, 400);
    // The state proves the code was live at /link; here it only has to be unused.
    if ((await sql()`SELECT 1 FROM link_codes WHERE code = ${hash(linked.code)} AND used_at IS NULL`).length === 0) return page(FAILED, 400);
    let user: GitHubUser;
    try {
      user = await exchangeCode(ghCode, publicOrigin(request), process.env, deps.gh ?? fetch);
    } catch (err) {
      if (!(err instanceof GitHubAuthError)) throw err;
      console.warn(`[link] ${err.message}`);
      return page(FAILED, 400);
    }
    const builder = await upsertBuilder(user, now);
    let done: boolean;
    try {
      // Single use: the code is marked and the installation linked together, or neither.
      done = await sql().begin(async (tx) => {
        const [used] = await tx<{ installation_id: number }[]>`
          UPDATE link_codes SET used_at = ${now} WHERE code = ${hash(linked.code)} AND used_at IS NULL RETURNING installation_id`;
        if (!used) return false;
        await linkInstallation(used.installation_id, builder.id, now, tx);
        return true;
      }) as boolean;
    } catch (err) {
      if (err instanceof LinkRefused) return page(OTHER, 400);
      throw err;
    }
    if (!done) return page(FAILED, 400);
    const { cookie } = await createSession(builder.id, now);
    const headers = new Headers({ Location: '/me', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', cookie);
    headers.append('Set-Cookie', cookieOf(LINK_COOKIE, '', 0));
    return new Response(null, { status: 302, headers });
  });
}
