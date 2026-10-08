import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { siteUrl } from './entry-text';
import { RateLimitError, clientIp, enforce } from './rate-limit';

/**
 * v2.9 B9: Sign in with GitHub as ownership proof, so hosted agents (Grok Bot) that can't push to a
 * repo can still launch. A GitHub OAuth App with no scopes (public data only).
 *
 * - The link carries a one-time nonce (32 random bytes, base64url). Only its sha256 is stored, bound
 *   to the installation, the entry (project_id) and the repo, and the purpose (Ruling 5). It expires
 *   after 15 minutes and is consumed once, atomically, by the callback.
 * - The callback reads only `code` and `state` (the nonce). The repo comes from the nonce's row,
 *   never from the request. The scopeless GitHub token is used for at most three reads and is never
 *   stored or logged.
 * - Ownership passes when the login is the repo owner, or GitHub's repo read says the user can push
 *   (or admin) it. Without `permissions` (an org repo a scopeless token can't see), it fails, and the
 *   proof line stays the way (spec B9).
 * - Links and the redirect come from siteUrl() (EARNKIT_URL), never from the request Host (P47).
 * - Off, with the old behaviour everywhere, unless GITHUB_OAUTH_CLIENT_ID and
 *   GITHUB_OAUTH_CLIENT_SECRET are both set.
 */

export const VERIFY_TTL_MS = 15 * 60_000;

/** What the builder reads in the browser after the callback. */
export const VERIFY_PAGE = {
  done: 'Done. Go back to your agent and say go.',
  expired: 'This link has expired. Ask your agent for a new one.',
  notYours: "This GitHub account can't push to that repo. Sign in with the account that owns it.",
  failed: "Sign-in didn't finish. Ask your agent for a new link.",
  busy: 'Too many sign-ins from here. Try again in an hour.',
} as const;

export function githubVerifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID?.trim() && env.GITHUB_OAUTH_CLIENT_SECRET?.trim());
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type VerifyPurpose = 'entry' | 'pickup' | 'host';
export type NonceRow = { installation_id: number; project_id: number | null; repo_key: string; purpose: VerifyPurpose };

/** The callback URL GitHub sends the builder back to (P47: from siteUrl, never the request). */
export const callbackUrl = () => `${siteUrl()}/github/verify/callback`;

/**
 * A new one-time sign-in link for this repo (`owner/repo`, answer-bank.ts repoKey), bound to the
 * installation, the entry (null for pickup) and the purpose: `<site>/github/verify?n=<nonce>`.
 */
export async function createVerifyLink(
  a: { installationId: number; projectId: number | null; repoKey: string; purpose: VerifyPurpose },
  now = new Date(),
): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');
  await sql()`
    INSERT INTO github_verify_nonces (nonce_hash, installation_id, project_id, repo_key, purpose, created_at, expires_at)
    VALUES (${sha256(nonce)}, ${a.installationId}, ${a.projectId}, ${a.repoKey.toLowerCase()}, ${a.purpose}, ${now},
      ${new Date(now.getTime() + VERIFY_TTL_MS)})`;
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
    RETURNING installation_id, project_id, repo_key, purpose`;
  return row ?? null;
}

/** Whether an entry link was already shown for this entry (a later "go" is then the second). */
export async function entryLinkShown(projectId: number): Promise<boolean> {
  const [row] = await sql()<{ ok: number }[]>`
    SELECT 1 AS ok FROM github_verify_nonces WHERE project_id = ${projectId} AND purpose = 'entry' LIMIT 1`;
  return Boolean(row);
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
): Promise<{ ok: true; repoKey: string } | { ok: false; reason: string }> {
  const row = await takeNonce(nonce, now);
  if (!row) return { ok: false, reason: VERIFY_PAGE.expired };
  const [owner, repo] = row.repo_key.split('/');
  if (!owner || !repo || !code) return { ok: false, reason: VERIFY_PAGE.failed };
  try {
    const token = await deps.exchange(code);
    const user = await deps.user(token);
    // Only when the login isn't the owner: the repo read (with the user's scopeless token).
    const perms = user.login.toLowerCase() === owner.toLowerCase() ? null : await deps.repoPerms(token, owner, repo);
    if (!ownershipPasses(user.login, { owner, repo }, perms)) return { ok: false, reason: VERIFY_PAGE.notYours };
    await sql()`
      INSERT INTO github_verifications (repo_key, login, installation_id, project_id, account_created_at, public_repos, verified_at, purpose)
      VALUES (${row.repo_key}, ${user.login.toLowerCase()}, ${row.installation_id}, ${row.project_id},
        ${new Date(user.created_at)}, ${user.public_repos}, ${now}, ${row.purpose})`;
    return { ok: true, repoKey: row.repo_key };
  } catch (err) {
    console.error('[github-verify] callback', err instanceof Error ? err.name : 'error');
    return { ok: false, reason: VERIFY_PAGE.failed };
  }
}

export type Verification = { login: string; account_created_at: Date; public_repos: number };

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
}): Promise<Verification | null> {
  if (a.projectId === undefined && a.installationId === undefined) return null;
  const db = sql();
  const [row] = await db<Verification[]>`
    SELECT login, account_created_at, public_repos FROM github_verifications
    WHERE repo_key = ${a.repoKey.toLowerCase()} AND used_at IS NULL
      ${a.projectId !== undefined ? db`AND project_id = ${a.projectId}` : db``}
      ${a.installationId !== undefined ? db`AND installation_id = ${a.installationId}` : db``}
      ${a.since ? db`AND verified_at >= ${a.since}` : db``}
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
    RETURNING login, account_created_at, public_repos`;
  return row ?? null;
}

/**
 * Rulings G6, G7: on a shared (hosted) client, the GitHub login this call is from: a verification
 * on this installation from the last 15 minutes that matches what the call names (the GitHub user
 * it states, an entry it names, or a repo it names). Null when none match, or when they name more
 * than one login (never a guess). The caller decides it only runs on shared clients.
 */
export async function callerLogin(
  installationId: number,
  names: { github_user?: string | null; project_ids?: number[]; repo_keys?: string[] },
  now = new Date(),
): Promise<string | null> {
  const user = names.github_user?.trim().toLowerCase() || null;
  const ids = (names.project_ids ?? []).filter((n) => Number.isInteger(n));
  const repos = (names.repo_keys ?? []).map((k) => k.toLowerCase()).filter((k) => k.includes('/'));
  if (!user && ids.length === 0 && repos.length === 0) return null;
  const rows = await sql()<{ login: string }[]>`
    SELECT DISTINCT login FROM github_verifications
    WHERE installation_id = ${installationId} AND verified_at > ${new Date(now.getTime() - VERIFY_TTL_MS)}
      AND (login = ${user} OR project_id = ANY(${ids}::int[]) OR repo_key = ANY(${repos}::text[]))`;
  return rows.length === 1 ? rows[0].login : null;
}

/** Ruling G7: the entries of this installation a login verified (a shared client shows only these). */
export async function verifiedEntryIds(installationId: number, login: string): Promise<number[]> {
  const rows = await sql()<{ project_id: number }[]>`
    SELECT DISTINCT project_id FROM github_verifications
    WHERE installation_id = ${installationId} AND login = ${login.toLowerCase()} AND project_id IS NOT NULL`;
  return rows.map((r) => r.project_id);
}

// ---- The two routes

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The tiny page the builder sees. No cookie, no script, nothing cached. Pure. */
export function verifyPage(line: string, status = 200): Response {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>EarnKit</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
    `<p>${escapeHtml(line)}</p></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

async function limited(request: Request): Promise<Response | null> {
  try {
    await enforce('githubVerify', clientIp(request.headers), VERIFY_PAGE.busy);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return verifyPage(VERIFY_PAGE.busy, 429);
    throw err;
  }
}

/** GET /github/verify?n=: checks the nonce (without using it) and sends the builder to GitHub. */
export async function verifyStart(request: Request): Promise<Response> {
  if (!githubVerifyEnabled()) return new Response('Not found', { status: 404 });
  const busy = await limited(request);
  if (busy) return busy;
  const nonce = new URL(request.url).searchParams.get('n') ?? '';
  if (!(await peekNonce(nonce))) return verifyPage(VERIFY_PAGE.expired, 410);
  const to = new URL('https://github.com/login/oauth/authorize');
  to.searchParams.set('client_id', process.env.GITHUB_OAUTH_CLIENT_ID!.trim());
  to.searchParams.set('redirect_uri', callbackUrl());
  to.searchParams.set('state', nonce);
  to.searchParams.set('allow_signup', 'false');
  return new Response(null, {
    status: 302,
    headers: { Location: to.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

/**
 * GET /github/verify/callback?code&state: only these two parameters are read (the repo is the
 * nonce's). Renders the VERIFY_PAGE line.
 */
export async function verifyCallback(
  request: Request,
  complete: (code: string, nonce: string) => ReturnType<typeof completeVerify> = (c, n) => completeVerify(c, n),
): Promise<Response> {
  if (!githubVerifyEnabled()) return new Response('Not found', { status: 404 });
  const busy = await limited(request);
  if (busy) return busy;
  const q = new URL(request.url).searchParams;
  const out = await complete(q.get('code') ?? '', q.get('state') ?? '');
  if (out.ok) return verifyPage(VERIFY_PAGE.done);
  return verifyPage(out.reason, out.reason === VERIFY_PAGE.expired ? 410 : 403);
}
