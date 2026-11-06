import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockscout, type Explorer, ExplorerError, type Tx } from './explorers';
import { isDeployerFunded, readContract, SENDER_SAMPLE } from './onchain';
import { replayExplorer } from './fixtures/explorer';

const BASE = 'https://base.blockscout.com/api/v2';
const FAST = { gapMs: 0, sleep: async () => {} };
const HOUR = 3_600_000;
const replay = (slug: string) => {
  const rec = replayExplorer(slug);
  return { rec, explorer: blockscout(BASE, rec.fetch, FAST), now: new Date(rec.recorded_at) };
};

test('a used contract: 25+ senders in 90 days, funded within senders, sample at most 50', async () => {
  const { rec, explorer, now } = replay('paydence');
  const r = await readContract('base', rec.address, { explorer, repoAddresses: [], now });
  assert.equal(r.mainnet, true);
  assert.equal(r.verified_source, true);
  assert.ok(r.senders_90d! >= 25, `senders_90d ${r.senders_90d}`);
  assert.ok(r.senders_30d! <= r.senders_90d!);
  assert.ok(r.tx_90d! >= r.senders_90d!);
  assert.ok(r.funded_senders_90d !== null && r.funded_senders_90d <= r.senders_90d!);
  assert.ok(r.funded_sample! > 0 && r.funded_sample! <= SENDER_SAMPLE);
  assert.equal(SENDER_SAMPLE, 50);
  assert.match(r.first_tx_at ?? '', /^\d{4}-\d\d-\d\dT/);
});

test('the onchain-reaction contract: verified, deployer matches the repo when listed', async () => {
  const { rec, explorer, now } = replay('onchain-reaction');
  const r = await readContract('base', rec.address, { explorer, repoAddresses: [], now });
  assert.equal(r.verified_source, true);
  assert.equal(r.deployer_matches_repo, false);
  assert.match(r.deployer ?? '', /^0x[0-9a-f]{40}$/);
  const again = replay('onchain-reaction');
  const m = await readContract('base', rec.address, {
    explorer: again.explorer, repoAddresses: [r.deployer!.toUpperCase().replace('0X', '0x')], now,
  });
  assert.equal(m.deployer_matches_repo, true);
});

test('unknown address is not usage', async () => {
  // A wallet with transfers but no code: not verified, no deployer, transfers still counted, nothing failed.
  const { rec, explorer, now } = replay('wallet');
  const r = await readContract('base', rec.address, { explorer, repoAddresses: [], now });
  assert.equal(r.verified_source, false);
  assert.equal(r.deployer, null);
  assert.equal(r.deployed_at, null);
  assert.equal(r.deployer_matches_repo, null);
  assert.equal(typeof r.tx_90d, 'number');
  assert.equal(r.note, null);
});

test('no explorer for the chain: nothing read, a note says why', async () => {
  const r = await readContract('tempo', '0x' + 'b'.repeat(40), { explorer: null, repoAddresses: [], now: new Date() });
  assert.equal(r.note, 'not read: no explorer for tempo');
  assert.equal(r.verified_source, null);
  assert.equal(r.tx_90d, null);
});

test('an explorer that answers 429 twice stops the read with a note, never throws', async () => {
  const f = (async () => new Response('', { status: 429 })) as typeof fetch;
  const explorer = blockscout(BASE, f, FAST);
  const r = await readContract('base', '0x' + 'b'.repeat(40), { explorer, repoAddresses: [], now: new Date() });
  assert.equal(r.note, 'not read: explorer 429');
  assert.equal(r.verified_source, null);
  assert.equal(r.senders_90d, null);
});

test('a 429 while sampling senders keeps the counts and leaves funded unread', async () => {
  const now = new Date('2026-11-06T00:00:00Z');
  const tx = (from: string): Tx => ({ hash: '0x1', from, to: '0xc', at: now.toISOString(), value_wei: '0', is_error: false });
  const explorer: Explorer = {
    contractInfo: async () => ({ verified_source: true, name: 'C', deployer: '0xd', deployed_at: null, created_tx: null }),
    txsTo: async () => [tx('0x1'), tx('0x2')],
    firstTxs: async () => { throw new ExplorerError('explorer 429', 429); },
  };
  const r = await readContract('base', '0xc', { explorer, repoAddresses: [], now });
  assert.equal(r.senders_90d, 2);
  assert.equal(r.funded_senders_90d, null);
  assert.equal(r.note, 'not read: explorer 429');
});

const S = '0x' + '5'.repeat(40);
const D = '0x' + 'd'.repeat(40);
const C = '0x' + 'c'.repeat(40);
const at = (ms: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + ms).toISOString();
const fund = (ms: number, from = D): Tx => ({ hash: '0xf', from, to: S, at: at(ms), value_wei: '1000', is_error: false });
const call = (ms: number): Tx => ({ hash: '0xa', from: S, to: C, at: at(ms), value_wei: '0', is_error: false });

test('isDeployerFunded: funded by the deployer 1 hour before the first call', () => {
  assert.equal(isDeployerFunded([fund(0), call(HOUR)], D, C), true);
});

test('isDeployerFunded: funded by the deployer 3 days before is not', () => {
  assert.equal(isDeployerFunded([fund(0), call(72 * HOUR)], D, C), false);
});

test('isDeployerFunded: funded by the contract itself counts; by someone else does not', () => {
  assert.equal(isDeployerFunded([fund(0, C), call(HOUR)], D, C), true);
  assert.equal(isDeployerFunded([fund(0, '0x' + 'e'.repeat(40)), call(HOUR)], D, C), false);
});

test('isDeployerFunded: a sender that moved first is not', () => {
  assert.equal(isDeployerFunded([call(0), fund(HOUR)], D, C), false);
  assert.equal(isDeployerFunded([], D, C), false);
});
