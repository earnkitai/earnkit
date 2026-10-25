import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlchemyNetworkOff, alchemyCall, alchemyCreations, alchemyOn, alchemyTxList, alchemyWalletContracts, contractCounts, type AlchemyCall } from './alchemy';
import { ScoreDeadline } from './campaigns';
import { walletSignalsFrom } from './people-signals';
import { walletFirstTxFrom } from './source-readers';

const W = '0x7c0460aaf5d6dda08acd3e9161ee2bac75a87090';
const F = '0x1111111111111111111111111111111111111111';
const at = (iso: string) => ({ blockTimestamp: iso });

/** A fake Alchemy: answers by method and by the transfer query's direction; records every call. */
function fake(answers: { sent?: object[]; got?: object[]; pages?: object[][]; receipts?: Record<string, object | null> }) {
  const calls: { method: string; params: unknown[] }[] = [];
  let page = 0;
  const call = (async (method: string, params: unknown[]) => {
    calls.push({ method, params });
    if (method === 'eth_getTransactionReceipt') return answers.receipts?.[params[0] as string] ?? null;
    const q = params[0] as { fromAddress?: string; order?: string };
    if (answers.pages && q.order === 'desc') {
      const transfers = answers.pages[page] ?? [];
      page++;
      return { transfers, ...(page < answers.pages.length && { pageKey: `k${page}` }) };
    }
    return { transfers: q.fromAddress ? (answers.sent ?? []) : (answers.got ?? []) };
  }) as AlchemyCall;
  return { call, calls };
}

test('alchemyOn: only with a key', () => {
  assert.equal(alchemyOn({}), false);
  assert.equal(alchemyOn({ ALCHEMY_API_KEY: ' ' }), false);
  assert.equal(alchemyOn({ ALCHEMY_API_KEY: 'k' }), true);
});

test('alchemyTxList: sent and received, oldest first, as a txlist the first-transaction and funder reads use unchanged', async () => {
  const { call, calls } = fake({
    sent: [{ hash: '0xa', from: W, to: F, metadata: at('2025-11-26T15:58:43.000Z') }],
    got: [{ hash: '0xb', from: F, to: W, metadata: at('2025-11-20T10:00:00.000Z') }],
  });
  const list = await alchemyTxList(W, 20, call);
  assert.deepEqual(calls.map((c) => c.params[0]), [
    { category: ['external'], excludeZeroValue: false, withMetadata: true, fromAddress: W, order: 'asc', maxCount: '0x14' },
    { category: ['external'], excludeZeroValue: false, withMetadata: true, toAddress: W, order: 'asc', maxCount: '0x14' },
  ]);
  assert.equal(await walletFirstTxFrom(W, async () => list), '2025-11-20T10:00:00.000Z', 'the received one came first');
  assert.deepEqual(walletSignalsFrom(W, list), { firstTxAt: '2025-11-20T10:00:00.000Z', funder: F });
  assert.deepEqual(await alchemyTxList(W, 1, fake({}).call), { status: '0', result: [] });
});

test('alchemyCreations: sent transactions with an empty to, their receipts\' addresses, newest first, capped', async () => {
  const C1 = '0x2222222222222222222222222222222222222222';
  const C2 = '0x3333333333333333333333333333333333333333';
  const { call, calls } = fake({
    pages: [
      [{ hash: '0xc1', from: W, to: '', metadata: at('2025-12-01T00:00:00.000Z') }, { hash: '0xt', from: W, to: F, metadata: at('2025-11-30T00:00:00.000Z') }],
      [{ hash: '0xc2', from: W, to: null, metadata: at('2025-11-28T00:00:00.000Z') }, { hash: '0xbad', from: W, to: '', metadata: at('2025-11-27T00:00:00.000Z') }],
    ],
    receipts: { '0xc1': { contractAddress: C1.toUpperCase().replace('0X', '0x'), status: '0x1' }, '0xc2': { contractAddress: C2, status: '0x1' }, '0xbad': { contractAddress: F, status: '0x0' } },
  });
  assert.deepEqual(await alchemyCreations(W, call, { pages: 3, max: 25 }), [
    { address: C1, created_at: '2025-12-01T00:00:00.000Z' },
    { address: C2, created_at: '2025-11-28T00:00:00.000Z' },
  ]);
  assert.equal(calls.filter((c) => c.method === 'alchemy_getAssetTransfers').length, 2, 'stops when no page key');
  assert.deepEqual((calls[1].params[0] as { pageKey?: string }).pageKey, 'k1');
  const capped = fake({ pages: [[{ hash: '0xc1', from: W, to: '', metadata: at('2025-12-01T00:00:00.000Z') }, { hash: '0xc2', from: W, to: '', metadata: at('2025-11-28T00:00:00.000Z') }]], receipts: { '0xc1': { contractAddress: C1, status: '0x1' } } });
  assert.equal((await alchemyCreations(W, capped.call, { pages: 1, max: 1 })).length, 1);
  assert.equal(capped.calls.filter((c) => c.method === 'eth_getTransactionReceipt').length, 1, 'at most max receipts');
});

test('alchemyCall: Base by default, the network named otherwise; "not enabled for this app" is AlchemyNetworkOff (a 403 or an error body)', async () => {
  const urls: string[] = [];
  const real = globalThis.fetch;
  const answer = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let next = (): Response => answer(200, { result: '0x1' });
  globalThis.fetch = (async (u: string | URL) => (urls.push(String(u)), next())) as typeof fetch;
  try {
    await withKey(async () => {
      assert.equal(await alchemyCall(Date.now() + 5000)('eth_blockNumber', []), '0x1');
      assert.equal(await alchemyCall(Date.now() + 5000, 'arb-mainnet')('eth_blockNumber', []), '0x1');
      assert.deepEqual(urls, ['https://base-mainnet.g.alchemy.com/v2/k', 'https://arb-mainnet.g.alchemy.com/v2/k']);
      next = () => answer(403, { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'OPT_MAINNET is not enabled for this app. Visit this page to enable the network: https://dashboard.alchemy.com/' } });
      await assert.rejects(alchemyCall(Date.now() + 5000, 'opt-mainnet')('eth_blockNumber', []), (e: unknown) => e instanceof AlchemyNetworkOff && e.network === 'opt-mainnet');
      next = () => answer(200, { jsonrpc: '2.0', id: 1, error: { message: 'POLYGON_MAINNET is not enabled for this app.' } });
      await assert.rejects(alchemyCall(Date.now() + 5000, 'polygon-mainnet')('eth_blockNumber', []), AlchemyNetworkOff);
      next = () => answer(500, { error: { message: 'boom' } });
      await assert.rejects(alchemyCall(Date.now() + 5000)('eth_blockNumber', []), (e: unknown) => !(e instanceof AlchemyNetworkOff));
    });
  } finally {
    globalThis.fetch = real;
  }
});

/** ALCHEMY_API_KEY set to 'k' for `f`. */
async function withKey(f: () => Promise<void>) {
  const was = process.env.ALCHEMY_API_KEY;
  process.env.ALCHEMY_API_KEY = 'k';
  try {
    await f();
  } finally {
    if (was === undefined) delete process.env.ALCHEMY_API_KEY;
    else process.env.ALCHEMY_API_KEY = was;
  }
}

/**
 * A fake Alchemy per network: `made` the wallet's creations (hash to address), `tokens` answer decimals() and
 * totalSupply(), `users` the senders to a contract; `off` networks answer not enabled, `broken` ones fail.
 */
function chains(o: { made: Record<string, Record<string, string>>; tokens?: string[]; users?: Record<string, string[]>; off?: string[]; broken?: string[] }) {
  const calls: { network: string; method: string; params: unknown[] }[] = [];
  const word = `0x${'0'.repeat(63)}1`;
  const callFor = (network: string) => (async (method: string, params: unknown[]) => {
    calls.push({ network, method, params });
    if (o.off?.includes(network)) throw new AlchemyNetworkOff(network);
    if (o.broken?.includes(network)) throw new Error('Alchemy alchemy_getAssetTransfers returned 500');
    const made = o.made[network] ?? {};
    if (method === 'eth_getTransactionReceipt') return { contractAddress: made[params[0] as string], status: '0x1' };
    if (method === 'eth_call') {
      const { to } = params[0] as { to: string };
      if (o.tokens?.includes(to)) return word;
      throw new Error('execution reverted');
    }
    const q = params[0] as { fromAddress?: string; toAddress?: string };
    if (q.fromAddress) return { transfers: Object.keys(made).map((hash) => ({ hash, from: W, to: null, metadata: at('2025-03-01T00:00:00.000Z') })) };
    return { transfers: (o.users?.[q.toAddress!] ?? []).map((from) => ({ from, to: q.toAddress })) };
  }) as AlchemyCall;
  return { callFor, calls };
}

test('alchemyWalletContracts: every chain, a token or an unused contract never counts, a network not enabled is skipped (one log line), a failed chain left out', async () => {
  const [app, coin, test1, eth1, arb1] = ['a', 'b', 'c', 'd', 'e'].map((x) => `0x${x.repeat(40)}`);
  const { callFor, calls } = chains({
    made: { 'base-mainnet': { '0x1': app, '0x2': coin, '0x3': test1 }, 'eth-mainnet': { '0x4': eth1 }, 'arb-mainnet': { '0x5': arb1 } },
    tokens: [coin],
    // test1 only ever got the deployer's own transactions; eth1 a stranger's; arb1 none.
    users: { [app]: [W, F], [coin]: [F], [test1]: [W.toUpperCase().replace('0X', '0x')], [eth1]: [F] },
    off: ['opt-mainnet', 'polygon-mainnet'],
  });
  const warn = console.warn;
  const lines: unknown[][] = [];
  console.warn = (...a: unknown[]) => void lines.push(a);
  try {
    const out = await alchemyWalletContracts(W, callFor, { pages: 1, max: 25 });
    assert.deepEqual(out.map((c) => [c.chain, c.address, c.counts]), [
      ['base', app, true], ['base', coin, false], ['base', test1, false], ['ethereum', eth1, true], ['arbitrum', arb1, false],
    ]);
    assert.equal(out[0].created_at, '2025-03-01T00:00:00.000Z');
    assert.ok(!calls.some((c) => c.method === 'alchemy_getAssetTransfers' && (c.params[0] as { toAddress?: string }).toAddress === coin), 'a token is never asked who used it');
    const used = calls.find((c) => (c.params[0] as { toAddress?: string }).toAddress === app)!.params[0];
    assert.deepEqual(used, { category: ['external'], excludeZeroValue: false, toAddress: app, order: 'desc', maxCount: '0xa' });
    assert.deepEqual(calls.filter((c) => c.method === 'eth_call' && (c.params[0] as { to: string }).to === app).map((c) => (c.params[0] as { data: string }).data).sort(), ['0x18160ddd', '0x313ce567']);
    // Again: the networks not enabled log nothing more; a contract already counted is not classified again.
    calls.length = 0;
    const again = await alchemyWalletContracts(W, callFor, { pages: 1, max: 25, known: new Set([`base:${app}`]) });
    assert.equal(again.find((c) => c.address === app)?.counts, true);
    assert.ok(!calls.some((c) => (c.params[0] as { to?: string; toAddress?: string }).to === app || (c.params[0] as { toAddress?: string }).toAddress === app));
  } finally {
    console.warn = warn;
  }
  assert.equal(lines.length, 2, 'one line per network not enabled, once');
  assert.match(String(lines[0][0]), /^\[alchemy\] (opt|polygon)-mainnet not enabled for this app, skipped$/);
  // A chain whose read fails is left out; the others still answer.
  const err = console.error;
  console.error = () => {};
  try {
    const part = await alchemyWalletContracts(W, chains({ made: { 'base-mainnet': { '0x1': app } }, users: { [app]: [F] }, broken: ['eth-mainnet'] }).callFor, { pages: 1, max: 25 });
    assert.deepEqual(part.map((c) => [c.chain, c.counts]), [['base', true]]);
  } finally {
    console.error = err;
  }
  // The deadline is never swallowed.
  const late = (async () => {
    throw new ScoreDeadline();
  }) as AlchemyCall;
  await assert.rejects(alchemyWalletContracts(W, () => late, { pages: 1, max: 25 }), ScoreDeadline);
});

test('contractCounts: decimals and totalSupply both answering is a token; one answering (an NFT) is not', async () => {
  const C = `0x${'9'.repeat(40)}`;
  const word = `0x${'0'.repeat(64)}`;
  const call = (answer: string[]) => (async (method: string, params: unknown[]) => {
    if (method === 'eth_call') {
      if (answer.includes((params[0] as { data: string }).data)) return word;
      return '0x';
    }
    return { transfers: [{ from: F }] };
  }) as AlchemyCall;
  assert.equal(await contractCounts(C, W, call(['0x313ce567', '0x18160ddd'])), false);
  assert.equal(await contractCounts(C, W, call(['0x18160ddd'])), true);
  assert.equal(await contractCounts(C, W, call([])), true, 'an empty answer is not a token');
});
