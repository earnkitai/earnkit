import { editPost } from '../../../lib/v6/me-routes';
import { refuseFor, toMe } from '../../../lib/v5/route-methods';

/** Next passes a context as the second argument; the handler's second is its test deps. */
export async function POST(request: Request) {
  return editPost(request);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/me/edit');
export const GET = toMe;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
