/**
 * Builders: one row per GitHub account. Linking an installation moves its ledger from
 * 'i:<installation>' to 'b:<builder>', so every agent of one builder shares one ledger.
 */
import { inTx, sql, type Db } from '../v5/db';

export type Builder = { id: number; github_id: number; login: string; name: string | null; avatar_url: string | null };
type GitHubUser = Omit<Builder, 'id'>;
type Row = Omit<Builder, 'github_id'> & { github_id: string | number };

/** The ledger owner: 'b:<builder>' when linked, else 'i:<installation>'. Pure. */
export const ownerKey = (installationId: number, builderId: number | null): string =>
  builderId === null ? `i:${installationId}` : `b:${builderId}`;

/** An installation linked to one builder is never linked to another; a linked one gets no new code. */
export class LinkRefused extends Error {
  constructor(readonly reason: 'other_builder' | 'already_linked') {
    super(`link refused: ${reason}`);
    this.name = 'LinkRefused';
  }
}

// github_id is a bigint, which postgres.js reads as a string.
const builderOf = (r: Row): Builder => ({ id: r.id, github_id: Number(r.github_id), login: r.login, name: r.name, avatar_url: r.avatar_url });

/** Creates the builder, or updates the one with this GitHub id (login, name and avatar can change). */
export async function upsertBuilder(u: GitHubUser, now: Date): Promise<Builder> {
  const [r] = await sql()<Row[]>`
    INSERT INTO builders (github_id, login, name, avatar_url, created_at, last_seen_at)
    VALUES (${u.github_id}, ${u.login}, ${u.name}, ${u.avatar_url}, ${now}, ${now})
    ON CONFLICT (github_id) DO UPDATE
      SET login = EXCLUDED.login, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, last_seen_at = EXCLUDED.last_seen_at
    RETURNING id, github_id, login, name, avatar_url`;
  return builderOf(r);
}

export async function getBuilder(id: number): Promise<Builder | null> {
  const [r] = await sql()<Row[]>`SELECT id, github_id, login, name, avatar_url FROM builders WHERE id = ${id}`;
  return r ? builderOf(r) : null;
}

export async function touchBuilder(id: number, now: Date): Promise<void> {
  await sql()`UPDATE builders SET last_seen_at = GREATEST(last_seen_at, ${now}) WHERE id = ${id}`;
}

/**
 * Links the installation to the builder and re-keys its ledger, in one transaction (the caller's
 * when `db` is one). On a program both ledgers hold, the row with the newer `at` stays; history is
 * all kept; duplicate gap items are dropped. `migrated`: the applications moved. Linked to another
 * builder: LinkRefused and nothing changes; to this one again: only stray i: rows move.
 */
export async function linkInstallation(installationId: number, builderId: number, now: Date, db?: Db): Promise<{ migrated: number }> {
  const from = ownerKey(installationId, null);
  const to = ownerKey(installationId, builderId);
  return inTx(db, async (tx) => {
    const [inst] = await tx<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${installationId} FOR UPDATE`;
    if (inst?.builder_id != null && inst.builder_id !== builderId) throw new LinkRefused('other_builder');
    if (inst?.builder_id == null) await tx`UPDATE installations SET builder_id = ${builderId}, linked_at = ${now} WHERE id = ${installationId}`;
    // Rows of both ledgers are locked in a stable order, so two links to one builder never interleave.
    await tx`SELECT 1 FROM applications WHERE owner IN (${from}, ${to}) ORDER BY owner, program_id FOR UPDATE`;
    await tx`DELETE FROM applications i USING applications b
      WHERE i.owner = ${from} AND b.owner = ${to} AND i.program_id = b.program_id AND i.at <= b.at`;
    await tx`DELETE FROM applications b USING applications i
      WHERE b.owner = ${to} AND i.owner = ${from} AND i.program_id = b.program_id AND b.at < i.at`;
    const moved = await tx`UPDATE applications SET owner = ${to} WHERE owner = ${from}`;
    await tx`UPDATE application_history SET owner = ${to} WHERE owner = ${from}`;
    await tx`DELETE FROM gaps_done i USING gaps_done b
      WHERE i.owner = ${from} AND b.owner = ${to} AND i.program_id = b.program_id AND i.item = b.item`;
    await tx`UPDATE gaps_done SET owner = ${to} WHERE owner = ${from}`;
    return { migrated: moved.count };
  });
}

/** Removes the builder and everything theirs: sessions, their installations' link codes, the b: ledger. */
export async function deleteBuilder(id: number): Promise<void> {
  const owner = `b:${id}`;
  await sql().begin(async (tx) => {
    await tx`DELETE FROM sessions WHERE builder_id = ${id}`;
    await tx`DELETE FROM link_codes WHERE installation_id IN (SELECT id FROM installations WHERE builder_id = ${id})`;
    await tx`DELETE FROM applications WHERE owner = ${owner}`;
    await tx`DELETE FROM application_history WHERE owner = ${owner}`;
    await tx`DELETE FROM gaps_done WHERE owner = ${owner}`;
    await tx`UPDATE installations SET builder_id = NULL, linked_at = NULL WHERE builder_id = ${id}`;
    await tx`DELETE FROM builders WHERE id = ${id}`;
  });
}
