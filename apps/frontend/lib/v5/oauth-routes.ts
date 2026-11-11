/**
 * The OAuth register, authorize and token endpoints (app/oauth/<name>/route.ts re-export them),
 * rate limited per IP and per client. Authorize approves at once and redirects with a code.
 * Refusals are logged by limit and redirect host only, never a client id or token.
 */
import { BodyTimeoutError, bodyTimedOut, json, readCapped, readParams } from './http';
import { codeSpent, installOnce, revokeInstallation } from './installations';
import { CIMD_FAILED, type ClientDeps, INVALID_CLIENT_NAME, OAuthError, checkAuthorize, clientLimitKey, exchangeCode, issueCode, publicOrigin, registerClient, reservedClientName } from './oauth';

export { INVALID_CLIENT_NAME, reservedClientName };
import { BLOCK_LIMITED, BLOCK_WARN_SHARE, LIMITS, RateLimitError, blockOf, clientIp, enforce } from './rate-limit';

const TOO_MANY = 'Too many new EarnKit connections from this address.';
const TOO_MANY_CLIENT = 'Too many new EarnKit connections from this agent today.';

/**
 * Counts one hit on a block's daily cap; logs once, as the count reaches BLOCK_WARN_SHARE of it, so refusals never
 * start unannounced (I3). Ops text only, never in a reply.
 */
async function enforceBlock(name: 'oauthRegisterBlock' | 'installBlock', ip: string) {
  const block = blockOf(ip);
  const { limit } = LIMITS[name];
  const r = await enforce(name, block, BLOCK_LIMITED, true);
  const count = limit - r.remaining;
  if (count === Math.ceil(limit * BLOCK_WARN_SHARE)) console.warn(`[oauth] block near cap: ${name} ${block} at ${count} of ${limit} today`);
  return r;
}

function logLimited(route: string, limit: string, key: string | null) {
  // A client document's host is public (its URL is the client_id); a registered id is never logged.
  const host = key?.startsWith('host:') ? key.slice(5) : key?.startsWith('client:host:') ? `document on ${key.slice(12)}` : key ? 'per-registration client' : 'no client';
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

/** L19-4 (OAuth 2.1 4.1.3): a code exchanged twice revokes the token its first exchange gave. */
async function codeReused(token: string) {
  await revokeInstallation(token);
  return json({ error: 'invalid_grant', error_description: 'Code already used; the token it gave is revoked.' }, 400);
}

/** `client`: the client document fetch (tests inject a fixture; no test touches the network). */
type TokenDeps = { client?: ClientDeps };

export async function tokenPost(request: Request, deps: TokenDeps = {}) {
  try {
    const params = await readParams(request, MAX_OAUTH_BODY);
    if (params === null) return tooLarge();
    const { token, limitKey, hostedHost, clientName, nonce, audience } = await exchangeCode(params, deps.client, publicOrigin(request));
    // T6-F2 (v6.1.14): a client id signed before the check may carry a reserved name; it never installs (saveInstallation
    // refuses too). Checked before the limits, so a refusal spends none.
    if (reservedClientName(clientName)) throw new OAuthError('invalid_client_metadata', INVALID_CLIENT_NAME);
    // L19-4: a code is spent once. A reuse is refused before the limits (it spends none) and revokes the first token.
    if (await codeSpent(nonce)) return await codeReused(token);
    // Every address counts on the one floor first; a hosted client only gets a higher per-client ceiling (v6.1.7, B5).
    let limit = 'installHour';
    try {
      const ip = clientIp(request.headers);
      await enforce('installHour', ip, TOO_MANY);
      // B1 (v6.1.13): each address block a day, so one network never spends another's installs.
      limit = 'installBlock';
      await enforceBlock('installBlock', ip);
      limit = hostedHost ? 'installClientHosted' : 'installClient';
      // A client document is one client for all its users (claude.ai's is everyone's), so its ceiling is per
      // document host and address block: one network never spends another's installs (v6.1.13 B1, v6.1.15 Task 14).
      const key = limitKey.startsWith('client:host:') ? `${limitKey}:${blockOf(ip)}` : limitKey;
      await enforce(limit as 'installClient' | 'installClientHosted', key, TOO_MANY_CLIENT);
    } catch (err) {
      if (err instanceof RateLimitError) logLimited('token', limit, hostedHost ? `host:${hostedHost}` : limitKey);
      throw err;
    }
    // The nonce is spent and the installation saved in one transaction; a parallel exchange that spent it first wins.
    if ((await installOnce(token, nonce, clientName, audience)) === null) return await codeReused(token);
    return json({ access_token: token, token_type: 'Bearer' });
  } catch (err) {
    if (err instanceof BodyTimeoutError) return bodyTimedOut();
    if (err instanceof RateLimitError) return tooMany(err);
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}

type AuthorizeDeps = { limit?: (request: Request) => Promise<unknown>; client?: ClientDeps };
const authorizeLimit = (request: Request) => enforce('oauthAuthorize', clientIp(request.headers), 'Too many EarnKit sign-ins from this address.');

/** Anonymous approval: a valid request is sent straight back to its client with a code. */
export async function authorizeGet(request: Request, deps: AuthorizeDeps = {}) {
  try {
    await (deps.limit ?? authorizeLimit)(request);
    const checked = await checkAuthorize(new URL(request.url).searchParams, deps.client, publicOrigin(request));
    if ('error' in checked) return Response.redirect(checked.error, 302);
    return Response.redirect(await issueCode(checked.req, null, publicOrigin(request), deps.client), 302);
  } catch (err) {
    if (err instanceof RateLimitError) return page(err.message, 429, { 'Retry-After': String(err.retryAfter) });
    // Unknown client or redirect URI: shown here, never redirected to an unverified URI.
    // A client document that fails any check: its own line, already a whole sentence (v6.1.15 Task 14).
    if (err instanceof OAuthError && err.message === CIMD_FAILED) return page(CIMD_FAILED, 400);
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
    await enforceBlock('oauthRegisterBlock', ip);
    if (reservedClientName(metadata.client_name)) throw new OAuthError('invalid_client_metadata', INVALID_CLIENT_NAME);
    return json(await registerClient(metadata), 201);
  } catch (err) {
    if (err instanceof BodyTimeoutError) return bodyTimedOut();
    if (err instanceof RateLimitError) {
      logLimited('register', limit, key);
      return tooMany(err);
    }
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}
