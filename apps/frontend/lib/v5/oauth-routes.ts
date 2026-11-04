/**
 * The OAuth register, authorize and token endpoints (app/oauth/<name>/route.ts re-export them),
 * rate limited per IP and per client. Authorize approves at once and redirects with a code.
 * Refusals are logged by limit and redirect host only, never a client id or token.
 */
import { json, readParams } from './http';
import { installationExists, saveInstallation } from './installations';
import { OAuthError, checkAuthorize, clientLimitKey, exchangeCode, hostedRedirectHost, issueCode, publicOrigin, registerClient } from './oauth';
import { LIMITS, REGISTER_HOST_WARN, RateLimitError, clientIp, enforce } from './rate-limit';

const TOO_MANY = 'Too many new EarnKit connections from this address.';
const TOO_MANY_CLIENT = 'Too many new EarnKit connections from this agent today.';

function logLimited(route: string, limit: string, key: string | null) {
  const host = key?.startsWith('host:') ? key.slice(5) : key ? 'per-registration client' : 'no client';
  console.warn(`[oauth] ${route} refused by ${limit} (${host})`);
}

const tooMany = (err: RateLimitError) =>
  json({ error: 'too_many_requests', error_description: err.message }, 429, { 'Retry-After': String(err.retryAfter) });

/** A plain page for an authorize request that can't be sent back to its client. */
const page = (text: string, status: number, headers: Record<string, string> = {}) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

/**
 * The per-IP floor. A client whose redirect host is a known hosted service runs on that service's
 * servers, so many builders share a few IPs: it gets the higher floor, which still refuses.
 */
async function ipFloor(name: 'installHour' | 'oauthRegister', ip: string, what: string, hostedHost: string | null) {
  const limit = hostedHost ? (name === 'installHour' ? 'installHourHosted' : 'oauthRegisterHosted') : name;
  await enforce(limit, ip, what);
}

export async function tokenPost(request: Request) {
  try {
    const { token, limitKey, hostedHost, clientName } = exchangeCode(await readParams(request));
    // A replayed code is free.
    if (!(await installationExists(token))) {
      let limit = hostedHost ? 'installHourHosted' : 'installHour';
      try {
        await ipFloor('installHour', clientIp(request.headers), TOO_MANY, hostedHost);
        limit = 'installClient';
        await enforce('installClient', limitKey, TOO_MANY_CLIENT);
      } catch (err) {
        if (err instanceof RateLimitError) logLimited('token', limit, limitKey);
        throw err;
      }
    }
    await saveInstallation(token, clientName);
    return json({ access_token: token, token_type: 'Bearer' });
  } catch (err) {
    if (err instanceof RateLimitError) return tooMany(err);
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}

type AuthorizeDeps = { limit?: (request: Request) => Promise<unknown> };
const authorizeLimit = (request: Request) => enforce('oauthAuthorize', clientIp(request.headers), 'Too many EarnKit sign-ins from this address.');

/** Anonymous approval: a valid request is sent straight back to its client with a code. */
export async function authorizeGet(request: Request, deps: AuthorizeDeps = {}) {
  try {
    await (deps.limit ?? authorizeLimit)(request);
    const checked = checkAuthorize(new URL(request.url).searchParams);
    if ('error' in checked) return Response.redirect(checked.error, 302);
    return Response.redirect(issueCode(checked.req, null, publicOrigin(request)), 302);
  } catch (err) {
    if (err instanceof RateLimitError) return page(err.message, 429, { 'Retry-After': String(err.retryAfter) });
    // Unknown client or redirect URI: shown here, never redirected to an unverified URI.
    if (err instanceof OAuthError) return page(`Connecting EarnKit failed. ${err.message}`, 400);
    throw err;
  }
}

/**
 * RFC 7591 dynamic client registration, rate limited per IP; a client whose redirects are all on
 * one hosted service gets that service's higher IP floor and its daily ceiling. Any other client
 * is counted per registration at the token exchange (installClient).
 */
export async function registerPost(request: Request) {
  let key: string | null = null;
  let limit = 'oauthRegister';
  try {
    const metadata = ((await request.json().catch(() => null)) ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
    const uris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
    key = clientLimitKey(uris);
    const hostedHost = hostedRedirectHost(uris);
    if (hostedHost) limit = 'oauthRegisterHosted';
    await ipFloor('oauthRegister', clientIp(request.headers), 'Too many client registrations from this address.', hostedHost);
    if (key) {
      limit = 'oauthRegisterHost';
      const r = await enforce('oauthRegisterHost', key, 'Too many client registrations from this agent today.');
      if (r.remaining === LIMITS.oauthRegisterHost.limit - REGISTER_HOST_WARN)
        console.warn(`[oauth] register near the daily ceiling of ${LIMITS.oauthRegisterHost.limit} (${key.slice(5)})`);
    }
    return json(registerClient(metadata), 201);
  } catch (err) {
    if (err instanceof RateLimitError) {
      logLimited('register', limit, key);
      return tooMany(err);
    }
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}
