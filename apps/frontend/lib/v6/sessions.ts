/**
 * Browser sessions for /me: a random token in an HttpOnly cookie, only its hash stored, 30 days.
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '../v5/db';
import { getBuilder, type Builder } from './builders';

export const COOKIE = 'ek_me';
export const SESSION_DAYS = 30;
const DAY = 86_400_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const secure = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');
const cookieOf = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/; HttpOnly${secure()}; SameSite=Lax; Max-Age=${maxAge}`;

/** The session token in a Cookie header, or null. Pure. */
function tokenOf(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE && v.length > 0) return v.join('=') || null;
  }
  return null;
}

export async function createSession(builderId: number, now: Date): Promise<{ token: string; cookie: string }> {
  const token = randomBytes(32).toString('base64url');
  await sql()`INSERT INTO sessions (token_hash, builder_id, created_at, expires_at, last_seen_at)
    VALUES (${hash(token)}, ${builderId}, ${now}, ${new Date(now.getTime() + SESSION_DAYS * DAY)}, ${now})`;
  return { token, cookie: cookieOf(token, SESSION_DAYS * 86_400) };
}

/** The signed-in builder (the session's last_seen_at moves to now), or null when absent or expired. */
export async function sessionBuilder(cookieHeader: string | null, now: Date): Promise<Builder | null> {
  const token = tokenOf(cookieHeader);
  if (!token) return null;
  const [r] = await sql()<{ builder_id: number }[]>`
    UPDATE sessions SET last_seen_at = ${now} WHERE token_hash = ${hash(token)} AND expires_at > ${now} RETURNING builder_id`;
  return r ? getBuilder(r.builder_id) : null;
}

export async function endSession(cookieHeader: string | null): Promise<void> {
  const token = tokenOf(cookieHeader);
  if (token) await sql()`DELETE FROM sessions WHERE token_hash = ${hash(token)}`;
}

/** The Set-Cookie value that removes the session cookie. Pure. */
export const clearCookie = (): string => cookieOf('', 0);
