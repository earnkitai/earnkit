import { unstable_cache } from 'next/cache';
import { connection } from 'next/server';
import { readLanding, type Landing } from '../../lib/earnkit/landing';

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
