/**
 * Builders: one row per GitHub account. Linking an installation moves its ledger from
 * 'i:<installation>' to 'b:<builder>', so every agent of one builder shares one ledger.
 */
import { inTx, sql, type Db } from '../v5/db';
import { type BuilderRecord, readRecord } from './record';

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

/** The builder's record and whether the stored row failed to parse; a missing builder reads as empty. */
export async function readStoredRecord(builderId: number, db: Db = sql()): Promise<{ record: BuilderRecord; broken: boolean }> {
  const [r] = await db<{ record: unknown }[]>`SELECT record FROM builders WHERE id = ${builderId}`;
  return readRecord(r?.record ?? {}, builderId);
}

/** The builder's record; an unreadable row reads as the empty record. */
export async function getRecord(builderId: number, db?: Db): Promise<BuilderRecord> {
  return (await readStoredRecord(builderId, db)).record;
}

export async function saveRecord(builderId: number, record: BuilderRecord, now: Date, db: Db = sql()): Promise<void> {
  await db`UPDATE builders SET record = ${sql().json(JSON.parse(JSON.stringify(record)))}, record_updated_at = ${now} WHERE id = ${builderId}`;
}

/**
 * Runs `fn` on the record under the row's lock (one transaction) and saves the record it returns,
 * unless that is null. An unreadable row is never passed to `fn` nor saved over: `broken` is true.
 */
export async function withRecord<T>(
  builderId: number,
  now: Date,
  fn: (current: BuilderRecord) => { record: BuilderRecord | null; result: T },
): Promise<{ broken: true } | { broken: false; record: BuilderRecord; result: T }> {
  return inTx(undefined, async (tx) => {
    const [r] = await tx<{ record: unknown }[]>`SELECT record FROM builders WHERE id = ${builderId} FOR UPDATE`;
    const read = readRecord(r?.record ?? {}, builderId);
    if (read.broken) return { broken: true as const };
    const out = fn(read.record);
    if (out.record) await saveRecord(builderId, out.record, now, tx);
    return { broken: false as const, record: out.record ?? read.record, result: out.result };
  });
}

export async function touchBuilder(id: number, now: Date): Promise<void> {
  await sql()`UPDATE builders SET last_seen_at = GREATEST(last_seen_at, ${now}) WHERE id = ${id}`;
}

/**
 * Links the installation to the builder and re-keys its ledger, in one transaction (the caller's
 * when `db` is one). On a program both ledgers hold, the stronger row stays and the other is dropped (v6.1.8 B15): a
 * result beats an application, which beats a claim or a skip; won beats rejected beats no_result whatever the time
 * (v6.1.9 N3); of two equal ones the newer `at` stays. History is
 * all kept; duplicate gap items are dropped. `migrated`: the applications moved. Linked to another
 * builder: LinkRefused and nothing changes; to this one again: only stray i: rows move.
 */
export async function linkInstallation(installationId: number, builderId: number, now: Date, db?: Db): Promise<{ migrated: number }> {
  const from = ownerKey(installationId, null);
  const to = ownerKey(installationId, builderId);
  return inTx(db, async (tx) => {
    const [inst] = await tx<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${installationId} FOR UPDATE`;
    if (inst?.builder_id != null && inst.builder_id !== builderId) throw new LinkRefused('other_builder');
    if (inst?.builder_id == null)
      // Task 9 fix round 1 (N5): a promise kept before the link was never this builder's.
      await tx`UPDATE installations SET builder_id = ${builderId}, linked_at = ${now}, unlinked_at = NULL, unlinked_reason = NULL, promised = NULL, promised_at = NULL, former_builder_id = NULL WHERE id = ${installationId}`;
    // Rows of both ledgers are locked in a stable order, so two links to one builder never interleave.
    await tx`SELECT 1 FROM applications WHERE owner IN (${from}, ${to}) ORDER BY owner, program_id FOR UPDATE`;
    // T5-F6 (v6.1.14): the dropped row's application id, carried onto the kept row when that one has none.
    // L28-4 (v6.1.16 Task 14): rows are one per program and project, so only the same project's rows meet. L35-2
    // (v6.1.16.1 Task 2): the same identity is the same project.
    const both = await tx<{ program_id: string; project_id: string | null; i_id: string | null; b_id: string | null }[]>`
      SELECT i.program_id, i.project_id, i.application_id AS i_id, b.application_id AS b_id FROM applications i JOIN applications b
        ON b.owner = ${to} AND b.program_id = i.program_id AND (COALESCE(b.project_id, '') = COALESCE(i.project_id, '') OR b.identity = i.identity) WHERE i.owner = ${from}`;
    // A later skip or claim from the unlinked time never replaces a win or an application (lane 7 relink); among
    // results, won beats rejected beats no_result whatever the time (v6.1.9 N3): a relink never loses a win.
    await tx`DELETE FROM applications i USING applications b
      WHERE i.owner = ${from} AND b.owner = ${to} AND i.program_id = b.program_id AND (COALESCE(i.project_id, '') = COALESCE(b.project_id, '') OR i.identity = b.identity)
        AND ((CASE i.status WHEN 'won' THEN 5 WHEN 'rejected' THEN 4 WHEN 'no_result' THEN 3 WHEN 'applied' THEN 2 ELSE 1 END)
          < (CASE b.status WHEN 'won' THEN 5 WHEN 'rejected' THEN 4 WHEN 'no_result' THEN 3 WHEN 'applied' THEN 2 ELSE 1 END)
          OR ((CASE i.status WHEN 'won' THEN 5 WHEN 'rejected' THEN 4 WHEN 'no_result' THEN 3 WHEN 'applied' THEN 2 ELSE 1 END)
            = (CASE b.status WHEN 'won' THEN 5 WHEN 'rejected' THEN 4 WHEN 'no_result' THEN 3 WHEN 'applied' THEN 2 ELSE 1 END) AND i.at <= b.at))`;
    await tx`DELETE FROM applications b USING applications i
      WHERE b.owner = ${to} AND i.owner = ${from} AND i.program_id = b.program_id AND (COALESCE(i.project_id, '') = COALESCE(b.project_id, '') OR i.identity = b.identity)`;
    const moved = await tx`UPDATE applications SET owner = ${to} WHERE owner = ${from}`;
    for (const p of both) {
      const id = p.i_id ?? p.b_id;
      if (id) await tx`UPDATE applications SET application_id = ${id} WHERE owner = ${to} AND program_id = ${p.program_id} AND COALESCE(project_id, '') = ${p.project_id ?? ''} AND application_id IS NULL`;
    }
    await tx`UPDATE application_history SET owner = ${to} WHERE owner = ${from}`;
    // A done step keeps its project (v6.1.10 L1c-1): only the same project's repeat is merged.
    await tx`DELETE FROM gaps_done i USING gaps_done b
      WHERE i.owner = ${from} AND b.owner = ${to} AND i.project_key = b.project_key AND i.program_id = b.program_id AND i.item = b.item`;
    await tx`UPDATE gaps_done SET owner = ${to} WHERE owner = ${from}`;
    // The reported projects (v6.1.13): the newer report of one project stays.
    await tx`DELETE FROM project_reports i USING project_reports b
      WHERE i.owner = ${from} AND b.owner = ${to} AND i.project_key = b.project_key AND i.at <= b.at`;
    await tx`DELETE FROM project_reports b USING project_reports i
      WHERE b.owner = ${to} AND i.owner = ${from} AND i.project_key = b.project_key`;
    await tx`UPDATE project_reports SET owner = ${to} WHERE owner = ${from}`;
    return { migrated: moved.count };
  });
}

/**
 * Unlinks the builder's own installation (v6.1.7 B10): its ledger rows stay with the builder, and `unlinked_at`
 * marks it so the agent's next find says it was unlinked. False when it is not this builder's. In the same
 * transaction its claims in the builder's ledger are released (L13-2, v6.1.14), so the builder's other agents send
 * them at once; its later calls write its own ledger, never the builder's.
 */
export async function unlinkInstallation(installationId: number, builderId: number, now: Date): Promise<boolean> {
  const owner = `b:${builderId}`;
  return sql().begin(async (tx) => {
    // T5-F4 (v6.1.14): the ledger's per-program lock on each of its claims first (in one order, so two unlinks never
    // deadlock), then the installation's row; a send or claim in flight either lands before the unlink or sees it
    // (ledger.record and claims.claim read the installation FOR SHARE under the same lock).
    const held = await tx<{ program_id: string }[]>`SELECT program_id FROM applications
      WHERE owner = ${owner} AND status = 'started' AND claimed_by = ${installationId} ORDER BY program_id`;
    for (const h of held) await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + h.program_id}))`;
    // Task 9 fix round 1 (N5): the standing-approval promise was the builder's, so it goes with the link.
    // L28-10 (v6.1.16 Task 14): the builder's rows stay theirs; the installation remembers whose they are, so it never
    // sends again what that builder sent.
    const r = await tx`UPDATE installations SET builder_id = NULL, linked_at = NULL, unlinked_at = ${now}, unlinked_reason = 'unlinked', promised = NULL, promised_at = NULL,
        former_builder_id = ${builderId}
      WHERE id = ${installationId} AND builder_id = ${builderId}`;
    if (r.count === 0) return false;
    await tx`DELETE FROM applications WHERE owner = ${owner} AND status = 'started' AND claimed_by = ${installationId}`;
    // v6.1.16 Task 9 N5 (v6.1.17 Task 3): this agent's results-question markers for the builder go with the link.
    await tx`DELETE FROM outcome_asks WHERE installation_id = ${installationId} AND owner = ${owner}`;
    // v6.1.18 Task 4: and its sent-question markers.
    await tx`DELETE FROM sent_asks WHERE installation_id = ${installationId} AND owner = ${owner}`;
    return true;
  }) as Promise<boolean>;
}

/** True after an unlink until the notice is taken; reads only. A linked installation has none. */
export async function hasUnlinkedNotice(installationId: number): Promise<boolean> {
  const [r] = await sql()`SELECT 1 FROM installations WHERE id = ${installationId} AND unlinked_at IS NOT NULL AND builder_id IS NULL`;
  return Boolean(r);
}

/** Why the installation was unlinked, while its notice is untaken: on /me ('unlinked') or with the account ('deleted',
 *  v6.1.8 C51); a mark from before v6.1.8 reads as 'unlinked'. Null when there is none to show. */
export async function unlinkedReason(installationId: number): Promise<'unlinked' | 'deleted' | null> {
  const [r] = await sql()<{ reason: string | null }[]>`SELECT unlinked_reason AS reason FROM installations
    WHERE id = ${installationId} AND unlinked_at IS NOT NULL AND builder_id IS NULL`;
  return r ? (r.reason === 'deleted' ? 'deleted' : 'unlinked') : null;
}

/** True once after an unlink (find shows the notice); clears the mark. A linked installation has none to take. */
export async function takeUnlinkedNotice(installationId: number): Promise<boolean> {
  const r = await sql()`UPDATE installations SET unlinked_at = NULL, unlinked_reason = NULL
    WHERE id = ${installationId} AND unlinked_at IS NOT NULL AND builder_id IS NULL`;
  return r.count > 0;
}

/**
 * Removes the builder and everything theirs: sessions, their installations' link codes, the b: ledger, and their
 * reviewer rows (v6.1.7 B11). The screens they queued, with their applicants and outcomes, belong to the program and
 * stay, no longer tied to the builder (L15-18, v6.1.14). One transaction. Each linked installation is marked, so its
 * next call says the record was deleted (v6.1.8 C51).
 */
export async function deleteBuilder(id: number, now: Date = new Date()): Promise<void> {
  const owner = `b:${id}`;
  await sql().begin(async (tx) => {
    await tx`DELETE FROM sessions WHERE builder_id = ${id}`;
    await tx`DELETE FROM program_reviewers WHERE builder_id = ${id}`;
    await tx`UPDATE screen_jobs SET builder_id = NULL WHERE builder_id = ${id}`;
    await tx`DELETE FROM link_codes WHERE installation_id IN (SELECT id FROM installations WHERE builder_id = ${id})`;
    await tx`DELETE FROM applications WHERE owner = ${owner}`;
    await tx`DELETE FROM application_history WHERE owner = ${owner}`;
    await tx`DELETE FROM gaps_done WHERE owner = ${owner}`;
    await tx`DELETE FROM project_reports WHERE owner = ${owner}`;
    // v6.1.16 Task 9: the results-question markers and the promised sends go with the account.
    await tx`DELETE FROM outcome_asks WHERE owner = ${owner}`;
    await tx`DELETE FROM sent_asks WHERE owner = ${owner}`;
    await tx`UPDATE installations SET builder_id = NULL, linked_at = NULL, unlinked_at = ${now}, unlinked_reason = 'deleted', promised = NULL, promised_at = NULL WHERE builder_id = ${id}`;
    // L28-10: a deleted record is nothing to read back.
    await tx`UPDATE installations SET former_builder_id = NULL WHERE former_builder_id = ${id}`;
    await tx`DELETE FROM builders WHERE id = ${id}`;
  });
}
