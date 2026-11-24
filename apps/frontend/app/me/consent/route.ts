import { consentPost } from '../../../lib/v6/me-routes';
import { flagOn } from '../../../lib/v5/flags';
import { refuseFor, toMe } from '../../../lib/v5/route-methods';
import { withSessionFlags } from '../../../lib/v6/flag-preview';

/** v3.8 E12 (`form`): the onboarding form's save and the withdraw on /me. */
export async function POST(request: Request) {
  return withSessionFlags(request, () => consentPost(request));
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/me/consent');
/** Off: 404, as on main (the POST is 404 too). */
export const GET = (request: Request) =>
  withSessionFlags(request, async () => (flagOn('form') ? toMe() : new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } })));
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
