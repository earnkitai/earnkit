import { raisingEnabled } from '@/lib/earnkit/builder-score-flag';
import { parseBenchFilter } from '@/lib/earnkit/bench-data';
import BenchView, { BENCH_TITLE } from './BenchView';
import { cachedBench } from './bench-load';

/** Rendered per request (EARNKIT_RAISING is read at run time); each filter variant is one cached read per minute (bench-load.ts). */
export const dynamic = 'force-dynamic';
export const metadata = { title: `${BENCH_TITLE} · EarnKit`, description: 'Builders who ship every week, ranked by what they shipped and who uses it.' };
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** v2.13 spec "The Bench": filters are links (R9). */
export default async function BenchPage({ searchParams }: Props) {
  const filter = parseBenchFilter(await searchParams);
  const { rows, count, chips } = await cachedBench(filter);
  return <BenchView rows={rows} count={count} chips={chips} filter={filter} raising={raisingEnabled()} />;
}
