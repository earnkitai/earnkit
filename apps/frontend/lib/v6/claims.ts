/**
 * Claims: before an agent fills a form it claims the program for the builder (an applications row with
 * status 'started'), so no other agent of theirs submits it within 24 hours. A claim with no 'applied'
 * after 24 hours is released and named in the next find.
 */
import { sql } from '../v5/db';
import { programsById } from '../v5/programs';

export const CLAIM_HOURS = 24;
const HOUR = 3_600_000;
type Already = { since: string; by: string | null };

const clientOf = async (installationId: number | null): Promise<string | null> => {
  if (installationId === null) return null;
  const [r] = await sql()<{ client_name: string | null }[]>`SELECT client_name FROM installations WHERE id = ${installationId}`;
  return r?.client_name ?? null;
};

/**
 * Claims the program for the owner. A live claim (under 24 hours) or an application already sent
 * answers `already` with when and which agent; a stale claim or a skip is taken over.
 */
export async function claim(owner: string, programId: string, projectId: string | null, installationId: number, now: Date): Promise<{ ok: true } | { ok: false; already: Already }> {
  const stale = new Date(now.getTime() - CLAIM_HOURS * HOUR);
  const out = await sql().begin(async (tx) => {
    const [row] = await tx<{ status: string; claimed_at: Date | null; claimed_by: number | null; installation_id: number; at: Date }[]>`
      SELECT status, claimed_at, claimed_by, installation_id, at FROM applications WHERE owner = ${owner} AND program_id = ${programId} FOR UPDATE`;
    if (row && row.status === 'started' && row.claimed_at && row.claimed_at > stale)
      return { ok: false as const, since: row.claimed_at, by: row.claimed_by };
    if (row && row.status !== 'started' && row.status !== 'skipped') return { ok: false as const, since: row.at, by: row.installation_id };
    await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, note, at, project_id, claimed_at, claimed_by)
      VALUES (${owner}, ${installationId}, ${programId}, 'started', NULL, NULL, ${now}, ${projectId}, ${now}, ${installationId})
      ON CONFLICT (owner, program_id) DO UPDATE
        SET installation_id = EXCLUDED.installation_id, status = 'started', amount_usd = NULL, note = NULL, at = EXCLUDED.at,
            project_id = EXCLUDED.project_id, claimed_at = EXCLUDED.claimed_at, claimed_by = EXCLUDED.claimed_by,
            submitted_by = NULL, fields_used = NULL`;
    await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, note, at)
      VALUES (${owner}, ${installationId}, ${programId}, 'started', NULL, NULL, ${now})`;
    return { ok: true as const };
  });
  if (out.ok) return { ok: true };
  return { ok: false, already: { since: out.since.toISOString(), by: await clientOf(out.by) } };
}

/** Deletes the owner's claims older than 24 hours that never became 'applied'; returns their program ids. */
export async function releaseStale(owner: string, now: Date): Promise<string[]> {
  const stale = new Date(now.getTime() - CLAIM_HOURS * HOUR);
  const rows = await sql()<{ program_id: string }[]>`
    DELETE FROM applications WHERE owner = ${owner} AND status = 'started' AND claimed_at <= ${stale} RETURNING program_id`;
  return rows.map((r) => r.program_id).sort();
}

/** Applications an agent submitted after `since` (the last find); none when there was no find. */
export async function appliedOvernight(owner: string, since: Date | null): Promise<{ program_id: string; title: string }[]> {
  if (!since) return [];
  const rows = await sql()<{ program_id: string }[]>`
    SELECT program_id FROM applications
    WHERE owner = ${owner} AND status = 'applied' AND submitted_by = 'agent' AND at > ${since} ORDER BY at, program_id`;
  const byId = new Map((await programsById(rows.map((r) => r.program_id))).map((p) => [p.id, p]));
  return rows.map((r) => ({ program_id: r.program_id, title: byId.get(r.program_id)?.file.title ?? r.program_id }));
}
