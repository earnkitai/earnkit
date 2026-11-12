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

/** Days a program may stay stale, or an API program unverified, before it drops out (v6.1.17 Task 3: 12, so a page that stays down leaves within 14 days of its first failure). */
export const STALE_DAYS = 12;

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

/** Active, not past ends_at, not stale over STALE_DAYS (12) and, for an API program, verified in the last STALE_DAYS. */
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
        -- Fix round 1 (M1): an upcoming program past its starts_at, with a form, is open before the run flips it (isOpenAt).
        OR (status = 'upcoming' AND (file->>'starts_at')::timestamptz <= ${now} AND (ends_at IS NULL OR ends_at > ${now})
            AND jsonb_array_length(COALESCE(file->'submission_requirements', '[]'::jsonb)) > 0)
        ${withUpcoming ? db`OR (status = 'upcoming' AND (ends_at IS NULL OR ends_at > ${now}))` : db``}
      )
      AND NOT (stale_since IS NOT NULL AND stale_since < ${now}::timestamptz - make_interval(days => ${STALE_DAYS}))
      AND NOT (source = 'api' AND (verified_at IS NULL OR verified_at < (${now}::timestamptz - make_interval(days => ${STALE_DAYS}))::date))
    ORDER BY ends_at ASC NULLS LAST, id`;
  return parseRows(rows);
}

/**
 * A program id as ids are compared (L31-4, v6.1.16 Task 17): NFKC (fullwidth and other compatibility forms), lower
 * case, trimmed. Stored ids are lower-case ASCII, so they are their own folded form. Pure.
 */
export const foldId = (s: string): string => s.normalize('NFKC').toLowerCase().trim();

/** The program whose id matches `id` once both are folded (`foldId`), or null. */
export async function getProgram(id: string): Promise<ProgramRow | null> {
  const rows = await sql()<RawRow[]>`
    SELECT id, file, source, created_at, updated_at, verified_at, stale_since FROM programs WHERE id = ${foldId(id)}`;
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
/** The words a short word (under four characters) may name (fix round 1, T7-F3): the id's and title's words and the
 *  id's initials ("arc", "yc"), never an organizer's ("aws" from "Kiro (AWS)"). Pure. */
const shortWordsOfProgram = (r: ProgramRow) => new Set([...[r.id, r.file.title].flatMap((x) => plain(x).split(' ')), initials(r.id)].filter(Boolean));
/** L1h-2 (v6.1.16): a program's rule keywords as catalog words a short lookup may name ("otf"). Pure. */
const keywordsOfProgram = (r: ProgramRow) =>
  new Set((r.file.eligibility ?? []).flatMap((e) => (e.kind === 'rule' ? e.keywords ?? [] : [])).map((k) => squash(k)));
/** The money a program puts up: the larger of its top award and its pool, -1 when it states neither. Pure. */
const awardOf = (p: Program) => Math.max(p.max_award_usd ?? -1, p.pool_usd ?? -1);

/**
 * Several programs a name fits, best first (F4, v6.1.12): open ones, then upcoming, then the rest; then the larger award,
 * the sooner close, the id. Pure.
 */
export function byLookupRank(rows: ProgramRow[], now: Date): ProgramRow[] {
  const standing = (p: Program) => (isOpenAt(p, now) ? 0 : p.status === 'upcoming' ? 1 : 2);
  const ends = (p: Program) => (p.ends_at ? Date.parse(p.ends_at) : Infinity);
  return [...rows].sort((a, b) =>
    standing(a.file) - standing(b.file) || awardOf(b.file) - awardOf(a.file) || ends(a.file) - ends(b.file) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** L1i-8 (v6.1.16.1): at most this many programs a lookup offers to pick from. */
export const SUGGESTED = 3;
/** The builder line for a name that is no one program (L1i-8, v6.1.16.1): up to three titles to pick from, as one
 *  question ("Which program do you mean: A, B or C?"); with none, "Which program do you mean? Say its name.". Pure. */
export function unknownProgramLine(suggest: readonly string[]): string {
  const shown = suggest.slice(0, SUGGESTED);
  if (shown.length === 0) return 'Which program do you mean? Say its name.';
  return `Which program do you mean: ${shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} or ${shown.at(-1)}`}?`;
}

/**
 * L24-3 (v6.1.16 Task 11): words that never name a program on their own in a strict lookup (what an agent passes on
 * when the builder says "apply to the next one", "start", "build it").
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set(['next', 'build', 'start', 'first', 'open', 'grant', 'program', 'apply', 'fund', 'app', 'labs', 'dev', 'ai', 'web',
  // v6.1.16 Task 15 fix round 1b: English words that are some program's initials, or could be, never name one.
  'as', 'am', 'mm', 'an', 'at', 'be', 'by', 'do', 'go', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'oh', 'ok', 'on', 'or', 'so', 'to', 'up', 'us', 'we',
  'em', 'he', 'hi', 'ho', 'id', 'lo', 'ma', 'mi', 'mu', 'nu', 'ow', 'ox', 'pa', 'pi', 're', 'uh', 'um', 'xi', 'ya', 'ye', 'yo', 'fog', 'ass']);
/** Small words a strict lookup drops before matching ("the PayPal hackathon"). */
const ARTICLES = new Set(['the', 'and', 'for', 'of', 'a', 'an', 'to']);

/**
 * The strict lookup track uses (L24-3): the exact id (already tried), the exact folded title, or the one title whose
 * words hold every lookup word (articles and years dropped) with at least one of them outside COMMON_WORDS. Several
 * fitting are `suggest`; none is no program. Pure over `rows`.
 */
function strictMatch(rows: ProgramRow[], words: string, now: Date): { row: ProgramRow | null; suggest: string[] } {
  const titled = rows.filter((r) => plain(r.file.title) === words);
  if (titled.length === 1) return { row: titled[0], suggest: [] };
  const asked = words.split(' ').filter((w) => w && !ARTICLES.has(w) && !YEAR.test(w));
  if (asked.length === 0 || asked.every((w) => COMMON_WORDS.has(w))) return { row: null, suggest: [] };
  // v6.1.16 Task 15 (controller's ruling; fix round 1b): the initials of the title, and of the id, count as a title
  // word in any case, two letters or more ("yc" and "YC" name Y Combinator); an English word (COMMON_WORDS: "as",
  // "am", "mm") never does.
  const initialsWord = (w: string) => w.length >= 2 && !COMMON_WORDS.has(w);
  const fit = titled.length > 1 ? titled : rows.filter((r) => {
    const words = plain(r.file.title).split(' ').filter(Boolean);
    const initials = (ws: string[]) => (ws.length > 1 ? [ws.map((w) => w[0]).join('')] : []);
    const own = new Set(words);
    const short = new Set([...initials(words), ...initials(r.id.split('-').filter(Boolean))]);
    return asked.every((w) => own.has(w) || (initialsWord(w) && short.has(w)));
  });
  if (fit.length === 1) return { row: fit[0], suggest: [] };
  return { row: null, suggest: byLookupRank(fit, now).slice(0, SUGGESTED).map((r) => r.file.title) };
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
export async function programByName(name: string, now: Date = new Date(), o: { strict?: boolean } = {}): Promise<{ row: ProgramRow | null; suggest: string[] }> {
  const exact = await getProgram(name);
  if (exact) return { row: exact, suggest: [] };
  const words = plain(name);
  const q = words.replace(/ /g, '');
  if (!q) return { row: null, suggest: [] };
  const rows = parseRows(await sql()<RawRow[]>`SELECT id, file, source, created_at, updated_at, verified_at, stale_since FROM programs ORDER BY id`);
  if (o.strict) return strictMatch(rows, words, now);
  const prefix = q.length >= MIN_PREFIX;
  // Final fix (v6.1.12, I2): the first word of an organizer that is not its whole name ("ethereum" for the Ethereum
  // Foundation) names the organizer: a start of a title on it is weighed beside that organizer's other programs
  // ("circle" asks, as Circle runs several). L1e-1 (v6.1.13): when that is exactly one program ("floss", "thiel"),
  // it is the one.
  const led = (r: ProgramRow) => organizerLeads(r.file.organizer).includes(words);
  const orgWord = rows.some((r) => led(r) && !organizers(r.file.organizer).includes(q));
  const tests: [(r: ProgramRow) => boolean, boolean][] = [
    // L1h-2 (v6.1.16): a short word (under four characters) may also be one of the program's rule keywords ("otf").
    [(r) => squash(r.id) === q || squash(r.file.title) === q || (!words.includes(' ') && q.length >= 2 && (initials(r.id) === q || (q.length < MIN_PREFIX && keywordsOfProgram(r).has(q)))), true],
    [(r) => prefix && (squash(r.file.title).startsWith(q) || squash(r.id).startsWith(q)), !orgWord],
    [(r) => organizers(r.file.organizer).includes(q), true],
  ];
  const titles = (hits: ProgramRow[]) => byLookupRank(hits, now).slice(0, SUGGESTED).map((r) => r.file.title);
  for (const [t, takes] of tests) {
    const hits = rows.filter(t);
    // `takes` false: the hits are weighed with the organizer's other programs.
    const fit = takes || hits.length === 0 ? hits : [...new Set([...hits, ...rows.filter(led)])];
    if (fit.length === 1) return { row: fit[0], suggest: [] };
    if (!takes && fit.length > 0) return { row: null, suggest: titles(fit) };
    if (hits.length > 1) return { row: null, suggest: titles(hits) };
  }
  // L12-3 (v6.1.14): every word of the name, stopwords and years dropped, in one program's id, title or organizer
  // (L12-5: brackets included). A single typed word names a program only at four characters or more ("zerodha", never
  // "aws"); beside another typed word a short word may name an id or title word or the id's initials ("arc grants",
  // "yc batch"; fix round 1, T7-F3). Only stopwords, years or "foundation" name none (T7-F4). One program is the row,
  // several are asked about, none is no program.
  const all = words.split(' ');
  const asked = all.filter((w) => !COMMON.has(w) && !YEAR.test(w));
  if (asked.every((w) => w === 'foundation') || (all.length === 1 && asked[0].length < MIN_PREFIX)) return { row: null, suggest: [] };
  const fit = rows.filter((r) => {
    const own = wordsOfProgram(r);
    const short = shortWordsOfProgram(r);
    return asked.every((w) => (w.length < MIN_PREFIX ? short : own).has(w));
  });
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

/**
 * The status a program's dates call for at `now` (L30-1), or null when it stays: an active or upcoming program whose
 * ends_at passed closes; an upcoming one whose starts_at came opens. The daily run and the sync move programs by it
 * (health.ts re-exports it); `isOpenAt` reads it at every request. Pure.
 */
export function dateStatus(file: Pick<Program, 'status' | 'starts_at' | 'ends_at'>, now: Date): 'active' | 'closed' | null {
  const t = now.getTime();
  if (file.status === 'closed') return null;
  if (file.ends_at !== null && Date.parse(file.ends_at) <= t) return 'closed';
  if (file.status === 'upcoming' && file.starts_at !== null && Date.parse(file.starts_at) <= t) return 'active';
  return null;
}

/** What isOpenAt reads: the status and dates, and the form when it is known (an upcoming program opens only with one). */
type Dated = Pick<Program, 'status' | 'ends_at' | 'starts_at'> & Partial<Pick<Program, 'submission_requirements'>>;

/**
 * The one open test (L23-2, L23-10, v6.1.16): whether the program takes entries at `now`, derived from the clock at read
 * time on every surface (find, tiles, guides, the lists, /me), whatever status the daily run last wrote. It agrees with
 * `dateStatus` both ways (fix round 1, M1): an active program is open until its ends_at; an upcoming one is open from its
 * starts_at (dateStatus says active) when it has a form, as the run's `movedByDate` would open it; closed never. Pure.
 */
export const isOpenAt = (p: Dated, now: Date): boolean => {
  const to = dateStatus(p, now);
  if (p.status === 'active') return to === null;
  return p.status === 'upcoming' && to === 'active' && (p.submission_requirements === undefined || p.submission_requirements.length > 0);
};

/** The status a surface shows at `now` (fix round 1, M1): closed (`closedAt`), active (`isOpenAt`), else as stored. Pure. */
export const statusAt = (p: Dated, now: Date): 'active' | 'upcoming' | 'closed' =>
  closedAt(p, now) ? 'closed' : isOpenAt(p, now) ? 'active' : p.status;

/** Whether the program reads closed at `now`: closed, or past its ends_at before any run flipped it (L23-2). Pure. */
export const closedAt = (p: Pick<Program, 'status' | 'ends_at' | 'starts_at'>, now: Date): boolean =>
  p.status === 'closed' || dateStatus(p, now) === 'closed';

/** JSON with sorted keys, so two equal records compare equal whatever their key order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  ) ?? 'undefined';
}

/** A form item's words for the builder and the agent, not the form itself: a change to them is no form change. */
const DISPLAY_ONLY = new Set(['need', 'todo', 'guidance', 'description']);

/** The form's fields without their display-only words (v6.1.15 FR-1), so a reworded to-do never reads "form changed". */
const formShape = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map((r) => (r && typeof r === 'object' ? Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([k]) => !DISPLAY_ONLY.has(k))) : r))
    : v;

const sameField = (k: (typeof CHANGE_FIELDS)[number], a: unknown, b: unknown): boolean =>
  k === 'ends_at' && typeof a === 'string' && typeof b === 'string'
    ? Date.parse(a) === Date.parse(b)
    : k === 'submission_requirements'
      ? canonical(formShape(a)) === canonical(formShape(b))
      : canonical(a) === canonical(b);

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

/** L35-6 (v6.1.16.1 Task 2): number words one to twenty, as a list reference reads them. */
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** What a list reference reads after its `#`, `No.` or `no `, and a trailing dot, are stripped, lower case. Pure. */
const refBody = (raw: string): string => raw.trim().toLowerCase().replace(/^(#|no\.\s*|no\s+|number\s+)/, '').replace(/\.$/, '').trim();

/**
 * L35-6 (v6.1.16.1 Task 2): whether a program reference is shaped like a list number: digits, a number word (also a
 * compound like `twenty-one`), with or without a `#`, `No.` or a trailing dot. Such a token is never matched against
 * titles for a write. Pure.
 */
export function looksLikeListRef(raw: string): boolean {
  const b = refBody(raw);
  if (/^\d{1,4}$/.test(b)) return true;
  if (NUMBER_WORDS.includes(b)) return true;
  const [t, u] = b.split(/[-\s]+/);
  return TENS.includes(t) && (u === undefined || NUMBER_WORDS.slice(0, 9).includes(u));
}

/**
 * L35-6 (v6.1.16.1 Task 2): a list reference ("#3", "3.", "No. 3", "no 3", "three", "3") read as the last list's
 * stable number: that program's id when the number is from 1 to the list's length (and the slot names one), else
 * null, so the caller falls to the name lookup. Pure.
 */
export function listRef(raw: string, lastList: string[]): string | null {
  const b = refBody(raw);
  const n = /^\d{1,4}$/.test(b) ? Number(b) : NUMBER_WORDS.indexOf(b) + 1;
  if (!Number.isInteger(n) || n < 1 || n > lastList.length) return null;
  return lastList[n - 1] || null;
}
