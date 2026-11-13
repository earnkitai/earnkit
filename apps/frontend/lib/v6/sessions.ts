/**
 * Browser sessions for /me: a random token in an HttpOnly cookie, only its hash stored, 30 days.
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '../v5/db';
import { getBuilder, type Builder } from './builders';

/**
 * The session cookie's old name (v6.1.17 Task 4: never promoted). From v6.1.19 (L43-3) it is never read in production:
 * a request carrying only it is signed out. Sign-in, sign-out and delete still expire it (`clearCookies`), and
 * `endSession` still ends the session behind it.
 */
export const OLD_COOKIE = 'ek_me';
/**
 * The session cookie's name (L31-6, v6.1.16 Task 17): `__Host-ek_me` in production, so the browser takes it only with
 * Secure, Path=/ and no Domain (no subdomain can set or shadow it); `ek_me` on local http, where Secure cannot be set.
 */
export const cookieName = (): string => (process.env.NODE_ENV === 'production' ? '__Host-ek_me' : OLD_COOKIE);
export const SESSION_DAYS = 30;
const DAY = 86_400_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
/** A Set-Cookie value: HttpOnly, SameSite=Lax, Path=/, and Secure in production; never a Domain. */
export const cookieOf = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}; SameSite=Lax; Max-Age=${maxAge}`;

/** The named cookie's value in a Cookie header, or null. Pure. */
export function cookieValue(cookieHeader: string | null, name: string): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name && v.length > 0) return v.join('=') || null;
  }
  return null;
}
/**
 * The session token in a Cookie header (L43-3, v6.1.19): only the current name, `__Host-ek_me` in production, so an old
 * or planted `ek_me` is never a session there. Pure.
 */
export const sessionToken = (cookieHeader: string | null): string | null => cookieValue(cookieHeader, cookieName());
const tokenOf = sessionToken;
/** Whether the header carries a session cookie under any name, the old one included (it is cleared on sight). Pure. */
export const anySessionCookie = (cookieHeader: string | null): boolean =>
  cookieValue(cookieHeader, cookieName()) !== null || cookieValue(cookieHeader, OLD_COOKIE) !== null;

export async function createSession(builderId: number, now: Date): Promise<{ token: string; cookie: string }> {
  const token = randomBytes(32).toString('base64url');
  await sql()`INSERT INTO sessions (token_hash, builder_id, created_at, expires_at, last_seen_at)
    VALUES (${hash(token)}, ${builderId}, ${now}, ${new Date(now.getTime() + SESSION_DAYS * DAY)}, ${now})`;
  return { token, cookie: cookieOf(cookieName(), token, SESSION_DAYS * 86_400) };
}

/** The signed-in builder (the session's last_seen_at moves to now), or null when absent or expired. */
export async function sessionBuilder(cookieHeader: string | null, now: Date): Promise<Builder | null> {
  const token = tokenOf(cookieHeader);
  if (!token) return null;
  const [r] = await sql()<{ builder_id: number }[]>`
    UPDATE sessions SET last_seen_at = ${now} WHERE token_hash = ${hash(token)} AND expires_at > ${now} RETURNING builder_id`;
  return r ? getBuilder(r.builder_id) : null;
}

/**
 * Whether the request carries a live session, read only (v6.1.17 Task 4): no last_seen_at write, so the header's
 * check after every page load costs one indexed read for a visitor with a cookie and none without.
 */
export async function hasSession(cookieHeader: string | null, now: Date): Promise<boolean> {
  const token = tokenOf(cookieHeader);
  if (!token) return false;
  const [r] = await sql()<{ one: number }[]>`SELECT 1 AS one FROM sessions WHERE token_hash = ${hash(token)} AND expires_at > ${now}`;
  return Boolean(r);
}

/**
 * Ends the database session behind each session cookie present (L31-6 controller ruling, v6.1.16 Task 17): the
 * current name and, for one release, the old ek_me, which may hold another token.
 */
export async function endSession(cookieHeader: string | null): Promise<void> {
  const tokens = [...new Set([cookieValue(cookieHeader, cookieName()), cookieValue(cookieHeader, OLD_COOKIE)].filter((t): t is string => Boolean(t)))];
  if (tokens.length > 0) await sql()`DELETE FROM sessions WHERE token_hash = ANY(${tokens.map(hash)})`;
}

export type SessionState = 'live' | 'expired' | 'unknown' | 'none';
/**
 * What the request's session cookie is (L43-12, v6.1.19), read only: `none` without one, `live`, `expired` only when a
 * session row with that hash exists and has ended, else `unknown` (garbage, forged, or a session signed out or deleted).
 */
export async function sessionState(cookieHeader: string | null, now: Date): Promise<SessionState> {
  const token = tokenOf(cookieHeader);
  if (!token) return 'none';
  const [r] = await sql()<{ expires_at: Date }[]>`SELECT expires_at FROM sessions WHERE token_hash = ${hash(token)}`;
  if (!r) return 'unknown';
  return r.expires_at.getTime() > now.getTime() ? 'live' : 'expired';
}

/** How long a refused form's typed values are kept for the page (L43-4, v6.1.19). */
export const DRAFT_MS = 15 * 60_000;
/** The typed values of a refused form, by field path. */
export type Draft = Record<string, string>;
/**
 * Keeps what the builder typed into a refused /me form (L43-4, v6.1.19) on this session's row, replacing any earlier
 * draft, so the page shows it again for DRAFT_MS. Only the session's own row; nothing without a session.
 */
export async function saveDraft(cookieHeader: string | null, values: Draft, now: Date): Promise<void> {
  const token = tokenOf(cookieHeader);
  if (!token || Object.keys(values).length === 0) return;
  await sql()`UPDATE sessions SET draft = ${sql().json(values)}, draft_at = ${now} WHERE token_hash = ${hash(token)}`;
}
/** This session's draft while it is younger than DRAFT_MS, else null. */
export async function draftOf(cookieHeader: string | null, now: Date): Promise<Draft | null> {
  const token = tokenOf(cookieHeader);
  if (!token) return null;
  const [r] = await sql()<{ draft: Draft | null; draft_at: Date | null }[]>`SELECT draft, draft_at FROM sessions WHERE token_hash = ${hash(token)}`;
  if (!r?.draft || !r.draft_at || r.draft_at.getTime() <= now.getTime() - DRAFT_MS) return null;
  const out: Draft = {};
  for (const [k, v] of Object.entries(r.draft)) if (typeof v === 'string') out[k] = v;
  return out;
}
/** Drops this session's draft: the next save that succeeds. */
export async function clearDraft(cookieHeader: string | null): Promise<void> {
  const token = tokenOf(cookieHeader);
  if (token) await sql()`UPDATE sessions SET draft = NULL, draft_at = NULL WHERE token_hash = ${hash(token)} AND draft IS NOT NULL`;
}

/** The Set-Cookie value that removes the session cookie. Pure. */
export const clearCookie = (): string => cookieOf(cookieName(), '', 0);
/** In production, the Set-Cookie value that expires the old ek_me (sign-in, sign-out, delete); none on local http. Pure. */
export const legacyClear = (): string[] => (cookieName() === OLD_COOKIE ? [] : [cookieOf(OLD_COOKIE, '', 0)]);
/** The Set-Cookie values that expire every session cookie name (L31-6 controller ruling). Pure. */
export const clearCookies = (): string[] => [clearCookie(), ...legacyClear()];
