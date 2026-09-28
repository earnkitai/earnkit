import { OAuthError, authorize } from '@/lib/earnkit/oauth';

/** No accounts: every valid request is approved instantly and sent back with a code. */
export function GET(request: Request) {
  try {
    return Response.redirect(authorize(new URL(request.url).searchParams), 302);
  } catch (err) {
    // Unknown client or redirect URI: show the error here, never redirect to an unverified URI.
    if (err instanceof OAuthError) return new Response(`EarnKit sign-in failed: ${err.message}`, { status: 400 });
    throw err;
  }
}
