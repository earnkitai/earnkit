import { consentGet, consentPost } from '../../../lib/v6/install-consent';
import { refuseFor } from '../../../lib/v5/route-methods';

/** GET /install/consent (v3.8 E4): the consent page after the install's GitHub sign-in. Next's second argument is unused. */
export async function GET(request: Request) {
  return consentGet(request);
}

/** POST /install/consent: the page's Connect or Not now. */
export async function POST(request: Request) {
  return consentPost(request);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/install/consent');
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
