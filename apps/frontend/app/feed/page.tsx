import { unstable_cache } from 'next/cache';
import { feedWeeks } from '../../lib/earnkit/feed';
import SlimTopBar from '../components/common/SlimTopBar';
import FeedView, { FEED_LINE, FEED_TITLE } from './FeedView';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${FEED_TITLE} · EarnKit`, description: FEED_LINE };
const cached = unstable_cache(async () => feedWeeks(new Date()), ['feed-v213'], { revalidate: 300 });

/** v2.13 spec "The feed": long cards. profile-whoop v2: the premium dark page with the slim top bar. */
export default async function FeedPage() {
  return (
    <div data-ek-premium="" className="ek-premium">
      <SlimTopBar />
      <FeedView weeks={await cached()} />
    </div>
  );
}
