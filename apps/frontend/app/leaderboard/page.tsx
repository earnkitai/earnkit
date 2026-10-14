import { notFound } from 'next/navigation';
import { builderScoreEnabled } from '@/lib/earnkit/builder-score-flag';
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
 * pages: nothing a URL can vary fills a cache entry). A 404 with the flag off.
 */
export default async function LeaderboardPage() {
  if (!builderScoreEnabled()) notFound();
  const { rows, count } = await cachedBoard();
  return <LeaderboardView rows={rows} count={count} />;
}
