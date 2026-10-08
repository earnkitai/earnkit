import { json, readParams } from './http';
import { installationExists, saveInstallation } from './installations';
import { OAuthError, authorize, clientLimitKey, exchangeCode, registerClient } from './oauth';
import { RateLimitError, clientIp, enforce } from './rate-limit';

// The OAuth register, token and authorize endpoints; app/oauth/{register,token,authorize}/route.ts re-export them.
const TOO_MANY = 'Too many new EarnKit connections from this address.';
const TOO_MANY_CLIENT = 'Too many new EarnKit connections from this agent today.';

/**
 * v2.8.1 §E17: a refused OAuth call, logged with the limit and the client's redirect host (never a
 * client id or token), so the owner sees when a hosted agent hits a limit.
 */
export function logLimited(route: string, limit: string, key: string | null) {
  const host = key?.startsWith('host:') ? key.slice(5) : key ? 'per-registration client' : 'no client';
  console.warn(`[oauth] ${route} refused by ${limit} (${host})`);
}

export async function tokenPost(request: Request) {
  try {
    const { token, clientKey, shared, limitKey } = exchangeCode(await readParams(request));
    // Only a client's first token counts (v2.2 §5): a replayed code, or re-authorizing a known
    // client (v2.4 §5), is free. v2.8.1 §E17: 500 a day per agent client (a hosted agent's users all
    // come from its servers), and 50 an hour per IP as the abuse floor.
    if (!(await installationExists(token, clientKey))) {
      const ip = clientIp(request.headers);
      try {
        await enforce('installHour', ip, TOO_MANY);
      } catch (err) {
        if (err instanceof RateLimitError) logLimited('token', 'installHour', limitKey);
        throw err;
      }
      try {
        await enforce('installClient', limitKey, TOO_MANY_CLIENT);
      } catch (err) {
        if (err instanceof RateLimitError) logLimited('token', 'installClient', limitKey);
        throw err;
      }
    }
    await saveInstallation(token, clientKey, shared);
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

/** RFC 7591 dynamic client registration (oauth.ts registerClient), rate limited. */
export async function registerPost(request: Request) {
  let key: string | null = null;
  let limit = 'oauthRegister';
  try {
    const metadata = (await request.json().catch(() => null)) ?? {};
    const uris: unknown = metadata?.redirect_uris;
    key = clientLimitKey(Array.isArray(uris) ? uris.filter((u): u is string => typeof u === 'string') : []);
    // v2.8.1 §E17: keyed like new installations. 50 an hour per IP (the abuse floor: client ids are
    // free, but each is a signed record), and 500 a day per agent client (its https redirect host;
    // a desktop agent with a loopback redirect has only the IP floor).
    await enforce('oauthRegister', clientIp(request.headers), 'Too many client registrations from this address.');
    if (key) {
      limit = 'oauthRegisterClient';
      await enforce('oauthRegisterClient', key, 'Too many client registrations from this agent today.');
    }
    return json(registerClient(metadata), 201);
  } catch (err) {
    if (err instanceof RateLimitError) {
      logLimited('register', limit, key);
      return json(
        { error: 'too_many_requests', error_description: err.message },
        429,
        { 'Retry-After': String(err.retryAfter) },
      );
    }
    if (err instanceof OAuthError)
      return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}
