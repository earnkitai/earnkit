import { revertGet, revertPost } from '../../../../lib/v5/programs-api';
import { refuseFor } from '../../../../lib/v5/route-methods';

/**
 * The owner's revert link for an applied program write. GET shows a confirm page and changes
 * nothing (mail scanners open links); the button's POST reverts, once. The signed token decides.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: Request) => revertGet(request);
export const POST = (request: Request) => revertPost(request);

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/api/programs/revert');
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
