/**
 * X sign-in (v3.8 E5, flag `x_signin`): OAuth 2.0 with PKCE, scopes `users.read tweet.read` (the least X allows for
 * reading the signed-in account; no write scope, no offline.access, so no refresh token). The code verifier is an HMAC of
 * the browser's install nonce, so nothing is stored between the redirect and the callback. The access token is used for
 * one `GET /2/users/me` and dropped. Errors are one line and never carry a token, a code or a secret.
 */
import { createHash, createHmac } from 'node:crypto';
import { flagOn } from '../v5/flags';

type Env = Record<string, string | undefined>;
/** The X account: its stable id, its handle (can change), and the profile fields the person row keeps. */
export type XUser = { x_user_id: string; handle: string; name: string | null; avatar_url: string | null; created_at: Date | null };

export class XAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XAuthError';
  }
}

export const X_SCOPES = 'users.read tweet.read';
const AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const TOKEN = 'https://api.x.com/2/oauth2/token';
const ME = 'https://api.x.com/2/users/me?user.fields=created_at,profile_image_url';

const clientId = (env: Env) => env.X_CLIENT_ID?.trim() ?? '';
const clientSecret = (env: Env) => env.X_CLIENT_SECRET?.trim() ?? '';
/** Both X app values are set: X_CLIENT_ID and X_CLIENT_SECRET, the same app the pre-v5 X sign-in used. Pure. */
export const xConfigured = (env: Env = process.env): boolean => Boolean(clientId(env) && clientSecret(env));
/** X sign-in is offered: the `x_signin` flag and the X app. Pure given `env`. */
export const xSignInOn = (env: Env = process.env): boolean => flagOn('x_signin', env) && xConfigured(env);

/**
 * The redirect URI: exactly `<origin>/x/callback`, the URI the X app has registered since the pre-v5 X sign-in
 * (`${siteUrl()}/x/callback`). X matches it character for character, so it must not move. Pure.
 */
export const xCallbackUrl = (origin: string) => `${origin}/x/callback`;

/** The PKCE verifier for a nonce: 43 base64url characters of an HMAC, so only this server with this nonce has it. Pure. */
export const xVerifier = (nonce: string, secret: string): string => createHmac('sha256', secret).update(`x-pkce:${nonce}`).digest('base64url');
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** Pure. */
export function xAuthorizeUrl(state: string, nonce: string, secret: string, origin: string, env: Env = process.env): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(env),
    redirect_uri: xCallbackUrl(origin),
    scope: X_SCOPES,
    state,
    code_challenge: challengeOf(xVerifier(nonce, secret)),
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE}?${q.toString().replace(/\+/g, '%20')}`;
}

/** One X call with a 10-second timeout; no answer is an XAuthError. */
async function call(f: typeof fetch, url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new XAuthError(`X ${what} did not answer.`);
  }
}

const dateOf = (v: unknown): Date | null => {
  const d = typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** Trades X's code (with the nonce's verifier) for a token, then reads the account with it. The token is not kept. */
export async function exchangeXCode(code: string, nonce: string, secret: string, origin: string, env: Env, f: typeof fetch): Promise<XUser> {
  const basic = Buffer.from(`${clientId(env)}:${clientSecret(env)}`).toString('base64');
  const t = await call(f, TOKEN, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: xCallbackUrl(origin), code_verifier: xVerifier(nonce, secret), client_id: clientId(env) }).toString(),
  }, 'token exchange');
  const token = t.ok ? ((await t.json().catch(() => null)) as { access_token?: unknown } | null)?.access_token : undefined;
  if (typeof token !== 'string' || !token) throw new XAuthError(`X token exchange failed (${t.status}).`);
  const u = await call(f, ME, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, 'user read');
  if (!u.ok) throw new XAuthError(`X user read failed (${u.status}).`);
  const d = ((await u.json().catch(() => null)) as { data?: Record<string, unknown> } | null)?.data;
  if (typeof d?.id !== 'string' || !/^\d{1,20}$/.test(d.id) || typeof d.username !== 'string' || !d.username) throw new XAuthError('X user read had no id.');
  return {
    x_user_id: d.id,
    handle: d.username,
    name: typeof d.name === 'string' ? d.name : null,
    avatar_url: typeof d.profile_image_url === 'string' ? d.profile_image_url : null,
    created_at: dateOf(d.created_at),
  };
}
