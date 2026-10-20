import Link from 'next/link';
import ChainLogo from '../components/ui/ChainLogo';
import RaisingPill from '../components/ui/RaisingPill';
import Avatar from '../[handle]/Avatar';
import { NUM } from '../components/common/Panel';
import type { BenchRow } from '../../lib/earnkit/bench-data';
import { pagePath } from '../../lib/earnkit/reserved-routes';

/**
 * v2.13, v3 Stage 3 (spec 5.8): one builder on the leaderboard (the /leaderboard page and the landing's top 10), a
 * hairline row: the rank ("#N" in Display 24px; R18 fix 1: the full rank line is read to screen readers), the photo
 * with the name (its link is the whole row's hit area, at least 44px) and the @handle, chain logos and the Backing
 * pill under it, the project with its best fact under it (two lines, no dotted pair), then the Shipping number (R17).
 * From md the four columns sit on one line (3rem | 1fr | 1fr | 5rem); on a phone the project and fact drop to a
 * second line under the name. R11: names are never cut; long ones wrap at spaces.
 */
export default function BenchRowItem({ r }: { r: BenchRow }) {
  const handleShown = r.name !== `@${r.handle}`;
  return (
    <li
      data-row={r.handle}
      className="relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-ek-line py-4 md:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)_5rem] md:gap-x-6 md:py-5"
    >
      {/* On a phone the row is two lines: the rank and the number sit on the first, level with the photo. */}
      <span data-rank="" className="mt-2.5 self-start md:mt-0 md:self-center">
        <span aria-hidden="true" className={`${NUM} text-2xl font-medium leading-none text-ek-text`}>#{r.rank}</span>
        <span className="sr-only">{r.line ?? `#${r.rank}`}</span>
      </span>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={r.avatar} handle={r.handle} className="h-11 w-11 text-base" />
        <div className="min-w-0">
          <Link
            href={pagePath(r.handle)}
            className="block min-w-0 font-funnel-display text-base font-medium leading-tight text-ek-text [overflow-wrap:break-word] after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ek-accent md:text-lg"
          >
            {r.name}
          </Link>
          {(handleShown || r.chains.length > 0 || r.backing) && (
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-funnel-sans text-sm text-ek-muted">
              {handleShown && <span className="min-w-0 [overflow-wrap:break-word]">@{r.handle}</span>}
              {r.chains.length > 0 && (
                // Above the row's link, so each logo's tooltip shows.
                <span className="relative z-10 inline-flex shrink-0 items-center gap-1">
                  {r.chains.map((c) => (
                    <ChainLogo key={c} chain={c} size={18} />
                  ))}
                </span>
              )}
              {r.backing && (
                <span className="relative z-10">
                  <RaisingPill symbol={r.backing.symbol} url={r.backing.url} size="sm" />
                </span>
              )}
            </p>
          )}
        </div>
      </div>
      <div className="col-start-2 min-w-0 md:col-start-3 md:row-start-1">
        <p className="font-funnel-sans text-base leading-snug text-ek-body [overflow-wrap:break-word]">{r.project}</p>
        <p className="font-funnel-sans text-sm text-ek-muted [overflow-wrap:break-word]">{r.best}</p>
      </div>
      <span data-points="" className="col-start-3 row-start-1 mt-2.5 self-start text-right md:col-start-4 md:mt-0 md:self-center">
        <span className={`${NUM} text-2xl font-medium leading-none text-ek-text`}>{r.points}</span>
        <span className="sr-only">Shipping</span>
      </span>
    </li>
  );
}
