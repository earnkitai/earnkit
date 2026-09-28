import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  OAuthError,
  authorize,
  exchangeCode,
  isAllowedRedirectUri,
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
  );
  assert.match(token, /^ek_/);
});

test('replaying a code returns the same token (no duplicate installation)', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const code = codeFor(client_id).searchParams.get('code')!;
  assert.equal(
    exchangeCode(tokenForm(client_id, code)),
    exchangeCode(tokenForm(client_id, code)),
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
