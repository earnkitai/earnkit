import Link from 'next/link';
import { H2, Panel } from '../common/Panel';
import { BTN_SECONDARY } from '../common/Button';
import BenchRowItem from '../../leaderboard/BenchRowItem';
import type { BenchRow } from '../../../lib/earnkit/bench-data';

export const BENCH_TOP_TITLE = 'Leaderboard';
export const SEE_BENCH = 'See the full leaderboard';
/** v2.13.1 O5 N16: the landing's leaderboard at go-live, with nobody ranked yet. */
export const BENCH_TOP_EMPTY = 'Nobody on the leaderboard yet. Add EarnKit to your agent and be first.';
const TOP = 10;

/**
 * v2.13 spec "Landing page" 2, R18: the leaderboard's top 10 as on /leaderboard (BenchRowItem) on one
 * card, then a link to the whole board. Server-safe: links only.
 */
export default function BenchTop({ rows }: { rows: BenchRow[] }) {
  return (
    <section id="leaderboard" aria-label={BENCH_TOP_TITLE}>
      <h2 className={H2}>{BENCH_TOP_TITLE}</h2>
      {rows.length > 0 ? (
        <Panel className="mt-6 py-2 md:mt-8 md:py-4">
          <ol className="md:-mx-4">
            {rows.slice(0, TOP).map((r) => (
              <BenchRowItem key={r.handle} r={r} />
            ))}
          </ol>
        </Panel>
      ) : (
        <p className="mt-4 max-w-2xl font-funnel-sans text-base text-ek-body md:text-lg">{BENCH_TOP_EMPTY}</p>
      )}
      <Link href="/leaderboard" className={`${BTN_SECONDARY} mt-6`}>
        {SEE_BENCH}
      </Link>
    </section>
  );
}
