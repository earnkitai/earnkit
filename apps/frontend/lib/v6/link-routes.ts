/**
 * The link from agent to builder: a one-time code the agent shows (/link/<code>) opens a confirm
 * page (app/link/[code]/page.tsx, in the site shell, from `linkState`); its button (POST /link/<code>/confirm) binds
 * this browser with a nonce cookie and goes to GitHub sign-in; the
 * callback checks the nonce, starts a session and lands on /me?link=<code>, where the signed-in
 * builder confirms the link (POST /me/link: consumeLinkCode) or refuses it (denyLinkCode). Rate
 * limited per IP; only the code's hash is stored; nothing logs a token, a code or a secret.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from '../v5/db';
import { OAuthError, type PendingAuthorize, issueCode, publicOrigin } from '../v5/oauth';
import { displayName } from '../v5/installations';
import { RateLimitError, clientIp, enforce } from '../v5/rate-limit';
import { LINK_ASK_PARTS, ME_ERRORS, ME_LINK_DENIED, ME_LINK_EXPIRED_TITLE, ME_LINK_USED, UNKNOWN_CODE } from '../v5/site-copy';
import { LinkRefused, linkInstallation, upsertBuilder } from './builders';
import { GitHubAuthError, type GitHubUser, authorizeUrl, exchangeCode, oauthConfigured, signInstallState, signState, verifyInstallState, verifyState } from './github-auth';
import { cookieOf, cookieValue, createSession, legacyClear } from './sessions';

const TTL_MS = 15 * 60_000;
const LINK_COOKIE = 'ek_link';
/** The install sign-in's nonce cookie (v6.1.21): `__Host-` in production, as the session cookie is. */
const installCookie = () => (process.env.NODE_ENV === 'production' ? '__Host-ek_install' : 'ek_install');
export const NOT_SET_UP = 'GitHub sign-in is not set up yet.';
/** One expired wording everywhere (L21-17, v6.1.16): /me's alert and the /link pages say the same. */
export const EXPIRED = ME_ERRORS.linkExpired;
export { UNKNOWN_CODE };
export const FAILED = 'Sign-in failed. Ask your agent for a new link.';
/** The /link page every refused POST and callback lands on (L27-4, v6.1.16): no code is 6 characters. */
export const FAILED_PATH = '/link/failed';
export const OTHER = 'This agent is already linked to another account. Install EarnKit again for a fresh link.';
/** A used code whose agent is linked to this builder: a second click on "Link this agent" (v6.1.7 N4). */
export const ALREADY_LINKED = 'This agent is linked.';
/** A code as createLinkCode makes it: 22 base64url characters of an HMAC. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{22}$/;
/** True for a code of the shape EarnKit makes (live or not). Pure. */
export const codeShaped = (code: string): boolean => CODE_SHAPE.test(code);

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** A 303 to a /link page, which renders the state in the site shell (L27-4, v6.1.16). */
const toPage = (path: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store', ...headers } });

function secret() {
  const s = process.env.EARNKIT_AUTH_SECRET;
  if (!s) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return s;
}

/** The code for a stored nonce: base64url(HMAC-SHA256(secret, 'link-code:' + nonce)), 22 characters. */
const codeOf = (nonce: string) => createHmac('sha256', secret()).update(`link-code:${nonce}`).digest('base64url').slice(0, 22);

/**
 * The installation's sign-in code (15 minutes): its live one when there is one, so a link already
 * shown keeps working; otherwise a new one (earlier live codes end). The row keeps the code's hash
 * and the nonce; the code needs the secret too. A row without a nonce counts as expired here.
 */
export async function createLinkCode(installationId: number, now: Date): Promise<string> {
  return sql().begin(async (tx) => {
    const [inst] = await tx<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${installationId} FOR UPDATE`;
    if (inst?.builder_id != null) throw new LinkRefused('already_linked');
    const [live] = await tx<{ nonce: string }[]>`
      SELECT nonce FROM link_codes WHERE installation_id = ${installationId} AND nonce IS NOT NULL AND used_at IS NULL AND expires_at > ${now}
      ORDER BY created_at DESC LIMIT 1`;
    if (live) return codeOf(live.nonce);
    const nonce = randomBytes(16).toString('base64url');
    const code = codeOf(nonce);
    await tx`UPDATE link_codes SET expires_at = ${now} WHERE installation_id = ${installationId} AND used_at IS NULL AND expires_at > ${now}`;
    await tx`INSERT INTO link_codes (code, installation_id, created_at, expires_at, nonce)
      VALUES (${hash(code)}, ${installationId}, ${now}, ${new Date(now.getTime() + TTL_MS)}, ${nonce})`;
    return code;
  }) as Promise<string>;
}

export type Live = { installation_id: number; client_name: string | null; created_at: Date; builder_id: number | null };
/**
 * What a code is (L21-6, L21-17, v6.1.16): `live` (unused, unexpired), `used`, `expired` (timed out, replaced or
 * denied), or `unknown` (not code-shaped, or a code EarnKit never made).
 */
export async function codeState(code: string, now: Date): Promise<'live' | 'used' | 'expired' | 'unknown'> {
  if (!CODE_SHAPE.test(code)) return 'unknown';
  const [r] = await sql()<{ used_at: Date | null; expires_at: Date }[]>`SELECT used_at, expires_at FROM link_codes WHERE code = ${hash(code)}`;
  if (!r) return 'unknown';
  if (r.used_at !== null) return 'used';
  return r.expires_at.getTime() > now.getTime() ? 'live' : 'expired';
}

/** The unused, unexpired code's installation (with the builder it is already linked to, if any), or null. */
export async function liveCode(code: string, now: Date): Promise<Live | null> {
  if (!CODE_SHAPE.test(code)) return null;
  const [r] = await sql()<Live[]>`
    SELECT l.installation_id, i.client_name, i.created_at, i.builder_id FROM link_codes l JOIN installations i ON i.id = l.installation_id
    WHERE l.code = ${hash(code)} AND l.used_at IS NULL AND l.expires_at > ${now}`;
  return r ?? null;
}

const limit = (headers: Headers) => enforce('linkGet', clientIp(headers), LIMITED_LINE);
const LIMITED_LINE = 'Too many sign-ins from this address.';

/** Runs a POST or the callback behind the setup check and the IP limit; a refusal goes to the failed page. */
async function guarded(request: Request, fn: () => Promise<Response>): Promise<Response> {
  if (!oauthConfigured()) return toPage(FAILED_PATH);
  try {
    await limit(request.headers);
  } catch (err) {
    if (err instanceof RateLimitError) return toPage(FAILED_PATH, { 'Retry-After': String(err.retryAfter) });
    throw err;
  }
  return fn();
}

const day = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);

export type LinkStateName = 'live' | 'used' | 'denied' | 'expired' | 'unknown' | 'failed' | 'limited' | 'not_set_up';
/**
 * What a /link page shows (L27-4, L27-26, v6.1.16): the state, its title (the page's one h1, full stop or `?` kept),
 * its line, the agent's shown name and first-seen day for the live confirm, and the HTTP status the state means (a page
 * answers 200: Next sets no other status from a page, see app/link/[code]/page.tsx).
 */
export type LinkState = { state: LinkStateName; title: string; line: string; agent?: string | null; seen?: string; status: number; retryAfter?: number };

/** The document title for a state: its title without a trailing full stop, then ` · EarnKit` (L27-4). Pure. */
export const linkDocTitle = (title: string): string => `${title.replace(/\.$/, '')} · EarnKit`;

/** A line without its leading title sentence ("This link has expired. Ask ..." under "This link has expired."). Pure. */
const after = (line: string, title: string) => (line.startsWith(title) ? line.slice(title.length).trim() : line);

/**
 * Each state but live, as data (pure): Task 7's texts, the title as the h1 and the rest as the line. L43-17 (v6.1.19):
 * one sentence per state, read by /link and /me?link alike: used is `Linked.` alone, not set up its title alone, a
 * code answered This is not me `Not linked.` then the next step.
 */
export const LINK_STATES = {
  used: { state: 'used', title: ME_LINK_USED, line: '', status: 404 },
  denied: { state: 'denied', title: 'Not linked.', line: after(ME_LINK_DENIED, 'Not linked.'), status: 404 },
  expired: { state: 'expired', title: ME_LINK_EXPIRED_TITLE, line: after(EXPIRED, ME_LINK_EXPIRED_TITLE), status: 404 },
  unknown: { state: 'unknown', title: UNKNOWN_CODE, line: 'Ask your agent for a new link.', status: 404 },
  failed: { state: 'failed', title: 'Sign-in failed.', line: after(FAILED, 'Sign-in failed.'), status: 400 },
  limited: { state: 'limited', title: 'Too many sign-ins.', line: `${LIMITED_LINE} Try again later.`, status: 429 },
  not_set_up: { state: 'not_set_up', title: 'Sign-in is not set up yet.', line: '', status: 503 },
} as const satisfies Record<Exclude<LinkStateName, 'live'>, LinkState>;

/**
 * The state of /link/<code> for this visitor (L27-4, v6.1.16): not set up, rate limited (one count per page view, by
 * `headers`' address), the failed page (`failed`, where refused posts and callbacks land), then Task 7's codeState:
 * live (the confirm, `Connect {agent}?`), used, expired or unknown.
 */
export async function linkState(code: string, now: Date, headers: Headers = new Headers()): Promise<LinkState> {
  if (!oauthConfigured()) return LINK_STATES.not_set_up;
  try {
    await limit(headers);
  } catch (err) {
    if (err instanceof RateLimitError) return { ...LINK_STATES.limited, line: err.message, retryAfter: err.retryAfter };
    throw err;
  }
  if (code === 'failed') return LINK_STATES.failed;
  const live = await liveCode(code, now);
  if (!live) {
    const dead = await codeState(code, now);
    if (dead === 'expired' && (await deniedCode(code))) return LINK_STATES.denied;
    return dead === 'used' ? LINK_STATES.used : dead === 'unknown' ? LINK_STATES.unknown : LINK_STATES.expired;
  }
  // L25-1 (v6.1.16): the shown name drops a trailing "(earnkit)"; L43-14 (v6.1.19): cut once at 60, as /me shows it.
  const name = displayName(live.client_name);
  return {
    state: 'live',
    // L43-17 (v6.1.19): one question, the agent named in it.
    title: LINK_ASK_PARTS(name).join(''),
    line: 'Once linked, it can read and change your record and apply to programs in your name.',
    agent: name,
    seen: day(live.created_at),
    status: 200,
  };
}

/**
 * POST /link/<code>/confirm (the confirm page's button): binds this browser (the ek_link nonce, in a cookie and the
 * signed state) and goes to GitHub. A post from another site goes to the failed page; a dead code back to its /link page.
 */
export function linkPost(request: Request, code: string, deps: { now?: Date } = {}): Promise<Response> {
  return guarded(request, async () => {
    const now = deps.now ?? new Date();
    const origin = publicOrigin(request);
    // The button is on our page; a form posted from another site is refused.
    const from = request.headers.get('origin');
    if (from && from !== origin) return toPage(FAILED_PATH);
    if (!codeShaped(code) || !(await liveCode(code, now))) return toPage(codeShaped(code) ? `/link/${code}` : FAILED_PATH);
    const nonce = randomBytes(16).toString('base64url');
    const state = signState({ code, nonce, exp: now.getTime() + TTL_MS }, secret());
    return new Response(null, {
      status: 302,
      headers: { Location: authorizeUrl(state, origin), 'Set-Cookie': cookieOf(LINK_COOKIE, nonce, TTL_MS / 1000), 'Cache-Control': 'no-store' },
    });
  });
}

/** Equal strings, in constant time. Pure. */
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/**
 * Single use: the code is marked used and its installation linked to the builder together, or neither.
 * 'dead' for an unknown, used or expired code; 'other' when the installation is linked to another builder.
 */
export async function consumeLinkCode(code: string, builderId: number, now: Date): Promise<'linked' | 'dead' | 'other'> {
  if (!CODE_SHAPE.test(code)) return 'dead';
  try {
    return (await sql().begin(async (tx) => {
      const [used] = await tx<{ installation_id: number }[]>`
        UPDATE link_codes SET used_at = ${now} WHERE code = ${hash(code)} AND used_at IS NULL AND expires_at > ${now} RETURNING installation_id`;
      if (!used) return 'dead';
      await linkInstallation(used.installation_id, builderId, now, tx);
      return 'linked';
    })) as 'linked' | 'dead';
  } catch (err) {
    if (err instanceof LinkRefused) return 'other';
    throw err;
  }
}

/** Whether the code was used and its installation is linked to this builder (a double click after the link, N4). */
export async function linkedBy(code: string, builderId: number): Promise<boolean> {
  if (!CODE_SHAPE.test(code)) return false;
  const rows = await sql()`
    SELECT 1 FROM link_codes l JOIN installations i ON i.id = l.installation_id
    WHERE l.code = ${hash(code)} AND l.used_at IS NOT NULL AND i.builder_id = ${builderId}`;
  return rows.length > 0;
}

/** Ends a live code now: the builder said it was not theirs. It expires at its own creation time, the mark that says
 *  it was denied, not timed out or replaced (Low 16, v6.1.13: `deniedCode`). */
export async function denyLinkCode(code: string, now: Date): Promise<void> {
  if (!CODE_SHAPE.test(code)) return;
  await sql()`UPDATE link_codes SET expires_at = created_at WHERE code = ${hash(code)} AND used_at IS NULL AND expires_at > ${now}`;
}

/** True for a code the builder answered Not me to (`denyLinkCode`). */
export async function deniedCode(code: string): Promise<boolean> {
  if (!CODE_SHAPE.test(code)) return false;
  return (await sql()`SELECT 1 FROM link_codes WHERE code = ${hash(code)} AND used_at IS NULL AND expires_at = created_at`).length > 0;
}

/**
 * C1 (v6.1.21): the install sign-in is disabled in this release. It has no EarnKit consent step, so a builder who had
 * authorized the GitHub app before could be linked to another person's client in one click. The code stays behind
 * this switch for a later release that adds a consent page; until then no build turns it on.
 */
export const INSTALL_SIGNIN_ENABLED = false as boolean;
export const INSTALL_SIGNIN_DISABLED = 'install sign-in is disabled in this release';
let warnedDisabled = false;

/**
 * Whether authorize asks for a GitHub sign-in first: EARNKIT_INSTALL_SIGNIN=github, the OAuth app set up, and the
 * release switch on (`enabled`, INSTALL_SIGNIN_ENABLED; tests of the dormant path pass true). With the switch off the
 * value is read, logged once, and authorize stays anonymous.
 */
export function installSignInOn(env: Record<string, string | undefined> = process.env, enabled: boolean = INSTALL_SIGNIN_ENABLED): boolean {
  const wanted = env.EARNKIT_INSTALL_SIGNIN === 'github';
  if (wanted && !enabled) {
    if (!warnedDisabled) console.warn(`[install] ${INSTALL_SIGNIN_DISABLED}`);
    warnedDisabled = true;
    return false;
  }
  return wanted && oauthConfigured(env);
}

/** M7 (v6.1.21): an install sign-in that did not finish; it says nothing about linking. No code is issued. */
export const INSTALL_FAILED = 'Connecting EarnKit failed: the GitHub sign-in did not finish. Ask your agent to connect EarnKit again.';
const installFailed = () =>
  new Response(INSTALL_FAILED, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookieOf(installCookie(), '', 0) } });

/** Authorize with sign-in on (v6.1.21, disabled: see INSTALL_SIGNIN_ENABLED): a nonce cookie, then GitHub with a signed state carrying the checked request. */
export function installSignIn(request: Request, req: PendingAuthorize, now: Date = new Date()): Response {
  const nonce = randomBytes(16).toString('base64url');
  const state = signInstallState({ req, nonce, exp: now.getTime() + TTL_MS }, secret());
  return new Response(null, {
    status: 302,
    headers: { Location: authorizeUrl(state, publicOrigin(request)), 'Set-Cookie': cookieOf(installCookie(), nonce, TTL_MS / 1000), 'Cache-Control': 'no-store' },
  });
}

/** The callback for an install state: GitHub's user becomes a builder, and the client gets a code that names them. */
async function installCallback(request: Request, ghCode: string | null, pending: { req: PendingAuthorize; nonce: string } | null, deps: { gh?: typeof fetch }): Promise<Response> {
  const nonce = cookieValue(request.headers.get('cookie'), installCookie());
  if (!pending || !nonce || !same(nonce, pending.nonce) || !ghCode) return installFailed();
  try {
    const user = await exchangeCode(ghCode, publicOrigin(request), process.env, deps.gh ?? fetch);
    const builder = await upsertBuilder(user, new Date());
    const back = await issueCode(pending.req, { builderId: builder.id }, publicOrigin(request));
    return new Response(null, { status: 302, headers: { Location: back.toString(), 'Set-Cookie': cookieOf(installCookie(), '', 0), 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof GitHubAuthError) console.warn(`[install] ${err.message}`);
    else if (!(err instanceof OAuthError)) throw err;
    return installFailed();
  }
}

/** GET /auth/github/callback: signs the GitHub user in and sends them to /me?link=<code> to confirm the link there. */
export function callbackGet(request: Request, deps: { now?: Date; gh?: typeof fetch; installSignIn?: boolean } = {}): Promise<Response> {
  return guarded(request, async () => {
    const now = deps.now ?? new Date();
    const q = new URL(request.url).searchParams;
    const linked = verifyState(q.get('state') ?? '', secret(), now);
    if (!linked) {
      const install = verifyInstallState(q.get('state') ?? '', secret(), now);
      if (!install) return toPage(FAILED_PATH);
      // C1/M7 (v6.1.21): with the switch off an install state (none is issued) never signs in or issues a code.
      if (!(deps.installSignIn ?? INSTALL_SIGNIN_ENABLED)) return installFailed();
      return installCallback(request, q.get('code'), install, deps);
    }
    const nonce = cookieValue(request.headers.get('cookie'), LINK_COOKIE);
    const ghCode = q.get('code');
    if (!nonce || !same(nonce, linked.nonce) || !ghCode) return toPage(FAILED_PATH);
    // The state proves the code was live at /link; here it only has to be unused.
    if ((await sql()`SELECT 1 FROM link_codes WHERE code = ${hash(linked.code)} AND used_at IS NULL AND expires_at > ${now}`).length === 0) return toPage(FAILED_PATH);
    let user: GitHubUser;
    try {
      user = await exchangeCode(ghCode, publicOrigin(request), process.env, deps.gh ?? fetch);
    } catch (err) {
      if (!(err instanceof GitHubAuthError)) throw err;
      console.warn(`[link] ${err.message}`);
      return toPage(FAILED_PATH);
    }
    const builder = await upsertBuilder(user, now);
    const { cookie } = await createSession(builder.id, now);
    // Nothing is linked here: a link someone else sent would otherwise bind their agent on one click.
    const headers = new Headers({ Location: `/me?link=${encodeURIComponent(linked.code)}`, 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', cookie);
    // L31-6 (v6.1.16 Task 17): the new __Host- cookie replaces any old ek_me.
    for (const c of legacyClear()) headers.append('Set-Cookie', c);
    headers.append('Set-Cookie', cookieOf(LINK_COOKIE, '', 0));
    return new Response(null, { status: 302, headers });
  });
}
