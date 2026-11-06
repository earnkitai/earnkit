import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { windowStart } from '../v5/rate-limit';
import { githubOAuthFetch } from './fixtures/github-oauth';
import { verifyState } from './github-auth';
import { callbackGet, createLinkCode, linkGet } from './link-routes';
import { sessionBuilder } from './sessions';

after(() => sql().end());

const SECRET = 'link-test-secret-0123456789abcdef0123';
const NOW = new Date('2026-11-06T12:00:00Z');
const MIN = 60_000;
const NOT_SET_UP = 'GitHub sign-in is not set up yet.';
const EXPIRED = 'This link has expired. Ask your agent for a new one.';
const FAILED = 'Sign-in failed. Ask your agent for a new link.';
const ENV = { GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh-secret', EARNKIT_AUTH_SECRET: SECRET, EARNKIT_URL: 'https://earnkit.test' };
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

let ip = 10;
const req = (path: string, from = `198.51.100.${++ip}`) => new Request(`https://earnkit.test${path}`, { headers: { 'x-real-ip': from } });
const install = async () =>
  ((await sql()`INSERT INTO installations (token_hash) VALUES (${'link-' + Math.random()}) RETURNING id`)[0].id as number);
const USER = { id: 31337, login: 'grace', name: 'Grace H', avatar_url: null };

/** linkGet, then the state it signed. */
async function start(code: string, now = NOW) {
  const r = await linkGet(req(`/link/${code}`), code, { now });
  assert.equal(r.status, 302);
  return new URL(r.headers.get('location')!).searchParams.get('state')!;
}
const callback = (state: string, gh = githubOAuthFetch(USER).fetch, now = NOW) =>
  callbackGet(req(`/auth/github/callback?code=gh-code&state=${encodeURIComponent(state)}`), { now, gh });

test('linkGet and callbackGet answer 503 with the exact sentence when GitHub sign-in is not set up', async () => {
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const code = await createLinkCode(await install(), NOW);
  for (const r of [await linkGet(req(`/link/${code}`), code, { now: NOW }), await callbackGet(req('/auth/github/callback?code=x&state=y'), { now: NOW })]) {
    assert.equal(r.status, 503);
    assert.equal(await r.text(), NOT_SET_UP);
    assert.match(r.headers.get('content-type') ?? '', /^text\/plain/);
  }
});

test('createLinkCode returns the live code again; a new one after expiry', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  assert.match(code, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await createLinkCode(id, new Date(NOW.getTime() + 10 * MIN)), code);
  assert.notEqual(await createLinkCode(id, new Date(NOW.getTime() + 16 * MIN)), code);
});

test('linkGet redirects to GitHub with a state that verifies to the code', async () => {
  const code = await createLinkCode(await install(), NOW);
  const r = await linkGet(req(`/link/${code}`), code, { now: NOW });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const loc = new URL(r.headers.get('location')!);
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://earnkit.test/auth/github/callback');
  assert.deepEqual(verifyState(loc.searchParams.get('state')!, SECRET, NOW), { code });
});

test('linkGet answers 404 for an unknown or expired code', async () => {
  for (const code of ['nope', 'x'.repeat(500)]) {
    const r = await linkGet(req(`/link/${code}`), code, { now: NOW });
    assert.equal(r.status, 404);
    assert.equal(await r.text(), EXPIRED);
  }
  const code = await createLinkCode(await install(), NOW);
  const r = await linkGet(req(`/link/${code}`), code, { now: new Date(NOW.getTime() + 16 * MIN) });
  assert.equal(r.status, 404);
  assert.equal(await r.text(), EXPIRED);
});

test('callbackGet end to end: linked, a session cookie, /me; a replay is 400 and the code is used', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const state = await start(code);
  const r = await callback(state);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/me');
  const cookie = r.headers.get('set-cookie')!;
  assert.match(cookie, /^ek_me=[A-Za-z0-9_-]{43}; /);
  for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(cookie.includes(part), part);

  const inst = (await sql()`SELECT i.builder_id, b.login FROM installations i JOIN builders b ON b.id = i.builder_id WHERE i.id = ${id}`)[0];
  assert.equal(inst.login, 'grace');
  const me = await sessionBuilder(cookie.split(';')[0], NOW);
  assert.equal(me?.id, inst.builder_id);
  assert.equal(me?.login, 'grace');
  assert.equal(await sessionBuilder(`other=1; ${cookie.split(';')[0]}`, NOW).then((b) => b?.id), inst.builder_id);
  assert.equal(await sessionBuilder(cookie.split(';')[0], new Date(NOW.getTime() + 31 * 86_400_000)), null);
  assert.equal(await sessionBuilder('ek_me=forged', NOW), null);
  assert.equal(await sessionBuilder(null, NOW), null);

  const again = await callback(state);
  assert.equal(again.status, 400);
  assert.equal(await again.text(), FAILED);
  assert.equal(again.headers.get('set-cookie'), null);
  const used = await linkGet(req(`/link/${code}`), code, { now: NOW });
  assert.equal(used.status, 404);
  assert.equal(await used.text(), EXPIRED);
});

test('callbackGet: a bad or expired state and a GitHub error are 400; the code stays unused after a GitHub error', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const state = await start(code);
  for (const r of [
    await callback('garbage'),
    await callback(state, githubOAuthFetch(USER).fetch, new Date(NOW.getTime() + 16 * MIN)),
    await callback(state, githubOAuthFetch(USER, { fail: 'user' }).fetch),
    await callback(state, githubOAuthFetch(USER, { fail: 'token' }).fetch),
    await callbackGet(req('/auth/github/callback?error=access_denied'), { now: NOW }),
  ]) {
    assert.equal(r.status, 400);
    assert.equal(await r.text(), FAILED);
  }
  assert.equal((await sql()`SELECT used_at FROM link_codes WHERE code = ${code}`)[0].used_at, null);
  assert.equal((await sql()`SELECT builder_id FROM installations WHERE id = ${id}`)[0].builder_id, null);
  assert.equal((await callback(state)).status, 302);
});

test('a rate-limited IP gets 429 on both routes', async () => {
  const from = '203.0.113.77';
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${`linkGet:${from}`}, ${windowStart(new Date(), 3_600_000)}, 60)`;
  const code = await createLinkCode(await install(), NOW);
  const a = await linkGet(req(`/link/${code}`, from), code, { now: NOW });
  assert.equal(a.status, 429);
  assert.ok(a.headers.get('retry-after'));
  const b = await callbackGet(req('/auth/github/callback?code=x&state=y', from), { now: NOW });
  assert.equal(b.status, 429);
});
