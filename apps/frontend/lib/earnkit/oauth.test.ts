import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  OAuthError,
  authorize,
  HOSTED_REDIRECT_HOSTS,
  clientKeyOf,
  clientLimitKey,
  registrationLimitKey,
  exchangeCode,
  isAllowedRedirectUri,
  isHostedHost,
  isSharedClient,
  originFor,
  registerClient,
  checkAuthorize,
  issueCode,
  redirectClass,
  servesMany,
  authorizationServerMetadata,
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

// ---- v2.8.1 §E17: hosted agent clients and the client limit key.

test('v2.8.1 §E17: hosted clients are flagged by registered name or redirect host', () => {
  // Grok Bot and Muse by name, whatever their redirect.
  for (const client_name of ['Grok', 'Grok Bot', 'grok-connector', 'xAI Grok', 'Muse', 'Meta AI', 'Muse by Meta'])
    assert.equal(isSharedClient({ client_name, redirect_uris: ['https://agent.example/cb'] }), true, client_name);
  // Known hosted redirect hosts and their subdomains.
  for (const uri of [
    'https://grok.com/connectors/callback',
    'https://auth.x.ai/cb',
    'https://www.meta.ai/oauth/cb',
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://GROK.COM./cb',
  ])
    assert.equal(isSharedClient({ redirect_uris: [uri] }), true, uri);
  // Desktop and CLI agents, look-alike hosts and names inside other words are not.
  for (const m of [
    { client_name: 'Claude Code', redirect_uris: ['http://localhost:3334/callback'] },
    { client_name: 'Cursor', redirect_uris: ['cursor://anysphere.cursor-retrieval/oauth/callback'] },
    { client_name: 'Codex', redirect_uris: ['http://127.0.0.1:1455/auth/callback'] },
    { client_name: 'Amused', redirect_uris: ['https://notgrok.com/cb'] },
    { client_name: 'Groky', redirect_uris: ['https://grok.com.evil.example/cb'] },
    { redirect_uris: ['https://evil-claude.ai/cb'] },
  ])
    assert.equal(isSharedClient(m), false, JSON.stringify(m));
  assert.equal(isHostedHost('x.ai'), true);
  assert.equal(isHostedHost('max.ai'), false);
  assert.ok(HOSTED_REDIRECT_HOSTS.includes('grok.com'));
});

test('v2.8.1 §E17: the flag travels in the client id; the code exchange returns it and the client limit key', () => {
  const hosted = registerClient({ redirect_uris: [redirect], client_name: 'Grok' });
  const r = exchangeCode(tokenForm(hosted.client_id, codeOf(hosted.client_id)));
  assert.equal(r.shared, true);
  // Ruling F11: a new installation counts against its own registration, never the redirect host.
  assert.equal(r.limitKey, registrationLimitKey(hosted.client_id));
  // Named Muse with a plain redirect: the name is only known at registration, so the id carries it.
  const muse = registerClient({ redirect_uris: ['https://agent.example/cb'], client_name: 'Muse' });
  const code = new URL(
    authorize(
      new URLSearchParams({
        response_type: 'code',
        client_id: muse.client_id,
        redirect_uri: 'https://agent.example/cb',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
    ),
  ).searchParams.get('code')!;
  const m = exchangeCode(
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'https://agent.example/cb', code_verifier: verifier }),
  );
  assert.equal(m.shared, true);
  assert.equal(m.limitKey, `client:${clientKeyOf(muse.client_id)}`);
  // A pre-v2.8.1 Grok client id (no flag) is still flagged by its redirect host.
  const body = Buffer.from(JSON.stringify({ r: [redirect], n: 'abc' })).toString('base64url');
  const sig = createHmac('sha256', 'test-secret').update(`client:${body}`).digest('base64url');
  const old = `${body}.${sig}`;
  assert.equal(exchangeCode(tokenForm(old, codeOf(old))).shared, true);
});

test('v2.8.1 §E17: clientLimitKey: the https redirect host, else the registration (desktop agents), else none', () => {
  assert.equal(clientLimitKey(['https://Grok.com/cb', 'https://x.ai/cb']), 'host:grok.com');
  assert.equal(clientLimitKey(['http://localhost:3334/cb', 'https://agent.example/cb']), 'host:agent.example');
  assert.equal(clientLimitKey(['http://127.0.0.1:1455/auth/callback']), null);
  assert.equal(clientLimitKey(['cursor://anysphere.cursor-retrieval/oauth/callback'], 'cid'), `client:${clientKeyOf('cid')}`);
});

test('1.1 preflight: every redirect URI the five clients document registers', () => {
  const uris = [
    'https://claude.ai/api/mcp/auth_callback',
    'http://localhost:51234/callback',
    'http://127.0.0.1:51234/callback',
    'http://localhost:8787/callback',
    'https://www.cursor.com/agents/mcp/oauth/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/AbC123xyz',
  ];
  for (const u of uris) {
    assert.equal(isAllowedRedirectUri(u), true, u);
    assert.ok(registerClient({ redirect_uris: [u], client_name: 'preflight' }).client_id, u);
  }
});

test('4.1 redirect classes, who serves many, and the per-X installation key', () => {
  process.env.EARNKIT_AUTH_SECRET ??= 'oauth-test-secret';
  assert.deepEqual(redirectClass('http://127.0.0.1:5000/cb'), { cls: 'loopback', host: null });
  assert.deepEqual(redirectClass('http://localhost:8787/callback'), { cls: 'loopback', host: null });
  assert.deepEqual(redirectClass('cursor://anysphere.cursor-mcp/oauth/callback'), { cls: 'app', host: null });
  assert.deepEqual(redirectClass('https://claude.ai/api/mcp/auth_callback'), { cls: 'agent_host', host: 'claude.ai' });
  assert.deepEqual(redirectClass('https://www.cursor.com/agents/mcp/oauth/callback'), { cls: 'agent_host', host: 'www.cursor.com' });
  assert.deepEqual(redirectClass('https://chatgpt.com/connector_platform_oauth_redirect'), { cls: 'agent_host', host: 'chatgpt.com' });
  // S6 (refined): only the three exact documented callbacks skip the warning page.
  assert.deepEqual(redirectClass('https://chatgpt.com/connector/oauth/abc'), { cls: 'other', host: 'chatgpt.com' });
  assert.deepEqual(redirectClass('https://claude.ai/other/path'), { cls: 'other', host: 'claude.ai' });
  assert.deepEqual(redirectClass('https://claude.ai/api/mcp/auth_callback?x=1'), { cls: 'other', host: 'claude.ai' });
  assert.deepEqual(redirectClass('https://forum.cursor.com/agents/mcp/oauth/callback'), { cls: 'other', host: 'forum.cursor.com' });
  assert.deepEqual(redirectClass('https://cursor.com/agents/mcp/oauth/callback'), { cls: 'other', host: 'cursor.com' });
  assert.deepEqual(redirectClass('https://platform.openai.com/cb'), { cls: 'other', host: 'platform.openai.com' });
  assert.deepEqual(redirectClass('https://evil.example/cb'), { cls: 'other', host: 'evil.example' });
  assert.deepEqual(redirectClass('https://claude.ai.evil.example/cb'), { cls: 'other', host: 'claude.ai.evil.example' });
  assert.equal(servesMany({ r: ['https://grok.com/oauth/cb'] }), true);
  assert.equal(servesMany({ r: ['http://localhost:9/cb'], cn: 'Grok' }), true);
  assert.equal(servesMany({ r: ['https://claude.ai/api/mcp/auth_callback'] }), false, 'A1: a per-user connector');
  assert.equal(servesMany({ r: ['https://chatgpt.com/connector_platform_oauth_redirect'] }), false);
  // A2 and the binding: the code carries the X user, signed; the key is per registration and X account.
  const redirect = 'http://127.0.0.1:5000/cb';
  const clientId = registerClient({ redirect_uris: [redirect], client_name: 'Claude Code' }).client_id;
  const verifier = 'w'.repeat(64);
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, state: 's1', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  const checked = checkAuthorize(params);
  assert.ok(!('error' in checked));
  const user = { id: '777', username: 'lee', name: 'Lee', avatar: null };
  const back = issueCode(checked.req, user, 'https://earnkit.com');
  assert.equal(back.searchParams.get('state'), 's1');
  assert.equal(back.searchParams.get('iss'), 'https://earnkit.com');
  const form = (code: string) => new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier });
  const out = exchangeCode(form(back.searchParams.get('code')!));
  assert.deepEqual(out.x, user);
  assert.equal(out.shared, false);
  assert.equal(out.clientKey, clientKeyOf(`${clientId}\nx:777`));
  const other = exchangeCode(form(issueCode(checked.req, { ...user, id: '778' }).searchParams.get('code')!));
  assert.notEqual(other.clientKey, out.clientKey, 'another X account on the same registration is another installation');
  const anon = exchangeCode(form(issueCode(checked.req, null).searchParams.get('code')!));
  assert.equal(anon.x, null);
  assert.equal(anon.clientKey, clientKeyOf(clientId));
  // A tampered x payload breaks the signature.
  const [body, sig] = back.searchParams.get('code')!.split('.');
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), x: { id: '1', u: 'victim', n: 'V', a: null } })).toString('base64url');
  assert.throws(() => exchangeCode(form(`${edited}.${sig}`)), /invalid or expired/);
  assert.throws(() => checkAuthorize(new URLSearchParams({ ...Object.fromEntries(params), redirect_uri: 'http://127.0.0.1:5001/cb' })), /not registered/);
  assert.equal(authorizationServerMetadata('https://earnkit.com').authorization_response_iss_parameter_supported, true);
  // A1: a claude.ai registration is "shared" by today's host rule, but a token signed in with X is one builder's.
  const claude = 'https://claude.ai/api/mcp/auth_callback';
  const cid = registerClient({ redirect_uris: [claude], client_name: 'Claude' }).client_id;
  const cq = checkAuthorize(new URLSearchParams({ ...Object.fromEntries(params), client_id: cid, redirect_uri: claude }));
  assert.ok(!('error' in cq) && cq.many === false);
  const cform = (code: string) => new URLSearchParams({ grant_type: 'authorization_code', code, client_id: cid, redirect_uri: claude, code_verifier: verifier });
  assert.equal(exchangeCode(cform(issueCode(cq.req, user).searchParams.get('code')!)).shared, false);
  assert.equal(exchangeCode(cform(issueCode(cq.req, null).searchParams.get('code')!)).shared, true, 'anonymous: today\'s rule');
});
