'use client';

import CarouselRow from './CarouselRow';
import ProgramCard from './ProgramCard';
import { H1, H2, LEDE } from '../common/Panel';
import type { Tile } from '../../../lib/earnkit/landing';

/**
 * v2.8 Rulings 20, 21 (plan), R18: the title, the money line ("$115K in grants and prizes open", v3 Stage 2) and what it leaves out,
 * then every open curated program as a slim card (ProgramCard; each opens its guide, where the agent
 * is one tap away), Base first (landing.ts byRelevance). Home: one carousel row (CarouselRow).
 * /programs: the same cards in a grid (`layout="grid"`, heading h1).
 * v2.13 (`bench`, the landing): the title is "Money open now" (O5 P10).
 */
export default function ProgramCards({
  tiles,
  figure = null,
  more = null,
  heading = 'h2',
  layout = 'carousel',
  bench = false,
}: {
  tiles: Tile[];
  /** The money line ("$115K in grants and prizes open", landing.open_text), shown under the title; null hides the line. */
  figure?: string | null;
  /** v3 Stage 2: what the total leaves out ("Plus 2 accelerators and 1 hackathon.", landing.open_more), a second muted line. */
  more?: string | null;
  /** v2.7 /programs: the cards are the page, so their heading is its h1. */
  heading?: 'h1' | 'h2';
  layout?: 'carousel' | 'grid';
  /** v2.13: the landing (its title). */
  bench?: boolean;
}) {
  const Heading = heading;
  // v2.13.1 O5 (P10): the list includes investments (a16z speedrun), so "Money", not "Grants".
  const title = bench ? 'Money open now' : 'Open programs';

  const head = (
    <div>
      <Heading className={heading === 'h1' ? H1 : H2}>{title}</Heading>
      {figure && <p className={heading === 'h1' ? LEDE : 'mt-2 font-funnel-sans text-base text-ek-muted md:text-lg'}>{figure}</p>}
      {figure && more && <p className="mt-1 font-funnel-sans text-sm text-ek-muted">{more}</p>}
    </div>
  );

  return (
    <section id="open-programs" aria-label={title}>
      {layout === 'carousel' ? (
        <CarouselRow label={title} arrows="programs" head={head} count={tiles.length}>
          {tiles.map((t) => (
            <li key={t.id} className="w-[85%] flex-shrink-0 snap-start sm:w-[48%] lg:w-[31.5%]">
              <ProgramCard tile={t} />
            </li>
          ))}
        </CarouselRow>
      ) : (
        <>
          {head}
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:mt-10">
            {tiles.map((t) => (
              <li key={t.id}>
                <ProgramCard tile={t} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
