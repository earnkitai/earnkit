import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { githubRepo } from './campaigns';
import { sql } from './db';
import { sharedGroup } from './installations';
import { siteUrl } from './entry-text';
import { RateLimitError, clientIp, enforce } from './rate-limit';

/**
 * v2.9 B9: Sign in with GitHub as ownership proof, so hosted agents (Grok Bot) that can't push to a
 * repo can still launch. A GitHub OAuth App with no scopes (public data only).
 *
 * - The link carries a one-time nonce (32 random bytes, base64url). Only its sha256 is stored, bound
 *   to the installation, the entry (project_id) and the repo, and the purpose (Ruling 5). It expires
 *   after 15 minutes and is consumed once, atomically, by the callback.
 * - Ruling G8: the link never goes straight to GitHub. It shows a confirm page naming the repo, the
 *   token and the fee wallet, with a warning, and sets a per-link `__Host-` cookie (HttpOnly, Secure,
 *   SameSite=Lax, 15 minutes); its button POSTs, and GitHub gets state = `<nonce>.<csrf>`. The
 *   callback refuses a missing or mismatched cookie before it uses the nonce or exchanges the code,
 *   so the sign-in finishes only in the browser that confirmed it.
 * - The callback reads only `code` and `state` (and the cookie). The repo comes from the nonce's
 *   row, never from the request. The scopeless GitHub token is used for at most three reads and is never
 *   stored or logged.
 * - Ownership passes when the login is the repo owner, or GitHub's repo read says the user can push
 *   (or admin) it. Without `permissions` (an org repo a scopeless token can't see), it fails, and the
 *   proof line stays the way (spec B9).
 * - Links and the redirect come from siteUrl() (EARNKIT_URL), never from the request Host (P47).
 * - Off, with the old behaviour everywhere, unless GITHUB_OAUTH_CLIENT_ID and
 *   GITHUB_OAUTH_CLIENT_SECRET are both set.
 */

export const VERIFY_TTL_MS = 15 * 60_000;
/** Ruling G9: how long the sign-in code a shared client's builder pastes stays valid. */
export const CODE_TTL_MS = 24 * 60 * 60_000;

/** What the builder reads in the browser after the callback. */
export const VERIFY_PAGE = {
  done: 'Done. Go back to your agent and say go.',
  expired: 'This link has expired. Ask your agent for a new one.',
  notYours: "This GitHub account can't push to that repo. Sign in with the account that owns it.",
  failed: "Sign-in didn't finish. Ask your agent for a new link.",
  busy: 'Too many sign-ins from here. Try again in an hour.',
  /** Spec B9: GitHub shows no permissions (an org repo a scopeless sign-in can't see): the proof line is the way. */
  orgRepo: "GitHub doesn't show whether this account can push to that repo. Ask your agent to prove it with a short line in the repo instead.",
} as const;

export function githubVerifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID?.trim() && env.GITHUB_OAUTH_CLIENT_SECRET?.trim());
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Ruling G9: 10 random base32 characters (32 divides 256, so unbiased). */
const newCode = () => [...randomBytes(10)].map((b) => BASE32[b % 32]).join('');
/** "ABCDEFGHJK" as the builder reads it: "ABCD-EFGH-JK". Pure. */
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
/** A pasted code, any case, dashes or spaces; null unless it is 10 base32 characters. Pure. */
export function normalizeCode(input: string | null | undefined): string | null {
  const c = (input ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  return c.length === 10 ? c : null;
}
/** Ruling G9: the success page on a shared client. Pure. */
export const codeLine = (code: string) => `Done. Paste this code to your agent: ${formatCode(code)}`;

export type VerifyPurpose = 'entry' | 'pickup' | 'host';
export type NonceRow = {
  installation_id: number;
  project_id: number | null;
  repo_key: string;
  purpose: VerifyPurpose;
  /** Ruling G11: the fee wallet and ticker the link was made for (entry links). */
  wallet: string | null;
  symbol: string | null;
};

/** The callback URL GitHub sends the builder back to (P47: from siteUrl, never the request). */
export const callbackUrl = () => `${siteUrl()}/github/verify/callback`;

/**
 * A new one-time sign-in link for this repo (`owner/repo`, answer-bank.ts repoKey), bound to the
 * installation, the entry (null for pickup) and the purpose: `<site>/github/verify?n=<nonce>`.
 */
export async function createVerifyLink(
  a: {
    installationId: number;
    projectId: number | null;
    repoKey: string;
    purpose: VerifyPurpose;
    /** Ruling G11: an `entry` link needs the fee wallet the launch will use (shown, then bound). */
    wallet?: string | null;
    symbol?: string | null;
  },
  now = new Date(),
): Promise<string> {
  if (a.purpose === 'entry' && !a.wallet) throw new Error('An entry sign-in link needs the fee wallet first.');
  const nonce = randomBytes(32).toString('base64url');
  await sql()`
    INSERT INTO github_verify_nonces (nonce_hash, installation_id, project_id, repo_key, purpose, created_at, expires_at, wallet, symbol)
    VALUES (${sha256(nonce)}, ${a.installationId}, ${a.projectId}, ${a.repoKey.toLowerCase()}, ${a.purpose}, ${now},
      ${new Date(now.getTime() + VERIFY_TTL_MS)}, ${a.wallet?.toLowerCase() ?? null}, ${a.symbol?.toUpperCase() ?? null})`;
  return `${siteUrl()}/github/verify?n=${nonce}`;
}

/** Whether the nonce is still usable (unused, unexpired); nothing changes. */
export async function peekNonce(nonce: string, now = new Date()): Promise<boolean> {
  if (!nonce) return false;
  const [row] = await sql()<{ ok: number }[]>`
    SELECT 1 AS ok FROM github_verify_nonces
    WHERE nonce_hash = ${sha256(nonce)} AND used_at IS NULL AND expires_at > ${now}`;
  return Boolean(row);
}

/** Consumes the nonce: its row once, then null (also when expired or unknown). One atomic update. */
export async function takeNonce(nonce: string, now = new Date()): Promise<NonceRow | null> {
  if (!nonce) return null;
  const [row] = await sql()<NonceRow[]>`
    UPDATE github_verify_nonces SET used_at = ${now}
    WHERE nonce_hash = ${sha256(nonce)} AND used_at IS NULL AND expires_at > ${now}
    RETURNING installation_id, project_id, repo_key, purpose, wallet, symbol`;
  return row ?? null;
}

/**
 * launch_token: a sign-in link for this installation's entry, bound to it, its GitHub repo, its fee
 * wallet and ticker (Ruling G11), and the entry's name; null when the entry has no GitHub repo or
 * no wallet yet (the wallet is asked first), or isn't this installation's.
 */
export async function entryVerifyLink(installationId: number, projectId: number): Promise<{ link: string; name: string } | null> {
  const [p] = await sql()<{ name: string; repo_url: string | null; wallet: string | null; symbol: string | null }[]>`
    SELECT name, repo_url, COALESCE(creator_wallet, payout_wallet) AS wallet, token_symbol AS symbol
    FROM projects WHERE id = ${projectId} AND installation_id = ${installationId}`;
  const gh = p?.repo_url ? githubRepo(p.repo_url) : null;
  if (!p || !gh || !p.wallet) return null;
  const link = await createVerifyLink({
    installationId, projectId, repoKey: `${gh.owner}/${gh.repo}`, purpose: 'entry', wallet: p.wallet, symbol: p.symbol,
  });
  return { link, name: p.name };
}

/** v2.9 B9: the signed-in login owns the repo, or GitHub says it can push to it. Pure. */
export function ownershipPasses(
  login: string,
  repo: { owner: string; repo: string },
  perms: { push?: boolean; admin?: boolean } | null,
): boolean {
  if (login.toLowerCase() === repo.owner.toLowerCase()) return true;
  return Boolean(perms?.push || perms?.admin);
}

export type GitHubOAuthDeps = {
  exchange: (code: string) => Promise<string>;
  user: (token: string) => Promise<{ login: string; created_at: string; public_repos: number }>;
  repoPerms: (token: string, owner: string, repo: string) => Promise<{ push?: boolean; admin?: boolean } | null>;
};

const TIMEOUT_MS = 10_000;
const api = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'User-Agent': 'EarnKit',
  'X-GitHub-Api-Version': '2022-11-28',
});

/** GitHub's three calls. Errors carry no code, token or secret (only a fixed message). */
export const githubOAuth: GitHubOAuthDeps = {
  exchange: async (code) => {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'EarnKit' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!res.ok || typeof body?.access_token !== 'string') throw new Error(`GitHub code exchange failed (${res.status})`);
    return body.access_token;
  },
  user: async (token) => {
    const res = await fetch('https://api.github.com/user', { headers: api(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const u = (await res.json().catch(() => null)) as { login?: unknown; created_at?: unknown; public_repos?: unknown } | null;
    if (!res.ok || typeof u?.login !== 'string' || typeof u.created_at !== 'string')
      throw new Error(`GitHub user read failed (${res.status})`);
    return { login: u.login, created_at: u.created_at, public_repos: Number(u.public_repos) || 0 };
  },
  repoPerms: async (token, owner, repo) => {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: api(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    const r = (await res.json().catch(() => null)) as { permissions?: { push?: unknown; admin?: unknown } } | null;
    if (!res.ok) throw new Error(`GitHub repo read failed (${res.status})`);
    return r?.permissions ? { push: r.permissions.push === true, admin: r.permissions.admin === true } : null;
  },
};

/**
 * The callback's work: the nonce first (consumed whatever happens next), then GitHub. Writes a
 * verification for the nonce's own repo and entry only when ownership passes. Never logs the
 * code, the token, the nonce or the secret.
 */
export async function completeVerify(
  code: string,
  nonce: string,
  deps: GitHubOAuthDeps = githubOAuth,
  now = new Date(),
): Promise<{ ok: true; repoKey: string; code?: string } | { ok: false; reason: string }> {
  const row = await takeNonce(nonce, now);
  if (!row) return { ok: false, reason: VERIFY_PAGE.expired };
  const [owner, repo] = row.repo_key.split('/');
  if (!owner || !repo || !code) return { ok: false, reason: VERIFY_PAGE.failed };
  try {
    const token = await deps.exchange(code);
    const user = await deps.user(token);
    // Only when the login isn't the owner: the repo read (with the user's scopeless token).
    const perms = user.login.toLowerCase() === owner.toLowerCase() ? null : await deps.repoPerms(token, owner, repo);
    if (!ownershipPasses(user.login, { owner, repo }, perms))
      return { ok: false, reason: perms === null ? VERIFY_PAGE.orgRepo : VERIFY_PAGE.notYours };
    // Ruling G9: on a shared (hosted) client the builder gets a one-time code to paste to the agent;
    // only its sha256 is kept. It is how later calls there know who they are from.
    const paste = (await sharedGroup(row.installation_id)) ? newCode() : null;
    await sql()`
      INSERT INTO github_verifications (repo_key, login, installation_id, project_id, account_created_at, public_repos, verified_at, purpose,
        code_hash, code_expires_at, wallet, symbol)
      VALUES (${row.repo_key}, ${user.login.toLowerCase()}, ${row.installation_id}, ${row.project_id},
        ${new Date(user.created_at)}, ${user.public_repos}, ${now}, ${row.purpose},
        ${paste && sha256(paste)}, ${paste && new Date(now.getTime() + CODE_TTL_MS)}, ${row.wallet}, ${row.symbol})`;
    return { ok: true, repoKey: row.repo_key, ...(paste && { code: paste }) };
  } catch (err) {
    console.error('[github-verify] callback', err instanceof Error ? err.name : 'error');
    return { ok: false, reason: VERIFY_PAGE.failed };
  }
}

export type Verification = {
  login: string;
  account_created_at: Date;
  public_repos: number;
  /** Ruling G11: the fee wallet the owner saw on the confirm page (lowercase; null on non-entry sign-ins). */
  wallet: string | null;
};

/**
 * The newest passing verification of `repoKey` for this entry (`projectId`) or this installation,
 * made at or after `since`, or null. Never unscoped: with neither id it is null. A single-use one
 * already used (P11) never counts.
 */
export async function verifiedFor(a: {
  projectId?: number;
  installationId?: number;
  repoKey: string;
  since?: Date;
  /** Only this purpose's verifications (identity linking reads `pickup`, Pre-flight P8). */
  purpose?: VerifyPurpose;
  /** Rulings G8, G9: only this login's (a shared client's caller, from its code). */
  login?: string;
}): Promise<Verification | null> {
  if (a.projectId === undefined && a.installationId === undefined) return null;
  const db = sql();
  const [row] = await db<Verification[]>`
    SELECT login, account_created_at, public_repos, wallet FROM github_verifications
    WHERE repo_key = ${a.repoKey.toLowerCase()} AND used_at IS NULL
      ${a.projectId !== undefined ? db`AND project_id = ${a.projectId}` : db``}
      ${a.installationId !== undefined ? db`AND installation_id = ${a.installationId}` : db``}
      ${a.since ? db`AND verified_at >= ${a.since}` : db``}
      ${a.purpose ? db`AND purpose = ${a.purpose}` : db``}
      ${a.login !== undefined ? db`AND login = ${a.login.toLowerCase()}` : db``}
    ORDER BY verified_at DESC, id DESC LIMIT 1`;
  return row ?? null;
}

/**
 * Pre-flight P11: a host verification of this installation and repo. On a shared (hosted) client it
 * is single-use and valid for 15 minutes: this consumes it (one atomic update), so another user of
 * the same installation can't reuse it. Elsewhere the installation-plus-repo binding holds.
 */
export async function takeHostVerification(
  a: { installationId: number; repoKey: string; shared: boolean },
  now = new Date(),
): Promise<Verification | null> {
  if (!a.shared) return verifiedFor({ installationId: a.installationId, repoKey: a.repoKey });
  const [row] = await sql()<Verification[]>`
    UPDATE github_verifications SET used_at = ${now}
    WHERE id = (
      SELECT id FROM github_verifications
      WHERE installation_id = ${a.installationId} AND repo_key = ${a.repoKey.toLowerCase()} AND purpose = 'host'
        AND used_at IS NULL AND verified_at > ${new Date(now.getTime() - VERIFY_TTL_MS)}
      ORDER BY verified_at DESC, id DESC LIMIT 1
      FOR UPDATE SKIP LOCKED)
    RETURNING login, account_created_at, public_repos, wallet`;
  return row ?? null;
}

/**
 * Rulings G6, G7, G9: on a shared (hosted) client, the GitHub login this call is from: the login of
 * the sign-in whose one-time code the builder pasted (`signed_in`), on this installation, within 24
 * hours. Nothing anyone can claim (a GitHub user, an entry, a repo) names it. Null without a valid
 * code. The caller decides it only runs on shared clients.
 */
export async function callerLogin(installationId: number, signedIn: string | null | undefined, now = new Date()): Promise<string | null> {
  const code = normalizeCode(signedIn);
  if (!code) return null;
  const [row] = await sql()<{ login: string }[]>`
    SELECT login FROM github_verifications
    WHERE installation_id = ${installationId} AND code_hash = ${sha256(code)} AND code_expires_at > ${now}
    ORDER BY verified_at DESC LIMIT 1`;
  return row?.login ?? null;
}

/** Ruling G7: the entries of this installation a login verified (a shared client shows only these). */
export async function verifiedEntryIds(installationId: number, login: string): Promise<number[]> {
  const rows = await sql()<{ project_id: number }[]>`
    SELECT DISTINCT project_id FROM github_verifications
    WHERE installation_id = ${installationId} AND login = ${login.toLowerCase()} AND project_id IS NOT NULL`;
  return rows.map((r) => r.project_id);
}

// ---- The two routes

/**
 * Ruling G8: what the confirm page names before anyone signs in: the repo, and for an entry its
 * token and the wallet its fees go to. Null when the nonce is unusable (used, expired, unknown).
 */
export async function nonceDetails(
  nonce: string,
  now = new Date(),
): Promise<{ repo_key: string; purpose: VerifyPurpose; name: string | null; symbol: string | null; wallet: string | null } | null> {
  if (!nonce) return null;
  const [row] = await sql()<{ repo_key: string; purpose: VerifyPurpose; name: string | null; symbol: string | null; wallet: string | null }[]>`
    SELECT n.repo_key, n.purpose, p.name, n.symbol, n.wallet
    FROM github_verify_nonces n LEFT JOIN projects p ON p.id = n.project_id
    WHERE n.nonce_hash = ${sha256(nonce)} AND n.used_at IS NULL AND n.expires_at > ${now}`;
  return row ?? null;
}

/** Ruling G8: the confirm page's warning, above the button. */
export const CONFIRM_WARNING = 'This links your GitHub to this EarnKit entry. Only continue if you started this from your own agent.';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const html = (body: string) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>EarnKit</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
  `${body}</body></html>`;

/** The tiny page the builder sees. No script, nothing cached. Pure. */
export function verifyPage(line: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(html(`<p>${escapeHtml(line)}</p>`), { status, headers: { ...PAGE_HEADERS, ...headers } });
}

/**
 * Ruling G8 (Ruling 7's prefix): the browser binding. One cookie per link (named from the nonce's
 * hash, so two open links don't clash), HttpOnly, Secure, SameSite=Lax, 15 minutes. `__Host-`
 * requires Path=/, so it can't be scoped to the verify path. Pure.
 */
export const csrfCookieName = (nonce: string) => `__Host-ekv-${sha256(nonce).slice(0, 16)}`;
const setCsrf = (nonce: string, csrf: string) =>
  `${csrfCookieName(nonce)}=${csrf}; Path=/; Max-Age=${VERIFY_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
const clearCsrf = (nonce: string) => `${csrfCookieName(nonce)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** The confirm page (Ruling G8): what is being linked, the warning, and one POST button. Pure. */
export function confirmPage(
  d: { repo_key: string; purpose: VerifyPurpose; symbol: string | null; wallet: string | null },
  nonce: string,
  csrf: string,
): string {
  const rows = [
    `<li>Repo: github.com/${escapeHtml(d.repo_key)}</li>`,
    d.purpose === 'entry' && d.symbol ? `<li>Token: $${escapeHtml(d.symbol)}</li>` : '',
    // Ruling G11: an entry link always has its wallet (createVerifyLink refuses one without).
    d.purpose === 'entry' && d.wallet ? `<li>Wallet for fees: ${escapeHtml(d.wallet)}</li>` : '',
  ].join('');
  return html(
    `<p>Sign in with GitHub to prove this repo is yours.</p><ul>${rows}</ul><p>${escapeHtml(CONFIRM_WARNING)}</p>` +
      `<form method="post" action="${escapeHtml(siteUrl())}/github/verify">` +
      `<input type="hidden" name="n" value="${escapeHtml(nonce)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">` +
      '<button type="submit">Continue with GitHub</button></form>',
  );
}

/** The routes' per-IP limit (tests inject `limit`). */
export type RouteDeps = { limit?: (request: Request) => Promise<unknown> };
const ipLimit = (request: Request) => enforce('githubVerify', clientIp(request.headers), VERIFY_PAGE.busy);

async function limited(request: Request, deps: RouteDeps): Promise<Response | null> {
  try {
    await (deps.limit ?? ipLimit)(request);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return verifyPage(VERIFY_PAGE.busy, 429);
    throw err;
  }
}

const notFound = () => new Response('Not found', { status: 404 });

/**
 * GET /github/verify?n=: never straight to GitHub (Ruling G8). Checks the nonce (without using it)
 * and shows the confirm page, setting this link's browser cookie.
 */
export async function verifyStart(request: Request, deps: RouteDeps = {}): Promise<Response> {
  if (!githubVerifyEnabled()) return notFound();
  const busy = await limited(request, deps);
  if (busy) return busy;
  const nonce = new URL(request.url).searchParams.get('n') ?? '';
  const d = await nonceDetails(nonce);
  if (!d) return verifyPage(VERIFY_PAGE.expired, 410);
  const csrf = randomBytes(32).toString('base64url');
  // Review Minor 1: same-origin, never no-referrer, so the button's POST carries a real Origin
  // (under no-referrer a browser sends `Origin: null`, which verifyConfirm refuses).
  return new Response(confirmPage(d, nonce, csrf), {
    status: 200,
    headers: { ...PAGE_HEADERS, 'Referrer-Policy': 'same-origin', 'Set-Cookie': setCsrf(nonce, csrf) },
  });
}

/**
 * POST /github/verify (the confirm page's button): the form's csrf must match this browser's
 * cookie, then 302 to GitHub with state = `<nonce>.<csrf>`. The redirect comes from siteUrl().
 */
export async function verifyConfirm(request: Request, deps: RouteDeps = {}): Promise<Response> {
  if (!githubVerifyEnabled()) return notFound();
  const busy = await limited(request, deps);
  if (busy) return busy;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(siteUrl()).origin) return verifyPage(VERIFY_PAGE.failed, 403);
  const form = await request.formData().catch(() => null);
  const nonce = String(form?.get('n') ?? '');
  const csrf = String(form?.get('csrf') ?? '');
  const cookie = nonce ? cookieValue(request, csrfCookieName(nonce)) : null;
  if (!cookie || !sameSecret(cookie, csrf)) return verifyPage(VERIFY_PAGE.failed, 403);
  if (!(await peekNonce(nonce))) return verifyPage(VERIFY_PAGE.expired, 410, { 'Set-Cookie': clearCsrf(nonce) });
  const to = new URL('https://github.com/login/oauth/authorize');
  to.searchParams.set('client_id', process.env.GITHUB_OAUTH_CLIENT_ID!.trim());
  to.searchParams.set('redirect_uri', callbackUrl());
  to.searchParams.set('state', `${nonce}.${csrf}`);
  to.searchParams.set('allow_signup', 'false');
  return new Response(null, {
    status: 303,
    headers: { Location: to.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

/**
 * GET /github/verify/callback?code&state: reads only these two parameters (the repo is the
 * nonce's) and this link's cookie. A missing or mismatched cookie is refused before the nonce is
 * used or the code exchanged (Ruling G8). Renders the VERIFY_PAGE line and clears the cookie.
 */
export async function verifyCallback(
  request: Request,
  complete: (code: string, nonce: string) => ReturnType<typeof completeVerify> = (c, n) => completeVerify(c, n),
  deps: RouteDeps = {},
): Promise<Response> {
  if (!githubVerifyEnabled()) return notFound();
  const busy = await limited(request, deps);
  if (busy) return busy;
  const q = new URL(request.url).searchParams;
  const code = q.get('code') ?? '';
  const state = q.get('state') ?? '';
  const dot = state.lastIndexOf('.');
  const nonce = dot > 0 ? state.slice(0, dot) : '';
  const csrf = dot > 0 ? state.slice(dot + 1) : '';
  const cookie = nonce ? cookieValue(request, csrfCookieName(nonce)) : null;
  if (!cookie || !sameSecret(cookie, csrf)) return verifyPage(VERIFY_PAGE.failed, 403);
  const clear = { 'Set-Cookie': clearCsrf(nonce) };
  const out = await complete(code, nonce);
  if (out.ok) return verifyPage(out.code ? codeLine(out.code) : VERIFY_PAGE.done, 200, clear);
  return verifyPage(out.reason, out.reason === VERIFY_PAGE.expired ? 410 : 403, clear);
}
