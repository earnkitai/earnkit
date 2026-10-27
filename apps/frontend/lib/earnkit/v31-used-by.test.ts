import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { person } from './fixtures/find';
import { AlchemyNetworkOff, AlchemyReverted, alchemyCall, contractSends, type AlchemyCall } from './alchemy';
import { BUILDER_CODES_SUFFIX, codesFromText } from './builder-code';
import { Attribution } from 'ox/erc8021';
import { BUILDER_CODES_REGISTRY, CDP_SQL_URL, USED_CONTRACTS, USED_PAGES, codesUsage, contractsDue, contractsUsage, ownedCodes, runUsedBy, tellBuilderCode, usageSql, verifyCodes } from './used-by';
import { decodeFunctionData, encodeFunctionResult, getAddress, parseAbi } from 'viem';
import { BUILDER_CODE_INVALID, BUILDER_CODE_SAVED, tools, type ToolContext } from './tools';
import { USED_MIN, githubFileHref, usedByOf, type UsageRow } from './site-data';
import { runCron } from './cron';

/**
 * v3.1 Used by (2026-10-27, design v3.1-used-by.md): the people who used a builder's work in the last 30 days, from
 * their own contracts (Alchemy) and their Base Builder Code (the CDP SQL API, one query a day for everyone), and the
 * Highlights row that shows the larger. Every outside read is a fake.
 */
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const NOW = new Date('2026-10-27T12:00:00Z');
const DAY = 86_400_000;
const addr = () => `0x${randomBytes(20).toString('hex')}`;
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
let n = 0;

/** A Bench-confirmed builder whose one project is an App-proven repo, with `wallets` proven wallets. */
async function builder(o: { wallets?: number; confirmed?: boolean } = {}): Promise<{ id: number; key: string; wallets: string[] }> {
  n++;
  const key = `ub${process.pid}o${n}/app${n}`;
  const id = await person({ projects: [{ key, name: `App ${n}`, confirmed: o.confirmed ?? true }], main: key });
  await sql()`UPDATE builder_sources SET proof = 'github_app' WHERE builder_id = ${id} AND kind = 'repo'`;
  if (o.confirmed === false)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at) VALUES (${id}, 'repo', ${key}, ${key}, 'github_app', 'verified', 'agent', now())`;
  const wallets = Array.from({ length: o.wallets ?? 1 }, addr);
  for (const w of wallets) await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${w}, ${id})`;
  return { id, key, wallets };
}

// ---------------------------------------------------------------------------------------------- code extraction

test('codesFromText: a hex data-suffix literal decoded, codes arrays in either quote; only ^[a-z0-9_]{1,64}$, no repeats', () => {
  const suffix = Attribution.toDataSuffix({ codes: ['maya_app', 'base'] });
  assert.ok(suffix.endsWith(BUILDER_CODES_SUFFIX));
  assert.deepEqual(codesFromText(`export const DATA_SUFFIX = '${suffix}';`), ['maya_app', 'base']);
  assert.deepEqual(codesFromText(`const S = "${suffix.toUpperCase().replace('0X', '0x')}"`), ['maya_app', 'base'], 'any case');
  assert.deepEqual(codesFromText(`Attribution.toDataSuffix({ codes: ['lena'] })`), ['lena']);
  assert.deepEqual(codesFromText(`Attribution.toDataSuffix({\n  codes: ["omar", 'omar', "x_1"],\n})`), ['omar', 'x_1']);
  assert.deepEqual(codesFromText(`toDataSuffix({ codes: ['Bad-Code', "a'); DROP TABLE x; --", '${'a'.repeat(65)}'] })`), [], 'anything else is dropped, never escaped');
  assert.deepEqual(codesFromText('await walletClient.sendTransaction({ to, dataSuffix: process.env.NEXT_PUBLIC_SUFFIX });'), [], 'an env var cannot be seen');
});

// ---------------------------------------------------------------------------------------------- the CDP query

test('usageSql: one query for every code, GROUP BY code over an IN list; invalid codes and wallets never go in; the 30-day cut; exclusions per code', () => {
  const W = `0x${'a'.repeat(40)}`;
  const q = usageSql(['zed', 'alpha_1', "x' OR 1=1 --", 'UPPER', 'zed'], [['zed', W], ['zed', 'not-a-wallet'], ['nobody', W]], new Date('2026-09-27T12:00:00Z'))!;
  assert.equal(q, [
    'SELECT code, count() AS users, countIf(weeks >= 2) AS returning_users',
    'FROM (',
    '  SELECT code, wallet, uniqExact(toMonday(ts)) AS weeks',
    '  FROM (',
    '    SELECT a.builder_code AS code, lower(t.from_address) AS wallet, a.block_timestamp AS ts',
    '    FROM base.transaction_attributions a',
    '    INNER JOIN base.transactions t ON t.transaction_hash = a.transaction_hash',
    "    WHERE a.action = 1 AND t.action = 1 AND a.block_timestamp >= toDateTime('2026-09-27 12:00:00', 'UTC') AND a.builder_code IN ('alpha_1', 'zed')",
    '    UNION ALL',
    '    SELECT code, lower(o.sender) AS wallet, o.block_timestamp AS ts',
    '    FROM base.decoded_user_operations o',
    '    ARRAY JOIN o.builder_codes AS code',
    "    WHERE o.action = 1 AND o.success = 'success' AND o.block_timestamp >= toDateTime('2026-09-27 12:00:00', 'UTC') AND code IN ('alpha_1', 'zed')",
    '  )',
    `  WHERE (code, wallet) NOT IN (('zed', '${W}'))`,
    '  GROUP BY code, wallet',
    ')',
    'GROUP BY code',
    'ORDER BY code',
  ].join('\n'));
  assert.doesNotMatch(q, /OR 1=1|UPPER|not-a-wallet|nobody/);
  assert.equal(usageSql(['Bad-Code', ''], [], NOW), null, 'no valid code: no query');
  assert.doesNotMatch(usageSql(['solo'], [], NOW)!, /NOT IN/, 'no exclusions: no NOT IN ()');
});

/** A fake CDP: records each call; answers `rows` (or `status`). */
function cdp(rows: Record<string, unknown>[], status = 200) {
  const calls: { url: string; headers: Headers; body: { sql: string } }[] = [];
  const f = (async (u: string | URL, init?: RequestInit) => {
    calls.push({ url: String(u), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ metadata: { rowCount: rows.length }, result: rows }), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}
async function withCdpKey<T>(f: () => Promise<T>): Promise<T> {
  process.env.CDP_CLIENT_API_KEY = 'cdp-test-key';
  try {
    return await f();
  } finally {
    delete process.env.CDP_CLIENT_API_KEY;
  }
}
const codesRow = (repo: string, codes: string[], path = 'src/onchain/tx.ts') => sql()`
  INSERT INTO repo_builder_codes (repo_key, found, checked_at, path, codes) VALUES (${repo}, true, ${NOW}, ${path}, ${codes}::text[])
  ON CONFLICT (repo_key) DO UPDATE SET codes = EXCLUDED.codes, path = EXCLUDED.path`;
const usage = async (id: number, source: string) => [...await sql()<{ day: string; users: number; returning: number; capped: boolean; href: string | null; chains: string[] }[]>`
  SELECT day::text, users, "returning" AS returning, capped, href, chains FROM app_usage WHERE builder_id = ${id} AND source = ${source} ORDER BY day`];

/**
 * A fake Builder Codes registry on Base: payoutAddress(code) answers `payouts[code]`; 'revert' reverts (Unregistered),
 * 'fail' fails the read. Records the codes asked.
 */
function registry(payouts: Record<string, string>) {
  const asked: string[] = [];
  const call = (async (method: string, params: unknown[]) => {
    const q = params[0] as { to: string; data: `0x${string}` };
    assert.equal(method, 'eth_call');
    assert.equal(q.to, BUILDER_CODES_REGISTRY);
    const { args } = decodeFunctionData({ abi: PAYOUT_ABI, data: q.data });
    const code = String(args[0]);
    asked.push(code);
    const p = payouts[code];
    if (p === undefined || p === 'revert') throw new AlchemyReverted('eth_call');
    if (p === 'fail') throw new Error('Alchemy eth_call returned 500');
    return encodeFunctionResult({ abi: PAYOUT_ABI, functionName: 'payoutAddress', result: p as `0x${string}` });
  }) as AlchemyCall;
  return { call, asked };
}
const PAYOUT_ABI = parseAbi(['function payoutAddress(string code) view returns (address)']);
const claims = async (id: number) => [...await sql()<{ code: string; told: boolean; payout: string | null; owned: boolean }[]>`
  SELECT code, told, payout, owned FROM builder_code_claims WHERE builder_id = ${id} ORDER BY code`];

test('verifyCodes: a code counts only when Base\'s registry pays a wallet the builder proved; someone else\'s, unregistered or a failed read never; two candidates, one owner', db, async () => {
  const a = await builder({ wallets: 2 });
  const copycat = await builder();
  const told = await builder();
  const unconfirmed = await builder({ confirmed: false });
  await codesRow(a.key, ['maya', 'maya_old', 'nobody']);
  // A popular app's code pasted into another builder's repo is only a candidate.
  await codesRow(copycat.key, ['maya', 'flaky']);
  await codesRow(unconfirmed.key, ['ghost']);
  assert.equal(await tellBuilderCode(told.id, 'told_code'), true);
  assert.equal(await tellBuilderCode(told.id, 'Bad-Code'), false);
  const only = [a.id, copycat.id, told.id, unconfirmed.id];
  const stranger = addr();
  const reg = registry({ maya: getAddress(a.wallets[0]), maya_old: a.wallets[1], nobody: stranger, flaky: 'fail', told_code: told.wallets[0], ghost: unconfirmed.wallets[0] });
  const now = new Date('2026-10-20T08:00:00Z');
  assert.deepEqual(await verifyCodes(now, reg.call, { deadline: Date.now() + 5000, only }), { due: 6, verified: 5, owned: 3, failed: 1 });
  assert.ok(!reg.asked.includes('ghost'), 'only Bench-confirmed builders are verified');
  assert.deepEqual(await claims(a.id), [
    { code: 'maya', told: false, payout: a.wallets[0], owned: true },
    { code: 'maya_old', told: false, payout: a.wallets[1], owned: true },
    { code: 'nobody', told: false, payout: stranger, owned: false },
  ]);
  assert.deepEqual(await claims(copycat.id), [
    { code: 'flaky', told: false, payout: null, owned: false },
    { code: 'maya', told: false, payout: a.wallets[0], owned: false },
  ], 'the copy never counts, and the real owner keeps it (no "neither" rule)');
  assert.deepEqual(await claims(told.id), [{ code: 'told_code', told: true, payout: told.wallets[0], owned: true }]);
  assert.deepEqual([...(await ownedCodes({ only, now })).entries()].map(([c, v]) => [c, v.builder_id, v.path]), [
    ['maya', a.id, 'src/onchain/tx.ts'], ['maya_old', a.id, 'src/onchain/tx.ts'], ['told_code', told.id, null],
  ]);
  // Verified at most daily: the same day only the failed read is asked again.
  reg.asked.length = 0;
  await verifyCodes(new Date(now.getTime() + 3_600_000), reg.call, { deadline: Date.now() + 5000, only });
  assert.deepEqual(reg.asked, ['flaky']);
  // A day later the payout moved away from a proven wallet: no longer owned. A failed read keeps the verdict it had
  // (never grants one), and an unregistered code (a revert) is not owned.
  const later = new Date(now.getTime() + 25 * 3_600_000);
  const moved = registry({ maya: stranger, maya_old: 'fail', nobody: 'revert', flaky: a.wallets[0], told_code: 'revert' });
  await verifyCodes(later, moved.call, { deadline: Date.now() + 5000, only });
  assert.deepEqual((await claims(a.id)).map((r) => [r.code, r.payout, r.owned]), [['maya', stranger, false], ['maya_old', a.wallets[1], true], ['nobody', null, false]]);
  assert.deepEqual((await claims(copycat.id)).map((r) => [r.code, r.owned]), [['flaky', false], ['maya', false]], 'paid to another builder\'s wallet: not owned');
  assert.deepEqual((await claims(told.id)).map((r) => [r.code, r.payout, r.owned]), [['told_code', null, false]]);
  // A failed read of a code never verified grants nothing.
  const fresh = await builder();
  await tellBuilderCode(fresh.id, 'fresh_code');
  await verifyCodes(later, registry({ fresh_code: 'fail' }).call, { deadline: Date.now() + 5000, only: [fresh.id] });
  assert.deepEqual(await claims(fresh.id), [{ code: 'fresh_code', told: true, payout: null, owned: false }]);
  assert.equal((await ownedCodes({ only: [fresh.id], now: later })).size, 0);
});

test('security review 2: told codes are the builder\'s (an installation resolves to its root), at most TOLD_MAX; an owned verdict past OWNED_MAX_MS stops counting; held verdicts are re-checked first', db, async () => {
  const b = await builder();
  // A second installation of the same builder names a code: the claim is the builder's, not the installation's.
  const [inst] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, builder_id) VALUES (${'ub2' + randomBytes(8).toString('hex')}, ${b.id}) RETURNING id`;
  assert.equal(await tellBuilderCode(inst.id, 'via_second'), true);
  for (const c of ['t_one', 't_two', 't_three', 't_four']) assert.equal(await tellBuilderCode(b.id, c), true);
  assert.deepEqual((await claims(b.id)).map((r) => r.code), ['t_four', 't_three', 't_two'], 'the newest TOLD_MAX told codes stay');
  const now = new Date('2026-10-20T08:00:00Z');
  const reg = registry({ t_two: b.wallets[0], t_three: addr(), t_four: addr() });
  await verifyCodes(now, reg.call, { deadline: Date.now() + 5000, only: [b.id] });
  assert.deepEqual([...(await ownedCodes({ only: [b.id], now })).keys()], ['t_two']);
  assert.equal((await ownedCodes({ only: [b.id], now: new Date(now.getTime() + 3 * DAY + 1) })).size, 0, 'a stale verdict no longer counts');
  // An owned code past its re-check comes before never-verified candidates, even with a one-read run.
  await tellBuilderCode(b.id, 't_five');
  reg.asked.length = 0;
  await verifyCodes(new Date(now.getTime() + 2 * DAY), reg.call, { deadline: Date.now() + 5000, only: [b.id], limit: 1 });
  assert.deepEqual(reg.asked, ['t_two']);
});

test('alchemyCall: an eth_call the contract reverted is AlchemyReverted (a verdict), any other error is not', async () => {
  const real = globalThis.fetch;
  let body: object = { jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted', data: '0x' } };
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  process.env.ALCHEMY_API_KEY = 'k';
  try {
    await assert.rejects(alchemyCall(Date.now() + 5000)('eth_call', []), AlchemyReverted);
    body = { jsonrpc: '2.0', id: 1, error: { message: 'rate limited' } };
    await assert.rejects(alchemyCall(Date.now() + 5000)('eth_call', []), (e: unknown) => !(e instanceof AlchemyReverted));
  } finally {
    globalThis.fetch = real;
    delete process.env.ALCHEMY_API_KEY;
  }
});

test('tell builder_code: stored as a candidate with one short sentence; anything else is refused and nothing is stored', db, async () => {
  const b = await builder();
  const ctx = { installationId: b.id, sharedClient: false } as ToolContext;
  const ok = (await tools.tell({ builder_code: ' my_app ' }, ctx)) as { show_to_builder?: string };
  assert.equal(ok.show_to_builder, BUILDER_CODE_SAVED);
  assert.deepEqual(await claims(b.id), [{ code: 'my_app', told: true, payout: null, owned: false }]);
  const bad = (await tools.tell({ builder_code: "x'); DROP TABLE app_usage; --" }, ctx)) as { show_to_builder?: string };
  assert.equal(bad.show_to_builder, BUILDER_CODE_INVALID);
  assert.equal((await claims(b.id)).length, 1);
  for (const line of [BUILDER_CODE_SAVED, BUILDER_CODE_INVALID]) assert.doesNotMatch(line, /—|\?.*\?/);
});

test('codesUsage: no key is off (nothing asked); one query a day for every owned code, the builders\' proven wallets excluded', db, async () => {
  const a = await builder({ wallets: 2 });
  const b = await builder();
  const copycat = await builder();
  await codesRow(a.key, ['maya', 'maya_old']);
  await codesRow(b.key, ['lena']);
  await codesRow(copycat.key, ['maya']);
  const only = [a.id, b.id, copycat.id];
  const now = new Date('2026-10-20T08:00:00Z');
  await verifyCodes(now, registry({ maya: a.wallets[0], maya_old: a.wallets[1], lena: b.wallets[0] }).call, { deadline: Date.now() + 5000, only });
  const off = cdp([]);
  assert.deepEqual(await codesUsage(now, { fetch: off.f, deadline: Date.now() + 5000, only }), { step: 'off' });
  assert.equal(off.calls.length, 0);
  const fake = cdp([
    { code: 'maya', users: '120', returning_users: '30' },
    { code: 'maya_old', users: 40, returning_users: 40 },
    { code: 'lena', users: 9, returning_users: 0 },
  ]);
  await withCdpKey(async () => {
    assert.deepEqual(await codesUsage(now, { fetch: fake.f, deadline: Date.now() + 5000, only }), { codes: 3, builders: 2 });
    assert.equal(fake.calls.length, 1, 'one query for every builder');
    const [call] = fake.calls;
    assert.equal(call.url, CDP_SQL_URL);
    assert.equal(call.headers.get('authorization'), 'Bearer cdp-test-key');
    assert.equal(call.headers.get('content-type'), 'application/json');
    assert.match(call.body.sql, /IN \('lena', 'maya', 'maya_old'\)/);
    for (const w of a.wallets) assert.ok(call.body.sql.includes(`('maya', '${w}')`) && call.body.sql.includes(`('maya_old', '${w}')`), 'its builder\'s proven wallets');
    assert.ok(call.body.sql.includes(`('lena', '${b.wallets[0]}')`));
    assert.ok(!call.body.sql.includes(copycat.wallets[0]), 'the copycat owns nothing');
    assert.match(call.body.sql, /toDateTime\('2026-09-20 08:00:00', 'UTC'\)/, 'the last 30 days');
    // Once a day: the second run the same day asks nothing.
    assert.deepEqual(await codesUsage(new Date('2026-10-20T20:00:00Z'), { fetch: fake.f, deadline: Date.now() + 5000, only }), { step: 'done_today' });
    assert.equal(fake.calls.length, 1);
  });
  // The larger code's numbers (never summed), linked to the file the code is in.
  assert.deepEqual(await usage(a.id, 'builder_code'), [{ day: '2026-10-20', users: 120, returning: 30, capped: false, href: githubFileHref(a.key, null, 'src/onchain/tx.ts'), chains: ['base'] }]);
  assert.deepEqual((await usage(b.id, 'builder_code')).map((r) => r.users), [9], 'stored under USED_MIN too (the row hides it)');
  assert.deepEqual(await usage(copycat.id, 'builder_code'), []);
});

test('codesUsage: no owned code asks nothing and spends no day; a CDP error stores nothing', db, async () => {
  const lone = await builder();
  const fake = cdp([], 500);
  await withCdpKey(async () => {
    assert.deepEqual(await codesUsage(new Date('2026-10-10T08:00:00Z'), { fetch: fake.f, deadline: Date.now() + 5000, only: [lone.id] }), { step: 'none' });
    assert.equal(fake.calls.length, 0);
    await codesRow(lone.key, ['lone']);
    await verifyCodes(new Date('2026-10-11T07:00:00Z'), registry({ lone: lone.wallets[0] }).call, { deadline: Date.now() + 5000, only: [lone.id] });
    await assert.rejects(codesUsage(new Date('2026-10-11T08:00:00Z'), { fetch: fake.f, deadline: Date.now() + 5000, only: [lone.id] }), /CDP SQL returned 500/);
  });
  assert.deepEqual(await usage(lone.id, 'builder_code'), []);
});

// ---------------------------------------------------------------------------------------------- the contracts source

/**
 * A fake Alchemy per network: `sends[address]` the external transfers to a contract (newest first, [from, msAgo]) in
 * pages of `pageSize`; `funded[wallet]` who a wallet sent ETH to; `tokens` answer decimals() and totalSupply(); `off`
 * networks answer not enabled. Records every call.
 */
function alchemy(o: { sends?: Record<string, [string, number][]>; funded?: Record<string, string[]>; tokens?: string[]; off?: string[]; pageSize?: number }) {
  const calls: { network: string; method: string; q: Record<string, unknown> }[] = [];
  const word = `0x${'0'.repeat(63)}1`;
  const size = o.pageSize ?? 1000;
  const callFor = (network: string) => (async (method: string, params: unknown[]) => {
    const q = (params[0] ?? {}) as Record<string, unknown>;
    calls.push({ network, method, q });
    if (o.off?.includes(network)) throw new AlchemyNetworkOff(network);
    if (method === 'eth_call') {
      if (o.tokens?.includes(String(q.to))) return word;
      throw new Error('execution reverted');
    }
    if (q.fromAddress) return { transfers: (o.funded?.[String(q.fromAddress)] ?? []).map((to) => ({ from: q.fromAddress, to })) };
    const all = o.sends?.[String(q.toAddress)] ?? [];
    const start = q.pageKey ? Number(q.pageKey) : 0;
    const page = all.slice(start, start + size).map(([from, ago]) => ({ from, to: q.toAddress, metadata: { blockTimestamp: iso(ago) } }));
    return { transfers: page, ...(start + size < all.length && { pageKey: String(start + size) }) };
  }) as AlchemyCall;
  return { callFor, calls };
}
/** A counted contract a proven wallet created on `chain`, `daysAgo` old. */
async function made(wallet: string, chain: string, daysAgo = 100): Promise<string> {
  const a = addr();
  await sql()`INSERT INTO wallet_contracts (chain, address, wallet, created_at, counts) VALUES (${chain}, ${a}, ${wallet}, ${iso(daysAgo * DAY)}, true)`;
  return a;
}

test('contractSends: newest first until one is older than the cut; at most `pages` pages, then capped', async () => {
  const C = addr();
  const u = Array.from({ length: 7 }, addr);
  const { callFor, calls } = alchemy({ sends: { [C]: [[u[0], DAY], [u[1], 2 * DAY], [u[2], 31 * DAY], [u[3], 32 * DAY]] }, pageSize: 2 });
  const since = NOW.getTime() - 30 * DAY;
  assert.deepEqual(await contractSends(C, callFor('base-mainnet'), since, USED_PAGES), { sends: [{ from: u[0], at: NOW.getTime() - DAY }, { from: u[1], at: NOW.getTime() - 2 * DAY }], capped: false });
  assert.equal(calls.length, 2, 'stops at the first page holding an older one');
  assert.deepEqual(calls[0].q, { category: ['external'], excludeZeroValue: false, withMetadata: true, toAddress: C, order: 'desc', maxCount: '0x3e8' });
  const busy = alchemy({ sends: { [C]: u.map((w) => [w, DAY] as [string, number]) }, pageSize: 2 });
  const r = await contractSends(C, busy.callFor('base-mainnet'), since, 3);
  assert.equal(r.sends.length, 6);
  assert.equal(r.capped, true, 'the last page allowed still had more');
  assert.equal(busy.calls.length, 3);
});

test('contractsUsage: outside senders in the last 30 days; proven wallets, deployers and wallets a proven wallet funded never count; returning; busiest linked; a disabled network skipped', db, async () => {
  const b = await builder({ wallets: 2 });
  const [w1, w2] = b.wallets;
  const base1 = await made(w1, 'base', 10);
  const base2 = await made(w2, 'base', 20);
  const arb = await made(w1, 'arbitrum', 30);
  const opt = await made(w1, 'optimism', 5);
  // A verified contract source on Base deployed by another wallet (EarnKit's deployer), and one that is a token.
  const deployer = addr();
  const src = addr();
  const coin = addr();
  for (const [a, dep] of [[src, deployer], [coin, deployer]] as const)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at, deployer) VALUES (${b.id}, 'contract', ${`base:${a}`}, ${b.key}, 'deployer', 'verified', 'server', now(), ${dep})`;
  const people = Array.from({ length: 6 }, addr);
  const [p0, p1, p2, p3, p4, p5] = people;
  const funded = addr();
  const { callFor, calls } = alchemy({
    sends: {
      [base1]: [[p0, 1 * DAY], [p1, 2 * DAY], [p0, 9 * DAY], [w1, 3 * DAY], [funded, 4 * DAY], [p5, 31 * DAY]],
      [base2]: [[p2, 1 * DAY], [w2, 1 * DAY]],
      [src]: [[p3, 1 * DAY], [deployer, 2 * DAY], [p3, DAY + 3_600_000]],
      [coin]: [[p4, DAY]],
      [arb]: [[p1, 15 * DAY], [p4, DAY]],
      [opt]: [[p5, DAY]],
    },
    funded: { [w2]: [funded] },
    tokens: [coin],
    off: ['opt-mainnet'],
  });
  const u = await contractsUsage(b.id, NOW, callFor);
  // p0 (2 weeks), p1 (base and arbitrum, 2 weeks), p2, p3, p4 (arbitrum only: the coin never counts). p5 only on a
  // disabled network or older than 30 days. w1, w2, the deployer and the funded wallet never.
  assert.deepEqual(u, { users: 5, returning: 2, capped: false, href: `https://basescan.org/address/${base1}`, chains: ['base', 'arbitrum'] });
  assert.ok(!calls.some((c) => c.q.toAddress === coin), 'a token is never read for users');
  assert.ok(calls.filter((c) => c.q.fromAddress).every((c) => c.q.excludeZeroValue === true && c.q.order === 'desc'), 'funding reads: ETH sent, one page');
  assert.deepEqual(await contractsUsage((await builder()).id, NOW, callFor), null, 'no contract: no row');
});

test('contractsUsage: at most USED_CONTRACTS (the newest) per builder; a capped contract marks the read', db, async () => {
  const b = await builder();
  const all: string[] = [];
  for (let i = 0; i < USED_CONTRACTS + 2; i++) all.push(await made(b.wallets[0], 'base', i + 1));
  const people = Array.from({ length: 3 }, addr);
  const sends = Object.fromEntries(all.map((a) => [a, people.map((p) => [p, DAY] as [string, number])]));
  sends[all[0]] = Array.from({ length: 7 }, () => [addr(), DAY] as [string, number]);
  const { callFor, calls } = alchemy({ sends, pageSize: 1 });
  const u = (await contractsUsage(b.id, NOW, callFor))!;
  const read = new Set(calls.filter((c) => c.q.toAddress).map((c) => c.q.toAddress));
  assert.equal(read.size, USED_CONTRACTS);
  assert.ok(!read.has(all.at(-1)) && !read.has(all.at(-2)), 'the two oldest are not read');
  assert.equal(u.capped, true);
  assert.equal(u.users, 3 + USED_PAGES, 'a capped read counts what it saw');
});

test('runUsedBy: off without Alchemy; each due builder read once a UTC day; only Bench-confirmed builders; the cron runs it in its own step', db, async () => {
  const b = await builder();
  const c = await made(b.wallets[0], 'base');
  const people = Array.from({ length: 12 }, addr);
  const fake = alchemy({ sends: { [c]: people.map((p, i) => [p, (i + 1) * DAY] as [string, number]) } });
  const unconfirmed = await builder({ confirmed: false });
  await made(unconfirmed.wallets[0], 'base');
  const only = [b.id, unconfirmed.id];
  assert.deepEqual(await contractsDue(NOW, { only }), [b.id]);
  assert.deepEqual((await runUsedBy(NOW, { deadline: Date.now() + 5000, only })).contracts, { step: 'off' });
  const first = await runUsedBy(NOW, { deadline: Date.now() + 5000, only, callFor: fake.callFor });
  assert.deepEqual(first, { registry: { due: 0, verified: 0, owned: 0, failed: 0 }, builder_code: { step: 'off' }, contracts: { due: 1, read: 1 } });
  const reads = fake.calls.length;
  assert.deepEqual((await usage(b.id, 'contracts')).map((r) => [r.day, r.users]), [['2026-10-27', 12]]);
  assert.deepEqual((await runUsedBy(new Date(NOW.getTime() + 3_600_000), { deadline: Date.now() + 5000, only, callFor: fake.callFor })).contracts, { due: 0, read: 0 });
  assert.equal(fake.calls.length, reads, 'nothing read again the same day');
  // The cron's step (scoped by `only`), the next day.
  const r = await runCron({ now: new Date(NOW.getTime() + DAY), only: ['none'], deps: { usedBy: { callFor: fake.callFor, only } } });
  assert.deepEqual(r.used_by, { registry: { due: 0, verified: 0, owned: 0, failed: 0 }, builder_code: { step: 'off' }, contracts: { due: 1, read: 1 } });
  assert.deepEqual((await usage(b.id, 'contracts')).map((x) => x.day), ['2026-10-27', '2026-10-28']);
});

// ---------------------------------------------------------------------------------------------- the row

const row = (o: Partial<UsageRow>): UsageRow => ({ source: 'contracts', users: 120, returning: 30, capped: false, href: `https://basescan.org/address/0x${'b'.repeat(40)}`, chains: ['base'], ...o });

test('usedByOf: "Used by N people in the last 30 days" from USED_MIN; "P% came back", else where; capped is "N+"; the larger source wins; links', () => {
  assert.equal(USED_MIN, 10);
  assert.deepEqual(usedByOf([row({ users: 1234, returning: 370 })], null), {
    icon: 'users', title: 'Used by 1,234 people in the last 30 days', sub: '30% came back', href: `https://basescan.org/address/0x${'b'.repeat(40)}`,
  });
  assert.equal(usedByOf([row({ users: 9 })], null), null, 'under USED_MIN: no row');
  assert.equal(usedByOf([], null), null);
  assert.equal(usedByOf([row({ users: 10, returning: 0 })], null)?.sub, 'On Base');
  assert.equal(usedByOf([row({ users: 300, returning: 1, chains: ['base', 'arbitrum'] })], null)?.sub, 'On 2 chains', 'P rounds to 0');
  assert.equal(usedByOf([row({ users: 10, returning: 0, chains: [] })], null)?.sub, '');
  assert.equal(usedByOf([row({ users: 5000, capped: true })], null)?.title, 'Used by 5,000+ people in the last 30 days');
  // The larger wins (never summed); a Builder Code number links the file only while it is in the public main repo.
  const repo = 'https://github.com/maya/app';
  const code = row({ source: 'builder_code', users: 500, returning: 0, href: `${repo}/blob/HEAD/src/tx.ts`, chains: ['base'] });
  assert.deepEqual(usedByOf([row({ users: 120 }), code], repo), { icon: 'users', title: 'Used by 500 people in the last 30 days', sub: 'On Base', href: `${repo}/blob/HEAD/src/tx.ts` });
  assert.equal(usedByOf([row({ users: 120 }), code], null)?.href, undefined, 'a private or hidden repo: no link');
  assert.equal(usedByOf([row({ users: 120 }), code], 'https://github.com/other/app')?.href, undefined, 'another repo: no link');
  assert.equal(usedByOf([row({ users: 600 }), code], repo)?.title, 'Used by 600 people in the last 30 days');
  assert.equal(usedByOf([row({ href: 'https://evil.example/address/0x' + 'b'.repeat(40) })], null)?.href, undefined, 'only a chain explorer');
  for (const h of [usedByOf([row({})], null)!, usedByOf([code], repo)!]) assert.doesNotMatch(`${h.title} ${h.sub}`, /0x|—|1 person/);
});
