import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { xSignInEnabled } from './builder-score-flag';
import { X_ICON, brandShell } from './brand-page';
import { sql } from './db';
import { enqueueDiscovery } from './discovery';
import { noteEvent } from './events';
import { cookieValue } from './github-verify';
import { lockPerson, rootOf } from './identity';
import { issueCode, publicOrigin, type CheckedAuthorize, type PendingAuthorize } from './oauth';
import { profileChanged } from './profile-cache';
import { ensureProfile } from './profiles';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { pkcePair, xAuthorizeUrl, xOAuth, type XOAuthDeps, type XUser } from './x-oauth';

/**
 * v2.14 spec 1, "X is the account, at install". The authorize step stores the client's request (its PKCE
 * challenge and state stay with EarnKit) and sends the browser to X with EarnKit's own PKCE; the state is 32
 * random bytes, only its hash kept, bound to this browser by a __Host-eki- cookie (HttpOnly, Secure, Lax, 15
 * minutes) and used once. The callback reads /2/users/me once (X's token is never stored or logged) and sends
 * the client its code, which carries the X user in its signed payload; the token exchange binds it
 * (attachToX). A4 and the S6 ruling: a loopback redirect, a known agent app scheme (oauth.ts
 * AGENT_APP_SCHEMES) or one of the exact documented agent callbacks (AGENT_REDIRECT_URIS) go straight to X;
 * any other redirect first sees one page naming its host and showing the full redirect URI.
 */
export const SIGNIN_TEXT = {
  lead: 'Sign in to EarnKit',
  forHost: (host: string) => `You're connecting EarnKit to ${host}.`,
  /** S6 fix round 1: the full registered redirect, shown on every warning page. */
  sendsTo: (uri: string) => `After X, you go back to: ${uri}`,
  warning: 'Only continue if you started this from your own agent.',
  button: 'Continue with X',
  failed: "Sign-in didn't finish. Connect EarnKit from your agent again.",
  paused: "This X account can't sign in to EarnKit right now.",
  notOpen: 'Sign-in with X is not open yet.',
  busy: 'Too many sign-ins from here. Try again in an hour.',
} as const;
const STATE_TTL_MS = 15 * 60_000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
export const signinCookie = (stateHash: string) => `__Host-eki-${stateHash.slice(0, 16)}`;
const setCookie = (h: string, csrf: string) => `${signinCookie(h)}=${csrf}; Path=/; Max-Age=${STATE_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
const clearCookie = (h: string) => ({ 'Set-Cookie': `${signinCookie(h)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
export function signinPage(line: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(brandShell(`<p class="ek-line ek-first">${escapeHtml(line)}</p>`), { status, headers: { ...PAGE_HEADERS, ...headers } });
}

/** One pending sign-in row and its cookie; returns X's authorize URL and the Set-Cookie value. Exported for T5. */
export async function newSignin(
  row: { purpose: 'install'; oauth: PendingAuthorize } | { purpose: 'link' | 'wallet'; installationId: number; linkHash: string },
  now = new Date(),
) {
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  const h = sha256(state);
  // Expired one-use rows only (allowed by the Global Constraints, as OAuth states today).
  await sql()`DELETE FROM x_signins WHERE expires_at < now()`;
  await sql()`
    INSERT INTO x_signins (state_hash, purpose, oauth, installation_id, link_hash, code_verifier, csrf_hash, expires_at)
    VALUES (${h}, ${row.purpose}, ${row.purpose === 'install' ? sql().json(row.oauth as never) : null}, ${row.purpose !== 'install' ? row.installationId : null},
      ${row.purpose !== 'install' ? row.linkHash : null}, ${verifier}, ${sha256(csrf)}, ${new Date(now.getTime() + STATE_TTL_MS)})`;
  return { to: xAuthorizeUrl({ state, challenge }), cookie: setCookie(h, csrf) };
}

/** The authorize step with X on: the row and cookie, then X (straight, or after the page naming the host). */
export async function startInstallSignIn(c: CheckedAuthorize, now = new Date()): Promise<Response> {
  const { to, cookie } = await newSignin({ purpose: 'install', oauth: c.req }, now);
  if (c.redirectClass !== 'other')
    return new Response(null, { status: 302, headers: { Location: to, 'Set-Cookie': cookie, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  const body = brandShell(
    `<h1>${escapeHtml(SIGNIN_TEXT.lead)}</h1><p class="ek-line">${escapeHtml(SIGNIN_TEXT.forHost(c.host ?? 'an app'))}</p>` +
      `<p class="ek-small" style="overflow-wrap:anywhere">${escapeHtml(SIGNIN_TEXT.sendsTo(c.req.redirect_uri))}</p>` +
      `<p class="ek-small">${escapeHtml(SIGNIN_TEXT.warning)}</p>` +
      `<div class="ek-actions"><a class="ek-btn" href="${escapeHtml(to)}">${X_ICON}<span>${escapeHtml(SIGNIN_TEXT.button)}</span></a></div>`,
  );
  return new Response(body, { status: 200, headers: { ...PAGE_HEADERS, 'Set-Cookie': cookie } });
}

type SigninRow = { purpose: 'install' | 'link' | 'wallet'; oauth: PendingAuthorize | null; installation_id: number | null; link_hash: string | null; code_verifier: string };
type CallbackDeps = { x?: XOAuthDeps; limit?: (request: Request) => Promise<unknown> };
const limitOf = (request: Request) => enforce('xSignIn', clientIp(request.headers), SIGNIN_TEXT.busy);

/**
 * GET /x/callback for a v2.14 sign-in. Null when the state isn't one (the route answers 404).
 * This browser's cookie must match the row (else 403, before any X call, and the row stays for its own
 * browser); the row is deleted on use. X down: 502, nothing issued.
 */
export async function xSignInCallback(request: Request, deps: CallbackDeps = {}): Promise<Response | null> {
  const q = new URL(request.url).searchParams;
  const state = q.get('state') ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
  const h = sha256(state);
  const [known] = await sql()`SELECT 1 FROM x_signins WHERE state_hash = ${h}`;
  if (!known) return null;
  if (!xSignInEnabled()) return signinPage(SIGNIN_TEXT.notOpen, 503);
  try {
    await (deps.limit ?? limitOf)(request);
  } catch (err) {
    if (err instanceof RateLimitError) return signinPage(SIGNIN_TEXT.busy, 429);
    throw err;
  }
  const csrf = cookieValue(request, signinCookie(h));
  if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) return signinPage(SIGNIN_TEXT.failed, 403);
  const [row] = await sql()<SigninRow[]>`
    DELETE FROM x_signins WHERE state_hash = ${h} AND csrf_hash = ${sha256(csrf)} AND expires_at > now()
    RETURNING purpose, oauth, installation_id, link_hash, code_verifier`;
  const clear = clearCookie(h);
  if (!row) return signinPage(SIGNIN_TEXT.failed, 403, clear);
  const code = q.get('code') ?? '';
  if (!code || code.length > 1000) return signinPage(SIGNIN_TEXT.failed, 400, clear);
  const x = deps.x ?? xOAuth;
  let user: XUser;
  try {
    user = await x.me(await x.exchange(code, row.code_verifier));
  } catch (err) {
    console.error('[x/callback] X', err instanceof Error ? err.name : 'error');
    return signinPage(SIGNIN_TEXT.failed, 502, clear);
  }
  const [cleared] = await sql()`SELECT 1 FROM x_owner_clears WHERE x_user_id = ${user.id}`;
  if (cleared) return signinPage(SIGNIN_TEXT.paused, 403, clear);
  // v2.14 T5: the fallback link's sign-in shows a paste code; nothing is bound until the agent sends it back.
  if (row.purpose === 'link')
    return row.installation_id !== null && row.link_hash
      ? (await import('./x-link')).linkSignedIn(row.installation_id, user, clear, new Date(), row.link_hash)
      : signinPage(SIGNIN_TEXT.failed, 400, clear);
  // v3.1 wallet proof fix round: the wallet page's X sign-in (changing the reward wallet needs the same X account).
  if (row.purpose === 'wallet')
    return row.installation_id !== null && row.link_hash
      ? (await import('./wallet-proof')).walletXSignedIn(row.installation_id, row.link_hash, user, clear, request)
      : signinPage(SIGNIN_TEXT.failed, 400, clear);
  if (row.purpose !== 'install' || !row.oauth) return signinPage(SIGNIN_TEXT.failed, 400, clear);
  let to: URL;
  try {
    to = issueCode(row.oauth, user, publicOrigin(request));
  } catch (err) {
    console.error('[x/callback] code', err instanceof Error ? err.name : 'error');
    return signinPage(SIGNIN_TEXT.failed, 400, clear);
  }
  return new Response(null, { status: 302, headers: { Location: to.toString(), ...clear, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

export type AttachResult = { ok: true; root: number; handle: string; created: boolean } | { ok: false; reason: 'shared' | 'other_x' | 'owner_cleared' | 'claimed_by_other' };
type Refusal = Extract<AttachResult, { ok: false }>['reason'];

/** Rolls attachToX's transaction back with a refusal (bindX refused after the attach was written). */
class AttachRefused extends Error {
  constructor(public reason: Refusal) {
    super(reason);
  }
}

/**
 * v2.14 spec 1: binds installation `own` to X account `user` (A3), in ONE transaction (preflight S5):
 * the `x_attach:<id>`, `x_user:<id>` and `x_handle:<h>` locks, the installation row FOR UPDATE, the checks (never an
 * installation bound to another X account, never a shared group, never an X account the owner cleared),
 * then the person. `own` is always bound ALONE (the no-merge ruling, supersedes A7; T5 ruling):
 * - `own` a root with members, and not already this X's page: the members are detached first (builder_id
 *   NULL, each its own anonymous root; nothing deleted), so none of them becomes the person through `own`;
 * - the page that holds the X user id: `own` alone is attached to it (builder_id). Nothing of `own` (its
 *   data, its old group) is ever merged into the page; it stays behind. Only a fresh installation's own
 *   unclaimed profile row is removed (S10, owner-approved);
 * - else a page made from the X profile on `own` itself (a member of another root leaves it first:
 *   builder_id cleared; ensureProfile, then bindX's writes: handle, name, photo).
 * The X id is written on the installation LAST, and the transaction aborts unless that touches its row; a
 * bindX refusal rolls everything back, so the installation stays unbound. Idempotent.
 */
export async function attachToX(own: number, user: XUser, now: Date): Promise<AttachResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attachOnce(own, user, now);
    } catch (err) {
      // Fix round 2 (B): the group or the page moved between the unlocked read and the locks; read again.
      if (err instanceof StaleRead && attempt < 3) continue;
      throw err;
    }
  }
}

/** Thrown inside attachOnce's transaction when a root read before the locks changed under them. */
class StaleRead extends Error {}

/**
 * One attempt. Lock order (the global order, identity.ts lockPerson): the advisory locks `x_attach:<id>`, `x_user:<id>`,
 * `x_handle:<h>` (bindX's order), then `person:<root>` (lockPerson) for the installation's group root and the X's page
 * root, sorted, then `own` and its members' installation rows in id order (one statement), then the profile rows of
 * `own`, its root and the X's page in builder_id order (one statement).
 */
async function attachOnce(own: number, user: XUser, now: Date): Promise<AttachResult> {
  let done: { root: number; out: BoundX; created: boolean };
  try {
    done = await sql().begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`x_attach:${user.id}`}))`;
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`x_user:${user.id}`}))`;
      // bindX's handle lock before any row lock, in bindX's own order, so a concurrent bindX can't deadlock with it.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`x_handle:${user.username.toLowerCase()}`}))`;
      // The roots to lock, read before any row lock and checked again under the locks.
      const [pre] = await tx<{ mine: number; held: number | null }[]>`
        SELECT COALESCE(i.builder_id, i.id) AS mine, (SELECT p.builder_id FROM builder_profiles p WHERE p.x_user_id = ${user.id}) AS held
        FROM installations i WHERE i.id = ${own}`;
      if (!pre) throw new Error('no installation');
      for (const r of [...new Set([pre.mine, pre.held ?? pre.mine])].sort((a, b) => a - b))
        await lockPerson(tx, r);
      await tx`SELECT id FROM installations WHERE id = ${own} OR builder_id = ${own} ORDER BY id FOR UPDATE`;
      const [me] = await tx<{ builder_id: number | null; x: string | null }[]>`
        SELECT builder_id, x_user_id AS x FROM installations WHERE id = ${own}`;
      if (!me) throw new Error('no installation');
      if (me.x && me.x !== user.id) throw new AttachRefused('other_x');
      const mine = me.builder_id ?? own;
      // Fix rounds 1 and 2 (A): the profiles read under their row locks, checked in code. An installation whose own
      // or group root's page is claimed by another X account belongs to that person; it never leaves for another X
      // (and never detaches that person's members).
      const profiles = await tx<{ builder_id: number; x: string | null }[]>`
        SELECT builder_id, x_user_id AS x FROM builder_profiles
        WHERE builder_id IN (${own}, ${mine}) OR x_user_id = ${user.id} ORDER BY builder_id FOR UPDATE`;
      if (profiles.some((p) => (p.builder_id === own || p.builder_id === mine) && p.x !== null && p.x !== user.id)) throw new AttachRefused('other_x');
      const heldRow = profiles.find((p) => p.x === user.id);
      const held = heldRow ? { root: heldRow.builder_id } : undefined;
      if (mine !== pre.mine || (held?.root ?? null) !== pre.held) throw new StaleRead();
      const [cleared] = await tx`SELECT 1 FROM x_owner_clears WHERE x_user_id = ${user.id}`;
      if (cleared) throw new AttachRefused('owner_cleared');
      let root: number;
      let created = false;
      // Read before the members are detached below: an installation that had members is never fresh.
      // v3 Stage 1: the bind comes first, so ensureProfile below sees a bound hosted installation as not shared.
      const set = await tx`
        UPDATE installations SET x_user_id = ${user.id}, x_signed_in_unseen = true WHERE id = ${own} AND (x_user_id IS NULL OR x_user_id = ${user.id}) RETURNING id`;
      if (set.length !== 1) throw new Error('installation not bound');
      const [f] = await tx<{ fresh: boolean }[]>`
        SELECT NOT EXISTS (SELECT 1 FROM installations m WHERE m.builder_id = ${own})
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.installation_id = ${own})
          AND NOT EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = ${own})
          AND NOT EXISTS (SELECT 1 FROM builder_projects b WHERE b.builder_id = ${own}) AS fresh`;
      // T5 ruling: `own`'s old members never come along (unless `own` is already this X's page).
      if (!held || held.root !== own) await tx`UPDATE installations SET builder_id = NULL WHERE builder_id = ${own}`;
      if (held) {
        root = held.root;
        if (mine !== root) {
          await tx`UPDATE installations SET builder_id = ${root} WHERE id = ${own}`;
          if (f.fresh) await tx`DELETE FROM builder_profiles WHERE builder_id = ${own} AND x_user_id IS NULL`;
        }
      } else {
        // T5 ruling: no page for this X yet: the page is made on `own` alone (a member leaves its old root first).
        if (me.builder_id !== null) await tx`UPDATE installations SET builder_id = NULL WHERE id = ${own}`;
        root = own;
        created = (await ensureProfile(root, now, { db: tx }))?.created ?? false;
      }
      // The X profile's handle, name and photo, refreshed at every sign-in (v2.13 B14).
      const out = await bindXIn(tx, root, user, now);
      if (!out.ok) throw new AttachRefused(out.reason === 'owner_cleared' ? 'owner_cleared' : 'claimed_by_other');
      return { root, out, created };
    });
  } catch (err) {
    if (err instanceof AttachRefused) return { ok: false, reason: err.reason };
    throw err;
  }
  // Fix round 2 (C): the bind is committed; a failed after-step (event, discovery, cache) is logged, never a failure.
  await afterBind(done.root, user, done.out).catch((err: unknown) => console.error('[x attach] afterBind', errText(err)));
  return { ok: true, root: done.root, handle: done.out.handle, created: done.created };
}

/** A failure for the log: the Postgres error code and message (never a query's values), else the error's name. Pure. */
export function errText(err: unknown): string {
  if (!(err instanceof Error)) return 'error';
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? `${code} ${err.message}` : `${err.name}: ${err.message}`;
}

// ---- The X profile writer (v2.14 T7: moved from claim.ts; the claim page, its joins and the held branch are gone) ----

export type BindResult = { ok: true; handle: string; root: number } | { ok: false; reason: 'claimed_by_other' | 'owner_cleared' };

/**
 * The X profile on `builderId`'s person (its group root). One X account per person: a person claimed with another X
 * account is refused ('claimed_by_other'), an X account the owner cleared binds nowhere ('owner_cleared'). Else the X
 * id, handle, name and picture are written; the page moves to the handle, the old handle (a rename) redirects for
 * HANDLE_REDIRECT_DAYS, and the old slug follows the person. Nobody is ever asked: attachToX resolves an X account
 * another page holds before it writes (under its `x_attach` lock), so this only binds the page's own root. An X account
 * already on another page is refused by the database (builder_profiles_x_user), never merged.
 * Test-only (v2.14 final fix): production binds through attachToX (bindXIn in its transaction); the test fixtures
 * (fixtures/claimed-person.ts, fixtures/find.ts) and older tests claim a page with this.
 */
export async function bindX(builderId: number, user: XUser, now: Date): Promise<BindResult> {
  const root = await rootOf(builderId);
  const out = await sql().begin((tx) => bindXIn(tx, root, user, now));
  if (!out.ok) return out;
  await afterBind(root, user, out);
  return { ok: true, handle: out.handle, root };
}

/** What bindXIn did, for afterBind (its events and caches, after the commit). */
export type BoundX = { ok: true; handle: string; renamed: boolean; first: boolean };

/**
 * bindX's checks and writes on group root `root`, inside the caller's transaction (attachToX binds the installation
 * and its page in one). Takes the `x_user:<id>` and `x_handle:<h>` locks.
 */
export async function bindXIn(tx: postgres.TransactionSql, root: number, user: XUser, now: Date): Promise<BoundX | Exclude<BindResult, { ok: true }>> {
  const h = user.username.toLowerCase();
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`x_user:${user.id}`}))`;
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`x_handle:${h}`}))`;
  const [p] = await tx<{ x_user_id: string | null; x_handle: string | null; slug: string }[]>`
    SELECT x_user_id, x_handle, slug FROM builder_profiles WHERE builder_id = ${root} FOR UPDATE`;
  if (!p) throw new Error('no profile');
  // An X account the owner cleared binds nowhere until the owner releases it.
  const [cleared] = await tx`SELECT 1 FROM x_owner_clears WHERE x_user_id = ${user.id}`;
  if (cleared) return { ok: false as const, reason: 'owner_cleared' as const };
  if (p.x_user_id && p.x_user_id !== user.id) return { ok: false as const, reason: 'claimed_by_other' as const };
  // X says this handle is this account's now. A stale holder is cleared (hidden until they sign in again); no
  // history row may send this handle anywhere else; an unclaimed profile whose internal slug equals it moves to a
  // random one.
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
  // v2.13 R12 (B14, F9): the picture is refreshed at every sign-in; X sending none keeps the stored one.
  const keep = user.avatar === null;
  // v3.1 owner people view: the X account's age and followers, for the owner's private view only (never shown or
  // scored); a sign-in that carried neither keeps the stored ones.
  const xAge = user.createdAt ?? null;
  const xFollowers = user.followers ?? null;
  const facts = xAge !== null || xFollowers !== null;
  await tx`
    UPDATE builder_profiles SET x_user_id = ${user.id}, x_handle = ${user.username}, x_name = ${user.name}, x_avatar_url = ${keep ? tx`x_avatar_url` : user.avatar},
      claimed_at = COALESCE(claimed_at, ${now}), slug = ${slug}, updated_at = now(),
      x_created_at = COALESCE(${xAge}::timestamptz, x_created_at), x_followers = COALESCE(${xFollowers}::int, x_followers),
      x_checked_at = ${facts ? now : tx`x_checked_at`}
    WHERE builder_id = ${root}`;
  await tx`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${root}`;
  return { ok: true as const, handle: user.username, renamed, first: p.x_user_id === null };
}

/**
 * bindX's effects once its transaction committed: the claim or rename event, discovery, the profile cache. Carried
 * review fix: the cache is dropped whatever discovery does, so a failed enqueue never leaves a stale page.
 */
export async function afterBind(root: number, user: XUser, out: BoundX): Promise<void> {
  const h = user.username.toLowerCase();
  try {
    const type = out.first ? 'page_claimed' : out.renamed ? 'x_renamed' : null;
    if (type) await noteEvent(type, () => ({ type, dedupe_key: `${type}:${root}:${h}`, installation_id: root }));
    await enqueueDiscovery(root, 'signin'); // the X field match is checked on the next read
  } finally {
    profileChanged();
  }
}
