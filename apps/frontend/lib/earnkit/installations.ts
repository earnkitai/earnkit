import { createHash } from 'node:crypto';
import { sql } from './db';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Records the installation for a newly issued token. Idempotent for replays. */
export async function saveInstallation(token: string) {
  await sql()`INSERT INTO installations (token_hash) VALUES (${hash(token)}) ON CONFLICT (token_hash) DO NOTHING`;
}

/** True if the token belongs to an installation; marks it as seen. */
export async function touchInstallation(token: string) {
  const rows = await sql()`
    UPDATE installations SET last_seen_at = now()
    WHERE token_hash = ${hash(token)} RETURNING id`;
  return rows.length > 0;
}
