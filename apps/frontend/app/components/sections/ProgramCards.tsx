'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '../common/Panel';
import AddToAgent from './AddToAgent';
import ProgramCard from './ProgramCard';
import { arrowState, scrollStep } from './carousel';
import type { Tile } from '../../../lib/earnkit/landing';

const ARROW =
  'flex h-11 w-11 items-center justify-center rounded-full border-2 border-ek-blue-soft/50 text-ek-blue-light transition-colors hover:border-ek-blue-light hover:text-white disabled:cursor-default disabled:border-ek-blue-soft/15 disabled:text-ek-blue-soft/30';

function Chevron({ dir }: { dir: 1 | -1 }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 1 ? 'M8 4l6 6-6 6' : 'M12 4l-6 6 6 6'} />
    </svg>
  );
}

/**
 * v2.8 Rulings 20, 21 (plan): "Open programs", the money figure ("$1.1M+ open right now", v2.9 F21), one "Ask
 * your agent" (the install modal with the starting phrase), then every open curated program as a
 * slim card (ProgramCard), sorted by pool (landing.ts byPool). Home: one row with native CSS scroll
 * snap (swipe on mobile; from md, two arrows that move one card and turn off at the ends).
 * /programs: the same cards in a grid (`layout="grid"`, heading h1), no arrows.
 */
export default function ProgramCards({
  tiles,
  figure = null,
  heading = 'h2',
  layout = 'carousel',
}: {
  tiles: Tile[];
  /** The one money figure ("$1.1M+", landing.open_text), shown under the title; null hides the line. */
  figure?: string | null;
  /** v2.7 /programs: the cards are the page, so their heading is its h1. */
  heading?: 'h1' | 'h2';
  layout?: 'carousel' | 'grid';
}) {
  const Heading = heading;
  const carousel = layout === 'carousel';
  const [asking, setAsking] = useState(false);
  const close = useCallback(() => setAsking(false), []);
  const scroller = useRef<HTMLUListElement>(null);
  // Off until mounted: the static markup cannot know whether the row overflows.
  const [arrows, setArrows] = useState({ prev: false, next: false });

  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const next = arrowState(el);
    setArrows((a) => (a.prev === next.prev && a.next === next.next ? a : next));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!carousel || !el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [carousel, update, tiles.length]);

  const step = (dir: 1 | -1) => {
    const el = scroller.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({
      left: scrollStep({ scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, cardWidth: card.offsetWidth, gap, dir }),
      behavior: reduce ? 'auto' : 'smooth',
    });
  };

  return (
    <Panel id="open-programs" className="py-12 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-6">
        <div>
          <Heading className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">Open programs</Heading>
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
        {carousel && (
          <div className="hidden gap-3 md:flex">
            <button type="button" aria-label="Previous programs" disabled={!arrows.prev} onClick={() => step(-1)} className={ARROW}>
              <Chevron dir={-1} />
            </button>
            <button type="button" aria-label="Next programs" disabled={!arrows.next} onClick={() => step(1)} className={ARROW}>
              <Chevron dir={1} />
            </button>
          </div>
        )}
      </div>

      {/* Mobile: the row runs to the panel's edges so the next card peeks; the padding keeps focus rings unclipped. */}
      {carousel ? (
        <ul
          ref={scroller}
          tabIndex={0}
          aria-label="Open programs"
          onScroll={update}
          className="-mx-6 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-6 px-6 py-2 [scrollbar-width:none] md:-mx-2 md:mt-10 md:scroll-px-2 md:px-2 [&::-webkit-scrollbar]:hidden"
        >
          {tiles.map((t) => (
            <li key={t.id} className="w-[85%] flex-shrink-0 snap-start sm:w-[48%] lg:w-[31.5%]">
              <ProgramCard tile={t} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:mt-10">
          {tiles.map((t) => (
            <li key={t.id}>
              <ProgramCard tile={t} />
            </li>
          ))}
        </ul>
      )}

      {asking && <AddToAgent onClose={close} />}
    </Panel>
  );
}
