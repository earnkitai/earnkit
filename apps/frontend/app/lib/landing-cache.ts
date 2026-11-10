import { connection } from 'next/server';
import { cache } from 'react';
import { readLanding, type Landing } from '../../lib/v5/landing';
import { gatedGuidePage, guideTextById, listGuideIds, type GuidePage } from '../../lib/v5/guide-page';
import { cachedRead } from './cached';

const landing = cachedRead(() => readLanding(), ['landing-v6.2']);
const guideIds = cachedRead(() => listGuideIds(), ['guide-ids-v5']);
const guide = cachedRead((id: string) => guideTextById(id), ['guide-v5']);

/** The landing and /programs data, or null when the read failed (the page then shows no live parts). */
export async function getLanding(): Promise<Landing | null> {
  try {
    return await landing();
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
    return await gatedGuidePage(id, guideIds, guide);
  } catch (err) {
    console.error('[guide] read failed', (err as { name?: string } | null)?.name ?? 'unknown');
    await connection();
    return 'error';
  }
});
