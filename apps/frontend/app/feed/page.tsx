import { unstable_cache } from 'next/cache';
import { feedWeeks } from '../../lib/earnkit/feed';
import { PROFILE_TAG } from '../../lib/earnkit/profile-cache';
import FeedView, { FEED_LINE, FEED_TITLE } from './FeedView';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${FEED_TITLE} · EarnKit`, description: FEED_LINE };
// Hotfix 2026-10-19: PROFILE_TAG, so a pool change (profile-cache.ts poolChanged) expires it at once.
const cached = unstable_cache(async () => feedWeeks(new Date()), ['feed-v213'], { revalidate: 300, tags: [PROFILE_TAG] });

/** v2.13 spec "The feed": long cards by week. */
export default async function FeedPage() {
  return <FeedView weeks={await cached()} />;
}
