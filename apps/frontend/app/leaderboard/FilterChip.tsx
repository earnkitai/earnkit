import type { ReactNode } from 'react';
import Link from 'next/link';

/** v2.13 spec "The Bench": the filter chips' words and markup, shared by /bench (BenchView) and the landing's top 10 (BenchTop). */
export const FILTER_WEEKLY = 'Shipping every week';

const CHIP = 'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 font-funnel-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ek-blue-soft md:h-9';
const CHIP_ON = 'bg-ek-blue-bright text-ek-page';
const CHIP_OFF = 'border border-ek-line-strong text-ek-body hover:bg-ek-chip hover:text-ek-text';

/**
 * A filter: a link to the same Bench with it toggled (never a form, so every variant is a plain URL).
 * The landing's top 10 uses it without `on`: a plain link into the Bench, not a toggle.
 */
export function Chip({ on, href, children }: { on?: boolean; href: string; children: ReactNode }) {
  return (
    <Link href={href} aria-pressed={on} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
      {children}
    </Link>
  );
}
