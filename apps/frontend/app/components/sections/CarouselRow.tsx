'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { arrowState, scrollStep } from './carousel';

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
 * v2.8 Ruling 20 (plan), shared by v2.13: the homepage carousels' head and row. `head` sits on the
 * left of the head row, two arrows (from md) on the right; they move one card and turn off at the
 * ends. The row is one `<ul>` with native CSS scroll snap (swipe on mobile); `children` are its
 * `<li>`s, each with `snap-start`. Used by ProgramCards ("Open programs") and UpdateCarousel.
 */
export default function CarouselRow({
  label,
  arrows: noun,
  head,
  count,
  children,
}: {
  /** The row's accessible name ("Open programs"). */
  label: string;
  /** The arrows' noun: "Previous programs", "Next programs". */
  arrows: string;
  head: ReactNode;
  /** The number of items, so the arrows update when it changes. */
  count: number;
  children: ReactNode;
}) {
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
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, count]);

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
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-6">
        {head}
        <div className="hidden gap-3 md:flex">
          <button type="button" aria-label={`Previous ${noun}`} disabled={!arrows.prev} onClick={() => step(-1)} className={ARROW}>
            <Chevron dir={-1} />
          </button>
          <button type="button" aria-label={`Next ${noun}`} disabled={!arrows.next} onClick={() => step(1)} className={ARROW}>
            <Chevron dir={1} />
          </button>
        </div>
      </div>

      {/* Mobile: the row runs to the panel's edges so the next card peeks; the padding keeps focus rings unclipped. */}
      <ul
        ref={scroller}
        tabIndex={0}
        aria-label={label}
        onScroll={update}
        className="-mx-6 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-6 px-6 py-2 [scrollbar-width:none] md:-mx-2 md:mt-10 md:scroll-px-2 md:px-2 [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
    </>
  );
}
