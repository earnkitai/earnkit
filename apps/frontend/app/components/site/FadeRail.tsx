'use client';

import { useEffect, useRef, type ComponentProps } from 'react';

/**
 * QA item 8: a sideways rail says it scrolls. While its content runs past an edge the rail carries `data-fade` ("end",
 * "start" or "both") and globals.css `.ek-fade` softens that edge with a mask; a rail that fits carries nothing. Written
 * straight to the element on scroll and resize, so scrolling never re-renders React.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      const fade = start && end ? 'both' : start ? 'start' : end ? 'end' : null;
      if (fade) el.dataset.fade = fade;
      else delete el.dataset.fade;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const size = new ResizeObserver(update);
    size.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      size.disconnect();
    };
  }, []);
  return ref;
}

/** A `<nav>` rail with the edge fade (SegTabs). */
export default function FadeNav(props: ComponentProps<'nav'>) {
  const ref = useEdgeFade<HTMLElement>();
  return <nav ref={ref} {...props} />;
}
