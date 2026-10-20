import Link from 'next/link';
import { H2, ROWS, SUB } from '../common/Panel';
import { TEXT_LINK } from '../common/Button';
import BenchRowItem from '../../leaderboard/BenchRowItem';
import type { BenchRow } from '../../../lib/earnkit/bench-data';

export const BENCH_TOP_TITLE = 'Leaderboard';
export const SEE_BENCH = 'See the full leaderboard';
/** v2.13.1 O5 N16: the landing's leaderboard at go-live, with nobody ranked yet. An invitation, not a mood. */
export const BENCH_TOP_EMPTY = 'Nobody on the leaderboard yet. Add EarnKit to your agent and be first.';
const TOP = 10;

/** v3 Stage 3 (spec 5.8 wording): the one line under the Leaderboard title, here and on /leaderboard ("1,200 builders"). Pure. */
export const benchLine = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'builder' : 'builders'}. Ranked by Shipping.`;

/**
 * v2.13 spec "Landing page" 2, R18, v3 Stage 3: the title with the link to the whole board beside it, the count
 * line (BENCH_TOP_EMPTY when nobody is ranked: then no rows and no link), the top 10 as hairline rows
 * (BenchRowItem, as on /leaderboard). Server-safe: links only.
 */
export default function BenchTop({ rows, count }: { rows: BenchRow[]; count: number }) {
  const top = rows.slice(0, TOP);
  return (
    <section id="leaderboard" aria-label={BENCH_TOP_TITLE}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className={H2}>{BENCH_TOP_TITLE}</h2>
        {top.length > 0 ? (
          <Link href="/leaderboard" className={TEXT_LINK}>
            {SEE_BENCH}
          </Link>
        ) : null}
      </div>
      <p className={SUB}>{top.length > 0 ? benchLine(count) : BENCH_TOP_EMPTY}</p>
      {top.length > 0 ? (
        <ol className={`${ROWS} mt-6 md:mt-8`}>
          {top.map((r) => (
            <BenchRowItem key={r.handle} r={r} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}
