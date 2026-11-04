/**
 * The programs table: reading the open and listed programs, one program by id, and writing one
 * (from a file or the write API). The record is stored whole in `file`; status, ends_at and the
 * other columns mirror it for queries. A row whose record no longer parses is skipped.
 */
import { inTx, sql, type Db } from './db';
import { ProgramFile, categoryOf, type Program } from './program-file';

export type ProgramRow = {
  id: string;
  file: Program;
  source: 'file' | 'api';
  created_at: Date;
  updated_at: Date;
  verified_at: Date | null;
  stale_since: Date | null;
};

/** The fields whose change is recorded in program_changes. */
export const CHANGE_FIELDS = ['ends_at', 'max_award_usd', 'status', 'submission_url', 'submission_requirements', 'form'] as const;

/** Days a program may stay stale, or an API program unverified, before it drops out. */
export const STALE_DAYS = 14;

type RawRow = Omit<ProgramRow, 'file'> & { file: unknown };

function parseRows(rows: readonly RawRow[]): ProgramRow[] {
  const out: ProgramRow[] = [];
  for (const r of rows) {
    const parsed = ProgramFile.safeParse(r.file);
    if (parsed.success) out.push({ ...r, file: parsed.data });
  }
  const skipped = rows.length - out.length;
  if (skipped > 0) console.warn(`[programs] rows skipped, record does not parse: ${skipped}`);
  return out;
}

/** Active, not past ends_at, not stale over 14 days and, for an API program, verified in the last 14 days. */
export async function listOpenPrograms(now: Date = new Date()): Promise<ProgramRow[]> {
  return listWhere(now, false);
}

/** The open programs plus the upcoming ones (listed, not yet open). */
export async function listListedPrograms(now: Date = new Date()): Promise<ProgramRow[]> {
  return listWhere(now, true);
}

async function listWhere(now: Date, withUpcoming: boolean): Promise<ProgramRow[]> {
  const db = sql();
  const rows = await db<RawRow[]>`
    SELECT id, file, source, created_at, updated_at, verified_at, stale_since FROM programs
    WHERE (
        (status = 'active' AND (ends_at IS NULL OR ends_at > ${now}))
        ${withUpcoming ? db`OR status = 'upcoming'` : db``}
      )
      AND NOT (stale_since IS NOT NULL AND stale_since < ${now}::timestamptz - make_interval(days => ${STALE_DAYS}))
      AND NOT (source = 'api' AND (verified_at IS NULL OR verified_at < (${now}::timestamptz - make_interval(days => ${STALE_DAYS}))::date))
    ORDER BY ends_at ASC NULLS LAST, id`;
  return parseRows(rows);
}

export async function getProgram(id: string): Promise<ProgramRow | null> {
  const rows = await sql()<RawRow[]>`
    SELECT id, file, source, created_at, updated_at, verified_at, stale_since FROM programs WHERE id = ${id}`;
  return parseRows(rows)[0] ?? null;
}

/** Whether the program takes entries at `now`: active and not past ends_at. Pure. */
export const isOpen = (p: Pick<Program, 'status' | 'ends_at'>, now: Date): boolean =>
  p.status === 'active' && (p.ends_at === null || Date.parse(p.ends_at) > now.getTime());

/** JSON with sorted keys, so two equal records compare equal whatever their key order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  ) ?? 'undefined';
}

const sameField = (k: (typeof CHANGE_FIELDS)[number], a: unknown, b: unknown): boolean =>
  k === 'ends_at' && typeof a === 'string' && typeof b === 'string' ? Date.parse(a) === Date.parse(b) : canonical(a) === canonical(b);

/**
 * Writes the program (parsed first, so the stored record always parses). 'unchanged' when the
 * record and the writer are the same; on an update, one program_changes row names the changed
 * CHANGE_FIELDS, when there are any. In the caller's transaction when `db` is one.
 */
export async function upsertProgram(
  p: Program,
  source: 'file' | 'api',
  now: Date = new Date(),
  db?: Db,
): Promise<'created' | 'updated' | 'unchanged'> {
  const file = ProgramFile.parse(p);
  return inTx(db, async (tx) => {
    const cols = {
      file: tx.json(JSON.parse(JSON.stringify(file))),
      source,
      category: categoryOf(file),
      status: file.status,
      ends_at: file.ends_at,
      max_award_usd: file.max_award_usd ?? null,
      verified_at: file.verified_at,
      updated_at: now,
    };
    const [old] = await tx<{ file: Record<string, unknown> | null; source: string }[]>`
      SELECT file, source FROM programs WHERE id = ${file.id} FOR UPDATE`;
    if (!old) {
      await tx`INSERT INTO programs ${tx({ id: file.id, ...cols, created_at: now })}`;
      return 'created';
    }
    if (old.source === source && canonical(old.file) === canonical(file)) return 'unchanged';
    await tx`UPDATE programs SET ${tx(cols)} WHERE id = ${file.id}`;
    const fields = CHANGE_FIELDS.filter((k) => !sameField(k, old.file?.[k], file[k]));
    if (fields.length > 0) await tx`INSERT INTO program_changes ${tx({ program_id: file.id, at: now, fields })}`;
    return 'updated';
  }) as Promise<'created' | 'updated' | 'unchanged'>;
}
