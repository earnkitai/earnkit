import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from './db';
import {
  OAuthError,
  checkAuthorize,
  clientKeyOf,
  clientLimitKey,
  exchangeCode,
  hostedRedirectHost,
  isAllowedRedirectUri,
  issueCode,
  originFor,
  redirectClass,
  registerClient,
} from './oauth';
import { authorizeGet, registerPost, tokenPost } from './oauth-routes';
import { connectInstallation } from './installations';
import { GET as mcpGet, POST as mcpPost } from '../../app/mcp/route';

process.env.EARNKIT_AUTH_SECRET = 'test-secret';
process.env.EARNKIT_URL = 'https://earnkit.test';
after(() => sql().end());

const authorize = (params: URLSearchParams): URL => {
  const c = checkAuthorize(params);
  return 'error' in c ? c.error : issueCode(c.req, null, 'https://earnkit.test');
};
const verifier = 'a-long-random-verifier-string-for-pkce-0123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirect = 'http://127.0.0.1:33418/callback';
const hosted = 'https://grok.com/connectors/callback';
const params = (clientId: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', ...extra });
const tokenForm = (clientId: string, code: string, v = verifier, uri = redirect) =>
  new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: uri, code_verifier: v });
const codeOf = (clientId: string, uri = redirect) => authorize(params(clientId, { redirect_uri: uri })).searchParams.get('code')!;

test('register, authorize and token through the routes: straight to the client, then an installation row', async () => {
  const reg = await registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.0.0.1' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: 'Claude Code' }),
  }));
  assert.equal(reg.status, 201);
  const { client_id } = (await reg.json()) as { client_id: string };
  const auth = await authorizeGet(new Request(`https://earnkit.test/oauth/authorize?${params(client_id)}`, { headers: { 'x-real-ip': '10.0.0.1' } }));
  assert.equal(auth.status, 302);
  const back = new URL(auth.headers.get('location')!);
  assert.equal(back.origin + back.pathname, redirect);
  assert.equal(back.searchParams.get('state'), 'xyz');
  assert.equal(back.searchParams.get('iss'), 'https://earnkit.test');
  const code = back.searchParams.get('code')!;
  const tok = await tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.0.0.1' },
    body: tokenForm(client_id, code).toString(),
  }));
  assert.equal(tok.status, 200);
  const { access_token } = (await tok.json()) as { access_token: string };
  assert.match(access_token, /^ek_/);
  const caller = await connectInstallation(access_token);
  assert.ok(caller);
  const [row] = await sql()`SELECT client_key, client_name FROM installations WHERE id = ${caller.id}`;
  assert.equal(row.client_key, null);
  assert.equal(row.client_name, 'Claude Code');
  // A replayed code is the same installation.
  const replay = await tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenForm(client_id, code).toString(),
  }));
  assert.equal(((await replay.json()) as { access_token: string }).access_token, access_token);
  // Re-authorizing the same client is a second installation (a fresh ledger); the first token keeps working.
  const again = await tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenForm(client_id, codeOf(client_id)).toString(),
  }));
  const second = ((await again.json()) as { access_token: string }).access_token;
  const other = await connectInstallation(second);
  assert.ok(other && other.id !== caller.id);
  assert.equal((await connectInstallation(access_token))?.id, caller.id);
});

test('register: the hosted tier and host bucket only when every redirect is on the hosted host', async () => {
  const keys = async (ip: string) =>
    (await sql()<{ key: string }[]>`SELECT key FROM rate_windows WHERE key LIKE ${'%' + ip}`).map((r) => r.key).sort();
  const reg = (uris: string[], ip: string) => registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ redirect_uris: uris }),
  }));
  assert.equal((await reg([hosted, 'https://evil.example/cb'], '10.9.0.1')).status, 201);
  assert.deepEqual(await keys('10.9.0.1'), ['oauthRegister:10.9.0.1']);
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = 'oauthRegisterHost:host:grok.com'`).length, 0);
  assert.equal((await reg([hosted, 'https://grok.com/other'], '10.9.0.2')).status, 201);
  assert.deepEqual(await keys('10.9.0.2'), ['oauthRegisterHosted:10.9.0.2']);
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = 'oauthRegisterHost:host:grok.com'`).length, 1);
});

test('an unknown client is refused on our page, never redirected', async () => {
  const r = await authorizeGet(new Request(`https://earnkit.test/oauth/authorize?${params('nope.nope')}`));
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('location'), null);
});

test('/mcp without a token, or with an unknown one, is 401 with the resource metadata', async () => {
  for (const auth of [undefined, 'Bearer ek_unknown']) {
    const r = await mcpPost(new Request('https://earnkit.test/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(auth && { authorization: auth }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }));
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('www-authenticate'), 'Bearer resource_metadata="https://earnkit.test/.well-known/oauth-protected-resource/mcp"');
  }
  assert.equal((await mcpGet(new Request('https://earnkit.test/mcp'))).status, 401);
});

test('/mcp with a token lists the two tools; a body over 1 MB is 413', async () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const { token, clientName } = exchangeCode(tokenForm(client_id, codeOf(client_id)));
  const { saveInstallation } = await import('./installations');
  await saveInstallation(token, clientName);
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` };
  const init = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
  assert.equal((await mcpPost(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify(init) }))).status, 200);
  const r = await mcpPost(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
  assert.equal(r.status, 200);
  const body = (await r.json()) as { result: { tools: { name: string }[] } };
  assert.deepEqual(body.result.tools.map((t) => t.name), ['find', 'track']);
  const key = 'sk_live_' + 'a1'.repeat(12);
  const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'find', arguments: { project: { name: 'X', description: `my key ${key}` } } } };
  const s = await mcpPost(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify(call) }));
  const text = JSON.stringify(await s.json());
  assert.ok(!text.includes(key));
  assert.match(text, /That looked like a secret key/);
  const big = await mcpPost(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify({ x: 'a'.repeat(1_100_000) }) }));
  assert.equal(big.status, 413);
});

test('full flow: register, authorize, token; replay is the same token', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect], client_name: 'Cursor' });
  const code = codeOf(client_id);
  assert.equal(exchangeCode(tokenForm(client_id, code)).token, exchangeCode(tokenForm(client_id, code)).token);
  assert.match(exchangeCode(tokenForm(client_id, code)).token, /^ek_/);
});

test('wrong PKCE, another client, a forged id or an unregistered redirect are refused', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const code = codeOf(client_id);
  assert.throws(() => exchangeCode(tokenForm(client_id, code, 'wrong')), (e) => e instanceof OAuthError && e.code === 'invalid_grant');
  const b = registerClient({ redirect_uris: [redirect] }).client_id;
  assert.throws(() => exchangeCode(tokenForm(b, code)), (e) => e instanceof OAuthError && e.code === 'invalid_grant');
  assert.throws(() => authorize(params(client_id, { redirect_uri: 'https://evil.example/cb' })), (e) => e instanceof OAuthError && e.code === 'invalid_redirect_uri');
  assert.throws(() => authorize(params(client_id.slice(0, -3) + 'AAA')), (e) => e instanceof OAuthError && e.code === 'invalid_client');
  for (const forged of [`${code}.x`, `${code}.`]) assert.throws(() => exchangeCode(tokenForm(client_id, forged)), OAuthError);
});

test('missing PKCE goes back to the client as invalid_request', () => {
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const back = authorize(params(client_id, { code_challenge: '' }));
  assert.equal(back.searchParams.get('error'), 'invalid_request');
  assert.equal(back.searchParams.get('code'), null);
});

test('redirect URI policy and classes', () => {
  assert.ok(isAllowedRedirectUri('https://x.com/cb'));
  assert.ok(isAllowedRedirectUri('http://localhost:33418/callback'));
  assert.ok(isAllowedRedirectUri('cursor://anysphere.cursor-retrieval/oauth/callback'));
  assert.ok(!isAllowedRedirectUri('http://evil.example/cb'));
  assert.ok(!isAllowedRedirectUri('javascript:alert(1)'));
  assert.ok(!isAllowedRedirectUri('https://x.com/cb#frag'));
  assert.throws(() => registerClient({ redirect_uris: [] }));
  assert.equal(redirectClass(redirect).cls, 'loopback');
  assert.equal(redirectClass('cursor://x/cb').cls, 'app');
  assert.equal(redirectClass('https://claude.ai/api/mcp/auth_callback').cls, 'agent_host');
  assert.equal(redirectClass('https://evil.example/cb').cls, 'other');
});

test('each registration is its own client; every token is its own installation', () => {
  const a = registerClient({ redirect_uris: [redirect] }).client_id;
  const b = registerClient({ redirect_uris: [redirect] }).client_id;
  assert.notEqual(clientKeyOf(a), clientKeyOf(b));
  const first = exchangeCode(tokenForm(a, codeOf(a)));
  const second = exchangeCode(tokenForm(a, codeOf(a)));
  assert.notEqual(first.token, second.token);
  assert.ok(!('clientKey' in first));
});

test('the limit key and the public origin', () => {
  assert.equal(clientLimitKey([hosted]), 'host:grok.com');
  assert.equal(clientLimitKey([redirect]), null);
  assert.equal(clientLimitKey([hosted, 'https://evil.example/cb']), null);
  assert.equal(hostedRedirectHost([hosted, 'https://evil.example/cb']), null);
  assert.equal(hostedRedirectHost(['https://evil.example/cb', hosted]), null);
  assert.equal(hostedRedirectHost([hosted, 'http://127.0.0.1:1/cb']), null);
  assert.equal(hostedRedirectHost([hosted]), 'grok.com');
  assert.equal(originFor({ NODE_ENV: 'production', EARNKIT_URL: 'https://earnkit.com/' }, 'https://attacker.example/x'), 'https://earnkit.com');
  assert.throws(() => originFor({ NODE_ENV: 'production' }, 'https://attacker.example/x'), /EARNKIT_URL is not set/);
  assert.equal(originFor({ NODE_ENV: 'development' }, 'http://localhost:3000/mcp'), 'http://localhost:3000');
});
