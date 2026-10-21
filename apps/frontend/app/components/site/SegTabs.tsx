import Link from 'next/link';

/**
 * A pill rail of links (canvas: leaderboard filters All / Base / Backed on the panel, feed week tabs on
 * the step colour). The current item is a white pill with aria-current="page". On a phone the rail
 * scrolls sideways instead of widening the page; every tab is 44px tall there, 38px from md.
 */
const TONES = {
  panel: { rail: 'bg-s-panel', idle: 'text-s-muted', on: 'bg-s-light text-s-ink' },
  step: { rail: 'bg-s-step-top', idle: 'text-s-card-handle', on: 'bg-s-light text-s-deep' },
  /** Inside the install sheet (a panel): the rail is the page colour. */
  sheet: { rail: 'bg-s-page', idle: 'text-s-muted', on: 'bg-s-light text-s-ink' },
} as const;

export type SegTone = keyof typeof TONES;

/** The rail's classes, for a tab row that is not links (the install sheet's agent tabs). */
export function segRail(tone: SegTone): string {
  return `no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full p-1 ${TONES[tone].rail}`;
}

/** One tab's classes, current or not. */
export function segTab(tone: SegTone, on: boolean): string {
  const t = TONES[tone];
  return `inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-[18px] text-sm font-semibold transition-colors md:min-h-[38px] ${
    on ? t.on : `${t.idle} hover:text-s-text`
  }`;
}

export default function SegTabs({
  items,
  tone = 'panel',
  label,
  className = '',
}: {
  items: { label: string; href: string; on: boolean }[];
  tone?: SegTone;
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={`${segRail(tone)} ${className}`.trim()}>
      {items.map((it) => (
        <Link key={it.href} href={it.href} aria-current={it.on ? 'page' : undefined} className={segTab(tone, it.on)}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
