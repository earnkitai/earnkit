import { unstable_cache } from 'next/cache';
import { feedWeeks } from '../../lib/earnkit/feed';
import { PROFILE_TAG } from '../../lib/earnkit/profile-cache';
import { feedWeekStats, type FeedWeekStats } from '../../lib/earnkit/site-data';
import FeedView, { FEED_LINE, FEED_TITLE, pickWeek } from './FeedView';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${FEED_TITLE} · EarnKit`, description: FEED_LINE };
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
// Hotfix 2026-10-19: PROFILE_TAG, so a pool change (profile-cache.ts poolChanged) expires it at once.
const cached = unstable_cache(async () => feedWeeks(new Date()), ['feed-v213'], { revalidate: 300, tags: [PROFILE_TAG] });
/** One cached read per shown week (only a week the feed has, so the keys stay few), as the weeks. */
const cachedStats = (monday: string) => unstable_cache(async () => feedWeekStats(monday), ['feed-stats-v31', monday], { revalidate: 300, tags: [PROFILE_TAG] })();

/** v3.1 site Task 9: `?week=<monday>` picks the week (else the newest), `?page=N` its page (FeedView clamps it). */
export default async function FeedPage({ searchParams }: Props) {
  const q = await searchParams;
  const weeks = await cached();
  const week = typeof q.week === 'string' ? q.week : null;
  const page = typeof q.page === 'string' ? Number.parseInt(q.page, 10) || 1 : 1;
  const sel = pickWeek(weeks, week);
  // A failed read hides the four cards (it claims nothing) and keeps the rows.
  let stats: FeedWeekStats | null = null;
  if (sel)
    stats = await cachedStats(sel.monday).catch((e: unknown) => {
      console.error('feed: week stats read failed', e);
      return null;
    });
  return <FeedView weeks={weeks} week={week} page={page} stats={stats} />;
}
