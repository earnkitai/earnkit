import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { benchEnabled } from '../../lib/earnkit/builder-score-flag';
import { feedWeeks } from '../../lib/earnkit/feed';
import FeedView, { FEED_LINE, FEED_TITLE } from './FeedView';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${FEED_TITLE} · EarnKit`, description: FEED_LINE };
const cached = unstable_cache(async () => feedWeeks(new Date()), ['feed-v213'], { revalidate: 300 });

/** v2.13 spec "The feed": long cards. A 404 with the flag off. */
export default async function FeedPage() {
  if (!benchEnabled()) notFound();
  return <FeedView weeks={await cached()} />;
}
