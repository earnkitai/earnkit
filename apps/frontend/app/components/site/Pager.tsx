import Link from 'next/link';

/**
 * Quiet pagination (canvas: leaderboard "Previous 1 of 3 Next", profile Activity and feed "Newer 1 2 3
 * Older"). Every control is a link; a disabled end is an aria-disabled span at 35% opacity. 44px targets
 * on a phone, 34px from md. One page (or none) renders nothing.
 */
const TONES = {
  /** On a panel or the page (leaderboard). */
  dark: { idle: 'text-s-muted hover:text-s-text', on: 'bg-s-panel-inner text-s-text', count: 'text-s-muted' },
  /** On the dark page beside neutral cards (feed). */
  deep: { idle: 'text-s-card-handle hover:text-s-text', on: 'bg-s-panel-inner text-s-text', count: 'text-s-card-handle' },
  /** On a light card (profile Activity). */
  light: { idle: 'text-s-ink-muted hover:text-s-ink', on: 'bg-s-light-hover text-s-ink', count: 'text-s-ink-muted' },
} as const;

const BTN = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-sm transition-colors md:min-h-[34px] md:min-w-[34px]';

export default function Pager({
  page,
  pages,
  href,
  labels = ['Previous', 'Next'],
  numbers = false,
  tone = 'dark',
  label = 'Pages',
  className = '',
}: {
  page: number;
  pages: number;
  href: (n: number) => string;
  labels?: readonly [string, string];
  numbers?: boolean;
  tone?: keyof typeof TONES;
  label?: string;
  className?: string;
}) {
  if (pages <= 1) return null;
  const t = TONES[tone];
  const end = (text: string, to: number, enabled: boolean) =>
    enabled ? (
      <Link href={href(to)} className={`${BTN} font-medium ${t.idle}`}>
        {text}
      </Link>
    ) : (
      <span aria-disabled="true" className={`${BTN} font-medium opacity-35 ${t.idle}`}>
        {text}
      </span>
    );
  return (
    <nav aria-label={label} className={`flex flex-wrap items-center justify-between gap-1 ${className}`.trim()}>
      {end(labels[0], page - 1, page > 1)}
      {numbers ? (
        <div className="flex flex-wrap items-center gap-1">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
            n === page ? (
              <span key={n} aria-current="page" className={`${BTN} font-semibold ${t.on}`}>
                {n}
              </span>
            ) : (
              <Link key={n} href={href(n)} aria-label={`Page ${n}`} className={`${BTN} font-medium ${t.idle}`}>
                {n}
              </Link>
            ),
          )}
        </div>
      ) : (
        <span className={`text-sm ${t.count}`}>
          {page} of {pages}
        </span>
      )}
      {end(labels[1], page + 1, page < pages)}
    </nav>
  );
}
