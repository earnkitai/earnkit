import { notFound } from 'next/navigation';
import { builderScoreEnabled } from '@/lib/earnkit/builder-score-flag';
import { leaderboardFilters } from '@/lib/earnkit/profile-data';
import LeaderboardView from './LeaderboardView';
import { cachedBoard } from './leaderboard-load';

export const revalidate = 600;
export const metadata = {
  title: 'Leaderboard · EarnKit',
  description: 'Builders ranked by a verified score: real people using what they shipped.',
};

/**
 * v2.12 spec 7: the leaderboard. A 404 with the flag off (v2.11 had no such page), for a program id
 * that names no program, and for a page past the end. Unknown chain, window or page values fall back
 * to the defaults and are never echoed.
 */
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The query first: it makes the page render per request (never one static page for every filter);
  // the board itself is the cached read (leaderboard-load.ts), one query per filter set per 10 minutes.
  const q = await searchParams;
  if (!builderScoreEnabled()) notFound();
  const f = leaderboardFilters(q);
  const board = await cachedBoard(f);
  if (!board.known) notFound();
  if (f.page > board.data.pages) notFound();
  return <LeaderboardView data={board.data} programs={board.programs} />;
}
