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

/** Lower case, accents dropped, every run of other characters one space. Pure. */
const plain = (x: string) => x.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Lower case with no spaces or punctuation: "Y-Combinator", "y combinator" and "ycombinator" are one. Pure. */
const squash = (x: string) => plain(x).replace(/ /g, '');
/** "y-combinator" to "yc": each word's first letter. Pure. */
const initials = (x: string) => plain(x).split(' ').map((w) => w[0] ?? '').join('');
/** One organizer each: "Monad Foundation, OpenBuild and Box" is three. Pure. */
const organizerParts = (x: string) => x.split(/,|&|\band\b/);
/** Without what is in brackets: "Kiro (AWS)" is "Kiro ". Pure. */
const unbracketed = (x: string) => x.replace(/\([^)]*\)/g, ' ');
/**
 * The organizer's whole names (final fix, v6.1.12, I2): each organizer as written and without its brackets, so
 * "Kiro (AWS)" is "kiroaws" and "kiro", never "aws". Pure.
 */
const organizers = (x: string) => organizerParts(x).flatMap((o) => [squash(o), squash(unbracketed(o))]).filter(Boolean);
/** Each organizer's first word: "Ethereum Foundation Trillion Dollar Security Initiative" leads with "ethereum". Pure. */
const organizerLeads = (x: string) => organizerParts(x).map((o) => plain(unbracketed(o)).split(' ')[0]).filter(Boolean);
/** The shortest start of a title or id that names a program (final fix, v6.1.12, I2): "fi" or "aws" name none. */
const MIN_PREFIX = 4;
/** Words that say nothing about which program it is, dropped from a lookup of other words too (L12-3, v6.1.14). */
const COMMON = new Set(['the', 'and', 'for', 'of', 'a', 'an', 'program', 'programs', 'grant', 'grants', 'fund', 'batch', 'cohort']);
/** A year in a lookup ("thiel fellowship 2027") says when, not which (L12-3, v6.1.14). */
const YEAR = /^\d{4}$/;
/** The words a program answers to (L12-3, L12-5, v6.1.14): those of its id, title and organizer, brackets included
 *  ("FLOSS/fund (Zerodha)" answers to "zerodha"). Pure. */
const wordsOfProgram = (r: ProgramRow) => new Set([r.id, r.file.title, r.file.organizer].flatMap((x) => plain(x).split(' ')).filter(Boolean));
/** The money a program puts up: the larger of its top award and its pool, -1 when it states neither. Pure. */
const awardOf = (p: Program) => Math.max(p.max_award_usd ?? -1, p.pool_usd ?? -1);

/**
 * Several programs a name fits, best first (F4, v6.1.12): open ones, then upcoming, then the rest; then the larger award,
 * the sooner close, the id. Pure.
 */
export function byLookupRank(rows: ProgramRow[], now: Date): ProgramRow[] {
  const standing = (p: Program) => (isOpen(p, now) ? 0 : p.status === 'upcoming' ? 1 : 2);
  const ends = (p: Program) => (p.ends_at ? Date.parse(p.ends_at) : Infinity);
  return [...rows].sort((a, b) =>
    standing(a.file) - standing(b.file) || awardOf(b.file) - awardOf(a.file) || ends(a.file) - ends(b.file) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The builder line for a name that is no one program: up to two titles to pick from, as a question alone (L1e-1,
 *  v6.1.13); "I don't know that program." only when nothing is offered. Pure. */
export function unknownProgramLine(suggest: readonly string[]): string {
  const [a, b] = suggest;
  return a === undefined ? "I don't know that program." : `Did you mean ${b === undefined ? a : `${a} or ${b}`}?`;
}

/**
 * A program by what the builder calls it, the one resolver find and track share (v6.1.9; F4, v6.1.12): its id as given,
 * else, case, spaces and punctuation ignored, the first of these that any program fits: its whole id or title, or its
 * id's initials ("yc"); the start of its title or id, four characters at least ("monad", "Base"; never "fi"), an
 * organizer's first word only when that organizer runs no other program ("floss", "thiel"; L1e-1, v6.1.13); one of its
 * organizers' whole names ("Thiel Foundation", "Kiro", never "aws"); else every word of the name (stopwords and years
 * dropped) among one program's id, title and organizer words, brackets included ("paypal hackathon", "zerodha"; L12-3,
 * L12-5, v6.1.14). Exactly one program fitting is the `row`; several are `suggest`, the first two by byLookupRank;
 * none, `suggest` is empty ("I don't know that program.").
 */
export async function programByName(name: string, now: Date = new Date()): Promise<{ row: ProgramRow | null; suggest: string[] }> {
  const exact = await getProgram(name);
  if (exact) return { row: exact, suggest: [] };
  const words = plain(name);
  const q = words.replace(/ /g, '');
  if (!q) return { row: null, suggest: [] };
  const rows = parseRows(await sql()<RawRow[]>`SELECT id, file, source, created_at, updated_at, verified_at, stale_since FROM programs ORDER BY id`);
  const prefix = q.length >= MIN_PREFIX;
  // Final fix (v6.1.12, I2): the first word of an organizer that is not its whole name ("ethereum" for the Ethereum
  // Foundation) names the organizer: a start of a title on it is weighed beside that organizer's other programs
  // ("circle" asks, as Circle runs several). L1e-1 (v6.1.13): when that is exactly one program ("floss", "thiel"),
  // it is the one.
  const led = (r: ProgramRow) => organizerLeads(r.file.organizer).includes(words);
  const orgWord = rows.some((r) => led(r) && !organizers(r.file.organizer).includes(q));
  const tests: [(r: ProgramRow) => boolean, boolean][] = [
    [(r) => squash(r.id) === q || squash(r.file.title) === q || (!words.includes(' ') && q.length >= 2 && initials(r.id) === q), true],
    [(r) => prefix && (squash(r.file.title).startsWith(q) || squash(r.id).startsWith(q)), !orgWord],
    [(r) => organizers(r.file.organizer).includes(q), true],
  ];
  const titles = (hits: ProgramRow[]) => byLookupRank(hits, now).slice(0, 2).map((r) => r.file.title);
  for (const [t, takes] of tests) {
    const hits = rows.filter(t);
    // `takes` false: the hits are weighed with the organizer's other programs.
    const fit = takes || hits.length === 0 ? hits : [...new Set([...hits, ...rows.filter(led)])];
    if (fit.length === 1) return { row: fit[0], suggest: [] };
    if (!takes && fit.length > 0) return { row: null, suggest: titles(fit) };
    if (hits.length > 1) return { row: null, suggest: titles(hits) };
  }
  // L12-3 (v6.1.14): every word of the name, stopwords and years dropped when another word is left, in one program's
  // id, title or organizer (L12-5: brackets included). A lone word names a program only at four characters or more
  // ("zerodha", never "aws"). One program is the row, several are asked about, none is no program.
  const all = words.split(' ');
  const kept = all.filter((w) => !COMMON.has(w) && !YEAR.test(w));
  const asked = kept.length > 0 ? kept : all.filter((w) => !YEAR.test(w));
  if (asked.length === 0 || (asked.length === 1 && asked[0].length < MIN_PREFIX)) return { row: null, suggest: [] };
  const fit = rows.filter((r) => { const own = wordsOfProgram(r); return asked.every((w) => own.has(w)); });
  if (fit.length === 1) return { row: fit[0], suggest: [] };
  return { row: null, suggest: titles(fit) };
}

/** The programs with these ids, whatever their status, deadline or staleness. */
export async function programsById(ids: string[]): Promise<ProgramRow[]> {
  if (ids.length === 0) return [];
  const rows = await sql()<RawRow[]>`
    SELECT id, file, source, created_at, updated_at, verified_at, stale_since FROM programs WHERE id = ANY(${ids})`;
  return parseRows(rows);
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
