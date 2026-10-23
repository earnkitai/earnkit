import { createHash, randomBytes } from 'node:crypto';
import { siteUrl } from './entry-text';
import { plainText } from './untrusted-text';

/**
 * v2.12.1 spec 2: "Claim your page with X" opens Sign in with X (OAuth 2.0 with PKCE, GET
 * /2/users/me). Confidential client: the token call sends client id and secret as Basic auth.
 * The user token is used for one read and never stored or logged. Links come from siteUrl(),
 * never the request Host, so the redirect URI is always exactly `${siteUrl()}/x/callback`.
 */
export const X_SCOPES = 'users.read tweet.read';
export const xCallbackUrl = () => `${siteUrl()}/x/callback`;
const TIMEOUT_MS = 10_000;

/** A fresh PKCE verifier (64 base64url characters) and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function xAuthorizeUrl(a: { state: string; challenge: string }): string {
  const u = new URL('https://x.com/i/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', process.env.X_CLIENT_ID!.trim());
  u.searchParams.set('redirect_uri', xCallbackUrl());
  u.searchParams.set('scope', X_SCOPES);
  u.searchParams.set('state', a.state);
  u.searchParams.set('code_challenge', a.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

/**
 * v3.1 owner people view: `createdAt` (the X account's creation, ISO) and `followers` ride along for the owner's
 * private view only (builder_profiles.x_created_at, x_followers); never shown, scored or ranked. Optional: the test
 * fixtures and older rows build an XUser without them.
 */
export type XUser = { id: string; username: string; name: string; avatar: string | null; createdAt?: string | null; followers?: number | null };
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** /2/users/me's answer, strictly; the avatar only from pbs.twimg.com, at its 400x400 size; a bad date or count is null. Pure. */
export function xUserFrom(json: unknown): XUser | null {
  const d = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!d || typeof d.id !== 'string' || !/^\d{1,20}$/.test(d.id) || typeof d.username !== 'string' || !HANDLE.test(d.username)) return null;
  const name = typeof d.name === 'string' ? plainText(d.name, true).replace(/[<>]/g, '').trim().slice(0, 50) : '';
  const img = typeof d.profile_image_url === 'string' && URL.canParse(d.profile_image_url) ? new URL(d.profile_image_url) : null;
  const avatar = img && img.protocol === 'https:' && img.hostname === 'pbs.twimg.com' ? img.toString().replace(/_normal(\.\w+)$/, '_400x400$1') : null;
  const created = typeof d.created_at === 'string' && Number.isFinite(Date.parse(d.created_at)) ? new Date(d.created_at).toISOString() : null;
  const n = (d.public_metrics as { followers_count?: unknown } | null | undefined)?.followers_count;
  const followers = typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 2_147_483_647 ? n : null;
  return { id: d.id, username: d.username, name: name || d.username, avatar, createdAt: created, followers };
}

export type XOAuthDeps = { exchange: (code: string, verifier: string) => Promise<string>; me: (token: string) => Promise<XUser> };

/** X's two calls. Errors carry no code, token or secret. */
export const xOAuth: XOAuthDeps = {
  exchange: async (code, verifier) => {
    const basic = Buffer.from(`${process.env.X_CLIENT_ID!.trim()}:${process.env.X_CLIENT_SECRET!.trim()}`).toString('base64');
    const res = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'EarnKit' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: xCallbackUrl(), code_verifier: verifier }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!res.ok || typeof body?.access_token !== 'string') throw new Error(`X token exchange failed (${res.status})`);
    return body.access_token;
  },
  me: async (token) => {
    const res = await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url,created_at,public_metrics', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'EarnKit' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const user = xUserFrom(await res.json().catch(() => null));
    if (!res.ok || !user) throw new Error(`X user read failed (${res.status})`);
    return user;
  },
};
