import { consentPost } from '../../../lib/v6/me-routes';
import { refuseFor, toMe } from '../../../lib/v5/route-methods';

/** v3.8 E12 (`form`): the onboarding form's save and the withdraw on /me. */
export async function POST(request: Request) {
  return consentPost(request);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/me/consent');
export const GET = toMe;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
