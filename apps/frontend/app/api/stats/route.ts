import { unstable_cache } from 'next/cache';
import { readStats } from '@/lib/earnkit/stats';

/**
 * Public stats for jenil.ai (v2.5 §4): database aggregates only, cached 10 minutes. When the build
 * can reach the database, the route prerenders and revalidates every 10 minutes. When it can't
 * (turbo doesn't pass DATABASE_URL to `pnpm build`), the route renders per request, and the read
 * itself is cached 10 minutes with unstable_cache. Either way it's at most one read per 10 minutes.
 * A failed read answers 503 and is never cached (Next treats a build-time 503 as dynamic).
 * `fees_to_safe_eth`: the Safe's fees from v2.5-split coins only, accrued (stats.ts statsFrom).
 * `bonus_programs_open`: open programs with the builder bonus on (v2.6 Ruling 16 (plan)). Owner
 * test installations (EARNKIT_TEST_INSTALLATIONS) never show in `installs` or `coins_launched`.
 * v2.7.1: `open_pools_usd`/`open_pools_plus` are the landing page's "$1.3M+" (pool total and its
 * "+"); `open_money_usd` stays the per-winner sum. v2.8 Part G: `labelled_entries` (entries with
 * a published result) and `entries_won` (won or placed), announcement-sourced only, never a
 * self-report or a test installation's entry. No win-rate claim until 30 labelled entries.
 */
export const revalidate = 600;

const cachedStats = unstable_cache(() => readStats(), ['public-stats-v28'], { revalidate: 600 });

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
