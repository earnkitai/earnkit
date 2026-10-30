import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { open, seal } from './secret-box';
import {
  STRIPE_TEXT, checkKey, connectStripe, disconnectStripe, hostMatches, keyKind, missingLine, mismatchLine,
  stripeKey, stripeLink, stripePageState, stripePost, type StripeCall,
} from './stripe';
import { upgradeOf, upgradeToken, walletLink, walletPageState } from './wallet-proof';
import { RESERVED_ROUTES } from './reserved-routes';
import StripeForm from '../../app/connect/stripe/StripeForm';

process.env.EARNKIT_AUTH_SECRET = 'test-secret';
process.env.EARNKIT_URL = 'https://earnkit.com';
(globalThis as { React?: typeof React }).React = React;
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
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
  const f = (async (path: string) => {
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
  const was = process.env.EARNKIT_AUTH_SECRET;
  process.env.EARNKIT_AUTH_SECRET = 'rotated';
  assert.equal(open(s, 'stripe'), null);
  process.env.EARNKIT_AUTH_SECRET = was;
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
  assert.deepEqual(c.calls, ['/v1/account', '/v1/balance_transactions?limit=1', '/v1/charges?limit=1', '/v1/subscriptions?limit=1']);
  for (const [path, what] of [['/v1/account', 'Account'], ['/v1/balance_transactions', 'Balance transactions'], ['/v1/charges', 'Charges'], ['/v1/subscriptions', 'Subscriptions']] as const)
    assert.deepEqual(await checkKey(id, KEY, fake({ url: 'https://myapp.com' }, { [path]: { status: 403 } })), { ok: false, line: missingLine(what) });
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
  assert.equal((await connectStripe(t, KEY + 'B', NOW, call)).ok, true);
  const [again] = await sql()`SELECT state, broken_at FROM stripe_connections WHERE builder_id = ${id}`;
  assert.deepEqual([again.state, again.broken_at], ['ok', null]);
  // Key rotation for the same account updates the sealed key; a different account never replaces the connection.
  const [before] = await sql()<{ sealed_key: string }[]>`SELECT sealed_key FROM stripe_connections WHERE builder_id = ${id}`;
  assert.equal(await stripeKey(id), KEY + 'B');
  const swap = await connectStripe(t, KEY + 'C', NOW, fake({ id: `acct_${hex()}`, url: 'https://store.example.com' }));
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
  const slow = (acct: string): StripeCall => async (path) => {
    await new Promise((r) => setTimeout(r, 20));
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
        new Request('https://earnkit.com/connect/stripe', { method: 'POST', headers: { 'content-type': 'application/json', origin: o.origin ?? 'https://earnkit.com', 'x-real-ip': o.ip ?? ip }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
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
    const sk = await grab(await post({ t, key: 'sk_live_SEEDEDfullSECRET' }));
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
  assert.ok(html.includes('type="text"') && !html.includes('type="password"'));
  for (const a of ['data-1p-ignore', 'data-lpignore="true"', 'autoComplete="off"', 'spellCheck="false"', '-webkit-text-security:disc'])
    assert.ok(html.toLowerCase().includes(a.toLowerCase()), a);
  const all = JSON.stringify(STRIPE_TEXT);
  assert.ok(!/[—–]/.test(all) && !/coin|points/i.test(all), 'no em dashes, no coin, no points');
  assert.deepEqual(STRIPE_TEXT.steps[1], 'Give it Read on Balance transactions, Charges, Subscriptions and Account. Nothing else.');
  assert.equal(STRIPE_TEXT.saved, 'Connected. Your next grant draft shows your Stripe revenue once it reaches $100 in 30 days.');
  assert.ok(RESERVED_ROUTES.has('connect'));
});
