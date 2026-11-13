import { notAllowed } from '../../../lib/v5/http';
import { authorizeGet } from '../../../lib/v5/oauth-routes';

/** What authorize serves: GET (HEAD is answered from it) and OPTIONS (L19-1; fix round 1, N1). */
const ALLOW = 'GET, HEAD, OPTIONS';

/** Next passes a context as the second argument; authorizeGet's second is its test deps. */
export async function GET(request: Request) {
  return authorizeGet(request);
}
/** An explicit OPTIONS, so Next's automatic one never lists the 405 methods. */
export const OPTIONS = () => new Response(null, { status: 204, headers: { Allow: ALLOW, 'Cache-Control': 'no-store' } });
/** L19-1: every other method is 405 with Allow. */
const refuse = () => notAllowed(ALLOW, true);
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
