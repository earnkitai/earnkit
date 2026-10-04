import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  OAuthError,
  authorize,
  clientKeyOf,
  exchangeCode,
  isAllowedRedirectUri,
  originFor,
  registerClient,
} from './oauth';

process.env.EARNKIT_AUTH_SECRET = 'test-secret';

const verifier = 'a-long-random-verifier-string-for-pkce-0123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirect = 'https://grok.com/connectors/callback';

function codeFor(clientId: string, extra: Record<string, string> = {}) {
  const url = authorize(
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      ...extra,
    }),
  );
  return url;
}

const tokenForm = (clientId: string, code: string, v = verifier) =>
  new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirect,
    code_verifier: v,
  });

test('full flow: register -> authorize -> token', () => {
  const { client_id } = registerClient({
    redirect_uris: [redirect],
    client_name: 'Grok',
  });
  const back = codeFor(client_id);
  assert.equal(back.origin + back.pathname, redirect);
  assert.equal(back.searchParams.get('state'), 'xyz');
  const token = exchangeCode(
    tokenForm(client_id, back.searchParams.get('code')!),
  ).token;
  assert.match(token, /^ek_/);
});

test('replaying a code returns the same token (no duplicate installation)', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const code = codeFor(client_id).searchParams.get('code')!;
  assert.equal(
    exchangeCode(tokenForm(client_id, code)).token,
    exchangeCode(tokenForm(client_id, code)).token,
  );
});

test('wrong PKCE verifier is rejected', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const code = codeFor(client_id).searchParams.get('code')!;
  assert.throws(
    () => exchangeCode(tokenForm(client_id, code, 'wrong')),
    (e) => e instanceof OAuthError && e.code === 'invalid_grant',
  );
});

test('unregistered redirect_uri and forged client ids are refused without redirecting', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  assert.throws(
    () => codeFor(client_id, { redirect_uri: 'https://evil.example/cb' }),
    (e) => e instanceof OAuthError && e.code === 'invalid_redirect_uri',
  );
  const forged = client_id.slice(0, -3) + 'AAA';
  assert.throws(
    () => codeFor(forged),
    (e) => e instanceof OAuthError && e.code === 'invalid_client',
  );
});

test('missing PKCE is sent back to the client as invalid_request', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const back = codeFor(client_id, { code_challenge: '' });
  assert.equal(back.searchParams.get('error'), 'invalid_request');
  assert.equal(back.searchParams.get('code'), null);
});

test('a code cannot be used by another client', () => {
  const a = registerClient({ redirect_uris: [redirect] }).client_id;
  const b = registerClient({
    redirect_uris: [redirect, 'https://other.example/cb'],
  }).client_id;
  const code = codeFor(a).searchParams.get('code')!;
  assert.throws(
    () => exchangeCode(tokenForm(b, code)),
    (e) => e instanceof OAuthError && e.code === 'invalid_grant',
  );
});

test('redirect URI policy', () => {
  assert.ok(isAllowedRedirectUri('https://x.com/cb'));
  assert.ok(isAllowedRedirectUri('http://localhost:33418/callback'));
  assert.ok(isAllowedRedirectUri('http://127.0.0.1:5000/cb'));
  assert.ok(
    isAllowedRedirectUri('cursor://anysphere.cursor-retrieval/oauth/callback'),
  );
  assert.ok(!isAllowedRedirectUri('http://evil.example/cb'));
  assert.ok(!isAllowedRedirectUri('javascript:alert(1)'));
  assert.ok(!isAllowedRedirectUri('https://x.com/cb#frag'));
  assert.throws(() => registerClient({ redirect_uris: [] }));
});

test('originFor: EARNKIT_URL wins; production never falls back to the request Host', () => {
  const url = 'https://attacker.example/.well-known/x';
  assert.equal(
    originFor(
      { NODE_ENV: 'production', EARNKIT_URL: 'https://earnkit.com/' },
      url,
    ),
    'https://earnkit.com',
  );
  assert.throws(
    () => originFor({ NODE_ENV: 'production' }, url),
    /EARNKIT_URL is not set/,
  );
  assert.throws(
    () => originFor({ NODE_ENV: 'production', EARNKIT_URL: ' ' }, url),
    /EARNKIT_URL is not set/,
  );
  assert.throws(
    () => originFor({ NODE_ENV: 'staging' }, url),
    /EARNKIT_URL is not set/,
  );
  assert.throws(() => originFor({}, url), /EARNKIT_URL is not set/);
  assert.equal(
    originFor({ NODE_ENV: 'development' }, 'http://localhost:3000/mcp'),
    'http://localhost:3000',
  );
});

test('a code or client id with extra segments is refused (no extra tokens from one code)', () => {
  const { client_id } = registerClient({
    redirect_uris: ['https://app.example/cb'],
  });
  const back = authorize(
    new URLSearchParams({
      client_id,
      redirect_uri: 'https://app.example/cb',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
  );
  const code = new URL(back).searchParams.get('code')!;
  const exchange = (c: string) =>
    exchangeCode(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: c,
        code_verifier: verifier,
      }),
    ).token;
  for (const forged of [`${code}.x`, `${code}.y`, `${code}.`])
    assert.throws(() => exchange(forged), OAuthError);
  assert.match(exchange(code), /^ek_/);
  assert.throws(
    () =>
      authorize(
        new URLSearchParams({
          client_id: `${client_id}.x`,
          redirect_uri: 'https://app.example/cb',
          response_type: 'code',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }),
      ),
    OAuthError,
  );
});

const codeOf = (clientId: string) =>
  codeFor(clientId).searchParams.get('code')!;

test('v2.4 Review Focus 1: each registration is its own client, even with the same redirect URIs', () => {
  // Cursor-style apps register with one fixed redirect URI for every user.
  const a = registerClient({ redirect_uris: [redirect] }).client_id;
  const b = registerClient({ redirect_uris: [redirect] }).client_id;
  assert.notEqual(a, b);
  assert.notEqual(clientKeyOf(a), clientKeyOf(b));
});

test('v2.4: a new client id carries a nonce of at least 128 random bits', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const payload = JSON.parse(
    Buffer.from(client_id.split('.')[0], 'base64url').toString(),
  );
  assert.equal(typeof payload.n, 'string');
  assert.ok(Buffer.from(payload.n, 'base64url').length >= 16);
});

test('v2.4: re-authorizing the same client keeps its client key (one installation); the token is new', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const first = exchangeCode(tokenForm(client_id, codeOf(client_id)));
  const second = exchangeCode(tokenForm(client_id, codeOf(client_id)));
  assert.notEqual(first.token, second.token);
  assert.equal(first.clientKey, second.clientKey);
  assert.equal(first.clientKey, clientKeyOf(client_id));
  assert.match(first.clientKey!, /^[0-9a-f]{32}$/);
});

test('v2.4: a client id issued before v2.4 (no nonce) still authorizes, keyed by token only (no merge)', () => {
  // Pre-v2.4 client ids carry only their redirect URIs, so every Cursor user shares one: two
  // tokens of such a client must stay two installations (controller ruling 1).
  const body = Buffer.from(JSON.stringify({ r: [redirect] })).toString('base64url');
  const sig = createHmac('sha256', 'test-secret').update(`client:${body}`).digest('base64url');
  const legacy = `${body}.${sig}`;
  const first = exchangeCode(tokenForm(legacy, codeOf(legacy)));
  const second = exchangeCode(tokenForm(legacy, codeOf(legacy)));
  assert.match(first.token, /^ek_/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.clientKey, undefined);
  assert.equal(second.clientKey, undefined);
});
