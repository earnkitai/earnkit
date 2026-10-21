import { parseBenchFilter } from '@/lib/earnkit/bench-data';
import BenchView, { BENCH_TITLE } from './BenchView';
import { cachedBench } from './bench-load';

/** Rendered per request (EARNKIT_RAISING is read at run time); each filter variant is one cached read per minute (bench-load.ts). */
export const dynamic = 'force-dynamic';
export const metadata = { title: `${BENCH_TITLE} · EarnKit`, description: 'Builders who ship every week. Ranked by Shipping.' };
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** v2.13 spec "The Bench": filters are links (R9). v3.1 site Task 8: `?page=N` pages the one cached read (BenchView clamps it). */
export default async function BenchPage({ searchParams }: Props) {
  const q = await searchParams;
  const filter = parseBenchFilter(q);
  const { rows, count, chips } = await cachedBench(filter);
  const page = typeof q.page === 'string' ? Number.parseInt(q.page, 10) || 1 : 1;
  return <BenchView rows={rows} count={count} chips={chips} filter={filter} page={page} />;
}
