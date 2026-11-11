import { writePost } from '../../../../lib/v5/programs-api';
import { refuseFor } from '../../../../lib/v5/route-methods';

/** The owner's Grok Bot adds, updates and closes API programs (Bearer EARNKIT_PROGRAMS_TOKEN). 404 while the API is off. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return writePost(request);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/api/programs/write');
export const GET = refuse;
export const HEAD = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
