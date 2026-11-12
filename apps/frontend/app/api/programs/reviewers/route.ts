import { preflight } from '../../../../lib/v5/http';
import { reviewersPost } from '../../../../lib/v6/reviewers';
import { refuseFor } from '../../../../lib/v5/route-methods';

/** The owner marks a signed-in builder as a program's reviewer (Bearer EARNKIT_PROGRAMS_TOKEN). 404 while the API is off. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = reviewersPost;
export const OPTIONS = preflight;

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/api/programs/reviewers');
export const GET = refuse;
export const HEAD = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
