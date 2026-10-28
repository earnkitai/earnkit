import { unstable_cache } from 'next/cache';
import { readStats } from '@/lib/earnkit/stats';

/**
 * Public stats for jenil.ai (v2.5 §4): database aggregates only, cached 10 minutes. When the build
 * can reach the database, the route prerenders and revalidates every 10 minutes. When it can't
 * (turbo doesn't pass DATABASE_URL to `pnpm build`), the route renders per request, and the read
 * itself is cached 10 minutes with unstable_cache. Either way it's at most one read per 10 minutes.
 * A failed read answers 503 and is never cached (Next treats a build-time 503 as dynamic).
 * `fees_to_safe_eth`: the Safe's fees from EarnKit coins, accrued (stats.ts statsFrom): (v2.13.2) both
 * splits, from the Safe's indexed deposits. `bonus_programs_open`: 0 (v2.14: no builder bonus; the key stays). Owner
 * test installations (EARNKIT_TEST_INSTALLATIONS) never show in `installs`, `coins_launched` or `tokens_declined`.
 * Pre-launch 2026-10-19: `installs_used` (called find at least once) and `builders` (distinct
 * builder groups) sit beside `installs`, which counts every new OAuth client's first token.
 * Launch-ready L9, the funnel (counts only, no per-user data), from the weekly moment's approvals (L6): `activated`
 * (a claimed page, a repo proven by the EarnKit app and an approved week), `weekly_active` (activated people who
 * approved a week in the last 7 days) and `shared` (weeks approved from the share offer). stats.ts has the exact rules.
 * v2.9 F21: `open_money_usd` is the one money figure (stats.ts openMoneyUsd) and `open_money_text`
 * the text every page shows ("$1.1M+"). Ruling G23: `open_pools_usd`/`open_pools_plus` stay,
 * deprecated, so docs.earnkit.com never breaks. v2.8 Part G: `labelled_entries` (entries with
 * a published result) and `entries_won` (won or placed), announcement-sourced only, never a
 * self-report or a test installation's entry. No win-rate claim until 30 labelled entries.
 * v2.9 E20: `builders_won_usd`, the prizes of announced won or placed outcomes (same exclusions).
 * v3.1 one-tap posts (design 5): `posts_drafted`, `posts_tapped` (taps > 0) and `backers_after_post` (new backers
 * within 7 days of a first tap; correlation only; 0 while EARNKIT_RAISING is off), people only. Page opens from X are
 * never public (final review 4: anyone can send them); they stay on post_drafts.x_visits for the owner.
 */
export const revalidate = 600;

const cachedStats = unstable_cache(() => readStats(), ['public-stats-posts'], { revalidate: 600 });

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
