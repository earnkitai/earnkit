import './fixtures/no-network-checks';
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { BUILDER_TOKEN_RETRIES_PER_RUN, blockedBuilderTokens, builderTicker, builderToken, declineBuilderToken, launchBuilderToken, retryDroppedBuilderTokens, stuckBuilderTokens } from './builder-token';

/**
 * v4 builder tokens: one per builder and per X account, launched at the wallet proof unless declined, never twice,
 * only while EARNKIT_BUILDER_TOKENS is on. DB-gated; tokens.fun is a fake fetch.
 */
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
beforeEach(() => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
});
const free = async () => true;
const hex = (n: number) => randomBytes(n).toString('hex');

async function builder(o: { wallet?: boolean; x?: boolean } = {}): Promise<{ id: number; xId: string; wallet: string; handle: string }> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v4-bt-${hex(8)}`}) RETURNING id`;
  const xId = `x${hex(6)}`;
  const handle = `maya_${hex(3)}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle, x_name, x_avatar_url)
    VALUES (${id}, ${`bt-${id}`}, ${o.x === false ? null : xId}, ${o.x === false ? null : handle}, 'Maya Patel', 'https://pbs.twimg.com/profile_images/1/a.jpg')`;
  const wallet = `0x${hex(20)}`;
  if (o.wallet !== false) await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${wallet}, ${id}, now())`;
  return { id, xId, wallet, handle };
}

const fakeTokensFun = (status: number, body: unknown) => {
  const calls: Record<string, unknown>[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
};
const coin = () => `0x${hex(20)}`;

test('launches once on Base for the proven wallet, named after the builder, ticker from the handle', dbTest, async () => {
  const b = await builder();
  const address = coin();
  const t = fakeTokensFun(200, { success: true, tokenAddress: address, txHash: '0xabc', chainId: 8453 });
  const out = await launchBuilderToken(b.id, { fetch: t.f, check: free });
  assert.equal(out.result, 'launched');
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].creatorWallet, b.wallet);
  assert.equal(t.calls[0].name, 'Maya Patel');
  assert.equal(t.calls[0].chainId, 8453);
  assert.equal(t.calls[0].imageUrl, 'https://pbs.twimg.com/profile_images/1/a.jpg');
  assert.match(String(t.calls[0].symbol), /^MAYA/);
  assert.deepEqual(await builderToken(b.id), { status: 'launched', symbol: t.calls[0].symbol, coin_address: address.toLowerCase(), wallet: b.wallet });
  // Never twice: a second call (a retried proof, "launch my token") is a no-op.
  const again = await launchBuilderToken(b.id, { fetch: t.f, check: free });
  assert.deepEqual(again, { result: 'exists', status: 'launched' });
  assert.equal(t.calls.length, 1);
});

test('a no is kept forever: nothing launches after it', dbTest, async () => {
  const b = await builder();
  assert.equal(await declineBuilderToken(b.id), 'declined');
  const t = fakeTokensFun(200, { success: true, tokenAddress: coin() });
  assert.deepEqual(await launchBuilderToken(b.id, { fetch: t.f, check: free }), { result: 'exists', status: 'declined' });
  assert.equal(t.calls.length, 0);
});

test('a no after launch leaves the token launched', dbTest, async () => {
  const b = await builder();
  const t = fakeTokensFun(200, { success: true, tokenAddress: coin() });
  await launchBuilderToken(b.id, { fetch: t.f, check: free });
  assert.equal(await declineBuilderToken(b.id), 'launched');
});

test('nothing launches without the flag, an X account or a proven wallet', dbTest, async () => {
  const t = fakeTokensFun(200, { success: true, tokenAddress: coin() });
  process.env.EARNKIT_BUILDER_TOKENS = 'off';
  assert.deepEqual(await launchBuilderToken((await builder()).id, { fetch: t.f, check: free }), { result: 'off' });
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  assert.deepEqual(await launchBuilderToken((await builder({ wallet: false })).id, { fetch: t.f, check: free }), { result: 'not_ready' });
  assert.deepEqual(await launchBuilderToken((await builder({ x: false })).id, { fetch: t.f, check: free }), { result: 'not_ready' });
  assert.equal(t.calls.length, 0);
});

test('one token per X account: a second builder row on the same X account never launches', dbTest, async () => {
  const b = await builder();
  const t = fakeTokensFun(200, { success: true, tokenAddress: coin() });
  await launchBuilderToken(b.id, { fetch: t.f, check: free });
  // A stale second profile row carrying the same X account (the profile index forbids a live one).
  const [{ id: other }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v4-bt-${hex(8)}`}) RETURNING id`;
  const [row] = await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) VALUES (${other}, ${b.xId}, 'launching')
    ON CONFLICT DO NOTHING RETURNING 1`;
  assert.equal(row, undefined, 'x_user_id is unique');
});

test('tokens.fun stopped before minting: the claim is released and a later launch can try again', dbTest, async () => {
  const b = await builder();
  const busy = fakeTokensFun(503, { error: 'Pending transactions detected. Try again in a few minutes.', minted: false });
  assert.deepEqual(await launchBuilderToken(b.id, { fetch: busy.f, check: free }), { result: 'busy' });
  assert.equal(await builderToken(b.id), null);
  const ok = fakeTokensFun(200, { success: true, tokenAddress: coin() });
  assert.equal((await launchBuilderToken(b.id, { fetch: ok.f, check: free })).result, 'launched');
});

test('an unclear answer (502, no answer) is kept as unknown and never retried', dbTest, async () => {
  const b = await builder();
  const timeout = fakeTokensFun(502, { error: 'Deployment status unknown' });
  assert.deepEqual(await launchBuilderToken(b.id, { fetch: timeout.f, check: free }), { result: 'unknown' });
  assert.equal((await builderToken(b.id))?.status, 'unknown');
  const ok = fakeTokensFun(200, { success: true, tokenAddress: coin() });
  assert.deepEqual(await launchBuilderToken(b.id, { fetch: ok.f, check: free }), { result: 'exists', status: 'unknown' });
  assert.equal(ok.calls.length, 0);
  const b2 = await builder();
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  assert.deepEqual(await launchBuilderToken(b2.id, { fetch: down, check: free }), { result: 'unknown' });
});

test('builderTicker: the handle, skipping reserved and taken tickers; tokens.fun down is told apart from no free ticker', async () => {
  assert.deepEqual(await builderTicker('maya_builds', free), { symbol: 'MAYA' });
  const taken = new Set(['MAYA']);
  assert.deepEqual(await builderTicker('maya', async (s) => !taken.has(s)), { symbol: 'MAYA2' });
  assert.notDeepEqual(await builderTicker('usdc', free), { symbol: 'USDC' });
  assert.deepEqual(await builderTicker('maya', async () => null), { result: 'ticker_check_down' });
  assert.deepEqual(await builderTicker('maya', async () => false), { result: 'no_ticker' });
});

test('the ticker check down (try again) and no free ticker (lasting) are two results; neither writes a row', dbTest, async () => {
  const t = fakeTokensFun(200, { success: true, tokenAddress: coin() });
  const down = await builder();
  assert.deepEqual(await launchBuilderToken(down.id, { fetch: t.f, check: async () => null }), { result: 'ticker_check_down' });
  assert.equal(await builderToken(down.id), null);
  const none = await builder();
  assert.deepEqual(await launchBuilderToken(none.id, { fetch: t.f, check: async () => false }), { result: 'no_ticker' });
  assert.equal(await builderToken(none.id), null);
  assert.equal(t.calls.length, 0);
});

test('an X account held by another builder\'s row: x_taken from launch and from a no, nothing written for this builder', dbTest, async () => {
  const b = await builder();
  const [{ id: other }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v4-bt-${hex(8)}`}) RETURNING id`;
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) VALUES (${other}, ${b.xId}, 'launching')`;
  const t = fakeTokensFun(200, { success: true, tokenAddress: coin() });
  assert.deepEqual(await launchBuilderToken(b.id, { fetch: t.f, check: free }), { result: 'x_taken' });
  assert.equal(await declineBuilderToken(b.id), 'x_taken');
  assert.equal(await builderToken(b.id), null);
  assert.equal(t.calls.length, 0);
});

test('stuckBuilderTokens: unknown rows and launches older than 10 minutes wait on the owner; a fresh launch does not', dbTest, async () => {
  const row = async (status: string, minutesAgo: number) => {
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v4-bt-${hex(8)}`}) RETURNING id`;
    await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, updated_at)
      VALUES (${id}, ${`x${hex(6)}`}, ${status}, now() - make_interval(mins => ${minutesAgo}))`;
    return id;
  };
  const unknown = await row('unknown', 0);
  const old = await row('launching', 11);
  const fresh = await row('launching', 2);
  const launched = await row('launched', 60);
  const declined = await row('declined', 60);
  const stuck = await stuckBuilderTokens(new Date());
  assert.ok(stuck.includes(unknown) && stuck.includes(old));
  for (const id of [fresh, launched, declined]) assert.ok(!stuck.includes(id), `row ${id} is not stuck`);
});

// v4.0 final review 1: an opted-in builder's launch dropped at the proof (busy, the ticker check down, a 4xx, no API key)
// is retried by the hourly cron, at most BUILDER_TOKEN_RETRIES_PER_RUN a run, oldest offer first.
const freshCoins = () => {
  const calls: Record<string, unknown>[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ success: true, tokenAddress: coin() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
};
async function offered(at: string, o: { wallet?: boolean } = {}) {
  const b = await builder(o);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_build_object('token_offered', ${at}::text) WHERE builder_id = ${b.id}`;
  return b;
}

test('retryDroppedBuilderTokens: launches an offered, proven builder with no token row; never a declined one, one never offered, or one with no wallet', dbTest, async () => {
  const due = await offered('2026-10-01T00:00:00.000Z');
  const declined = await offered('2026-10-01T00:00:00.000Z');
  await declineBuilderToken(declined.id);
  const unoffered = await builder();
  const noWallet = await offered('2026-10-01T00:00:00.000Z', { wallet: false });
  const t = fakeTokensFun(200, { success: true, tokenAddress: coin() });
  const out = await retryDroppedBuilderTokens(new Date(), { fetch: t.f, check: free, only: [due.id, declined.id, unoffered.id, noWallet.id] });
  assert.deepEqual(out, { tried: 1, launched: 1, blocked: [] });
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].creatorWallet, due.wallet);
  assert.equal((await builderToken(due.id))?.status, 'launched');
  assert.equal((await builderToken(declined.id))?.status, 'declined');
  assert.equal(await builderToken(unoffered.id), null);
  assert.equal(await builderToken(noWallet.id), null);
  // Off: nothing is tried.
  process.env.EARNKIT_BUILDER_TOKENS = 'off';
  const later = await offered('2026-10-01T00:00:00.000Z');
  assert.deepEqual(await retryDroppedBuilderTokens(new Date(), { fetch: t.f, check: free, only: [later.id] }), { tried: 0, launched: 0, blocked: [] });
});

test(`retryDroppedBuilderTokens: at most ${BUILDER_TOKEN_RETRIES_PER_RUN} a run, oldest offer first; busy and the ticker check down simply retry next run`, dbTest, async () => {
  const bs = [];
  for (let i = 6; i >= 1; i--) bs.push(await offered(`2026-10-0${i}T00:00:00.000Z`));
  const only = bs.map((b) => b.id);
  const busy = fakeTokensFun(503, { error: 'Pending transactions detected. Try again in a few minutes.', minted: false });
  const first = await retryDroppedBuilderTokens(new Date(), { fetch: busy.f, check: free, only });
  assert.deepEqual(first, { tried: BUILDER_TOKEN_RETRIES_PER_RUN, launched: 0, blocked: [] });
  // Oldest offer first: the newest (Oct 6, bs[0]) waits.
  assert.deepEqual(busy.calls.map((c) => c.creatorWallet), [...bs].reverse().slice(0, 5).map((b) => b.wallet));
  for (const b of bs) assert.equal(await builderToken(b.id), null);
  assert.deepEqual(await blockedBuilderTokens(only), []);
  // The ticker check down is not a block either.
  const extra = await offered('2026-10-01T00:00:00.000Z');
  const down = await retryDroppedBuilderTokens(new Date(), { fetch: busy.f, check: async () => null, only: [extra.id] });
  assert.deepEqual(down, { tried: 1, launched: 0, blocked: [] });
  assert.equal(await builderToken(extra.id), null);
  // The next run starts with the one not tried yet.
  const ok = freshCoins();
  const second = await retryDroppedBuilderTokens(new Date(), { fetch: ok.f, check: free, only });
  assert.equal(ok.calls[0].creatorWallet, bs[0].wallet, 'never tried goes first');
  assert.equal(second.launched, 5);
});

test('retryDroppedBuilderTokens: no API key or a 4xx refusal waits on the owner (blocked) until a later launch goes through', dbTest, async () => {
  const keyless = await offered('2026-10-01T00:00:00.000Z');
  const refused = await offered('2026-10-01T00:00:00.000Z');
  const t = freshCoins();
  delete process.env.TOKENSFUN_DEPLOY_API_KEY;
  assert.deepEqual(await retryDroppedBuilderTokens(new Date(), { fetch: t.f, check: free, only: [keyless.id] }), { tried: 1, launched: 0, blocked: [keyless.id] });
  assert.equal(t.calls.length, 0);
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  const no = fakeTokensFun(400, { error: 'Invalid name' });
  assert.deepEqual(await retryDroppedBuilderTokens(new Date(), { fetch: no.f, check: free, only: [refused.id] }), { tried: 1, launched: 0, blocked: [refused.id] });
  assert.equal(await builderToken(refused.id), null);
  assert.deepEqual(await blockedBuilderTokens([keyless.id, refused.id]), [keyless.id, refused.id].sort((a, b) => a - b));
  // Fixed: the next run launches both and the block clears.
  const both = await retryDroppedBuilderTokens(new Date(), { fetch: t.f, check: free, only: [keyless.id, refused.id] });
  assert.equal(both.launched, 2);
  assert.deepEqual(await blockedBuilderTokens([keyless.id, refused.id]), []);
});
