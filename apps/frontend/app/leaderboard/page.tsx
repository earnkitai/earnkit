import { notFound, redirect } from 'next/navigation';
import { benchEnabled, builderScoreEnabled } from '@/lib/earnkit/builder-score-flag';
import { BOARD_TITLE } from '@/lib/earnkit/page-data';
import LeaderboardView from './LeaderboardView';
import { cachedBoard } from './leaderboard-load';

/** Rendered per request (the flag is read at run time); the board itself is one cached read per 10 minutes. */
export const dynamic = 'force-dynamic';
export const metadata = {
  title: `${BOARD_TITLE} · EarnKit`,
  description: 'Builders ranked by what they shipped and who uses it.',
};

/**
 * v2.12.1 spec "Leaderboard" (plan S11): one list, every query parameter ignored (no filters, no
 * pages: nothing a URL can vary fills a cache entry). A 404 with the flag off. v2.13: under the
 * Bench flag it is the Bench (a 307, so turning the flag off never sticks in a browser).
 */
export default async function LeaderboardPage() {
  if (benchEnabled()) redirect('/bench');
  if (!builderScoreEnabled()) notFound();
  const { rows, count } = await cachedBoard();
  return <LeaderboardView rows={rows} count={count} />;
}
