import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { boxReady, open, seal } from './secret-box';
import { STRIPE_TEXT, connectStripe, runStripeRevenue, stripeLink, stripePageState, stripePost, stripeUseKey, type StripeCall } from './stripe';
import { upgradeToken } from './wallet-proof';

/**
 * v4.7.3 Task 1: the Stripe box has its own secret (EARNKIT_STRIPE_SECRET, never EARNKIT_AUTH_SECRET), a link connects
 * once, and the paste field is a password field. Review Focus 2, 3 and 4.
 */
process.env.EARNKIT_AUTH_SECRET = 'v473-auth-secret';
process.env.EARNKIT_URL = 'https://earnkit.com';
const STRIPE_SECRET = 'v473-stripe-secret';
process.env.EARNKIT_STRIPE_SECRET = STRIPE_SECRET;
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const NOW = new Date();
const hex = () => randomBytes(5).toString('hex');
const OFF = "Stripe connect isn't available right now. Try again later.";
const USED = 'This link was already used. Ask your agent for a new Stripe link.';
const noLimit = async () => {};

/** Runs `f` with EARNKIT_STRIPE_SECRET unset, then puts it back. */
async function withoutStripeSecret<T>(f: () => Promise<T> | T): Promise<T> {
  delete process.env.EARNKIT_STRIPE_SECRET;
  try {
    return await f();
  } finally {
    process.env.EARNKIT_STRIPE_SECRET = STRIPE_SECRET;
  }
}

async function builder(site: string): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v473-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle) VALUES (${id}, ${`v473-${id}`}, ${`x${hex()}`}, ${`h${hex()}`})`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
    VALUES (${id}, 'site', ${site}, ${`k-${id}`}, 'earnkit_txt', 'verified', 'server')`;
  return id;
}
/** A read-only key's answers (403 on every write probe); `status401` makes /v1/account reject the key. */
const fake = (url: string, o: { status401?: boolean; acct?: string } = {}): StripeCall & { calls: string[] } => {
  const calls: string[] = [];
  const f = (async (path: string, _key: string, method?: string) => {
    calls.push(method === 'POST' ? `POST ${path}` : path);
    if (o.status401) return { status: 401, body: { error: { message: 'Invalid API Key provided' } } };
    if (method === 'POST') return { status: 403, body: { error: { type: 'invalid_request_error' } } };
    if (path === '/v1/account') return { status: 200, body: { id: o.acct ?? `acct_${hex()}`, business_profile: { url } } };
    return { status: 200, body: { data: [] } };
  }) as unknown as StripeCall & { calls: string[] };
  f.calls = calls;
  return f;
};
const post = (body: unknown, o: { call?: StripeCall; ip?: string; limit?: boolean } = {}) =>
  stripePost(
    new Request('https://earnkit.com/connect/stripe/key', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://earnkit.com', 'x-real-ip': o.ip ?? `10.73.${randomBytes(1)[0]}.${randomBytes(1)[0]}` },
      body: JSON.stringify(body),
    }),
    { call: o.call, ...(o.limit ? {} : { limit: noLimit }) },
  );

test('exact copy', () => {
  assert.equal(STRIPE_TEXT.off, OFF);
  assert.equal(STRIPE_TEXT.used, USED);
});

test('secret-box: the stripe purpose needs EARNKIT_STRIPE_SECRET and never falls back to EARNKIT_AUTH_SECRET', async () => {
  await withoutStripeSecret(() => {
    assert.equal(boxReady('stripe'), false);
    assert.equal(boxReady('other'), true, 'another purpose still uses EARNKIT_AUTH_SECRET');
    assert.throws(() => seal('rk_live_X', 'stripe'), (e: Error) => !e.message.includes('rk_live_X'));
    const other = seal('plain', 'other');
    assert.equal(open(other, 'other'), 'plain');
  });
  assert.equal(boxReady('stripe'), true);
  // A box sealed while the stripe secret was unset can't exist; one sealed with it opens only with it.
  const box = seal('rk_live_BOX', 'stripe');
  const auth = process.env.EARNKIT_AUTH_SECRET;
  process.env.EARNKIT_AUTH_SECRET = 'a-rotated-auth-secret';
  assert.equal(open(box, 'stripe'), 'rk_live_BOX', 'the auth secret changing leaves the stripe box openable');
  process.env.EARNKIT_AUTH_SECRET = auth;
  process.env.EARNKIT_STRIPE_SECRET = 'a-rotated-stripe-secret';
  assert.equal(open(box, 'stripe'), null, 'a changed stripe secret opens nothing');
  process.env.EARNKIT_STRIPE_SECRET = STRIPE_SECRET;
  assert.equal(open(box, 'stripe'), 'rk_live_BOX');
  await withoutStripeSecret(() => assert.equal(open(box, 'stripe'), null, 'unset: nothing opens, no fallback'));
  // Different secrets derive different keys: a stripe box is not an auth-secret box.
  process.env.EARNKIT_STRIPE_SECRET = auth;
  assert.equal(open(box, 'stripe'), null);
  process.env.EARNKIT_STRIPE_SECRET = STRIPE_SECRET;
});

test('Review Focus 2: with EARNKIT_STRIPE_SECRET unset there is no link, the page and the POST show the off copy, nothing is called or stored', dbTest, async () => {
  const id = await builder('https://off.example.com');
  const t = upgradeToken(id, NOW, undefined, 'stripe')!;
  await withoutStripeSecret(async () => {
    assert.equal(stripeLink(id, NOW), null);
    assert.deepEqual(await stripePageState(t, NOW, { limit: noLimit }), { kind: 'gone', line: OFF });
    const call = fake('https://off.example.com');
    assert.deepEqual(await connectStripe(t, 'rk_live_OFFKEY123', NOW, call), { ok: false, line: OFF });
    assert.equal(call.calls.length, 0, 'no Stripe call');
    const r = await post({ t, key: 'rk_live_OFFKEY123' }, { call });
    assert.equal(r.ok, false);
    assert.deepEqual(await r.json(), { ok: false, line: OFF });
    assert.equal(call.calls.length, 0);
    assert.equal((await sql()`SELECT 1 FROM stripe_connections WHERE builder_id = ${id}`).length, 0);
    assert.equal((await sql()`SELECT 1 FROM wallet_proof_uses WHERE use_hash = ${stripeUseKey(t)}`).length, 0, 'the link is not spent');
    // The daily read stores nothing and says why.
    const run = await runStripeRevenue(NOW, { deadline: Date.now() + 60_000, call });
    assert.deepEqual(run, { due: 0, stored: 0, note: 'EARNKIT_STRIPE_SECRET is not set, Stripe not read' });
  });
  assert.match(stripeLink(id, NOW)!, /^https:\/\/earnkit\.com\/connect\/stripe\?t=/, 'set again: the link is back');
});

test('Review Focus 3: a link connects once; a refused paste leaves it usable', dbTest, async () => {
  const id = await builder('https://once.example.com');
  const t = upgradeToken(id, NOW, undefined, 'stripe')!;
  // A wrong key (401) is refused and spends nothing.
  const bad = await post({ t, key: 'rk_live_WRONGKEY123' }, { call: fake('https://once.example.com', { status401: true }) });
  assert.deepEqual(await bad.json(), { ok: false, line: STRIPE_TEXT.rejected });
  assert.equal((await stripePageState(t, NOW, { limit: noLimit })).kind, 'connect', 'still usable after a refused paste');
  // A good key connects; the use is recorded with the connection.
  const acct = `acct_${hex()}`;
  const good = await post({ t, key: 'rk_live_GOODKEY123' }, { call: fake('https://once.example.com', { acct }) });
  assert.deepEqual(await good.json(), { ok: true, line: STRIPE_TEXT.saved });
  assert.equal((await sql()`SELECT 1 FROM wallet_proof_uses WHERE use_hash = ${stripeUseKey(t)}`).length, 1);
  // Then the same link: GET shows the used copy, a second POST is refused before any Stripe call.
  assert.deepEqual(await stripePageState(t, NOW, { limit: noLimit }), { kind: 'gone', line: USED });
  const call = fake('https://once.example.com');
  const again = await post({ t, key: 'rk_live_OTHERKEY123' }, { call });
  assert.deepEqual(await again.json(), { ok: false, line: USED });
  assert.equal(call.calls.length, 0);
  assert.deepEqual(await connectStripe(t, 'rk_live_OTHERKEY123', NOW, call), { ok: false, line: USED });
  assert.equal(call.calls.length, 0);
  // A fresh link for the same person still works (a key rotation).
  const t2 = upgradeToken(id, NOW, undefined, 'stripe')!;
  assert.equal((await stripePageState(t2, NOW, { limit: noLimit })).kind, 'connect');
  assert.equal((await connectStripe(t2, 'rk_live_ROTATED123', NOW, fake('https://once.example.com', { acct }))).ok, true);
  // The use key is the link's own (not the wallet page's) and is a hash, not the token.
  assert.match(stripeUseKey(t), /^[0-9a-f]{64}$/);
  assert.notEqual(stripeUseKey(t), stripeUseKey(t2));
});

test('a connect that fails at the store writes nothing (no use recorded)', dbTest, async () => {
  // Builder A holds the account; builder B's paste of the same account is refused as taken and spends nothing.
  const a = await builder('https://shared-acct.example.com');
  const b = await builder('https://shared-acct.example.com');
  const acct = `acct_${hex()}`;
  const same: StripeCall = async (path, _k, method) =>
    method === 'POST' ? { status: 403, body: {} } : path === '/v1/account' ? { status: 200, body: { id: acct, business_profile: { url: 'https://shared-acct.example.com' } } } : { status: 200, body: { data: [] } };
  assert.equal((await connectStripe(upgradeToken(a, NOW, undefined, 'stripe')!, 'rk_live_AAA', NOW, same)).ok, true);
  const tb = upgradeToken(b, NOW, undefined, 'stripe')!;
  assert.deepEqual(await connectStripe(tb, 'rk_live_BBB', NOW, same), { ok: false, line: STRIPE_TEXT.taken });
  assert.equal((await sql()`SELECT 1 FROM wallet_proof_uses WHERE use_hash = ${stripeUseKey(tb)}`).length, 0);
  assert.equal((await stripePageState(tb, NOW, { limit: noLimit })).kind, 'connect');
});

test('Review Focus 4: the raw key is in no table, no console output and no response body after a connect and a refused connect', dbTest, async () => {
  const logs: string[] = [];
  const orig = { error: console.error, log: console.log, warn: console.warn, info: console.info, debug: console.debug };
  const spy = (...a: unknown[]) => void logs.push(a.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))).join(' '));
  console.error = console.log = console.warn = console.info = console.debug = spy;
  const bodies: string[] = [];
  try {
    const id = await builder('https://scan.example.com');
    const ip = `10.74.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
    // A refused connect (Stripe 401, whose own body echoes nothing of ours) and a thrown call carrying the key, then a good one.
    const t = upgradeToken(id, NOW, undefined, 'stripe')!;
    const refused = await post({ t, key: 'rk_live_SCANME123' }, { call: fake('https://scan.example.com', { status401: true }), ip, limit: true });
    bodies.push(await refused.text());
    const boom: StripeCall = async (_p, key) => { throw new Error(`down ${key}`); };
    const thrown = await post({ t, key: 'rk_live_SCANME123' }, { call: boom, ip, limit: true });
    bodies.push(await thrown.text());
    const ok = await post({ t, key: 'rk_live_SCANME123' }, { call: fake('https://scan.example.com'), ip, limit: true });
    bodies.push(await ok.text());
    assert.deepEqual(JSON.parse(bodies[2]), { ok: true, line: STRIPE_TEXT.saved });
    const used = await post({ t, key: 'rk_live_SCANME123' }, { call: fake('https://scan.example.com'), ip, limit: true });
    bodies.push(await used.text());
    for (const r of [refused, thrown, ok, used]) assert.ok(![...r.headers.values()].join(' ').includes('SCANME123'), 'no header holds the key');
    // The page for the used link, rendered state.
    bodies.push(JSON.stringify(await stripePageState(t, NOW, { limit: noLimit })));
  } finally {
    Object.assign(console, orig);
  }
  for (const b of bodies) assert.ok(!b.includes('SCANME123'), `response body: ${b}`);
  assert.ok(!logs.join('\n').includes('SCANME123'), 'no console output holds the key');
  // Every text, varchar, jsonb (and json, char, text[]) column of every public table.
  const cols = await sql()<{ table_name: string; column_name: string }[]>`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND (c.data_type IN ('text', 'character varying', 'character', 'jsonb', 'json') OR c.udt_name IN ('_text', '_varchar'))
    ORDER BY 1, 2`;
  assert.ok(cols.some((c) => c.table_name === 'stripe_connections' && c.column_name === 'sealed_key'), 'the scan covers the sealed column too');
  assert.ok(cols.some((c) => c.table_name === 'builder_events'));
  assert.ok(cols.some((c) => c.table_name === 'rate_windows'), 'the rate-limit table is scanned');
  const hits: string[] = [];
  for (const c of cols) {
    const [r] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql()(c.table_name)} WHERE ${sql()(c.column_name)}::text LIKE ${'%SCANME123%'}`;
    if (r.n > 0) hits.push(`${c.table_name}.${c.column_name}`);
  }
  assert.deepEqual(hits, [], 'no table holds the raw key');
  assert.ok(cols.length > 50, `scanned ${cols.length} columns`);
});

test('the form: a password field, no text-security style, cleared before the request is sent', () => {
  const src = readFileSync(join(process.cwd(), 'app/connect/stripe/StripeForm.tsx'), 'utf8');
  assert.ok(src.includes('type="password"'));
  assert.ok(!src.includes('type="text"'));
  assert.ok(!src.includes('WebkitTextSecurity'));
  for (const a of ['autoComplete="off"', 'data-1p-ignore', 'data-lpignore="true"', 'data-form-type="other"']) assert.ok(src.includes(a), a);
  // The field is emptied before the fetch is awaited.
  const clear = src.indexOf("field.current.value = ''");
  const send = src.indexOf('await fetch(');
  assert.ok(clear > 0 && send > 0 && clear < send, 'cleared before the fetch');
});
