/**
 * The builder's ledger, keyed by installation only: applications (one row per program, plus an
 * append-only history), closed gap items, and the summary `track` and `find` show.
 */
import { sql } from './db';
import { getProgram, programsById, type ProgramRow } from './programs';

export type Status = 'applied' | 'won' | 'rejected' | 'no_result' | 'skipped' | 'gap_done';
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

export async function record(
  installationId: number,
  programId: string,
  status: Status,
  o: { amount_usd?: number; note?: string; item?: string; now?: Date } = {},
): Promise<{ ok: true } | { ok: false; note: string }> {
  const now = o.now ?? new Date();
  if (!(await getProgram(programId))) return { ok: false, note: "I don't know that program." };
  if (status === 'won' && !(typeof o.amount_usd === 'number' && Number.isFinite(o.amount_usd) && o.amount_usd > 0))
    return { ok: false, note: 'Tell me how much you won, as a number above zero.' };
  if (status === 'gap_done' && !o.item) return { ok: false, note: 'Tell me which item you finished.' };
  const amount = status === 'won' ? o.amount_usd! : null;
  const note = o.note ?? null;

  return (await sql().begin(async (tx) => {
    const [row] = await tx<{ status: string }[]>`
      SELECT status FROM applications WHERE installation_id = ${installationId} AND program_id = ${programId} FOR UPDATE`;
    if (status === 'applied' && row && RESULTS.includes(row.status))
      return { ok: false, note: 'That one already has a result here.' } as const;
    if (RESULTS.includes(status) && (!row || row.status === 'skipped')) return { ok: false, note: "You haven't applied to that one here." } as const;
    if (status === 'gap_done') {
      await tx`INSERT INTO gaps_done (installation_id, program_id, item, at) VALUES (${installationId}, ${programId}, ${o.item!}, ${now})
        ON CONFLICT (installation_id, program_id, item) DO UPDATE SET at = EXCLUDED.at`;
    } else if (!(status === 'skipped' && row)) {
      // A skip on a program already in the ledger hides nothing new: the application stays as it is.
      await tx`INSERT INTO applications (installation_id, program_id, status, amount_usd, note, at)
        VALUES (${installationId}, ${programId}, ${status}, ${amount}, ${note}, ${now})
        ON CONFLICT (installation_id, program_id) DO UPDATE
          SET status = EXCLUDED.status, amount_usd = EXCLUDED.amount_usd, note = EXCLUDED.note, at = EXCLUDED.at`;
    }
    await tx`INSERT INTO application_history (installation_id, program_id, status, amount_usd, note, at)
      VALUES (${installationId}, ${programId}, ${status}, ${amount}, ${note}, ${now})`;
    return { ok: true } as const;
  })) as { ok: true } | { ok: false; note: string };
}

export async function summary(installationId: number, programs: ProgramRow[], now: Date): Promise<Ledger> {
  const rows = await sql()<{ program_id: string; status: string; amount_usd: string | null }[]>`
    SELECT program_id, status, amount_usd FROM applications WHERE installation_id = ${installationId}`;
  const byId = await withOwn(rows.map((r) => r.program_id), programs);
  const l: Ledger = { applied: 0, asked_usd: 0, won: 0, won_usd: 0, pending: 0, rejected: 0, skipped: 0, closing_soon: [] };
  const soon: { program_id: string; title: string; at: number }[] = [];
  for (const r of rows) {
    if (r.status === 'skipped') {
      l.skipped++;
      continue;
    }
    l.applied++;
    const p = byId.get(r.program_id);
    l.asked_usd += p?.file.max_award_usd ?? 0;
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

/** Program ids the builder applied to or skipped: they leave the list. */
export async function excluded(installationId: number): Promise<Set<string>> {
  const rows = await sql()<{ program_id: string }[]>`SELECT program_id FROM applications WHERE installation_id = ${installationId}`;
  return new Set(rows.map((r) => r.program_id));
}

export async function doneItems(installationId: number, programId: string): Promise<Set<string>> {
  const rows = await sql()<{ item: string }[]>`
    SELECT item FROM gaps_done WHERE installation_id = ${installationId} AND program_id = ${programId}`;
  return new Set(rows.map((r) => r.item));
}

/** Applied programs whose results date has passed and that the builder has not been asked about. */
export async function askOutcome(installationId: number, programs: ProgramRow[], now: Date): Promise<{ program_id: string; title: string }[]> {
  const rows = await sql()<{ program_id: string }[]>`
    SELECT program_id FROM applications
    WHERE installation_id = ${installationId} AND status = 'applied' AND asked_outcome_at IS NULL`;
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

export async function markAsked(installationId: number, programIds: string[], now: Date): Promise<void> {
  if (programIds.length === 0) return;
  await sql()`UPDATE applications SET asked_outcome_at = ${now}
    WHERE installation_id = ${installationId} AND program_id IN ${sql()(programIds)}`;
}
