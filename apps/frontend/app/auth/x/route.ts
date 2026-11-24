import { xStartGet } from '../../../lib/v6/x-routes';
import { refuseFor } from '../../../lib/v5/route-methods';
import { withSessionFlags } from '../../../lib/v6/flag-preview';

/** GET /auth/x (v3.8 E5): the install chooser's X link. Next's second argument is unused. */
export async function GET(request: Request) {
  return withSessionFlags(request, async () => xStartGet(request));
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/auth/x');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
