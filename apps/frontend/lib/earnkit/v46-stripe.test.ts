import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { open, seal } from './secret-box';
import {
  STRIPE_TEXT, checkKey, connectStripe, disconnectStripe, hostMatches, keyKind, missingLine, missingReadLine, mismatchLine,
  stripeFetch, stripeKey, stripeLink, stripePageState, stripePost, type StripeCall,
} from './stripe';
import { upgradeOf, upgradeToken, walletLink, walletPageState } from './wallet-proof';
import { STRIPE_PAGES, StripeAuthError, latestStripe, runStripeRevenue, stripeRevenue } from './stripe';
import { usdRate } from './fx';
import { runCron } from './cron';
import { REVENUE_MIN, shipLogBlock, shipLogFacts, type ShipLogFacts } from './ship-log-facts';
import { replyFacts } from './reply-facts';
import { builderJson } from './builder-json';
import { profileData } from './bench-data';
import { highlights, profileSite } from './site-data';
import { readStats } from './stats';
import { feedWeeks } from './feed';
import { mcpCall } from './fixtures/mcp-call';
import { person as findPerson } from './fixtures/find';
import { committedProgram } from './fixtures/program-file';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { STRIPE_DISCONNECTED, STRIPE_NEVER_KEY, STRIPE_NOT_CONNECTED, STRIPE_NO_LINK, benchStepKey, stateAsk, stripeDraftLine, stripeDraftNote } from './bench-reply';
import { STRIPE_DECLINED_KEY, stripeAskDue } from './stripe';
import { TELL_DESCRIPTION_BENCH } from './mcp';
import { RESERVED_ROUTES } from './reserved-routes';
import StripeForm from '../../app/connect/stripe/StripeForm';

process.env.EARNKIT_AUTH_SECRET = 'test-secret';
// v4.7.3 T1: the Stripe box has its own secret (no fallback to EARNKIT_AUTH_SECRET).
process.env.EARNKIT_STRIPE_SECRET = 'test-stripe-secret';
process.env.EARNKIT_URL = 'https://earnkit.com';
(globalThis as { React?: typeof React }).React = React;
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  // v4.7 T3: the revenue program the draft-time tests made.
  await sql()`DELETE FROM programs WHERE id = ${`v46-st-${process.pid}-ask`}`.catch(() => sql()`UPDATE programs SET status = 'closed' WHERE id = ${`v46-st-${process.pid}-ask`}`);
  await sql().end();
});
const NOW = new Date('2026-10-30T10:00:00Z');
const KEY = 'rk_live_SEEDEDsecretKEY123456';
const hex = () => randomBytes(5).toString('hex');

async function builder(site: string | null): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v46-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle) VALUES (${id}, ${`v46-${id}`}, ${`x${hex()}`}, ${`h${hex()}`})`;
  if (site)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
      VALUES (${id}, 'site', ${site}, ${`k-${id}`}, 'earnkit_txt', 'verified', 'server')`;
  return id;
}
type Over = Partial<Record<string, { status: number; body?: unknown }>>;
const fake = (acct: { id?: string; url?: string | null }, over: Over = {}): StripeCall & { calls: string[] } => {
  const calls: string[] = [];
  const f = (async (path: string, _key: string, method?: string) => {
    // v4.7.1 T3: write probes are recorded and overridden as 'POST /v1/...'; by default a read-only key's 403.
    if (method === 'POST') {
      calls.push(`POST ${path}`);
      const o = over[`POST ${path}`];
      return { status: o?.status ?? 403, body: o?.body ?? { error: { type: 'invalid_request_error' } } };
    }
    calls.push(path);
    const o = over[path.split('?')[0]];
    if (o) return { status: o.status, body: o.body ?? {} };
    if (path === '/v1/account') return { status: 200, body: { id: acct.id ?? `acct_${hex()}`, business_profile: { url: acct.url ?? null } } };
    return { status: 200, body: { data: [] } };
  }) as unknown as StripeCall & { calls: string[] };
  f.calls = calls;
  return f;
};

test('secret-box: round trip; wrong purpose, rotated secret, tampering and junk open to null', () => {
  const s = seal(KEY, 'stripe');
  assert.match(s, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.ok(!s.includes(KEY));
  assert.equal(open(s, 'stripe'), KEY);
  assert.equal(open(s, 'other'), null);
  assert.notEqual(seal(KEY, 'stripe'), s, 'a fresh iv each time');
  assert.equal(open(s.slice(0, -2) + 'AA', 'stripe'), null);
  assert.equal(open('junk', 'stripe'), null);
  // v4.7.3 T1: the stripe box rotates with EARNKIT_STRIPE_SECRET, not EARNKIT_AUTH_SECRET.
  const was = process.env.EARNKIT_STRIPE_SECRET;
  process.env.EARNKIT_STRIPE_SECRET = 'rotated';
  assert.equal(open(s, 'stripe'), null);
  process.env.EARNKIT_STRIPE_SECRET = was;
  assert.equal(open(s, 'stripe'), KEY);
});

test('keyKind and host matching', () => {
  assert.equal(keyKind('rk_live_x'), 'restricted');
  assert.equal(keyKind('sk_live_x'), 'secret');
  assert.equal(keyKind('rk_test_x'), 'test');
  assert.equal(keyKind('sk_test_x'), 'test');
  assert.equal(keyKind('pk_live_x'), 'other');
  assert.equal(keyKind('nope'), 'other');
  assert.ok(hostMatches('app.example.com', ['example.com']));
  assert.ok(hostMatches('example.com', ['app.example.com']));
  assert.ok(hostMatches('example.com', ['example.com']));
  assert.ok(!hostMatches('bar.com', ['foo.com']));
  assert.ok(!hostMatches('alice.up.railway.app', ['bob.up.railway.app']));
  assert.ok(!hostMatches('bar.co.uk', ['foo.co.uk']));
  assert.ok(!hostMatches('y.com.cn', ['x.com.cn']));
  assert.ok(!hostMatches('up.railway.app', ['alice.vercel.app']));
  assert.ok(!hostMatches('vercel.app', ['alice.vercel.app']), 'a shared suffix is never a parent');
  assert.ok(!hostMatches('up.railway.app', ['alice.up.railway.app']));
  assert.ok(!hostMatches('com', ['example.com']), 'a bare label is never a parent');
  assert.ok(!hostMatches('x.com', []));
});

test('checkKey: ok; subdomain match; each missing permission; site mismatch; no website; 401; unreachable', dbTest, async () => {
  const id = await builder('https://www.myapp.com');
  const ok = await checkKey(id, KEY, fake({ id: 'acct_AAA', url: 'https://myapp.com/pricing' }));
  assert.deepEqual(ok, { ok: true, accountId: 'acct_AAA', host: 'myapp.com' });
  const sub = await checkKey(id, KEY, fake({ url: 'https://billing.myapp.com' }));
  assert.equal(sub.ok, true);
  const c = fake({ url: 'https://myapp.com' });
  await checkKey(id, KEY, c);
  assert.deepEqual(c.calls, ['/v1/account', '/v1/balance_transactions?limit=1', '/v1/charges?limit=1', '/v1/subscriptions?limit=1', 'POST /v1/refunds', 'POST /v1/payouts', 'POST /v1/transfers']);
  for (const [path, line] of [['/v1/account', missingReadLine('account')], ['/v1/balance_transactions', missingReadLine('balance')], ['/v1/charges', missingLine('Charges')], ['/v1/subscriptions', missingLine('Subscriptions')]] as const)
    assert.deepEqual(await checkKey(id, KEY, fake({ url: 'https://myapp.com' }, { [path]: { status: 403 } })), { ok: false, line });
  // v4.7.1 T3 fix 1: no invented permission label in builder copy.
  assert.equal(missingReadLine('balance'), "This key can't read your balance. Give it read access only, then paste it again.");
  const m = fake({ url: 'https://friend.io' });
  assert.deepEqual(await checkKey(id, KEY, m), { ok: false, line: mismatchLine('friend.io') });
  assert.deepEqual(m.calls, ['/v1/account'], 'no more reads once ownership fails');
  assert.deepEqual(await checkKey(id, KEY, fake({ url: null })), { ok: false, line: STRIPE_TEXT.noSite });
  assert.deepEqual(await checkKey(id, KEY, fake({ url: 'https://myapp.com' }, { '/v1/account': { status: 401 } })), { ok: false, line: STRIPE_TEXT.rejected });
  const boom: StripeCall = async () => { throw new Error(`down ${KEY}`); };
  assert.deepEqual(await checkKey(id, KEY, boom), { ok: false, line: STRIPE_TEXT.unreachable });
  assert.equal((await checkKey(await builder(null), KEY, fake({ url: 'https://myapp.com' }))).ok, false, 'no verified site, no match');
  assert.equal(mismatchLine('friend.io'), "Stripe lists friend.io as this account's website, which isn't one of your projects. Set your project's site in Stripe, Settings, Business details, then paste again.");
});

test('v4.7.1 T3: write access is refused (400 on any probe); read-only (403 on all three) passes; any other answer fails closed and stores nothing', dbTest, async () => {
  const id = await builder('https://probe.example.com');
  const url = 'https://probe.example.com';
  const write = 'This key can change your Stripe account. Make a restricted key with read access only, then paste it here.';
  assert.equal(STRIPE_TEXT.writeAccess, write);
  // Read-only: all three probes 403, accepted; the probes are exactly three bodiless POSTs, after the reads.
  const seen: [string, string | undefined][] = [];
  const base = fake({ url });
  const spy: StripeCall = async (...a) => { seen.push([a[0], a[2]]); return base(...a); };
  assert.equal((await checkKey(id, KEY, spy)).ok, true);
  assert.deepEqual(seen.filter((s) => s[1] === 'POST').map((s) => s[0]), ['/v1/refunds', '/v1/payouts', '/v1/transfers']);
  assert.ok(seen.filter((s) => s[1] !== 'POST').every((s) => s[1] === undefined || s[1] === 'GET'), 'reads stay GETs');
  // Write access on refunds, on payouts only, on transfers only (final review), or on all: refused with the exact copy.
  for (const over of [{ 'POST /v1/refunds': { status: 400 } }, { 'POST /v1/payouts': { status: 400 } }, { 'POST /v1/transfers': { status: 400 } },
    { 'POST /v1/refunds': { status: 400 }, 'POST /v1/payouts': { status: 400 }, 'POST /v1/transfers': { status: 400 } }])
    assert.deepEqual(await checkKey(id, KEY, fake({ url }, over)), { ok: false, line: write }, JSON.stringify(over));
  // Any other status, or a thrown probe, fails closed with the generic copy.
  for (const status of [500, 200, 401, 429])
    for (const path of ['POST /v1/refunds', 'POST /v1/payouts', 'POST /v1/transfers'])
      assert.deepEqual(await checkKey(id, KEY, fake({ url }, { [path]: { status } })), { ok: false, line: STRIPE_TEXT.unreachable }, `${path} ${status}`);
  const probeBoom = (which: string): StripeCall => async (path, key, method) => {
    if (method === 'POST' && path === which) throw new Error(`timeout ${key}`);
    return fake({ url })(path, key, method);
  };
  for (const which of ['/v1/refunds', '/v1/payouts', '/v1/transfers']) assert.deepEqual(await checkKey(id, KEY, probeBoom(which)), { ok: false, line: STRIPE_TEXT.unreachable });
  // Nothing stored on any refusal (connectStripe path), and the probes never run before the ownership check.
  const t = upgradeToken(id, NOW, undefined, 'stripe')!;
  assert.deepEqual(await connectStripe(t, KEY, NOW, fake({ url }, { 'POST /v1/payouts': { status: 400 } })), { ok: false, line: write });
  // Final review: a key whose only write is transfers is refused, nothing stored.
  assert.deepEqual(await connectStripe(t, KEY, NOW, fake({ url }, { 'POST /v1/transfers': { status: 400 } })), { ok: false, line: write });
  assert.deepEqual(await connectStripe(t, KEY, NOW, fake({ url }, { 'POST /v1/refunds': { status: 500 } })), { ok: false, line: STRIPE_TEXT.unreachable });
  assert.deepEqual(await connectStripe(t, KEY, NOW, probeBoom('/v1/payouts')), { ok: false, line: STRIPE_TEXT.unreachable });
  assert.equal((await sql()`SELECT 1 FROM stripe_connections WHERE builder_id = ${id}`).length, 0, 'nothing stored');
  const m = fake({ url: 'https://friend.io' });
  await checkKey(id, KEY, m);
  assert.ok(!m.calls.some((c) => c.startsWith('POST')), 'no probe once ownership fails');
  // A read-only key then connects.
  assert.equal((await connectStripe(t, KEY, NOW, fake({ url }))).ok, true);
});

test('v4.7.1 T3: stripeFetch POST is bodiless and form-encoded; GET is unchanged; no redirects; the key only as a bearer', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ error: {} }), { status: 403 });
  }) as typeof fetch;
  try {
    assert.equal((await stripeFetch('/v1/refunds', KEY, 'POST')).status, 403);
    assert.equal((await stripeFetch('/v1/charges?limit=1', KEY)).status, 403);
  } finally {
    globalThis.fetch = orig;
  }
  const [post, get] = seen;
  assert.equal(post.url, 'https://api.stripe.com/v1/refunds');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.body, '');
  assert.equal(post.init.redirect, 'error');
  assert.deepEqual(post.init.headers, { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(get.url, 'https://api.stripe.com/v1/charges?limit=1');
  assert.equal(get.init.method, 'GET');
  assert.equal(get.init.body, undefined);
  assert.equal(get.init.redirect, 'error');
  assert.deepEqual(get.init.headers, { Authorization: `Bearer ${KEY}` });
});

test('connect stores the key sealed; sk_live_ and test keys are never stored; a mismatch stores nothing; disconnect deletes', dbTest, async () => {
  const id = await builder('https://store.example.com');
  const t = upgradeToken(id, NOW, undefined, 'stripe')!;
  const acct = `acct_${hex()}`;
  const call = fake({ id: acct, url: 'https://store.example.com' });
  const r = await connectStripe(t, KEY, NOW, call);
  assert.deepEqual(r, { ok: true, line: STRIPE_TEXT.saved });
  const [row] = await sql()<{ sealed_key: string; account_id: string; site_host: string; state: string }[]>`SELECT * FROM stripe_connections WHERE builder_id = ${id}`;
  assert.notEqual(row.sealed_key, KEY);
  assert.ok(!row.sealed_key.includes(KEY));
  assert.equal(row.account_id, acct);
  assert.equal(row.site_host, 'store.example.com');
  assert.equal(await stripeKey(id), KEY);
  // The whole table, as text, never holds a key (Review Focus 4).
  const dump = JSON.stringify(await sql()`SELECT * FROM stripe_connections`);
  assert.ok(!dump.includes('rk_live_SEEDED'));
  // Pasting again replaces the key and clears 'broken'.
  await sql()`UPDATE stripe_connections SET state = 'broken', broken_at = now() WHERE builder_id = ${id}`;
  // v4.7.3 T1: a link connects once, so each later paste is on a new link.
  assert.deepEqual(await connectStripe(t, KEY + 'B', NOW, call), { ok: false, line: STRIPE_TEXT.used });
  assert.equal((await connectStripe(upgradeToken(id, NOW, undefined, 'stripe')!, KEY + 'B', NOW, call)).ok, true);
  const [again] = await sql()`SELECT state, broken_at FROM stripe_connections WHERE builder_id = ${id}`;
  assert.deepEqual([again.state, again.broken_at], ['ok', null]);
  // Key rotation for the same account updates the sealed key; a different account never replaces the connection.
  const [before] = await sql()<{ sealed_key: string }[]>`SELECT sealed_key FROM stripe_connections WHERE builder_id = ${id}`;
  assert.equal(await stripeKey(id), KEY + 'B');
  const swap = await connectStripe(upgradeToken(id, NOW, undefined, 'stripe')!, KEY + 'C', NOW, fake({ id: `acct_${hex()}`, url: 'https://store.example.com' }));
  assert.deepEqual(swap, { ok: false, line: 'Stripe is already connected. Ask your agent to disconnect it first, then use a new link.' });
  const [after_] = await sql()<{ sealed_key: string; account_id: string }[]>`SELECT sealed_key, account_id FROM stripe_connections WHERE builder_id = ${id}`;
  assert.deepEqual([after_.sealed_key, after_.account_id], [before.sealed_key, acct], 'the old row is untouched');
  // Another builder on the same account is refused.
  const other = await builder('https://store.example.com');
  const r2 = await connectStripe(upgradeToken(other, NOW, undefined, 'stripe')!, KEY, NOW, call);
  assert.deepEqual(r2, { ok: false, line: STRIPE_TEXT.taken });
  assert.equal((await sql()`SELECT 1 FROM stripe_connections WHERE builder_id = ${other}`).length, 0);
  // sk_live_, test and junk keys: refused, no Stripe call, nothing stored.
  const c2 = fake({ url: 'https://store.example.com' });
  const b2 = await builder('https://store.example.com');
  const t2 = upgradeToken(b2, NOW, undefined, 'stripe')!;
  assert.deepEqual(await connectStripe(t2, 'sk_live_ABCDEF', NOW, c2), { ok: false, line: STRIPE_TEXT.secretKey });
  assert.deepEqual(await connectStripe(t2, 'rk_test_ABCDEF', NOW, c2), { ok: false, line: STRIPE_TEXT.testKey });
  assert.deepEqual(await connectStripe(t2, 'sk_test_ABCDEF', NOW, c2), { ok: false, line: STRIPE_TEXT.testKey });
  assert.equal((await connectStripe(t2, 'pk_live_ABCDEF', NOW, c2)).ok, false);
  assert.equal(c2.calls.length, 0);
  assert.equal((await sql()`SELECT 1 FROM stripe_connections WHERE builder_id = ${b2}`).length, 0);
  // A site mismatch stores nothing.
  assert.equal((await connectStripe(t2, KEY, NOW, fake({ url: 'https://friend.io' }))).ok, false);
  assert.equal((await sql()`SELECT 1 FROM stripe_connections WHERE builder_id = ${b2}`).length, 0);
  // Expired link.
  assert.deepEqual(await connectStripe(t2, KEY, new Date(NOW.getTime() + 31 * 60_000), c2), { ok: false, line: STRIPE_TEXT.expired });
  // Disconnect.
  assert.equal(await disconnectStripe(id), true);
  assert.equal(await stripeKey(id), null);
  assert.equal(await disconnectStripe(id), false);
});

test('two concurrent pastes for different accounts: exactly one wins and the other is told it is already connected', dbTest, async () => {
  const id = await builder('https://race.example.com');
  const t = upgradeToken(id, NOW, undefined, 'stripe')!;
  const a1 = `acct_${hex()}`;
  const a2 = `acct_${hex()}`;
  const slow = (acct: string): StripeCall => async (path, _key, method) => {
    await new Promise((r) => setTimeout(r, 20));
    if (method === 'POST') return { status: 403, body: {} };
    return path === '/v1/account' ? { status: 200, body: { id: acct, business_profile: { url: 'https://race.example.com' } } } : { status: 200, body: { data: [] } };
  };
  const rs = await Promise.all([connectStripe(t, KEY + 'R1', NOW, slow(a1)), connectStripe(t, KEY + 'R2', NOW, slow(a2))]);
  assert.equal(rs.filter((r) => r.ok).length, 1);
  const lost = rs.find((r) => !r.ok)!;
  assert.equal(lost.line, STRIPE_TEXT.alreadyConnected);
  const winner = rs[0].ok ? [a1, KEY + 'R1'] : [a2, KEY + 'R2'];
  const [row] = await sql()<{ account_id: string }[]>`SELECT account_id FROM stripe_connections WHERE builder_id = ${id}`;
  assert.equal(row.account_id, winner[0]);
  assert.equal(await stripeKey(id), winner[1], 'the stored key is the winner\'s');
});

test('purpose-bound links: a wallet link never opens the Stripe page and a Stripe link never opens the wallet page', dbTest, async () => {
  const id = await builder(null);
  const st = upgradeToken(id, NOW, undefined, 'stripe')!;
  const wt = upgradeToken(id, NOW)!;
  assert.equal(upgradeOf(st, NOW, undefined, 'stripe'), id);
  assert.equal(upgradeOf(st, NOW), null);
  assert.equal(upgradeOf(wt, NOW, undefined, 'stripe'), null);
  const noLimit = async () => {};
  assert.deepEqual(await stripePageState(wt, NOW, { limit: noLimit }), { kind: 'gone', line: STRIPE_TEXT.expired });
  assert.equal((await walletPageState(st, NOW, { limit: noLimit })).kind, 'gone');
  assert.equal((await stripePageState(st, NOW, { limit: noLimit })).kind, 'connect');
  assert.equal((await walletPageState(wt, NOW, { limit: noLimit })).kind, 'sign');
  assert.deepEqual(await connectStripe(wt, KEY, NOW, fake({})), { ok: false, line: STRIPE_TEXT.expired });
  assert.match(stripeLink(id, new Date())!, /^https:\/\/earnkit\.com\/connect\/stripe\?t=/);
  assert.match(walletLink(id, new Date())!, /\/claim\/wallet\?t=/);
  assert.equal((await stripePageState('junk', NOW, { limit: noLimit })).kind, 'gone');
});

test('route: origin, no or expired token, bad body, a rate limit; the key never appears in a response, error or log', dbTest, async () => {
  const logs: string[] = [];
  const orig = [console.error, console.log, console.warn];
  console.error = console.log = console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  try {
    const id = await builder('https://route.example.com');
    const now = new Date();
    const t = upgradeToken(id, now, undefined, 'stripe')!;
    const ip = `10.46.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
    const post = (body: unknown, o: { origin?: string; ip?: string; call?: StripeCall } = {}) =>
      stripePost(
        new Request('https://earnkit.com/connect/stripe/key', { method: 'POST', headers: { 'content-type': 'application/json', origin: o.origin ?? 'https://earnkit.com', 'x-real-ip': o.ip ?? ip }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
        { now, call: o.call },
      );
    const outs: string[] = [];
    const grab = async (r: Response) => { const text = await r.text(); outs.push(text); return { status: r.status, body: JSON.parse(text) as { ok: boolean; line: string } }; };
    assert.equal((await post({ t, key: KEY }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await grab(await post({ key: KEY }))).status, 400);
    assert.equal((await grab(await post('garbage' + KEY))).body.line, STRIPE_TEXT.expired);
    const old = upgradeToken(id, new Date(now.getTime() - 31 * 60_000), undefined, 'stripe')!;
    assert.deepEqual((await grab(await post({ t: old, key: KEY }))).body, { ok: false, line: STRIPE_TEXT.expired });
    assert.deepEqual((await grab(await post({ t: upgradeToken(id, now)!, key: KEY }))).body, { ok: false, line: STRIPE_TEXT.expired });
    // A throwing Stripe call that carries the key in its message.
    const boom: StripeCall = async () => { throw new Error(`boom ${KEY}`); };
    const r1 = await grab(await post({ t, key: KEY }, { call: boom }));
    assert.deepEqual(r1.body, { ok: false, line: STRIPE_TEXT.unreachable });
    const ok = await grab(await post({ t, key: KEY }, { call: fake({ url: 'https://route.example.com' }) }));
    assert.deepEqual([ok.status, ok.body], [200, { ok: true, line: STRIPE_TEXT.saved }]);
    // v4.7.3 T1: the used link refuses before the key is looked at; a new link refuses the full secret key.
    assert.equal((await grab(await post({ t, key: 'sk_live_SEEDEDfullSECRET' }))).body.line, STRIPE_TEXT.used);
    const sk = await grab(await post({ t: upgradeToken(id, now, undefined, 'stripe')!, key: 'sk_live_SEEDEDfullSECRET' }));
    assert.equal(sk.body.line, STRIPE_TEXT.secretKey);
    for (const o of outs) assert.ok(!o.includes('SEEDED'), 'no response holds the key');
    assert.ok(!logs.join('\n').includes('SEEDED'), 'no log holds the key');
    const [ev] = await sql()`SELECT count(*)::int AS n FROM builder_events WHERE installation_id = ${id}`;
    assert.equal(ev.n, 0, 'no event is written');
    // The rate limit: the 11th try from one IP is busy.
    const ip2 = `10.47.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post({ t: 'x', key: KEY }, { ip: ip2 })).status;
    assert.equal(last, 429);
  } finally {
    [console.error, console.log, console.warn] = orig;
  }
});

test('page and form: the exact copy, a masked text field, the key goes nowhere but the POST', () => {
  const html = renderToStaticMarkup(React.createElement(StripeForm, { token: 'tok', text: STRIPE_TEXT }));
  assert.ok(html.includes('Connect Stripe, read-only'));
  for (const s of STRIPE_TEXT.steps) assert.ok(html.includes(s.replace(/'/g, '&#x27;')) || html.includes(s));
  // v4.7.3 T1: a password field (no text-security style); the password-manager ignore attributes stay.
  assert.ok(html.includes('type="password"') && !html.includes('type="text"') && !html.toLowerCase().includes('text-security'));
  for (const a of ['data-1p-ignore', 'data-lpignore="true"', 'autoComplete="off"', 'spellCheck="false"'])
    assert.ok(html.toLowerCase().includes(a.toLowerCase()), a);
  const all = JSON.stringify(STRIPE_TEXT);
  assert.ok(!/[—–]/.test(all) && !/coin|points/i.test(all), 'no em dashes, no coin, no points');
  assert.deepEqual(STRIPE_TEXT.steps[1], 'Give it read access only. Leave every Write permission off.');
  assert.equal(STRIPE_TEXT.saved, 'Connected. Your next grant draft shows your Stripe revenue once it reaches $100 in 30 days.');
  assert.ok(RESERVED_ROUTES.has('connect'));
});

// ---------------------------------------------------------------------------------------------- Task 2: the daily Stripe read
const DAYMS = 86_400_000;
const rate1 = async (c: string) => (c === 'usd' ? 1 : c === 'eur' ? 1.1 : null);
type Bt = { id: string; type: string; reporting_category?: string; amount: number; currency?: string };
type Ch = { id: string; amount: number; status?: string; refunded?: boolean; currency?: string; balance_transaction: string; customer?: string | null; email?: string | null; fp?: string | null; ar?: number };
type Sub = { status?: string; customer?: string; discount?: object | null; discounts?: object[]; items: { quantity?: number; unit_amount: number | null; interval: string; interval_count?: number; currency?: string }[] };
const bt = (id: string, type: string, amount: number, extra: Partial<Bt> = {}): Bt => ({ id, type, amount, currency: 'usd', ...extra });
const chg = (n: number, amount: number, o: Partial<Ch> = {}): Ch => ({ id: `ch_${n}`, amount, balance_transaction: `bt_c${n}`, customer: `cus_${n}`, ...o });
/** A paginating Stripe fake: honors limit and starting_after; `fail` lets a path answer a status or throw. */
function stripeFake(d: { bts?: Bt[]; charges?: Ch[]; subs?: Sub[]; fail?: Record<string, number | 'throw'> }) {
  const calls: string[] = [];
  const f = (async (path: string, key: string, method?: string) => {
    calls.push(method === 'POST' ? `POST ${path}` : path);
    const [p, qs] = path.split('?');
    const q = new URLSearchParams(qs);
    const fail = d.fail?.[p];
    if (fail === 'throw') throw new Error(`boom with ${key}`);
    if (typeof fail === 'number') return { status: fail, body: { error: { message: `bad ${key}` } } };
    const page = <T extends { id?: string }>(all: T[]) => {
      const after = q.get('starting_after');
      const from = after ? all.findIndex((x) => x.id === after) + 1 : 0;
      const slice = all.slice(from, from + Number(q.get('limit') ?? 10));
      return { status: 200, body: { data: slice, has_more: from + slice.length < all.length } };
    };
    if (p === '/v1/balance_transactions') return page(d.bts ?? []);
    if (p === '/v1/charges')
      return page((d.charges ?? []).map((c) => ({
        id: c.id, amount: c.amount, status: c.status ?? 'succeeded', refunded: c.refunded ?? false, amount_refunded: c.ar ?? 0, currency: c.currency ?? 'usd', balance_transaction: c.balance_transaction,
        customer: c.customer ?? null, billing_details: { email: c.email ?? null }, payment_method_details: { card: { fingerprint: c.fp ?? null } },
      })));
    if (p === '/v1/subscriptions')
      return page((d.subs ?? []).map((s, i) => ({
        id: `sub_${i}`, status: s.status ?? 'active', customer: s.customer ?? 'cus_1', discount: s.discount ?? null, discounts: s.discounts ?? [],
        items: { data: s.items.map((it) => ({ quantity: it.quantity ?? 1, price: { unit_amount: it.unit_amount, currency: it.currency ?? 'usd', recurring: { interval: it.interval, interval_count: it.interval_count ?? 1 } } })) },
      })));
    return { status: 200, body: { id: 'acct_x', business_profile: { url: null } } };
  }) as StripeCall & { calls: string[] };
  f.calls = calls;
  return f;
}
const five = (): Ch[] => [1, 2, 3, 4, 5].map((n) => chg(n, 20_000));
const fiveBts = (): Bt[] => [1, 2, 3, 4, 5].map((n) => bt(`bt_c${n}`, 'charge', 20_000));

test('stripeRevenue: charges minus refunds minus a dispute, a reversal back in; fees are not subtracted; window and paging params', dbTest, async () => {
  const call = stripeFake({
    bts: [...fiveBts(), bt('r1', 'refund', -3_000), bt('r2', 'payment_refund', -1_000), bt('d1', 'adjustment', -5_000, { reporting_category: 'dispute' }),
      bt('d2', 'adjustment', 5_000, { reporting_category: 'dispute_reversal' }), bt('d3', 'adjustment', -2_000, { reporting_category: 'dispute' }),
      bt('p', 'payout', -50_000), bt('f', 'stripe_fee', -500), bt('a', 'adjustment', 700, { reporting_category: 'other_adjustment' }), bt('pm', 'payment', 4_000)],
    charges: five(),
  });
  const r = await stripeRevenue(KEY, NOW, call, rate1);
  // 5 x 200 + 40 payment - 30 - 10 - 50 + 50 - 20 = 980
  assert.deepEqual(r, { net_usd: 980, mrr_usd: 0, payers: 5, top_share: 0.2, capped: false });
  const first = call.calls[0];
  assert.match(first, /^\/v1\/balance_transactions\?/);
  assert.match(first, /limit=100/);
  assert.match(first, new RegExp(`created%5Bgte%5D=${Math.floor(NOW.getTime() / 1000) - 30 * 86_400}|created\\[gte\\]=${Math.floor(NOW.getTime() / 1000) - 30 * 86_400}`));
  assert.ok(call.calls.every((c) => c.startsWith('/v1/')), 'v4.7.1 T3: only GETs, no write probe in the daily read');
});

test('stripeRevenue: a net below zero is clamped at 0; EUR converts at the rate; no rate stores nothing', dbTest, async () => {
  const neg = await stripeRevenue(KEY, NOW, stripeFake({ bts: [bt('r', 'refund', -9_000)], charges: [] }), rate1);
  assert.equal(neg?.net_usd, 0);
  const eur = stripeFake({ bts: [1, 2, 3].map((n) => bt(`bt_c${n}`, 'charge', 10_000, { currency: 'eur' })), charges: [1, 2, 3].map((n) => chg(n, 10_000, { currency: 'eur' })) });
  assert.equal((await stripeRevenue(KEY, NOW, eur, rate1))?.net_usd, 330);
  const gbp = stripeFake({ bts: [bt('x', 'charge', 10_000, { currency: 'gbp' })], charges: [] });
  assert.equal(await stripeRevenue(KEY, NOW, gbp, rate1), null);
});

test('stripeRevenue: MRR for monthly, yearly, weekly; trialing, canceled and past_due do not count; quantity; metered skipped', dbTest, async () => {
  const subs: Sub[] = [
    { items: [{ unit_amount: 2_000, interval: 'month' }] }, // 20
    { items: [{ unit_amount: 12_000, interval: 'year' }] }, // 10
    { items: [{ unit_amount: 100, interval: 'week', quantity: 3 }] }, // 3 * 52 / 12 = 13
    { status: 'trialing', items: [{ unit_amount: 9_900, interval: 'month' }] },
    { status: 'canceled', items: [{ unit_amount: 9_900, interval: 'month' }] },
    { status: 'past_due', items: [{ unit_amount: 9_900, interval: 'month' }] },
    { items: [{ unit_amount: null, interval: 'month' }] },
  ];
  const r = await stripeRevenue(KEY, NOW, stripeFake({ subs, bts: fiveBts(), charges: five() }), rate1);
  assert.equal(r?.mrr_usd, 43);
});

test('stripeRevenue: payer rules, shown in the row; own digest email dropped with its balance transaction', dbTest, async () => {
  const two = await stripeRevenue(KEY, NOW, stripeFake({ bts: [bt('bt_c1', 'charge', 20_000), bt('bt_c2', 'charge', 20_000)], charges: [chg(1, 20_000), chg(2, 20_000)] }), rate1);
  assert.equal(two?.payers, 2);
  const top = await stripeRevenue(KEY, NOW, stripeFake({
    bts: [bt('bt_c1', 'charge', 70_000), ...[2, 3, 4].map((n) => bt(`bt_c${n}`, 'charge', 10_000))], charges: [chg(1, 70_000), ...[2, 3, 4].map((n) => chg(n, 10_000))],
  }), rate1);
  assert.deepEqual([top?.payers, top?.top_share], [4, 0.7]);
  // The same payer via fingerprint (two customers), a refunded-in-full charge and a failed one are not payers.
  const fp = await stripeRevenue(KEY, NOW, stripeFake({
    bts: fiveBts(), charges: [chg(1, 20_000, { fp: 'f1' }), chg(2, 20_000, { fp: 'f1', customer: 'cus_other' }), chg(3, 20_000, { refunded: true }), chg(4, 20_000, { status: 'failed' }), chg(5, 20_000)],
  }), rate1);
  assert.equal(fp?.payers, 2);
  const mail = await stripeRevenue(KEY, NOW, stripeFake({
    bts: [...fiveBts(), bt('bt_cme', 'charge', 20_000)], charges: [...five(), chg(9, 20_000, { balance_transaction: 'bt_cme', email: 'Me@Example.com' })],
  }), rate1, ['me@example.com']);
  assert.deepEqual([mail?.net_usd, mail?.payers], [1000, 5]);
});

test('runStripeRevenue: stores the row (shown by the rule), once a UTC day, own email from the digest opt-in dropped', dbTest, async () => {
  const b = await builder(null);
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b}, ${seal(KEY, 'stripe')}, ${`acct_${hex()}`}, 'x.com')`;
  await sql()`INSERT INTO digest_subscriptions (installation_id, login, email) VALUES (${b}, 'me', 'me@example.com')`;
  const call = stripeFake({
    bts: [...fiveBts(), bt('bt_cme', 'charge', 90_000)], charges: [...five(), chg(9, 90_000, { balance_transaction: 'bt_cme', email: 'ME@example.com' })],
  });
  const opts = { deadline: Date.now() + 5000, call, rate: rate1, only: [b] };
  assert.deepEqual(await runStripeRevenue(NOW, opts), { due: 1, stored: 1 });
  assert.ok(!call.calls.some((c) => c.startsWith('POST')), 'v4.7.1 T3: the daily run never probes');
  const rows = await sql()`SELECT day::text, net_usd::float8 AS net, payers, shown, capped FROM stripe_revenue WHERE builder_id = ${b}`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ day: '2026-10-30', net: 1000, payers: 5, shown: true, capped: false }]);
  const n = call.calls.length;
  assert.deepEqual(await runStripeRevenue(new Date(NOW.getTime() + 3_600_000), opts), { due: 0, stored: 0 });
  assert.equal(call.calls.length, n, 'nothing read again the same day');
  assert.deepEqual(await latestStripe(b, NOW), { usd: 1000, mrr: 0, capped: false });
});

test('a refund on day 2 lowers day 2 (and the figure shown), day 1 stays', dbTest, async () => {
  const b = await builder(null);
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b}, ${seal(KEY, 'stripe')}, ${`acct_${hex()}`}, 'x.com')`;
  const base = { deadline: Date.now() + 5000, rate: rate1, only: [b] };
  await runStripeRevenue(NOW, { ...base, call: stripeFake({ bts: fiveBts(), charges: five() }) });
  const d2 = new Date(NOW.getTime() + DAYMS);
  await runStripeRevenue(d2, { ...base, call: stripeFake({ bts: [...fiveBts(), bt('r', 'refund', -30_000)], charges: five() }) });
  const rows = await sql()`SELECT day::text, net_usd::float8 AS net FROM stripe_revenue WHERE builder_id = ${b} ORDER BY day`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ day: '2026-10-30', net: 1000 }, { day: '2026-10-31', net: 700 }]);
  assert.equal((await latestStripe(b, d2))?.usd, 700);
});

test('latestStripe: shown only, USED_STALE_DAYS, REVENUE_MIN, capped passes through', dbTest, async () => {
  const b = await builder(null);
  const put = (day: string, net: number, shown: boolean, capped = false) =>
    sql()`INSERT INTO stripe_revenue (builder_id, day, net_usd, mrr_usd, payers, top_share, shown, capped) VALUES (${b}, ${day}, ${net}, 7, 5, 0.2, ${shown}, ${capped})`;
  assert.equal(await latestStripe(b, NOW), null);
  await put('2026-10-30', 5000, false);
  assert.equal(await latestStripe(b, NOW), null, 'not shown');
  await sql()`DELETE FROM stripe_revenue WHERE builder_id = ${b}`;
  await put('2026-10-30', REVENUE_MIN - 1, true);
  assert.equal(await latestStripe(b, NOW), null, 'under the minimum');
  await sql()`DELETE FROM stripe_revenue WHERE builder_id = ${b}`;
  await put('2026-10-26', 5000, true, true);
  assert.equal(await latestStripe(b, NOW), null, 'stale');
  assert.deepEqual(await latestStripe(b, new Date('2026-10-29T10:00:00Z')), { usd: 5000, mrr: 7, capped: true });
});

test('failures store nothing; the page cap stores capped; 401 and 403 mark broken, once a day', dbTest, async () => {
  assert.equal(await stripeRevenue(KEY, NOW, stripeFake({ fail: { '/v1/charges': 500 } }), rate1), null);
  assert.equal(await stripeRevenue(KEY, NOW, stripeFake({ fail: { '/v1/subscriptions': 'throw' } }), rate1), null);
  await assert.rejects(stripeRevenue(KEY, NOW, stripeFake({ fail: { '/v1/balance_transactions': 401 } }), rate1), StripeAuthError);
  // The cap: STRIPE_PAGES pages of 100 with more to come.
  const many = Array.from({ length: STRIPE_PAGES * 100 + 1 }, (_, i) => bt(`bt_c${i}`, 'charge', 100));
  const big = stripeFake({ bts: many, charges: [] });
  const r = await stripeRevenue(KEY, NOW, big, rate1);
  assert.equal(r?.capped, true);
  assert.equal(big.calls.filter((c) => c.startsWith('/v1/balance_transactions')).length, STRIPE_PAGES);
  const b = await builder(null);
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b}, ${seal(KEY, 'stripe')}, ${`acct_${hex()}`}, 'x.com')`;
  const bad = stripeFake({ fail: { '/v1/balance_transactions': 403 } });
  const opts = { deadline: Date.now() + 5000, call: bad, rate: rate1, only: [b] };
  assert.deepEqual(await runStripeRevenue(NOW, opts), { due: 1, stored: 0 });
  const [c] = await sql()`SELECT state, broken_at FROM stripe_connections WHERE builder_id = ${b}`;
  assert.equal(c.state, 'broken');
  assert.ok(c.broken_at);
  assert.deepEqual(await runStripeRevenue(new Date(NOW.getTime() + DAYMS), opts), { due: 0, stored: 0 }, 'a broken connection is not read again');
  assert.deepEqual((await sql()`SELECT 1 FROM stripe_revenue WHERE builder_id = ${b}`).length, 0);
  // A failing (non-auth) read stores nothing and is not retried the same day.
  const b2 = await builder(null);
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b2}, ${seal(KEY, 'stripe')}, ${`acct_${hex()}`}, 'x.com')`;
  const flaky = stripeFake({ fail: { '/v1/charges': 500 } });
  const o2 = { deadline: Date.now() + 5000, call: flaky, rate: rate1, only: [b2] };
  assert.deepEqual(await runStripeRevenue(NOW, o2), { due: 1, stored: 0 });
  const n = flaky.calls.length;
  await runStripeRevenue(new Date(NOW.getTime() + 3_600_000), o2);
  assert.equal(flaky.calls.length, n);
  assert.equal((await sql()`SELECT state FROM stripe_connections WHERE builder_id = ${b2}`)[0].state, 'ok');
  assert.equal((await sql()`SELECT 1 FROM stripe_revenue WHERE builder_id = ${b2}`).length, 0);
});

test('disconnect, then the cron reads nothing; the cron step reports in its result', dbTest, async () => {
  const b = await builder(null);
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b}, ${seal(KEY, 'stripe')}, ${`acct_${hex()}`}, 'x.com')`;
  const call = stripeFake({ bts: fiveBts(), charges: five() });
  assert.equal(await disconnectStripe(b), true);
  const r0 = await runCron({ now: NOW, only: ['none'], deps: { stripe: { call, rate: rate1, only: [b] } } });
  assert.deepEqual(r0.stripe, { due: 0, stored: 0 });
  assert.equal(call.calls.length, 0);
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b}, ${seal(KEY, 'stripe')}, ${`acct_${hex()}`}, 'x.com')`;
  const r1 = await runCron({ now: NOW, only: ['none'], deps: { stripe: { call, rate: rate1, only: [b] } } });
  assert.deepEqual(r1.stripe, { due: 1, stored: 1 });
});

test('the key never reaches the cron result, logs, errors or events, even when the call throws it', dbTest, async () => {
  const b = await builder(null);
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b}, ${seal(KEY, 'stripe')}, ${`acct_${hex()}`}, 'x.com')`;
  const logs: string[] = [];
  const keep = { e: console.error, l: console.log, w: console.warn };
  const grab = (...a: unknown[]) => void logs.push(a.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${x.stack}` : String(x))).join(' '));
  console.error = grab; console.log = grab; console.warn = grab;
  try {
    let step = 0;
    for (const fail of [{ '/v1/charges': 'throw' }, { '/v1/subscriptions': 500 }, { '/v1/balance_transactions': 401 }] as Record<string, number | 'throw'>[]) {
      await sql()`UPDATE stripe_connections SET state = 'ok', broken_at = NULL WHERE builder_id = ${b}`;
      await sql()`DELETE FROM stripe_revenue WHERE builder_id = ${b}`;
      const r = await runCron({ now: new Date(NOW.getTime() + ++step * DAYMS), only: ['none'], deps: { stripe: { call: stripeFake({ fail: { ...fail } }), rate: rate1, only: [b] } } });
      logs.push(JSON.stringify(r));
    }
    const thrown = await runStripeRevenue(new Date(NOW.getTime() + 40 * DAYMS), { deadline: Date.now() + 5000, call: stripeFake({ fail: { '/v1/account': 'throw', '/v1/charges': 'throw' } }), rate: rate1, only: [b] }).catch((e: unknown) => String(e));
    logs.push(JSON.stringify(thrown));
  } finally {
    console.error = keep.e; console.log = keep.l; console.warn = keep.w;
  }
  assert.ok(logs.length > 0);
  assert.ok(!logs.join('\n').includes(KEY), 'the key is in no output');
  const ev = await sql()`SELECT count(*)::int AS n FROM events WHERE payload::text LIKE ${`%${KEY}%`}`.catch(() => [{ n: 0 }]);
  assert.equal(ev[0].n, 0);
});

test('fx: USD is 1, a rate is cached per currency per day, no rate returns null and caches nothing', dbTest, async () => {
  let n = 0;
  const ok = async (url: string) => { n++; assert.match(url, /^https:\/\/api\.frankfurter\.dev\/v1\/latest\?from=ZZZ&to=USD$/); return { status: 200, body: { rates: { USD: 1.25 } } }; };
  assert.equal(await usdRate('usd', NOW, ok), 1);
  await sql()`DELETE FROM fx_rates WHERE currency = 'ZZZ'`;
  assert.equal(await usdRate('zzz', NOW, ok), 1.25);
  assert.equal(await usdRate('ZZZ', NOW, ok), 1.25);
  assert.equal(n, 1);
  assert.equal(await usdRate('ZZZ', new Date(NOW.getTime() + DAYMS), ok), 1.25);
  assert.equal(n, 2);
  await sql()`DELETE FROM fx_rates WHERE currency = 'ZZZ'`;
  assert.equal(await usdRate('ZZZ', NOW, async () => ({ status: 500, body: {} })), null);
  assert.equal(await usdRate('ZZZ', NOW, async () => { throw new Error('net'); }), null);
  assert.equal(await usdRate('zz', NOW, ok), null);
  assert.equal((await sql()`SELECT 1 FROM fx_rates WHERE currency = 'ZZZ'`).length, 0);
});

test('fix round 1 (I1): a USD balance with one AED-presented charge still stores a row; payer gross is the settled amount', dbTest, async () => {
  const call = stripeFake({ bts: fiveBts(), charges: [...five().slice(0, 4), chg(5, 73_000, { currency: 'aed' })] });
  const r = await stripeRevenue(KEY, NOW, call, rate1);
  assert.deepEqual(r, { net_usd: 1000, mrr_usd: 0, payers: 5, top_share: 0.2, capped: false });
});

test('fix round 1 (M1): a payer refunded down to $1 loses its share', dbTest, async () => {
  const charges = [chg(1, 10_000, { ar: 9_900 }), chg(2, 10_000), chg(3, 10_000)];
  const bts = [1, 2, 3].map((n) => bt(`bt_c${n}`, 'charge', 10_000));
  const r = await stripeRevenue(KEY, NOW, stripeFake({ bts, charges }), rate1);
  assert.equal(r?.top_share, 0.4975); // 100 / 201
  assert.equal(r?.payers, 3);
});

test('fix round 1 (I2): MRR needs a counted payer and no discount; no-rate items are skipped', dbTest, async () => {
  const own = chg(9, 20_000, { balance_transaction: 'bt_cme', email: 'me@example.com', customer: 'cus_me' });
  const subs: Sub[] = [
    { customer: 'cus_1', items: [{ unit_amount: 2_000, interval: 'month' }] }, // counts: 20
    { customer: 'cus_2', discounts: [{ coupon: 'free' }], items: [{ unit_amount: 500_000, interval: 'month' }] }, // 100% off
    { customer: 'cus_3', discount: { coupon: 'x' }, items: [{ unit_amount: 500_000, interval: 'month' }] },
    { customer: 'cus_unpaid', items: [{ unit_amount: 500_000, interval: 'year' }] }, // send_invoice, never paid
    { customer: 'cus_me', items: [{ unit_amount: 500_000, interval: 'month' }] }, // the builder's own
    { customer: 'cus_4', items: [{ unit_amount: 100_000, interval: 'month', currency: 'aed' }] }, // no rate: skipped, not fatal
  ];
  const r = await stripeRevenue(KEY, NOW, stripeFake({ subs, bts: [...fiveBts(), bt('bt_cme', 'charge', 20_000)], charges: [...five(), own] }), rate1, ['me@example.com']);
  assert.equal(r?.mrr_usd, 20);
  assert.equal(r?.payers, 5);
});

test('fix round 1 (M6): payment_reversal and payment_failure_refund subtract, refund_failure adds back', dbTest, async () => {
  const r = await stripeRevenue(KEY, NOW, stripeFake({
    bts: [...fiveBts(), bt('x1', 'payment_reversal', -4_000), bt('x2', 'payment_failure_refund', -3_000), bt('x3', 'refund_failure', 2_000), bt('r', 'refund', -2_000)],
    charges: five(),
  }), rate1);
  assert.equal(r?.net_usd, 1000 - 40 - 30 + 20 - 20);
});

test('F3: signed amounts are summed as Stripe sends them; a failed refund (positive) is never subtracted twice', dbTest, async () => {
  const r = await stripeRevenue(KEY, NOW, stripeFake({
    bts: [...fiveBts(), bt('r', 'payment_refund', -5_000), bt('rf', 'payment_refund', 5_000), bt('a', 'adjustment', 2_000, { reporting_category: 'refund_failure' }),
      bt('d', 'adjustment', -3_000, { reporting_category: 'dispute' })],
    charges: five(),
  }), rate1);
  assert.equal(r?.net_usd, 1000 - 50 + 50 + 20 - 30);
});

test('fix round 1 (M2): a sealed key that will not open marks the connection broken', dbTest, async () => {
  const b = await builder(null);
  const sealed = seal(KEY, 'stripe');
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b}, ${sealed.slice(0, -2) + 'AA'}, ${`acct_${hex()}`}, 'x.com')`;
  const call = stripeFake({});
  assert.deepEqual(await runStripeRevenue(NOW, { deadline: Date.now() + 5000, call, rate: rate1, only: [b] }), { due: 1, stored: 0 });
  assert.equal(call.calls.length, 0);
  const [c] = await sql()`SELECT state, broken_at FROM stripe_connections WHERE builder_id = ${b}`;
  assert.equal(c.state, 'broken');
  assert.ok(c.broken_at);
});

test('fix round 2 (N1): with the Stripe secret unset nothing is read, claimed or broken; a rotated secret marks broken', dbTest, async () => {
  const b = await builder(null);
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b}, ${seal(KEY, 'stripe')}, ${`acct_${hex()}`}, 'x.com')`;
  const call = stripeFake({ bts: fiveBts(), charges: five() });
  const opts = { deadline: Date.now() + 5000, call, rate: rate1, only: [b] };
  const was = process.env.EARNKIT_STRIPE_SECRET;
  try {
    delete process.env.EARNKIT_STRIPE_SECRET;
    const r = await runStripeRevenue(NOW, opts);
    assert.equal(r.stored, 0);
    assert.match(r.note ?? '', /EARNKIT_STRIPE_SECRET/);
    assert.ok(!JSON.stringify(r).includes(KEY));
    assert.equal(call.calls.length, 0);
    assert.equal((await sql()`SELECT state FROM stripe_connections WHERE builder_id = ${b}`)[0].state, 'ok');
    // Back with the secret: the day was not claimed, so it reads now.
    process.env.EARNKIT_STRIPE_SECRET = was;
    assert.deepEqual(await runStripeRevenue(NOW, opts), { due: 1, stored: 1 });
    // A rotated (wrong) secret with the secret present: broken.
    const b2 = await builder(null);
    await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b2}, ${seal(KEY, 'stripe')}, ${`acct_${hex()}`}, 'x.com')`;
    process.env.EARNKIT_STRIPE_SECRET = 'rotated-secret';
    await runStripeRevenue(NOW, { ...opts, only: [b2] });
    assert.equal((await sql()`SELECT state FROM stripe_connections WHERE builder_id = ${b2}`)[0].state, 'broken');
  } finally {
    process.env.EARNKIT_STRIPE_SECRET = was;
  }
});

// ---------------------------------------------------------------------------------------------- Task 3: drafts, replies and the ask

const LINE = (usd: string) => `${usd} received through Stripe in the last 30 days, verified from Stripe`;
const base: ShipLogFacts = { score: null, rank: null, why: null, streak: 0, live: null, page: 'earnkit.com/kit', usedBy: null, revenue: null, stripe: null };

test('3.1 the block: Stripe only; plus MRR; next to onchain revenue; capped; MRR under $100 and under-threshold figures print nothing', () => {
  const lines = (o: Partial<ShipLogFacts>) => shipLogBlock({ ...base, ...o });
  assert.deepEqual(lines({ stripe: { usd: 1240, mrr: 0, capped: false } }), ['From your ship log:', LINE('$1,240'), 'Page: earnkit.com/kit']);
  assert.ok(lines({ stripe: { usd: 1240, mrr: 99, capped: false } }).includes(LINE('$1,240')), 'MRR under $100 is left off');
  assert.ok(lines({ stripe: { usd: 1240, mrr: 480, capped: false } }).includes(`${LINE('$1,240')}, $480 a month in subscriptions`));
  assert.ok(lines({ stripe: { usd: 2500, mrr: 1200, capped: true } }).includes(`${LINE('$2,500+')}, $1,200 a month in subscriptions`), '+ only on the 30-day figure');
  const both = lines({ revenue: { usd: 900, capped: false }, stripe: { usd: 1240, mrr: 0, capped: false }, live: 'kit.app' });
  const i = both.findIndex((l) => l.includes('paid into its contracts'));
  assert.equal(both[i + 1], LINE('$1,240'), 'right after the onchain revenue line');
  assert.equal(both[i + 2], 'Live: kit.app');
  assert.deepEqual(lines({ stripe: { usd: REVENUE_MIN - 1, mrr: 500, capped: false } }), ['From your ship log:', 'Page: earnkit.com/kit']);
  assert.doesNotMatch(lines({ stripe: { usd: 1240, mrr: 480, capped: true } }).join('\n'), /—|coin|points/);
});

/** A claimed, confirmed builder (with a verified site when given) with a stripe_revenue row for today. */
let sn = 0;
async function stripey(o: { usd?: number; mrr?: number; shown?: boolean; capped?: boolean; day?: string; hidden?: boolean; site?: string | null } = {}) {
  sn++;
  const key = `st${process.pid}o${sn}/kit${sn}`;
  const handle = `st${process.pid % 10000}x${sn}`;
  const id = await findPerson({ projects: [{ key, name: `Kit ${sn}`, confirmed: true }], main: key, claimed: handle });
  if (o.hidden) await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${id}`;
  if (o.site !== null)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
      VALUES (${id}, 'site', ${o.site ?? 'https://kit.app'}, ${key}, 'earnkit_txt', 'verified', 'server')`;
  if (o.usd !== undefined)
    await sql()`INSERT INTO stripe_revenue (builder_id, day, net_usd, mrr_usd, payers, top_share, shown, capped)
      VALUES (${id}, ${o.day ?? new Date().toISOString().slice(0, 10)}, ${o.usd}, ${o.mrr ?? 0}, 5, 0.2, ${o.shown ?? true}, ${o.capped ?? false})`;
  return { id, key, handle };
}

test('3.2 shipLogFacts and replyFacts: the shown fresh figure from $100; hidden, stale and under-threshold rows print nothing', dbTest, async () => {
  const now = new Date();
  const b = await stripey({ usd: 1240.75, mrr: 480.4, capped: true });
  const f = (await shipLogFacts(b.id, now))!;
  assert.deepEqual(f.stripe, { usd: 1240, mrr: 480, capped: true });
  assert.ok(shipLogBlock(f).includes(`${LINE('$1,240+')}, $480 a month in subscriptions`));
  const r = await replyFacts({ installationId: b.id, sharedClient: false }, now);
  assert.deepEqual([r.stripe_30d_usd, r.stripe_mrr_usd], [1240, 480]);
  const small = await replyFacts({ installationId: (await stripey({ usd: 300, mrr: 99 })).id, sharedClient: false }, now);
  assert.deepEqual([small.stripe_30d_usd, 'stripe_mrr_usd' in small], [300, false]);
  for (const o of [{ usd: 5000, shown: false }, { usd: 99.9 }, { usd: 5000, day: new Date(now.getTime() - 9 * 86_400_000).toISOString().slice(0, 10) }]) {
    const x = await stripey(o);
    assert.equal((await shipLogFacts(x.id, now))!.stripe ?? null, null, JSON.stringify(o));
    const rf = await replyFacts({ installationId: x.id, sharedClient: false }, now);
    assert.ok(!('stripe_30d_usd' in rf) && !('stripe_mrr_usd' in rf), JSON.stringify(o));
  }
});

test('3.3 a drafted application (prepare) carries the Stripe line, a hidden page\'s too', dbTest, async () => {
  const baseP = committedProgram('base-builder-grants');
  const pid = `v46-st-${process.pid}-draft`;
  await upsertProgram(ProgramFile.parse({ ...baseP, id: pid, title: `Stripe ${process.pid}`, ends_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), status: 'active' }));
  try {
    const reqs = baseP.submission_requirements as { key: string; type: string; options?: string[] }[];
    const answers = Object.fromEntries(reqs.map((r) => [r.key, r.type === 'url' ? 'https://kit.app/demo' : r.type === 'email' ? 'lee@kit.app' : r.options ? r.options[0] : 'Kit lets fans tip creators on Base.']));
    for (const hidden of [false, true]) {
      const b = await stripey({ usd: 1240, mrr: 480, hidden });
      const ctx = { installationId: b.id, ownInstallationId: b.id, sharedClient: false };
      const project = { name: 'Kit', repo_url: `https://github.com/${b.key}`, live_url: 'https://kit.app' };
      for (const args of [{ program_id: pid, project }, { program_id: pid, project, answers, coach_asked: true }]) {
        const prep = await mcpCall(ctx, 'prepare', args);
        const log = prep.reply?.ship_log as ShipLogFacts;
        assert.deepEqual(log?.stripe, { usd: 1240, mrr: 480, capped: false }, `${hidden ? 'hidden' : 'public'}: ${prep.text}`);
        assert.ok(shipLogBlock(log).includes(`${LINE('$1,240')}, $480 a month in subscriptions`));
        assert.ok(!/\$1,240/.test(String(prep.reply?.show_to_builder ?? '')), `never on the form link: ${prep.reply?.show_to_builder}`);
      }
    }
  } finally {
    await sql()`DELETE FROM programs WHERE id = ${pid}`.catch(() => sql()`UPDATE programs SET status = 'closed' WHERE id = ${pid}`);
  }
});

test('3.4 privacy: builder.json, the page data, /api/stats and the feed never carry the Stripe figure', dbTest, async () => {
  const now = new Date();
  const b = await stripey({ usd: 5317, mrr: 777 });
  assert.equal((await replyFacts({ installationId: b.id, sharedClient: false }, now)).stripe_30d_usd, 5317, 'control: the row is read');
  const d = (await profileData(b.id, now))!;
  const outputs: Record<string, unknown> = {
    builderJson: await builderJson(b.handle, now),
    profileData: d,
    profileSite: await profileSite(b.id, d, now, { only: [b.id] }),
    highlights: await highlights(b.id, d, now),
    stats: await readStats(now),
    feed: await feedWeeks(now, { only: [b.id] }),
  };
  assert.ok(outputs.builderJson, 'the page is public');
  for (const [name, out] of Object.entries(outputs)) {
    const s = JSON.stringify(out);
    assert.ok(!/5,?317|\b777\b/.test(s), `${name} carries a figure`);
    assert.doesNotMatch(s, /stripe/i, name);
  }
});

test('3.5 v4.7 T3: the ask left the reply order (stateAsk never asks it); the draft line is a statement with the link', () => {
  const L = 'https://earnkit.com/connect/stripe?t=x';
  assert.equal(stripeDraftLine(L), `Connect Stripe read-only so this draft can show verified revenue: ${L}`);
  assert.doesNotMatch(stripeDraftLine(L).replace(L, ''), /—|coin|points|\?|\p{Extended_Pictographic}/u);
  const v = { state: 'ranked' as const, variant: null, project: { key: 'a/kit', name: 'Kit' } as never, link: null, handle: 'kit', stripe: L } as never;
  assert.equal(stateAsk(v).kind, 'ship', 'no stripe kind: the ranked rest');
  assert.equal(stateAsk({ ...(v as object), share: true } as never).kind, 'share');
  assert.equal(benchStepKey('stripe', null), STRIPE_DECLINED_KEY);
  assert.ok(stripeDraftNote(L).includes(`"${stripeDraftLine(L)}"`));
});

const kindOf = (r: Awaited<ReturnType<typeof mcpCall>>) => (r.reply?.move_up as { kind?: string } | undefined)?.kind;
const showOf = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');
const noteOf = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.agent_note ?? '');
const seenOf = async (id: number) => (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;
const ctxOf = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false });
/** v4.7 T3: a copy of Base Builder Grants (wants_revenue, the committed file's), open 20 days. */
let draftProgram: { id: string; answers: Record<string, string> } | null = null;
async function revenueProgram() {
  if (draftProgram) return draftProgram;
  const baseP = committedProgram('base-builder-grants');
  const id = `v46-st-${process.pid}-ask`;
  await upsertProgram(ProgramFile.parse({ ...baseP, id, title: `Stripe ask ${process.pid}`, ends_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), status: 'active' }));
  const reqs = baseP.submission_requirements as { key: string; type: string; options?: string[] }[];
  const answers = Object.fromEntries(reqs.map((r) => [r.key, r.type === 'url' ? 'https://kit.app/demo' : r.type === 'email' ? 'lee@kit.app' : r.options ? r.options[0] : 'Kit lets fans tip creators on Base.']));
  draftProgram = { id, answers };
  return draftProgram;
}
/** v4.7 T3: the shown draft for the revenue program; returns the Stripe link its agent note offers, or null. */
async function draftStripe(b: { id: number; key: string }): Promise<string | null> {
  const p = await revenueProgram();
  const r = await mcpCall(ctxOf(b.id), 'prepare', { program_id: p.id, project: { name: 'Kit', repo_url: `https://github.com/${b.key}`, live_url: 'https://kit.app' }, answers: p.answers, coach_asked: true });
  assert.doesNotMatch(showOf(r), /Connect Stripe/, 'the line is in the note, never a question in the reply');
  return /Connect Stripe read-only so this draft can show verified revenue: (https:\/\/earnkit\.com\/connect\/stripe\?t=\S+?)"/.exec(noteOf(r))?.[1] ?? null;
}
/** v4.7 T3: finds `max` times; true when any carried a Stripe ask (it never should). */
async function findStripe(id: number, max = 4) {
  for (let i = 0; i < max; i++) {
    const r = await mcpCall(ctxOf(id), 'find', {});
    if (kindOf(r) === 'stripe' || /connect\/stripe/.test(showOf(r))) return true;
  }
  return false;
}

test('3.6 v4.7 T3: the line rides on a draft once (stripe_asked); find never asks it; tell connect sends a fresh link', dbTest, async () => {
  const b = await stripey();
  assert.equal(await findStripe(b.id), false, 'find never asks it now');
  assert.equal((await seenOf(b.id)).stripe_asked, undefined);
  assert.ok(await draftStripe(b), 'the first draft offers it');
  assert.equal(typeof (await seenOf(b.id)).stripe_asked, 'string');
  assert.equal(await draftStripe(b), null, 'once');
  const c = await mcpCall(ctxOf(b.id), 'tell', { stripe: 'connect' });
  assert.match(showOf(c), /^Connect Stripe read-only here: https:\/\/earnkit\.com\/connect\/stripe\?t=\S+$/);
  assert.match(String(c.reply?.agent_note), /Never ask the builder for a Stripe key in chat/);
});

test('3.7 a v4.6 stored ask still answers: yes sends the link again; a no is permanent (no draft offers it, even past DECLINE_MS)', dbTest, async () => {
  const stored = (id: number) => sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
    || jsonb_build_object('stripe_asked', now()::text, 'bench_ask', jsonb_build_object('kind', 'stripe', 'key', null)) WHERE builder_id = ${id}`;
  const y = await stripey();
  await stored(y.id);
  const yes = await mcpCall(ctxOf(y.id), 'tell', { move_up: { kind: 'stripe', project_key: null, answer: 'yes' } });
  assert.match(showOf(yes), /^Connect Stripe read-only here: https:\/\/earnkit\.com\/connect\/stripe\?t=\S+$/);
  assert.match(String(yes.reply?.agent_note), /Never ask the builder for a Stripe key in chat/);
  const n = await stripey();
  await stored(n.id);
  await mcpCall(ctxOf(n.id), 'tell', { move_up: { kind: 'stripe', project_key: null, answer: 'no' } });
  const s = await seenOf(n.id);
  assert.equal(typeof (s.declined as Record<string, string>)[STRIPE_DECLINED_KEY], 'string');
  assert.equal(await stripeAskDue(n.id, s as never), null);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen - 'stripe_asked', '{declined}', jsonb_build_object(${STRIPE_DECLINED_KEY}::text, ${new Date(Date.now() - 400 * 86_400_000).toISOString()}::text)) WHERE builder_id = ${n.id}`;
  assert.equal(await stripeAskDue(n.id, (await seenOf(n.id)) as never), null);
  assert.equal(await draftStripe(n), null);
});

test('3.8 who is asked: a verified site, no connection; a builder with no site, or connected, is not', dbTest, async () => {
  const none = await stripey({ site: null });
  assert.equal(await stripeAskDue(none.id, {}), null, 'no verified site');
  assert.equal(await draftStripe(none), null);
  const b = await stripey();
  assert.equal(await stripeAskDue(b.id, {}), 'first');
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host) VALUES (${b.id}, 'x', ${`acct_${sn}${process.pid}`}, 'kit.app')`;
  assert.equal(await stripeAskDue(b.id, {}), null, 'connected');
  assert.equal(await draftStripe(b), null);
  assert.equal(await stripeAskDue(b.id, { stripe_asked: 'x' }), null);
});

test('3.9 broken re-offers once on a draft, in the same store; declined stays untouched, and a no still wins', dbTest, async () => {
  const b = await stripey();
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host, state, broken_at) VALUES (${b.id}, 'x', ${`acct_b${sn}${process.pid}`}, 'kit.app', 'broken', now())`;
  assert.equal(await stripeAskDue(b.id, { stripe_asked: 'x' }), 'reoffer', 'even after the first ask');
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('stripe_asked', now()::text) WHERE builder_id = ${b.id}`;
  assert.ok(await draftStripe(b), 'the re-offer rides on the draft with the same line');
  const s = await seenOf(b.id);
  assert.equal(typeof s.stripe_reoffered, 'string');
  assert.equal(s.declined, undefined, 'declined untouched');
  assert.equal(await draftStripe(b), null, 'after that, quiet');
  const d = await stripey();
  await sql()`INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host, state, broken_at) VALUES (${d.id}, 'x', ${`acct_d${sn}${process.pid}`}, 'kit.app', 'broken', now())`;
  assert.equal(await stripeAskDue(d.id, { declined: { [STRIPE_DECLINED_KEY]: new Date().toISOString() } }), null);
});

test('3.10 with no secret there is no link: no draft offers it, nothing is claimed, and tell connect says so in plain words', dbTest, async () => {
  const b = await stripey();
  await revenueProgram();
  const was = process.env.EARNKIT_AUTH_SECRET;
  delete process.env.EARNKIT_AUTH_SECRET;
  try {
    assert.equal(stripeLink(b.id, new Date()), null);
    assert.equal(await draftStripe(b), null);
    assert.equal(showOf(await mcpCall(ctxOf(b.id), 'tell', { stripe: 'connect' })), STRIPE_NO_LINK);
    assert.equal((await seenOf(b.id)).stripe_asked, undefined, 'nothing claimed');
  } finally {
    process.env.EARNKIT_AUTH_SECRET = was;
  }
  assert.doesNotMatch(STRIPE_NO_LINK, /\?|—/);
});

test('3.11 tell stripe:disconnect deletes the key row and the stored figures; the reply carries no key or account id', dbTest, async () => {
  const b = await stripey({ usd: 1240 });
  const connected = await connectStripe(upgradeToken(b.id, new Date(), undefined, 'stripe')!, KEY, new Date(), fake({ id: 'acct_ZZ9secret', url: 'https://kit.app' }));
  assert.equal(connected.ok, true, JSON.stringify(connected));
  assert.ok(await stripeKey(b.id));
  assert.equal((await shipLogFacts(b.id, new Date()))!.stripe?.usd, 1240);
  const r = await mcpCall(ctxOf(b.id), 'tell', { stripe: 'disconnect' });
  assert.equal(showOf(r), STRIPE_DISCONNECTED);
  assert.equal(STRIPE_DISCONNECTED, 'Stripe disconnected. EarnKit deleted the key.');
  assert.equal(await stripeKey(b.id), null);
  assert.equal((await sql()`SELECT 1 FROM stripe_connections WHERE builder_id = ${b.id}`).length, 0);
  assert.equal((await shipLogFacts(b.id, new Date()))!.stripe ?? null, null, 'drafts stop showing it at once');
  assert.ok(!r.text.includes(KEY) && !r.text.includes('acct_ZZ9secret'));
  assert.equal(showOf(await mcpCall(ctxOf(b.id), 'tell', { stripe: 'disconnect' })), STRIPE_NOT_CONNECTED);
});

test('3.12 the agent is told never to take a key in chat (tell description, the draft note, the connect reply)', () => {
  assert.match(TELL_DESCRIPTION_BENCH, /stripe: 'connect' or 'disconnect'.*never ask for a key in chat/);
  assert.ok(TELL_DESCRIPTION_BENCH.length < 800);
  // F2: a pasted key is never repeated or passed to a tool; the builder deletes it in Stripe and uses the link.
  assert.match(TELL_DESCRIPTION_BENCH, /If they paste a Stripe key, don't repeat it or pass it to any tool; tell them to delete that key in Stripe and use the link/);
  for (const n of [stripeDraftNote('https://earnkit.com/connect/stripe?t=x'), STRIPE_NEVER_KEY]) assert.match(n, /Never ask the builder for a Stripe key in chat\. If they paste one, tell them to use the link instead and not to repeat it/);
});
