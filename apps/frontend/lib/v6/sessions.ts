/**
 * Browser sessions for /me: a random token in an HttpOnly cookie, only its hash stored, 30 days.
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '../v5/db';
import { getBuilder, type Builder } from './builders';

/**
 * The session cookie's old name, read for one more release (v6.1.17 Task 4: never promoted; ignored from v6.1.18), so a
 * builder signed in under it stays signed in until that session ends or a /me write asks for a new sign-in.
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
/** The session token in a Cookie header: the current name first, else the old one (L31-6, one release). Pure. */
export const sessionToken = (cookieHeader: string | null): string | null =>
  cookieValue(cookieHeader, cookieName()) ?? cookieValue(cookieHeader, OLD_COOKIE);
const tokenOf = sessionToken;

/**
 * Whether the request's session token is held under the current name (v6.1.17 Task 4, L35-17). The old `ek_me` is
 * still read for this release but never promoted into `__Host-ek_me` (a planted old-name cookie would be minted into
 * the new one for 30 days): a page reads it, a /me write asks for a new sign-in. On local http the two names are one.
 * Pure.
 */
export const currentName = (cookieHeader: string | null): boolean =>
  cookieName() === OLD_COOKIE || cookieValue(cookieHeader, cookieName()) !== null;

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

/** The Set-Cookie value that removes the session cookie. Pure. */
export const clearCookie = (): string => cookieOf(cookieName(), '', 0);
/** In production, the Set-Cookie value that expires the old ek_me (sign-in, sign-out, delete); none on local http. Pure. */
export const legacyClear = (): string[] => (cookieName() === OLD_COOKIE ? [] : [cookieOf(OLD_COOKIE, '', 0)]);
/** The Set-Cookie values that expire every session cookie name (L31-6 controller ruling). Pure. */
export const clearCookies = (): string[] => [clearCookie(), ...legacyClear()];
