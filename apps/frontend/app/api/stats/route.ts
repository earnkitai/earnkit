import { readStats, statsGet } from '../../../lib/v5/stats';
import { cachedRead } from '../../lib/cached';
import { refuseFor } from '../../../lib/v5/route-methods';

/**
 * Public stats: the counts, read from the database at most once every 10 minutes; an API write expires them
 * at once. A failed read answers 503 and is never cached.
 */
export const revalidate = 600;

const stats = cachedRead(() => readStats(), ['public-stats-v6.1.16']);

export async function GET() {
  return statsGet(stats);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/api/stats');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
