import { json, readParams } from './http';
import { installationExists, saveInstallation } from './installations';
import { OAuthError, authorize, exchangeCode } from './oauth';
import { RateLimitError, clientIp, enforce } from './rate-limit';

// The OAuth token and authorize endpoints; app/oauth/{token,authorize}/route.ts re-export them.
const TOO_MANY = 'Too many new EarnKit connections from this address.';

export async function tokenPost(request: Request) {
  try {
    const token = exchangeCode(await readParams(request));
    // Each new installation counts against its IP (10 an hour, 30 a day; v2.2 §5): installations
    // are the identity every per-installation limit keys on. A replayed code (same token) is free.
    if (!(await installationExists(token))) {
      const ip = clientIp(request.headers);
      await enforce('installHour', ip, TOO_MANY);
      await enforce('installDay', ip, TOO_MANY);
      await saveInstallation(token);
    }
    return json({ access_token: token, token_type: 'Bearer' });
  } catch (err) {
    if (err instanceof RateLimitError)
      return json(
        { error: 'too_many_requests', error_description: err.message },
        429,
        { 'Retry-After': String(err.retryAfter) },
      );
    if (err instanceof OAuthError)
      return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}

/** No accounts: every valid request is approved instantly and sent back with a code. */
export async function authorizeGet(request: Request) {
  try {
    // 60 an hour per IP (v2.2 §5); each approval is a code that can become an installation.
    await enforce(
      'oauthAuthorize',
      clientIp(request.headers),
      'Too many EarnKit sign-ins from this address.',
    );
    return Response.redirect(authorize(new URL(request.url).searchParams), 302);
  } catch (err) {
    if (err instanceof RateLimitError)
      return new Response(`EarnKit sign-in: ${err.message}`, {
        status: 429,
        headers: { 'Retry-After': String(err.retryAfter) },
      });
    // Unknown client or redirect URI: show the error here, never redirect to an unverified URI.
    if (err instanceof OAuthError)
      return new Response(`EarnKit sign-in failed: ${err.message}`, {
        status: 400,
      });
    throw err;
  }
}
