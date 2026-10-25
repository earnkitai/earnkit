import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alchemyCreations, alchemyOn, alchemyTxList, type AlchemyCall } from './alchemy';
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
