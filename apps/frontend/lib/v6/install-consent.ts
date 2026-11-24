/**
 * The install consent page (v3.8 E4). With the `install_signin` flag on, authorize sends the browser to GitHub
 * (lib/v6/link-routes.ts installSignIn); the callback reads the GitHub user and lands here, GET /install/consent, with a
 * signed state. Nothing is written and no code is issued until the person presses Connect: a POST from our own page
 * that carries a CSRF value made from the browser's nonce cookie (`csrfOf`). That closes C1 (v6.1.21): a link someone
 * else built can walk a signed-in browser through GitHub, but it cannot press Connect for them. Cancelled, denied,
 * expired and failed sign-ins land on a plain page with one next step. The GitHub token is never stored.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { flagOn } from '../v5/flags';
import { readParams } from '../v5/http';
import { displayName } from '../v5/installations';
import { OAuthError, clientNameOf, clientOf, issueCode, publicOrigin } from '../v5/oauth';
import { escapeHtml } from '../v5/programs-pending';
import { upsertBuilder } from './builders';
import { type GitHubUser, type PendingInstall, oauthConfigured } from './github-auth';
import { markVerified } from './people';
import { cookieOf, cookieValue } from './sessions';

/** The install sign-in's nonce cookie (v6.1.21): `__Host-` in production, as the session cookie is. */
export const installCookie = () => (process.env.NODE_ENV === 'production' ? '__Host-ek_install' : 'ek_install');
export const CONSENT_PATH = '/install/consent';
/** How long a sign-in stays open, from authorize to Connect. */
export const INSTALL_TTL_MS = 15 * 60_000;
const MAX_FORM = 8_192;

/** The plain pages a sign-in that did not connect lands on (plan 23.3: what happened, then one next step). */
export const INSTALL_PAGES = {
  failed: { status: 400, text: 'Connecting EarnKit failed: the GitHub sign-in did not finish. Ask your agent to connect EarnKit again.' },
  denied: { status: 200, text: "You said no on GitHub, so nothing was connected. Ask your agent to connect EarnKit again when you're ready." },
  cancelled: { status: 200, text: "Nothing was connected. Ask your agent to connect EarnKit again when you're ready." },
  expired: { status: 400, text: 'This sign-in expired, so nothing was connected. Ask your agent to connect EarnKit again.' },
} as const;
export type InstallPage = keyof typeof INSTALL_PAGES;

/** A plain page; it always clears the nonce cookie, so the sign-in it ends cannot be finished later. */
export function installPage(kind: InstallPage): Response {
  const p = INSTALL_PAGES[kind];
  return new Response(p.text, {
    status: p.status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookieOf(installCookie(), '', 0) },
  });
}

function secret() {
  const s = process.env.EARNKIT_AUTH_SECRET;
  if (!s) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return s;
}

const mac = (label: string, body: string, key: string) => createHmac('sha256', key).update(`${label}:${body}`).digest('base64url');
/** Equal strings, in constant time. Pure. */
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** The form's CSRF value: an HMAC of the browser's nonce, so only a page this browser was shown can post it. Pure. */
export const csrfOf = (nonce: string, key: string): string => mac('install-consent-csrf', nonce, key);

/** What the consent page and its POST need: the checked authorize request, the GitHub user, the nonce, when. */
export type Consent = { req: PendingInstall; user: GitHubUser; nonce: string; at: number; exp: number };

/** body.sig under its own label, so it never verifies as a link or install state. `exp`, `at`: epoch ms. Pure. */
export function signConsent(c: Consent, key: string): string {
  const user = { ...c.user, created_at: c.user.created_at?.toISOString() ?? null };
  const body = Buffer.from(JSON.stringify({ k: 'consent', ...c, user })).toString('base64url');
  return `${body}.${mac('install-consent-state', body, key)}`;
}

/** The consent a state carries; 'expired' when signed but past `exp`; null when forged, malformed or another kind. Pure. */
export function verifyConsent(state: string, key: string, now: Date): Consent | 'expired' | null {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !same(parts[1], mac('install-consent-state', parts[0], key))) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as Partial<Omit<Consent, 'user'>> & { k?: unknown; user?: Record<string, unknown> };
    const r = p.req;
    const u = p.user;
    if (p.k !== 'consent' || typeof p.nonce !== 'string' || typeof p.exp !== 'number' || typeof p.at !== 'number') return null;
    if (!r || typeof r.client_id !== 'string' || typeof r.redirect_uri !== 'string' || typeof r.code_challenge !== 'string') return null;
    if (!u || typeof u.github_id !== 'number' || typeof u.login !== 'string') return null;
    if (p.exp <= now.getTime()) return 'expired';
    const created = typeof u.created_at === 'string' ? new Date(u.created_at) : null;
    return {
      req: { client_id: r.client_id, redirect_uri: r.redirect_uri, state: typeof r.state === 'string' ? r.state : null, code_challenge: r.code_challenge, ...(typeof r.resource === 'string' && { resource: r.resource }) },
      user: {
        github_id: u.github_id,
        login: u.login,
        name: typeof u.name === 'string' ? u.name : null,
        avatar_url: typeof u.avatar_url === 'string' ? u.avatar_url : null,
        created_at: created && !Number.isNaN(created.getTime()) ? created : null,
      },
      nonce: p.nonce,
      at: p.at,
      exp: p.exp,
    };
  } catch {
    return null;
  }
}

/** The callback's next stop: the consent page for this user, with the nonce cookie kept. */
export function toConsent(c: Omit<Consent, 'exp'>, now: Date): Response {
  const s = signConsent({ ...c, exp: now.getTime() + INSTALL_TTL_MS }, secret());
  return new Response(null, { status: 303, headers: { Location: `${CONSENT_PATH}?s=${encodeURIComponent(s)}`, 'Cache-Control': 'no-store' } });
}

/** The state and this browser's nonce when they belong together; else the page to show. */
function checked(request: Request, s: string, now: Date): { c: Consent; nonce: string } | InstallPage {
  const c = verifyConsent(s, secret(), now);
  if (c === 'expired') return 'expired';
  const nonce = cookieValue(request.headers.get('cookie'), installCookie());
  if (!c || !nonce || !same(nonce, c.nonce)) return 'failed';
  return { c, nonce };
}

/**
 * Whether authorize asks for a GitHub sign-in first: the `install_signin` flag (EARNKIT_FLAGS) and the OAuth app set up.
 * Off is the anonymous approval; turning it off is the rollback, and a sign-in already under way then ends on the
 * failed page.
 */
export const installSignInOn = (env: Record<string, string | undefined> = process.env): boolean =>
  flagOn('install_signin', env) && oauthConfigured(env);

type Deps = { now?: Date };

/** The consent copy for this agent and account (plan 23.3). Pure. */
export function consentCopy(agent: string | null, host: string, login: string) {
  const who = agent ? `"${agent}"` : 'this agent';
  return {
    title: `Connect ${who} to EarnKit?`,
    lines: [
      `You're signed in to GitHub as @${login}. ${agent ? `"${agent}"` : 'The agent'} at ${host} gets your EarnKit profile.`,
      "EarnKit reads only your public GitHub profile. It can't see your private repos or post for you.",
    ],
    yes: 'Connect',
    no: 'Not now',
  };
}

const page = (copy: ReturnType<typeof consentCopy>, s: string, csrf: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(copy.title.replace(/\?$/, ''))} · EarnKit</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111}button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}</style>
</head><body><main><h1>${escapeHtml(copy.title)}</h1>
${copy.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
<form method="post" action="${CONSENT_PATH}">
<input type="hidden" name="s" value="${escapeHtml(s)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<button type="submit" name="answer" value="yes">${escapeHtml(copy.yes)}</button><button type="submit" name="answer" value="no">${escapeHtml(copy.no)}</button>
</form></main></body></html>`;

/** GET /install/consent?s=<state>: who is signed in, which agent asks, and the two buttons. Writes nothing. */
export async function consentGet(request: Request, deps: Deps = {}): Promise<Response> {
  if (!installSignInOn()) return installPage('failed');
  const s = new URL(request.url).searchParams.get('s') ?? '';
  const ok = checked(request, s, deps.now ?? new Date());
  if (typeof ok === 'string') return installPage(ok);
  let client;
  try {
    client = await clientOf(ok.c.req.client_id);
  } catch (err) {
    // A client document that no longer passes its checks: the sign-in cannot finish.
    if (!(err instanceof OAuthError)) throw err;
    return installPage('failed');
  }
  if (!client || !client.r.includes(ok.c.req.redirect_uri)) return installPage('failed');
  const copy = consentCopy(displayName(clientNameOf(client.cn)), new URL(ok.c.req.redirect_uri).host, ok.c.user.login);
  return new Response(page(copy, s, csrfOf(ok.nonce, secret())), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' },
  });
}

/**
 * POST /install/consent: our own page's form (same origin, the nonce cookie, its CSRF value, a live state). Not now
 * ends the sign-in. Connect makes or updates the builder (one GitHub account is one builder, so one person, however
 * many installs), marks the person verified by GitHub at the callback's time, and sends the client its code.
 */
export async function consentPost(request: Request, deps: Deps = {}): Promise<Response> {
  if (!installSignInOn()) return installPage('failed');
  // Browsers send Origin on every form POST; none, or another site's, is refused.
  if (request.headers.get('origin') !== publicOrigin(request)) return installPage('failed');
  const form = await readParams(request, MAX_FORM);
  if (!form) return installPage('failed');
  const ok = checked(request, form.get('s') ?? '', deps.now ?? new Date());
  if (typeof ok === 'string') return installPage(ok);
  if (!same(form.get('csrf') ?? '', csrfOf(ok.nonce, secret()))) return installPage('failed');
  if (form.get('answer') !== 'yes') return installPage('cancelled');
  try {
    const at = new Date(ok.c.at);
    const builder = await upsertBuilder(ok.c.user, at);
    await markVerified({ builderId: builder.id, login: builder.login, by: 'github', at, accountCreatedAt: ok.c.user.created_at });
    const back = await issueCode(ok.c.req, { builderId: builder.id }, publicOrigin(request));
    return new Response(null, { status: 303, headers: { Location: back.toString(), 'Set-Cookie': cookieOf(installCookie(), '', 0), 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    return installPage('failed');
  }
}
