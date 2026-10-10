import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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

/** v2.10 item 7b (R8): `app` is the read-only GitHub App's link (github-app.ts): no launch rides on it (R9). */
export type VerifyPurpose = 'entry' | 'pickup' | 'host' | 'app';
export type NonceRow = {
  installation_id: number;
  project_id: number | null;
  repo_key: string;
  purpose: VerifyPurpose;
  /** Ruling G11: the fee wallet and ticker the link was made for (entry links). */
  wallet: string | null;
  symbol: string | null;
  /**
   * v2.10 Pre-flight P3: on an `app` nonce, the login its OAuth hop proved and that account's facts,
   * for the setup URL's verification row; null on every other nonce.
   */
  login: string | null;
  account_created_at: Date | null;
  public_repos: number | null;
};

/**
 * v2.10 fix round 1 (concern 4): a link's nonce from its stored random seed: HMAC-SHA256 under
 * EARNKIT_AUTH_SECRET, base64url (43 characters). The database alone never gives a nonce back; with
 * the secret, an open link can be shown again instead of minting a new one. Pure.
 */
const nonceOfSeed = (seed: string, secret: string) => createHmac('sha256', secret).update(`verify-nonce:v1:${seed}`).digest('base64url');
/** v2.10 fix round 1: an open link is shown again only with at least this long left. */
export const REUSE_MIN_LEFT_MS = 5 * 60_000;

/** The callback URL GitHub sends the builder back to (P47: from siteUrl, never the request). */
export const callbackUrl = () => `${siteUrl()}/github/verify/callback`;

/**
 * A one-time sign-in link for this repo (`owner/repo`, answer-bank.ts repoKey), bound to the
 * installation, the entry (null for pickup) and the purpose: `<site>/github/verify?n=<nonce>`.
 * v2.10 fix round 1 (concern 4): an open link (unused, at least REUSE_MIN_LEFT_MS left, no sign-in
 * started on it) for the same installation, purpose, repo, entry, wallet and ticker is shown again
 * instead of minting a new one. Never on a shared client (each builder there gets their own link).
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
  // v2.10 item 7b: no App link while the App is off (github-app.ts; imported here to keep the modules acyclic).
  if (a.purpose === 'app' && !(await import('./github-app')).githubAppEnabled())
    throw new Error('The read-only GitHub App is off.');
  const secret = process.env.EARNKIT_AUTH_SECRET;
  const repoKey = a.repoKey.toLowerCase();
  const wallet = a.wallet?.toLowerCase() ?? null;
  const symbol = a.symbol?.toUpperCase() ?? null;
  if (secret && !(await sharedGroup(a.installationId).catch(() => true))) {
    const [open] = await sql()<{ seed: string }[]>`
      SELECT seed FROM github_verify_nonces
      WHERE installation_id = ${a.installationId} AND repo_key = ${repoKey} AND purpose = ${a.purpose}
        AND project_id IS NOT DISTINCT FROM ${a.projectId} AND wallet IS NOT DISTINCT FROM ${wallet}::text
        AND symbol IS NOT DISTINCT FROM ${symbol}::text AND used_at IS NULL AND login IS NULL AND seed IS NOT NULL
        AND expires_at > ${new Date(now.getTime() + REUSE_MIN_LEFT_MS)}
      ORDER BY expires_at DESC LIMIT 1`;
    if (open) return `${siteUrl()}/github/verify?n=${nonceOfSeed(open.seed, secret)}`;
  }
  const seed = secret ? randomBytes(16).toString('base64url') : null;
  const nonce = seed ? nonceOfSeed(seed, secret!) : randomBytes(32).toString('base64url');
  await sql()`
    INSERT INTO github_verify_nonces (nonce_hash, installation_id, project_id, repo_key, purpose, created_at, expires_at, wallet, symbol, seed)
    VALUES (${sha256(nonce)}, ${a.installationId}, ${a.projectId}, ${repoKey}, ${a.purpose}, ${now},
      ${new Date(now.getTime() + VERIFY_TTL_MS)}, ${wallet}, ${symbol}, ${seed})`;
  return `${siteUrl()}/github/verify?n=${nonce}`;
}

/**
 * v2.10 fix round 1 (concern 4): the hourly cron deletes links expired over a day ago, at most
 * `limit` a run (the oldest first). Returns how many went.
 */
export async function sweepVerifyNonces(now = new Date(), limit = 1000): Promise<number> {
  const rows = await sql()`
    DELETE FROM github_verify_nonces WHERE nonce_hash IN (
      SELECT nonce_hash FROM github_verify_nonces WHERE expires_at < ${new Date(now.getTime() - 86_400_000)}
      ORDER BY expires_at LIMIT ${limit})`;
  return rows.count;
}

/** Whether the nonce is still usable (unused, unexpired); nothing changes. */
export async function peekNonce(nonce: string, now = new Date()): Promise<boolean> {
  if (!nonce) return false;
  const [row] = await sql()<{ ok: number }[]>`
    SELECT 1 AS ok FROM github_verify_nonces
    WHERE nonce_hash = ${sha256(nonce)} AND used_at IS NULL AND expires_at > ${now}`;
  return Boolean(row);
}

/**
 * Consumes the nonce: its row once, then null (also when expired or unknown). One atomic update.
 * v2.10 Pre-flight P3: `purpose: 'app'` (the App's setup URL) takes only an `app` nonce whose OAuth
 * hop stored a login; any other nonce is left unused.
 */
export async function takeNonce(nonce: string, now = new Date(), o: { purpose?: 'app' } = {}): Promise<NonceRow | null> {
  if (!nonce) return null;
  const db = sql();
  const [row] = await db<NonceRow[]>`
    UPDATE github_verify_nonces SET used_at = ${now}
    WHERE nonce_hash = ${sha256(nonce)} AND used_at IS NULL AND expires_at > ${now}
      ${o.purpose === 'app' ? db`AND purpose = 'app' AND login IS NOT NULL` : db``}
    RETURNING installation_id, project_id, repo_key, purpose, wallet, symbol, login, account_created_at, public_repos`;
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
 * A passed check's github_verifications row, for the nonce's own repo and entry. Ruling G9: on a
 * shared (hosted) client the builder gets a one-time code to paste to the agent (returned; only its
 * sha256 is kept), which is how later calls there know who they are from. v2.10 item 7b: `app` is a
 * read-only GitHub App proof (`via = 'app'`, its installation id); it never carries a wallet (R9).
 */
export async function saveVerification(
  row: Pick<NonceRow, 'installation_id' | 'project_id' | 'repo_key' | 'purpose' | 'wallet' | 'symbol'>,
  user: { login: string; created_at: Date; public_repos: number },
  now: Date,
  app?: { githubInstallationId: number },
): Promise<string | null> {
  const paste = (await sharedGroup(row.installation_id)) ? newCode() : null;
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, project_id, account_created_at, public_repos, verified_at, purpose,
      code_hash, code_expires_at, wallet, symbol, via, github_installation_id)
    VALUES (${row.repo_key}, ${user.login.toLowerCase()}, ${row.installation_id}, ${row.project_id},
      ${user.created_at}, ${user.public_repos}, ${now}, ${row.purpose},
      ${paste && sha256(paste)}, ${paste && new Date(now.getTime() + CODE_TTL_MS)},
      ${app ? null : row.wallet}, ${app ? null : row.symbol}, ${app ? 'app' : 'oauth'}, ${app?.githubInstallationId ?? null})`;
  return paste;
}

/**
 * v2.10 item 7b (Pre-flight P3): an `app` nonce's OAuth hop. The nonce is not consumed: the code is
 * exchanged, the login and its account facts are stored on it once (an unused, unexpired `app`
 * nonce with no login yet), and the builder goes on to install the App (`install`), keeping this
 * link's cookie for the setup URL. No verification is written here; the setup URL proves the repo.
 */
async function appSignIn(
  code: string,
  nonce: string,
  deps: GitHubOAuthDeps,
  now: Date,
): Promise<{ ok: true; repoKey: string; install: string } | { ok: false; reason: string }> {
  const app = await import('./github-app');
  if (!app.githubAppEnabled() || !code) return { ok: false, reason: VERIFY_PAGE.failed };
  try {
    const user = await deps.user(await deps.exchange(code));
    const [row] = await sql()<{ repo_key: string }[]>`
      UPDATE github_verify_nonces SET login = ${user.login.toLowerCase()}, account_created_at = ${new Date(user.created_at)},
        public_repos = ${user.public_repos}
      WHERE nonce_hash = ${sha256(nonce)} AND purpose = 'app' AND used_at IS NULL AND login IS NULL AND expires_at > ${now}
      RETURNING repo_key`;
    if (!row) return { ok: false, reason: VERIFY_PAGE.expired };
    return { ok: true, repoKey: row.repo_key, install: app.installUrl(process.env.GITHUB_APP_SLUG!.trim(), nonce) };
  } catch (err) {
    console.error('[github-verify] app sign-in', err instanceof Error ? err.name : 'error');
    return { ok: false, reason: VERIFY_PAGE.failed };
  }
}

/** The purpose of a usable (unused, unexpired) nonce, or null; nothing changes. */
async function noncePurpose(nonce: string, now: Date): Promise<VerifyPurpose | null> {
  if (!nonce) return null;
  const [row] = await sql()<{ purpose: VerifyPurpose }[]>`
    SELECT purpose FROM github_verify_nonces WHERE nonce_hash = ${sha256(nonce)} AND used_at IS NULL AND expires_at > ${now}`;
  return row?.purpose ?? null;
}

/**
 * The callback's work: the nonce first (consumed whatever happens next), then GitHub. Writes a
 * verification for the nonce's own repo and entry only when ownership passes. Never logs the
 * code, the token, the nonce or the secret. v2.10 Pre-flight P3: an `app` nonce branches before
 * the nonce is consumed (appSignIn), and answers with the App's install link.
 */
export async function completeVerify(
  code: string,
  nonce: string,
  deps: GitHubOAuthDeps = githubOAuth,
  now = new Date(),
): Promise<{ ok: true; repoKey: string; code?: string; install?: string } | { ok: false; reason: string }> {
  if ((await noncePurpose(nonce, now)) === 'app') return appSignIn(code, nonce, deps, now);
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
    const paste = await saveVerification(row, { ...user, created_at: new Date(user.created_at) }, now);
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
 * already used (P11) never counts. v2.10 Pre-flight P11: a read-only App proof (`purpose = 'app'`)
 * counts only when `purpose: 'app'` is asked for, so it never stands in for a sign-in (R9).
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
      ${a.purpose ? db`AND purpose = ${a.purpose}` : db`AND purpose <> 'app'`}
      ${a.login !== undefined ? db`AND login = ${a.login.toLowerCase()}` : db``}
    ORDER BY verified_at DESC, id DESC LIMIT 1`;
  return row ?? null;
}

/**
 * Ruling G13 (I2): a sign-in made from the first reply's token offer, before any entry exists (an
 * `entry` link with no project): this installation and repo, for exactly this fee wallet (G11), and on
 * a shared client only the caller's login (G10; null: none). Its id, or null.
 */
export async function offerVerification(a: { installationId: number; repoKey: string; wallet: string; login?: string | null }): Promise<number | null> {
  if (a.login === null) return null;
  const db = sql();
  const [row] = await db<{ id: number }[]>`
    SELECT id FROM github_verifications
    WHERE installation_id = ${a.installationId} AND repo_key = ${a.repoKey.toLowerCase()} AND purpose = 'entry'
      AND project_id IS NULL AND used_at IS NULL AND wallet = ${a.wallet.toLowerCase()}
      ${a.login !== undefined ? db`AND login = ${a.login.toLowerCase()}` : db``}
    ORDER BY verified_at DESC, id DESC LIMIT 1`;
  return row?.id ?? null;
}

/** Ruling G13 (I2): binds that sign-in to the draft entry made once the gate passed (once only). */
export async function claimOfferVerification(id: number, projectId: number): Promise<void> {
  await sql()`UPDATE github_verifications SET project_id = ${projectId} WHERE id = ${id} AND project_id IS NULL`;
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

/**
 * v2.10 fix round 1 (I6): the GitHub login this (non-shared) installation last verified with, or null:
 * a deploy's per-builder limits count by it.
 */
export async function installationLogin(installationId: number): Promise<string | null> {
  const [row] = await sql()<{ login: string }[]>`
    SELECT login FROM github_verifications WHERE installation_id = ${installationId}
    ORDER BY verified_at DESC, id DESC LIMIT 1`;
  return row?.login ?? null;
}

/** v2.11 T3: a GitHub login and how it was proven (builder_events.login_basis). */
export type LoginProof = { login: string; basis: 'signin' | 'app' | 'proof_line' };

/**
 * v2.11 T3 (spec 6, "Identity"): the GitHub login behind this installation's step on `repoKey`
 * ("owner/repo"), and its basis, or null. Never guessed, and never GITHUB_TOKEN's own login or the
 * login an agent reported (installations.github_user):
 * - `signin` or `app`: a passing verification of this repo for this installation (a sign-in wins
 *   over the read-only App). On a shared client only the caller's own (`callerLogin`), or the one
 *   bound to this entry (`projectId`); without either, null.
 * - `proof_line`: off a shared client, this installation's `token: <code>` line proved push access
 *   to the repo: the caller says it just passed (`proofLine`), or a contract EarnKit deployed for
 *   this installation and repo shows it did (the deploy runs only after it, R19). The login is the
 *   repo's owner (plan S9). On a shared client the proof line is the whole agent's: never a login.
 */
export async function loginBasisFor(
  installationId: number,
  repoKey: string,
  o: { callerLogin?: string | null; projectId?: number; proofLine?: boolean } = {},
): Promise<LoginProof | null> {
  const [owner, repo, extra] = repoKey.toLowerCase().split('/');
  if (!owner || !repo || extra !== undefined) return null;
  const key = `${owner}/${repo}`;
  const shared = o.callerLogin !== undefined || (await sharedGroup(installationId).catch(() => true));
  const db = sql();
  if (shared && !o.callerLogin && o.projectId === undefined) return null;
  const [row] = await db<{ login: string; via: string }[]>`
    SELECT login, via FROM github_verifications
    WHERE installation_id = ${installationId} AND repo_key = ${key}
      ${shared ? (o.callerLogin ? db`AND login = ${o.callerLogin.toLowerCase()}` : db`AND project_id = ${o.projectId!}`) : db``}
    ORDER BY (via = 'app'), verified_at DESC, id DESC LIMIT 1`;
  if (row) return { login: row.login.toLowerCase(), basis: row.via === 'app' ? 'app' : 'signin' };
  if (shared) return null;
  if (o.proofLine) return { login: owner, basis: 'proof_line' };
  const [deployed] = await db`SELECT 1 FROM contract_deploys WHERE installation_id = ${installationId} AND repo_key = ${key} LIMIT 1`;
  return deployed ? { login: owner, basis: 'proof_line' } : null;
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

/** v2.10 item 7b: the confirm page's first line on an App link. */
export const APP_CONFIRM_LEAD = 'Sign in with GitHub, then let EarnKit read this repo. Read only: EarnKit never changes your code.';

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
export const clearCsrf = (nonce: string) => `${csrfCookieName(nonce)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
export function cookieValue(request: Request, name: string): string | null {
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
  // v2.10 item 7b: an App link signs in, then installs the read-only App on the repo.
  const lead = d.purpose === 'app' ? APP_CONFIRM_LEAD : 'Sign in with GitHub to prove this repo is yours.';
  return html(
    `<p>${escapeHtml(lead)}</p><ul>${rows}</ul><p>${escapeHtml(CONFIRM_WARNING)}</p>` +
      `<form method="post" action="${escapeHtml(siteUrl())}/github/verify">` +
      `<input type="hidden" name="n" value="${escapeHtml(nonce)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">` +
      '<button type="submit">Continue with GitHub</button></form>',
  );
}

/** The routes' per-IP limit (tests inject `limit`). */
export type RouteDeps = { limit?: (request: Request) => Promise<unknown> };
const ipLimit = (request: Request) => enforce('githubVerify', clientIp(request.headers), VERIFY_PAGE.busy);

/** The per-IP limit's answer: a 429 page, or null to go on (the App's setup URL shares it). */
export async function limited(request: Request, deps: RouteDeps): Promise<Response | null> {
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
  // v2.10 Pre-flight P3: an App link goes on to GitHub's install page; the cookie stays for the setup URL.
  if (out.ok && out.install)
    return new Response(null, {
      status: 303,
      headers: { Location: out.install, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  if (out.ok) return verifyPage(out.code ? codeLine(out.code) : VERIFY_PAGE.done, 200, clear);
  return verifyPage(out.reason, out.reason === VERIFY_PAGE.expired ? 410 : 403, clear);
}
