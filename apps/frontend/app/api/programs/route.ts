import { unstable_cache } from 'next/cache';
import { programsListGet, readListedPrograms } from '@/lib/earnkit/programs-read';
import { PROGRAMS_TAG } from '@/lib/earnkit/programs-cache';

/**
 * v4.9 Task 3: the public program list (?category=grant|hackathon|investment|bounty, ?status=active|upcoming), only
 * what the landing and guide pages show. One read per minute at most (unstable_cache; an API write expires it at once, PROGRAMS_TAG); filters, order and closes_in
 * run per request. The logic is in lib/earnkit/programs-read.ts.
 */
export const dynamic = 'force-dynamic';

const cached = unstable_cache(() => readListedPrograms(), ['programs-list-v49'], { revalidate: 60, tags: [PROGRAMS_TAG] });

export async function GET(request: Request) {
  return programsListGet(request, cached);
}
