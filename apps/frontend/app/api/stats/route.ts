import { readStats, statsGet } from '../../../lib/v5/stats';
import { cachedRead } from '../../lib/cached';

/**
 * Public stats: nine counts, read from the database at most once every 10 minutes; an API write expires them
 * at once. A failed read answers 503 and is never cached.
 */
export const revalidate = 600;

const stats = cachedRead(() => readStats(), ['public-stats-v5']);

export async function GET() {
  return statsGet(stats);
}
