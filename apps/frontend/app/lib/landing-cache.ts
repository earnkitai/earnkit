import { connection } from 'next/server';
import { cache } from 'react';
import { landingAt, readLanding, type Landing } from '../../lib/v5/landing';
import { gatedGuidePage, guidePageOf, guideRowById, listGuideIds, type GuidePage } from '../../lib/v5/guide-page';
import { cachedRead } from './cached';

// L23-2 (v6.1.16): the reads stay cached 10 minutes, but every render re-derives open or closed and the closes words
// from the clock (`landingAt`, `guidePageOf`), so a cached page never offers a program that has closed.
const landing = cachedRead(() => readLanding(), ['landing-v6.4']);
const guideIds = cachedRead(() => listGuideIds(), ['guide-ids-v6']);
const guideRow = cachedRead((id: string) => guideRowById(id), ['guide-row-v6.1.16']);

/** The landing and /programs data, or null when the read failed (the page then shows no live parts). */
export async function getLanding(): Promise<Landing | null> {
  try {
    return landingAt(await landing(), new Date());
  } catch (err) {
    console.error('[landing] read failed', (err as { name?: string } | null)?.name ?? 'unknown');
    // Makes this render dynamic, so the fallback is never prerendered as the static page.
    await connection();
    return null;
  }
}

/** One program's guide page: null for a 404, 'error' when the read failed. generateMetadata and the page share one call. */
export const getGuidePage = cache(async (id: string): Promise<GuidePage | null | 'error'> => {
  try {
    const row = await gatedGuidePage(id, guideIds, guideRow);
    return row ? guidePageOf(row, new Date()) : null;
  } catch (err) {
    console.error('[guide] read failed', (err as { name?: string } | null)?.name ?? 'unknown');
    await connection();
    return 'error';
  }
});
