/**
 * The OAuth register, authorize and token endpoints (app/oauth/<name>/route.ts re-export them),
 * rate limited per IP and per client. Authorize approves at once and redirects with a code.
 * Refusals are logged by limit and redirect host only, never a client id or token.
 */
import { json, readCapped, readParams } from './http';
import { installationExists, saveInstallation } from './installations';
import { OAuthError, checkAuthorize, clientLimitKey, exchangeCode, issueCode, publicOrigin, registerClient } from './oauth';
import { BLOCK_LIMITED, RateLimitError, blockOf, clientIp, enforce } from './rate-limit';

const TOO_MANY = 'Too many new EarnKit connections from this address.';
const TOO_MANY_CLIENT = 'Too many new EarnKit connections from this agent today.';

function logLimited(route: string, limit: string, key: string | null) {
  const host = key?.startsWith('host:') ? key.slice(5) : key ? 'per-registration client' : 'no client';
  console.warn(`[oauth] ${route} refused by ${limit} (${host})`);
}

/** The most an OAuth body may be (security M5). */
export const MAX_OAUTH_BODY = 16_384;
const tooLarge = () => json({ error: 'invalid_request', error_description: `Request too large: EarnKit reads at most ${MAX_OAUTH_BODY / 1024} KB here.` }, 413);

const tooMany = (err: RateLimitError) =>
  json({ error: 'too_many_requests', error_description: err.message }, 429, { 'Retry-After': String(err.retryAfter) });

/** A plain page for an authorize request that can't be sent back to its client. */
const page = (text: string, status: number, headers: Record<string, string> = {}) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

export async function tokenPost(request: Request) {
  try {
    const params = await readParams(request, MAX_OAUTH_BODY);
    if (params === null) return tooLarge();
    const { token, limitKey, hostedHost, clientName } = exchangeCode(params);
    // A replayed code is free.
    if (!(await installationExists(token))) {
      // Every address counts on the one floor first; a hosted client only gets a higher per-client ceiling (v6.1.7, B5).
      let limit = 'installHour';
      try {
        const ip = clientIp(request.headers);
        await enforce('installHour', ip, TOO_MANY);
        // B1 (v6.1.13): each address block a day, so one network never spends another's installs.
        limit = 'installBlock';
        await enforce('installBlock', blockOf(ip), BLOCK_LIMITED, true);
        limit = hostedHost ? 'installClientHosted' : 'installClient';
        await enforce(limit as 'installClient' | 'installClientHosted', limitKey, TOO_MANY_CLIENT);
      } catch (err) {
        if (err instanceof RateLimitError) logLimited('token', limit, hostedHost ? `host:${hostedHost}` : limitKey);
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
 * RFC 7591 dynamic client registration, rate limited per address an hour and per address block a day for every
 * client (v6.1.13, B1: no ceiling shared by every user of one hosted service, which one network could fill for all).
 * Installations are counted per registration at the token exchange (installClient, installClientHosted).
 */
export async function registerPost(request: Request) {
  let key: string | null = null;
  let limit = 'oauthRegister';
  try {
    const body = await readCapped(request, MAX_OAUTH_BODY);
    if (body === null) return tooLarge();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
    const metadata = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as { redirect_uris?: unknown; client_name?: unknown };
    const uris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
    key = clientLimitKey(uris);
    const ip = clientIp(request.headers);
    await enforce('oauthRegister', ip, 'Too many client registrations from this address.');
    limit = 'oauthRegisterBlock';
    await enforce('oauthRegisterBlock', blockOf(ip), BLOCK_LIMITED, true);
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
