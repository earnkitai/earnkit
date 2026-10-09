import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Anonymous OAuth for the hosted MCP endpoint.
 *
 * MCP clients (Grok, Muse, Claude, Cursor, Codex...) connect to remote servers with
 * OAuth 2.1 + PKCE + dynamic client registration. EarnKit has no accounts, so
 * the authorize step approves instantly and the issued token is the
 * installation. Nothing is stored except the installation itself: client ids
 * and codes are signed with EARNKIT_AUTH_SECRET.
 */

const CODE_TTL_MS = 5 * 60 * 1000;

export class OAuthError extends Error {
  constructor(
    public code:
      | 'invalid_request'
      | 'invalid_client'
      | 'invalid_grant'
      | 'unsupported_grant_type'
      | 'invalid_redirect_uri'
      | 'invalid_client_metadata',
    message: string,
  ) {
    super(message);
  }
}

function secret() {
  const s = process.env.EARNKIT_AUTH_SECRET;
  if (!s) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return s;
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');
const mac = (purpose: string, data: string) =>
  createHmac('sha256', secret())
    .update(`${purpose}:${data}`)
    .digest('base64url');

function sign(purpose: string, payload: object) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${mac(purpose, body)}`;
}

function verify<T>(purpose: string, value: string): T | null {
  // Exactly body.sig: extra segments ("code.x") would otherwise verify and, as distinct
  // strings, mint distinct tokens from one code.
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(purpose, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

const BLOCKED_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:'];

/** https, http on loopback (native apps), or a custom app scheme. */
export function isAllowedRedirectUri(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:')
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return !BLOCKED_SCHEMES.includes(url.protocol);
}

/**
 * `n`: the registration nonce (v2.4+; client ids issued before v2.4 have none). `s`: 1 when the
 * client registered as a hosted agent (v2.8.1 §E17, isSharedClient), so its client name, which the id
 * doesn't carry, still counts at the token exchange.
 */
type ClientPayload = { r: string[]; n?: string; s?: 1 };

/**
 * v2.8.1 §E17: hosted agents, whose servers register and exchange tokens for many users, so one
 * registration may serve many of them. Matched on the registered client name (whole words, any case)
 * or a redirect URI's host (the host itself or a subdomain). Keep both lists short and explicit.
 */
export const HOSTED_CLIENT_NAMES = ['grok', 'muse', 'meta ai', 'xai'] as const;
export const HOSTED_REDIRECT_HOSTS = [
  'grok.com', // Grok Bot
  'x.ai', // Grok Bot (xAI)
  'x.com', // Grok on X
  'meta.ai', // Muse (Meta)
  'claude.ai', // Claude's hosted connectors
  'chatgpt.com', // ChatGPT connectors
  'openai.com', // ChatGPT connectors (older host)
] as const;

/** The https redirect hosts of a client (lowercase, no trailing dot); loopback and app schemes have none. Pure. */
export function redirectHosts(uris: readonly string[]): string[] {
  const out: string[] = [];
  for (const u of uris) {
    try {
      const url = new URL(u);
      if (url.protocol === 'https:') out.push(url.hostname.toLowerCase().replace(/\.$/, ''));
    } catch {
      // not a URL: no host
    }
  }
  return [...new Set(out)];
}

/** Whether a host is one of HOSTED_REDIRECT_HOSTS or a subdomain of one. Pure; exported for tests. */
export const isHostedHost = (host: string) =>
  HOSTED_REDIRECT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

/**
 * v2.9 T12 (G0): the first redirect host that is a known hosted service (HOSTED_REDIRECT_HOSTS), or
 * null. Only this, never the client name (anyone can name a client "Grok"), exempts a registration
 * from the per-IP floor. Pure; exported for tests.
 */
export const hostedRedirectHost = (uris: readonly string[]): string | null => redirectHosts(uris).find(isHostedHost) ?? null;

/**
 * v2.8.1 §E17: a hosted (shared) client, from its registered name or its redirect URIs. Pure;
 * exported for tests.
 */
export function isSharedClient(metadata: { client_name?: unknown; redirect_uris?: unknown }): boolean {
  const name = typeof metadata.client_name === 'string' ? metadata.client_name.toLowerCase() : '';
  const words = ` ${name.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  if (name && HOSTED_CLIENT_NAMES.some((n) => words.includes(` ${n} `))) return true;
  const uris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  return redirectHosts(uris).some(isHostedHost);
}

/**
 * v2.8.1 §E17, Ruling F11: the agent app a registration counts against for the register ceiling
 * (LIMITS.oauthRegisterHost), by its first https redirect host. A client with no https redirect
 * (loopback or an app scheme: a desktop or CLI agent) runs on the builder's own machine; it counts
 * per registration (`clientId`) when one is given, else not at all: the IP floor covers it.
 * Pure; exported for tests.
 */
export function clientLimitKey(uris: readonly string[], clientId?: string): string | null {
  const host = redirectHosts(uris)[0];
  if (host) return `host:${host}`;
  return clientId ? registrationLimitKey(clientId) : null;
}

/**
 * Ruling F11 (final fix wave, I1): what a new installation counts against besides its IP: its own
 * registration (client id), never the redirect host, so one agent app's users (claude.ai, ChatGPT,
 * Grok) never share a bucket that anyone can fill by registering clients with that host. Pure;
 * exported for tests.
 */
export const registrationLimitKey = (clientId: string) => `client:${clientKeyOf(clientId)}`;

/**
 * The installation key of an OAuth client (v2.4 §5): the first 32 hex of sha256(client_id).
 * Re-authorizing the same client maps to the same installation. Never display or log client ids;
 * this key is all that is stored. Pure; exported for tests.
 */
export const clientKeyOf = (clientId: string) =>
  createHash('sha256').update(clientId).digest('hex').slice(0, 32);

type CodePayload = { c: string; r: string; ch: string; e: number; n: string };

/** RFC 7591 dynamic client registration. The client id carries its redirect URIs. */
export function registerClient(metadata: {
  redirect_uris?: unknown;
  client_name?: unknown;
}) {
  const uris = metadata.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    !uris.every((u) => typeof u === 'string')
  ) {
    throw new OAuthError(
      'invalid_redirect_uri',
      'redirect_uris must be a non-empty list of URIs',
    );
  }
  const bad = uris.find((u) => !isAllowedRedirectUri(u));
  if (bad)
    throw new OAuthError(
      'invalid_redirect_uri',
      `redirect_uri not allowed: ${bad}`,
    );

  return {
    // A random nonce (128 bits) makes every registration its own client: apps with one fixed
    // redirect URI for all their users (Cursor) must never share an installation (v2.4 §5).
    client_id: sign('client', {
      r: uris,
      n: randomBytes(16).toString('base64url'),
      ...(isSharedClient(metadata) && { s: 1 as const }),
    } satisfies ClientPayload),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: uris,
    ...(typeof metadata.client_name === 'string' && {
      client_name: metadata.client_name,
    }),
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/**
 * Validates an authorize request and returns the redirect URL with a code.
 * Throws with `redirect: false` semantics (invalid_client / invalid_redirect_uri)
 * when the error must not be sent to the redirect URI.
 */
export function authorize(params: URLSearchParams) {
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const client = verify<ClientPayload>('client', clientId);
  if (!client)
    throw new OAuthError(
      'invalid_client',
      'Unknown client_id. Register first.',
    );
  if (!client.r.includes(redirectUri))
    throw new OAuthError(
      'invalid_redirect_uri',
      'redirect_uri was not registered',
    );

  const back = new URL(redirectUri);
  const state = params.get('state');
  if (state) back.searchParams.set('state', state);

  const challenge = params.get('code_challenge');
  if (
    params.get('response_type') !== 'code' ||
    !challenge ||
    params.get('code_challenge_method') !== 'S256'
  ) {
    back.searchParams.set('error', 'invalid_request');
    back.searchParams.set(
      'error_description',
      'Requires response_type=code and a PKCE S256 code_challenge',
    );
    return back;
  }

  back.searchParams.set(
    'code',
    sign('code', {
      c: clientId,
      r: redirectUri,
      ch: challenge,
      e: Date.now() + CODE_TTL_MS,
      n: randomBytes(12).toString('base64url'),
    } satisfies CodePayload),
  );
  return back;
}

/**
 * Exchanges a code for the installation token and its client's key. The token is derived from the
 * code, so replaying a code yields the same token; the client key makes re-authorizing the same
 * client the same installation. Client ids issued before v2.4 carry no nonce and are shared by
 * every user of an app with a fixed redirect URI, so they get no client key: their tokens stay
 * separate installations, as in v2.3.
 */
export function exchangeCode(form: URLSearchParams): {
  token: string;
  clientKey: string | undefined;
  /** v2.8.1 §E17: a hosted agent client (isSharedClient), flagged on the installation. */
  shared: boolean;
  /** v2.8.1 §E17, Ruling F11: what a new installation counts against besides its IP (registrationLimitKey). */
  limitKey: string;
  /** v2.9 T12 (G0): the client's redirect host when it is a known hosted service (hostedRedirectHost). */
  hostedHost: string | null;
} {
  if (form.get('grant_type') !== 'authorization_code') {
    throw new OAuthError(
      'unsupported_grant_type',
      'Only authorization_code is supported',
    );
  }
  const code = form.get('code') ?? '';
  const payload = verify<CodePayload>('code', code);
  if (!payload || payload.e < Date.now())
    throw new OAuthError('invalid_grant', 'Code is invalid or expired');

  const clientId = form.get('client_id');
  if (clientId && clientId !== payload.c)
    throw new OAuthError('invalid_grant', 'Code was issued to another client');
  const redirectUri = form.get('redirect_uri');
  if (redirectUri && redirectUri !== payload.r)
    throw new OAuthError('invalid_grant', 'redirect_uri does not match');

  const verifier = form.get('code_verifier') ?? '';
  if (b64(createHash('sha256').update(verifier).digest()) !== payload.ch) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed');
  }

  const client = verify<ClientPayload>('client', payload.c);
  const clientKey =
    typeof client?.n === 'string' && client.n.length > 0
      ? clientKeyOf(payload.c)
      : undefined;
  const uris = client?.r ?? [payload.r];
  return {
    token: `ek_${mac('token', code)}`,
    clientKey,
    shared: client?.s === 1 || isSharedClient({ redirect_uris: uris }),
    limitKey: registrationLimitKey(payload.c),
    hostedHost: hostedRedirectHost(uris),
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    resource_name: 'EarnKit',
  };
}

/**
 * The public origin for OAuth discovery and WWW-Authenticate: EARNKIT_URL. Production requires it
 * and never falls back to the request's Host, which a client controls (v2.2 §5); local dev may.
 * Pure; exported for tests.
 */
export function originFor(
  env: { NODE_ENV?: string; EARNKIT_URL?: string },
  requestUrl: string,
) {
  const configured = env.EARNKIT_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  // Only local dev and tests may fall back: an unset or unusual NODE_ENV (e.g. "staging") throws.
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test')
    throw new Error(
      'EARNKIT_URL is not set. Production needs it (e.g. https://earnkit.com) for OAuth discovery; the request Host is never used.',
    );
  return new URL(requestUrl).origin;
}

export const publicOrigin = (request: Request) =>
  originFor(process.env, request.url);
