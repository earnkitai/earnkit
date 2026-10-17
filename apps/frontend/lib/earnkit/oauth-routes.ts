import { json, readParams } from './http';
import { installationExists, saveInstallation } from './installations';
import { OAuthError, authorize, clientLimitKey, exchangeCode, hostedRedirectHost, registerClient } from './oauth';
import { LIMITS, REGISTER_HOST_WARN, RateLimitError, clientIp, enforce } from './rate-limit';

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

const LIMITS_HOST = LIMITS.oauthRegisterHost.limit;

/** Ruling F11: the register ceiling is near (REGISTER_HOST_WARN), logged once a day per agent app. */
export function logNearCeiling(key: string) {
  const host = key.startsWith('host:') ? key.slice(5) : 'per-registration client';
  console.warn(`[oauth] register near the daily ceiling of ${LIMITS_HOST} (${host})`);
}

/**
 * The per-IP abuse floor (`installHour` or `oauthRegister`). Ruling G25 (replacing the v2.9 T12 G0
 * exemption): a client whose redirect host is a known hosted service (`hostedHost`) runs on that
 * service's servers, so many builders share a few IPs: it gets its own, higher floor (500 per IP per
 * hour, `installHourHosted` / `oauthRegisterHosted`), which refuses like any other, so one IP can't
 * drain the host ceiling (oauthRegisterHost). Every other client keeps the 50-an-hour floor.
 */
async function ipFloor(name: 'installHour' | 'oauthRegister', ip: string, what: string, hostedHost: string | null) {
  await enforce(hostedHost ? (name === 'installHour' ? 'installHourHosted' : 'oauthRegisterHosted') : name, ip, what);
}

export async function tokenPost(request: Request) {
  try {
    const { token, clientKey, shared, limitKey, hostedHost, clientName } = exchangeCode(await readParams(request));
    // Only a client's first token counts (v2.2 §5): a replayed code, or re-authorizing a known
    // client (v2.4 §5), is free. v2.8.1 §E17, Ruling F11: 500 a day per registration (client id; a
    // hosted agent's users each register their own), and 50 an hour per IP as the abuse floor
    // (Ruling G25: 500 an hour per IP for a known hosted service's redirect host).
    if (!(await installationExists(token, clientKey))) {
      const ip = clientIp(request.headers);
      try {
        await ipFloor('installHour', ip, TOO_MANY, hostedHost);
      } catch (err) {
        if (err instanceof RateLimitError) logLimited('token', hostedHost ? 'installHourHosted' : 'installHour', limitKey);
        throw err;
      }
      try {
        await enforce('installClient', limitKey, TOO_MANY_CLIENT);
      } catch (err) {
        if (err instanceof RateLimitError) logLimited('token', 'installClient', limitKey);
        throw err;
      }
    }
    await saveInstallation(token, clientKey, shared, clientName);
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
    // v2.8.1 §E17, Ruling F11: 50 an hour per IP (the abuse floor: client ids are free, but each is
    // a signed record), and a 10,000 a day ceiling per agent app (its https redirect host), logged at
    // 8,000 so the owner sees it before it refuses. A desktop agent (loopback redirect) has only the IP floor.
    // Ruling G25: a known hosted service's redirect host has a 500-an-hour IP floor, which refuses.
    const uriList = Array.isArray(uris) ? uris.filter((u): u is string => typeof u === 'string') : [];
    const hostedHost = hostedRedirectHost(uriList);
    if (hostedHost) limit = 'oauthRegisterHosted';
    await ipFloor('oauthRegister', clientIp(request.headers), 'Too many client registrations from this address.', hostedHost);
    if (key) {
      limit = 'oauthRegisterHost';
      const r = await enforce('oauthRegisterHost', key, 'Too many client registrations from this agent today.');
      if (r.remaining === LIMITS_HOST - REGISTER_HOST_WARN) logNearCeiling(key);
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
