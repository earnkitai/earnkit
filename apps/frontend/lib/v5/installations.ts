/**
 * Installations: one row per issued token; only the token's hash is stored. The token exchange
 * saves one; /mcp connects a token to its installation and its builder, if linked; find stamps
 * last_find_at and its gaps.
 */
import { createHash } from 'node:crypto';
import { type Db, sql } from './db';
import { cleanText } from './controls';
import type { OfferKind } from './reply';
import { INVALID_CLIENT_NAME, OAuthError, reservedClientName } from './oauth';

/** `audience`: the resource the token was issued for (null for installations from before v6.1.16). */
export type Caller = { id: number; builderId: number | null; audience: string | null };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * An agent's own name as EarnKit keeps and shows it (v6.1.7 C1): control and format characters (bidi overrides,
 * zero-width marks) dropped, spaces collapsed, at most 60 characters; null when nothing is left. Pure.
 */
export function cleanClientName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = cleanText(name.replace(/\s+/g, ' '), 60);
  return s || null;
}

/**
 * The agent's name as /me and the replies show it (L25-1, v6.1.16): the cleaned name with one trailing "(...)" group
 * dropped, so "Claude Code (earnkit)" shows as "Claude Code"; a name that is only the group keeps it. The stored
 * `client_name` is untouched. Pure.
 */
export function displayName(name: string | null | undefined): string | null {
  const s = cleanClientName(name);
  if (s === null) return null;
  return s.replace(/\s*\([^()]*\)$/, '').trim() || s;
}

/**
 * Records the installation for a newly issued token: one row per token (a re-authorization is a
 * new installation with a fresh ledger). Idempotent for one token (tokenPost spends each code once, installOnce). The agent's name is cleaned first. Returns its id.
 */
export async function saveInstallation(token: string, clientName: string | null = null, audience: string | null = null, db: Db = sql()): Promise<number> {
  // T6-F2 (v6.1.14): no installation is saved under EarnKit's own name, whoever calls this.
  if (reservedClientName(clientName)) throw new OAuthError('invalid_client_metadata', INVALID_CLIENT_NAME);
  const [r] = await db<{ id: number }[]>`
    INSERT INTO installations (token_hash, client_name, audience) VALUES (${hash(token)}, ${cleanClientName(clientName)}, ${audience})
    ON CONFLICT (token_hash) DO UPDATE SET client_name = COALESCE(EXCLUDED.client_name, installations.client_name),
      audience = COALESCE(EXCLUDED.audience, installations.audience)
    RETURNING id`;
  return r.id;
}

/**
 * The token exchange's write (L19-4): spends the code's nonce and saves the installation in one transaction. Null when
 * the nonce was already spent: nothing is saved, and the caller revokes the token that exchange gave (spentToken).
 */
export async function installOnce(token: string, nonce: string, clientName: string | null, audience: string | null): Promise<number | null> {
  return sql().begin(async (tx) => {
    const spent = await tx`INSERT INTO oauth_codes_spent (nonce, token_hash, at) VALUES (${nonce}, ${hash(token)}, now())
      ON CONFLICT DO NOTHING RETURNING nonce`;
    if (spent.length === 0) return null;
    return saveInstallation(token, clientName, audience, tx);
  }) as Promise<number | null>;
}

/** Whether a code's nonce was already exchanged. */
export async function codeSpent(nonce: string): Promise<boolean> {
  const [row] = await sql()`SELECT 1 FROM oauth_codes_spent WHERE nonce = ${nonce}`;
  return Boolean(row);
}

/**
 * Revokes this token's installation: /mcp refuses it from now on (connectInstallation answers null). A reused code
 * (L19-4, OAuth 2.1 4.1.3) revokes the token its first exchange gave: the token is derived from the code, so the
 * reuse's token is that one (its hash is the one kept in oauth_codes_spent).
 */
export async function revokeInstallation(token: string): Promise<void> {
  await sql()`UPDATE installations SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = ${hash(token)}`;
}

/** The installation this token belongs to and its builder (its last_seen_at moves to now), or null (none, or revoked). */
export async function connectInstallation(token: string): Promise<Caller | null> {
  const [row] = await sql()<{ id: number; builder_id: number | null; audience: string | null }[]>`
    UPDATE installations SET last_seen_at = now() WHERE token_hash = ${hash(token)} AND revoked_at IS NULL
    RETURNING id, builder_id, audience`;
  return row ? { id: row.id, builderId: row.builder_id, audience: row.audience } : null;
}

/** The builder this installation is linked to, or null. */
export async function builderOf(installationId: number): Promise<number | null> {
  const [row] = await sql()<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${installationId}`;
  return row?.builder_id ?? null;
}

/** A remembered gap: the first gap's what, its kind ('rule' for a rule to confirm) and its item (none in rows before v6.1.7). */
/** Fix round 1 (I1, v6.1.18 Task 8): `rules`, the rule items the program's row (or its rule ask) listed, so one rule
 *  yes confirms those and no other. */
export type RememberedGap = { what: string; kind: string; item?: string; rules?: string[] };

/**
 * Stamps a find: last_find_at and last_seen_at; with `gaps` (a find without a category filter, v6.1.7 C24a) also its gaps
 * (program_id to the first gap), replacing the last. `undefined` leaves the last gaps as they were. With `projectKey`
 * (a find with a project, v6.1.10 L1c-1) also the project a track without one belongs to.
 */
/**
 * L26-11 (v6.1.16 Task 12): parallel finds stamp in the order they finish, so the latest `now` wins: last_find_at
 * never goes back, and prev_find_at moves only when this find's `now` is the newer one.
 */
const stamp = (now: Date) => sql()`prev_find_at = CASE WHEN last_find_at IS NULL OR last_find_at < ${now} THEN last_find_at ELSE prev_find_at END,
  last_find_at = GREATEST(last_find_at, ${now})`;

export async function markFind(id: number, now: Date, gaps?: Record<string, RememberedGap>, projectKey?: string): Promise<void> {
  // The gaps and their project are written in one statement (final round), so the two never describe different projects.
  if (gaps !== undefined && projectKey !== undefined) {
    await sql()`UPDATE installations SET ${stamp(now)}, last_seen_at = GREATEST(last_seen_at, ${now}), last_gaps = ${sql().json(gaps)}, last_project_key = ${projectKey} WHERE id = ${id}`;
    return;
  }
  if (projectKey !== undefined) await rememberProject(id, projectKey);
  if (gaps === undefined) {
    await sql()`UPDATE installations SET ${stamp(now)}, last_seen_at = GREATEST(last_seen_at, ${now}) WHERE id = ${id}`;
    return;
  }
  await sql()`UPDATE installations SET ${stamp(now)}, last_seen_at = GREATEST(last_seen_at, ${now}), last_gaps = ${sql().json(gaps)} WHERE id = ${id}`;
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

/** L13-7 (v6.1.14): stamps whether standing approval was on at this find (a linked find with a project). */
export async function markFindAuto(id: number, on: boolean): Promise<void> {
  await sql()`UPDATE installations SET last_find_auto = ${on} WHERE id = ${id}`;
}

/** Whether standing approval was on at this installation's last find with a project (false before any). */
export async function findAutoWas(id: number): Promise<boolean> {
  const [row] = await sql()<{ on: boolean | null }[]>`SELECT last_find_auto AS on FROM installations WHERE id = ${id}`;
  return row?.on === true;
}

/**
 * Keeps the project of a find (projectKeyOf), so the next track without one marks its steps on it (v6.1.10 L1c-1).
 * Another project than the last drops the last gaps in the same statement: they were that project's (final round).
 */
export async function rememberProject(id: number, projectKey: string): Promise<void> {
  // Fix round 1 (I3, v6.1.16.1): another project's list numbers are not this one's.
  await sql()`UPDATE installations SET last_gaps = CASE WHEN last_project_key IS DISTINCT FROM ${projectKey} THEN NULL ELSE last_gaps END,
    last_list = CASE WHEN last_project_key IS DISTINCT FROM ${projectKey} THEN NULL ELSE last_list END,
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
/**
 * Fix round 1 (I1, v6.1.18 Task 8): one program's remembered gap, set (or its `rules` merged into the one kept) after a
 * reply listed its rules: the one-program look, or track's rule ask. The caller checks the project is the last find's.
 */
export async function rememberGap(id: number, programId: string, gap: RememberedGap): Promise<void> {
  await sql()`UPDATE installations SET last_gaps = COALESCE(last_gaps, '{}'::jsonb) || jsonb_build_object(${programId}::text,
    COALESCE(last_gaps -> ${programId}::text, ${sql().json(gap)}::jsonb) || jsonb_build_object('rules', ${sql().json(gap.rules ?? [])}::jsonb))
    WHERE id = ${id}`;
}

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

/** L23-1 (v6.1.16): a program the standing-approval line named. */
export type Promised = { program_id: string; title: string };

/** L23-1 (v6.1.16): stores the programs this find's standing-approval line named and when (replacing the last). */
export async function markPromised(id: number, programs: Promised[], now: Date): Promise<void> {
  await sql()`UPDATE installations SET promised = ${sql().json(programs)}, promised_at = ${now} WHERE id = ${id}`;
}

/** The programs the last standing-approval line named and when, or null when none is kept. */
export async function promisedOf(id: number): Promise<{ programs: Promised[]; at: Date } | null> {
  const [row] = await sql()<{ promised: Promised[] | null; promised_at: Date | null }[]>`SELECT promised, promised_at FROM installations WHERE id = ${id}`;
  return row?.promised && row.promised_at && Array.isArray(row.promised) && row.promised.length > 0 ? { programs: row.promised, at: row.promised_at } : null;
}

/** Clears the kept promise (said once, L23-1). */
export async function clearPromised(id: number): Promise<void> {
  await sql()`UPDATE installations SET promised = NULL, promised_at = NULL WHERE id = ${id}`;
}

/** L23-16 (v6.1.16): sha256 of the sorted program ids a find showed. Pure. */
export const listHash = (ids: string[]): string => createHash('sha256').update([...new Set(ids)].sort().join('\n')).digest('hex');

/** The last project find's list hash and when, or null before any. */
export async function lastList(id: number): Promise<{ hash: string; at: Date } | null> {
  const [row] = await sql()<{ h: string | null; at: Date | null }[]>`SELECT last_list_hash AS h, last_list_at AS at FROM installations WHERE id = ${id}`;
  return row?.h && row.at ? { hash: row.h, at: row.at } : null;
}

/**
 * Stores this project find's list hash and time (after each project find), and (L29-15, v6.1.16 Task 15) with `ids` the
 * shown program ids by the number the builder sees: `ids[n - 1]` is the program numbered n.
 */
export async function markList(id: number, hash: string, now: Date, ids?: string[]): Promise<void> {
  if (ids === undefined) await sql()`UPDATE installations SET last_list_hash = ${hash}, last_list_at = ${now} WHERE id = ${id}`;
  else await sql()`UPDATE installations SET last_list_hash = ${hash}, last_list_at = ${now}, last_list = ${sql().json(ids)} WHERE id = ${id}`;
}

/** L29-15 (v6.1.16 Task 15): the last project find's program ids by number (`ids[n - 1]`), [] before any. */
export async function lastListIds(id: number): Promise<string[]> {
  const [row] = await sql()<{ l: unknown }[]>`SELECT last_list AS l FROM installations WHERE id = ${id}`;
  return Array.isArray(row?.l) ? (row.l as unknown[]).map((x) => (typeof x === 'string' ? x : '')) : [];
}

/**
 * L1i-5 (v6.1.16.1): the stable list numbers of a session: a program the last list (`prev`, ids by number) of the same
 * project held keeps its number; any other in `order` is numbered on after the last one, in that order. Pure.
 */
export function stableNumbers(prev: string[], order: string[]): Map<string, number> {
  const want = new Set(order);
  const out = new Map<string, number>();
  prev.forEach((id, i) => {
    if (id && want.has(id) && !out.has(id)) out.set(id, i + 1);
  });
  let next = prev.length;
  for (const id of order) if (!out.has(id)) out.set(id, ++next);
  return out;
}

/** L24-2 (v6.1.16 Task 11): the kind of the last `Say` this installation's find offered, or null. */
export async function lastOfferOf(id: number): Promise<OfferKind | null> {
  const [row] = await sql()<{ o: string | null }[]>`SELECT last_offer AS o FROM installations WHERE id = ${id}`;
  return (row?.o as OfferKind | null | undefined) ?? null;
}

/** L24-2: stores the kind of the `Say` this find's reply offered (null when it offered none). */
export async function markOffer(id: number, offer: OfferKind | null, now: Date): Promise<void> {
  await sql()`UPDATE installations SET last_offer = ${offer}, last_offer_at = ${now} WHERE id = ${id}`;
}

/**
 * One thing the next send needs from the builder: its words, and (L45-1, v6.1.19) the form field it fills (`key` of
 * `program_id`, for the find's `project_id`), so record can tell when the record now holds it.
 */
export type NextNeed = { words: string; key?: string; program_id?: string; project_id?: string | null };

/**
 * L29-11 (v6.1.16 Task 15): what the next send needs from the builder (the first ready program's `need_you`, at most
 * two), kept by each linked project find. L45-1 (v6.1.19): each with its field, when known.
 */
export async function markNextNeeds(id: number, needs: (string | NextNeed)[]): Promise<void> {
  const kept = needs.slice(0, 2).map((n) => (typeof n === 'string' ? n : { w: n.words, ...(n.key ? { k: n.key, p: n.program_id ?? null, j: n.project_id ?? null } : {}) }));
  await sql()`UPDATE installations SET next_needs = ${sql().json(kept)} WHERE id = ${id}`;
}

/** L29-11: the last linked project find's next needs (at most two), or null before any such find. A need stored as
 *  plain words (before v6.1.19) reads with no field. */
export async function nextNeedsOf(id: number): Promise<NextNeed[] | null> {
  const [row] = await sql()<{ n: unknown }[]>`SELECT next_needs AS n FROM installations WHERE id = ${id}`;
  if (!Array.isArray(row?.n)) return null;
  const out: NextNeed[] = [];
  for (const x of row.n as unknown[]) {
    if (typeof x === 'string') out.push({ words: x });
    else if (x && typeof x === 'object' && typeof (x as { w?: unknown }).w === 'string') {
      const o = x as { w: string; k?: unknown; p?: unknown; j?: unknown };
      out.push({ words: o.w, ...(typeof o.k === 'string' && typeof o.p === 'string' ? { key: o.k, program_id: o.p, project_id: typeof o.j === 'string' ? o.j : null } : {}) });
    }
  }
  return out.slice(0, 2);
}
