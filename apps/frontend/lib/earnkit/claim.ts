import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { builderScoreEnabled, xSignInEnabled } from './builder-score-flag';
import { sql } from './db';
import { enqueueDiscovery } from './discovery';
import { siteUrl } from './entry-text';
import { noteEvent } from './events';
import { cookieValue, createVerifyLink, githubVerifyEnabled } from './github-verify';
import { joinOnProvenTie, rootOf } from './identity';
import { sharedGroup } from './installations';
import { profileChanged } from './profile-cache';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { pageUrl } from './reserved-routes';
import { upgradeToken } from './wallet-proof';
import { pkcePair, xAuthorizeUrl, xOAuth, type XOAuthDeps, type XUser } from './x-oauth';

/**
 * v2.12.1 spec "Identity", owner ruling "The page link is the X sign-in": the reply's claim link
 * (earnkit.com/claim/<code>) opens a page that says what becomes public and how to hide it, then
 * one button to Sign in with X. The flow follows github-verify.ts (verifyStart, verifyConfirm,
 * verifyCallback) line by line:
 * - GET shows the page and sets a per-code `__Host-ekx-` cookie (HttpOnly, Secure, SameSite=Lax,
 *   15 minutes) holding a random csrf; the button POSTs it back.
 * - POST checks Origin and that the form csrf is this browser's cookie, then stores the state (only
 *   its hash) with the PKCE verifier, the person, the claim code's hash and the csrf's hash, for 15
 *   minutes, and 303s to X. The state is 32 random bytes.
 * - The callback reads only `code` and `state` and the cookie. It deletes the state row (one use)
 *   only when this browser holds the cookie it was made for, so a forwarded X sign-in finishes
 *   nowhere; nothing reaches X before that. X's token is used for one read of /2/users/me and never
 *   stored or logged. Every link and redirect comes from siteUrl(), never the request.
 * - The claim is a proven tie (T5): an X account another person already holds is never merged at
 *   once; both groups' agents are asked (identity.ts joinOnProvenTie).
 * Flag off: every route is a 404. X unset: no claim link anywhere, and the page says sign-in is not
 * open yet.
 */
export const CLAIM_TEXT = {
  lead: 'Claim your EarnKit page with X.',
  public: 'Your page shows your X name and picture, what you shipped, how many people use it, money it earned when EarnKit can see it, and programs you entered or won.',
  hide: 'To hide it later, tell your agent "hide my page".',
  warning: 'This links your X account to the page your agent made. Only continue if you started this from your own agent.',
  button: 'Continue with X',
  notOpen: 'Sign-in with X is not open yet. Your agent will share the link again when it is.',
  used: 'This page is already claimed.',
  claimedOther: 'This page is already claimed by another X account.',
  joinPending: 'This X account already has an EarnKit page. Your agents will each ask you once to add this agent to it.',
  failed: "Sign-in didn't finish. Open the link from your agent again.",
  busy: 'Too many sign-ins from here. Try again in an hour.',
  done: (handle: string) => `Your page is live: ${pageUrl(handle)}`,
  /** v2.12.1 T7: the two optional upgrades under the done line (plain links, never a required step). */
  wallet: 'Show a wallet is yours (optional)',
  github: 'Sign in with GitHub (optional)',
} as const;

const STATE_TTL_MS = 15 * 60_000;
const CODE = /^[a-z2-7]{12}$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Plan S13: the same code for a person until the claim (12 base32 characters of an HMAC). Null without the secret. Pure. */
export function claimCode(builderId: number, secret = process.env.EARNKIT_AUTH_SECRET): string | null {
  if (!secret) return null;
  const mac = createHmac('sha256', secret).update(`claim:v1:${builderId}`).digest();
  return [...mac.subarray(0, 12)].map((b) => BASE32[b % 32]).join('');
}

/** The reply's claim link, or null: X off, a shared group, no profile, or claimed with a handle. Stores only the code's hash. */
export async function claimLink(builderId: number): Promise<string | null> {
  if (!builderScoreEnabled() || !xSignInEnabled() || (await sharedGroup(builderId))) return null;
  const [p] = await sql()<{ x_user_id: string | null; x_handle: string | null }[]>`
    SELECT x_user_id, x_handle FROM builder_profiles WHERE builder_id = ${builderId}`;
  // Claimed with a handle: no link. A stale holder (its handle moved to another X account, so bindX
  // cleared it) claims again to get its page back.
  if (!p || (p.x_user_id && p.x_handle)) return null;
  const code = claimCode(builderId);
  if (!code) return null;
  await sql()`INSERT INTO claim_codes (code_hash, builder_id) VALUES (${sha256(code)}, ${builderId}) ON CONFLICT (code_hash) DO NOTHING`;
  return `earnkit.com/claim/${code}`;
}

/**
 * The person a code names now, while they have no page (unclaimed, or a stale holder whose handle
 * moved on), or null. Claim codes follow a merge to the root (profiles.ts mergeProfiles re-keys
 * claim_codes), so a code made for a joined installation names the group's page.
 */
async function codeTarget(codeHash: string): Promise<number | null> {
  const [row] = await sql()<{ builder_id: number }[]>`
    SELECT c.builder_id FROM claim_codes c JOIN builder_profiles p ON p.builder_id = c.builder_id
    WHERE c.code_hash = ${codeHash} AND (p.x_user_id IS NULL OR p.x_handle IS NULL)`;
  if (!row || (await sharedGroup(row.builder_id))) return null;
  return row.builder_id;
}

// ---- The pages (no script, nothing cached), as github-verify.ts verifyPage.

/** Text and double-quoted attribute values; an apostrophe is safe in both. Pure. */
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const shell = (body: string) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>EarnKit</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
  `${body}</body></html>`;
function claimPage(line: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(shell(`<p>${escapeHtml(line)}</p>`), { status, headers: { ...PAGE_HEADERS, ...headers } });
}
const notFound = () => new Response('Not found', { status: 404 });

/**
 * v2.12.1 T7: the done page. Under the done line, two plain optional links: sign a message with a
 * wallet (/claim/wallet, a 30-minute token for this person) and, while GitHub sign-in is on, Sign in
 * with GitHub (a `claim` link: the login only, through the T5 proven-tie rules). A link that can't be
 * made is left out; the claim itself is already done.
 */
async function donePage(handle: string, root: number, headers: Record<string, string>): Promise<Response> {
  const links: string[] = [];
  const t = upgradeToken(root, new Date());
  if (t) links.push(`<a href="${escapeHtml(`${siteUrl()}/claim/wallet?t=${encodeURIComponent(t)}`)}">${escapeHtml(CLAIM_TEXT.wallet)}</a>`);
  if (githubVerifyEnabled()) {
    const gh = await createVerifyLink({ installationId: root, projectId: null, repoKey: `claim/${root}`, purpose: 'claim' }).catch((err: unknown) => {
      console.error('[claim] github link', err instanceof Error ? err.name : 'error');
      return null;
    });
    if (gh) links.push(`<a href="${escapeHtml(gh)}">${escapeHtml(CLAIM_TEXT.github)}</a>`);
  }
  const body = shell(`<p>${escapeHtml(CLAIM_TEXT.done(handle))}</p>${links.map((l) => `<p>${l}</p>`).join('')}`);
  return new Response(body, { status: 200, headers: { ...PAGE_HEADERS, ...headers } });
}

/** One cookie per claim code (named from the code's hash), so two open claims don't clash. Pure. */
const cookieName = (codeHash: string) => `__Host-ekx-${codeHash.slice(0, 16)}`;
const setCookie = (codeHash: string, csrf: string) =>
  `${cookieName(codeHash)}=${csrf}; Path=/; Max-Age=${STATE_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
const clearCookie = (codeHash: string) => `${cookieName(codeHash)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
/** Every `__Host-ekx-` cookie value this browser sent. */
function claimCookies(request: Request): string[] {
  const out: string[] = [];
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    const value = v.join('=');
    if (k.startsWith('__Host-ekx-') && /^[A-Za-z0-9_-]{43}$/.test(value)) out.push(value);
  }
  return out.slice(0, 10);
}
const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

type RouteDeps = { limit?: (request: Request) => Promise<unknown> };
const ipLimit = (request: Request) => enforce('xClaim', clientIp(request.headers), CLAIM_TEXT.busy);
async function limited(request: Request, deps: RouteDeps): Promise<Response | null> {
  try {
    await (deps.limit ?? ipLimit)(request);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return claimPage(CLAIM_TEXT.busy, 429);
    throw err;
  }
}

/** GET /claim/<code>: what becomes public, how to hide it, the warning, then one POST button (sets this code's cookie). */
export async function claimGet(_request: Request, code: string): Promise<Response> {
  if (!builderScoreEnabled() || !CODE.test(code)) return notFound();
  if (!xSignInEnabled()) return claimPage(CLAIM_TEXT.notOpen, 200);
  const codeHash = sha256(code);
  if (!(await codeTarget(codeHash))) return claimPage(CLAIM_TEXT.used, 410);
  const csrf = randomBytes(32).toString('base64url');
  const body = shell(
    [CLAIM_TEXT.lead, CLAIM_TEXT.public, CLAIM_TEXT.hide, CLAIM_TEXT.warning].map((l) => `<p>${escapeHtml(l)}</p>`).join('') +
      `<form method="post" action="${escapeHtml(siteUrl())}/claim/${code}">` +
      `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">` +
      `<button type="submit">${escapeHtml(CLAIM_TEXT.button)}</button></form>`,
  );
  // Same-origin, never no-referrer, so the button's POST carries a real Origin (as verifyStart).
  return new Response(body, { status: 200, headers: { ...PAGE_HEADERS, 'Referrer-Policy': 'same-origin', 'Set-Cookie': setCookie(codeHash, csrf) } });
}

/** POST /claim/<code> (the button): Origin and this browser's csrf, an unclaimed person, then 303 to X with PKCE. */
export async function claimPost(request: Request, code: string, deps: RouteDeps = {}): Promise<Response> {
  if (!builderScoreEnabled()) return notFound();
  if (!xSignInEnabled()) return claimPage(CLAIM_TEXT.notOpen, 503);
  const busy = await limited(request, deps);
  if (busy) return busy;
  if (!CODE.test(code)) return notFound();
  // The page sends Referrer-Policy same-origin, so a real button press always carries Origin.
  if (request.headers.get('origin') !== new URL(siteUrl()).origin) return claimPage(CLAIM_TEXT.failed, 403);
  const codeHash = sha256(code);
  const form = await request.formData().catch(() => null);
  const csrf = String(form?.get('csrf') ?? '');
  const cookie = cookieValue(request, cookieName(codeHash));
  if (!cookie || !sameSecret(cookie, csrf)) return claimPage(CLAIM_TEXT.failed, 403);
  const builderId = await codeTarget(codeHash);
  if (!builderId) return claimPage(CLAIM_TEXT.used, 410, { 'Set-Cookie': clearCookie(codeHash) });
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(32).toString('base64url');
  await sql()`DELETE FROM x_oauth_states WHERE expires_at < now()`;
  await sql()`
    INSERT INTO x_oauth_states (state_hash, builder_id, code_verifier, csrf_hash, code_hash, expires_at)
    VALUES (${sha256(state)}, ${builderId}, ${verifier}, ${sha256(csrf)}, ${codeHash}, ${new Date(Date.now() + STATE_TTL_MS)})`;
  return new Response(null, {
    status: 303,
    headers: { Location: xAuthorizeUrl({ state, challenge }), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

/**
 * GET /x/callback?code&state: the state is used once, and only in the browser holding the cookie it
 * was made for (else a 403 before any X call). X down: a 502, nothing bound, the claim link still
 * works. Then bindX: done (200), already claimed by another X account (409), or a pending join (200).
 */
export async function xCallback(request: Request, deps: RouteDeps & { x?: XOAuthDeps } = {}): Promise<Response> {
  if (!builderScoreEnabled()) return notFound();
  if (!xSignInEnabled()) return claimPage(CLAIM_TEXT.notOpen, 503);
  const busy = await limited(request, deps);
  if (busy) return busy;
  const q = new URL(request.url).searchParams;
  const state = q.get('state') ?? '';
  const code = q.get('code') ?? '';
  const cookies = claimCookies(request);
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || cookies.length === 0) return claimPage(CLAIM_TEXT.failed, 403);
  const [row] = await sql()<{ builder_id: number; code_verifier: string; code_hash: string | null }[]>`
    DELETE FROM x_oauth_states
    WHERE state_hash = ${sha256(state)} AND expires_at > now() AND csrf_hash IN ${sql()(cookies.map(sha256))}
    RETURNING builder_id, code_verifier, code_hash`;
  if (!row?.code_hash) return claimPage(CLAIM_TEXT.failed, 403);
  const clear = { 'Set-Cookie': clearCookie(row.code_hash) };
  if (!code || code.length > 1000) return claimPage(CLAIM_TEXT.failed, 400, clear);
  // Bound to its claim code: the code must still name this person (or the group it joined since).
  const target = await codeTarget(row.code_hash);
  if (!target) return claimPage(CLAIM_TEXT.used, 410, clear);
  if ((await rootOf(target)) !== (await rootOf(row.builder_id))) return claimPage(CLAIM_TEXT.failed, 403, clear);
  const x = deps.x ?? xOAuth;
  let user: XUser;
  try {
    user = await x.me(await x.exchange(code, row.code_verifier));
  } catch (err) {
    console.error('[x/callback] X', err instanceof Error ? err.name : 'error');
    return claimPage(CLAIM_TEXT.failed, 502, clear);
  }
  let r: BindResult;
  try {
    r = await bindX(target, user, new Date());
  } catch (err) {
    console.error('[x/callback] bind', err instanceof Error ? err.name : 'error');
    return claimPage(CLAIM_TEXT.failed, 500, clear);
  }
  if (r.ok) return donePage(r.handle, r.root, clear);
  if (r.reason === 'join_pending') return claimPage(CLAIM_TEXT.joinPending, 200, clear);
  return claimPage(CLAIM_TEXT.claimedOther, 409, clear);
}

export type BindResult = { ok: true; handle: string; root: number } | { ok: false; reason: 'claimed_by_other' | 'join_pending' };

/**
 * The X claim on `builderId`'s person (its group root). One X account per person, one person per X
 * account: a person claimed with another X account is refused ('claimed_by_other'); an X account
 * another person already holds is a proven tie (T5 ruling): nothing is bound and both groups' agents
 * are asked once (joinOnProvenTie), never a direct merge ('join_pending'). Else the X id, handle,
 * name and picture are written; the page moves to the handle, the old handle (a rename) redirects
 * for HANDLE_REDIRECT_DAYS, and the old slug follows the person.
 */
export async function bindX(builderId: number, user: XUser, now: Date): Promise<BindResult> {
  const root = await rootOf(builderId);
  const h = user.username.toLowerCase();
  const out = await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`x_user:${user.id}`}))`;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`x_handle:${h}`}))`;
    const [p] = await tx<{ x_user_id: string | null; x_handle: string | null; slug: string }[]>`
      SELECT x_user_id, x_handle, slug FROM builder_profiles WHERE builder_id = ${root} FOR UPDATE`;
    if (!p) throw new Error('no profile');
    if (p.x_user_id && p.x_user_id !== user.id) return { ok: false as const, reason: 'claimed_by_other' as const };
    const [held] = await tx`SELECT 1 FROM builder_profiles WHERE x_user_id = ${user.id} AND builder_id <> ${root}`;
    if (held) return { ok: false as const, reason: 'join_pending' as const };
    // Review Focus 2: X says this handle is this account's now. A stale holder is cleared (hidden
    // until they sign in again); no history row may send this handle anywhere else; an unclaimed
    // v2.12 profile whose internal slug equals it moves to a random one.
    await tx`UPDATE builder_profiles SET x_handle = NULL, slug = 'b-' || substr(md5(random()::text), 1, 8), updated_at = now()
      WHERE builder_id <> ${root} AND (lower(x_handle) = ${h} OR slug = ${h})`;
    await tx`DELETE FROM profile_slug_history WHERE old_slug = ${h}`;
    const renamed = p.x_user_id !== null && p.x_handle !== null && p.x_handle.toLowerCase() !== h;
    if (renamed)
      await tx`
        INSERT INTO profile_slug_history (old_slug, builder_id, moved_at, handle_rename) VALUES (${p.x_handle!.toLowerCase()}, ${root}, ${now}, true)
        ON CONFLICT (old_slug) DO UPDATE SET builder_id = EXCLUDED.builder_id, moved_at = EXCLUDED.moved_at, handle_rename = true`;
    // slug's CHECK wants a leading letter or digit; an X handle may start with '_' (then the old slug stays).
    const slug = /^[a-z0-9]/.test(h) ? h : p.slug;
    if (slug !== p.slug)
      await tx`INSERT INTO profile_slug_history (old_slug, builder_id, moved_at) VALUES (${p.slug}, ${root}, ${now}) ON CONFLICT (old_slug) DO NOTHING`;
    await tx`
      UPDATE builder_profiles SET x_user_id = ${user.id}, x_handle = ${user.username}, x_name = ${user.name}, x_avatar_url = ${user.avatar},
        claimed_at = COALESCE(claimed_at, ${now}), slug = ${slug}, updated_at = now()
      WHERE builder_id = ${root}`;
    await tx`DELETE FROM claim_codes WHERE builder_id = ${root}`;
    await tx`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${root}`;
    return { ok: true as const, handle: user.username, renamed, first: p.x_user_id === null };
  });
  if (!out.ok) {
    // The proven tie (T5): the holding group and this one each say yes before they are one person.
    if (out.reason === 'join_pending') await joinOnProvenTie(root, { x_user_id: user.id });
    return out;
  }
  const type = out.first ? 'page_claimed' : out.renamed ? 'x_renamed' : null;
  if (type) await noteEvent(type, () => ({ type, dedupe_key: `${type}:${root}:${h}`, installation_id: root }));
  await enqueueDiscovery(root, 'signin'); // T7: the X field match is checked on the next read
  profileChanged();
  return { ok: true, handle: out.handle, root };
}
