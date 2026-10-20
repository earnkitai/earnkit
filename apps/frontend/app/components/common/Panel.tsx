import type { ReactNode } from 'react';

/**
 * R18: the one card surface of the site (24px radius, a hairline border, the soft navy top-down
 * gradient of theme.ts). The profile, feed, leaderboard, programs, guide and terms all use it.
 */
export const SURFACE =
  'rounded-[24px] border border-ek-line bg-gradient-to-b from-ek-surface-top to-ek-surface';

/** The page column every page sits in: the slim top bar's width. */
export const COLUMN = 'mx-auto w-full max-w-6xl px-4 md:px-8';

/** R18: the type scale's two headings: a page's title, and a section's. */
export const H1 = 'font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ek-text sm:text-5xl md:text-[3.5rem] md:leading-[1.05]';
export const H2 = 'font-funnel-display text-2xl font-medium tracking-[-0.02em] text-ek-text md:text-4xl';
/** The one line under a page's title. */
export const LEDE = 'mt-3 max-w-2xl font-funnel-sans text-base text-ek-muted md:mt-4 md:text-lg';

/** A section of a page on the card surface. */
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
    <section id={id} aria-label={label} className={`${SURFACE} px-5 md:px-10 ${className}`}>
      {children}
    </section>
  );
}
