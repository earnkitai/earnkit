// carousel.ts: v2.8 Ruling 20 (plan). Pure, so the scroll math is tested without a DOM.

/** The next `scrollLeft` after one arrow press: one card and its gap, clamped to the ends. */
export function scrollStep(a: { scrollLeft: number; clientWidth: number; scrollWidth: number; cardWidth: number; gap: number; dir: 1 | -1 }): number {
  const max = Math.max(0, a.scrollWidth - a.clientWidth);
  return Math.min(max, Math.max(0, a.scrollLeft + a.dir * (a.cardWidth + a.gap)));
}

/** Which arrows are enabled: none when nothing overflows; each one off at its end (1px slack for sub-pixel widths). */
export function arrowState(a: { scrollLeft: number; clientWidth: number; scrollWidth: number }): { prev: boolean; next: boolean } {
  if (a.scrollWidth <= a.clientWidth) return { prev: false, next: false };
  return { prev: a.scrollLeft > 0, next: a.scrollLeft + a.clientWidth < a.scrollWidth - 1 };
}
