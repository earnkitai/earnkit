/** The data of /programs/<id>: the guide plus what the page needs around it. Plain JSON, so it can be cached. */
import { sql } from './db';
import { guideText, type Guide } from './guide';
import { logoOf } from './landing';
import { closedAt, getProgram, listListedPrograms, statusAt, type ProgramRow } from './programs';

export type GuidePage = {
  guide: Guide;
  logo: string | null;
  status: 'active' | 'upcoming' | 'closed';
  /** The page's opening line for a program that is not open yet. */
  opens_note: string | null;
  /** Empty for a closed program: its page has no Apply link. */
  submission_url: string;
  organizer: string;
};

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The ids that have a page: every listed program (open or upcoming) and every one that reads closed at `now` (L23-2,
 * v6.1.16: `status: closed`, or an active or upcoming program past its ends_at before any run flipped it), so a closed
 * guide renders, never a 404.
 */
export async function listGuideIds(now: Date = new Date()): Promise<string[]> {
  const [listed, closed] = await Promise.all([
    listListedPrograms(now),
    sql()<{ id: string }[]>`SELECT id FROM programs WHERE status = 'closed' OR (status IN ('active', 'upcoming') AND ends_at <= ${now})`,
  ]);
  return [...new Set([...listed.map((r) => r.id), ...closed.map((r) => r.id)])];
}

/**
 * The program behind a page, or null (a 404): a listed program, or one that reads closed at `now` (`closedAt`). A stale
 * or unverified open program is a 404. Plain JSON, so it can be cached; the page itself is `guidePageOf` at render.
 */
export async function guideRowById(id: string, now: Date = new Date()): Promise<ProgramRow | null> {
  if (!ID.test(id)) return null;
  const row = await getProgram(id);
  if (!row) return null;
  if (!closedAt(row.file, now) && !(await listListedPrograms(now)).some((r) => r.id === id)) return null;
  return row;
}

/**
 * The page of a program at `now` (L23-2, v6.1.16): open or closed is read from the clock here, at every render, so a
 * cached row that closed meanwhile renders Closed (`Closed on {date}.`) with no Apply link. Pure apart from the logo check.
 */
export function guidePageOf(row: ProgramRow, now: Date): GuidePage {
  const p = row.file;
  const closed = closedAt(p, now);
  // Fix round 1 (M1): open from its start date, before the run flips it.
  const status = statusAt(p, now);
  return {
    guide: guideText(row, now),
    logo: logoOf(p),
    status,
    opens_note: status === 'upcoming' ? (p.opens_note ?? null) : null,
    submission_url: closed ? '' : p.submission_url,
    organizer: p.organizer,
  };
}

/** The page of a program, or null (a 404): `guideRowById`, then `guidePageOf` at the same `now`. */
export async function guideTextById(id: string, now: Date = new Date()): Promise<GuidePage | null> {
  const row = await guideRowById(id, now);
  return row ? guidePageOf(row, now) : null;
}

/** The page for `id`, gated: an id outside the known set is null before any per-id read. */
export async function gatedGuidePage<T = GuidePage>(
  id: string,
  ids: () => Promise<string[]>,
  read: (id: string) => Promise<T | null>,
): Promise<T | null> {
  if (!ID.test(id) || !(await ids()).includes(id)) return null;
  return read(id);
}
