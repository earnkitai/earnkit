/**
 * The builder's ledger, keyed by its owner ('b:<builder>' once linked, else 'i:<installation>'):
 * applications (one row per program, plus an append-only history), closed gap items, and the
 * summary `track` and `find` show. A win over the
 * program's stated maximum (or 5,000,000 when none is stated) is refused; investments are never "asked".
 */
import { sql } from './db';
import { categoryOf } from './program-file';
import { getProgram, programsById, type ProgramRow } from './programs';

/** 'started' is a claim (lib/v6/claims.ts): not an application yet, so the summary leaves it out. */
export type Status = 'started' | 'applied' | 'won' | 'rejected' | 'no_result' | 'skipped' | 'unskip' | 'gap_done';
export type Ledger = {
  applied: number;
  asked_usd: number;
  won: number;
  won_usd: number;
  pending: number;
  rejected: number;
  skipped: number;
  closing_soon: { program_id: string; title: string; closes_at: string }[];
};

const RESULTS = ['won', 'rejected', 'no_result'];
/** The most a win can be when the program states no maximum. */
const MAX_WIN_USD = 5_000_000;
const DAY = 86_400_000;

/** When results are due: the file's date, else the close plus the weeks after, else null. */
function resultsDate(p: ProgramRow): Date | null {
  const r = p.file.results_due;
  if (r?.date) return new Date(r.date);
  if (r?.weeks_after_close !== undefined && p.file.ends_at) return new Date(Date.parse(p.file.ends_at) + r.weeks_after_close * 7 * DAY);
  return null;
}

/** The passed programs plus the rows for the ids the ledger holds (the passed ones win). */
async function withOwn(ids: string[], programs: ProgramRow[]): Promise<Map<string, ProgramRow>> {
  const map = new Map(programs.map((p) => [p.id, p]));
  const missing = ids.filter((id) => !map.has(id));
  for (const p of await programsById(missing)) map.set(p.id, p);
  return map;
}

/** The installation an 'i:' owner names. Pure. */
const installationOf = (owner: string): number | undefined => (/^i:(\d+)$/.exec(owner) ? Number(owner.slice(2)) : undefined);

/** Writes set the owner and the writing installation (`o.installationId`, which an 'i:' owner implies). */
export async function record(
  owner: string,
  programId: string,
  status: Status,
  o: {
    installationId?: number; amount_usd?: number; note?: string; item?: string; now?: Date;
    /** applied only: who pressed submit, the field keys sent and the record's project. */
    submitted_by?: 'agent' | 'builder'; fields_used?: string[]; project_id?: string;
    /** applied only: the builder's standing approval (policy.auto_apply) was on when it was tracked. */
    autoApplied?: boolean;
  } = {},
): Promise<{ ok: true } | { ok: false; note: string }> {
  const installationId = o.installationId ?? installationOf(owner);
  if (installationId === undefined) throw new Error('record needs the writing installation');
  const now = o.now ?? new Date();
  const program = await getProgram(programId);
  if (!program) return { ok: false, note: "I don't know that program." };
  if (status === 'won' && !(typeof o.amount_usd === 'number' && Number.isFinite(o.amount_usd) && o.amount_usd > 0))
    return { ok: false, note: 'Tell me how much you won, as a number above zero.' };
  if (status === 'won' && o.amount_usd! > (program.file.max_award_usd ?? MAX_WIN_USD))
    return { ok: false, note: "That's more than this program pays; check the amount." };
  if (status === 'gap_done' && !o.item) return { ok: false, note: 'Tell me which item you finished.' };
  if (status === 'started') throw new Error('a claim is written by claims.claim');
  const amount = status === 'won' ? o.amount_usd! : null;
  const note = o.note ?? null;

  return (await sql().begin(async (tx) => {
    const [row] = await tx<{ status: string }[]>`
      SELECT status FROM applications WHERE owner = ${owner} AND program_id = ${programId} FOR UPDATE`;
    if (status === 'applied' && row && RESULTS.includes(row.status))
      return { ok: false, note: 'That one already has a result here.' } as const;
    if (RESULTS.includes(status) && (!row || row.status === 'skipped' || row.status === 'started')) return { ok: false, note: "You haven't applied to that one here." } as const;
    if (status === 'unskip') {
      // Only a skipped row can be unskipped: the row goes, and the program can come back in the list.
      if (row?.status !== 'skipped') return { ok: false, note: "That one isn't skipped here." } as const;
      await tx`DELETE FROM applications WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (status === 'gap_done') {
      await tx`INSERT INTO gaps_done (owner, installation_id, program_id, item, at) VALUES (${owner}, ${installationId}, ${programId}, ${o.item!}, ${now})
        ON CONFLICT (owner, program_id, item) DO UPDATE SET at = EXCLUDED.at`;
    } else if (status === 'applied') {
      // Over a claim the row keeps claimed_at and claimed_by: what was claimed, then sent.
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, note, at, submitted_by, fields_used, project_id, auto_applied)
        VALUES (${owner}, ${installationId}, ${programId}, 'applied', NULL, ${note}, ${now}, ${o.submitted_by ?? null}, ${o.fields_used ?? null}, ${o.project_id ?? null}, ${o.autoApplied === true})
        ON CONFLICT (owner, program_id) DO UPDATE
          SET installation_id = EXCLUDED.installation_id, status = 'applied', amount_usd = NULL, note = EXCLUDED.note, at = EXCLUDED.at,
              submitted_by = EXCLUDED.submitted_by, fields_used = EXCLUDED.fields_used, auto_applied = EXCLUDED.auto_applied,
              project_id = COALESCE(EXCLUDED.project_id, applications.project_id)`;
    } else if (status === 'skipped' && row?.status === 'started') {
      // A skip over a claim replaces it: the claim is gone, the skip stays.
      await tx`UPDATE applications SET installation_id = ${installationId}, status = 'skipped', note = ${note}, at = ${now},
        claimed_at = NULL, claimed_by = NULL WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (!(status === 'skipped' && row)) {
      // A skip on a program already in the ledger hides nothing new: the application stays as it is.
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, note, at)
        VALUES (${owner}, ${installationId}, ${programId}, ${status}, ${amount}, ${note}, ${now})
        ON CONFLICT (owner, program_id) DO UPDATE
          SET installation_id = EXCLUDED.installation_id, status = EXCLUDED.status, amount_usd = EXCLUDED.amount_usd, note = EXCLUDED.note, at = EXCLUDED.at`;
    }
    await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, note, at)
      VALUES (${owner}, ${installationId}, ${programId}, ${status}, ${amount}, ${note}, ${now})`;
    return { ok: true } as const;
  })) as { ok: true } | { ok: false; note: string };
}

export async function summary(owner: string, programs: ProgramRow[], now: Date): Promise<Ledger> {
  const rows = await sql()<{ program_id: string; status: string; amount_usd: string | null }[]>`
    SELECT program_id, status, amount_usd FROM applications WHERE owner = ${owner}`;
  const byId = await withOwn(rows.map((r) => r.program_id), programs);
  const l: Ledger = { applied: 0, asked_usd: 0, won: 0, won_usd: 0, pending: 0, rejected: 0, skipped: 0, closing_soon: [] };
  const soon: { program_id: string; title: string; at: number }[] = [];
  for (const r of rows) {
    if (r.status === 'started') continue;
    if (r.status === 'skipped') {
      l.skipped++;
      continue;
    }
    l.applied++;
    const p = byId.get(r.program_id);
    if (p && !p.file.investment && categoryOf(p.file) !== 'investment') l.asked_usd += p.file.max_award_usd ?? 0;
    if (r.status === 'won') {
      l.won++;
      l.won_usd += Number(r.amount_usd ?? 0);
    } else if (r.status === 'rejected') l.rejected++;
    else if (r.status === 'applied') {
      l.pending++;
      if (!p) continue;
      const dates = [p.file.ends_at ? new Date(p.file.ends_at) : null, resultsDate(p)]
        .filter((d): d is Date => d !== null && d.getTime() >= now.getTime() && d.getTime() <= now.getTime() + 7 * DAY)
        .map((d) => d.getTime());
      if (dates.length > 0) soon.push({ program_id: p.id, title: p.file.title, at: Math.min(...dates) });
    }
  }
  l.closing_soon = soon.sort((a, b) => a.at - b.at).map((s) => ({ program_id: s.program_id, title: s.title, closes_at: new Date(s.at).toISOString() }));
  return l;
}

/** Program ids the builder applied to or skipped: they leave the list. A claimed ('started') one stays, marked. */
export async function excluded(owner: string): Promise<Set<string>> {
  const rows = await sql()<{ program_id: string }[]>`SELECT program_id FROM applications WHERE owner = ${owner} AND status <> 'started'`;
  return new Set(rows.map((r) => r.program_id));
}

export async function doneItems(owner: string, programId: string): Promise<Set<string>> {
  const rows = await sql()<{ item: string }[]>`
    SELECT item FROM gaps_done WHERE owner = ${owner} AND program_id = ${programId}`;
  return new Set(rows.map((r) => r.item));
}

/** Every closed gap item of the owner, by program: one query for a whole find. */
export async function doneByProgram(owner: string): Promise<Map<string, Set<string>>> {
  const rows = await sql()<{ program_id: string; item: string }[]>`
    SELECT program_id, item FROM gaps_done WHERE owner = ${owner}`;
  const out = new Map<string, Set<string>>();
  for (const r of rows) out.set(r.program_id, (out.get(r.program_id) ?? new Set<string>()).add(r.item));
  return out;
}

/** Applied programs whose results date has passed and that the builder has not been asked about. */
export async function askOutcome(owner: string, programs: ProgramRow[], now: Date): Promise<{ program_id: string; title: string }[]> {
  const rows = await sql()<{ program_id: string }[]>`
    SELECT program_id FROM applications
    WHERE owner = ${owner} AND status = 'applied' AND asked_outcome_at IS NULL`;
  const open = new Set(rows.map((r) => r.program_id));
  const byId = await withOwn([...open], programs);
  return [...open]
    .map((id) => byId.get(id))
    .filter((p): p is ProgramRow => p !== undefined)
    .filter((p) => {
      const d = resultsDate(p);
      return d !== null && d.getTime() <= now.getTime();
    })
    .map((p) => ({ program_id: p.id, title: p.file.title }));
}

export async function markAsked(owner: string, programIds: string[], now: Date): Promise<void> {
  if (programIds.length === 0) return;
  await sql()`UPDATE applications SET asked_outcome_at = ${now}
    WHERE owner = ${owner} AND program_id IN ${sql()(programIds)}`;
}

/** The owner's live claims by program: when and by which installation. */
export async function claimed(owner: string): Promise<Map<string, { since: string; by: number | null }>> {
  const rows = await sql()<{ program_id: string; claimed_at: Date | null; claimed_by: number | null }[]>`
    SELECT program_id, claimed_at, claimed_by FROM applications WHERE owner = ${owner} AND status = 'started'`;
  return new Map(rows.map((r) => [r.program_id, { since: (r.claimed_at ?? new Date(0)).toISOString(), by: r.claimed_by }]));
}
