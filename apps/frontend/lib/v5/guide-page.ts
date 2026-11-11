/** The data of /programs/<id>: the guide plus what the page needs around it. Plain JSON, so it can be cached. */
import { sql } from './db';
import { guideText, type Guide } from './guide';
import { logoOf } from './landing';
import { getProgram, listListedPrograms } from './programs';

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

/** The ids that have a page: every listed program (open or upcoming) and every closed one. */
export async function listGuideIds(now: Date = new Date()): Promise<string[]> {
  const [listed, closed] = await Promise.all([listListedPrograms(now), sql()<{ id: string }[]>`SELECT id FROM programs WHERE status = 'closed'`]);
  return [...new Set([...listed.map((r) => r.id), ...closed.map((r) => r.id)])];
}

/**
 * The page of a program, or null (a 404). Only what the lists show gets a page: a listed program, or a
 * closed one (marked Closed, no Apply link). A stale or unverified program is a 404.
 */
export async function guideTextById(id: string, now: Date = new Date()): Promise<GuidePage | null> {
  if (!ID.test(id)) return null;
  const row = await getProgram(id);
  if (!row) return null;
  const p = row.file;
  const closed = p.status === 'closed';
  if (!closed && !(await listListedPrograms(now)).some((r) => r.id === id)) return null;
  return {
    guide: guideText(row, now),
    logo: logoOf(p),
    status: p.status,
    opens_note: p.status === 'upcoming' ? (p.opens_note ?? null) : null,
    submission_url: closed ? '' : p.submission_url,
    organizer: p.organizer,
  };
}

/** The page for `id`, gated: an id outside the known set is null before any per-id read. */
export async function gatedGuidePage(
  id: string,
  ids: () => Promise<string[]>,
  read: (id: string) => Promise<GuidePage | null>,
): Promise<GuidePage | null> {
  if (!ID.test(id) || !(await ids()).includes(id)) return null;
  return read(id);
}
