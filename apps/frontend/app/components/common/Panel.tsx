import type { ReactNode } from 'react';

/**
 * The site's content panel: the homepage's rounded navy section (40px, 56px from md), full width,
 * stacked 16px apart. The campaign, bonus and policy pages are built from it.
 */
export function Panel({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className={`rounded-[40px] bg-ek-navy-deep px-6 md:rounded-[56px] md:px-16 ${className}`}
    >
      {children}
    </section>
  );
}

/** The small uppercase label above a heading (homepage "Backed by"). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-funnel-sans text-xs font-medium uppercase tracking-[0.3em] text-ek-blue-soft">
      {children}
    </p>
  );
}
