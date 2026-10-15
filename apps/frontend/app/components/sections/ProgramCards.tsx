'use client';

import { useCallback, useState } from 'react';
import { Panel } from '../common/Panel';
import AddToAgent from './AddToAgent';
import CarouselRow from './CarouselRow';
import ProgramCard from './ProgramCard';
import type { Tile } from '../../../lib/earnkit/landing';

/**
 * v2.8 Rulings 20, 21 (plan): "Open programs", the money figure ("$1.1M+ open right now", v2.9 F21), one "Ask
 * your agent" (the install modal with the starting phrase), then every open curated program as a
 * slim card (ProgramCard), sorted by pool (landing.ts byPool). Home: one row with native CSS scroll
 * snap (swipe on mobile; from md, two arrows that move one card and turn off at the ends).
 * /programs: the same cards in a grid (`layout="grid"`, heading h1), no arrows.
 * v2.13 (`bench`, the landing under the flag): the title is "Grants open now" and no card shows
 * the builder bonus pill. The row and arrows are CarouselRow, shared with UpdateCarousel.
 */
export default function ProgramCards({
  tiles,
  figure = null,
  heading = 'h2',
  layout = 'carousel',
  bench = false,
  bonus = true,
}: {
  tiles: Tile[];
  /** The one money figure ("$1.1M+", landing.open_text), shown under the title; null hides the line. */
  figure?: string | null;
  /** v2.7 /programs: the cards are the page, so their heading is its h1. */
  heading?: 'h1' | 'h2';
  layout?: 'carousel' | 'grid';
  /** v2.13: the landing under the flag. */
  bench?: boolean;
  /** v2.13 R16: false under the Bench flag (/programs): no builder bonus pill on a card or in the install modal. */
  bonus?: boolean;
}) {
  const Heading = heading;
  const carousel = layout === 'carousel';
  const [asking, setAsking] = useState(false);
  const close = useCallback(() => setAsking(false), []);
  const title = bench ? 'Grants open now' : 'Open programs';
  // v2.13 R16: no builder bonus pill under the flag (T13 also clears has_bonus at the source).
  const noBonus = bench || !bonus;
  const shown = noBonus ? tiles.map((t) => ({ ...t, has_bonus: false })) : tiles;

  const head = (
    <div>
      <Heading className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">{title}</Heading>
      {figure && (
        <p className="mt-3 font-funnel-display text-2xl font-medium text-ek-blue-bright md:text-3xl">{figure} open right now</p>
      )}
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="mt-6 inline-flex min-h-12 items-center justify-center text-nowrap rounded-full bg-ek-blue-bright px-6 font-funnel-sans text-base font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft"
      >
        Ask your agent
      </button>
    </div>
  );

  return (
    <Panel id="open-programs" className="py-12 md:py-16">
      {carousel ? (
        <CarouselRow label={title} arrows="programs" head={head} count={shown.length}>
          {shown.map((t) => (
            <li key={t.id} className="w-[85%] flex-shrink-0 snap-start sm:w-[48%] lg:w-[31.5%]">
              <ProgramCard tile={t} />
            </li>
          ))}
        </CarouselRow>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-6">{head}</div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:mt-10">
            {shown.map((t) => (
              <li key={t.id}>
                <ProgramCard tile={t} />
              </li>
            ))}
          </ul>
        </>
      )}

      {asking && <AddToAgent onClose={close} bench={noBonus} />}
    </Panel>
  );
}
