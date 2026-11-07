/**
 * GitHub sign-in (OAuth web flow, scope read:user): the authorize URL, the signed state that
 * carries the link code and the browser's nonce through GitHub (HMAC-SHA256, 15 minutes), and the
 * code exchange for the user. Errors are one line and never carry a token, a code or a secret.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;
export type GitHubUser = { github_id: number; login: string; name: string | null; avatar_url: string | null };

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

/** Both OAuth app values are set. Pure. */
export const oauthConfigured = (env: Env = process.env): boolean => Boolean(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET);

const callbackUrl = (origin: string) => `${origin}/auth/github/callback`;

/** Pure. */
export function authorizeUrl(state: string, origin: string, env: Env = process.env): string {
  const q = (v: string) => encodeURIComponent(v);
  return `https://github.com/login/oauth/authorize?client_id=${q(env.GITHUB_OAUTH_CLIENT_ID ?? '')}&redirect_uri=${q(callbackUrl(origin))}&scope=read:user&state=${q(state)}`;
}

const mac = (body: string, secret: string) => createHmac('sha256', secret).update(`github-state:${body}`).digest('base64url');

/** body.sig: the payload as base64url JSON and its HMAC. `exp` is epoch milliseconds. Pure. */
export function signState(payload: { code: string; nonce: string; exp: number }, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(body, secret)}`;
}

/** The link code and nonce a state carries, or null when it is forged, malformed or expired. Pure. */
export function verifyState(state: string, secret: string, now: Date): { code: string; nonce: string } | null {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(mac(parts[0], secret));
  const given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { code?: unknown; nonce?: unknown; exp?: unknown };
    if (typeof p.code !== 'string' || typeof p.nonce !== 'string' || typeof p.exp !== 'number' || p.exp <= now.getTime()) return null;
    return { code: p.code, nonce: p.nonce };
  } catch {
    return null;
  }
}

/** One GitHub call with a 10-second timeout; no answer is a GitHubAuthError. */
async function call(f: typeof fetch, url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new GitHubAuthError(`GitHub ${what} did not answer.`);
  }
}

/** Trades GitHub's code for a token, then reads the user with it. */
export async function exchangeCode(code: string, origin: string, env: Env, f: typeof fetch): Promise<GitHubUser> {
  const t = await call(f, 'https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code, redirect_uri: callbackUrl(origin) }),
  }, 'token exchange');
  // GitHub answers a bad code with 200 and an error field: no access_token either way.
  const token = t.ok ? ((await t.json().catch(() => null)) as { access_token?: unknown } | null)?.access_token : undefined;
  if (typeof token !== 'string' || !token) throw new GitHubAuthError(`GitHub token exchange failed (${t.status}).`);
  const u = await call(f, 'https://api.github.com/user', {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'EarnKit' },
  }, 'user read');
  if (!u.ok) throw new GitHubAuthError(`GitHub user read failed (${u.status}).`);
  const user = (await u.json().catch(() => null)) as { id?: unknown; login?: unknown; name?: unknown; avatar_url?: unknown } | null;
  if (typeof user?.id !== 'number' || typeof user.login !== 'string') throw new GitHubAuthError('GitHub user read had no id.');
  return {
    github_id: user.id,
    login: user.login,
    name: typeof user.name === 'string' ? user.name : null,
    avatar_url: typeof user.avatar_url === 'string' ? user.avatar_url : null,
  };
}
