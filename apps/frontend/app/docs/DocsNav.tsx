'use client';

import { useEffect, useRef, useState } from 'react';

/** The line a section's top must pass to be the one being read: just under where a clicked section lands (scroll-mt-24). */
const READ_LINE = 140;

type Box = { id: string; top: number; bottom: number };

/**
 * Pure. The section being read: the last whose top has passed the read line (the first before any has). Cards side by
 * side share a top and count as one row: the row's first lights, unless the current one is in the row (a click on
 * "Shipping score" keeps it, not "Programs" beside it). At the bottom of the page, where the last sections may never
 * reach the line, the last section lights, unless the reader picked one (`held`: a click or the hash) that is on screen.
 */
export function readingNow(boxes: Box[], o: { line: number; height: number; current: string | null; held: string | null; atBottom: boolean }): string | null {
  if (boxes.length === 0) return null;
  if (o.atBottom) {
    const held = boxes.find((b) => b.id === o.held);
    return held && held.bottom > 0 && held.top < o.height ? held.id : boxes[boxes.length - 1].id;
  }
  const mine = boxes.find((b) => b.id === o.current);
  const passed = boxes.filter((b) => b.top <= o.line);
  const last = passed.length > 0 ? passed[passed.length - 1] : boxes[0];
  const row = boxes.filter((b) => Math.abs(b.top - last.top) < 4);
  return mine && row.includes(mine) ? mine.id : row[0].id;
}

/**
 * QA item 4: the docs side nav lights the section in view. The server renders the first item lit (the page opens at the
 * top); in the browser the hash and the scroll position (one read per frame) pick the lit one, and a click lights
 * its item at once. The lit item carries aria-current="location".
 */
export default function DocsNav({ items, className }: { items: [string, string][]; className: string }) {
  const [lit, setLit] = useState(items[0]?.[0].slice(1) ?? null);
  // The section the reader picked (a click or the hash), kept while the page sits at its bottom.
  const held = useRef<string | null>(null);
  const hold = (id: string) => {
    held.current = id;
    setLit(id);
  };

  useEffect(() => {
    const els = items.map(([href]) => document.getElementById(href.slice(1))).filter((e): e is HTMLElement => e !== null);
    if (els.length === 0) return;
    let frame = 0;
    const pick = () => {
      frame = 0;
      const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const boxes = els.map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.id, top: r.top, bottom: r.bottom };
      });
      if (!atBottom) held.current = null;
      setLit((current) => readingNow(boxes, { line: READ_LINE, height: window.innerHeight, current, held: held.current, atBottom }) ?? current);
    };
    // One read of the section boxes per frame while scrolling (passive, no layout writes).
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (els.some((e) => e.id === id)) hold(id);
      else onScroll();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('hashchange', fromHash);
    fromHash();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('hashchange', fromHash);
    };
  }, [items]);

  return (
    <nav aria-label="Docs" className={className}>
      {items.map(([href, label]) => {
        const on = href.slice(1) === lit;
        return (
          <a
            key={href}
            href={href}
            aria-current={on ? 'location' : undefined}
            onClick={() => hold(href.slice(1))}
            className={`inline-flex min-h-11 items-center rounded-[16px] px-3.5 py-2.5 lg:min-h-0 ${
              on ? 'bg-s-panel-inner font-semibold text-s-text' : 'text-s-muted hover:text-s-text motion-safe:transition-colors'
            }`}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
