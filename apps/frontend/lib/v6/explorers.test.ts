import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockscout, explorerFor, ExplorerError, type Tx } from './explorers';
import { replayExplorer } from './fixtures/explorer';

const BASE = 'https://base.blockscout.com/api/v2';
const FAST = { gapMs: 0, sleep: async () => {} };
const DAY = 86_400_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('contractInfo on a verified contract: verified source, a deployer and a deploy time', async () => {
  const rec = replayExplorer('onchain-reaction');
  const info = await blockscout(BASE, rec.fetch, FAST).contractInfo('base', rec.address);
  assert.equal(info.is_contract, true);
  assert.equal(info.verified_source, true);
  assert.match(info.deployer ?? '', /^0x[0-9a-f]{40}$/);
  assert.match(info.deployed_at ?? '', /^\d{4}-\d\d-\d\dT/);
  assert.match(info.created_tx ?? '', /^0x[0-9a-f]{64}$/);
  assert.equal(info.name, 'OnchainReactionBaseV3');
});

test('contractInfo on a wallet: not verified, no deployer', async () => {
  const rec = replayExplorer('wallet');
  const info = await blockscout(BASE, rec.fetch, FAST).contractInfo('base', rec.address);
  assert.deepEqual(info, { is_contract: false, verified_source: false, name: null, deployer: null, deployed_at: null, created_tx: null });
});

test('txsTo stops paging at since and keeps nothing older', async () => {
  const now = Date.parse('2026-11-06T00:00:00Z');
  const tx = (i: number, daysAgo: number) => ({
    hash: '0x' + String(i).padStart(64, '0'), from: { hash: '0x' + 'A'.repeat(40) }, to: { hash: '0x' + 'b'.repeat(40) },
    timestamp: new Date(now - daysAgo * DAY).toISOString(), value: '0', status: 'ok',
  });
  const pages = [
    { items: [tx(1, 1), tx(2, 5)], next_page_params: { block_number: 2, index: 0 } },
    { items: [tx(3, 20), tx(4, 40)], next_page_params: { block_number: 1, index: 0 } },
    { items: [tx(5, 60)], next_page_params: { block_number: 0, index: 0 } },
  ];
  const calls: string[] = [];
  const f = (async (u: RequestInfo | URL) => {
    calls.push(String(u));
    return json(pages[calls.length - 1] ?? { items: [], next_page_params: null });
  }) as typeof fetch;
  const txs = await blockscout(BASE, f, FAST).txsTo('base', '0x' + 'b'.repeat(40), new Date(now - 30 * DAY), 1000);
  assert.deepEqual(txs.map((t) => t.hash.slice(-1)), ['1', '2', '3']);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /filter=to&block_number=2&index=0$/);
  const t: Tx = txs[0];
  assert.equal(t.from, '0x' + 'a'.repeat(40));
  assert.equal(t.is_error, false);
});

test('txsTo on the recorded contract stops at since', async () => {
  const rec = replayExplorer('paydence');
  const since = new Date(Date.parse(rec.recorded_at) - 30 * DAY);
  const txs = await blockscout(BASE, rec.fetch, FAST).txsTo('base', rec.address, since, 1000);
  assert.ok(txs.length > 0);
  for (const t of txs) assert.ok(Date.parse(t.at) >= since.getTime());
});

test('txsTo stops at max', async () => {
  const rec = replayExplorer('paydence');
  const txs = await blockscout(BASE, rec.fetch, FAST).txsTo('base', rec.address, new Date(0), 60);
  assert.equal(txs.length, 60);
  assert.equal(rec.calls.length, 2);
});

test('firstTxs gives the oldest transactions each way, oldest first', async () => {
  const rec = replayExplorer('wallet');
  const first = await blockscout(BASE, rec.fetch, FAST).firstTxs('base', rec.address, 2);
  assert.ok(first.length >= 1 && first.length <= 4);
  for (let i = 1; i < first.length; i++) assert.ok(first[i - 1].at <= first[i].at);
  assert.ok(rec.calls.every((u) => /sort=block_number&order=asc/.test(u)));
});

test('a 429 is retried once after a second; twice throws ExplorerError 429', async () => {
  const waits: number[] = [];
  let n = 0;
  const f = (async () => (n++, new Response('slow down', { status: 429 }))) as typeof fetch;
  const e = blockscout(BASE, f, { gapMs: 0, sleep: async (ms) => void waits.push(ms) });
  await assert.rejects(e.contractInfo('base', '0x' + 'b'.repeat(40)), (err) => err instanceof ExplorerError && err.status === 429);
  assert.equal(n, 2);
  assert.deepEqual(waits, [1000]);
});

test('a 429 then a 200 reads normally', async () => {
  let n = 0;
  const f = (async () => (n++ === 0 ? new Response('', { status: 429 }) : json({ items: [], next_page_params: null }))) as typeof fetch;
  assert.deepEqual(await blockscout(BASE, f, FAST).txsTo('base', '0x' + 'b'.repeat(40), new Date(0), 10), []);
});

test('a 403 throws ExplorerError 403', async () => {
  const f = (async () => new Response('forbidden', { status: 403 })) as typeof fetch;
  await assert.rejects(
    blockscout(BASE, f, FAST).txsTo('base', '0x' + 'b'.repeat(40), new Date(0), 10),
    (err) => err instanceof ExplorerError && err.status === 403,
  );
});

test('every request sends the user agent and accept headers', async () => {
  const seen: Headers[] = [];
  const rec = replayExplorer('onchain-reaction');
  const f = ((u: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return rec.fetch(u, init);
  }) as typeof fetch;
  await blockscout(BASE, f, FAST).contractInfo('base', rec.address);
  assert.ok(seen.length >= 2);
  for (const h of seen) {
    assert.equal(h.get('user-agent'), 'Mozilla/5.0 (compatible; EarnKit-verifier/1)');
    assert.equal(h.get('accept'), 'application/json');
  }
});

test('explorerFor: chains with no reader are null; read chains have one', () => {
  assert.equal(explorerFor('tempo'), null);
  assert.equal(explorerFor('avalanche'), null);
  assert.equal(explorerFor('solana'), null);
  assert.equal(explorerFor('nope'), null);
  assert.ok(explorerFor('base'));
  assert.ok(explorerFor('arc'));
});
