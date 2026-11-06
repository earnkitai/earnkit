/**
 * Claims: before an agent fills a form it claims the program for the builder (an applications row with
 * status 'started'), so no other agent of theirs submits it within 24 hours; one claim at a time per
 * owner and program (an advisory lock). A claim with no 'applied' after 24 hours is released.
 */
import { sql } from '../v5/db';
import { programsById } from '../v5/programs';

export const CLAIM_HOURS = 24;
const HOUR = 3_600_000;
type Already = { since: string; by: string | null };
export type ClaimResult = { ok: true } | { ok: false; already: Already } | { ok: false; skipped: true };
type Row = { status: string; claimed_at: Date | null; claimed_by: number | null; installation_id: number; at: Date };

const clientOf = async (installationId: number | null): Promise<string | null> => {
  if (installationId === null) return null;
  const [r] = await sql()<{ client_name: string | null }[]>`SELECT client_name FROM installations WHERE id = ${installationId}`;
  return r?.client_name ?? null;
};

/** Who holds the row: a live claim's agent and time, or the sending installation and its time. */
const holder = (row: Row) => (row.status === 'started' ? { since: row.claimed_at ?? row.at, by: row.claimed_by } : { since: row.at, by: row.installation_id });

/**
 * Claims the program for the owner. A live claim (under 24 hours) or an application already sent answers
 * `already` with when and which agent; a skip answers `skipped`; only a stale claim is taken over.
 */
export async function claim(owner: string, programId: string, projectId: string | null, installationId: number, now: Date): Promise<ClaimResult> {
  const stale = new Date(now.getTime() - CLAIM_HOURS * HOUR);
  const out = await sql().begin(async (tx) => {
    // One claim decision at a time per owner and program, even when no row exists yet.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + programId}))`;
    const read = async () =>
      (await tx<Row[]>`SELECT status, claimed_at, claimed_by, installation_id, at FROM applications WHERE owner = ${owner} AND program_id = ${programId} FOR UPDATE`)[0];
    const row = await read();
    if (row?.status === 'skipped') return { skipped: true as const };
    if (row && !(row.status === 'started' && row.claimed_at && row.claimed_at <= stale)) return { held: holder(row) };
    const won = await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, note, at, project_id, claimed_at, claimed_by)
      VALUES (${owner}, ${installationId}, ${programId}, 'started', NULL, NULL, ${now}, ${projectId}, ${now}, ${installationId})
      ON CONFLICT (owner, program_id) DO UPDATE
        SET installation_id = EXCLUDED.installation_id, status = 'started', amount_usd = NULL, note = NULL, at = EXCLUDED.at,
            project_id = EXCLUDED.project_id, claimed_at = EXCLUDED.claimed_at, claimed_by = EXCLUDED.claimed_by,
            submitted_by = NULL, fields_used = NULL, auto_applied = false
        WHERE applications.status = 'started' AND applications.claimed_at <= ${stale}
      RETURNING program_id`;
    if (won.length === 0) {
      const now2 = await read();
      return now2 ? { held: holder(now2) } : { skipped: true as const };
    }
    await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, note, at)
      VALUES (${owner}, ${installationId}, ${programId}, 'started', NULL, NULL, ${now})`;
    return { ok: true as const };
  });
  if ('ok' in out) return { ok: true };
  if ('skipped' in out) return { ok: false, skipped: true };
  return { ok: false, already: { since: out.held.since.toISOString(), by: await clientOf(out.held.by) } };
}

/** Deletes the owner's claims older than 24 hours that never became 'applied'; returns their program ids. */
export async function releaseStale(owner: string, now: Date): Promise<string[]> {
  const stale = new Date(now.getTime() - CLAIM_HOURS * HOUR);
  const rows = await sql()<{ program_id: string }[]>`
    DELETE FROM applications WHERE owner = ${owner} AND status = 'started' AND claimed_at <= ${stale} RETURNING program_id`;
  return rows.map((r) => r.program_id).sort();
}

/** Applications sent under the builder's standing approval after `since` (the last find); none when there was no find. */
export async function appliedOvernight(owner: string, since: Date | null): Promise<{ program_id: string; title: string }[]> {
  if (!since) return [];
  const rows = await sql()<{ program_id: string }[]>`
    SELECT program_id FROM applications
    WHERE owner = ${owner} AND status = 'applied' AND auto_applied AND at > ${since} ORDER BY at, program_id`;
  const byId = new Map((await programsById(rows.map((r) => r.program_id))).map((p) => [p.id, p]));
  return rows.map((r) => ({ program_id: r.program_id, title: byId.get(r.program_id)?.file.title ?? r.program_id }));
}
