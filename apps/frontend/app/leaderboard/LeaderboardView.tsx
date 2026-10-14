import Link from 'next/link';
import Footer from '../components/common/Footer';
import { Panel } from '../components/common/Panel';
import Avatar from '../[handle]/Avatar';
import { BOARD_TITLE, boardLine, type BoardRow } from '../../lib/earnkit/page-data';
import { pagePath } from '../../lib/earnkit/reserved-routes';

/** One person: their rank, picture and @handle (linking their page, the whole row is the hit area), their best project in plain words. */
function Row({ r }: { r: BoardRow }) {
  return (
    <li
      data-row={r.handle}
      className="relative grid grid-cols-[2.75rem_auto_minmax(0,1fr)] items-center gap-x-3 border-t border-ek-blue-soft/10 py-4 transition-colors first:border-t-0 hover:bg-ek-navy/30 md:grid-cols-[3.5rem_auto_minmax(0,16rem)_minmax(0,1fr)] md:gap-x-5 md:rounded-3xl md:border-t-0 md:px-4 md:py-3"
    >
      <span className={`font-funnel-display text-lg font-medium tabular-nums ${r.rank <= 3 ? 'text-ek-score-orange' : 'text-ek-blue-soft'}`}>#{r.rank}</span>
      <Avatar src={r.avatar} handle={r.handle} className="h-11 w-11 text-base" />
      <div className="min-w-0 md:contents">
        <Link
          href={pagePath(r.handle)}
          className="block truncate font-funnel-display text-lg font-medium text-ek-white after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-ek-blue-soft"
        >
          @{r.handle}
        </Link>
        <p className="truncate font-funnel-sans text-sm font-light text-ek-blue-light md:text-base">{r.best}</p>
      </div>
    </li>
  );
}

/**
 * v2.12.1 spec "Leaderboard": one list. Rank, picture and @handle, the best project in plain words;
 * only ranked people with a confirmed X. No filters, no tabs, no pages, no capital labels. Pure.
 */
export default function LeaderboardView({ rows, count }: { rows: BoardRow[]; count: number }) {
  return (
    <div className="w-full pt-4">
      <Panel className="relative overflow-hidden py-10 md:py-16" label="Leaderboard">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-48 h-[28rem] w-[28rem] rounded-full bg-ek-score-purple/[0.09] blur-3xl" />
        <div className="relative">
          <h1 className="font-funnel-display text-[2.125rem] font-medium leading-[1.1] tracking-tight text-ek-white sm:text-5xl md:text-[4rem] md:leading-[1.05]">{BOARD_TITLE}</h1>
          <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">{boardLine(count)}</p>
        </div>
      </Panel>
      <Panel className="mt-4 py-4 md:py-8" label="Builders">
        {rows.length === 0 ? (
          <p className="py-6 font-funnel-sans text-base font-light text-ek-blue-light">No one is ranked yet.</p>
        ) : (
          <ol className="md:-mx-4">
            {rows.map((r) => (
              <Row key={r.handle} r={r} />
            ))}
          </ol>
        )}
      </Panel>
      <Footer />
    </div>
  );
}
