import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Anonymous identity for one agent's EarnKit connection. No accounts. */
export async function createInstallation() {
  const token = `ek_${randomBytes(24).toString('base64url')}`;
  await sql()`INSERT INTO installations (token_hash) VALUES (${hash(token)})`;
  return token;
}

/** True if the token belongs to an installation; marks it as seen. */
export async function touchInstallation(token: string) {
  const rows = await sql()`
    UPDATE installations SET last_seen_at = now()
    WHERE token_hash = ${hash(token)} RETURNING id`;
  return rows.length > 0;
}
