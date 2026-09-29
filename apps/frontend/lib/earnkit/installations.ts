import { createHash } from 'node:crypto';
import { sql } from './db';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Records the installation for a newly issued token. Idempotent for replays. */
export async function saveInstallation(token: string) {
  await sql()`INSERT INTO installations (token_hash) VALUES (${hash(token)}) ON CONFLICT (token_hash) DO NOTHING`;
}

/** The installation's id for this token (and marks it as seen), or null if unknown. */
export async function touchInstallation(token: string) {
  const [row] = await sql()<{ id: number }[]>`
    UPDATE installations SET last_seen_at = now()
    WHERE token_hash = ${hash(token)} RETURNING id`;
  return row?.id ?? null;
}
