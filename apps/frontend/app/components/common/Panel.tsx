import type { ReactNode } from 'react';

/**
 * v3 (spec 5.8): the flat system's primitives. No cards: content sits on the black page in one column,
 * split by hairlines. Pages compose COLUMN, SECTION, H1/H2/LEDE, ROWS/ROW and NUM; nothing here has a
 * radius, a gradient or a shadow.
 */

/** The page column every page sits in: 1120px, 16px gutters on a phone, 32px from md. */
export const COLUMN = 'mx-auto w-full max-w-[1120px] px-4 md:px-8';

/** A section of a page: vertical rhythm only. Section titles sit on the page. */
export const SECTION = 'py-14 md:py-24';

/** The type scale's two headings: a page's title (36px, 56px from md) and a section's (24px, 32px from md). */
export const H1 = 'font-funnel-display text-[2.25rem] font-medium leading-[1.05] tracking-[-0.03em] text-ek-text md:text-[3.5rem]';
export const H2 = 'font-funnel-display text-2xl font-medium tracking-[-0.02em] text-ek-text md:text-[2rem]';
/** The one line under a page's title: body colour, a 36rem measure. */
export const LEDE = 'mt-4 max-w-[36rem] font-funnel-sans text-base text-ek-body md:text-lg';

/** A number: Funnel Display, tabular so columns line up. */
export const NUM = 'font-funnel-display tabular-nums tracking-[-0.02em]';

/** A list: rows split by hairlines. ROWS closes the list with a bottom line; each ROW opens with a top one. */
export const ROWS = 'border-b border-ek-line';
export const ROW = 'grid items-center gap-4 border-t border-ek-line py-4 md:py-5';

/**
 * Kept for callers that still wrap a block: a flat block that opens with a hairline. No radius, no
 * gradient, no border on the sides. Later tasks move those callers onto ROWS/ROW.
 */
export const SURFACE = 'border-t border-ek-line';

/** A section of a page: a flat block that opens with a hairline. */
export function Panel({
  children,
  className = '',
  label,
  id,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  /** An anchor target. */
  id?: string;
}) {
  return (
    <section id={id} aria-label={label} className={`${SURFACE} ${className}`}>
      {children}
    </section>
  );
}
