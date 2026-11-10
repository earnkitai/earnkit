/**
 * The builder's ledger, keyed by its owner ('b:<builder>' once linked, else 'i:<installation>'):
 * applications (one row per program, plus an append-only history), closed gap items, and the
 * summary `track` and `find` show. One application and one result per program: a second `applied`, or a result
 * over a result, is refused and changes nothing. A win is whole dollars; one over the program's stated maximum, else
 * its pool, else 10,000,000, is refused; investments are never "asked".
 */
import { sql, type Db } from './db';
import { categoryOf, eligibilityOf } from './program-file';
import { itemKey } from './eligibility';
import { getProgram, programsById, type ProgramRow } from './programs';

/** gap_done without a known item (v6.1.8, 3.10): the builder names the change, the agent gets the item keys. */
export const WHICH_CHANGE = 'Which change did you finish? Say the program and the change.';

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
/** The most a win can be when the program states neither a maximum nor a pool. */
const MAX_WIN_USD = 10_000_000;
/** The most a win in this program can be: its maximum, else its pool, else MAX_WIN_USD. Pure. */
export const winCapOf = (program: ProgramRow | null | undefined): number => program?.file.max_award_usd ?? program?.file.pool_usd ?? MAX_WIN_USD;
/** A win over the program's cap is refused with this line, in the ledger and in a program's screen outcomes (v6.1.7 C38). */
export const OVER_CAP = "That's more than this program pays; check the amount.";
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

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
/** "Nov 4": a day in UTC. Pure. */
const dayOf = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);
/** "won $3,000", "rejected", "no result": a row's result in words. Pure. */
const resultWords = (status: string, amount: string | null) =>
  status === 'won' ? `won ${usd(Number(amount ?? 0))}` : status === 'no_result' ? 'no result' : status;

/** The program's title: the catalog's, else the one stored when it was sent, else the id. */
export async function titleOf(owner: string, programId: string): Promise<string> {
  const p = await getProgram(programId);
  if (p) return p.file.title;
  const [r] = await sql()<{ title: string | null }[]>`SELECT title FROM applications WHERE owner = ${owner} AND program_id = ${programId}`;
  return r?.title ?? programId;
}

/**
 * Writes set the owner and the writing installation (`o.installationId`, which an 'i:' owner implies). A `gap_done`
 * with no item, or one that is not one of the program's own item keys (`users` only when it has a users item, v6.1.7
 * C27), is refused and clears nothing; the refusal carries the keys for the agent in `items`, never in builder text.
 * A `gap_done` whose item was already noted answers `repeated` (v6.1.7, C26).
 */
export async function record(
  owner: string,
  programId: string,
  status: Status,
  o: {
    installationId?: number; amount_usd?: number; note?: string; item?: string; now?: Date;
    /** applied only: who pressed submit, the field keys sent and the record's project. */
    submitted_by?: 'agent' | 'builder'; fields_used?: string[]; project_id?: string;
    /** applied only: the builder's standing approval covered this send when it was tracked (track checks the policy). */
    autoApplied?: boolean;
    /** applied with autoApplied: the policy's max_per_night. Counted here under the owner's lock: a send past it is
     *  recorded as not under standing approval and answers `night` (v6.1.8 B18). */
    maxPerNight?: number;
  } = {},
): Promise<{ ok: true; repeated?: true; night?: true } | { ok: false; note: string; items?: string[] }> {
  const installationId = o.installationId ?? installationOf(owner);
  if (installationId === undefined) throw new Error('record needs the writing installation');
  const now = o.now ?? new Date();
  const program = await getProgram(programId);
  const unknown = { ok: false, note: "I don't know that program." } as const;
  // A result may land after the program left the catalog, when the owner's ledger holds it (checked below).
  if (!program && !RESULTS.includes(status)) return unknown;
  if (status === 'won' && !(typeof o.amount_usd === 'number' && Number.isInteger(o.amount_usd) && o.amount_usd >= 1))
    return { ok: false, note: 'Tell me how much you won, as whole dollars.' };
  if (status === 'won' && o.amount_usd! > winCapOf(program)) return { ok: false, note: OVER_CAP };
  if (status === 'gap_done' && program) {
    // Only one of the program's own items; the unknown-users gap ('users') only when it has a users item (v6.1.7, C27).
    const items = eligibilityOf(program.file);
    const keys = [...new Set([...items.map(itemKey), ...(items.some((x) => x.kind === 'users') ? ['users'] : [])])];
    // The keys go to the agent only: builder text never carries them (v6.1.6, 25a); also when no item came (C11).
    if (!o.item || !keys.includes(o.item)) return { ok: false, note: WHICH_CHANGE, items: keys };
  }
  if (status === 'gap_done' && !o.item) return { ok: false, note: WHICH_CHANGE };
  if (status === 'started') throw new Error('a claim is written by claims.claim');
  const amount = status === 'won' ? o.amount_usd! : null;
  const note = o.note ?? null;
  let repeated = false;
  let night = false;

  return (await sql().begin(async (tx) => {
    // One decision at a time per owner and program (the claim's lock), even when no row exists yet.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + programId}))`;
    const [row] = await tx<{ status: string; amount_usd: string | null; at: Date; client_name: string | null }[]>`
      SELECT a.status, a.amount_usd, a.at, i.client_name FROM applications a LEFT JOIN installations i ON i.id = a.installation_id
      WHERE a.owner = ${owner} AND a.program_id = ${programId} FOR UPDATE OF a`;
    if (!program && !row) return unknown;
    const resulted = row && RESULTS.includes(row.status);
    if (resulted && status === 'skipped') return { ok: false, note: 'That one already has a result here; nothing to skip.' } as const;
    if (resulted && RESULTS.includes(status) && row.status === status && (status !== 'won' || Number(row.amount_usd) === amount))
      return { ok: false, note: 'Already recorded.' } as const;
    if (resulted && (status === 'applied' || RESULTS.includes(status)))
      return { ok: false, note: `That one already has a result here: ${resultWords(row.status, row.amount_usd)}.` } as const;
    if (status === 'applied' && row?.status === 'applied')
      return { ok: false, note: `Already sent here on ${dayOf(row.at)} by ${row.client_name ?? 'another agent'}; nothing recorded.` } as const;
    if (RESULTS.includes(status) && (!row || row.status === 'skipped' || row.status === 'started')) return { ok: false, note: "You haven't applied to that one here." } as const;
    if (status === 'unskip') {
      // Only a skipped row can be unskipped: the row goes, and the program can come back in the list.
      if (row?.status !== 'skipped') return { ok: false, note: "That one isn't skipped here." } as const;
      await tx`DELETE FROM applications WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (status === 'gap_done') {
      // xmax = 0 only on a fresh insert: an existing row means the item was already noted.
      const [g] = await tx<{ inserted: boolean }[]>`INSERT INTO gaps_done (owner, installation_id, program_id, item, at) VALUES (${owner}, ${installationId}, ${programId}, ${o.item!}, ${now})
        ON CONFLICT (owner, program_id, item) DO UPDATE SET at = EXCLUDED.at RETURNING (xmax = 0) AS inserted`;
      repeated = !g.inserted;
    } else if (status === 'applied') {
      let auto = o.autoApplied === true;
      if (auto && o.maxPerNight !== undefined) {
        // Tonight's sends under standing approval: the last 24 hours, counted one at a time per owner.
        await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':auto'}))`;
        if ((await autoSentSince(owner, new Date(now.getTime() - DAY), tx, programId)) >= o.maxPerNight) {
          auto = false;
          night = true;
        }
      }
      // Over a claim the row keeps claimed_at and claimed_by: what was claimed, then sent.
      // The title is kept, so a result still reads once the program leaves the catalog.
      // sent_at is the send time: a result later moves `at`, never this (v6.1.9 N2).
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, note, at, sent_at, submitted_by, fields_used, project_id, auto_applied, title)
        VALUES (${owner}, ${installationId}, ${programId}, 'applied', NULL, ${note}, ${now}, ${now}, ${o.submitted_by ?? null}, ${o.fields_used ?? null}, ${o.project_id ?? null}, ${auto}, ${program!.file.title})
        ON CONFLICT (owner, program_id) DO UPDATE
          SET installation_id = EXCLUDED.installation_id, status = 'applied', amount_usd = NULL, note = EXCLUDED.note, at = EXCLUDED.at, sent_at = EXCLUDED.sent_at,
              submitted_by = EXCLUDED.submitted_by, fields_used = EXCLUDED.fields_used, auto_applied = EXCLUDED.auto_applied, title = EXCLUDED.title,
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
    return repeated ? ({ ok: true, repeated: true } as const) : night ? ({ ok: true, night: true } as const) : ({ ok: true } as const);
  })) as { ok: true; repeated?: true; night?: true } | { ok: false; note: string };
}

/**
 * Sends under standing approval since `since` (by the send time; a row from before v6.1.9 without one reads its
 * `at`), other than `except`. The nightly limit counts these (v6.1.9 N2); find subtracts them from tonight (N1).
 */
export async function autoSentSince(owner: string, since: Date, db: Db = sql(), except = ''): Promise<number> {
  const [r] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM applications
    WHERE owner = ${owner} AND auto_applied AND program_id <> ${except} AND COALESCE(sent_at, at) > ${since}`;
  return r.n;
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
