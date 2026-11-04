/** The data of /programs/<id>: the guide plus what the page needs around it. Plain JSON, so it can be cached. */
import { guideText, type Guide } from './guide';
import { logoOf } from './landing';
import { getProgram } from './programs';

export type GuidePage = {
  guide: Guide;
  logo: string | null;
  status: 'active' | 'upcoming' | 'closed';
  /** The page's opening line for a program that is not open yet. */
  opens_note: string | null;
  submission_url: string;
  organizer: string;
  description: string;
};

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The page of a program by id, or null when there is no such program (or its record no longer parses). */
export async function guideTextById(id: string, now: Date = new Date()): Promise<GuidePage | null> {
  if (!ID.test(id)) return null;
  const row = await getProgram(id);
  if (!row) return null;
  const p = row.file;
  return {
    guide: guideText(row, now),
    logo: logoOf(p),
    status: p.status,
    opens_note: p.status === 'upcoming' ? (p.opens_note ?? null) : null,
    submission_url: p.submission_url,
    organizer: p.organizer,
    description: p.description,
  };
}
