import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from './db';
import {
  CIMD_FAILED,
  OAuthError,
  authorizationServerMetadata,
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
  registrationLimitKey,
} from './oauth';
import { INVALID_CLIENT_NAME, authorizeGet, registerPost, tokenPost } from './oauth-routes';
import { connectInstallation } from './installations';
import { GET as mcpGet, POST as mcpPost } from '../../app/mcp/route';

process.env.EARNKIT_AUTH_SECRET = 'test-secret';
process.env.EARNKIT_URL = 'https://earnkit.test';
after(() => sql().end());

const authorize = async (params: URLSearchParams): Promise<URL> => {
  const c = await checkAuthorize(params);
  return 'error' in c ? c.error : issueCode(c.req, null, 'https://earnkit.test');
};
const verifier = 'a-long-random-verifier-string-for-pkce-0123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirect = 'http://127.0.0.1:33418/callback';
const hosted = 'https://claude.ai/api/mcp/auth_callback';
const params = (clientId: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', ...extra });
const tokenForm = (clientId: string, code: string, v = verifier, uri = redirect) =>
  new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: uri, code_verifier: v });
const codeOf = async (clientId: string, uri = redirect) => (await authorize(params(clientId, { redirect_uri: uri }))).searchParams.get('code')!;

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
  // L19-4 (v6.1.16): a code is one-time; a reuse is invalid_grant (pinned with the revoke below).
  const replay = await tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenForm(client_id, code).toString(),
  }));
  assert.equal(replay.status, 400);
  assert.equal(((await replay.json()) as { error: string }).error, 'invalid_grant');
  // Re-authorizing the same client is a second installation (a fresh ledger); the first token keeps working.
  const again = await tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenForm(client_id, await codeOf(client_id)).toString(),
  }));
  const second = ((await again.json()) as { access_token: string }).access_token;
  const other = await connectInstallation(second);
  assert.ok(other && other.id !== caller.id);
  // The reuse revoked the first token; the second installation is untouched.
  assert.equal(await connectInstallation(access_token), null);
  assert.equal((await connectInstallation(second))?.id, other.id);
});

test('register: every address counts on its per-address floor and its block; no shared hosted ceiling (v6.1.13, B1)', async () => {
  const keys = async (ip: string) =>
    (await sql()<{ key: string }[]>`SELECT key FROM rate_windows WHERE key LIKE ${'%' + ip}`).map((r) => r.key).sort();
  const reg = (uris: string[], ip: string) => registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ redirect_uris: uris }),
  }));
  const ip = (n: number) => `10.9.${Math.floor(Math.random() * 250)}.${n}`;
  const [a, b] = [ip(1), ip(2)];
  assert.equal((await reg([hosted, 'https://evil.example/cb'], a)).status, 201);
  assert.deepEqual(await keys(a), [`oauthRegister:${a}`]);
  assert.equal((await reg([hosted], b)).status, 201);
  assert.deepEqual(await keys(b), [`oauthRegister:${b}`]);
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key LIKE 'oauthRegisterHost:%'`).length, 0);
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = 'oauthRegisterBlock:10.9.0.0/16'`).length, 1);
});

test('B1 (v6.1.13, Review Focus 1): ten thousand registrations from one address block never block another block', async () => {
  const today = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
  const full = ['198.18.0.0/16', '2001:db8:aaaa::/48'];
  const preset = async () => {
    for (const block of full)
      for (const name of ['oauthRegisterBlock', 'installBlock'])
        await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${`${name}:${block}`}, ${today}, 10000)
          ON CONFLICT (key, window_start) DO UPDATE SET count = 10000`;
  };
  const reg = (ip: string) => registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ redirect_uris: [hosted] }),
  }));
  const token = async (ip: string) => {
    const id = (await registerClient({ redirect_uris: [hosted] })).client_id;
    return tokenPost(new Request('https://earnkit.test/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip }, body: tokenForm(id, await codeOf(id, hosted), verifier, hosted).toString(),
    }));
  };
  const r = () => Math.floor(Math.random() * 250);
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16);
  await preset();
  try {
    // A fresh address inside a full block: the network's day is spent, said in one line with no retry clause.
    for (const ip of [`198.18.${r()}.${r()}`, `2001:db8:aaaa:${hex()}::1`]) {
      const refused = await reg(ip);
      assert.equal(refused.status, 429, ip);
      assert.equal(((await refused.json()) as { error_description: string }).error_description, 'Too many sign-ups from your network today. Try again tomorrow.');
      assert.match(refused.headers.get('retry-after') ?? '', /^[1-9]\d*$/);
      const t = await token(ip);
      assert.equal(t.status, 429, ip);
      assert.equal(((await t.json()) as { error_description: string }).error_description, 'Too many sign-ups from your network today. Try again tomorrow.');
    }
    // Every other block still signs up, hosted callback and all.
    for (const ip of [`198.19.${r()}.${r()}`, `2001:db8:bbbb:${hex()}::1`, `10.12.${r()}.${r()}`]) {
      assert.equal((await reg(ip)).status, 201, ip);
      assert.equal((await token(ip)).status, 200, ip);
    }
    // Rotating /64s inside one /48 is one block.
    const before = Number((await sql()`SELECT count FROM rate_windows WHERE key = 'oauthRegisterBlock:2001:db8:cccc::/48' AND window_start = ${today}`)[0]?.count ?? 0);
    for (let n = 0; n < 3; n++) assert.equal((await reg(`2001:db8:cccc:${hex()}::${n + 1}`)).status, 201);
    const [after] = await sql()`SELECT count FROM rate_windows WHERE key = 'oauthRegisterBlock:2001:db8:cccc::/48' AND window_start = ${today}`;
    assert.equal(Number(after.count), before + 3);
    // Fix round 1 (I3): the cap is 5,000 a day, and one ops warning is logged as a block reaches 80 percent of it.
    const edge = `198.20.${r()}.${r()}`;
    const set = (n: number) => sql()`INSERT INTO rate_windows (key, window_start, count) VALUES ('oauthRegisterBlock:198.20.0.0/16', ${today}, ${n})
      ON CONFLICT (key, window_start) DO UPDATE SET count = ${n}`;
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => void warned.push(a.join(' '));
    try {
      await set(3_998);
      assert.equal((await reg(edge)).status, 201);
      assert.equal((await reg(`198.20.${r()}.${r()}`)).status, 201);
      assert.equal((await reg(`198.20.${r()}.${r()}`)).status, 201);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(warned.filter((w) => w.includes('block near cap')), ['[oauth] block near cap: oauthRegisterBlock 198.20.0.0/16 at 4000 of 5000 today']);
    await set(4_999);
    assert.equal((await reg(`198.20.${r()}.${r()}`)).status, 201);
    assert.equal((await reg(`198.20.${r()}.${r()}`)).status, 429);
  } finally {
    await sql()`DELETE FROM rate_windows WHERE key IN ${sql()([...full, '198.20.0.0/16'].flatMap((b) => [`oauthRegisterBlock:${b}`, `installBlock:${b}`]))}`;
  }
});

test('B5 (Review Focus 4): a hosted-redirect client from an address over its floor is refused with the same text as any other', async () => {
  const ip = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const now = new Date();
  const start = (secs: number) => new Date(Math.floor(now.getTime() / (secs * 1000)) * secs * 1000);
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${'%' + ip}`;
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${'oauthRegister:' + ip}, ${start(3_600)}, 200), (${'installHour:' + ip}, ${start(3_600)}, 200)`;
  const reg = (uris: string[]) => registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ redirect_uris: uris }),
  }));
  const plain = await reg([redirect]);
  const viaHost = await reg([hosted]);
  const anyPath = await reg(['https://claude.ai/anything']);
  assert.equal(plain.status, 429);
  // The refusal says when to come back: the seconds left in the hour window.
  assert.match(plain.headers.get('retry-after') ?? '', /^[1-9]\d*$/);
  assert.ok(Number(plain.headers.get('retry-after')) <= 3_600);
  assert.equal(viaHost.status, 429);
  assert.equal(anyPath.status, 429);
  const text = ((await plain.json()) as { error_description: string }).error_description;
  assert.equal(((await viaHost.json()) as { error_description: string }).error_description, text);
  assert.equal(((await anyPath.json()) as { error_description: string }).error_description, text);
  // A code for a hosted client is refused at the token exchange the same way as any other.
  const token = async (id: string, uri: string) => tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }, body: tokenForm(id, await codeOf(id, uri), verifier, uri).toString(),
  }));
  const a = (await registerClient({ redirect_uris: [redirect] })).client_id;
  const b = (await registerClient({ redirect_uris: [hosted] })).client_id;
  const ta = await token(a, redirect);
  const tb = await token(b, hosted);
  assert.equal(ta.status, 429);
  assert.equal(tb.status, 429);
  assert.equal(((await tb.json()) as { error_description: string }).error_description, ((await ta.json()) as { error_description: string }).error_description);
});

test('Review Focus 16 (L26-1, L26-3): refused registrations, authorizes and tokens never move the block count', async () => {
  const ip = `10.79.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const now = new Date();
  const start = (secs: number) => new Date(Math.floor(now.getTime() / (secs * 1000)) * secs * 1000);
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${'%' + ip}`;
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${'oauthRegister:' + ip}, ${start(3_600)}, 200), (${'installHour:' + ip}, ${start(3_600)}, 200), (${'oauthAuthorize:' + ip}, ${start(3_600)}, 200)`;
  const blockCount = async () =>
    Object.fromEntries((await sql()<{ key: string; count: number }[]>`SELECT key, count FROM rate_windows WHERE key IN ('oauthRegisterBlock:10.79.0.0/16', 'installBlock:10.79.0.0/16') AND window_start = ${start(86_400)}`).map((r) => [r.key, r.count]));
  const before = await blockCount();
  const id = (await registerClient({ redirect_uris: [redirect] })).client_id;
  for (let i = 0; i < 5; i++) {
    const reg = await registerPost(new Request('https://earnkit.test/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ redirect_uris: [redirect] }),
    }));
    assert.equal(reg.status, 429);
    const tok = await tokenPost(new Request('https://earnkit.test/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }, body: tokenForm(id, await codeOf(id, redirect), verifier, redirect).toString(),
    }));
    assert.equal(tok.status, 429);
    const auth = await authorizeGet(new Request(`https://earnkit.test/oauth/authorize?${params(id)}`, { headers: { 'x-real-ip': ip } }));
    assert.equal(auth.status, 429);
  }
  assert.deepEqual(await blockCount(), before);
});

test('Task 12 fix round 1 (M3): a token the per-client ceiling refuses and a reserved-name registration never move the block count', async () => {
  const ip = `10.81.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const now = new Date();
  const day = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000);
  const block = async (name: string) => Number((await sql()`SELECT count FROM rate_windows WHERE key = ${`${name}:10.81.0.0/16`} AND window_start = ${day}`)[0]?.count ?? 0);
  const id = (await registerClient({ redirect_uris: [redirect] })).client_id;
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${'installClient:' + registrationLimitKey(id)}, ${day}, 500)
    ON CONFLICT (key, window_start) DO UPDATE SET count = 500`;
  const installs = await block('installBlock');
  const regs = await block('oauthRegisterBlock');
  for (let i = 0; i < 3; i++) {
    const tok = await tokenPost(new Request('https://earnkit.test/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }, body: tokenForm(id, await codeOf(id, redirect), verifier, redirect).toString(),
    }));
    assert.equal(tok.status, 429);
    const reg = await registerPost(new Request('https://earnkit.test/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ redirect_uris: [redirect], client_name: 'EarnKit Official' }),
    }));
    assert.equal(reg.status, 400);
    assert.deepEqual(await reg.json(), { error: 'invalid_client_metadata', error_description: INVALID_CLIENT_NAME });
  }
  assert.equal(await block('installBlock'), installs);
  assert.equal(await block('oauthRegisterBlock'), regs);
  // A reserved name spends no per-address registration either.
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = ${'oauthRegister:' + ip}`).length, 0);
});

test('B5: the hosted tier only raises the per-client install limit', async () => {
  const ip = `10.78.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const id = (await registerClient({ redirect_uris: [hosted] })).client_id;
  const r = await tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }, body: tokenForm(id, await codeOf(id, hosted), verifier, hosted).toString(),
  }));
  assert.equal(r.status, 200);
  const keys = (await sql()<{ key: string }[]>`SELECT key FROM rate_windows WHERE key = ${'installHour:' + ip} OR key = ${'installClientHosted:' + registrationLimitKey(id)}`).map((x) => x.key).sort();
  assert.deepEqual(keys, [`installClientHosted:${registrationLimitKey(id)}`, `installHour:${ip}`]);
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
  assert.equal((await mcpGet(new Request('https://earnkit.test/mcp'))).status, 405);
});

test('/mcp with a token lists the four tools; a body over 1 MB is 413', async () => {
  const { client_id } = await registerClient({ redirect_uris: [redirect] });
  const { token, clientName } = await exchangeCode(tokenForm(client_id, await codeOf(client_id)));
  const { saveInstallation } = await import('./installations');
  await saveInstallation(token, clientName);
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` };
  const init = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
  assert.equal((await mcpPost(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify(init) }))).status, 200);
  const r = await mcpPost(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
  assert.equal(r.status, 200);
  const body = (await r.json()) as { result: { tools: { name: string }[] } };
  assert.deepEqual(body.result.tools.map((t) => t.name), ['find', 'track', 'record', 'screen']);
  const key = 'sk_live_' + 'a1'.repeat(12);
  const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'find', arguments: { project: { name: 'X', description: `my key ${key}` } } } };
  const s = await mcpPost(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify(call) }));
  const text = JSON.stringify(await s.json());
  assert.ok(!text.includes(key));
  assert.match(text, /That looked like a secret key/);
  const big = await mcpPost(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify({ x: 'a'.repeat(1_100_000) }) }));
  assert.equal(big.status, 413);
});

test('full flow: register, authorize, token; replay is the same token', async () => {
  const { client_id } = await registerClient({ redirect_uris: [redirect], client_name: 'Cursor' });
  const code = await codeOf(client_id);
  assert.equal((await exchangeCode(tokenForm(client_id, code))).token, (await exchangeCode(tokenForm(client_id, code))).token);
  assert.match((await exchangeCode(tokenForm(client_id, code))).token, /^ek_/);
});

test('wrong PKCE, another client, a forged id or an unregistered redirect are refused', async () => {
  const { client_id } = await registerClient({ redirect_uris: [redirect] });
  const code = await codeOf(client_id);
  await assert.rejects(exchangeCode(tokenForm(client_id, code, 'wrong')), (e) => e instanceof OAuthError && e.code === 'invalid_grant');
  const b = (await registerClient({ redirect_uris: [redirect] })).client_id;
  await assert.rejects(exchangeCode(tokenForm(b, code)), (e) => e instanceof OAuthError && e.code === 'invalid_grant');
  await assert.rejects(authorize(params(client_id, { redirect_uri: 'https://evil.example/cb' })), (e) => e instanceof OAuthError && e.code === 'invalid_redirect_uri');
  await assert.rejects(authorize(params(client_id.slice(0, -3) + 'AAA')), (e) => e instanceof OAuthError && e.code === 'invalid_client');
  for (const forged of [`${code}.x`, `${code}.`]) await assert.rejects(exchangeCode(tokenForm(client_id, forged)), OAuthError);
});

test('missing PKCE goes back to the client as invalid_request', async () => {
  const { client_id } = await registerClient({ redirect_uris: [redirect] });
  const back = await authorize(params(client_id, { code_challenge: '' }));
  assert.equal(back.searchParams.get('error'), 'invalid_request');
  assert.equal(back.searchParams.get('code'), null);
});

test('redirect URI policy and classes', async () => {
  assert.ok(isAllowedRedirectUri('https://x.com/cb'));
  assert.ok(isAllowedRedirectUri('http://localhost:33418/callback'));
  assert.ok(isAllowedRedirectUri('cursor://anysphere.cursor-retrieval/oauth/callback'));
  assert.ok(!isAllowedRedirectUri('http://evil.example/cb'));
  assert.ok(!isAllowedRedirectUri('javascript:alert(1)'));
  assert.ok(!isAllowedRedirectUri('https://x.com/cb#frag'));
  await assert.rejects(registerClient({ redirect_uris: [] }), OAuthError);
  assert.equal(redirectClass(redirect).cls, 'loopback');
  assert.equal(redirectClass('cursor://x/cb').cls, 'app');
  assert.equal(redirectClass('https://claude.ai/api/mcp/auth_callback').cls, 'agent_host');
  assert.equal(redirectClass('https://evil.example/cb').cls, 'other');
});

test('each registration is its own client; every token is its own installation', async () => {
  const a = (await registerClient({ redirect_uris: [redirect] })).client_id;
  const b = (await registerClient({ redirect_uris: [redirect] })).client_id;
  assert.notEqual(clientKeyOf(a), clientKeyOf(b));
  const first = await exchangeCode(tokenForm(a, await codeOf(a)));
  const second = await exchangeCode(tokenForm(a, await codeOf(a)));
  assert.notEqual(first.token, second.token);
  assert.ok(!('clientKey' in first));
});

test('the limit key and the public origin', () => {
  assert.equal(clientLimitKey([hosted]), 'host:claude.ai');
  assert.equal(clientLimitKey([redirect]), null);
  assert.equal(clientLimitKey([hosted, 'https://evil.example/cb']), null);
  assert.equal(hostedRedirectHost([hosted, 'https://evil.example/cb']), null);
  assert.equal(hostedRedirectHost(['https://evil.example/cb', hosted]), null);
  assert.equal(hostedRedirectHost([hosted, 'http://127.0.0.1:1/cb']), null);
  assert.equal(hostedRedirectHost([hosted]), 'claude.ai');
  // B5: exact host and the vendor's callback path; anything else under the host is not hosted.
  assert.equal(hostedRedirectHost(['https://claude.ai/anything']), null);
  assert.equal(hostedRedirectHost(['https://claude.ai/api/mcp/auth_callbackX']), null);
  assert.equal(hostedRedirectHost(['https://evil.claude.ai/api/mcp/auth_callback']), null);
  // Lookalike hosts: the vendor's name as a prefix of another host, or in another host's path.
  assert.equal(hostedRedirectHost(['https://claude.ai.evil.com/api/mcp/auth_callback']), null);
  assert.equal(hostedRedirectHost(['https://evil.com/claude.ai/api/mcp/auth_callback']), null);
  assert.equal(hostedRedirectHost(['https://claude.ai:8443/api/mcp/auth_callback']), null);
  assert.equal(hostedRedirectHost(['https://u@claude.ai/api/mcp/auth_callback']), null);
  assert.equal(hostedRedirectHost(['https://claude.ai/api/mcp/../../x']), null);
  assert.equal(hostedRedirectHost(['https://chatgpt.com/x']), null);
  assert.equal(hostedRedirectHost(['https://chatgpt.com/connector_platform_oauth_redirect']), 'chatgpt.com');
  assert.equal(hostedRedirectHost(['https://grok.com/connectors/callback']), 'grok.com');
  assert.equal(originFor({ NODE_ENV: 'production', EARNKIT_URL: 'https://earnkit.com/' }, 'https://attacker.example/x'), 'https://earnkit.com');
  assert.throws(() => originFor({ NODE_ENV: 'production' }, 'https://attacker.example/x'), /EARNKIT_URL is not set/);
  assert.equal(originFor({ NODE_ENV: 'development' }, 'http://localhost:3000/mcp'), 'http://localhost:3000');
});

test('register and token read at most 16 KB: over the cap is 413 in the JSON error shape (security M5)', async () => {
  const big = JSON.stringify({ redirect_uris: [redirect], pad: 'x'.repeat(17_000) });
  const reg = await registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.9.9.1' }, body: big,
  }));
  assert.equal(reg.status, 413);
  const r = (await reg.json()) as { error: string; error_description: string };
  assert.equal(r.error, 'invalid_request');
  assert.equal(r.error_description, 'Request too large: EarnKit reads at most 16 KB here.');
  for (const type of ['application/json', 'application/x-www-form-urlencoded']) {
    const tok = await tokenPost(new Request('https://earnkit.test/oauth/token', {
      method: 'POST', headers: { 'content-type': type, 'x-real-ip': '10.9.9.2' }, body: type === 'application/json' ? big : `pad=${'x'.repeat(17_000)}`,
    }));
    assert.equal(tok.status, 413);
    assert.deepEqual(await tok.json(), r);
  }
  // Under the cap still parses.
  const ok = await registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.9.9.3' }, body: JSON.stringify({ redirect_uris: [redirect], pad: 'x'.repeat(15_000) }),
  }));
  assert.equal(ok.status, 201);
});

test("L13-16 (v6.1.14): a client name that is EarnKit's own, in any case or spelling, is refused at registration", async () => {
  const reg = (client_name: string, ip: string) =>
    registerPost(new Request('https://earnkit.test/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify({ redirect_uris: [redirect], client_name }),
    }));
  let n = 0;
  for (const name of ['EarnKit', 'earnkit', 'Earn Kit', 'EARN-KIT', 'e.a.r.n.k.i.t', 'EarnKit Agent', 'My earnkit bot', 'ＥａｒｎＫｉｔ']) {
    const r = await reg(name, `10.9.0.${++n}`);
    assert.equal(r.status, 400, name);
    assert.deepEqual(await r.json(), { error: 'invalid_client_metadata', error_description: INVALID_CLIENT_NAME }, name);
  }
  for (const name of ['Claude Code', 'Cursor', 'Kit', 'Earn']) assert.equal((await reg(name, `10.9.1.${++n}`)).status, 201, name);
});

test('T6-F1 (v6.1.14 fix round 1): look-alike letters and accents fold before the reserved-name check', async () => {
  const { reservedClientName } = await import('./oauth-routes');
  for (const name of ['ЕarnКit', 'Εarnkιt', 'éarnkit', 'Earn Kit', 'EАRNKІT', 'εαrnκιτ', 'ЕАRNКIТ bot'])
    assert.equal(reservedClientName(name), true, name);
  for (const name of ['Claude Code', 'Cursor', 'Ёлка', 'Ελληνικά', 'Earn', 'Kit']) assert.equal(reservedClientName(name), false, name);
  const r = await registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.9.2.1' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: 'ЕarnКit' }),
  }));
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'invalid_client_metadata', error_description: INVALID_CLIENT_NAME });
});

test('L25-1 (v6.1.14.1): a trailing (server name) is the builder\'s label, so Claude Code (earnkit) registers; EarnKit (prod) does not', async () => {
  const { reservedClientName } = await import('./oauth-routes');
  for (const name of ['Claude Code (earnkit)', 'Windsurf (EarnKit)', 'Cursor (earn kit)', 'Claude Code (ЕarnКit)', 'Codex (earnkit) '])
    assert.equal(reservedClientName(name), false, name);
  for (const name of ['EarnKit (prod)', '(earnkit)', 'earnkit (x) (y)', 'EarnKit (a) bot', 'Claude Code (earnkit) earnkit', 'x (EarnKit)', '- (earnkit)', '. . (ЕarnКit)', 'é (earnkit)'])
    assert.equal(reservedClientName(name), true, name);
  let n = 0;
  const reg = (client_name: string) =>
    registerPost(new Request('https://earnkit.test/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': `10.9.3.${++n}` },
      body: JSON.stringify({ redirect_uris: [redirect], client_name }),
    }));
  const ok = await reg('Claude Code (earnkit)');
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).client_name, 'Claude Code (earnkit)');
  const bad = await reg('EarnKit (prod)');
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'invalid_client_metadata', error_description: INVALID_CLIENT_NAME });
});

test('FR-9 (v6.1.14 final fix): the dotless i, Armenian and small-capital look-alikes are folded; earnkıt is refused at register and install', async () => {
  const { reservedClientName } = await import('./oauth-routes');
  for (const name of ['earnkıt', 'EARNKıT', 'earnkɩt', 'eaʀnkit', 'ᴇᴀʀɴᴋɪᴛ', 'earոkit', 'ɑrnkit'.replace('ɑ', 'eɑ')]) assert.equal(reservedClientName(name), true, name);
  for (const name of ['Claude Code', 'Kıt', 'Earn', 'Հայերեն']) assert.equal(reservedClientName(name), false, name);
  const r = await registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.9.2.9' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: 'earnkıt' }),
  }));
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'invalid_client_metadata', error_description: INVALID_CLIENT_NAME });
  const { client_id } = await registerClient({ redirect_uris: [redirect], client_name: 'earnkıt' });
  const tok = await tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.9.2.10' },
    body: tokenForm(client_id, await codeOf(client_id)).toString(),
  }));
  assert.equal(tok.status, 400);
  assert.deepEqual(await tok.json(), { error: 'invalid_client_metadata', error_description: INVALID_CLIENT_NAME });
  const { saveInstallation } = await import('./installations');
  await assert.rejects(saveInstallation('ek_reserved_' + Math.random(), 'earnkıt'), (e) => e instanceof OAuthError && e.message === INVALID_CLIENT_NAME);
});

test('T6-F2 (v6.1.14 fix round 1): a client id registered before the check, carrying a reserved name, cannot install', async () => {
  // registerClient keeps any name, as registration did before v6.1.14.
  const { client_id } = await registerClient({ redirect_uris: [redirect], client_name: 'EarnKit' });
  const before = (await sql()`SELECT count(*)::int AS n FROM installations`)[0].n as number;
  const tok = await tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.9.2.2' },
    body: tokenForm(client_id, await codeOf(client_id)).toString(),
  }));
  assert.equal(tok.status, 400);
  assert.deepEqual(await tok.json(), { error: 'invalid_client_metadata', error_description: INVALID_CLIENT_NAME });
  assert.equal((await sql()`SELECT count(*)::int AS n FROM installations`)[0].n, before);
  // saveInstallation refuses it too, whatever calls it.
  const { saveInstallation } = await import('./installations');
  await assert.rejects(saveInstallation('ek_reserved_' + Math.random(), 'Earn Kit'), (e) => e instanceof OAuthError && e.message === INVALID_CLIENT_NAME);
});

test('v6.1.15 Task 14: the authorization-server metadata (RFC 8414) advertises client ID metadata documents', () => {
  assert.deepEqual(authorizationServerMetadata('https://earnkit.test'), {
    issuer: 'https://earnkit.test',
    authorization_endpoint: 'https://earnkit.test/oauth/authorize',
    token_endpoint: 'https://earnkit.test/oauth/token',
    registration_endpoint: 'https://earnkit.test/oauth/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  });
  assert.equal(CIMD_FAILED, "Connecting EarnKit failed. Your agent's client document could not be read.");
});

test('L16-10 (v6.1.16): digits and l that read as letters fold before the reserved-name check', async () => {
  const { reservedClientName } = await import('./oauth-routes');
  for (const name of ['earnk1t', 'earnklt', 'E4RNK1T', 'earn-k1t', '34rnk17', 'Claude Code (x) earnk1t'])
    assert.equal(reservedClientName(name), true, name);
  for (const name of ['Cursor', 'Claude', 'Kit Earner', 'Claude Code (earnk1t)', 'Agent 47'])
    assert.equal(reservedClientName(name), false, name);
});

test('L40-B1 (v6.1.18): letters Unicode lists as confusable (Lisu, Cherokee) and the k shapes ĸ ƙ ʞ fold before the reserved-name check', async () => {
  const { reservedClientName } = await import('./oauth-routes');
  for (const name of ['ꓰꓮꓣꓠꓗꓲꓔ', 'EarnᏦit', 'Earnĸit', 'Earnƙit', 'Earnʞit', 'ꓰarnkit bot'])
    assert.equal(reservedClientName(name), true, name);
  for (const name of ['Claude Code', 'Cursor', 'Ёлка', 'Ελληνικά', 'Հայերեն', 'ꓰꓮꓣꓠ', 'Ꮶit', 'Claude Code (ꓰꓮꓣꓠꓗꓲꓔ)'])
    assert.equal(reservedClientName(name), false, name);
  const r = await registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.40.1.1' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: 'EarnᏦit' }),
  }));
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'invalid_client_metadata', error_description: INVALID_CLIENT_NAME });
});

test('L40-C2 (v6.1.18): a name whose stored form (clientNameOf: the 40-character cut, look-alike brackets made plain) is reserved is refused at registration, as at the token step', async () => {
  const { reservedClientName } = await import('./oauth-routes');
  const { clientNameOf } = await import('./oauth');
  const cut = 'Claude Code (earnkit' + 'x'.repeat(30) + ')';
  const brackets = 'Claude Code (earnkit⁾ x⁽bot)';
  for (const name of [cut, brackets]) {
    // The name as sent passes the check; the name as stored does not.
    assert.equal(reservedClientName(name), false, name);
    assert.equal(reservedClientName(clientNameOf(name)), true, name);
  }
  let n = 0;
  for (const client_name of [cut, brackets]) {
    const before = (await sql()`SELECT count(*)::int AS n FROM oauth_clients`)[0].n as number;
    const r = await registerPost(new Request('https://earnkit.test/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': `10.40.2.${++n}` },
      body: JSON.stringify({ redirect_uris: [redirect], client_name }),
    }));
    assert.equal(r.status, 400, client_name);
    assert.deepEqual(await r.json(), { error: 'invalid_client_metadata', error_description: INVALID_CLIENT_NAME });
    assert.equal((await sql()`SELECT count(*)::int AS n FROM oauth_clients`)[0].n, before);
  }
  // Still registers: the builder's server label on a plain name.
  const ok = await registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.40.2.9' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: 'Claude Code (earnkit)' }),
  }));
  assert.equal(ok.status, 201);
});

// v6.1.16 Task 5 (lane 19): OAuth edges.
const tokenReq = (form: URLSearchParams, ip = `10.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) =>
  tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }, body: form.toString(),
  }));
/** A code whose challenge is this verifier's. */
const codeWith = async (clientId: string, v: string) =>
  (await authorize(params(clientId, { code_challenge: createHash('sha256').update(v).digest('base64url') }))).searchParams.get('code')!;
const mcpWith = (token: string) => mcpPost(new Request('https://earnkit.test/mcp', {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}));

test('L19-2 (Review Focus 8): a code_verifier of 42 or 129 characters, or outside the unreserved set, never mints a token; 43 and 128 do', async () => {
  const { client_id } = await registerClient({ redirect_uris: [redirect] });
  for (const v of ['a'.repeat(42), 'a'.repeat(129), 'a'.repeat(42) + '!', 'a'.repeat(42) + ' ']) {
    const r = await tokenReq(tokenForm(client_id, await codeWith(client_id, v), v));
    assert.equal(r.status, 400, `${v.length}`);
    assert.deepEqual(await r.json(), { error: 'invalid_grant', error_description: 'code_verifier must be 43 to 128 unreserved characters' });
  }
  for (const v of ['a'.repeat(43), 'Az09-._~'.repeat(16)]) {
    assert.equal(v.length === 43 || v.length === 128, true);
    const r = await tokenReq(tokenForm(client_id, await codeWith(client_id, v), v));
    assert.equal(r.status, 200, `${v.length}`);
  }
});

test('L19-4 (Review Focus 8): a second exchange of one code is invalid_grant and revokes the token the first gave', async () => {
  const { client_id } = await registerClient({ redirect_uris: [redirect] });
  const code = await codeOf(client_id);
  const first = await tokenReq(tokenForm(client_id, code));
  assert.equal(first.status, 200);
  const { access_token } = (await first.json()) as { access_token: string };
  assert.equal((await mcpWith(access_token)).status, 200);
  const before = (await sql()`SELECT count(*)::int AS n FROM installations`)[0].n as number;
  const again = await tokenReq(tokenForm(client_id, code));
  assert.equal(again.status, 400);
  assert.deepEqual(await again.json(), { error: 'invalid_grant', error_description: 'Code already used; the token it gave is revoked.' });
  assert.equal((await sql()`SELECT count(*)::int AS n FROM installations`)[0].n, before);
  const refused = await mcpWith(access_token);
  assert.equal(refused.status, 401);
  assert.equal(refused.headers.get('www-authenticate'), 'Bearer resource_metadata="https://earnkit.test/.well-known/oauth-protected-resource/mcp"');
  // A third exchange is refused the same way; nothing is restored.
  assert.equal((await tokenReq(tokenForm(client_id, code))).status, 400);
  assert.equal((await mcpWith(access_token)).status, 401);
});

test('L19-4: two parallel exchanges of one code mint at most one live token', async () => {
  const { client_id } = await registerClient({ redirect_uris: [redirect] });
  const code = await codeOf(client_id);
  const rs = await Promise.all([tokenReq(tokenForm(client_id, code)), tokenReq(tokenForm(client_id, code))]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400]);
  const { access_token } = (await rs.find((r) => r.status === 200)!.json()) as { access_token: string };
  // The loser's reuse revoked the winner's token.
  assert.equal(await connectInstallation(access_token), null);
});

test('L19-5: resource and audience', async () => {
  const { resourceOf, sameResource } = await import('./oauth');
  assert.equal(resourceOf('https://earnkit.test'), 'https://earnkit.test/mcp');
  assert.equal(sameResource('https://earnkit.test/mcp/', 'https://earnkit.test'), true);
  assert.equal(sameResource('https://earnkit.test/mcp', 'https://earnkit.test'), true);
  assert.equal(sameResource('https://earnkit.test', 'https://earnkit.test'), false);
  assert.equal(sameResource('https://evil.example/mcp', 'https://earnkit.test'), false);
  const { client_id } = await registerClient({ redirect_uris: [redirect] });
  // Refused at authorize: back to the client with invalid_target, no code.
  const bad = await authorize(params(client_id, { resource: 'https://evil.example' }));
  assert.equal(bad.searchParams.get('error'), 'invalid_target');
  assert.equal(bad.searchParams.get('state'), 'xyz');
  assert.equal(bad.searchParams.get('code'), null);
  // A trailing slash and an absent resource are accepted; the token carries the audience.
  for (const extra of [{ resource: 'https://earnkit.test/mcp/' }, {} as Record<string, string>]) {
    const back = await authorize(params(client_id, extra));
    const code = back.searchParams.get('code');
    assert.ok(code, JSON.stringify(extra));
    const r = await tokenReq(new URLSearchParams({ ...Object.fromEntries(tokenForm(client_id, code)), ...extra }));
    assert.equal(r.status, 200);
    const { access_token } = (await r.json()) as { access_token: string };
    assert.equal((await connectInstallation(access_token))?.audience, 'https://earnkit.test/mcp');
    assert.equal((await mcpWith(access_token)).status, 200);
  }
  // Refused at the token exchange: 400 invalid_target.
  const t = await tokenReq(new URLSearchParams({ ...Object.fromEntries(tokenForm(client_id, await codeOf(client_id))), resource: 'https://evil.example/mcp' }));
  assert.equal(t.status, 400);
  assert.equal(((await t.json()) as { error: string }).error, 'invalid_target');
  // /mcp refuses a token issued for another resource; a null audience (before v6.1.16) is accepted.
  const { saveInstallation } = await import('./installations');
  const other = 'ek_aud_' + Math.random();
  await saveInstallation(other, null, 'https://other.example/mcp');
  const r = await mcpWith(other);
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('www-authenticate'), 'Bearer resource_metadata="https://earnkit.test/.well-known/oauth-protected-resource/mcp"');
  const old = 'ek_aud_null_' + Math.random();
  await saveInstallation(old, null);
  assert.equal((await mcpWith(old)).status, 200);
});

test('L19-8: a client_id is 128 random bits, kept with its URIs; more than 10 redirect URIs are refused', async () => {
  const reg = await registerClient({ redirect_uris: [redirect], client_name: 'Cursor' });
  assert.match(reg.client_id, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual((await registerClient({ redirect_uris: [redirect], client_name: 'Cursor' })).client_id, reg.client_id);
  const [row] = await sql()`SELECT redirect_uris, client_name FROM oauth_clients WHERE client_id = ${reg.client_id}`;
  assert.deepEqual(row, { redirect_uris: [redirect], client_name: 'Cursor' });
  const eleven = Array.from({ length: 11 }, (_, i) => `http://127.0.0.1:${4000 + i}/cb`);
  await assert.rejects(registerClient({ redirect_uris: eleven }), (e) => e instanceof OAuthError && e.code === 'invalid_redirect_uri' && e.message === 'at most 10 redirect_uris');
  const r = await registerPost(new Request('https://earnkit.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.19.8.1' }, body: JSON.stringify({ redirect_uris: eleven }),
  }));
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'invalid_redirect_uri', error_description: 'at most 10 redirect_uris' });
  assert.equal((await registerClient({ redirect_uris: eleven.slice(0, 10) })).redirect_uris.length, 10);
});

test('L19-8: a signed client_id from v6.1.14 still authorizes and installs, under its signed name', async () => {
  const { createHmac } = await import('node:crypto');
  const body = Buffer.from(JSON.stringify({ r: [redirect], n: 'old-nonce-' + Math.random(), cn: 'Old Agent' })).toString('base64url');
  const signed = `${body}.${createHmac('sha256', 'test-secret').update(`client:${body}`).digest('base64url')}`;
  const r = await tokenReq(tokenForm(signed, await codeOf(signed)));
  assert.equal(r.status, 200);
  const { access_token } = (await r.json()) as { access_token: string };
  const caller = await connectInstallation(access_token);
  assert.ok(caller);
  assert.equal((await sql()`SELECT client_name FROM installations WHERE id = ${caller.id}`)[0].client_name, 'Old Agent');
  // A tampered signature is unknown.
  await assert.rejects(authorize(params(`${body}.AAAA`)), (e) => e instanceof OAuthError && e.code === 'invalid_client');
});

test('L19-10: a token or register body that stalls answers 408 within 6 s, with one log line', async () => {
  const stalled = () => new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(new Uint8Array([97])) });
  const req = (path: string, type: string) =>
    new Request(`https://earnkit.test${path}`, { method: 'POST', headers: { 'content-type': type, 'x-real-ip': '10.19.10.1' }, body: stalled(), duplex: 'half' } as RequestInit);
  const logs: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void logs.push(a.join(' '));
  const t0 = Date.now();
  try {
    const rs = await Promise.all([tokenPost(req('/oauth/token', 'application/x-www-form-urlencoded')), registerPost(req('/oauth/register', 'application/json'))]);
    assert.ok(Date.now() - t0 < 6_000);
    for (const r of rs) {
      assert.equal(r.status, 408);
      assert.deepEqual(await r.json(), { error: 'request_timeout', error_description: 'The request body came too slowly.' });
    }
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(logs, ['[http] body read timed out', '[http] body read timed out']);
});

test('v6.1.16 Task 16: a code exchange marks the registered client used, once, so the daily run keeps it', async () => {
  const id = (await registerClient({ redirect_uris: [redirect] })).client_id;
  assert.equal((await sql()`SELECT used_at FROM oauth_clients WHERE client_id = ${id}`)[0].used_at, null);
  await exchangeCode(tokenForm(id, await codeOf(id)));
  const first = (await sql()`SELECT used_at FROM oauth_clients WHERE client_id = ${id}`)[0].used_at as Date;
  assert.ok(first instanceof Date);
  await exchangeCode(tokenForm(id, await codeOf(id)));
  assert.equal(((await sql()`SELECT used_at FROM oauth_clients WHERE client_id = ${id}`)[0].used_at as Date).getTime(), first.getTime());
});

test('L45-16 (v6.1.19): the reserved name is earnkit starting a word: LearnKit, Yearn Kit and Learn Kit Pro register; EarnKit, earn-kit, Earn Kit and x (EarnKit) do not', async () => {
  const { reservedClientName } = await import('./oauth-routes');
  for (const name of ['LearnKit', 'Yearn Kit', 'Learn Kit Pro', 'Learn​Kit', 'Kit Earner', 'Yearnkit'])
    assert.equal(reservedClientName(name), false, name);
  for (const name of ['EarnKit', 'earn-kit', 'Earn Kit', 'x (EarnKit)', 'EarnKitBot', 'My EarnKit', 'e a r n k i t', 'earn­kit', 'earn​kit', 'earn\tkit'])
    assert.equal(reservedClientName(name), true, name);
  let n = 0;
  for (const client_name of ['LearnKit', 'Yearn Kit', 'Learn Kit Pro']) {
    const r = await registerPost(new Request('https://earnkit.test/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': `10.45.16.${++n}` },
      body: JSON.stringify({ redirect_uris: [redirect], client_name }),
    }));
    assert.equal(r.status, 201, client_name);
  }
  const { CIMD_RESERVED } = await import('./oauth');
  assert.equal(CIMD_RESERVED, "Connecting EarnKit failed. Your agent's client document uses EarnKit's own name; it needs the agent's name.");
});
