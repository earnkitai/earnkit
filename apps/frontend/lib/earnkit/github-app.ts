import { createPrivateKey, createSign } from 'node:crypto';
import { sql } from './db';
import { GitHubError } from './match-projects';
import {
  VERIFY_PAGE,
  clearCsrf,
  codeLine,
  cookieValue,
  csrfCookieName,
  githubVerifyEnabled,
  limited,
  saveVerification,
  takeNonce,
  verifyPage,
  type RouteDeps,
} from './github-verify';

/**
 * v2.10 item 7b: the optional read-only GitHub App (Contents: read, Metadata: read, nothing else),
 * installed by the builder on selected repos, so EarnKit can match a private repo in full and the
 * token gate can read it. Off unless GITHUB_APP_ID, GITHUB_APP_SLUG and GITHUB_APP_PRIVATE_KEY are
 * all set (the key a parseable PEM) and the v2.9 GitHub sign-in is on (Pre-flight P17: the App
 * link starts with that sign-in).
 *
 * - R8, the proof flow: the "allow read access" link is a v2.9 nonce with purpose `app`. The v2.9
 *   confirm page and OAuth sign-in run; the callback stores the login on the nonce and sends the
 *   builder to `installUrl` (github-verify.ts appSignIn). GitHub then sends them to the setup URL
 *   (`appSetup`), which needs the same browser cookie, consumes the nonce, and passes when the
 *   installation is the login's own account or the login is the repo's admin, and the installation
 *   lists the repo. A pass is a github_verifications row with `via = 'app'`.
 * - v2.14 spec 2: the install is the only proof of a repo. The setup URL verifies the person's repo
 *   source as `github_app` (repo-proof.ts proveByApp), which the coin gate, builds, hosting and the
 *   Bench all read; readings of an App-proven repo use its installation token.
 * - The private key is never stored, logged or returned. Installation tokens (1 hour, this repo only,
 *   contents and metadata read) are minted per call and never stored or logged; errors carry the HTTP
 *   status only.
 */

const API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;

const pem = (env: Record<string, string | undefined>) => env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n').trim() ?? '';

/** All three App vars are set, the key parses as a PEM private key, and the v2.9 sign-in is on. */
export function githubAppEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (!env.GITHUB_APP_ID?.trim() || !env.GITHUB_APP_SLUG?.trim() || !githubVerifyEnabled(env)) return false;
  const key = pem(env);
  if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)) return false;
  try {
    createPrivateKey(key);
    return true;
  } catch {
    return false;
  }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** RS256 App JWT (GitHub: iat 60 s in the past, at most 10 minutes). Never logged. */
export function appJwt(now = new Date(), env: Record<string, string | undefined> = process.env): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 600, iss: env.GITHUB_APP_ID?.trim() }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(pem(env));
  return `${head}.${body}.${b64url(sig)}`;
}

export type AppDeps = { fetch?: typeof fetch; now?: Date };

/** One App API call: a non-2xx throws GitHubError with the status only (never a token or a body). */
async function ghApp<T>(f: typeof fetch, path: string, bearer: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await f(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${bearer}`,
      'User-Agent': 'earnkit',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new GitHubError(`GitHub App request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

/**
 * A 1-hour installation token for one repo (`repo`: its name), with contents and metadata read
 * only. Minted per call; never stored or logged.
 */
export async function installationToken(installationId: number, repo: string, deps: AppDeps = {}): Promise<string> {
  const out = await ghApp<{ token?: unknown }>(deps.fetch ?? fetch, `/app/installations/${installationId}/access_tokens`, appJwt(deps.now), {
    method: 'POST',
    body: { repositories: [repo], permissions: { contents: 'read', metadata: 'read' } },
  });
  if (typeof out.token !== 'string' || out.token === '') throw new GitHubError('GitHub App request failed (no token)');
  return out.token;
}

/**
 * R8: the installation lists the repo, and it is the builder's own account (the login the OAuth hop
 * proved), or the builder is the repo's admin. `repoKey` is lowercase owner/repo.
 */
export async function appProof(
  a: { installationId: number; login: string; repoKey: string },
  deps: AppDeps = {},
): Promise<{ ok: true } | { ok: false; reason: 'not_listed' | 'not_yours' }> {
  const f = deps.fetch ?? fetch;
  const inst = await ghApp<{ account?: { login?: string } | null }>(f, `/app/installations/${a.installationId}`, appJwt(deps.now));
  let token: string;
  try {
    token = await installationToken(a.installationId, a.repoKey.split('/')[1], deps);
  } catch (err) {
    // GitHub refuses a token for a repo the installation doesn't cover.
    if (err instanceof GitHubError && (err.status === 422 || err.status === 404)) return { ok: false, reason: 'not_listed' };
    throw err;
  }
  const repos = await ghApp<{ repositories: { full_name: string }[] }>(f, '/installation/repositories?per_page=100', token);
  if (!repos.repositories.some((r) => r.full_name.toLowerCase() === a.repoKey.toLowerCase())) return { ok: false, reason: 'not_listed' };
  if (inst.account?.login && inst.account.login.toLowerCase() === a.login.toLowerCase()) return { ok: true };
  const perm = await ghApp<{ permission: string }>(
    f,
    `/repos/${a.repoKey}/collaborators/${encodeURIComponent(a.login)}/permission`,
    token,
  ).catch(() => null);
  return perm?.permission === 'admin' ? { ok: true } : { ok: false, reason: 'not_yours' };
}

/**
 * R9: an installation token for a repo this builder proved with the App, or null (the App is off,
 * there is no such proof, or GitHub refused the token). Scoped as verifiedFor: this installation
 * and repo, and `login` like the gate's (undefined: not a shared client, any; null: a shared client
 * with no verified caller, none; a login: only its proofs). Never throws.
 */
export async function appTokenFor(
  a: { installationId: number; login?: string | null; repoKey: string },
  deps: AppDeps = {},
): Promise<string | null> {
  if (!githubAppEnabled() || a.login === null) return null;
  try {
    const row = await appProofRow(a);
    if (!row) return null;
    // v2.13.3 review M4: the installation is the one GitHub names for the repo now (the stored setup-URL id is
    // only a hint: the App may have been reinstalled). None listed: fail closed. The mint itself still names
    // only this repo, so a token never reaches another.
    const id = await repoInstallation(a.repoKey, deps);
    if (id === null) return null;
    return await installationToken(id, a.repoKey.split('/')[1], deps);
  } catch (err) {
    console.error('[github-app] token', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * v2.13.3 review M4: the App's installation on `repoKey`, as GitHub answers `GET /repos/{owner}/{repo}/installation`
 * with the App's JWT; null when GitHub lists none (404) or the answer has no id. Other failures throw.
 */
export async function repoInstallation(repoKey: string, deps: AppDeps = {}): Promise<number | null> {
  try {
    const out = await ghApp<{ id?: unknown }>(deps.fetch ?? fetch, `/repos/${repoKey.toLowerCase()}/installation`, appJwt(deps.now));
    return typeof out.id === 'number' && Number.isSafeInteger(out.id) && out.id > 0 ? out.id : null;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null;
    throw err;
  }
}

/** The newest App proof row for this repo, scoped as appTokenFor (`login` null is handled by callers). */
async function appProofRow(a: { installationId: number; login?: string | null; repoKey: string }) {
  const db = sql();
  const [row] = await db<{ gid: string }[]>`
    SELECT github_installation_id::text AS gid FROM github_verifications
    WHERE via = 'app' AND purpose = 'app' AND installation_id = ${a.installationId} AND repo_key = ${a.repoKey.toLowerCase()}
      AND used_at IS NULL AND github_installation_id IS NOT NULL
      ${a.login != null ? db`AND login = ${a.login.toLowerCase()}` : db``}
    ORDER BY verified_at DESC, id DESC LIMIT 1`;
  return row ?? null;
}

/**
 * Final fix I2 (ledger c1): whether this builder already proved the repo with the App (scoped as
 * appTokenFor; a shared client with no verified caller has none). A failed read counts as a proof,
 * so the link is never offered on a guess. No GitHub call.
 */
export async function hasAppProof(a: { installationId: number; login?: string | null; repoKey: string }): Promise<boolean> {
  if (a.login === null) return false;
  try {
    return (await appProofRow(a)) !== null;
  } catch (err) {
    console.error('[github-app] proof read', err instanceof Error ? err.name : 'error');
    return true;
  }
}

/** GitHub's install page for the App, with the v2.9 nonce as `state` (R8). Pure. */
export const installUrl = (slug: string, nonce: string) =>
  `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(nonce)}`;

/** What the builder reads when the App proof doesn't pass (the setup URL's page). */
export const APP_PAGE = {
  notListed: "EarnKit can't read that repo yet. Add it to the EarnKit app on GitHub, then ask your agent for a new link.",
  notYours: "This GitHub account doesn't own that repo. Install the app with the account that owns it.",
} as const;

/**
 * GET /github/verify/app?installation_id=&state= (the App's setup URL). Refuses, before the nonce is
 * used, a missing browser cookie (the confirm page's, Ruling G8) or an installation id that isn't a
 * number. Then consumes the nonce (an `app` nonce whose OAuth hop stored a login, Pre-flight P3),
 * checks the proof (R8), and writes the `via = 'app'` verification. On a shared client the page shows
 * the one-time code (Ruling G9). Never logs the nonce, a token or the key.
 */
export async function appSetup(request: Request, deps: AppDeps & RouteDeps = {}): Promise<Response> {
  if (!githubAppEnabled()) return new Response('Not found', { status: 404 });
  const busy = await limited(request, deps);
  if (busy) return busy;
  const q = new URL(request.url).searchParams;
  const nonce = q.get('state') ?? '';
  const rawId = q.get('installation_id') ?? '';
  const cookie = nonce ? cookieValue(request, csrfCookieName(nonce)) : null;
  if (!cookie) return verifyPage(VERIFY_PAGE.failed, 403);
  const clear = { 'Set-Cookie': clearCsrf(nonce) };
  if (!/^\d{1,15}$/.test(rawId)) return verifyPage(VERIFY_PAGE.failed, 400, clear);
  const installationId = Number(rawId);
  const now = deps.now ?? new Date();
  const row = await takeNonce(nonce, now, { purpose: 'app' });
  if (!row || !row.login || !row.account_created_at) return verifyPage(VERIFY_PAGE.expired, 410, clear);
  try {
    const proof = await appProof({ installationId, login: row.login, repoKey: row.repo_key }, deps);
    if (!proof.ok) return verifyPage(proof.reason === 'not_listed' ? APP_PAGE.notListed : APP_PAGE.notYours, 403, clear);
    const paste = await saveVerification(
      row,
      { login: row.login, created_at: row.account_created_at, public_repos: row.public_repos ?? 0 },
      now,
      { githubInstallationId: installationId },
    );
    // v2.14 spec 2 (A8): the install verifies the person's repo source (`github_app`) and rescores them, so the
    // next reply counts it. The page says done either way; the next reply says what counted.
    const builderId = await (await import('./identity')).rootOf(row.installation_id);
    await (await import('./repo-proof'))
      .proveByApp({ builderId, repoKey: row.repo_key, githubInstallationId: installationId }, deps)
      .catch((err: unknown) => console.error('[github-app] prove', err instanceof Error ? err.name : 'error'));
    return verifyPage(paste ? codeLine(paste) : VERIFY_PAGE.done, 200, clear);
  } catch (err) {
    console.error('[github-app] setup', err instanceof Error ? err.name : 'error');
    return verifyPage(VERIFY_PAGE.failed, 502, clear);
  }
}
