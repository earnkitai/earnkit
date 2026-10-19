import Link from 'next/link';
import { Panel } from '../common/Panel';
import ChainLogo from '../ui/ChainLogo';
import BenchRowItem from '../../leaderboard/BenchRowItem';
import { Chip, FILTER_RAISING } from '../../leaderboard/FilterChip';
import { filterHref, type BenchRow } from '../../../lib/earnkit/bench-data';
import { CHAIN_LABEL, type BenchChain } from '../../../lib/earnkit/rank';

export const BENCH_TOP_TITLE = 'Leaderboard';
export const SEE_BENCH = 'See the leaderboard';
/** v2.13.1 O5 N16: the landing's Bench at go-live, with nobody ranked yet. */
export const BENCH_TOP_EMPTY = 'Nobody on the leaderboard yet. Add EarnKit to your agent and be first.';
const TOP = 10;

/**
 * v2.13 spec "Landing page" 2: the Bench's top 10 as on /bench (BenchRowItem), the chain chips
 * (a chain only from 10 ranked projects on it) and Raising (only with EARNKIT_RAISING on) as links into the filtered Bench, and
 * "See the Bench". Server-safe: links only.
 */
export default function BenchTop({ rows, chips, raising }: { rows: BenchRow[]; chips: BenchChain[]; raising: boolean }) {
  return (
    <Panel id="leaderboard" label={BENCH_TOP_TITLE} className="relative overflow-hidden py-12 md:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-48 h-[28rem] w-[28rem] rounded-full bg-ek-score-purple/[0.09] blur-3xl" />
      <div className="relative">
        <h2 className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">{BENCH_TOP_TITLE}</h2>
        <nav aria-label="Filters" className="mt-6 flex flex-wrap gap-2">
          {chips.map((c) => (
            <Chip key={c} href={filterHref({ chain: c, raising: false, weekly: false })}>
              <span aria-hidden="true" className="inline-flex">
                <ChainLogo chain={c} size={18} />
              </span>
              {CHAIN_LABEL[c]}
            </Chip>
          ))}
          {raising && <Chip href={filterHref({ chain: null, raising: true, weekly: false })}>{FILTER_RAISING}</Chip>}
        </nav>
        {rows.length > 0 ? (
          <ol className="mt-6 md:-mx-4 md:mt-8">
            {rows.slice(0, TOP).map((r) => (
              <BenchRowItem key={r.handle} r={r} />
            ))}
          </ol>
        ) : (
          <p className="mt-6 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">{BENCH_TOP_EMPTY}</p>
        )}
        <Link
          href="/leaderboard"
          className="mt-8 inline-flex min-h-12 items-center justify-center text-nowrap rounded-full bg-ek-blue-bright px-6 font-funnel-sans text-base font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft"
        >
          {SEE_BENCH}
        </Link>
      </div>
    </Panel>
  );
}
