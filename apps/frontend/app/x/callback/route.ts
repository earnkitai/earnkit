import { signinPage, xSignInCallback } from '../../../lib/earnkit/x-install';

/** v2.14: the install's (and the fallback link's) X sign-in; anything else is not found. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return (await xSignInCallback(request)) ?? signinPage('This page is not available.', 404);
}
