import Avatar from '../../[handle]/Avatar';
import { NUM } from '../common/Panel';
import type { FeaturedData } from '../../../lib/earnkit/landing';
import { streakWords } from '../../../lib/earnkit/bench-data';
import { pagePath } from '../../../lib/earnkit/reserved-routes';
import { rankSplit } from '../../../lib/earnkit/rank';
import { weekLabel } from '../../../lib/earnkit/weeks';

/** The score line as its two numbers: "Shipping 72 · #3 of 40 builders" gives "#3" (or "Top 4%"). Pure. */
export function featuredRank(bench: string | null): string | null {
  const rank = bench?.split(' · ')[1];
  return rank ? rankSplit(rank).lead : null;
}

/** Whole dollars, "$1,240". Pure. */
const dollars = (usd: number) => `$${Math.round(usd).toLocaleString('en-US')}`;

const LABEL = 'mt-1.5 font-funnel-sans text-sm text-ek-muted';
const BIG = `${NUM} text-[2rem] font-medium leading-none text-ek-text md:text-[2.5rem]`;

/**
 * v3 Stage 3 (spec 5.8): the founder's live profile preview, the hero's one real artifact. A slice of the page
 * itself: the name and @handle with the streak, the three numbers (Shipping, Rank, Earned when the Stage 2 field
 * exists), the two latest ship log lines, split by hairlines. The whole card is one link to the page.
 */
export default function FeaturedCard({ f, log, points, earned }: FeaturedData) {
  const rank = featuredRank(f.bench);
  const streak = streakWords(f.streak);
  return (
    <a
      href={pagePath(f.handle)}
      data-featured=""
      aria-label={`${f.name}'s page on EarnKit`}
      className="group block w-full border-b border-t border-ek-line font-funnel-sans"
    >
      <div className="flex items-center gap-3 py-4">
        <Avatar src={f.avatar} handle={f.handle} className="h-11 w-11 text-base" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-funnel-display text-lg font-medium leading-tight text-ek-text underline-offset-4 group-hover:underline">{f.name}</p>
          <p className="truncate text-sm text-ek-muted">@{f.handle}</p>
        </div>
        {streak ? <p className="shrink-0 text-sm text-ek-body">{streak}</p> : null}
      </div>

      <ul className={`grid border-t border-ek-line py-5 ${earned !== null ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <li>
          <p className={BIG}>{points}</p>
          <p className={LABEL}>Shipping</p>
        </li>
        {rank ? (
          <li>
            <p className={`${BIG} whitespace-nowrap`}>{rank}</p>
            <p className={LABEL}>Rank</p>
          </li>
        ) : null}
        {earned !== null ? (
          <li>
            <p className={`${BIG} whitespace-nowrap`}>{dollars(earned)}</p>
            <p className={LABEL}>Earned</p>
          </li>
        ) : null}
      </ul>

      {log.length > 0 ? (
        <ol>
          {log.map((l) => (
            <li key={l.week} className="grid gap-x-3 gap-y-1 border-t border-ek-line py-3 text-sm sm:grid-cols-[6.5rem_minmax(0,1fr)]">
              <span className="text-ek-muted">{weekLabel(l.week)}</span>
              <span className="line-clamp-2 text-ek-body">{l.summary}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </a>
  );
}
