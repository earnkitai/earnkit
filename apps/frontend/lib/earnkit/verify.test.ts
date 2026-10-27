import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Chain } from './chains';
import { sql } from './db';
import { ErrorPageError, safeProbe } from './safe-fetch';
import {
  CheckBudget,
  ENTRY_BUDGET,
  LIST_BUDGET,
  addressesFrom,
  cacheFresh,
  contractDeployed,
  entryVerified,
  hasCode,
  liveCheckDetail,
  liveVerified,
  placeholderHost,
  placeholderLink,
  rpcFor,
  txCount,
  type CheckCache,
} from './verify';

test('1.1 placeholderHost and placeholderLink', () => {
  for (const h of [
    'example.com',
    'www.example.org',
    'foo.example',
    'a.test',
    'x.invalid',
    'localhost',
    'app.localhost',
    'printer.local',
    'yourdomain.com',
    'yoursite.com',
    'domain.com',
    'test.com',
    'myapp.com',
    '127.0.0.1',
    '[::1]',
    '10.0.0.1',
    'earnkit.com',
    'EXAMPLE.COM.',
  ])
    assert.equal(placeholderHost(h), true, h);
  for (const h of ['tipjar.xyz', 'examples.dev', 'my-example.com', 'tipjar-alice.earnkit.com'])
    assert.equal(placeholderHost(h), false, h);
  assert.equal(placeholderLink('https://github.com/earnkitai/chain-kits'), true);
  assert.equal(placeholderLink('https://github.com/EarnKitAI'), true);
  assert.equal(placeholderLink('https://github.com/alice/tipjar'), false);
  assert.equal(placeholderLink('https://github.com/earnkitaix/x'), false);
  assert.equal(placeholderLink('not a link'), false);
});

test('1.2 hasCode: empty, 0x and an EIP-7702 delegation are not deployed', () => {
  assert.equal(hasCode('0x'), false);
  assert.equal(hasCode(''), false);
  assert.equal(hasCode(`0xef0100${'ab'.repeat(20)}`), false);
  assert.equal(hasCode('0x6080'), true);
});

test('1.3 cacheFresh: a pass for 24 h, a failure for 1 h', () => {
  const at = new Date('2026-10-08T00:00:00Z');
  const plus = (min: number) => new Date(at.getTime() + min * 60_000);
  assert.equal(cacheFresh({ ok: true, checked_at: at }, plus(23 * 60 + 59)), true);
  assert.equal(cacheFresh({ ok: true, checked_at: at }, plus(24 * 60)), false);
  assert.equal(cacheFresh({ ok: false, checked_at: at }, plus(59)), true);
  assert.equal(cacheFresh({ ok: false, checked_at: at }, plus(60)), false);
});

test('1.4 rpcFor: the variable, else the public default, else null', () => {
  assert.equal(rpcFor('base', { BASE_RPC_URL: 'https://x' }), 'https://x');
  assert.equal(rpcFor('base', { BASE_RPC_URL: '  ' }), 'https://mainnet.base.org');
  assert.equal(rpcFor('arc', {}), 'https://rpc.mainnet.arc.io');
  assert.equal(rpcFor('nochain' as Chain, {}), null);
});

test('1.5 addressesFrom: answers first, an explorer link on that chain only, at most 2', () => {
  const a = `0x${'1'.repeat(40)}`;
  const b = `0x${'2'.repeat(40)}`;
  const c = `0x${'3'.repeat(40)}`;
  const d = `0x${'4'.repeat(40)}`;
  assert.deepEqual(addressesFrom({ answers: { contracts: `${a}, ${b}` }, chain: 'arc', stored: [c, d] }), [a, b]);
  const link = `https://explorer.arc.io/address/${c.toUpperCase().replace('0X', '0x')}`;
  assert.deepEqual(addressesFrom({ answers: {}, liveUrl: link, chain: 'arc', stored: [d] }), [c, d]);
  assert.deepEqual(addressesFrom({ answers: {}, liveUrl: link, chain: 'base', stored: [d] }), [d]);
  assert.deepEqual(addressesFrom({ answers: { contract_address: a }, liveUrl: link, chain: 'arc', stored: [d] }), [a, c]);
  assert.deepEqual(addressesFrom({ answers: { contracts: 'none yet' }, chain: 'arc', stored: null }), []);
});

/** An in-memory url_checks (Pre-flight P26), so the budget is tested without a database. */
function memCache() {
  const rows = new Map<string, { ok: boolean; checked_at: Date; note?: string | null; n?: number | null }>();
  const cache: CheckCache = {
    get: async (k) => rows.get(k) ?? null,
    set: async (k, ok, now, extra) => void rows.set(k, { ok, checked_at: now, ...extra }),
  };
  return { rows, cache };
}

test('budget (no DB): 8 uncached links probe 5 times; 7 getCodes make 6 calls', async () => {
  const { rows, cache } = memCache();
  const budget = new CheckBudget(LIST_BUDGET);
  let probes = 0;
  const probe = async () => void probes++;
  const live = [];
  for (let i = 0; i < 8; i++) live.push(await liveVerified(`https://site${i}.tipjar.xyz`, { probe, budget, cache }));
  assert.equal(probes, 5);
  assert.deepEqual(live, [true, true, true, true, true, false, false, false]);
  assert.equal(rows.size, 5);
  let calls = 0;
  const getCode = async () => (calls++, '0x6080');
  for (let i = 0; i < 7; i++) await contractDeployed('base', `0x${String(i).repeat(40)}`, { getCode, budget, cache });
  assert.equal(calls, 6);
});

test('2.5 liveCheckDetail (no DB): an error page is a failure cached with its phrase; the cache answers within the hour', async () => {
  const { rows, cache } = memCache();
  let probes = 0;
  const probe = async () => {
    probes++;
    throw new ErrorPageError('This page could not be found');
  };
  const now = new Date('2026-10-09T10:00:00Z');
  const url = 'https://tipjar-err.tipjar.xyz';
  assert.deepEqual(await liveCheckDetail(url, { probe, cache, now }), { ok: false, error: 'This page could not be found' });
  assert.equal(rows.size, 1);
  const [[key, row]] = [...rows];
  assert.ok(key.startsWith(`url:${url}`), key);
  assert.deepEqual([row.ok, row.note], [false, 'This page could not be found']);
  const later = new Date(now.getTime() + 30 * 60_000);
  assert.deepEqual(await liveCheckDetail(url, { probe, cache, now: later }), { ok: false, error: 'This page could not be found' });
  assert.equal(probes, 1);
  // A plain failure has no phrase; a pass has none either.
  const plain = async () => {
    throw new Error('no answer');
  };
  const log = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await liveCheckDetail('https://down.tipjar.xyz', { probe: plain, cache, now }), { ok: false, error: null });
  } finally {
    console.error = log;
  }
  assert.deepEqual(await liveCheckDetail('https://up.tipjar.xyz', { probe: async () => {}, cache, now }), { ok: true, error: null });
  // The phrase is the page's own text: kept to one plain line, double quotes made single.
  const quotedProbe = async () => {
    throw new ErrorPageError('Oops "404"\nnot here');
  };
  assert.deepEqual(await liveCheckDetail('https://quoted.tipjar.xyz', { probe: quotedProbe, cache, now }), { ok: false, error: "Oops '404' not here" });
  // entryVerified carries the phrase.
  const v = await entryVerified({ liveUrl: url, needsContract: null, addresses: [] }, { probe, cache, now: later });
  assert.deepEqual(v, { live: false, liveError: 'This page could not be found', contract: null, needsContract: null });
});

test('entryVerified (no DB): one probe and up to 2 getCodes; no address means no contract', async () => {
  const { cache } = memCache();
  const a = `0x${'a'.repeat(40)}`;
  const b = `0x${'b'.repeat(40)}`;
  const codes: Record<string, string> = { [a]: '0x', [b]: '0x6080' };
  const getCode = async (_rpc: string, addr: string) => codes[addr];
  const probe = async () => {};
  assert.deepEqual(await entryVerified({ liveUrl: 'https://tipjar.xyz', needsContract: 'arc', addresses: [a, b] }, { probe, getCode, cache }), {
    live: true,
    contract: true,
    needsContract: 'arc',
  });
  assert.deepEqual(await entryVerified({ liveUrl: null, needsContract: 'arc', addresses: [] }, { probe, getCode, cache }), {
    live: false,
    contract: false,
    needsContract: 'arc',
  });
  assert.deepEqual(await entryVerified({ liveUrl: 'https://example.com', needsContract: null, addresses: [a] }, { cache }), {
    live: false,
    contract: null,
    needsContract: null,
  });
  assert.deepEqual(ENTRY_BUDGET, { probes: 1, getCodes: 2, txCounts: 1 });
});

test('G15 I1 (no DB): a getCode that throws (RPC error, timeout, 429) is null, never cached; a real 0x is false and cached', async () => {
  const { rows, cache } = memCache();
  const addr = `0x${'c'.repeat(40)}`;
  for (const err of [new Error('HTTP request failed. Status: 429'), Object.assign(new Error('timed out'), { name: 'TimeoutError' })]) {
    const thrown = await contractDeployed('arc', addr, { getCode: async () => Promise.reject(err), cache });
    assert.equal(thrown, null);
    assert.equal(rows.size, 0, 'an RPC failure writes no url_checks row');
  }
  // A budget slot is still spent by a failed call (it was a real call).
  const budget = new CheckBudget({ probes: 0, getCodes: 1 });
  assert.equal(await contractDeployed('arc', addr, { getCode: async () => Promise.reject(new Error('down')), cache, budget }), null);
  assert.equal(budget.takeGetCode(), false);
  // The next call checks again, and a real answer is cached.
  assert.equal(await contractDeployed('arc', addr, { getCode: async () => '0x6080', cache }), true);
  assert.equal(rows.get(`getcode:arc:${addr}`)?.ok, true);
  const empty = `0x${'d'.repeat(40)}`;
  assert.equal(await contractDeployed('arc', empty, { getCode: async () => '0x', cache }), false);
  assert.equal(rows.get(`getcode:arc:${empty}`)?.ok, false);
  // An entry whose only contract couldn't be checked is "unchecked" (null), never "no contract".
  const v = await entryVerified(
    { liveUrl: 'https://tipjar.xyz', needsContract: 'arc', addresses: [`0x${'e'.repeat(40)}`] },
    { probe: async () => {}, getCode: async () => Promise.reject(new Error('429')), cache },
  );
  assert.deepEqual(v, { live: true, contract: null, needsContract: 'arc' });
});

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const tag = `${process.pid}-${Date.now()}`;
const cleanup = (keys: string[]) => sql()`DELETE FROM url_checks WHERE key IN ${sql()(keys)}`;

test('1.6 liveVerified: a failure is cached for an hour; a hung probe is false within 6 s', db, async () => {
  const url = `https://fail-${tag}.tipjar.xyz/`;
  const now = new Date();
  let probes = 0;
  const probe = async () => {
    probes++;
    throw new Error('down');
  };
  assert.equal(await liveVerified(url, { probe, now }), false);
  const [row] = await sql()<{ ok: boolean }[]>`SELECT ok FROM url_checks WHERE key = ${`url:${url}`}`;
  assert.equal(row.ok, false);
  assert.equal(await liveVerified(url, { probe, now: new Date(now.getTime() + 30 * 60_000) }), false);
  assert.equal(probes, 1);
  assert.equal(await liveVerified(url, { probe, now: new Date(now.getTime() + 61 * 60_000) }), false);
  assert.equal(probes, 2);

  const hung = `https://hung-${tag}.tipjar.xyz/`;
  const started = Date.now();
  const ok = await liveVerified(hung, { probe: (u) => safeProbe(u, { resolve: () => new Promise(() => {}) }) });
  assert.equal(ok, false);
  assert.ok(Date.now() - started < 6_000);
  await cleanup([`url:${url}`, `url:${hung}`]);
});

test('1.7 CheckBudget(5, 6): 8 uncached links probe 5 times, 3 write nothing; 7 getCodes make 6 calls', db, async () => {
  const budget = new CheckBudget({ probes: 5, getCodes: 6 });
  let probes = 0;
  const probe = async () => void probes++;
  const urls = Array.from({ length: 8 }, (_, i) => `https://b${i}-${tag}.tipjar.xyz/`);
  const got = [];
  for (const u of urls) got.push(await liveVerified(u, { probe, budget }));
  assert.equal(probes, 5);
  assert.deepEqual(got.slice(5), [false, false, false]);
  const keys = urls.map((u) => `url:${u}`);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM url_checks WHERE key IN ${sql()(keys)}`;
  assert.equal(n, 5);
  let calls = 0;
  const getCode = async () => (calls++, '0x6080');
  const addrs = Array.from({ length: 7 }, (_, i) => `0x${tag.replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}${String(i).repeat(32)}`);
  for (const a of addrs) await contractDeployed('base', a, { getCode, budget });
  assert.equal(calls, 6);
  await cleanup([...keys, ...addrs.map((a) => `getcode:base:${a.toLowerCase()}`)]);
});

test('1.8 contractDeployed: 0x is false, code is true, no RPC is null with no row', db, async () => {
  const empty = `0x${tag.replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}${'e'.repeat(32)}`;
  const full = `0x${tag.replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}${'f'.repeat(32)}`;
  assert.equal(await contractDeployed('arc', empty, { getCode: async () => '0x' }), false);
  assert.equal(await contractDeployed('arc', full, { getCode: async () => '0x6080' }), true);
  let called = false;
  assert.equal(await contractDeployed('nochain' as Chain, full, { getCode: async () => ((called = true), '0x6080') }), null);
  assert.equal(called, false);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM url_checks WHERE key LIKE 'getcode:nochain:%'`;
  assert.equal(n, 0);
  await cleanup([`getcode:arc:${empty}`, `getcode:arc:${full}`]);
});

test('Part 1 re-review N2 (no DB): one address with no code and one whose check failed is unchecked, not "no contract"', async () => {
  const { cache } = memCache();
  const wallet = `0x${'c'.repeat(40)}`;
  const contract = `0x${'d'.repeat(40)}`;
  const getCode = async (_rpc: string, addr: string) => {
    if (addr === contract) throw new Error('429');
    return '0x';
  };
  const r = await entryVerified({ liveUrl: null, needsContract: 'arc', addresses: [wallet, contract] }, { getCode, cache });
  assert.equal(r.contract, null);
});

// ---- v2.10 item 6 (R4): Blockscout transaction counts ----

test('3.4 txCount: Base only, cached 24 h with n under txcount:base:<addr>; a failed read or no budget is null and caches nothing', async (t) => {
  const log = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = log;
  });
  const rows = new Map<string, { ok: boolean; checked_at: Date; note?: string | null; n?: number | null }>();
  const cache: CheckCache = {
    get: async (k) => rows.get(k) ?? null,
    set: async (k, ok, now, extra) => void rows.set(k, { ok, checked_at: now, ...extra }),
  };
  const a = '0xAbCdEf0123456789abcdef0123456789ABCDEF01';
  const urls: string[] = [];
  const txCounter = async (address: string) => (urls.push(address), 57);
  assert.equal(await txCount('base', a, { txCounter, cache }), 57);
  assert.deepEqual(urls, [a.toLowerCase()]);
  const row = rows.get(`txcount:base:${a.toLowerCase()}`);
  assert.equal(row?.ok, true);
  assert.equal(row?.n, 57);
  // The second call reads the cache (no fetch), even with no budget left.
  assert.equal(await txCount('base', a, { txCounter, cache, budget: new CheckBudget({ probes: 0, getCodes: 0, txCounts: 0 }) }), 57);
  assert.equal(urls.length, 1);
  // Older than 24 h: read again.
  assert.equal(await txCount('base', a, { txCounter, cache, now: new Date(Date.now() + 25 * 3_600_000) }), 57);
  assert.equal(urls.length, 2);
  // Not Base: null, no read.
  assert.equal(await txCount('arc', a, { txCounter, cache }), null);
  assert.equal(urls.length, 2);
  // A throwing read: null, nothing cached.
  const b = '0x1111111111111111111111111111111111111112';
  assert.equal(await txCount('base', b, { txCounter: async () => { throw new Error('429'); }, cache }), null);
  assert.equal(await txCount('base', b, { txCounter: async () => NaN, cache }), null, 'no count in the answer');
  assert.equal(rows.has(`txcount:base:${b}`), false);
  // No budget left: null, no read.
  assert.equal(await txCount('base', b, { txCounter, cache, budget: new CheckBudget({ probes: 0, getCodes: 0, txCounts: 0 }) }), null);
  assert.equal(urls.length, 2);
  // One slot: one read.
  const one = new CheckBudget({ probes: 0, getCodes: 0, txCounts: 1 });
  assert.equal(await txCount('base', b, { txCounter, cache, budget: one }), 57);
  assert.equal(await txCount('base', '0x1111111111111111111111111111111111111113', { txCounter, cache, budget: one }), null);
  assert.deepEqual(LIST_BUDGET.txCounts, 2);
  assert.deepEqual(ENTRY_BUDGET.txCounts, 1);
});
