import { programsListGet, readListedPrograms } from '../../../lib/v5/programs-read';
import { cachedRead } from '../../lib/cached';

/**
 * The public program list (?category=, ?status=). One read per minute at most; an API write expires
 * it at once (PROGRAMS_TAG). Filters, order and closes_in run per request.
 */
export const dynamic = 'force-dynamic';

const cached = cachedRead(() => readListedPrograms(), ['programs-list-v6.1.15'], 60);

export async function GET(request: Request) {
  return programsListGet(request, cached);
}
