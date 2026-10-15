import type { ReactNode } from 'react';
import Link from 'next/link';
import Footer from '../components/common/Footer';
import { Panel } from '../components/common/Panel';
import ChainLogo from '../components/ui/ChainLogo';
import RaisingPill from '../components/ui/RaisingPill';
import BenchAvatar from './BenchAvatar';
import { filterHref, type BenchFilter, type BenchRow } from '../../lib/earnkit/bench-data';
import { CHAIN_LABEL, type BenchChain } from '../../lib/earnkit/rank';
import { pagePath } from '../../lib/earnkit/reserved-routes';

export const BENCH_TITLE = 'The Bench';
export const benchLine = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'builder' : 'builders'} who ship, ranked by what they shipped and who uses it.`;
export const BENCH_EMPTY = 'No one here yet.';
export const FILTER_RAISING = 'Raising';
export const FILTER_WEEKLY = 'Shipping every week';

const CHIP = 'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 font-funnel-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ek-blue-soft';
const CHIP_ON = 'bg-ek-blue-bright text-ek-navy-deep';
const CHIP_OFF = 'border border-ek-blue-soft/40 text-ek-blue-light hover:border-ek-blue-soft hover:text-ek-white';

/** A filter: a link to the same Bench with it toggled (never a form, so every variant is a plain URL). */
function Chip({ on, href, children }: { on: boolean; href: string; children: ReactNode }) {
  return (
    <Link href={href} aria-pressed={on} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
      {children}
    </Link>
  );
}

/** One builder: photo, name and @handle (linking their page, the whole row is the hit area), the pill and chain logos, the project and its best fact, the rank on the right. */
function Row({ r }: { r: BenchRow }) {
  return (
    <li
      data-row={r.handle}
      className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-ek-blue-soft/10 py-4 transition-colors first:border-t-0 hover:bg-ek-navy/30 md:gap-x-5 md:rounded-3xl md:border-t-0 md:px-4 md:py-3"
    >
      <BenchAvatar src={r.avatar} handle={r.handle} className="h-11 w-11 text-base" />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={pagePath(r.handle)}
            className="min-w-0 max-w-full truncate font-funnel-display text-base font-medium text-ek-white after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-ek-blue-soft md:text-lg"
          >
            {r.name}
          </Link>
          {r.name !== `@${r.handle}` && <span className="min-w-0 truncate font-funnel-sans text-sm font-light text-ek-blue-soft">@{r.handle}</span>}
          {r.chains.length > 0 && (
            // Above the row's link, so each logo's tooltip shows.
            <span className="relative z-10 inline-flex items-center gap-1">
              {r.chains.map((c) => (
                <ChainLogo key={c} chain={c} size={18} />
              ))}
            </span>
          )}
          {r.raising && (
            <span className="relative z-10">
              <RaisingPill symbol={r.raising.symbol} url={r.raising.url} size="sm" />
            </span>
          )}
        </div>
        {/* Phone: the project and its best fact on two lines, so neither is cut; one line from sm. */}
        <p className="mt-1 font-funnel-sans text-sm font-light text-ek-blue-light sm:truncate">
          <span className="block truncate font-normal text-ek-white sm:inline">{r.project}</span>
          <span aria-hidden="true" className="hidden px-1.5 text-ek-blue-soft/60 sm:inline">·</span>
          <span className="block truncate sm:inline">{r.best}</span>
        </p>
      </div>
      <span className="whitespace-nowrap text-right font-funnel-display text-lg text-ek-white tabular-nums">{r.line ?? `#${r.rank}`}</span>
    </li>
  );
}

/**
 * v2.13 spec "The Bench" (R4, R9, R14): one row per builder, best score first; filters are links
 * (a chain chip only from 10 ranked projects on it, Raising, Shipping every week). Pure.
 */
export default function BenchView({ rows, count, chips, filter }: { rows: BenchRow[]; count: number; chips: BenchChain[]; filter: BenchFilter }) {
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
            <Chip on={filter.raising} href={filterHref({ ...filter, raising: !filter.raising })}>
              {FILTER_RAISING}
            </Chip>
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
              <Row key={r.handle} r={r} />
            ))}
          </ol>
        )}
      </Panel>
      <Footer />
    </div>
  );
}
