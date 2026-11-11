import { callbackGet } from '../../../../lib/v6/link-routes';
import { refuseFor } from '../../../../lib/v5/route-methods';

/** Next passes a context as the second argument; callbackGet's second is its test deps. */
export async function GET(request: Request) {
  return callbackGet(request);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/auth/github/callback');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
