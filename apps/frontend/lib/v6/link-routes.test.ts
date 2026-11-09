import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from '../v5/db';
import { windowStart } from '../v5/rate-limit';
import { linkInstallation, upsertBuilder } from './builders';
import { githubOAuthFetch } from './fixtures/github-oauth';
import { verifyState } from './github-auth';
import { callbackGet, consumeLinkCode, createLinkCode, linkGet, linkPost } from './link-routes';
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
const req = (path: string, o: { from?: string; method?: string; cookie?: string; origin?: string } = {}) =>
  new Request(`https://earnkit.test${path}`, {
    method: o.method ?? 'GET',
    headers: { 'x-real-ip': o.from ?? `198.51.100.${++ip}`, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.origin ? { origin: o.origin } : {}) },
  });
const install = async (name: string | null = null) =>
  ((await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'link-' + Math.random()}, ${name}, ${NOW}) RETURNING id`)[0].id as number);
const USER = { id: 31337, login: 'grace', name: 'Grace H', avatar_url: null };
const builderOf = async (id: number) => (await sql()`SELECT builder_id FROM installations WHERE id = ${id}`)[0].builder_id as number | null;

/** The confirm button: the state it signed and the ek_link cookie it set. */
async function start(code: string, now = NOW) {
  const r = await linkPost(req(`/link/${code}`, { method: 'POST', origin: 'https://earnkit.test' }), code, { now });
  assert.equal(r.status, 302);
  const state = new URL(r.headers.get('location')!).searchParams.get('state')!;
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return { state, cookie };
}
const callback = (state: string, cookie: string | undefined, gh = githubOAuthFetch(USER).fetch, now = NOW) =>
  callbackGet(req(`/auth/github/callback?code=gh-code&state=${encodeURIComponent(state)}`, { cookie }), { now, gh });

test('linkGet, linkPost and callbackGet answer 503 with the exact sentence when GitHub sign-in is not set up', async () => {
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const code = await createLinkCode(await install(), NOW);
  for (const r of [
    await linkGet(req(`/link/${code}`), code, { now: NOW }),
    await linkPost(req(`/link/${code}`, { method: 'POST' }), code, { now: NOW }),
    await callbackGet(req('/auth/github/callback?code=x&state=y'), { now: NOW }),
  ]) {
    assert.equal(r.status, 503);
    assert.equal(await r.text(), NOT_SET_UP);
    assert.match(r.headers.get('content-type') ?? '', /^text\/plain/);
  }
});

test('createLinkCode stores only the hash and a nonce; a live code is reused; after expiry a new one comes; a linked installation gets none', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  assert.match(code, /^[A-Za-z0-9_-]{22}$/);
  const again = await createLinkCode(id, new Date(NOW.getTime() + MIN));
  assert.equal(again, code);
  const stored = await sql()`SELECT code, nonce FROM link_codes WHERE installation_id = ${id}`;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].code, createHash('sha256').update(code).digest('hex'));
  assert.notEqual(stored[0].nonce, code);
  assert.match(stored[0].nonce, /^[A-Za-z0-9_-]{22}$/);
  assert.equal((await linkGet(req(`/link/${again}`), again, { now: new Date(NOW.getTime() + 2 * MIN) })).status, 200);
  const later = new Date(NOW.getTime() + 16 * MIN);
  const next = await createLinkCode(id, later);
  assert.notEqual(next, code);
  assert.equal((await linkGet(req(`/link/${code}`), code, { now: later })).status, 404);
  assert.equal((await linkGet(req(`/link/${next}`), next, { now: later })).status, 200);
  // A row without a nonce (made before the column) is never reused.
  const old = await install();
  await sql()`INSERT INTO link_codes (code, installation_id, created_at, expires_at) VALUES (${'legacy-' + old}, ${old}, ${NOW}, ${new Date(NOW.getTime() + 10 * MIN)})`;
  const fresh = await createLinkCode(old, NOW);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM link_codes WHERE installation_id = ${old} AND expires_at > ${NOW}`)[0].n, 1);
  assert.equal((await linkGet(req(`/link/${fresh}`), fresh, { now: NOW })).status, 200);
});

test('GET /link renders the confirm page with the agent name and no redirect', async () => {
  const code = await createLinkCode(await install('Claude <Code>'), NOW);
  const r = await linkGet(req(`/link/${code}`), code, { now: NOW });
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('location'), null);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.match(r.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  const html = await r.text();
  assert.ok(html.includes('Link the agent calling itself <strong><bdi>Claude &lt;Code&gt;</bdi></strong>, first seen Nov 6, to your GitHub account?'));
  assert.ok(html.includes('<form method="post">'));
  assert.ok(html.includes('Continue with GitHub'));
  assert.ok(html.includes('Once linked, it can read and change your record and apply to programs in your name.'));
  assert.ok(html.includes('After you sign in, you confirm the link on your record page. Only continue if you asked your agent for this link just now. If someone sent you this link, close this page.'));
  assert.equal(/<script/i.test(html), false);
  assert.equal(/—/.test(html), false);
  const unnamed = await createLinkCode(await install(), NOW);
  const plain = await (await linkGet(req(`/link/${unnamed}`), unnamed, { now: NOW })).text();
  assert.ok(plain.includes('Link your agent, first seen Nov 6, to your GitHub account?'));
});

test('the confirm page names EarnKit first and says where to unlink: the host the request came to, then /me', async () => {
  const code = await createLinkCode(await install('Claude'), NOW);
  const html = await (await linkGet(req(`/link/${code}`), code, { now: NOW })).text();
  assert.ok(html.includes('<p style="color:#9AA0B4;font-size:14px;letter-spacing:0.04em;margin:0 0 8px">EarnKit</p>'), html);
  assert.ok(html.indexOf('>EarnKit<') < html.indexOf('to your GitHub account?'));
  assert.ok(html.includes('Once linked, it can read and change your record and apply to programs in your name. You can unlink it any time at earnkit.test/me.'), html);
});

test('POST /link sets ek_link and redirects to GitHub with a state whose nonce is the cookie', async () => {
  const code = await createLinkCode(await install(), NOW);
  const r = await linkPost(req(`/link/${code}`, { method: 'POST' }), code, { now: NOW });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const cookie = r.headers.get('set-cookie')!;
  assert.match(cookie, /^ek_link=[A-Za-z0-9_-]{22}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=900$/);
  const loc = new URL(r.headers.get('location')!);
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://earnkit.test/auth/github/callback');
  const s = verifyState(loc.searchParams.get('state')!, SECRET, NOW);
  assert.deepEqual(s, { code, nonce: cookie.split(';')[0].slice('ek_link='.length) });
  const cross = await linkPost(req(`/link/${code}`, { method: 'POST', origin: 'https://evil.example' }), code, { now: NOW });
  // A browser sends "Origin: null" from a sandboxed frame or a data: page; the page's own policy keeps the real origin.
  const nul = await linkPost(req(`/link/${code}`, { method: 'POST', origin: 'null' }), code, { now: NOW });
  assert.equal(nul.status, 403);
  assert.equal(cross.status, 403);
  assert.equal(cross.headers.get('set-cookie'), null);
});

test('GET and POST answer 404 for an unknown or expired code; a code EarnKit never makes is not valid (v6.1.7 S1)', async () => {
  const code = await createLinkCode(await install(), NOW);
  const later = new Date(NOW.getTime() + 16 * MIN);
  const cases = [['nope', NOW, 'This link is not valid.'], ['x'.repeat(500), NOW, 'This link is not valid.'], ['x'.repeat(22), NOW, EXPIRED], [code, later, EXPIRED]] as const;
  for (const [c, now, words] of cases) {
    for (const r of [await linkGet(req(`/link/${c}`), c, { now }), await linkPost(req(`/link/${c}`, { method: 'POST' }), c, { now })]) {
      assert.equal(r.status, 404);
      assert.equal(await r.text(), words);
    }
  }
});

test('callbackGet signs in and sends the builder to /me?link=<code>: a session, ek_link cleared, nothing linked, the code unused', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const { state, cookie: link } = await start(code);
  const r = await callback(state, link);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/me?link=${code}`);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const [session, cleared] = r.headers.getSetCookie();
  assert.match(session, /^ek_me=[A-Za-z0-9_-]{43}; /);
  for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(session.includes(part), part);
  assert.equal(cleared, 'ek_link=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');

  const me = await sessionBuilder(session.split(';')[0], NOW);
  assert.equal(me?.login, 'grace');
  assert.equal(await sessionBuilder(`other=1; ${session.split(';')[0]}`, NOW).then((b) => b?.id), me?.id);
  assert.equal(await sessionBuilder(session.split(';')[0], new Date(NOW.getTime() + 31 * 86_400_000)), null);
  assert.equal(await sessionBuilder('ek_me=forged', NOW), null);
  assert.equal(await sessionBuilder(null, NOW), null);

  assert.equal(await builderOf(id), null);
  assert.equal((await sql()`SELECT used_at FROM link_codes WHERE installation_id = ${id}`)[0].used_at, null);
  assert.equal((await linkGet(req(`/link/${code}`), code, { now: NOW })).status, 200);
});

test('consumeLinkCode links once: the code is marked used with the link; a used, unknown or expired code is dead', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const b = await upsertBuilder({ github_id: 515_151, login: 'linker', name: null, avatar_url: null }, NOW);
  assert.equal(await consumeLinkCode(code, b.id, NOW), 'linked');
  assert.equal(await builderOf(id), b.id);
  assert.ok((await sql()`SELECT used_at FROM link_codes WHERE installation_id = ${id}`)[0].used_at);
  const other = await upsertBuilder({ github_id: 515_152, login: 'late', name: null, avatar_url: null }, NOW);
  assert.equal(await consumeLinkCode(code, other.id, NOW), 'dead');
  assert.equal(await builderOf(id), b.id);
  assert.equal(await consumeLinkCode('nope', b.id, NOW), 'dead');
  const stale = await createLinkCode(await install(), NOW);
  assert.equal(await consumeLinkCode(stale, b.id, new Date(NOW.getTime() + 16 * MIN)), 'dead');
  // A used code is gone from /link too.
  const used = await linkGet(req(`/link/${code}`), code, { now: NOW });
  assert.equal(used.status, 404);
  assert.equal(await used.text(), EXPIRED);
});

test('a code superseded by a newer one (after it expired) is refused at the callback even with a valid state and nonce', async () => {
  const id = await install();
  const old = await createLinkCode(id, NOW);
  const { state, cookie: link } = await start(old);
  const later = new Date(NOW.getTime() + 16 * MIN);
  assert.notEqual(await createLinkCode(id, later), old);
  const r = await callback(state, link, undefined, new Date(later.getTime() + 1000));
  assert.equal(r.status, 400);
  assert.equal(await r.text(), FAILED);
  assert.equal((await sql()`SELECT builder_id FROM installations WHERE id = ${id}`)[0].builder_id, null);
});

test('callbackGet without the ek_link cookie, or with another nonce, is 400 and links nothing', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const { state } = await start(code);
  const other = (await start(code)).cookie;
  for (const r of [await callback(state, undefined), await callback(state, 'ek_link=AAAAAAAAAAAAAAAAAAAAAA'), await callback(state, other)]) {
    assert.equal(r.status, 400);
    assert.equal(await r.text(), FAILED);
  }
  assert.equal(await builderOf(id), null);
  assert.equal((await sql()`SELECT used_at FROM link_codes WHERE installation_id = ${id}`)[0].used_at, null);
});

test('callbackGet: a bad or expired state and a GitHub error are 400; the code stays unused after a GitHub error', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const { state, cookie } = await start(code);
  for (const r of [
    await callback('garbage', cookie),
    await callback(state, cookie, githubOAuthFetch(USER).fetch, new Date(NOW.getTime() + 16 * MIN)),
    await callback(state, cookie, githubOAuthFetch(USER, { fail: 'user' }).fetch),
    await callback(state, cookie, githubOAuthFetch(USER, { fail: 'token' }).fetch),
    await callbackGet(req('/auth/github/callback?error=access_denied', { cookie }), { now: NOW }),
  ]) {
    assert.equal(r.status, 400);
    assert.equal(await r.text(), FAILED);
  }
  assert.equal((await sql()`SELECT used_at FROM link_codes WHERE installation_id = ${id}`)[0].used_at, null);
  assert.equal(await builderOf(id), null);
  assert.equal((await callback(state, cookie)).status, 302);
});

test('an installation linked to another account meanwhile: consumeLinkCode answers other and nothing changes', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const first = await upsertBuilder({ github_id: 424_242, login: 'first', name: null, avatar_url: null }, NOW);
  const second = await upsertBuilder({ github_id: 424_243, login: 'second', name: null, avatar_url: null }, NOW);
  await linkInstallation(id, first.id, NOW);
  assert.equal(await consumeLinkCode(code, second.id, NOW), 'other');
  assert.equal(await builderOf(id), first.id);
  assert.equal((await sql()`SELECT used_at FROM link_codes WHERE installation_id = ${id}`)[0].used_at, null);
});

test('a rate-limited IP gets 429 on every route', async () => {
  const from = '203.0.113.77';
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${`linkGet:${from}`}, ${windowStart(new Date(), 3_600_000)}, 60)`;
  const code = await createLinkCode(await install(), NOW);
  for (const r of [
    await linkGet(req(`/link/${code}`, { from }), code, { now: NOW }),
    await linkPost(req(`/link/${code}`, { from, method: 'POST' }), code, { now: NOW }),
    await callbackGet(req('/auth/github/callback?code=x&state=y', { from }), { now: NOW }),
  ]) {
    assert.equal(r.status, 429);
    assert.ok(r.headers.get('retry-after'));
  }
});
