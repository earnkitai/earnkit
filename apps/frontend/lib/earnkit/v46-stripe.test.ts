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
import { STRIPE_PAGES, StripeAuthError, latestStripe, runStripeRevenue, stripeRevenue } from './stripe';
import { usdRate } from './fx';
import { runCron } from './cron';
import { REVENUE_MIN } from './ship-log-facts';
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
  const f = (async (path: string, key: string) => {
    calls.push(path);
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
  assert.ok(call.calls.every((c) => c.startsWith('/v1/')));
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
