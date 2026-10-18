import { xCallback } from '../../../lib/earnkit/claim';
import { xSignInCallback } from '../../../lib/earnkit/x-install';

/** v2.14: the install's (and the fallback link's) X sign-in first; the claim flow until T7 removes it. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return (await xSignInCallback(request)) ?? xCallback(request);
}
