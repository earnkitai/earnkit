import Link from 'next/link';
import { H2, LEDE, Panel } from '../common/Panel';
import { BTN_SECONDARY } from '../common/Button';
import BenchRowItem from '../../leaderboard/BenchRowItem';
import type { BenchRow } from '../../../lib/earnkit/bench-data';

export const BENCH_TOP_TITLE = 'Leaderboard';
export const SEE_BENCH = 'See the full leaderboard';
/** v2.13.1 O5 N16: the landing's leaderboard at go-live, with nobody ranked yet. */
export const BENCH_TOP_EMPTY = 'Nobody on the leaderboard yet. Add EarnKit to your agent and be first.';
const TOP = 10;

/**
 * v2.13.2 (3), R18 fix 1: the one header line on /leaderboard and under the landing's title. Nobody
 * ranked reads as the empty leaderboard (BENCH_TOP_EMPTY). Pure.
 */
export const benchLine = (n: number) =>
  n <= 0 ? BENCH_TOP_EMPTY : `${n.toLocaleString('en-US')} ${n === 1 ? 'builder' : 'builders'} this week. Ranked by Shipping points.`;

/**
 * v2.13 spec "Landing page" 2, R18: the title, the count line (benchLine; the empty line when nobody is
 * ranked), the top 10 as on /leaderboard (BenchRowItem) on one card, then a link to the whole board. Server-safe: links only.
 */
export default function BenchTop({ rows, count }: { rows: BenchRow[]; count: number }) {
  return (
    <section id="leaderboard" aria-label={BENCH_TOP_TITLE}>
      <h2 className={H2}>{BENCH_TOP_TITLE}</h2>
      <p className={LEDE}>{benchLine(count)}</p>
      {rows.length > 0 ? (
        <Panel className="mt-6 py-2 md:mt-8 md:py-4">
          <ol className="md:-mx-4">
            {rows.slice(0, TOP).map((r) => (
              <BenchRowItem key={r.handle} r={r} />
            ))}
          </ol>
        </Panel>
      ) : null}
      <Link href="/leaderboard" className={`${BTN_SECONDARY} mt-6`}>
        {SEE_BENCH}
      </Link>
    </section>
  );
}
