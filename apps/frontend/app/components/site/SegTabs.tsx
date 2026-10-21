import Link from 'next/link';

/**
 * A pill rail of links (canvas: leaderboard filters All / Base / Backed on the panel, feed week tabs on
 * the step colour). The current item is a white pill with aria-current="page". On a phone the rail
 * scrolls sideways instead of widening the page; every tab is 44px tall there, 38px from md.
 */
const TONES = {
  panel: { rail: 'bg-s-panel', idle: 'text-s-muted', on: 'bg-s-light text-s-ink' },
  step: { rail: 'bg-s-step-top', idle: 'text-s-card-handle', on: 'bg-s-light text-s-deep' },
} as const;

export default function SegTabs({
  items,
  tone = 'panel',
  label,
  className = '',
}: {
  items: { label: string; href: string; on: boolean }[];
  tone?: keyof typeof TONES;
  label: string;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <nav aria-label={label} className={`no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full p-1 ${t.rail} ${className}`.trim()}>
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.on ? 'page' : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-[18px] text-sm font-semibold transition-colors md:min-h-[38px] ${
            it.on ? t.on : `${t.idle} hover:text-s-text`
          }`}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
