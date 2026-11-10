/**
 * Installations: one row per issued token; only the token's hash is stored. The token exchange
 * saves one; /mcp connects a token to its installation and its builder, if linked; find stamps
 * last_find_at and its gaps.
 */
import { createHash } from 'node:crypto';
import { sql } from './db';
import { dropControls } from './controls';

export type Caller = { id: number; builderId: number | null };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** True when this token already has an installation. */
export async function installationExists(token: string): Promise<boolean> {
  const [row] = await sql()`SELECT 1 FROM installations WHERE token_hash = ${hash(token)}`;
  return Boolean(row);
}

/**
 * An agent's own name as EarnKit keeps and shows it (v6.1.7 C1): control and format characters (bidi overrides,
 * zero-width marks) dropped, spaces collapsed, at most 60 characters; null when nothing is left. Pure.
 */
export function cleanClientName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = Array.from(dropControls(name).replace(/\s+/g, ' ').trim()).slice(0, 60).join('').trim();
  return s || null;
}

/**
 * Records the installation for a newly issued token: one row per token (a re-authorization is a
 * new installation with a fresh ledger). Idempotent for a replayed code. The agent's name is cleaned first. Returns its id.
 */
export async function saveInstallation(token: string, clientName: string | null = null): Promise<number> {
  const [r] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, client_name) VALUES (${hash(token)}, ${cleanClientName(clientName)})
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

/** A remembered gap: the first gap's what, its kind ('rule' for a rule to confirm) and its item (none in rows before v6.1.7). */
export type RememberedGap = { what: string; kind: string; item?: string };

/**
 * Stamps a find: last_find_at and last_seen_at; with `gaps` (a find without a category filter, v6.1.7 C24a) also its gaps
 * (program_id to the first gap), replacing the last. `undefined` leaves the last gaps as they were. With `projectKey`
 * (a find with a project, v6.1.10 L1c-1) also the project a track without one belongs to.
 */
export async function markFind(id: number, now: Date, gaps?: Record<string, RememberedGap>, projectKey?: string): Promise<void> {
  // The gaps and their project are written in one statement (final round), so the two never describe different projects.
  if (gaps !== undefined && projectKey !== undefined) {
    await sql()`UPDATE installations SET prev_find_at = last_find_at, last_find_at = ${now}, last_seen_at = GREATEST(last_seen_at, ${now}), last_gaps = ${sql().json(gaps)}, last_project_key = ${projectKey} WHERE id = ${id}`;
    return;
  }
  if (projectKey !== undefined) await rememberProject(id, projectKey);
  if (gaps === undefined) {
    await sql()`UPDATE installations SET prev_find_at = last_find_at, last_find_at = ${now}, last_seen_at = GREATEST(last_seen_at, ${now}) WHERE id = ${id}`;
    return;
  }
  await sql()`UPDATE installations SET prev_find_at = last_find_at, last_find_at = ${now}, last_seen_at = GREATEST(last_seen_at, ${now}), last_gaps = ${sql().json(gaps)} WHERE id = ${id}`;
}

/**
 * An agent's send under standing approval: the find before it was the night routine's, not the builder's, so it does
 * not count as seen; last_find_at goes back to the find before, and the morning find reports every overnight send
 * (v6.1.9). A second send the same night changes nothing.
 */
export async function unmarkNightFind(id: number): Promise<void> {
  // No find before it: a moment before the night's find, so its sends still count as after it.
  await sql()`UPDATE installations SET last_find_at = COALESCE(prev_find_at, last_find_at - interval '1 millisecond')
    WHERE id = ${id} AND last_find_at IS NOT NULL AND last_find_at IS DISTINCT FROM prev_find_at`;
}

/**
 * Keeps the project of a find (projectKeyOf), so the next track without one marks its steps on it (v6.1.10 L1c-1).
 * Another project than the last drops the last gaps in the same statement: they were that project's (final round).
 */
export async function rememberProject(id: number, projectKey: string): Promise<void> {
  await sql()`UPDATE installations SET last_gaps = CASE WHEN last_project_key IS DISTINCT FROM ${projectKey} THEN NULL ELSE last_gaps END,
    last_project_key = ${projectKey} WHERE id = ${id}`;
}

/** The project of the last find with one (projectKeyOf); '' before any. */
export async function lastProjectKey(id: number): Promise<string> {
  const [row] = await sql()<{ k: string | null }[]>`SELECT last_project_key AS k FROM installations WHERE id = ${id}`;
  return row?.k ?? '';
}

/** The last find's gaps (program_id to the first gap); a value stored as a string (before v6.1.7) reads as kind 'other'. {} before any find. */
export async function lastGaps(id: number): Promise<Record<string, RememberedGap>> {
  const [row] = await sql()<{ last_gaps: Record<string, string | RememberedGap> | null }[]>`SELECT last_gaps FROM installations WHERE id = ${id}`;
  return Object.fromEntries(
    Object.entries(row?.last_gaps ?? {}).map(([k, g]) => [k, typeof g === 'string' ? { what: g, kind: 'other' } : g]),
  );
}

/** Drops one program from the last find's gaps: the builder reported that gap done (track gap_done). */
export async function forgetGap(id: number, programId: string): Promise<void> {
  await sql()`UPDATE installations SET last_gaps = last_gaps - ${programId}::text WHERE id = ${id} AND last_gaps IS NOT NULL`;
}

/** The linked builder's GitHub login when the link is newer than the last find (or no find yet); else null. Read before markFind. */
export async function newlyLinkedLogin(id: number): Promise<string | null> {
  const [row] = await sql()<{ login: string }[]>`
    SELECT b.login FROM installations i JOIN builders b ON b.id = i.builder_id
    WHERE i.id = ${id} AND i.linked_at IS NOT NULL AND (i.last_find_at IS NULL OR i.linked_at > i.last_find_at)`;
  return row?.login ?? null;
}

export async function lastFindAt(id: number): Promise<Date | null> {
  const [row] = await sql()<{ last_find_at: Date | null }[]>`SELECT last_find_at FROM installations WHERE id = ${id}`;
  return row?.last_find_at ?? null;
}
