import { createPrivateKey, createSign } from 'node:crypto';
import { sql } from './db';
import { pageUrl } from './reserved-routes';
import { GitHubError } from './match-projects';
import {
  PICK_REPOS,
  VERIFY_PAGE,
  appConfirmDestination,
  pageHandle,
  pageWith,
  clearCsrf,
  cookieValue,
  csrfCookieName,
  githubVerifyEnabled,
  notFoundPage,
  limited,
  saveVerification,
  takeNonce,
  verifyPage,
  type NonceRow,
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
    // T6 fix rounds 1, 2: a redirect (a renamed or transferred repo) is never followed: it is a GitHubError with
    // its 3xx status (repo-proof.ts appProofLive counts it as gone).
    redirect: 'manual',
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
 * only. Minted per call; never stored or logged. Launch ready L2: `repo` null is a token for the
 * installation's repo list only (metadata read), for the repo picker's setup (pickedRepos).
 */
export async function installationToken(installationId: number, repo: string | null, deps: AppDeps = {}): Promise<string> {
  const out = await ghApp<{ token?: unknown }>(deps.fetch ?? fetch, `/app/installations/${installationId}/access_tokens`, appJwt(deps.now), {
    method: 'POST',
    body: repo === null ? { permissions: { metadata: 'read' } } : { repositories: [repo], permissions: { contents: 'read', metadata: 'read' } },
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
    // GitHubError messages carry the status only, never the token or the JWT.
    console.error('[github-app] token', err instanceof Error ? `${err.name}: ${err.message}` : 'error');
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
    SELECT v.github_installation_id::text AS gid FROM github_verifications v JOIN installations i ON i.id = v.installation_id
    WHERE v.via = 'app' AND v.purpose = 'app' AND v.repo_key = ${a.repoKey.toLowerCase()}
      -- T6 fix round 1: the person's group (an installation of the group proved it), as repo-proof.ts reads it.
      AND COALESCE(i.builder_id, i.id) = COALESCE((SELECT COALESCE(g.builder_id, g.id) FROM installations g WHERE g.id = ${a.installationId}), ${a.installationId})
      AND v.used_at IS NULL AND v.github_installation_id IS NOT NULL
      ${a.login != null ? db`AND v.login = ${a.login.toLowerCase()}` : db``}
    ORDER BY v.verified_at DESC, v.id DESC LIMIT 1`;
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

/** Launch ready L2: at most this many repos of an installation are listed at the picker's setup (one page). */
export const PICK_LIST_MAX = 100;
/** Launch ready L2: at most this many picked repos are proven at setup, most recently pushed first. */
export const PICK_PROVE_MAX = 20;
/** Fix round 1 (I3): at most this many admin checks (an org's repos) at one setup, PICK_ADMIN_BATCH at a time. */
export const PICK_ADMIN_CHECKS = 30;
export const PICK_ADMIN_BATCH = 5;
/**
 * Fix round 1 (I3): the picker's setup has one deadline from the top of the handler: the list, the admin checks
 * and every proof's GitHub calls stop at it (repo-proof.ts budgetedFetch), and the connect read gets what is left.
 */
export const PICK_BUDGET_MS = 25_000;
/** Fix round 1 (I2): where a builder removes the App from repos (the daily check then takes them off the page). */
export const GITHUB_INSTALLATIONS_URL = 'https://github.com/settings/installations';

/** One repo the picker's installation lists that the installer owns or administers (pickedRepos). */
export type PickedRepo = { key: string; pushedAt: number };

/**
 * Launch ready L2: the repos this installation lists (GitHub's picker chose them; the first PICK_LIST_MAX), newest
 * push first, split by R8's rule as appProof applies it to one repo: the installation is the installer's own account
 * (and the repo is on it), or the installer is the repo's admin. Admin checks: at most PICK_ADMIN_CHECKS, in
 * batches of PICK_ADMIN_BATCH, stopping once PICK_PROVE_MAX repos passed or `deadline` (ms since the epoch)
 * passed. `listed`: how many were listed. Throws on a failed list (the setup page says so). `deps.fetch` should
 * carry the deadline (pickSetup passes repo-proof.ts budgetedFetch).
 */
export async function pickedRepos(
  a: { installationId: number; login: string; deadline?: number },
  deps: AppDeps = {},
): Promise<{ listed: number; mine: PickedRepo[] }> {
  const f = deps.fetch ?? fetch;
  const login = a.login.toLowerCase();
  const deadline = a.deadline ?? Infinity;
  const inst = await ghApp<{ account?: { login?: string } | null }>(f, `/app/installations/${a.installationId}`, appJwt(deps.now));
  const account = typeof inst.account?.login === 'string' ? inst.account.login.toLowerCase() : null;
  const token = await installationToken(a.installationId, null, deps);
  type Listed = { full_name?: unknown; pushed_at?: unknown };
  const all: Listed[] = [];
  for (let page = 1; all.length < PICK_LIST_MAX; page++) {
    const per = Math.min(100, PICK_LIST_MAX - all.length);
    const out = await ghApp<{ repositories?: Listed[] }>(f, `/installation/repositories?per_page=${per}&page=${page}`, token);
    const got = Array.isArray(out.repositories) ? out.repositories : [];
    all.push(...got.slice(0, per));
    if (got.length < per) break;
  }
  const repos = all
    .flatMap((r) => (typeof r.full_name === 'string' && /^[^/\s]+\/[^/\s]+$/.test(r.full_name)
      ? [{ key: r.full_name.toLowerCase(), pushedAt: typeof r.pushed_at === 'string' ? Date.parse(r.pushed_at) || 0 : 0 }]
      : []))
    .sort((x, y) => y.pushedAt - x.pushedAt || x.key.localeCompare(y.key));
  const own = (r: PickedRepo) => account !== null && account === login && r.key.split('/')[0] === login;
  const isAdmin = (r: PickedRepo) =>
    ghApp<{ permission?: string }>(f, `/repos/${r.key}/collaborators/${encodeURIComponent(login)}/permission`, token)
      .then((p) => p.permission === 'admin', () => false);
  const mine: PickedRepo[] = [];
  let checks = 0;
  let i = 0;
  while (i < repos.length && mine.length < PICK_PROVE_MAX && Date.now() < deadline) {
    if (own(repos[i])) {
      mine.push(repos[i++]);
      continue;
    }
    if (checks >= PICK_ADMIN_CHECKS) {
      i++; // no admin checks left: only the installer's own repos can still pass
      continue;
    }
    // Up to PICK_ADMIN_BATCH admin checks together, in push order (a batch ends at an own repo).
    const batch: PickedRepo[] = [];
    while (i < repos.length && batch.length < Math.min(PICK_ADMIN_BATCH, PICK_ADMIN_CHECKS - checks) && !own(repos[i])) batch.push(repos[i++]);
    checks += batch.length;
    const ok = await Promise.all(batch.map(isAdmin));
    batch.forEach((r, k) => {
      if (ok[k] && mine.length < PICK_PROVE_MAX) mine.push(r);
    });
  }
  return { listed: repos.length, mine };
}

/** How a setup page names a one project: a repo as its GitHub link, anything else as it is. Pure. */
const named = (key: string) => (/^[^/\s:]+\/[^/\s]+$/.test(key) ? `github.com/${key}` : key);

/** Launch ready L2 (fix round 1, I1, I2): what the picker's setup page says. */
export const PICK_PAGE = {
  /** Always names the one project after the setup and the page it is on. */
  ranked: (key: string, handle: string | null) =>
    `Done. EarnKit now ranks ${named(key)}${handle ? ` on ${pageUrl(handle)}` : ''}. Tell your agent if you want a different repo ranked.`,
  /** I2: every success page offers the way out for a forwarded link. */
  remove: (these: boolean) => `Not your page? Remove the EarnKit app from ${these ? 'these repos' : 'this repo'} in your GitHub settings:`,
  none: 'No repo was picked. Add one to the EarnKit app on GitHub, then ask your agent for a new link.',
  notYours: "This GitHub account doesn't own the repos you picked. Install the app with the account that owns them.",
  noneCounted: "None of the repos you picked can be ranked: forks, templates and repos on another page don't count. Pick one you made, then ask your agent for a new link.",
} as const;

/** Fix round 1 (I2): a success page: its lines, then the removal line with the one GitHub settings link. */
function donePage(lines: string[], these: boolean, headers: Record<string, string>): Response {
  return pageWith(lines, { text: PICK_PAGE.remove(these), href: GITHUB_INSTALLATIONS_URL }, 200, headers);
}

/**
 * Launch ready L2: the setup URL for the repo picker's nonce (repo_key PICK_REPOS), after appSetup's cookie and
 * single-use nonce checks. Each picked repo the installer owns or administers (pickedRepos) goes through proveOne
 * (exact installation, no fork or template, `repo_hold` lock, taken, a non-App hold replaced); only a proven one
 * gets its `via = 'app'` verification (fix round 1, M2). Fix round 1 (I1): the one project stays when it is one of
 * the proven repos; else setMainProject with the newest proven (it replaces an unconfirmed one and keeps a
 * confirmed one), and the page names whatever the one project is now, and the page it is on. Then one connect read,
 * rescore and backfill (connectProven) within what is left of `deadline`.
 */
async function pickSetup(row: NonceRow & { login: string; account_created_at: Date }, installationId: number, now: Date, deps: AppDeps, clear: Record<string, string>, deadline: number): Promise<Response> {
  const { budgetedFetch, proveOne, connectProven } = await import('./repo-proof');
  const timed = { ...deps, now, fetch: budgetedFetch(deps.fetch ?? fetch, deadline) };
  const { listed, mine } = await pickedRepos({ installationId, login: row.login, deadline }, timed);
  if (!listed) return verifyPage(PICK_PAGE.none, 403, clear);
  if (!mine.length) return verifyPage(PICK_PAGE.notYours, 403, clear);
  const builderId = await (await import('./identity')).rootOf(row.installation_id);
  const proven: Awaited<ReturnType<typeof proveOne>>[] = [];
  let tried = 0;
  let threw = 0;
  for (const r of mine) {
    if (Date.now() >= deadline) break;
    tried++;
    const p = await proveOne({ builderId, repoKey: r.key, githubInstallationId: installationId }, timed).catch((err: unknown) => {
      console.error('[github-app] prove', err instanceof Error ? err.name : 'error');
      threw++;
      return null;
    });
    if (!p?.out.ok) continue;
    await saveVerification(
      { ...row, repo_key: r.key },
      { login: row.login, created_at: row.account_created_at, public_repos: row.public_repos ?? 0 },
      now,
      { githubInstallationId: installationId },
    );
    proven.push(p);
  }
  // M3: GitHub failed every proof (or none could start): the failed page, never "none could count".
  if (!proven.length) return threw === tried ? verifyPage(VERIFY_PAGE.failed, 502, clear) : verifyPage(PICK_PAGE.noneCounted, 403, clear);
  const main = await import('./main-project');
  const current = (await main.mainProjectOf(builderId))?.toLowerCase() ?? null;
  // `mine` is newest push first, so the first proven is the most recently pushed.
  if (current === null || !proven.some((p) => p.key === current)) {
    const key = proven[0].key;
    await main.setMainProject(builderId, { name: key.split('/')[1], what: null, repo: key, live_url: null, package: null, contracts: [] });
  }
  const ranked = (await main.mainProjectOf(builderId)) ?? proven[0].key;
  await connectProven(builderId, proven, { ...deps, now }, { deadline })
    .catch((err: unknown) => console.error('[github-app] connect', err instanceof Error ? err.name : 'error'));
  return donePage([PICK_PAGE.ranked(ranked, await pageHandle(row.installation_id))], true, clear);
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
 * checks the proof (R8), and writes the `via = 'app'` verification. No paste code (v2.14 final fix: a shared
 * client never gets an App link, Ruling T6-2). Never logs the nonce, a token or the key.
 */
export async function appSetup(request: Request, deps: AppDeps & RouteDeps = {}): Promise<Response> {
  // Fix round 1 (I3): the picker's one setup deadline starts here.
  const deadline = Date.now() + PICK_BUDGET_MS;
  if (!githubAppEnabled()) return notFoundPage();
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
    // Launch ready L2: the repo picker's link names no repo; GitHub's page picked them.
    if (row.repo_key === PICK_REPOS) return await pickSetup({ ...row, login: row.login, account_created_at: row.account_created_at }, installationId, now, deps, clear, deadline);
    const proof = await appProof({ installationId, login: row.login, repoKey: row.repo_key }, deps);
    if (!proof.ok) return verifyPage(proof.reason === 'not_listed' ? APP_PAGE.notListed : APP_PAGE.notYours, 403, clear);
    // v2.14 spec 2 (A8): the install verifies the person's repo source (`github_app`) and rescores them, so the
    // next reply counts it. The page says done either way; the next reply says what counted. Fix round 1 (M2): the
    // `via = 'app'` verification is written only for a repo proveOne proved (a taken repo or a copy gets none, so
    // appTokenFor never mints a token for it), before the connect read (which mints through it).
    const builderId = await (await import('./identity')).rootOf(row.installation_id);
    const { proveOne, connectProven } = await import('./repo-proof');
    const p = await proveOne({ builderId, repoKey: row.repo_key, githubInstallationId: installationId }, deps)
      .catch((err: unknown) => {
        console.error('[github-app] prove', err instanceof Error ? err.name : 'error');
        return null;
      });
    if (!p?.out.ok) return verifyPage(VERIFY_PAGE.done, 200, clear);
    await saveVerification(
      row,
      { login: row.login, created_at: row.account_created_at, public_repos: row.public_repos ?? 0 },
      now,
      { githubInstallationId: installationId },
    );
    await connectProven(builderId, [p], deps).catch((err: unknown) => console.error('[github-app] connect', err instanceof Error ? err.name : 'error'));
    // I2: the page names where the repo went, and the way out.
    const handle = await pageHandle(row.installation_id);
    return donePage([VERIFY_PAGE.done, ...(handle ? [appConfirmDestination(row.repo_key, handle)] : [])], false, clear);
  } catch (err) {
    console.error('[github-app] setup', err instanceof Error ? err.name : 'error');
    return verifyPage(VERIFY_PAGE.failed, 502, clear);
  }
}
