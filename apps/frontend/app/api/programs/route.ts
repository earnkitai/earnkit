import { unstable_cache } from 'next/cache';
import { PROGRAMS_TAG, programsListGet, readListedPrograms } from '@/lib/v5/programs-read';

/**
 * The public program list (?category=, ?status=). One read per minute at most; an API write expires
 * it at once (PROGRAMS_TAG). Filters, order and closes_in run per request.
 */
export const dynamic = 'force-dynamic';

const cached = unstable_cache(() => readListedPrograms(), ['programs-list-v5'], { revalidate: 60, tags: [PROGRAMS_TAG] });

export async function GET(request: Request) {
  return programsListGet(request, cached);
}
