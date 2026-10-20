import Avatar from '../../[handle]/Avatar';
import { NUM } from '../common/Panel';
import type { FeaturedData } from '../../../lib/earnkit/landing';
import { dollars, streakWords } from '../../../lib/earnkit/bench-data';
import { pagePath } from '../../../lib/earnkit/reserved-routes';
import { weekLabel } from '../../../lib/earnkit/weeks';

/** One, two or three numbers: a literal class per count, so Tailwind emits it. */
const COLS = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'];

const LABEL = 'mt-1.5 font-funnel-sans text-sm text-ek-muted';
const BIG = `${NUM} text-[2rem] font-medium leading-none text-ek-text md:text-[2.5rem]`;

/**
 * v3 Stage 3 (spec 5.8): the founder's live profile preview, the hero's one real artifact. A slice of the page
 * itself: the name and @handle with the streak, the numbers (Shipping, Rank, Earned when there is money: never "$0"),
 * the two latest ship log lines, split by hairlines. The whole card is one link to the page.
 */
export default function FeaturedCard({ f, rank, log, points, earned }: FeaturedData) {
  const streak = streakWords(f.streak);
  const numbers: [string, string][] = [
    [String(points), 'Shipping'],
    ...(rank ? [[rank, 'Rank'] as [string, string]] : []),
    ...(earned !== null ? [[dollars(earned), 'Earned'] as [string, string]] : []),
  ];
  return (
    <a
      href={pagePath(f.handle)}
      data-featured=""
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

      <ul className={`grid border-t border-ek-line py-5 ${COLS[numbers.length]}`}>
        {numbers.map(([value, label]) => (
          <li key={label}>
            <p className={`${BIG} whitespace-nowrap`}>{value}</p>
            <p className={LABEL}>{label}</p>
          </li>
        ))}
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
