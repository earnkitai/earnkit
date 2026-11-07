/**
 * Installations: one row per issued token; only the token's hash is stored. The token exchange
 * saves one; /mcp connects a token to its installation and its builder, if linked; find stamps
 * last_find_at.
 */
import { createHash } from 'node:crypto';
import { sql } from './db';

export type Caller = { id: number; builderId: number | null };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** True when this token already has an installation. */
export async function installationExists(token: string): Promise<boolean> {
  const [row] = await sql()`SELECT 1 FROM installations WHERE token_hash = ${hash(token)}`;
  return Boolean(row);
}

/**
 * Records the installation for a newly issued token: one row per token (a re-authorization is a
 * new installation with a fresh ledger). Idempotent for a replayed code. Returns its id.
 */
export async function saveInstallation(token: string, clientName: string | null = null): Promise<number> {
  const [r] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, client_name) VALUES (${hash(token)}, ${clientName})
    ON CONFLICT (token_hash) DO UPDATE SET client_name = COALESCE(EXCLUDED.client_name, installations.client_name)
    RETURNING id`;
  return r.id;
}

/** The installation this token belongs to and its builder (its last_seen_at moves to now), or null. */
export async function connectInstallation(token: string): Promise<Caller | null> {
  const [row] = await sql()<{ id: number; builder_id: number | null }[]>`
    UPDATE installations SET last_seen_at = now() WHERE token_hash = ${hash(token)} RETURNING id, builder_id`;
  return row ? { id: row.id, builderId: row.builder_id } : null;
}

/** The builder this installation is linked to, or null. */
export async function builderOf(installationId: number): Promise<number | null> {
  const [row] = await sql()<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${installationId}`;
  return row?.builder_id ?? null;
}

/** Stamps a find: last_find_at and last_seen_at. */
export async function markFind(id: number, now: Date): Promise<void> {
  await sql()`UPDATE installations SET last_find_at = ${now}, last_seen_at = GREATEST(last_seen_at, ${now}) WHERE id = ${id}`;
}

export async function lastFindAt(id: number): Promise<Date | null> {
  const [row] = await sql()<{ last_find_at: Date | null }[]>`SELECT last_find_at FROM installations WHERE id = ${id}`;
  return row?.last_find_at ?? null;
}
