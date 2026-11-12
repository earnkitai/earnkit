/**
 * Claims: before an agent fills a form it claims the program for the builder (an applications row with
 * status 'started'), so no other agent of theirs submits it within 24 hours; one claim at a time per
 * owner and program (an advisory lock). A claim with no 'applied' after 24 hours is released.
 */
import { sql } from '../v5/db';
import { randomBytes } from 'node:crypto';
import type { Db } from '../v5/db';
import { displayName } from '../v5/installations';
import { programsById } from '../v5/programs';
import { claimedForRepo, formerSentAt, pickRow, repoKeyOf, repoLock, sentForRepo, type ParentRepo } from '../v5/ledger';
import { identityFor } from '../v5/project-input';

export const CLAIM_HOURS = 24;
/** L13-1, T5-F1 (v6.1.14): a new application's own id, issued with the claim (else with the send). */
export const newApplicationId = () => `ek-${randomBytes(9).toString('base64url')}`;
const HOUR = 3_600_000;
/** `sent`: the row is an application already sent, not a live claim. */
type Already = { since: string; by: string | null; sent: boolean };
export type ClaimResult =
  | { ok: true } | { ok: false; already: Already } | { ok: false; skipped: true } | { ok: false; unlinked: true }
  /** L28-1 (v6.1.16 Task 14): another account sent this repo to the program; L28-10: the builder this agent was linked to sent it. */
  | { ok: false; repo: { at: Date; login: string | null } } | { ok: false; former: { at: Date } }
  /** L35-4 (v6.1.16.1 Task 2): another builder tied to the repo holds a live claim on it for this program. */
  | { ok: false; cofounder: { at: Date } };

/** T5-F4 (v6.1.14): a send or claim whose agent was unlinked from the builder meanwhile records nothing. */
export const UNLINKED_MEANWHILE = 'This agent was just unlinked from your account; nothing recorded.';
/** L17-9 (v6.1.16): the agent note when a send's record is refused as unlinked: the form already went out. */
export const UNLINKED_SEND_NOTE = 'This agent was unlinked before the send was saved; the form went out but EarnKit holds no record of it. Tell the builder to keep their own note.';
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
type Row = { project_id: string | null; status: string; claimed_at: Date | null; claimed_by: number | null; installation_id: number; at: Date; held_at: Date | null; identity: string | null };

const clientOf = async (installationId: number | null): Promise<string | null> => {
  if (installationId === null) return null;
  const [r] = await sql()<{ client_name: string | null }[]>`SELECT client_name FROM installations WHERE id = ${installationId}`;
  // L25-1 (v6.1.16): the shown name, "Claude Code" for "Claude Code (earnkit)".
  return displayName(r?.client_name);
};

/** Who holds the row: a live claim's agent and time, or the sending installation and its time. */
const holder = (row: Row) => (row.status === 'started' ? { since: row.claimed_at ?? row.at, by: row.claimed_by } : { since: row.at, by: row.installation_id });

/**
 * Claims the program for the owner. A live claim (under 24 hours) by another installation or an application
 * already sent answers `already` with when and which agent; a skip answers `skipped`; a stale claim is taken
 * over, and the claiming installation's own live claim is renewed (claimed_at moves to now).
 */
export async function claim(owner: string, programId: string, projectId: string | null, installationId: number, now: Date, note: string | null = null,
  o: { repoId?: number | null; tied?: boolean; identity?: string | null; parentRepo?: ParentRepo | null } = {}): Promise<ClaimResult> {
  const stale = new Date(now.getTime() - CLAIM_HOURS * HOUR);
  // L28-4 (v6.1.16 Task 14): the claim is (owner, program, project key).
  const key = projectId ?? '';
  // L35-2 (v6.1.16.1 Task 2): and one row per owner, program and identity.
  const identity = o.identity !== undefined ? o.identity || null : identityFor(key, o.repoId);
  const out = await sql().begin(async (tx) => {
    // One claim decision at a time per owner and program, even when no row exists yet.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + programId}))`;
    if (!(await stillLinked(tx, owner, installationId))) return { unlinked: true as const };
    // Fix round 2 (C3): a claim keyed by a repo takes only that key's own row, never a keyless one.
    const read = async () => {
      const rows = await tx<Row[]>`SELECT project_id, status, claimed_at, claimed_by, installation_id, at, held_at, identity FROM applications WHERE owner = ${owner} AND program_id = ${programId} FOR UPDATE`;
      // Controller ruling: an identity match only when that row's key gives the same repo key as this call's.
      const same = identity ? rows.find((r) => r.identity === identity && repoKeyOf(r.project_id) === repoKeyOf(key)) : undefined;
      if (same) return same;
      // Fix round 3 (M4): with the tie shown, the owner's own keyless row is this project's.
      return repoKeyOf(key) ? rows.find((r) => (r.project_id ?? '') === key) ?? (o.tied ? pickRow(rows.filter((r) => (r.project_id ?? '') === ''), '') : undefined) : pickRow(rows, key);
    };
    const row = await read();
    // An identity another of the owner's rows of this program holds (under another repo key) is never written twice.
    const holders = identity ? await tx<{ project_id: string | null }[]>`SELECT project_id FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND identity = ${identity}` : [];
    const ident = holders.some((h) => !row || (h.project_id ?? '') !== (row.project_id ?? '')) ? null : identity;
    let rk = row ? (row.project_id ?? '') : key;
    const repoKey = repoKeyOf(rk || key);
    // L28-1 (v6.1.16 Task 14): one application per repo key per program across owners, under the repo's lock.
    // Controller ruling (v6.1.16.1 Task 2): the repo key from this call's own key always, and the row's when it names another.
    const checkKeys = [...new Set([repoKeyOf(key), repoKeyOf(rk)].filter((x): x is string => x !== null))];
    if (repoKey && (!row || row.status === 'started')) {
      for (const k of checkKeys) {
        const id = k === repoKeyOf(key) ? o.repoId ?? null : null;
        const parent = k === repoKeyOf(key) ? o.parentRepo ?? null : null;
        await repoLock(tx, k, programId, id);
        // L35-3 (v6.1.16.1 Task 2): a fork's parent too.
        if (parent?.key) await repoLock(tx, parent.key, programId, parent.id);
        const other = await sentForRepo(tx, programId, k, owner, id, parent);
        // L35-20: the other builder's login only when the match is by this repo's key.
        if (other) return { repo: { at: other.at, login: other.by === 'key' ? other.login : null } };
        // L35-4 (v6.1.16.1 Task 2): another builder tied to this repo is filling the form now; nothing is written.
        const co = await claimedForRepo(tx, programId, k, owner, id, now);
        if (co) return { cofounder: { at: co.at } };
      }
    }
    // Fix round 3 (M4): the keyless row taken over carries this project's key and repo, under the repo's lock (as
    // record takes it), so two takeovers never both hold the repo. L35-7 (v6.1.16.1 Task 2): decided here, written only
    // once every refusal below has passed.
    const takeOver = Boolean(row && rk === '' && repoKeyOf(key) && o.tied
      && !(await repoLock(tx, repoKeyOf(key)!, programId, o.repoId ?? null).then(() => sentForRepo(tx, programId, key, owner, o.repoId ?? null))));
    // L28-10: an unlinked agent never claims what the builder it was linked to sent.
    if (!row) {
      const before = await formerSentAt(tx, owner, programId, key);
      if (before) return { former: { at: before } };
    }
    if (row?.status === 'skipped') return { skipped: true as const };
    const lifts = row?.status === 'started' && row.held_at !== null;
    const renews = row?.status === 'started' && row.claimed_at && row.claimed_at > stale && row.claimed_by === installationId;
    if (row && !lifts && !renews && !(row.status === 'started' && row.claimed_at && row.claimed_at <= stale)) return { held: holder(row), sent: row.status !== 'started' };
    if (takeOver) {
      await tx`UPDATE applications SET project_id = ${key}, repo_key = ${repoKeyOf(key)}, repo_id = COALESCE(${o.repoId ?? null}::bigint, repo_id), identity = COALESCE(identity, ${ident})
        WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ''`;
      rk = key;
    }
    // L24-4 (v6.1.16 Task 11): a started by any installation lifts the builder's hold and takes the claim.
    if (lifts) {
      await tx`UPDATE applications SET held_at = NULL, claimed_at = ${now}, claimed_by = ${installationId}, installation_id = ${installationId},
          note = COALESCE(${note}, note), application_id = COALESCE(application_id, ${newApplicationId()})
        WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk}`;
      await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, note, at, source, project_id)
        VALUES (${owner}, ${installationId}, ${programId}, 'started', NULL, ${note}, ${now}, 'builder', ${rk || null})`;
      return { ok: true as const };
    }
    if (renews) {
      await tx`UPDATE applications SET claimed_at = ${now}, note = COALESCE(${note}, note), application_id = COALESCE(application_id, ${newApplicationId()})
        WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk}`;
      return { ok: true as const };
    }
    // T5-F1 (v6.1.14): the application's own id is issued with the claim, before the form is filled, so the agent
    // can put it in the form; a stale claim taken over keeps its id; the send keeps it (ledger.record).
    const won = await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, note, at, project_id, claimed_at, claimed_by, application_id, repo_key, repo_id, identity)
      VALUES (${owner}, ${installationId}, ${programId}, 'started', NULL, ${note}, ${now}, ${rk || null}, ${now}, ${installationId}, ${newApplicationId()}, ${repoKeyOf(rk || key)}, ${o.repoId ?? null}, ${row ? null : ident})
      ON CONFLICT (owner, program_id, (COALESCE(project_id, ''))) DO UPDATE
        SET installation_id = EXCLUDED.installation_id, status = 'started', amount_usd = NULL, note = EXCLUDED.note, at = EXCLUDED.at,
            application_id = COALESCE(applications.application_id, EXCLUDED.application_id),
            repo_key = EXCLUDED.repo_key, repo_id = COALESCE(EXCLUDED.repo_id, applications.repo_id), claimed_at = EXCLUDED.claimed_at, claimed_by = EXCLUDED.claimed_by,
            submitted_by = NULL, fields_used = NULL, auto_applied = false, identity = COALESCE(applications.identity, EXCLUDED.identity)
        WHERE applications.status = 'started' AND applications.claimed_at <= ${stale}
      RETURNING program_id`;
    if (won.length === 0) {
      const now2 = await read();
      return now2 ? { held: holder(now2), sent: now2.status !== 'started' } : { skipped: true as const };
    }
    // L17-2 (v6.1.16): every history row names its source; a claim is always an agent's.
    await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, note, at, source, project_id)
      VALUES (${owner}, ${installationId}, ${programId}, 'started', NULL, ${note}, ${now}, 'builder', ${rk || null})`;
    return { ok: true as const };
  });
  if ('ok' in out) return { ok: true };
  if ('unlinked' in out) return { ok: false, unlinked: true };
  if ('skipped' in out) return { ok: false, skipped: true };
  if ('repo' in out && out.repo) return { ok: false, repo: out.repo };
  if ('former' in out && out.former) return { ok: false, former: out.former };
  if ('cofounder' in out && out.cofounder) return { ok: false, cofounder: out.cofounder };
  return { ok: false, already: { since: out.held.since.toISOString(), by: await clientOf(out.held.by), sent: out.sent } };
}

/** A released claim (L23-7, v6.1.16): the program, its title and when it was started. `ask` (L36-2, v6.1.18 Task 4): the
 *  builder sends this program themselves, so the claim was kept and the builder is asked whether it went out. */
export type Released = { program_id: string; title: string; started_at: string; ask?: true };

/**
 * Deletes the owner's claims older than 24 hours (never one the builder held, L24-4) that never became 'applied'; returns them with their titles and when
 * they were started (L23-7, v6.1.16), by program id. L36-2 (v6.1.18 Task 4): a program the builder submits themselves
 * (`submit` 'builder') may have gone out without a record, so its claim is never deleted: it is returned with `ask`
 * on every call, and the caller decides when to ask (sentAsksDue).
 */
export async function releaseStale(owner: string, now: Date): Promise<Released[]> {
  const stale = new Date(now.getTime() - CLAIM_HOURS * HOUR);
  const old = await sql()<{ program_id: string }[]>`
    SELECT program_id FROM applications WHERE owner = ${owner} AND status = 'started' AND held_at IS NULL AND claimed_at <= ${stale}`;
  const byId = new Map((await programsById([...new Set(old.map((r) => r.program_id))])).map((p) => [p.id, p]));
  const keep = [...byId.values()].filter((p) => p.file.submit === 'builder').map((p) => p.id);
  const rows = await sql()<{ program_id: string; title: string | null; claimed_at: Date | null }[]>`
    DELETE FROM applications WHERE owner = ${owner} AND status = 'started' AND held_at IS NULL AND claimed_at <= ${stale}
      AND program_id <> ALL(${keep}::text[]) RETURNING program_id, title, claimed_at`;
  const kept = keep.length === 0 ? [] : await sql()<{ program_id: string; title: string | null; claimed_at: Date | null }[]>`
    SELECT program_id, title, claimed_at FROM applications WHERE owner = ${owner} AND status = 'started' AND held_at IS NULL AND claimed_at <= ${stale}
      AND program_id = ANY(${keep}::text[]) ORDER BY claimed_at`;
  const seen = new Set<string>();
  const asked = kept.filter((r) => !seen.has(r.program_id) && seen.add(r.program_id));
  const of = (r: { program_id: string; title: string | null; claimed_at: Date | null }) =>
    ({ program_id: r.program_id, title: byId.get(r.program_id)?.file.title ?? r.title ?? r.program_id, started_at: (r.claimed_at ?? now).toISOString() });
  return [...rows.map(of), ...asked.map((r) => ({ ...of(r), ask: true as const }))]
    .sort((a, b) => (a.program_id < b.program_id ? -1 : a.program_id > b.program_id ? 1 : 0));
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
