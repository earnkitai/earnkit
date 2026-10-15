import Link from 'next/link';
import ChainLogo from '../components/ui/ChainLogo';
import RaisingPill from '../components/ui/RaisingPill';
import Avatar from '../[handle]/Avatar';
import type { BenchRow } from '../../lib/earnkit/bench-data';
import { pagePath } from '../../lib/earnkit/reserved-routes';

/** v2.13: one builder on the Bench (the /bench page and the landing's top 10): photo, name and @handle (linking their page, the whole row is the hit area), the pill and chain logos, the project and its best fact, the rank on the right. */
export default function BenchRowItem({ r }: { r: BenchRow }) {
  return (
    <li
      data-row={r.handle}
      className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-ek-blue-soft/10 py-4 transition-colors first:border-t-0 hover:bg-ek-navy/30 md:gap-x-5 md:rounded-3xl md:border-t-0 md:px-4 md:py-3"
    >
      <Avatar src={r.avatar} handle={r.handle} className="h-11 w-11 text-base" />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={pagePath(r.handle)}
            className="min-w-0 max-w-full truncate font-funnel-display text-base font-medium text-ek-white after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-ek-blue-soft md:text-lg"
          >
            {r.name}
          </Link>
          {r.name !== `@${r.handle}` && <span className="min-w-0 truncate font-funnel-sans text-sm font-light text-ek-blue-soft">@{r.handle}</span>}
          {r.chains.length > 0 && (
            // Above the row's link, so each logo's tooltip shows.
            <span className="relative z-10 inline-flex items-center gap-1">
              {r.chains.map((c) => (
                <ChainLogo key={c} chain={c} size={18} />
              ))}
            </span>
          )}
          {r.raising && (
            <span className="relative z-10">
              <RaisingPill symbol={r.raising.symbol} url={r.raising.url} size="sm" />
            </span>
          )}
        </div>
        {/* Phone: the project and its best fact on two lines, so neither is cut; one line from sm. */}
        <p className="mt-1 font-funnel-sans text-sm font-light text-ek-blue-light sm:truncate">
          <span className="block truncate font-normal text-ek-white sm:inline">{r.project}</span>
          <span aria-hidden="true" className="hidden px-1.5 text-ek-blue-soft/60 sm:inline">·</span>
          <span className="block truncate sm:inline">{r.best}</span>
        </p>
      </div>
      <span className="whitespace-nowrap text-right font-funnel-display text-lg text-ek-white tabular-nums">{r.line ?? `#${r.rank}`}</span>
    </li>
  );
}
