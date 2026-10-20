import type { ReactNode } from 'react';
import Link from 'next/link';

/** v2.13 spec "The Bench": the filter chips' words and markup, shared by /leaderboard (BenchView) and the landing's top 10 (BenchTop). */
export const FILTER_WEEKLY = 'Shipping every week';
/** v3 Stage 2: builders with backing open (`?backed=1`), only while EARNKIT_RAISING is on. */
export const FILTER_BACKED = 'Backed';

/** v3 Stage 3 (spec 5.8): a hairline pill, 44px on a phone (36px from md); on, it inverts to white with black text. */
const CHIP = 'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 font-funnel-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ek-accent md:h-9';
const CHIP_ON = 'border-ek-text bg-ek-text text-ek-page';
const CHIP_OFF = 'border-ek-line-strong text-ek-body hover:bg-ek-chip hover:text-ek-text';

/**
 * A filter: a link to the same leaderboard with it toggled (never a form, so every variant is a plain URL).
 * The landing's top 10 uses it without `on`: a plain link into the leaderboard, not a toggle.
 */
export function Chip({ on, href, children }: { on?: boolean; href: string; children: ReactNode }) {
  return (
    <Link href={href} aria-pressed={on} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
      {children}
    </Link>
  );
}
