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
import { upsertBuilder, upsertXBuilder } from './builders';
import { type GitHubUser, type PendingInstall, oauthConfigured } from './github-auth';
import { markVerified } from './people';
import { cookieOf, cookieValue } from './sessions';
import { type XUser, xSignInOn } from './x-auth';

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

export function installSecret() {
  const s = process.env.EARNKIT_AUTH_SECRET;
  if (!s) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return s;
}

const mac = (label: string, body: string, key: string) => createHmac('sha256', key).update(`${label}:${body}`).digest('base64url');
/** Equal strings, in constant time. Pure. */
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** The form's CSRF value: an HMAC of the browser's nonce, so only a page this browser was shown can post it. Pure. */
export const csrfOf = (nonce: string, key: string): string => mac('install-consent-csrf', nonce, key);

/** Who signed in: a GitHub user, or (v3.8 E5, flag `x_signin`) an X account. */
export type Who = { by: 'github'; user: GitHubUser } | { by: 'x'; user: XUser };
/** What the consent page and its POST need: the checked authorize request, who signed in, the nonce, when. */
export type Consent = { req: PendingInstall; who: Who; nonce: string; at: number; exp: number };

/** body.sig under its own label, so it never verifies as a link or install state. `exp`, `at`: epoch ms. Pure. */
export function signConsent(c: Consent, key: string): string {
  const who = { by: c.who.by, user: { ...c.who.user, created_at: c.who.user.created_at?.toISOString() ?? null } };
  const body = Buffer.from(JSON.stringify({ k: 'consent', ...c, who })).toString('base64url');
  return `${body}.${mac('install-consent-state', body, key)}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const dateOf = (v: unknown) => {
  const d = typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
/** The signed-in account a parsed state names, or null when its fields are missing. Pure. */
function whoOf(w: { by?: unknown; user?: Record<string, unknown> } | undefined): Who | null {
  const u = w?.user;
  if (!u) return null;
  const common = { name: str(u.name), avatar_url: str(u.avatar_url), created_at: dateOf(u.created_at) };
  if (w.by === 'github' && typeof u.github_id === 'number' && typeof u.login === 'string') return { by: 'github', user: { github_id: u.github_id, login: u.login, ...common } };
  if (w.by === 'x' && typeof u.x_user_id === 'string' && typeof u.handle === 'string') return { by: 'x', user: { x_user_id: u.x_user_id, handle: u.handle, ...common } };
  return null;
}

/** The consent a state carries; 'expired' when signed but past `exp`; null when forged, malformed or another kind. Pure. */
export function verifyConsent(state: string, key: string, now: Date): Consent | 'expired' | null {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !same(parts[1], mac('install-consent-state', parts[0], key))) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as Partial<Omit<Consent, 'who'>> & { k?: unknown; who?: { by?: unknown; user?: Record<string, unknown> } };
    const r = p.req;
    const who = whoOf(p.who);
    if (p.k !== 'consent' || typeof p.nonce !== 'string' || typeof p.exp !== 'number' || typeof p.at !== 'number' || !who) return null;
    if (!r || typeof r.client_id !== 'string' || typeof r.redirect_uri !== 'string' || typeof r.code_challenge !== 'string') return null;
    if (p.exp <= now.getTime()) return 'expired';
    return {
      req: { client_id: r.client_id, redirect_uri: r.redirect_uri, state: typeof r.state === 'string' ? r.state : null, code_challenge: r.code_challenge, ...(typeof r.resource === 'string' && { resource: r.resource }) },
      who,
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
  const s = signConsent({ ...c, exp: now.getTime() + INSTALL_TTL_MS }, installSecret());
  return new Response(null, { status: 303, headers: { Location: `${CONSENT_PATH}?s=${encodeURIComponent(s)}`, 'Cache-Control': 'no-store' } });
}

/** The state and this browser's nonce when they belong together; else the page to show. */
function checked(request: Request, s: string, now: Date): { c: Consent; nonce: string } | InstallPage {
  const c = verifyConsent(s, installSecret(), now);
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

const PROVIDER = { github: 'GitHub', x: 'X' } as const;
/** The account as the page names it: @login on GitHub, @handle on X. Pure. */
const handle = (w: Who) => `@${w.by === 'github' ? w.user.login : w.user.handle}`;

/** The consent copy for this agent and account (plan 23.3). Pure. */
export function consentCopy(agent: string | null, host: string, who: Who) {
  return {
    title: `Connect ${agent ? `"${agent}"` : 'this agent'} to EarnKit?`,
    lines: [
      `You're signed in to ${PROVIDER[who.by]} as ${handle(who)}. ${agent ? `"${agent}"` : 'The agent'} at ${host} gets your EarnKit profile.`,
      // GitHub's line is E4's, word for word, so with x_signin off the page is unchanged.
      who.by === 'github'
        ? "EarnKit reads only your public GitHub profile. It can't see your private repos or post for you."
        : "EarnKit reads only your public X profile. It can't see your DMs or post for you.",
    ],
    yes: 'Connect',
    no: 'Not now',
  };
}

/** A small page with no script: the title as its one h1, then `body`. */
const shell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title.replace(/[?.]$/, ''))} · EarnKit</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111}button,a.b{font:inherit;padding:.5rem 1rem;margin-right:.5rem;display:inline-block;border:1px solid #111;color:#111;text-decoration:none;background:#fff}</style>
</head><body><main><h1>${escapeHtml(title)}</h1>
${body}
</main></body></html>`;
const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', ...headers },
  });

const page = (copy: ReturnType<typeof consentCopy>, s: string, csrf: string) =>
  shell(copy.title, `${copy.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
<form method="post" action="${CONSENT_PATH}">
<input type="hidden" name="s" value="${escapeHtml(s)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<button type="submit" name="answer" value="yes">${escapeHtml(copy.yes)}</button><button type="submit" name="answer" value="no">${escapeHtml(copy.no)}</button>
</form>`);

/** The chooser's copy (v3.8 E5, X on): one step, two ways to take it. Pure. */
export function chooserCopy(agent: string | null) {
  return {
    title: `Sign in to connect ${agent ? `"${agent}"` : 'your agent'} to EarnKit.`,
    line: "EarnKit reads only your public profile. It can't see your private repos or post for you.",
    github: 'Sign in with GitHub',
    x: 'Sign in with X',
  };
}

/**
 * What authorize answers when X sign-in is on too (v3.8 E5): GitHub or X, with the nonce cookie set here. GitHub's
 * link goes straight to GitHub; X's goes to /auth/x, which builds the PKCE request. Both carry the same install state.
 */
export function chooser(agent: string | null, githubUrl: string, installState: string, nonce: string): Response {
  const c = chooserCopy(agent);
  const body = `<p>${escapeHtml(c.line)}</p>
<p><a class="b" href="${escapeHtml(githubUrl)}">${escapeHtml(c.github)}</a><a class="b" href="/auth/x?s=${escapeHtml(encodeURIComponent(installState))}">${escapeHtml(c.x)}</a></p>`;
  return html(shell(c.title, body), { 'Set-Cookie': cookieOf(installCookie(), nonce, INSTALL_TTL_MS / 1000) });
}

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
  const copy = consentCopy(displayName(clientNameOf(client.cn)), new URL(ok.c.req.redirect_uri).host, ok.c.who);
  return html(page(copy, s, csrfOf(ok.nonce, installSecret())));
}

/**
 * POST /install/consent: our own page's form (same origin, the nonce cookie, its CSRF value, a live state). Not now
 * ends the sign-in. Connect makes or updates the builder (one GitHub or X account is one builder, so one person, however
 * many installs), marks the person verified by that provider at the callback's time, and sends the client its code.
 */
export async function consentPost(request: Request, deps: Deps = {}): Promise<Response> {
  if (!installSignInOn()) return installPage('failed');
  // Browsers send Origin on every form POST; none, or another site's, is refused.
  if (request.headers.get('origin') !== publicOrigin(request)) return installPage('failed');
  const form = await readParams(request, MAX_FORM);
  if (!form) return installPage('failed');
  const ok = checked(request, form.get('s') ?? '', deps.now ?? new Date());
  if (typeof ok === 'string') return installPage(ok);
  if (!same(form.get('csrf') ?? '', csrfOf(ok.nonce, installSecret()))) return installPage('failed');
  if (form.get('answer') !== 'yes') return installPage('cancelled');
  try {
    const at = new Date(ok.c.at);
    const who = ok.c.who;
    // X turned off since the page was shown (the rollback): the sign-in cannot finish.
    if (who.by === 'x' && !xSignInOn()) return installPage('failed');
    const builder = who.by === 'github' ? await upsertBuilder(who.user, at) : await upsertXBuilder(who.user, at);
    await markVerified({ builderId: builder.id, login: builder.login, xHandle: builder.x_handle, by: who.by, at, accountCreatedAt: who.user.created_at });
    const back = await issueCode(ok.c.req, { builderId: builder.id }, publicOrigin(request));
    return new Response(null, { status: 303, headers: { Location: back.toString(), 'Set-Cookie': cookieOf(installCookie(), '', 0), 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    return installPage('failed');
  }
}
