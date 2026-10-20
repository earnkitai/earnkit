import Link from 'next/link';
import Footer from '../components/common/Footer';
import { BTN_SECONDARY } from '../components/common/Button';
import { COLUMN, H1, LEDE, Panel } from '../components/common/Panel';
import ChainLogo from '../components/ui/ChainLogo';
import { filterHref, type BenchFilter, type BenchRow } from '../../lib/earnkit/bench-data';
import { CHAIN_LABEL, type BenchChain } from '../../lib/earnkit/rank';
import { benchLine } from '../components/sections/BenchTop';
import BenchRowItem from './BenchRowItem';
import { Chip, FILTER_WEEKLY } from './FilterChip';

export const BENCH_TITLE = 'Leaderboard';
export { benchLine };
export const BENCH_EMPTY = 'No builder matches this filter yet.';
export const BENCH_SHOW_ALL = 'Show everyone';
export { FILTER_WEEKLY };

/**
 * v2.13 spec "The Bench" (R4, R9, R14): one row per builder, best score first; filters are links
 * (a chain chip from one ranked project on it, Shipping every week; launch-ready L3: no community round chip). Pure.
 */
export default function BenchView({ rows, count, chips, filter }: { rows: BenchRow[]; count: number; chips: BenchChain[]; filter: BenchFilter }) {
  return (
    <>
      <div className={`${COLUMN} pt-8 md:pt-12`}>
        <section aria-label={BENCH_TITLE}>
          <h1 className={H1}>{BENCH_TITLE}</h1>
          <p className={LEDE}>{benchLine(count)}</p>
          <nav aria-label="Filters" className="mt-6 flex flex-wrap gap-2">
            {chips.map((c) => (
              <Chip key={c} on={filter.chain === c} href={filterHref({ ...filter, chain: filter.chain === c ? null : c })}>
                <span aria-hidden="true" className="inline-flex">
                  <ChainLogo chain={c} size={18} />
                </span>
                {CHAIN_LABEL[c]}
              </Chip>
            ))}
            <Chip on={filter.weekly} href={filterHref({ ...filter, weekly: !filter.weekly })}>
              {FILTER_WEEKLY}
            </Chip>
          </nav>
        </section>
        {/* v2.13.2 fix 1: nobody ranked: the header's empty line is the only one; a filtered view with no rows keeps BENCH_EMPTY. */}
        {count > 0 && (
          <Panel className="mt-6 py-2 md:mt-8 md:py-4" label="Builders">
            {rows.length === 0 ? (
              // Launch ready L10: only a filter can empty a ranked board, so the way back is one tap.
              <div className="flex flex-wrap items-center justify-between gap-3 py-6">
                <p className="font-funnel-sans text-base text-ek-body">{BENCH_EMPTY}</p>
                <Link href={filterHref({ chain: null, weekly: false })} className={BTN_SECONDARY}>
                  {BENCH_SHOW_ALL}
                </Link>
              </div>
            ) : (
              <ol className="md:-mx-4">
                {rows.map((r) => (
                  <BenchRowItem key={r.handle} r={r} />
                ))}
              </ol>
            )}
          </Panel>
        )}
      </div>
      <Footer />
    </>
  );
}
