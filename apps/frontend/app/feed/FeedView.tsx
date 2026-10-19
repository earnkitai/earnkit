import Link from 'next/link';
import Footer from '../components/common/Footer';
import UpdateCard from '../components/ui/UpdateCard';
import { H1, LEDE, SURFACE } from '../components/common/Panel';
import { BTN_SECONDARY } from '../components/common/Button';
import type { FeedCard } from '../../lib/earnkit/feed';

export const FEED_TITLE = 'What builders shipped';
export const FEED_LINE = 'Weekly updates from builders on the leaderboard. Every fact is checked.';
export const FEED_EMPTY = 'No updates yet. New ones post every Monday.';

const COLUMN = 'mx-auto w-full max-w-4xl px-4 md:px-8';

/**
 * v2.13 spec "The feed": long cards by week, best first: the title, each week under its label, cards
 * on the site's surface (UpdateCard), a clear empty state. Pure.
 */
export default function FeedView({ weeks }: { weeks: { monday: string; label: string; cards: FeedCard[] }[] }) {
  return (
    <>
    <div className={`${COLUMN} pt-8 md:pt-12`}>
      <section aria-label="Feed">
        <h1 className={H1}>{FEED_TITLE}</h1>
        <p className={LEDE}>{FEED_LINE}</p>
      </section>
      <section aria-label="Updates" className="mt-8 md:mt-12">
        {weeks.length === 0 ? (
          <div className={`flex flex-col items-start gap-3 px-6 py-10 md:px-10 md:py-14 ${SURFACE}`}>
            <p className="font-funnel-display text-xl font-medium text-ek-text md:text-2xl">{FEED_EMPTY}</p>
            <Link href="/leaderboard" className={BTN_SECONDARY}>
              See the leaderboard
            </Link>
          </div>
        ) : (
          weeks.map((w) => (
            <section key={w.monday} aria-label={w.label} className="mb-12 last:mb-0 md:mb-16">
              <h2 className="mb-4 font-funnel-display text-lg font-medium text-ek-text md:text-xl">{w.label}</h2>
              <div className="flex flex-col gap-4 md:gap-5">
                {w.cards.map((c) => (
                  <UpdateCard key={c.id} card={c} shape="long" showWeek={false} />
                ))}
              </div>
            </section>
          ))
        )}
      </section>
    </div>
    <Footer />
    </>
  );
}
