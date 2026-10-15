'use client';

import Link from 'next/link';
import { Panel } from '../common/Panel';
import CarouselRow from './CarouselRow';
import UpdateCard from '../ui/UpdateCard';
import type { FeedCard } from '../../../lib/earnkit/feed';

export const CAROUSEL_TITLE = 'This week on the Bench';
export const SEE_ALL_UPDATES = 'See all';

/**
 * v2.13 spec "Landing page" 3: the feed's top cards (feed.ts carouselCards) as square soft-edged
 * cards (photo, @handle, project, the update's first line, at most two chips) in the programs'
 * carousel row (CarouselRow), with a link to the whole feed.
 */
export default function UpdateCarousel({ cards }: { cards: FeedCard[] }) {
  const head = (
    <div>
      <h2 className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">{CAROUSEL_TITLE}</h2>
      <Link
        href="/feed"
        className="mt-6 inline-flex min-h-12 items-center justify-center text-nowrap rounded-full border-2 border-ek-blue-soft/60 px-6 font-funnel-sans text-base font-medium text-ek-blue-light transition-colors hover:border-ek-blue-light hover:text-white"
      >
        {SEE_ALL_UPDATES}
      </Link>
    </div>
  );
  return (
    <Panel label={CAROUSEL_TITLE} className="py-12 md:py-16">
      <CarouselRow label={CAROUSEL_TITLE} arrows="updates" head={head} count={cards.length}>
        {cards.map((c) => (
          <li key={c.id} className="flex-shrink-0 snap-start">
            <UpdateCard card={c} shape="square" />
          </li>
        ))}
      </CarouselRow>
    </Panel>
  );
}
