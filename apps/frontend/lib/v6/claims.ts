/**
 * Claims: before an agent fills a form it claims the program for the builder (an applications row with
 * status 'started'), so no other agent of theirs submits it within 24 hours; one claim at a time per
 * owner and program (an advisory lock). A claim with no 'applied' after 24 hours is released.
 */
import { sql } from '../v5/db';
import { randomBytes } from 'node:crypto';
import type { Db } from '../v5/db';
import { programsById } from '../v5/programs';

export const CLAIM_HOURS = 24;
/** L13-1, T5-F1 (v6.1.14): a new application's own id, issued with the claim (else with the send). */
export const newApplicationId = () => `ek-${randomBytes(9).toString('base64url')}`;
const HOUR = 3_600_000;
/** `sent`: the row is an application already sent, not a live claim. */
type Already = { since: string; by: string | null; sent: boolean };
export type ClaimResult = { ok: true } | { ok: false; already: Already } | { ok: false; skipped: true } | { ok: false; unlinked: true };

/** T5-F4 (v6.1.14): a send or claim whose agent was unlinked from the builder meanwhile records nothing. */
export const UNLINKED_MEANWHILE = 'This agent was just unlinked from your account; nothing recorded.';
/**
 * T5-F4 (v6.1.14): inside the owner's per-program lock, whether the writing installation still belongs to a 'b:' owner.
 * The installation's row is read FOR SHARE, so an unlink (which updates it) waits for this write, or this write sees
 * the unlink. A 'b:' owner passes only when the installation's row exists and is linked to that builder (fix round 2):
 * a missing row or a NULL builder_id refuses. An 'i:' owner is the installation's own ledger, named by the installation
 * that writes it (ownerKey of an unlinked installation), so no link can be lost: it passes when the owner names the
 * writing installation, else refuses.
 */
export async function stillLinked(tx: Db, owner: string, installationId: number): Promise<boolean> {
  if (owner.startsWith('i:')) return owner === `i:${installationId}`;
  if (!owner.startsWith('b:')) return false;
  const [r] = await tx<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${installationId} FOR SHARE`;
  return r !== undefined && r.builder_id !== null && r.builder_id === Number(owner.slice(2));
}
type Row = { status: string; claimed_at: Date | null; claimed_by: number | null; installation_id: number; at: Date };

const clientOf = async (installationId: number | null): Promise<string | null> => {
  if (installationId === null) return null;
  const [r] = await sql()<{ client_name: string | null }[]>`SELECT client_name FROM installations WHERE id = ${installationId}`;
  return r?.client_name ?? null;
};

/** Who holds the row: a live claim's agent and time, or the sending installation and its time. */
const holder = (row: Row) => (row.status === 'started' ? { since: row.claimed_at ?? row.at, by: row.claimed_by } : { since: row.at, by: row.installation_id });

/**
 * Claims the program for the owner. A live claim (under 24 hours) by another installation or an application
 * already sent answers `already` with when and which agent; a skip answers `skipped`; a stale claim is taken
 * over, and the claiming installation's own live claim is renewed (claimed_at moves to now).
 */
export async function claim(owner: string, programId: string, projectId: string | null, installationId: number, now: Date): Promise<ClaimResult> {
  const stale = new Date(now.getTime() - CLAIM_HOURS * HOUR);
  const out = await sql().begin(async (tx) => {
    // One claim decision at a time per owner and program, even when no row exists yet.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + programId}))`;
    if (!(await stillLinked(tx, owner, installationId))) return { unlinked: true as const };
    const read = async () =>
      (await tx<Row[]>`SELECT status, claimed_at, claimed_by, installation_id, at FROM applications WHERE owner = ${owner} AND program_id = ${programId} FOR UPDATE`)[0];
    const row = await read();
    if (row?.status === 'skipped') return { skipped: true as const };
    if (row?.status === 'started' && row.claimed_at && row.claimed_at > stale && row.claimed_by === installationId) {
      await tx`UPDATE applications SET claimed_at = ${now}, application_id = COALESCE(application_id, ${newApplicationId()})
        WHERE owner = ${owner} AND program_id = ${programId}`;
      return { ok: true as const };
    }
    if (row && !(row.status === 'started' && row.claimed_at && row.claimed_at <= stale)) return { held: holder(row), sent: row.status !== 'started' };
    // T5-F1 (v6.1.14): the application's own id is issued with the claim, before the form is filled, so the agent
    // can put it in the form; a stale claim taken over keeps its id; the send keeps it (ledger.record).
    const won = await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, note, at, project_id, claimed_at, claimed_by, application_id)
      VALUES (${owner}, ${installationId}, ${programId}, 'started', NULL, NULL, ${now}, ${projectId}, ${now}, ${installationId}, ${newApplicationId()})
      ON CONFLICT (owner, program_id) DO UPDATE
        SET installation_id = EXCLUDED.installation_id, status = 'started', amount_usd = NULL, note = NULL, at = EXCLUDED.at,
            application_id = COALESCE(applications.application_id, EXCLUDED.application_id),
            project_id = EXCLUDED.project_id, claimed_at = EXCLUDED.claimed_at, claimed_by = EXCLUDED.claimed_by,
            submitted_by = NULL, fields_used = NULL, auto_applied = false
        WHERE applications.status = 'started' AND applications.claimed_at <= ${stale}
      RETURNING program_id`;
    if (won.length === 0) {
      const now2 = await read();
      return now2 ? { held: holder(now2), sent: now2.status !== 'started' } : { skipped: true as const };
    }
    await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, note, at)
      VALUES (${owner}, ${installationId}, ${programId}, 'started', NULL, NULL, ${now})`;
    return { ok: true as const };
  });
  if ('ok' in out) return { ok: true };
  if ('unlinked' in out) return { ok: false, unlinked: true };
  if ('skipped' in out) return { ok: false, skipped: true };
  return { ok: false, already: { since: out.held.since.toISOString(), by: await clientOf(out.held.by), sent: out.sent } };
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
    WHERE owner = ${owner} AND status = 'applied' AND auto_applied AND COALESCE(sent_at, at) > ${since} ORDER BY COALESCE(sent_at, at), program_id`;
  const byId = new Map((await programsById(rows.map((r) => r.program_id))).map((p) => [p.id, p]));
  return rows.map((r) => ({ program_id: r.program_id, title: byId.get(r.program_id)?.file.title ?? r.program_id }));
}
