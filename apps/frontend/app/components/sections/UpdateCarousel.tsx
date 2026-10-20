'use client';

import Link from 'next/link';
import CarouselRow from './CarouselRow';
import UpdateCard from '../ui/UpdateCard';
import type { FeedCard } from '../../../lib/earnkit/feed';
import { H2 } from '../common/Panel';

export const CAROUSEL_TITLE = 'Shipped this week';
export const SEE_ALL_UPDATES = 'See all';

/**
 * v2.13 spec "Landing page" 3: the feed's top cards (feed.ts carouselCards) as square cards (photo,
 * @handle, project, the update's first line, at most two chips) in a carousel row (CarouselRow),
 * with a link to the whole feed beside the title.
 */
export default function UpdateCarousel({ cards }: { cards: FeedCard[] }) {
  const head = (
    <div className="flex items-baseline gap-4">
      <h2 className={H2}>{CAROUSEL_TITLE}</h2>
      <Link href="/feed" className="inline-flex min-h-11 items-center font-funnel-sans text-base font-medium text-ek-accent underline-offset-4 hover:underline">
        {SEE_ALL_UPDATES}
      </Link>
    </div>
  );
  return (
    <section aria-label={CAROUSEL_TITLE}>
      <CarouselRow label={CAROUSEL_TITLE} arrows="updates" head={head} count={cards.length}>
        {cards.map((c) => (
          <li key={c.id} className="flex-shrink-0 snap-start">
            <UpdateCard card={c} shape="square" />
          </li>
        ))}
      </CarouselRow>
    </section>
  );
}
