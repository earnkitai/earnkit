import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from '../v5/db';
import { windowStart } from '../v5/rate-limit';
import { linkInstallation, upsertBuilder } from './builders';
import { githubOAuthFetch } from './fixtures/github-oauth';
import { verifyState } from './github-auth';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { FAILED_PATH, LINK_STATES, callbackGet, consumeLinkCode, createLinkCode, linkDocTitle, linkPost, linkState, shortName } from './link-routes';
import { sessionBuilder } from './sessions';
import LinkView from '../../app/link/[code]/LinkView';

// tsx compiles the components without the automatic JSX runtime, so they need React in scope.
(globalThis as { React?: typeof React }).React = React;

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
/** GET /link/<code> as the page renders it (L27-4, v6.1.16): the state (its status is data) and the view's HTML. */
async function linkGet(r: Request, code: string, o: { now?: Date } = {}) {
  const s = await linkState(code, o.now ?? new Date(), r.headers);
  const html = renderToStaticMarkup(React.createElement(LinkView, { s, code, host: 'earnkit.test' }));
  return { s, status: s.status, html, text: async () => html };
}
/** A refused post or callback: a 303 to a /link page. */
const toPage = (r: Response, path = FAILED_PATH) => {
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), path);
};
const callback = (state: string, cookie: string | undefined, gh = githubOAuthFetch(USER).fetch, now = NOW) =>
  callbackGet(req(`/auth/github/callback?code=gh-code&state=${encodeURIComponent(state)}`, { cookie }), { now, gh });

test('L27-4 (v6.1.16): not set up, the page says so in its h1 and line; a post and the callback land on the failed page', async () => {
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const code = await createLinkCode(await install(), NOW);
  const g = await linkGet(req(`/link/${code}`), code, { now: NOW });
  assert.equal(g.s.state, 'not_set_up');
  assert.equal(g.status, 503);
  assert.match(g.html, /<h1[^>]*>Sign-in is not set up yet\.<\/h1>/);
  assert.ok(g.html.includes(`<p class="text-[16px] leading-[1.6] text-s-muted">${NOT_SET_UP}</p>`));
  toPage(await linkPost(req(`/link/${code}/confirm`, { method: 'POST' }), code, { now: NOW }));
  toPage(await callbackGet(req('/auth/github/callback?code=x&state=y'), { now: NOW }));
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

test('GET /link renders the confirm page: the h1 Connect {agent}?, the agent name, a plain post to /confirm, no script', async () => {
  const code = await createLinkCode(await install('Claude <Code>'), NOW);
  const r = await linkGet(req(`/link/${code}`), code, { now: NOW });
  assert.equal(r.status, 200);
  assert.equal(r.s.state, 'live');
  const html = r.html;
  // L27-26 (v6.1.16): one h1, the agent's name isolated.
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(html, /<h1[^>]*>Connect <bdi>Claude &lt;Code&gt;<\/bdi>\?<\/h1>/);
  assert.equal(r.s.title, 'Connect Claude <Code>?');
  assert.ok(html.includes('Link the agent calling itself <strong><bdi>Claude &lt;Code&gt;</bdi></strong>, first seen Nov 6, to your GitHub account?'), html);
  assert.ok(html.includes(`<form action="/link/${code}/confirm" method="post">`));
  assert.ok(html.includes('Continue with GitHub'));
  assert.ok(html.includes('Once linked, it can read and change your record and apply to programs in your name.'));
  assert.ok(html.includes('After you sign in, you confirm the link on your record page. If you did not ask your agent for this just now, close this page.'));
  assert.ok(!/Only continue|someone sent you/.test(html));
  assert.equal(/<script/i.test(html), false);
  assert.equal(/—/.test(html), false);
  const unnamed = await createLinkCode(await install(), NOW);
  const plain = await (await linkGet(req(`/link/${unnamed}`), unnamed, { now: NOW })).text();
  assert.ok(plain.includes('Link your agent, first seen Nov 6, to your GitHub account?'));
  assert.match(plain, /<h1[^>]*>Connect your agent\?<\/h1>/);
});

test('L27-26 (v6.1.16): a long agent name in the h1 is cut at 40 characters on a whole word; the line keeps it whole', async () => {
  const long = 'An agent with a very long name that someone chose for it';
  assert.equal(shortName(long), 'An agent with a very long name that...');
  assert.ok(shortName(long).length <= 43);
  assert.equal(shortName('Claude Code'), 'Claude Code');
  assert.equal(shortName('x'.repeat(50)), `${'x'.repeat(40)}...`);
  const code = await createLinkCode(await install(long), NOW);
  const r = await linkGet(req(`/link/${code}`), code, { now: NOW });
  assert.equal(r.s.title, `Connect ${shortName(long)}?`);
  assert.equal(linkDocTitle(r.s.title), `Connect ${shortName(long)}? · EarnKit`);
  assert.ok(r.html.includes(`<bdi>${long}</bdi></strong>`));
});

test('the confirm page says where to unlink: the host, then /me', async () => {
  const code = await createLinkCode(await install('Claude'), NOW);
  const html = await (await linkGet(req(`/link/${code}`), code, { now: NOW })).text();
  assert.ok(html.includes('Once linked, it can read and change your record and apply to programs in your name. You can unlink it any time at earnkit.test/me.'), html);
});

test('POST /link sets ek_link and redirects to GitHub with a state whose nonce is the cookie', async () => {
  const code = await createLinkCode(await install(), NOW);
  const r = await linkPost(req(`/link/${code}/confirm`, { method: 'POST' }), code, { now: NOW });
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
  // L27-4 (v6.1.16): a refused post lands on the failed page.
  toPage(nul);
  toPage(cross);
  assert.equal(cross.headers.get('set-cookie'), null);
});

test('an unknown or expired code: the page says so (404 in the data); a post goes back to that page (v6.1.7 S1)', async () => {
  const code = await createLinkCode(await install(), NOW);
  const later = new Date(NOW.getTime() + 16 * MIN);
  // L21-17 (v6.1.16): a code EarnKit never made, code-shaped or not, is not one of ours; one of ours that ended has expired.
  const cases = [['nope', NOW, 'This link is not one of ours.'], ['x'.repeat(500), NOW, 'This link is not one of ours.'], ['x'.repeat(22), NOW, 'This link is not one of ours.'], [code, later, 'This link has expired.']] as const;
  for (const [c, now, title] of cases) {
    const g = await linkGet(req(`/link/${c}`), c, { now });
    assert.equal(g.status, 404);
    assert.equal(g.s.title, title);
    assert.match(g.html, new RegExp(`<h1[^>]*>${title.replace('.', '\\.')}</h1>`));
    toPage(await linkPost(req(`/link/${c}/confirm`, { method: 'POST' }), c, { now }), c.length === 22 ? `/link/${c}` : FAILED_PATH);
  }
  // The expired line is the rest of the one expired wording (L21-17).
  assert.equal(`${LINK_STATES.expired.title} ${LINK_STATES.expired.line}`, EXPIRED);
});

test('L31-6 (v6.1.16 Task 17, controller ruling): in production the sign-in callback sets __Host-ek_me and expires any old ek_me', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const { state, cookie: link } = await start(code);
  const saved = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = 'production';
  try {
    const r = await callback(state, link);
    assert.equal(r.status, 302);
    const set = r.headers.getSetCookie();
    assert.match(set[0], /^__Host-ek_me=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
    assert.ok(set.includes('ek_me=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'), JSON.stringify(set));
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = saved;
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
  // A used code is gone from /link too: the page says Linked. (L27-4, v6.1.16), with no confirm form.
  const used = await linkGet(req(`/link/${code}`), code, { now: NOW });
  assert.equal(used.status, 404);
  assert.equal(used.s.state, 'used');
  assert.match(used.html, /<h1[^>]*>Linked\.<\/h1>/);
  assert.ok(!used.html.includes('<form'));
});

test('a code superseded by a newer one (after it expired) is refused at the callback even with a valid state and nonce', async () => {
  const id = await install();
  const old = await createLinkCode(id, NOW);
  const { state, cookie: link } = await start(old);
  const later = new Date(NOW.getTime() + 16 * MIN);
  assert.notEqual(await createLinkCode(id, later), old);
  toPage(await callback(state, link, undefined, new Date(later.getTime() + 1000)));
  assert.equal((await sql()`SELECT builder_id FROM installations WHERE id = ${id}`)[0].builder_id, null);
});

test('callbackGet without the ek_link cookie, or with another nonce, goes to the failed page and links nothing', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const { state } = await start(code);
  const other = (await start(code)).cookie;
  for (const r of [await callback(state, undefined), await callback(state, 'ek_link=AAAAAAAAAAAAAAAAAAAAAA'), await callback(state, other)]) toPage(r);
  assert.equal(await builderOf(id), null);
  assert.equal((await sql()`SELECT used_at FROM link_codes WHERE installation_id = ${id}`)[0].used_at, null);
});

test('callbackGet: a bad or expired state and a GitHub error go to the failed page; the code stays unused after a GitHub error', async () => {
  const id = await install();
  const code = await createLinkCode(id, NOW);
  const { state, cookie } = await start(code);
  for (const r of [
    await callback('garbage', cookie),
    await callback(state, cookie, githubOAuthFetch(USER).fetch, new Date(NOW.getTime() + 16 * MIN)),
    await callback(state, cookie, githubOAuthFetch(USER, { fail: 'user' }).fetch),
    await callback(state, cookie, githubOAuthFetch(USER, { fail: 'token' }).fetch),
    await callbackGet(req('/auth/github/callback?error=access_denied', { cookie }), { now: NOW }),
  ])
    toPage(r);
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

test('a rate-limited IP: the page says Too many sign-ins. (429 and the wait in the data); a post and the callback go to the failed page', async () => {
  const from = '203.0.113.77';
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${`linkGet:${from}`}, ${windowStart(new Date(), 3_600_000)}, 60)`;
  const code = await createLinkCode(await install(), NOW);
  const g = await linkGet(req(`/link/${code}`, { from }), code, { now: NOW });
  assert.equal(g.status, 429);
  assert.ok(g.s.retryAfter && g.s.retryAfter > 0);
  assert.match(g.html, /<h1[^>]*>Too many sign-ins\.<\/h1>/);
  assert.match(g.s.line, /^Too many sign-ins from this address\. Try again in /);
  for (const r of [
    await linkPost(req(`/link/${code}/confirm`, { from, method: 'POST' }), code, { now: NOW }),
    await callbackGet(req('/auth/github/callback?code=x&state=y', { from }), { now: NOW }),
  ]) {
    toPage(r);
    assert.ok(r.headers.get('retry-after'));
  }
});

test('L27-4 (v6.1.16): every state has one h1 ending in its full stop or ?, its line, a link onward, and the title {h1 without the stop} · EarnKit', async () => {
  const titles = {
    used: 'Linked · EarnKit', expired: 'This link has expired · EarnKit', unknown: 'This link is not one of ours · EarnKit',
    failed: 'Sign-in failed · EarnKit', limited: 'Too many sign-ins · EarnKit', not_set_up: 'Sign-in is not set up yet · EarnKit',
  } as const;
  for (const [k, s] of Object.entries(LINK_STATES)) {
    assert.equal(linkDocTitle(s.title), titles[k as keyof typeof titles], k);
    assert.match(s.title, /[.?]$/, k);
    assert.match(s.line, /\.$/, k);
    const html = renderToStaticMarkup(React.createElement(LinkView, { s, code: 'x', host: 'earnkit.test' }));
    assert.equal((html.match(/<h1/g) ?? []).length, 1, k);
    assert.ok(html.includes(`>${s.title.replace('<', '&lt;')}</h1>`), k);
    assert.ok(html.includes('href="/"') && !html.includes('<form'), k);
  }
  assert.equal(LINK_STATES.failed.line, 'Ask your agent for a new link.');
  assert.equal(`${LINK_STATES.failed.title} ${LINK_STATES.failed.line}`, FAILED);
  // The failed page needs no code.
  const f = await linkState('failed', NOW, req('/link/failed').headers);
  assert.equal(f.state, 'failed');
});

test('codeState (L21-6, L21-17, v6.1.16): live, used, expired, or unknown (malformed or never made)', async () => {
  const { codeState, consumeLinkCode } = await import('./link-routes');
  const { upsertBuilder } = await import('./builders');
  const code = await createLinkCode(await install(), NOW);
  assert.equal(await codeState(code, NOW), 'live');
  assert.equal(await codeState(code, new Date(NOW.getTime() + 16 * MIN)), 'expired');
  assert.equal(await codeState('nope', NOW), 'unknown');
  assert.equal(await codeState('Z'.repeat(22), NOW), 'unknown');
  const b = await upsertBuilder({ github_id: 820_901, login: 'codestate', name: null, avatar_url: null }, NOW);
  assert.equal(await consumeLinkCode(code, b.id, NOW), 'linked');
  assert.equal(await codeState(code, NOW), 'used');
});

test('L25-1 (v6.1.16, fix round 1): the confirm page names "Claude Code (earnkit)" as "Claude Code"', async () => {
  const code = await createLinkCode(await install('Claude Code (earnkit)'), NOW);
  const html = await (await linkGet(req(`/link/${code}`), code, { now: NOW })).text();
  assert.ok(html.includes('Link the agent calling itself <strong><bdi>Claude Code</bdi></strong>, first seen Nov 6, to your GitHub account?'), html);
  assert.match(html, /<h1[^>]*>Connect <bdi>Claude Code<\/bdi>\?<\/h1>/);
  assert.ok(!html.includes('(earnkit)'));
});
