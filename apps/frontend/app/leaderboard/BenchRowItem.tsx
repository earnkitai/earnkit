import Link from 'next/link';
import Avatar from '../[handle]/Avatar';
import { streakCount } from '../[handle]/site/StreakCard';
import ScoreText from '../components/site/ScoreText';
import XHandle from '../components/site/XHandle';
import type { BenchRow } from '../../lib/earnkit/bench-data';
import { pagePath } from '../../lib/earnkit/reserved-routes';

/** The Backed tag (Leaderboard board): navy fill, on-navy text. */
const BACKED_TAG = 'inline-flex shrink-0 items-center rounded-full bg-s-navy px-[11px] py-[5px] text-xs font-semibold text-s-on-navy';

/**
 * v3.1 site Task 8: one leaderboard row (Leaderboard board), one link to the builder's page: the place ("#N", only while
 * `ranked`: RANK_MIN_POOL ranked builders), the X photo, the name, the X glyph and @handle (text: the row is the link)
 * with the project (its own line on a phone), the Backed tag (only with `r.backing`: benchRows sets it only while EARNKIT_RAISING is on and never
 * for EarnKit's own repo), the streak and the Shipping score in its band colour. On a phone the streak and the tag drop
 * under the handle. Names and projects wrap, never cut.
 */
export default function BenchRowItem({ r, ranked }: { r: BenchRow; ranked: boolean }) {
  const streak = r.streak > 0 ? streakCount(r.streak) : null;
  const backed = r.backing ? (
    <span data-ek-backed="" className={BACKED_TAG}>
      Backed
    </span>
  ) : null;
  return (
    <li data-row={r.handle}>
      <Link
        href={pagePath(r.handle)}
        className="flex min-h-11 items-center gap-3 rounded-[24px] px-[18px] py-[14px] hover:bg-s-panel-hover focus-visible:outline-offset-[-2px] motion-safe:transition-colors motion-safe:duration-150 md:gap-4"
      >
        {ranked && (
          <span data-rank="" className="w-9 shrink-0 text-[15px] font-semibold text-s-muted">
            <span aria-hidden="true">#{r.rank}</span>
            {r.line && <span className="sr-only">{r.line}</span>}
          </span>
        )}
        <Avatar src={r.avatar} handle={r.handle} className="h-10 w-10 text-base" />
        <span className="flex min-w-0 flex-grow flex-col gap-0.5">
          <span className="min-w-0 text-base font-semibold text-s-text [overflow-wrap:anywhere]">{r.name}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-[13px] text-s-muted">
            <XHandle handle={r.handle} tone="muted" link={false} />
            {/* On a phone the project takes its own line, without the dot. */}
            <span aria-hidden="true" className="hidden md:inline">
              ·
            </span>
            <span className="w-full min-w-0 [overflow-wrap:anywhere] md:w-auto">{r.project}</span>
          </span>
          {(streak || backed) && (
            <span className="mt-1 flex flex-wrap items-center gap-2 md:hidden">
              {backed}
              {streak && <span className="text-[13px] text-s-rust-light">{streak}</span>}
            </span>
          )}
        </span>
        {backed && <span className="hidden md:inline-flex">{backed}</span>}
        <span className="hidden w-[84px] shrink-0 text-right text-sm text-s-rust-light md:inline">{streak}</span>
        <span data-points="" className="w-14 shrink-0 text-right">
          <ScoreText score={r.points} size={30} />
          <span className="sr-only"> Shipping</span>
        </span>
      </Link>
    </li>
  );
}
