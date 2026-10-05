import { unstable_cache } from 'next/cache';
import { readStats } from '@/lib/earnkit/stats';

/**
 * Public stats for jenil.ai (v2.5 §4): database aggregates only, cached 10 minutes. The route is
 * revalidated every 10 minutes when it was prerendered; the read itself is cached too, so it stays
 * at most one database read per 10 minutes even when the build had no database and the route
 * renders per request. A failed read answers 503 and is never cached.
 */
export const revalidate = 600;

const cachedStats = unstable_cache(() => readStats(), ['public-stats'], { revalidate: 600 });

export async function GET() {
  try {
    return Response.json(await cachedStats());
  } catch (err) {
    console.error('[stats]', err);
    return Response.json(
      { error: 'stats unavailable, try again shortly' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
