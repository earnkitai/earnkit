import { GITHUB_ICON, brandShell } from './brand-page';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from './db';
import { sharedGroup } from './installations';
import { siteUrl } from './entry-text';
import { pageUrl } from './reserved-routes';
import { RateLimitError, clientIp, enforce } from './rate-limit';

/**
 * v2.9 B9, v2.10 item 7b, v2.14 spec 2: the GitHub sign-in hop in front of the read-only GitHub App
 * (github-app.ts). v2.14: the GitHub sign-in is no longer a proof of anything by itself; its only use is the
 * App link's hop, which names the installer for the setup URL (github-app.ts appSetup, repo-proof.ts proveByApp).
 *
 * - The link carries a one-time nonce (32 random bytes, base64url). Only its sha256 is stored, bound
 *   to the installation (the person's root) and the repo, with purpose `app`. It expires after 15 minutes.
 * - Ruling G8, preflight S7: the link never goes straight to GitHub. It shows a confirm page naming the repo
 *   and the earnkit.com page it is added to ("Only continue if that is your page"), and sets a per-link
 *   `__Host-` cookie (HttpOnly, Secure, SameSite=Lax, 15 minutes); its button POSTs, and GitHub gets state =
 *   `<nonce>.<csrf>`. The callback refuses a missing or mismatched cookie before it uses the nonce or
 *   exchanges the code, so the sign-in finishes only in the browser that confirmed it.
 * - The callback reads only `code` and `state` (and the cookie). The repo comes from the nonce's row, never
 *   from the request. The scopeless GitHub token is used for one read and is never stored or logged.
 * - Links and the redirect come from siteUrl() (EARNKIT_URL), never from the request Host (P47).
 * - Off unless GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET are both set.
 * - Rows from before v2.14 (entry, pickup, host and claim sign-ins) stay as history: verifiedFor,
 *   loginBasisFor and verifiedEntryIds still read them; no new one is made. v2.14 final fix: the shared
 *   client's pasted sign-in code (signed_in, callerLogin) is gone with the GitHub sign-in that made it.
 */

export const VERIFY_TTL_MS = 15 * 60_000;

/** What the builder reads in the browser after the callback. */
export const VERIFY_PAGE = {
  done: 'Done. Go back to your agent and say go.',
  expired: 'This link has expired. Ask your agent for a new one.',
  notYours: "This GitHub account can't push to that repo. Sign in with the account that owns it.",
  failed: "Sign-in didn't finish. Ask your agent for a new link.",
  busy: 'Too many sign-ins from here. Try again in an hour.',
  notFound: 'This page is not available.',
  /** v2.12.1 T7: after the claim page's GitHub sign-in. */
  claimDone: 'Done. Your agent will show the new numbers next time you ask.',
  /** Spec B9: GitHub shows no permissions (an org repo a scopeless sign-in can't see): the proof line is the way. */
  orgRepo: "GitHub doesn't show whether this account can push to that repo. Ask your agent to prove it with a short line in the repo instead.",
} as const;

export function githubVerifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID?.trim() && env.GITHUB_OAUTH_CLIENT_SECRET?.trim());
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * v2.10 item 7b (R8): `app` is the read-only GitHub App's link (github-app.ts): no launch rides on it (R9).
 * v2.12.1 T7: `claim` is the claim page's optional "Sign in with GitHub" (repo_key `claim/<root>`, no
 * repo): it proves the login only, never a repo, and goes through the T5 proven-tie rules on save.
 */
export type VerifyPurpose = 'entry' | 'pickup' | 'host' | 'app' | 'claim';
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
 * v2.14: the earnkit.com/<handle> page of this installation's person (its group root's claimed profile), or
 * null (no page). Preflight S7: the App confirm page names it. Never throws (a failed read is no page).
 */
export async function pageHandle(installationId: number): Promise<string | null> {
  try {
    const [p] = await sql()<{ handle: string | null }[]>`
      SELECT p.x_handle AS handle FROM builder_profiles p
      WHERE p.builder_id = COALESCE((SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = ${installationId}), ${installationId})
        AND p.x_user_id IS NOT NULL AND p.x_handle IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM installations s WHERE COALESCE(s.builder_id, s.id) = p.builder_id AND s.shared_client)`;
    return p?.handle ?? null;
  } catch (err) {
    console.error('[github-verify] handle', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * A one-time App link for this repo (`owner/repo`, answer-bank.ts repoKey), bound to the installation
 * (the person's root) and the purpose `app`: `<site>/github/verify?n=<nonce>`. v2.14: no other purpose.
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
  // v2.14 spec 2: the GitHub sign-in proof is gone; the only link is the read-only App's.
  if (a.purpose !== 'app') throw new Error('Only the read-only GitHub App link is made.');
  // v2.10 item 7b: no App link while the App is off (github-app.ts; imported here to keep the modules acyclic).
  if (!(await import('./github-app')).githubAppEnabled()) throw new Error('The read-only GitHub App is off.');
  // Preflight S7: the confirm page names the page the repo is added to, so a person with no page (no X handle:
  // an anonymous installation, or a shared client) gets no link.
  if (!(await pageHandle(a.installationId))) throw new Error('An App link needs the person\'s page handle first.');
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
 * A passed check's github_verifications row, for the nonce's own repo and entry. v2.10 item 7b: `app` is a
 * read-only GitHub App proof (`via = 'app'`, its installation id); it never carries a wallet (R9). v2.14 final
 * fix: no paste code is made (a shared client never gets an App link, Ruling T6-2); code_hash stays NULL.
 */
export async function saveVerification(
  row: Pick<NonceRow, 'installation_id' | 'project_id' | 'repo_key' | 'purpose' | 'wallet' | 'symbol'>,
  user: { login: string; created_at: Date; public_repos: number },
  now: Date,
  app?: { githubInstallationId: number },
): Promise<void> {
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, project_id, account_created_at, public_repos, verified_at, purpose,
      code_hash, code_expires_at, wallet, symbol, via, github_installation_id)
    VALUES (${row.repo_key}, ${user.login.toLowerCase()}, ${row.installation_id}, ${row.project_id},
      ${user.created_at}, ${user.public_repos}, ${now}, ${row.purpose},
      NULL, NULL,
      ${app ? null : row.wallet}, ${app ? null : row.symbol}, ${app ? 'app' : 'oauth'}, ${app?.githubInstallationId ?? null})`;
  // v2.14 spec 1: X is the account: a GitHub login joins no one and contests nothing (the App proves the repo).
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
 * The callback's work. v2.14 spec 2: only an `app` nonce's OAuth hop is left (appSignIn: the nonce is not
 * consumed; the login is stored on it and the builder goes on to install the App). Any other stored nonce
 * (a v2.9 sign-in link made before v2.14) answers "expired", untouched. Never logs the code, the token, the
 * nonce or the secret.
 */
export async function completeVerify(
  code: string,
  nonce: string,
  deps: GitHubOAuthDeps = githubOAuth,
  now = new Date(),
): Promise<{ ok: true; repoKey: string; install?: string; line?: string } | { ok: false; reason: string }> {
  if ((await noncePurpose(nonce, now)) === 'app') return appSignIn(code, nonce, deps, now);
  return { ok: false, reason: VERIFY_PAGE.expired };
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
      ${a.purpose ? db`AND purpose = ${a.purpose}` : db`AND purpose NOT IN ('app', 'claim')`}
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
 * v2.10 fix round 1 (I6): the GitHub login this (non-shared) installation last verified with, or null:
 * a deploy's per-builder limits count by it.
 */
export async function installationLogin(installationId: number): Promise<string | null> {
  const [row] = await sql()<{ login: string }[]>`
    SELECT login FROM github_verifications WHERE installation_id = ${installationId}
    ORDER BY verified_at DESC, id DESC LIMIT 1`;
  return row?.login ?? null;
}

/**
 * v2.11 T3: a GitHub login and how it was proven (builder_events.login_basis). v2.12.1 T7: `x_match`,
 * the login the agent reported whose GitHub X field is the person's claimed X (discovery.ts
 * provenLogin only; it confirms the person's own work and never joins anyone).
 */
export type LoginProof = { login: string; basis: 'signin' | 'app' | 'proof_line' | 'x_match' };

/** A GitHub account's public facts (GET /users/<login>). */
export type GitHubAccount = { type: string; created_at: string; public_repos: number };
const GHUSER_TTL_MS = 24 * 60 * 60_000;

/**
 * Plan S9: a public read of GET /users/<login>, cached 24 hours in url_checks (key `ghuser:<login>`;
 * `ok` false: no such user; `note`: the facts as JSON). Null when there is no such account or the
 * read failed (a failure is not cached). EarnKit's GITHUB_TOKEN only raises the rate limit; the data
 * is public. Never logs the token.
 */
export async function githubUser(login: string, now = new Date()): Promise<GitHubAccount | null> {
  const name = login.toLowerCase();
  if (!/^[a-z0-9-]{1,39}$/.test(name)) return null;
  const key = `ghuser:${name}`;
  const [hit] = await sql()<{ ok: boolean; note: string | null }[]>`
    SELECT ok, note FROM url_checks WHERE key = ${key} AND checked_at > ${new Date(now.getTime() - GHUSER_TTL_MS)}`;
  if (hit) {
    if (!hit.ok || !hit.note) return null;
    try {
      return JSON.parse(hit.note) as GitHubAccount;
    } catch {
      return null;
    }
  }
  try {
    const token = process.env.GITHUB_TOKEN?.trim();
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(name)}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EarnKit', ...(token && { Authorization: `Bearer ${token}` }) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 404 && !res.ok) return null;
    const u = res.ok ? ((await res.json()) as { type?: unknown; created_at?: unknown; public_repos?: unknown }) : null;
    const facts =
      // T9 security review M7: a created_at that isn't a date is no facts.
      u && typeof u.type === 'string' && typeof u.created_at === 'string' && Number.isFinite(Date.parse(u.created_at))
        ? { type: u.type, created_at: u.created_at, public_repos: Number(u.public_repos) || 0 }
        : null;
    await sql()`
      INSERT INTO url_checks (key, ok, checked_at, note) VALUES (${key}, ${facts !== null}, ${now}, ${facts && JSON.stringify(facts)})
      ON CONFLICT (key) DO UPDATE SET ok = EXCLUDED.ok, checked_at = EXCLUDED.checked_at, note = EXCLUDED.note`;
    return facts;
  } catch (err) {
    console.error('[github-verify] user read', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * Final fix M6 (T9 N6): whether a repo ever read as a fork or as made from a template. The first
 * reading per repo is kept in url_checks (`ghrepo:<owner/repo>`, ok = never derived), and a later
 * reading that is set marks it for good, so erasing the flag later (the source repo deleted or made
 * private) never makes the repo the owner's own work.
 */
export async function repoEverDerived(repoKey: string, derivedNow: boolean): Promise<boolean> {
  const [row] = await sql()<{ ok: boolean }[]>`
    INSERT INTO url_checks (key, ok, checked_at) VALUES (${`ghrepo:${repoKey.toLowerCase()}`}, ${!derivedNow}, now())
    ON CONFLICT (key) DO UPDATE SET ok = url_checks.ok AND EXCLUDED.ok
    RETURNING ok`;
  return row ? !row.ok : derivedNow;
}

/**
 * v2.11 T3 (spec 6, "Identity"): the GitHub login behind this installation's step on `repoKey`
 * ("owner/repo"), and its basis, or null (no login is recorded). Never guessed, and never
 * GITHUB_TOKEN's own login. v2.14 spec 2: a passing verification of this repo for this installation:
 * the read-only App's (`app`), or a v2.9 sign-in kept from before v2.14 (`signin`; a sign-in wins over
 * the App). On a shared client only the caller's own (`callerLogin`), or the one bound to this entry
 * (`projectId`); without either, null. The proof line no longer names anyone.
 */
export async function loginBasisFor(
  installationId: number,
  repoKey: string,
  o: { callerLogin?: string | null; projectId?: number } = {},
): Promise<LoginProof | null> {
  const [owner, repo, extra] = repoKey.toLowerCase().split('/');
  if (!owner || !repo || extra !== undefined) return null;
  const key = `${owner}/${repo}`;
  const shared = o.callerLogin !== undefined || (await sharedGroup(installationId).catch(() => true));
  const db = sql();
  if (shared && !o.callerLogin && o.projectId === undefined) return null;
  const [row] = await db<{ login: string; via: string }[]>`
    SELECT login, via FROM github_verifications
    WHERE installation_id = ${installationId} AND repo_key = ${key} AND purpose <> 'claim'
      ${shared ? (o.callerLogin ? db`AND login = ${o.callerLogin.toLowerCase()}` : db`AND project_id = ${o.projectId!}`) : db``}
    ORDER BY (via = 'app'), verified_at DESC, id DESC LIMIT 1`;
  return row ? { login: row.login.toLowerCase(), basis: row.via === 'app' ? 'app' : 'signin' } : null;
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
 * Ruling G8, preflight S7: what the confirm page names before anyone signs in: the repo and the page it is
 * added to (`handle`: the person's earnkit.com page, pageHandle). Null when the nonce is unusable (used,
 * expired, unknown).
 */
export async function nonceDetails(nonce: string, now = new Date()): Promise<{ repo_key: string; purpose: VerifyPurpose; handle: string | null } | null> {
  if (!nonce) return null;
  const [row] = await sql()<{ repo_key: string; purpose: VerifyPurpose; installation_id: number }[]>`
    SELECT n.repo_key, n.purpose, n.installation_id FROM github_verify_nonces n
    WHERE n.nonce_hash = ${sha256(nonce)} AND n.used_at IS NULL AND n.expires_at > ${now}`;
  if (!row) return null;
  return { repo_key: row.repo_key, purpose: row.purpose, handle: row.purpose === 'app' ? await pageHandle(row.installation_id) : null };
}

/** v2.10 item 7b: the confirm page's first line on an App link. */
export const APP_CONFIRM_LEAD = 'Sign in with GitHub, then let EarnKit read this repo.';
/** The confirm page's read-only line, set apart so it can't be missed. */
export const APP_CONFIRM_READ_ONLY = 'EarnKit never changes your code.';
export const APP_CONFIRM_TITLE = 'Connect GitHub';
/** Preflight S7: the App link names the page the repo is added to (a forwarded link adds the repo to someone else's page). */
export const appConfirmDestination = (repoKey: string, handle: string) => `This adds github.com/${repoKey} to ${pageUrl(handle)}.`;
export const APP_CONFIRM_ONLY_YOURS = 'Only continue if that is your page.';


const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
/** v2 premium: the same dark shell as the claim, sign-in and wallet pages (brand-page.ts). */
const html = (body: string) => brandShell(body);

/** The tiny page the builder sees. No script, nothing cached. Pure. */
export function verifyPage(line: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(html(`<p class="ek-line ek-first">${escapeHtml(line)}</p>`), { status, headers: { ...PAGE_HEADERS, ...headers } });
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

/**
 * The confirm page (Ruling G8): what is being linked, the warning, and one POST button. v2.14 (preflight S7):
 * only the App link, which names the repo and the page it is added to, then "Only continue if that is your page".
 * Pure.
 */
export function confirmPage(d: { repo_key: string; handle: string }, nonce: string, csrf: string): string {
  return html(
    `<span class="ek-mark" aria-hidden="true">${GITHUB_ICON}</span>` +
      `<h1>${escapeHtml(APP_CONFIRM_TITLE)}</h1><p class="ek-line">${escapeHtml(APP_CONFIRM_LEAD)}</p>` +
      `<dl class="ek-rows"><div class="ek-row"><dt class="ek-k">Repo<span class="ek-sr">:</span></dt><dd><span class="ek-chip">${GITHUB_ICON}github.com/${escapeHtml(d.repo_key)}</span></dd></div>` +
      `<div class="ek-row"><dt class="ek-k">Page<span class="ek-sr">:</span></dt><dd><span class="ek-chip">${escapeHtml(pageUrl(d.handle))}</span></dd></div></dl>` +
      `<p class="ek-note"><strong>Read only.</strong> ${escapeHtml(APP_CONFIRM_READ_ONLY)}</p>` +
      `<p class="ek-small">${escapeHtml(appConfirmDestination(d.repo_key, d.handle))} ${escapeHtml(APP_CONFIRM_ONLY_YOURS)}</p>` +
      `<div class="ek-actions"><form method="post" action="${escapeHtml(siteUrl())}/github/verify">` +
      `<input type="hidden" name="n" value="${escapeHtml(nonce)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">` +
      `<button class="ek-btn" type="submit">${GITHUB_ICON}Continue with GitHub</button></form></div>`,
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

export const notFoundPage = () => verifyPage(VERIFY_PAGE.notFound, 404);
const notFound = notFoundPage;

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
  // v2.14: only an App link is shown; preflight S7: never without the page it adds the repo to.
  if (!d || d.purpose !== 'app' || !d.handle) return verifyPage(VERIFY_PAGE.expired, 410);
  const csrf = randomBytes(32).toString('base64url');
  // Review Minor 1: same-origin, never no-referrer, so the button's POST carries a real Origin
  // (under no-referrer a browser sends `Origin: null`, which verifyConfirm refuses).
  return new Response(confirmPage({ repo_key: d.repo_key, handle: d.handle }, nonce, csrf), {
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
  if (out.ok) return verifyPage(out.line ?? VERIFY_PAGE.done, 200, clear);
  return verifyPage(out.reason, out.reason === VERIFY_PAGE.expired ? 410 : 403, clear);
}
