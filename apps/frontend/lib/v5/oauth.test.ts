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
  registrationLimitKey,
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
const hosted = 'https://claude.ai/api/mcp/auth_callback';
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
  const token = (ip: string) => {
    const id = registerClient({ redirect_uris: [hosted] }).client_id;
    return tokenPost(new Request('https://earnkit.test/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip }, body: tokenForm(id, codeOf(id, hosted), verifier, hosted).toString(),
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
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${'oauthRegister:' + ip}, ${start(3_600)}, 50), (${'installHour:' + ip}, ${start(3_600)}, 50)`;
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
  const token = (id: string, uri: string) => tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }, body: tokenForm(id, codeOf(id, uri), verifier, uri).toString(),
  }));
  const a = registerClient({ redirect_uris: [redirect] }).client_id;
  const b = registerClient({ redirect_uris: [hosted] }).client_id;
  const ta = await token(a, redirect);
  const tb = await token(b, hosted);
  assert.equal(ta.status, 429);
  assert.equal(tb.status, 429);
  assert.equal(((await tb.json()) as { error_description: string }).error_description, ((await ta.json()) as { error_description: string }).error_description);
});

test('B5: the hosted tier only raises the per-client install limit', async () => {
  const ip = `10.78.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const id = registerClient({ redirect_uris: [hosted] }).client_id;
  const r = await tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }, body: tokenForm(id, codeOf(id, hosted), verifier, hosted).toString(),
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
