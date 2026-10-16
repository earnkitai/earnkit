import Footer from '../components/common/Footer';
import { Panel } from '../components/common/Panel';
import ChainLogo from '../components/ui/ChainLogo';
import { filterHref, type BenchFilter, type BenchRow } from '../../lib/earnkit/bench-data';
import { CHAIN_LABEL, type BenchChain } from '../../lib/earnkit/rank';
import BenchRowItem from './BenchRowItem';
import { Chip, FILTER_RAISING, FILTER_WEEKLY } from './FilterChip';

export const BENCH_TITLE = 'The Bench';
export const benchLine = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'builder' : 'builders'} who ship, ranked by what they shipped and who uses it.`;
export const BENCH_EMPTY = 'No one here yet.';
export { FILTER_RAISING, FILTER_WEEKLY };

/**
 * v2.13 spec "The Bench" (R4, R9, R14): one row per builder, best score first; filters are links
 * (a chain chip only from 10 ranked projects on it, Raising while `raising` (EARNKIT_RAISING) is on,
 * Shipping every week). Pure.
 */
export default function BenchView({ rows, count, chips, filter, raising }: { rows: BenchRow[]; count: number; chips: BenchChain[]; filter: BenchFilter; raising: boolean }) {
  return (
    <div className="w-full pt-4">
      <Panel className="relative overflow-hidden py-10 md:py-16" label={BENCH_TITLE}>
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-48 h-[28rem] w-[28rem] rounded-full bg-ek-score-purple/[0.09] blur-3xl" />
        <div className="relative">
          <h1 className="font-funnel-display text-[2.125rem] font-medium leading-[1.1] tracking-tight text-ek-white sm:text-5xl md:text-[4rem] md:leading-[1.05]">{BENCH_TITLE}</h1>
          <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">{benchLine(count)}</p>
          <nav aria-label="Filters" className="mt-8 flex flex-wrap gap-2">
            {chips.map((c) => (
              <Chip key={c} on={filter.chain === c} href={filterHref({ ...filter, chain: filter.chain === c ? null : c })}>
                <span aria-hidden="true" className="inline-flex">
                  <ChainLogo chain={c} size={18} />
                </span>
                {CHAIN_LABEL[c]}
              </Chip>
            ))}
            {raising && (
              <Chip on={filter.raising} href={filterHref({ ...filter, raising: !filter.raising })}>
                {FILTER_RAISING}
              </Chip>
            )}
            <Chip on={filter.weekly} href={filterHref({ ...filter, weekly: !filter.weekly })}>
              {FILTER_WEEKLY}
            </Chip>
          </nav>
        </div>
      </Panel>
      <Panel className="mt-4 py-4 md:py-8" label="Builders">
        {rows.length === 0 ? (
          <p className="py-6 font-funnel-sans text-base font-light text-ek-blue-light">{BENCH_EMPTY}</p>
        ) : (
          <ol className="md:-mx-4">
            {rows.map((r) => (
              <BenchRowItem key={r.handle} r={r} />
            ))}
          </ol>
        )}
      </Panel>
      <Footer />
    </div>
  );
}
