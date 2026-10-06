import { unstable_cache } from 'next/cache';
import { connection } from 'next/server';
import { readGuidePage, readLanding, type GuidePage, type Landing } from '../../lib/earnkit/landing';

/** One DB read per 10 minutes at most (no new service); the value is plain JSON (Ruling 21 (plan)). */
const cached = unstable_cache(() => readLanding(), ['landing-v27'], { revalidate: 600 });

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

/** v2.7 §2: one guide page per program id, read at most once per 10 minutes (plain JSON). */
const cachedGuide = unstable_cache((id: string) => readGuidePage(id), ['guide-v27'], { revalidate: 600 });

/**
 * v2.7 Ruling 22 (plan): a curated program's guide page; null when the id isn't one (a 404); or
 * 'error' when the read failed. A failure is logged, and `connection()` keeps the "unavailable"
 * panel from being cached as the static page, so a database blip never reads as a 404.
 */
export async function getGuidePage(id: string): Promise<GuidePage | null | 'error'> {
  try {
    return await cachedGuide(id);
  } catch (err) {
    console.error('[guide]', err);
    await connection();
    return 'error';
  }
}
