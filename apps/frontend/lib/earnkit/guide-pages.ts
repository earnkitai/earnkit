import type { Db } from './db';

/** A guide page id: a program file's id shape. Anything else is a 404 with no read. */
export const GUIDE_ID = /^[a-z0-9-]{1,64}$/;

/**
 * Whether the programs row aliased `g` has a guide page at /programs/<id> (landing.ts readGuideIds, the page's gate): a
 * curated program (a file, or v4.9 Task 3 an API program), never a campaign, never unlisted (v3.1 D2: its guide is a 404), its id GUIDE_ID-shaped.
 * Closed programs keep their page (Ruling 22). One predicate for the guide set and every link to a guide.
 */
export const guideProgramSql = (db: Db) =>
  db`(g.source IN ('file', 'api') AND g.campaign IS NULL AND g.status <> 'unlisted' AND g.id ~ ${GUIDE_ID.source})`;
