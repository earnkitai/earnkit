import Link from 'next/link';
import ChainLogo from '../components/ui/ChainLogo';
import RaisingPill from '../components/ui/RaisingPill';
import Avatar from '../[handle]/Avatar';
import type { BenchRow } from '../../lib/earnkit/bench-data';
import { pagePath } from '../../lib/earnkit/reserved-routes';

/**
 * v2.13: one builder on the leaderboard (the /leaderboard page and the landing's top 10): photo, name and @handle
 * (linking their page, the whole row is the hit area, at least 44px), the pill and chain logos, the project and its
 * best fact, then the Shipping points (R17) and the rank. R18 fix 1 (supersedes R6 for rows): the rank is "#N"
 * alone; the page's header line says what it is out of, and the full rank line is read to screen readers.
 * Final follow-ups 4: the points and rank columns have fixed widths (tabular digits), so they line up at any rank (#1 to #100).
 * R11: names are never cut; long ones wrap at spaces (a single over-long word breaks only when it must).
 */
export default function BenchRowItem({ r }: { r: BenchRow }) {
  return (
    <li
      data-row={r.handle}
      className="relative grid min-h-11 grid-cols-[auto_minmax(0,1fr)_3.25rem_3rem] items-center gap-x-3 border-t border-ek-line py-4 transition-colors first:border-t-0 hover:bg-ek-chip md:gap-x-5 md:rounded-2xl md:border-t-0 md:px-4 md:py-3"
    >
      <Avatar src={r.avatar} handle={r.handle} className="h-11 w-11 text-base" />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            href={pagePath(r.handle)}
            className="min-w-0 max-w-full font-funnel-display text-base font-medium text-ek-text [overflow-wrap:break-word] after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ek-accent md:text-lg"
          >
            {r.name}
          </Link>
          {/* Phone: the @handle and chain logos on their own line; beside the name from sm (launch ready L10: one line, not two). */}
          {(r.name !== `@${r.handle}` || r.chains.length > 0) && (
            <span className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
              {r.name !== `@${r.handle}` && <span className="min-w-0 font-funnel-sans text-sm text-ek-muted [overflow-wrap:break-word]">@{r.handle}</span>}
              {r.chains.length > 0 && (
                // Above the row's link, so each logo's tooltip shows.
                <span className="relative z-10 inline-flex shrink-0 items-center gap-1">
                  {r.chains.map((c) => (
                    <ChainLogo key={c} chain={c} size={18} />
                  ))}
                </span>
              )}
            </span>
          )}
          {r.backing && (
            <span className="relative z-10">
              <RaisingPill symbol={r.backing.symbol} url={r.backing.url} size="sm" />
            </span>
          )}
        </div>
        {/* The project and its best fact on one line (wrapping at spaces). R11: never cut, long names wrap. */}
        <p className="mt-1 font-funnel-sans text-sm text-ek-muted [overflow-wrap:break-word]">
          <span className="text-ek-body">{r.project}</span>
          <span aria-hidden="true" className="px-1.5 text-ek-muted">·</span>
          <span>{r.best}</span>
        </p>
      </div>
      {/* R17: the Shipping points, one compact column. */}
      <span data-points="" className="flex flex-col items-end text-right">
        <span className="font-funnel-display text-lg leading-none text-ek-text tabular-nums">{r.points}</span>
        <span className="mt-1 font-funnel-sans text-xs text-ek-muted">Shipping</span>
      </span>
      <span data-rank="" className="flex flex-col items-end text-right">
        <span aria-hidden="true" className="whitespace-nowrap font-funnel-display text-lg leading-none text-ek-text tabular-nums">#{r.rank}</span>
        <span className="sr-only">{r.line ?? `#${r.rank}`}</span>
      </span>
    </li>
  );
}
