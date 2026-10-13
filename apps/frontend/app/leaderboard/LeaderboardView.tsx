import Link from 'next/link';
import Footer from '../components/common/Footer';
import { Eyebrow, Panel } from '../components/common/Panel';
import { boardHref, type BoardFilters, type BoardRow, type LeaderboardData } from '../../lib/earnkit/profile-data';

type Program = { id: string; title: string };

const PILL = 'inline-flex h-9 items-center rounded-full px-4 font-funnel-sans text-sm font-medium transition-colors';
const ON = 'bg-ek-blue-light text-ek-navy-deep';
const OFF = 'text-ek-blue-light ring-1 ring-inset ring-ek-blue-soft/20 hover:text-ek-white hover:ring-ek-blue-soft/50';

/** A filter link: the same filters with one changed, back on page 1. */
function Pill({ to, on, children }: { to: BoardFilters; on: boolean; children: string }) {
  return (
    <Link href={boardHref({ ...to, page: 1 })} aria-current={on ? 'page' : undefined} className={`${PILL} ${on ? ON : OFF}`}>
      {children}
    </Link>
  );
}

function Filters({ f, programs }: { f: BoardFilters; programs: Program[] }) {
  const chosen = programs.find((p) => p.id === f.program);
  return (
    <nav aria-label="Filters" className="mt-8 flex flex-wrap items-start gap-x-4 gap-y-3 md:gap-x-6">
      <ul className="flex flex-wrap gap-2" aria-label="Chain">
        <li><Pill to={{ ...f, chain: null }} on={f.chain === null}>All</Pill></li>
        <li><Pill to={{ ...f, chain: 'base' }} on={f.chain === 'base'}>Base</Pill></li>
        <li><Pill to={{ ...f, chain: 'arc' }} on={f.chain === 'arc'}>Arc</Pill></li>
      </ul>
      <ul className="flex flex-wrap gap-2" aria-label="Window">
        <li><Pill to={{ ...f, window: 'all' }} on={f.window === 'all'}>All time</Pill></li>
        <li><Pill to={{ ...f, window: 'week' }} on={f.window === 'week'}>This week</Pill></li>
      </ul>
      {programs.length > 0 ? (
        <details className="group relative min-w-0 md:max-w-sm">
          <summary className={`${PILL} ${chosen ? ON : OFF} max-w-full cursor-pointer list-none gap-2 [&::-webkit-details-marker]:hidden`}>
            <span className="truncate">{chosen ? chosen.title : 'Any program'}</span>
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180">
              <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <ul className="mt-2 flex flex-col gap-1 rounded-3xl bg-ek-navy p-2 ring-1 ring-inset ring-ek-blue-soft/10" aria-label="Program">
            <li>
              <Link href={boardHref({ ...f, program: null, page: 1 })} aria-current={f.program === null ? 'page' : undefined} className="block rounded-2xl px-4 py-2.5 font-funnel-sans text-sm text-ek-blue-light hover:bg-ek-navy-deep hover:text-ek-white">
                Any program
              </Link>
            </li>
            {programs.map((p) => (
              <li key={p.id}>
                <Link
                  href={boardHref({ ...f, program: p.id, page: 1 })}
                  aria-current={p.id === f.program ? 'page' : undefined}
                  className={`block break-words rounded-2xl px-4 py-2.5 font-funnel-sans text-sm hover:bg-ek-navy-deep hover:text-ek-white ${p.id === f.program ? 'text-ek-white' : 'text-ek-blue-light'}`}
                >
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </nav>
  );
}

/** The week's change in words: "up 6", "down 2", "no change". */
function Moved({ n }: { n: number }) {
  if (n === 0) return <span className="block text-xs font-normal text-ek-blue-soft">no change</span>;
  return <span className={`block text-xs font-medium ${n > 0 ? 'text-ek-score-orange' : 'text-ek-blue-soft'}`}>{n > 0 ? `up ${n}` : `down ${-n}`}</span>;
}

/**
 * One builder. On a phone the row is a small grid (rank | name, outcome | score, rank); from md it is
 * a table row. The name links the profile and its hit area covers the row.
 */
function Row({ r, week }: { r: BoardRow; week: boolean }) {
  return (
    <tr
      data-row={r.slug}
      className="relative grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-ek-blue-soft/10 py-4 first:border-t-0 md:first:border-t transition-colors hover:bg-ek-navy/40 md:table-row md:py-0"
    >
      <td className={`col-start-1 row-start-1 self-baseline font-funnel-display text-base tabular-nums md:table-cell md:py-5 md:pl-4 ${r.rank <= 3 && !week ? 'text-ek-score-orange' : 'text-ek-blue-soft'}`}>
        {r.rank}
      </td>
      <td className="col-start-2 row-start-1 min-w-0 self-baseline md:table-cell md:py-5 md:pr-4">
        <Link
          href={`/b/${encodeURIComponent(r.slug)}`}
          className="block truncate font-funnel-display text-lg font-medium text-ek-white after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ek-blue-soft"
        >
          {r.name}
        </Link>
      </td>
      <td className="col-start-3 row-start-1 self-baseline text-right font-funnel-display text-lg font-medium tabular-nums text-ek-white md:table-cell md:py-5 md:pr-6">
        {r.score}
        {week ? <Moved n={r.change_7d} /> : null}
      </td>
      <td className="col-start-3 row-start-2 text-right font-funnel-sans text-xs text-ek-blue-soft md:table-cell md:py-5 md:pr-6 md:text-sm md:text-ek-blue-light">
        {r.top_percent !== null ? `Top ${r.top_percent}%` : null}
      </td>
      <td className="col-start-2 row-start-2 min-w-0 font-funnel-sans text-sm font-light text-ek-blue-soft md:table-cell md:py-5 md:pr-4">
        <span className="line-clamp-2 break-words md:line-clamp-1">{r.top_outcome}</span>
      </td>
    </tr>
  );
}

const Th = ({ children, className = '' }: { children: string; className?: string }) => (
  <th scope="col" className={`pb-3 font-funnel-sans text-xs font-medium uppercase tracking-[0.2em] text-ek-blue-soft ${className}`}>
    {children}
  </th>
);

/**
 * v2.12 spec 7: the public leaderboard (/leaderboard). Everyone who installed and has a public score,
 * except hidden people: rank, name (X, else GitHub, else "Builder"), score, "Top N%", the top outcome
 * in plain words, each row linking the profile. Filters are links (chain, program, window), 50 a
 * page. Pure: everything comes from `data` and `programs`.
 */
export default function LeaderboardView({ data, programs }: { data: LeaderboardData; programs: Program[] }) {
  const f = data.filters;
  const week = f.window === 'week';
  return (
    <div className="w-full pt-4">
      <Panel className="relative overflow-hidden py-10 md:py-14" label="Leaderboard">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 h-80 w-80 rounded-full bg-ek-score-purple/10 blur-3xl" />
        <div className="relative">
          <Eyebrow>Leaderboard</Eyebrow>
          <h1 className="mt-4 font-funnel-display text-3xl font-medium leading-tight text-ek-white md:text-5xl">
            {week ? 'Biggest movers this week' : 'Builders by verified score'}
          </h1>
          <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">
            {week
              ? 'Ranked by how much each score moved in the last 7 days.'
              : 'Scored only from verified outcomes: real people using what they shipped.'}
          </p>
          <Filters f={f} programs={programs} />
        </div>
      </Panel>

      <Panel className="mt-4 py-6 md:py-10" label="Builders">
        {data.rows.length === 0 ? (
          <p className="py-6 font-funnel-sans text-base font-light text-ek-blue-soft">No builders here yet.</p>
        ) : (
          <table className="block w-full md:table md:table-fixed">
            <thead className="hidden md:table-header-group">
              <tr className="text-left">
                <Th className="w-16 pl-4">#</Th>
                <Th>Builder</Th>
                <Th className="w-24 pr-6 text-right">Score</Th>
                <Th className="w-28 pr-6 text-right">Rank</Th>
                <Th className="w-[38%]">Top outcome</Th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {data.rows.map((r) => (
                <Row key={r.slug} r={r} week={week} />
              ))}
            </tbody>
          </table>
        )}
        {data.pages > 1 ? (
          <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-4 border-t border-ek-blue-soft/10 pt-6 font-funnel-sans text-sm">
            {data.page > 1 ? (
              <Link href={boardHref({ ...f, page: data.page - 1 })} rel="prev" className={`${PILL} ${OFF}`}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ek-blue-soft">
              Page {data.page} of {data.pages}
            </span>
            {data.page < data.pages ? (
              <Link href={boardHref({ ...f, page: data.page + 1 })} rel="next" className={`${PILL} ${OFF}`}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </Panel>
      <Footer />
    </div>
  );
}
