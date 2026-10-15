import { unstable_cache } from 'next/cache';
import { connection } from 'next/server';
import { cache } from 'react';
import { gatedGuidePage, readGuideIds, readGuidePage, readLanding, type GuidePage, type Landing } from '../../lib/earnkit/landing';

/** One DB read per 10 minutes at most (no new service); the value is plain JSON (Ruling 21 (plan)). v2.8: the key moved with the Tile shape (days_left), so a kept cache never serves old tiles. v2.13: the key moved with `bench`. */
const cached = unstable_cache(() => readLanding(), ['landing-v213'], { revalidate: 600 });

/**
 * v2.7 Ruling 21 (plan): the landing data, or null. A failed read is logged and renders the page
 * without its live parts; `connection()` makes that render dynamic, so the fallback is never
 * prerendered as the static page (a build without DATABASE_URL, or a database blip).
 */
export async function getLanding(): Promise<Landing | null> {
  try {
    return await cached();
  } catch (err) {
    console.error('[landing]', err);
    await connection();
    return null;
  }
}

/** v2.7 §2: the curated ids (closed included), read at most once per 10 minutes in total. */
const cachedIds = unstable_cache(() => readGuideIds(), ['guide-ids-v27'], { revalidate: 600 });
/** One guide page per known program id, read at most once per 10 minutes (plain JSON). */
const cachedGuide = unstable_cache((id: string) => readGuidePage(id), ['guide-v271'], { revalidate: 600 });

/**
 * v2.7 Ruling 22 (plan): a curated program's guide page; null when the id isn't one (a 404, with
 * no per-id read: gatedGuidePage); or 'error' when a read failed. A failure is logged, and
 * `connection()` keeps the "unavailable" panel from being cached as the page, so a database blip
 * never reads as a 404. React `cache` makes generateMetadata and the page share one call.
 */
export const getGuidePage = cache(async (id: string): Promise<GuidePage | null | 'error'> => {
  try {
    return await gatedGuidePage(id, cachedIds, cachedGuide);
  } catch (err) {
    console.error('[guide]', err);
    await connection();
    return 'error';
  }
});
