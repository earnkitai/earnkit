import { linkPost } from '../../../../lib/v6/link-routes';
import { refuseFor } from '../../../../lib/v5/route-methods';

/** Next passes the route params as the second argument; the handler's third is its test deps. */
type Ctx = { params: Promise<{ code: string }> };

/** POST /link/<code>/confirm (L27-4, v6.1.16): the confirm page's button. GET /link/<code> is the page itself. */
export async function POST(request: Request, { params }: Ctx) {
  return linkPost(request, (await params).code);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/link/code/confirm');
export const GET = refuse;
export const HEAD = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
