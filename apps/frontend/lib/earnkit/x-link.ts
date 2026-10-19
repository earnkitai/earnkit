import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { xSignInEnabled } from './builder-score-flag';
import { X_ICON, brandShell } from './brand-page';
import { sql } from './db';
import { siteUrl } from './entry-text';
import { noteEvent } from './events';
import { sharedGroup } from './installations';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { SIGNIN_TEXT, attachToX, newSignin, signinPage } from './x-install';
import type { XUser } from './x-oauth';

/**
 * v2.14 spec 1 (the fallback) and A6: a one-time "Sign in with X" link for an installation that isn't bound
 * (a client that can't sign in at install, or one from before v2.14). The link alone never binds: after X the
 * page shows a paste code, and only the installation that minted the link, sending it back through find within
 * PASTE_TTL_MS, is bound (attachToX, as an X-signed token: the installation alone, never its old group).
 * Only hashes are looked up; the link code is HMAC(EARNKIT_AUTH_SECRET, seed), so the database alone can't
 * rebuild it, and the paste code is kept only as its sha256.
 * S2: the code page warns that whoever holds the code acts as the page, and names the agent only as it
 * calls itself (its DCR client_name, chosen by the client).
 */
export const LINK_TTL_MS = 24 * 60 * 60_000;
export const LINK_REUSE_MIN_MS = 60 * 60_000;
export const PASTE_TTL_MS = 15 * 60_000;
export const LINK_TEXT = {
  lead: 'Sign in to EarnKit with X',
  agent: (name: string | null, ago: string) =>
    name ? `This link is for an agent that calls itself "${name}", connected ${ago}.` : `This link is for an agent connected ${ago}.`,
  warning: 'Only continue if your own agent gave you this link.',
  done: (handle: string) => `Signed in as @${handle}.`,
  paste: (code: string) => `Paste this code to your agent: ${code}`,
  codeWarning: 'Anyone you give this code to can act as your EarnKit page. Paste it only into the agent you are using right now.',
  gone: 'This link is used or expired. Ask your agent for a new one.',
  busy: 'Too many sign-in links opened from here. Try again in an hour.',
} as const;
export const SIGN_IN_NOTES = {
  bound: "Signed in. Show show_to_builder as written. Don't show this note.",
  bad: "That sign-in code didn't work (it is used, expired or from another agent). Ask the builder to open the sign-in link again and paste the new code. Don't show this note.",
} as const;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const PASTE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 12 characters from a 31-letter alphabet (about 59 bits), from the CSPRNG (randomInt, unbiased). */
export const pasteCode = () => Array.from({ length: 12 }, () => PASTE_ALPHABET[randomInt(PASTE_ALPHABET.length)]).join('');
export const formatPaste = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
export function normalizePaste(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/.test(c) ? c : null;
}

/** "just now", "3 minutes ago", "2 hours ago", "4 days ago" (moved from claim.ts). Pure. */
export function agoText(at: Date, now: Date = new Date()): string {
  const m = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (m < 1) return 'just now';
  const [n, unit] = m < 60 ? [m, 'minute'] : m < 48 * 60 ? [Math.floor(m / 60), 'hour'] : [Math.floor(m / 1440), 'day'];
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** The installation's sign-in link: null when X is off, it serves many (a shared group) or it is already bound. */
export async function signInLink(own: number, now: Date): Promise<string | null> {
  const secret = process.env.EARNKIT_AUTH_SECRET;
  if (!secret || !xSignInEnabled() || (await sharedGroup(own))) return null;
  const [i] = await sql()<{ x: string | null; shared: boolean }[]>`SELECT x_user_id AS x, shared_client AS shared FROM installations WHERE id = ${own}`;
  if (!i || i.x || i.shared) return null;
  // As github-verify.ts createVerifyLink: the code is HMAC(secret, seed), so an open link (unused, no sign-in on
  // it yet, an hour or more left) is shown again while the database never holds a usable code.
  const codeOf = (seed: string) => createHmac('sha256', secret).update(`signin:v1:${seed}`).digest().subarray(0, 16).toString('base64url');
  const [open] = await sql()<{ seed: string }[]>`
    SELECT seed FROM x_signin_links WHERE installation_id = ${own} AND used_at IS NULL AND x_user_id IS NULL AND seed IS NOT NULL
      AND expires_at > ${new Date(now.getTime() + LINK_REUSE_MIN_MS)} ORDER BY created_at DESC LIMIT 1`;
  if (open) return `${siteUrl()}/signin/${codeOf(open.seed)}`;
  // Expired one-use rows only (allowed by the Global Constraints, as OAuth states today).
  await sql()`DELETE FROM x_signin_links WHERE expires_at < now() - interval '1 day'`;
  const seed = randomBytes(16).toString('base64url');
  const code = codeOf(seed);
  await sql()`
    INSERT INTO x_signin_links (link_hash, seed, installation_id, created_at, expires_at)
    VALUES (${sha256(code)}, ${seed}, ${own}, ${now}, ${new Date(now.getTime() + LINK_TTL_MS)})`;
  return `${siteUrl()}/signin/${code}`;
}

const linkLimit = (request: Request) => enforce('signinLink', clientIp(request.headers), LINK_TEXT.busy);

/**
 * GET /signin/<code>: an open link shows the agent, the warning and one Continue with X (the state bound to this
 * browser). Rate-limited per IP before any read or write (fix round 1: each view writes an x_signins row).
 */
export async function signinGet(request: Request, code: string, deps: { limit?: (request: Request) => Promise<unknown> } = {}): Promise<Response> {
  try {
    await (deps.limit ?? linkLimit)(request);
  } catch (err) {
    if (err instanceof RateLimitError) return signinPage(LINK_TEXT.busy, 429);
    throw err;
  }
  if (!xSignInEnabled()) return signinPage(SIGNIN_TEXT.notOpen, 200);
  if (!/^[A-Za-z0-9_-]{22}$/.test(code)) return signinPage(LINK_TEXT.gone, 410);
  const [row] = await sql()<{ installation_id: number; name: string | null; at: Date }[]>`
    SELECT l.installation_id, i.client_name AS name, i.created_at AS at FROM x_signin_links l JOIN installations i ON i.id = l.installation_id
    WHERE l.link_hash = ${sha256(code)} AND l.used_at IS NULL AND l.x_user_id IS NULL AND l.expires_at > now()
      AND i.x_user_id IS NULL AND NOT i.shared_client`;
  if (!row) return signinPage(LINK_TEXT.gone, 410);
  const { to, cookie } = await newSignin({ purpose: 'link', installationId: row.installation_id, linkHash: sha256(code) });
  const body = brandShell(
    `<h1>${escapeHtml(LINK_TEXT.lead)}</h1><p class="ek-line">${escapeHtml(LINK_TEXT.agent(row.name, agoText(row.at)))}</p>` +
      `<p class="ek-small">${escapeHtml(LINK_TEXT.warning)}</p>` +
      `<div class="ek-actions"><a class="ek-btn" href="${escapeHtml(to)}">${X_ICON}<span>${escapeHtml(SIGNIN_TEXT.button)}</span></a></div>`,
  );
  return new Response(body, { status: 200, headers: { ...PAGE_HEADERS, 'Set-Cookie': cookie } });
}

/** The callback's link branch: the X user and a paste code's hash are kept on the link this browser opened (15 minutes); nothing is bound. */
export async function linkSignedIn(installationId: number, user: XUser, headers: Record<string, string>, now: Date, linkHash: string): Promise<Response> {
  const code = pasteCode();
  const [row] = await sql()<{ link_hash: string }[]>`
    UPDATE x_signin_links SET x_user_id = ${user.id}, x_handle = ${user.username}, x_name = ${user.name}, x_avatar_url = ${user.avatar},
      paste_hash = ${sha256(code)}, paste_expires_at = ${new Date(now.getTime() + PASTE_TTL_MS)}
    WHERE link_hash = ${linkHash} AND installation_id = ${installationId} AND used_at IS NULL AND x_user_id IS NULL AND expires_at > ${now}
    RETURNING link_hash`;
  if (!row) return signinPage(LINK_TEXT.gone, 410, headers);
  const body = brandShell(
    `<h1>${escapeHtml(LINK_TEXT.done(user.username))}</h1><p class="ek-line">${escapeHtml(LINK_TEXT.paste(formatPaste(code)))}</p>` +
      `<p class="ek-small">${escapeHtml(LINK_TEXT.codeWarning)}</p>`,
  );
  return new Response(body, { status: 200, headers: { ...PAGE_HEADERS, ...headers } });
}

/**
 * find { sign_in_code }: used once (the UPDATE ... used_at IS NULL ... RETURNING claims it), by the installation
 * that minted the link, within PASTE_TTL_MS; then attachToX. The lookup is by the code's sha256 (an indexed
 * equality on a hash, so no timing leak of the code itself). A refused attach uses the code up; a thrown error
 * (a transient failure) gives it back. Fix round 1 (6): the same code again from the same installation, once it is
 * bound to that code's X, is ok (a retry after a failed reply), and binds nothing new.
 */
export async function bindFromPaste(own: number, raw: unknown, now: Date): Promise<{ ok: true; root: number; handle: string } | { ok: false }> {
  const code = normalizePaste(raw);
  if (!code) return { ok: false };
  const h = sha256(code);
  const [row] = await sql()<{ link_hash: string; x_user_id: string; x_handle: string; x_name: string | null; x_avatar_url: string | null }[]>`
    UPDATE x_signin_links SET used_at = ${now}
    WHERE paste_hash = ${h} AND installation_id = ${own} AND used_at IS NULL AND paste_expires_at > ${now}
      AND x_user_id IS NOT NULL
    RETURNING link_hash, x_user_id, x_handle, x_name, x_avatar_url`;
  if (!row) {
    const [again] = await sql()<{ root: number; handle: string }[]>`
      SELECT p.builder_id AS root, p.x_handle AS handle FROM x_signin_links l
        JOIN installations i ON i.id = l.installation_id AND i.x_user_id = l.x_user_id
        JOIN builder_profiles p ON p.x_user_id = l.x_user_id AND p.x_handle IS NOT NULL
      WHERE l.paste_hash = ${h} AND l.installation_id = ${own} AND l.used_at IS NOT NULL AND l.paste_expires_at > ${now}`;
    return again ? { ok: true, root: again.root, handle: again.handle } : { ok: false };
  }
  const user: XUser = { id: row.x_user_id, username: row.x_handle, name: row.x_name ?? row.x_handle, avatar: row.x_avatar_url };
  let r: Awaited<ReturnType<typeof attachToX>>;
  try {
    r = await attachToX(own, user, now);
  } catch (err) {
    // Fix round 2 (C): only the attach transaction throws here (attachToX logs its after-commit steps and returns
    // ok), so the bind did not happen: the code is given back.
    await sql()`UPDATE x_signin_links SET used_at = NULL WHERE link_hash = ${row.link_hash} AND used_at = ${now}`.catch(() => undefined);
    throw err;
  }
  if (!r.ok) return { ok: false };
  // S2: a page bound by a pasted code is logged (the installation, the page; never the code). noteEvent never throws.
  await noteEvent('signed_in_by_code', () => ({ type: 'signed_in_by_code', dedupe_key: `signed_in_by_code:${own}:${r.root}`, installation_id: own, detail: { root: r.root } }));
  return { ok: true, root: r.root, handle: r.handle };
}
