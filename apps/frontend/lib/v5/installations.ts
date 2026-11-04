/**
 * Installations: one row per OAuth client (its client key) or per token. Only the token's hash
 * is stored. The token exchange saves one; /mcp connects a token to its installation; find
 * stamps last_find_at.
 */
import { createHash } from 'node:crypto';
import { sql } from './db';

export type Caller = { id: number };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** True when this token, or this OAuth client, already has an installation. */
export async function installationExists(token: string, clientKey?: string): Promise<boolean> {
  const [row] = await sql()`
    SELECT 1 FROM installations
    WHERE token_hash = ${hash(token)} OR (${clientKey ?? null}::text IS NOT NULL AND client_key = ${clientKey ?? null})`;
  return Boolean(row);
}

/**
 * Records the installation for a newly issued token. With a client key there is one installation
 * per OAuth client: a new token replaces its token (the old one stops working) and the ledger
 * carries over. Idempotent for a replayed code. Returns the installation's id.
 */
export async function saveInstallation(token: string, clientKey?: string, clientName: string | null = null): Promise<number> {
  const h = hash(token);
  if (!clientKey) {
    const [r] = await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash, client_name) VALUES (${h}, ${clientName})
      ON CONFLICT (token_hash) DO UPDATE SET client_name = COALESCE(EXCLUDED.client_name, installations.client_name)
      RETURNING id`;
    return r.id;
  }
  return (await sql().begin(async (tx) => {
    // One client, one row: concurrent exchanges for the same client wait on each other.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${'installation:' + clientKey}))`;
    const [known] = await tx<{ id: number }[]>`SELECT id FROM installations WHERE client_key = ${clientKey} ORDER BY id LIMIT 1`;
    if (known) {
      await tx`UPDATE installations SET token_hash = ${h}, client_name = COALESCE(${clientName}, client_name) WHERE id = ${known.id}`;
      return known.id;
    }
    const [r] = await tx<{ id: number }[]>`
      INSERT INTO installations (token_hash, client_key, client_name) VALUES (${h}, ${clientKey}, ${clientName}) RETURNING id`;
    return r.id;
  })) as number;
}

/** The installation this token belongs to (its last_seen_at moves to now), or null. */
export async function connectInstallation(token: string): Promise<Caller | null> {
  const [row] = await sql()<{ id: number }[]>`
    UPDATE installations SET last_seen_at = now() WHERE token_hash = ${hash(token)} RETURNING id`;
  return row ? { id: row.id } : null;
}

/** Stamps a find: last_find_at and last_seen_at. */
export async function markFind(id: number, now: Date): Promise<void> {
  await sql()`UPDATE installations SET last_find_at = ${now}, last_seen_at = GREATEST(last_seen_at, ${now}) WHERE id = ${id}`;
}

export async function lastFindAt(id: number): Promise<Date | null> {
  const [row] = await sql()<{ last_find_at: Date | null }[]>`SELECT last_find_at FROM installations WHERE id = ${id}`;
  return row?.last_find_at ?? null;
}
