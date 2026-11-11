import { programsListGet, readListedPrograms } from '../../../lib/v5/programs-read';
import { cachedRead } from '../../lib/cached';
import { refuseFor } from '../../../lib/v5/route-methods';

/**
 * The public program list (?category=, ?status=). One read per minute at most; an API write expires
 * it at once (PROGRAMS_TAG). Filters, order and closes_in run per request.
 */
export const dynamic = 'force-dynamic';

const cached = cachedRead(() => readListedPrograms(), ['programs-list-v6.1.15'], 60);

export async function GET(request: Request) {
  return programsListGet(request, cached);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/api/programs');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
