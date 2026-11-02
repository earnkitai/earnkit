import { unstable_cache } from 'next/cache';
import { connection } from 'next/server';
import { cache } from 'react';
import { PROFILE_TAG } from '../../lib/earnkit/profile-cache';
import { PROGRAMS_TAG } from '../../lib/earnkit/programs-cache';
import { gatedGuidePage, readGuideIds, readGuidePage, readLanding, type GuidePage, type Landing } from '../../lib/earnkit/landing';

/**
 * One DB read per 10 minutes at most (no new service); the value is plain JSON (Ruling 21 (plan)).
 * v2.8: the key moved with the Tile shape (days_left), so a kept cache never serves old tiles. v2.13:
 * the key moved with `bench`. v2.14: the Tile lost its bonus fields, so the key moved again. R18 fix 1:
 * `bench` gained `count`, so it moved again. v3.1 site: the Landing lost `bench` and `featured` and gained `open_chip`, `activity` and the Tile's kind, big and when, so it moved again.
 * v4.9 Task 3 fix 1: the Tile gained `research`, so it moved again; PROGRAMS_TAG lets an API write expire it at once.
 */
export const landingCacheKey = () => 'landing-v49';
const byKey = new Map<string, () => Promise<Landing>>();
const cached = () => {
  const key = landingCacheKey();
  let read = byKey.get(key);
  // Hotfix 2026-10-19: PROFILE_TAG, so a pool change (profile-cache.ts poolChanged) expires it at once.
  if (!read) byKey.set(key, (read = unstable_cache(() => readLanding(), [key], { revalidate: 600, tags: [PROFILE_TAG, PROGRAMS_TAG] })));
  return read();
};

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
const cachedIds = unstable_cache(() => readGuideIds(), ['guide-ids-v27'], { revalidate: 600, tags: [PROGRAMS_TAG] });
/** One guide page per known program id, read at most once per 10 minutes (plain JSON). */
const cachedGuide = unstable_cache((id: string) => readGuidePage(id), ['guide-v49'], { revalidate: 600, tags: [PROGRAMS_TAG] });

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
