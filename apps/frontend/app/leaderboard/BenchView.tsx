import Link from 'next/link';
import Footer from '../components/common/Footer';
import { BTN_SECONDARY } from '../components/common/Button';
import { COLUMN, H1, LEDE, ROWS } from '../components/common/Panel';
import ChainLogo from '../components/ui/ChainLogo';
import { filterHref, type BenchFilter, type BenchRow } from '../../lib/earnkit/bench-data';
import { CHAIN_LABEL, type BenchChain } from '../../lib/earnkit/rank';
import { BENCH_TOP_EMPTY, benchLine } from '../components/sections/BenchTop';
import BenchRowItem from './BenchRowItem';
import { Chip, FILTER_BACKED, FILTER_WEEKLY } from './FilterChip';
import { raisingEnabled } from '../../lib/earnkit/builder-score-flag';

export const BENCH_TITLE = 'Leaderboard';
export { benchLine };
export const BENCH_EMPTY = 'No builder matches this filter yet.';
export const BENCH_SHOW_ALL = 'Show everyone';
export { FILTER_BACKED, FILTER_WEEKLY };

/**
 * v2.13 spec "The Bench" (R4, R9, R14), v3 Stage 3 (spec 5.8): the title, the count line, the filters as hairline
 * pills (links: a chain chip from one ranked project on it, Shipping every week; v3 Stage 2: Backed, only with
 * EARNKIT_RAISING on), then one hairline row per builder, best score first.
 */
export default function BenchView({ rows, count, chips, filter }: { rows: BenchRow[]; count: number; chips: BenchChain[]; filter: BenchFilter }) {
  return (
    <>
      <div className={`${COLUMN} pt-8 md:pt-12`}>
        <section aria-label={BENCH_TITLE}>
          <h1 className={H1}>{BENCH_TITLE}</h1>
          <p className={LEDE}>{count > 0 ? benchLine(count) : BENCH_TOP_EMPTY}</p>
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
            {raisingEnabled() ? (
              <Chip on={Boolean(filter.backed)} href={filterHref({ ...filter, backed: !filter.backed })}>
                {FILTER_BACKED}
              </Chip>
            ) : null}
          </nav>
        </section>
        {/* v2.13.2 fix 1: nobody ranked: the header's empty line is the only one; a filtered view with no rows keeps BENCH_EMPTY. */}
        {count > 0 &&
          (rows.length === 0 ? (
            // Launch ready L10: only a filter can empty a ranked board, so the way back is one tap.
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-y border-ek-line py-6 md:mt-10">
              <p className="font-funnel-sans text-base text-ek-body">{BENCH_EMPTY}</p>
              <Link href={filterHref({ chain: null, weekly: false })} className={BTN_SECONDARY}>
                {BENCH_SHOW_ALL}
              </Link>
            </div>
          ) : (
            <ol aria-label="Builders" className={`${ROWS} mt-8 md:mt-10`}>
              {rows.map((r) => (
                <BenchRowItem key={r.handle} r={r} />
              ))}
            </ol>
          ))}
      </div>
      <Footer />
    </>
  );
}
