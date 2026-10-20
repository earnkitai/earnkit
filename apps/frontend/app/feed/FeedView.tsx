import Link from 'next/link';
import Footer from '../components/common/Footer';
import UpdateCard from '../components/ui/UpdateCard';
import { COLUMN, H1, H2, LEDE, ROWS } from '../components/common/Panel';
import { BTN_SECONDARY } from '../components/common/Button';
import type { FeedCard } from '../../lib/earnkit/feed';

export const FEED_TITLE = 'Feed';
export const FEED_LINE = 'What builders on the leaderboard shipped, week by week. Every fact is checked.';
export const FEED_EMPTY = 'No updates yet. New ones post every Monday.';

/**
 * v2.13 spec "The feed", v3 Stage 3 (spec 5.8): the title and its line, then each finished week as a section: an H2
 * ("Week of Oct 12") over one hairline list of long UpdateCards (the week named once, so the rows omit it), best
 * first; a clear empty state. Pure.
 */
export default function FeedView({ weeks }: { weeks: { monday: string; label: string; cards: FeedCard[] }[] }) {
  return (
    <>
      <div className={`${COLUMN} pt-8 md:pt-12`}>
        <section aria-label={FEED_TITLE}>
          <h1 className={H1}>{FEED_TITLE}</h1>
          <p className={LEDE}>{FEED_LINE}</p>
        </section>
        <section aria-label="Updates" className="mt-10 md:mt-14">
          {weeks.length === 0 ? (
            <div className="flex flex-col items-start gap-4 border-y border-ek-line py-10 md:py-14">
              <p className="font-funnel-display text-xl font-medium text-ek-text md:text-2xl">{FEED_EMPTY}</p>
              <Link href="/leaderboard" className={BTN_SECONDARY}>
                See the leaderboard
              </Link>
            </div>
          ) : (
            weeks.map((w) => (
              <section key={w.monday} aria-label={w.label} className="mb-14 last:mb-0 md:mb-24">
                <h2 className={H2}>{w.label}</h2>
                <ul className={`${ROWS} mt-6 md:mt-8`}>
                  {w.cards.map((c) => (
                    <li key={c.id}>
                      <UpdateCard card={c} shape="long" showWeek={false} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </section>
      </div>
      <Footer />
    </>
  );
}
