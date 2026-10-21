import Link from 'next/link';
import UpdateCard from '../ui/UpdateCard';
import { H2, ROWS, SUB } from '../common/Panel';
import { TEXT_LINK } from '../common/Button';
import type { FeedCard } from '../../../lib/earnkit/feed';
import { weekLabel } from '../../../lib/earnkit/weeks';

export const FEED_SECTION_TITLE = 'Feed';
export const SEE_ALL_UPDATES = 'See all';

/**
 * v3 Stage 3 (spec 5.6): the landing's Activity cards (landing.activity, at most LANDING_ACTIVITY) as rows, the week named
 * once under the title, "See all" to /feed beside it. Each row is the long UpdateCard (Task 3 restyles it); the
 * section is left out when the week has no rows. Server-safe.
 */
export default function FeedRows({ cards }: { cards: FeedCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section aria-label={FEED_SECTION_TITLE}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className={H2}>{FEED_SECTION_TITLE}</h2>
        <Link href="/feed" className={TEXT_LINK}>
          {SEE_ALL_UPDATES}
        </Link>
      </div>
      <p className={SUB}>{weekLabel(cards[0].week)}</p>
      <ul className={`${ROWS} mt-6 md:mt-8`}>
        {cards.map((c) => (
          <li key={c.id}>
            <UpdateCard card={c} shape="long" showWeek={false} />
          </li>
        ))}
      </ul>
    </section>
  );
}
