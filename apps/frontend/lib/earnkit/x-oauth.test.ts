import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { X_SCOPES, pkcePair, xAuthorizeUrl, xCallbackUrl, xOAuth, xUserFrom } from './x-oauth';

test('6.1 PKCE S256 and the authorize link carry exactly what X needs', () => {
  process.env.X_CLIENT_ID = 'cid';
  process.env.EARNKIT_URL = 'https://earnkit.com';
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  const u = new URL(xAuthorizeUrl({ state: 's1', challenge }));
  assert.equal(u.origin + u.pathname, 'https://x.com/i/oauth2/authorize');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    response_type: 'code', client_id: 'cid', redirect_uri: 'https://earnkit.com/x/callback', scope: X_SCOPES,
    state: 's1', code_challenge: challenge, code_challenge_method: 'S256',
  });
  assert.notEqual(pkcePair().verifier, verifier, 'a fresh verifier each time');
});

test('6.2 /2/users/me is read strictly: a numeric id, a real handle, an https avatar on X only', () => {
  const ok = { data: { id: '1234', username: 'Lee_Builds', name: 'Lee', profile_image_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' } };
  assert.deepEqual(xUserFrom(ok), { id: '1234', username: 'Lee_Builds', name: 'Lee', avatar: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg', createdAt: null, followers: null });
  assert.equal(xUserFrom({ data: { ...ok.data, id: 'x1' } }), null);
  assert.equal(xUserFrom({ data: { ...ok.data, username: 'bad handle' } }), null);
  assert.equal(xUserFrom({ data: { ...ok.data, profile_image_url: 'https://evil.example.com/a.jpg' } })?.avatar, null);
  assert.equal(xUserFrom({ data: { ...ok.data, profile_image_url: 'http://pbs.twimg.com/a.jpg' } })?.avatar, null);
  assert.equal(xUserFrom(null), null);
  assert.equal(xUserFrom({ data: { ...ok.data, name: '<b>x</b>' } })?.name.includes('<'), false);
  assert.equal(xUserFrom({ data: { ...ok.data, name: '' } })?.name, 'Lee_Builds', 'no name: the handle');
});

test('v3.1 owner people view: the X account age and followers, strictly; anything else is null', () => {
  const base = { id: '1234', username: 'Lee_Builds', name: 'Lee' };
  const u = xUserFrom({ data: { ...base, created_at: '2019-03-04T05:06:07.000Z', public_metrics: { followers_count: 321, following_count: 9 } } });
  assert.equal(u?.createdAt, '2019-03-04T05:06:07.000Z');
  assert.equal(u?.followers, 321);
  assert.equal(xUserFrom({ data: { ...base, public_metrics: { followers_count: 0 } } })?.followers, 0);
  for (const bad of [-1, 1.5, '12', null, 2 ** 31, Number.NaN])
    assert.equal(xUserFrom({ data: { ...base, public_metrics: { followers_count: bad } } })?.followers, null, String(bad));
  assert.equal(xUserFrom({ data: { ...base, public_metrics: 'x' } })?.followers, null);
  assert.equal(xUserFrom({ data: { ...base, public_metrics: null } })?.followers, null);
  for (const bad of ['not a date', 12345, '', null])
    assert.equal(xUserFrom({ data: { ...base, created_at: bad } })?.createdAt, null, String(bad));
});

test('6.2b the token call is Basic-auth with the verifier and the exact redirect; errors carry no code, token or secret', async () => {
  process.env.X_CLIENT_ID = 'cid';
  process.env.X_CLIENT_SECRET = 'sec';
  process.env.EARNKIT_URL = 'https://earnkit.com';
  const real = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  try {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok-1', token_type: 'bearer' }), { status: 200 });
      return new Response(JSON.stringify({ data: { id: '42', username: 'lee', name: 'Lee' } }), { status: 200 });
    }) as typeof fetch;
    assert.equal(await xOAuth.exchange('the-code', 'the-verifier'), 'tok-1');
    const body = new URLSearchParams(String(calls[0].init.body));
    assert.equal(calls[0].url, 'https://api.x.com/2/oauth2/token');
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('cid:sec').toString('base64')}`);
    assert.deepEqual(Object.fromEntries(body), { grant_type: 'authorization_code', code: 'the-code', redirect_uri: xCallbackUrl(), code_verifier: 'the-verifier' });
    assert.deepEqual(await xOAuth.me('tok-1'), { id: '42', username: 'lee', name: 'Lee', avatar: null, createdAt: null, followers: null });
    assert.equal(calls[1].url, 'https://api.x.com/2/users/me?user.fields=profile_image_url,created_at,public_metrics');
    assert.equal((calls[1].init.headers as Record<string, string>).Authorization, 'Bearer tok-1');
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 })) as unknown as typeof fetch;
    await assert.rejects(xOAuth.exchange('the-code', 'the-verifier'), (e: Error) => !/the-code|the-verifier|sec|cid/.test(e.message));
    await assert.rejects(xOAuth.me('tok-1'), (e: Error) => !/tok-1/.test(e.message));
  } finally {
    globalThis.fetch = real;
  }
});
