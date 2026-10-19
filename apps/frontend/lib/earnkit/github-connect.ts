import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { claimCode } from './claim';
import { siteUrl } from './entry-text';
import { appJwt, ghApp, installationToken, type AppDeps } from './github-app';
import {
  VERIFY_PAGE, clearCsrf, cookieHeaders, cookieValue, csrfCookieName, githubVerifyEnabled, limited, saveVerification, setCsrf, verifyPage, type NonceRow, type RouteDeps,
} from './github-verify';
import { fillGithubUser, setMainProject } from './main-project';

/**
 * Sign-in first (one-pager step 2): the connect link's GitHub step is the read-only App install (Contents:
 * read, Metadata: read; no OAuth scope), with no repo named yet. GitHub's install screen is the repo picker.
 * The link is a v2.10 `app` nonce whose repo_key is `connect/<builder>` (no schema change); appSetup hands it
 * here after the nonce is used. The installation's repos are listed with an installation token (minted per
 * call, never stored or logged): one repo becomes the builder's main project at once; several get a small
 * picker page (a POST with the browser's csrf cookie and a signed, 15-minute token; nothing typed). Either
 * way the chosen repo gets the same `via = 'app'` proof row a per-repo install writes, so the existing
 * readers (appTokenFor) can read its commits, private or not. Then the builder goes on to X.
 */
export const CONNECT_PREFIX = 'connect/';
export const connectRepoKey = (builderId: number) => `${CONNECT_PREFIX}${builderId}`;
export const isConnectKey = (key: string) => key.startsWith(CONNECT_PREFIX);

export const CONNECT_PAGE = {
  none: "EarnKit can't read any of your repos yet. Open the link from your agent again and choose at least one.",
  lead: 'Which project should EarnKit rank?',
  button: 'Continue',
  badChoice: "That repo isn't one EarnKit can read. Open the link from your agent again.",
} as const;
const PICK_TTL_MS = 15 * 60_000;
const MAX_REPOS = 100;
const MAX_ADMIN_CHECKS = 25;

/** The installation's repos (lowercase owner/repo) the signed-in login owns, up to MAX_REPOS. */
export async function ownedRepos(installationId: number, login: string, deps: AppDeps = {}): Promise<string[]> {
  const f = deps.fetch ?? fetch;
  const inst = await ghApp<{ account?: { login?: string } | null }>(f, `/app/installations/${installationId}`, appJwt(deps.now));
  const token = await installationToken(installationId, null, deps);
  const out = await ghApp<{ repositories?: { full_name?: unknown }[] }>(f, `/installation/repositories?per_page=${MAX_REPOS}`, token);
  const names = (out.repositories ?? []).map((r) => r.full_name).filter((n): n is string => typeof n === 'string' && /^[^/]+\/[^/]+$/.test(n)).map((n) => n.toLowerCase());
  if (inst.account?.login && inst.account.login.toLowerCase() === login.toLowerCase()) return names;
  // An organization's install: only repos the login administers (as appProof).
  const mine: string[] = [];
  for (const n of names.slice(0, MAX_ADMIN_CHECKS)) {
    const perm = await ghApp<{ permission: string }>(f, `/repos/${n}/collaborators/${encodeURIComponent(login)}/permission`, token).catch(() => null);
    if (perm?.permission === 'admin') mine.push(n);
  }
  return mine;
}

type Who = { builderId: number; githubInstallationId: number; login: string; createdAt: string; publicRepos: number };

/** The chosen repo: the App proof row, the main project, then on to X (the claim page, same code). */
async function finish(who: Who, repo: string, now: Date, clear: Record<string, string>): Promise<Response> {
  await saveVerification(
    { installation_id: who.builderId, project_id: null, repo_key: repo, purpose: 'app', wallet: null, symbol: null },
    { login: who.login, created_at: new Date(who.createdAt), public_repos: who.publicRepos },
    now,
    { githubInstallationId: who.githubInstallationId },
  );
  await setMainProject(who.builderId, { name: repo.split('/')[1], what: null, repo, live_url: null, package: null, contracts: [] });
  await fillGithubUser(who.builderId, repo, who.login).catch(() => undefined);
  const code = claimCode(who.builderId);
  if (!code) return verifyPage(VERIFY_PAGE.done, 200, clear);
  return new Response(null, { status: 303, headers: { Location: `${siteUrl()}/claim/${code}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...clear } });
}

// ---- The picker's signed token: the person, the installation and the login, for 15 minutes.
const secret = () => process.env.EARNKIT_AUTH_SECRET ?? '';
const mac = (body: string) => createHmac('sha256', secret()).update(`connect-pick:v1:${body}`).digest('base64url');
export function pickToken(who: Who, now: Date): string | null {
  if (!secret()) return null;
  const body = Buffer.from(JSON.stringify({ ...who, exp: now.getTime() + PICK_TTL_MS })).toString('base64url');
  return `${body}.${mac(body)}`;
}
function readToken(t: string, now: Date): Who | null {
  const [body, sig] = t.split('.');
  if (!body || !sig || !secret()) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString()) as Who & { exp: number };
    return v.exp > now.getTime() && Number.isSafeInteger(v.builderId) && Number.isSafeInteger(v.githubInstallationId) ? v : null;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The picker: a radio list of repo full names and one button. Pure. */
export function pickerPage(repos: string[], token: string, csrf: string): Response {
  const rows = repos.map((r, i) => `<li><label><input type="radio" name="repo" value="${esc(r)}"${i === 0 ? ' checked' : ''}> ${esc(r)}</label></li>`).join('');
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>EarnKit</title></head>' +
    '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
    `<p>${esc(CONNECT_PAGE.lead)}</p><form method="post" action="${esc(siteUrl())}/github/verify/app/pick"><ul style="list-style:none;padding:0">${rows}</ul>` +
    `<input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="csrf" value="${esc(csrf)}">` +
    `<button type="submit">${esc(CONNECT_PAGE.button)}</button></form></body></html>`;
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', ...cookieHeaders(setCsrf(token, csrf)) },
  });
}

/** appSetup's connect branch (the nonce is already used; `row.login` is the OAuth hop's). */
export async function connectSetup(row: NonceRow, nonce: string, installationId: number, now: Date, deps: AppDeps = {}): Promise<Response> {
  const clear = cookieHeaders(clearCsrf(nonce));
  try {
    const who: Who = {
      builderId: row.installation_id, githubInstallationId: installationId, login: row.login!,
      createdAt: new Date(row.account_created_at!).toISOString(), publicRepos: row.public_repos ?? 0,
    };
    const repos = await ownedRepos(installationId, who.login, deps);
    if (repos.length === 0) return verifyPage(CONNECT_PAGE.none, 403, clear);
    if (repos.length === 1) return await finish(who, repos[0], now, clear);
    const token = pickToken(who, now);
    if (!token) return verifyPage(VERIFY_PAGE.failed, 502, clear);
    return pickerPage(repos, token, randomBytes(32).toString('base64url'));
  } catch (err) {
    console.error('[github-connect] setup', err instanceof Error ? err.name : 'error');
    return verifyPage(VERIFY_PAGE.failed, 502, clear);
  }
}

/** POST /github/verify/app/pick: Origin, this browser's csrf, the signed token; the repo must still be listed. */
export async function pickPost(request: Request, deps: AppDeps & RouteDeps = {}): Promise<Response> {
  if (!githubVerifyEnabled()) return new Response('Not found', { status: 404 });
  const busy = await limited(request, deps);
  if (busy) return busy;
  if (request.headers.get('origin') !== new URL(siteUrl()).origin) return verifyPage(VERIFY_PAGE.failed, 403);
  const form = await request.formData().catch(() => null);
  const t = String(form?.get('t') ?? '');
  const csrf = String(form?.get('csrf') ?? '');
  const cookie = t ? cookieValue(request, csrfCookieName(t)) : null;
  const a = Buffer.from(cookie ?? '');
  const b = Buffer.from(csrf);
  if (!cookie || a.length !== b.length || !timingSafeEqual(a, b)) return verifyPage(VERIFY_PAGE.failed, 403);
  const now = deps.now ?? new Date();
  const who = readToken(t, now);
  const clear = cookieHeaders(clearCsrf(t));
  if (!who) return verifyPage(VERIFY_PAGE.expired, 410, clear);
  const repo = String(form?.get('repo') ?? '').toLowerCase();
  try {
    if (!(await ownedRepos(who.githubInstallationId, who.login, deps)).includes(repo)) return verifyPage(CONNECT_PAGE.badChoice, 403, clear);
    return await finish(who, repo, now, clear);
  } catch (err) {
    console.error('[github-connect] pick', err instanceof Error ? err.name : 'error');
    return verifyPage(VERIFY_PAGE.failed, 502, clear);
  }
}
