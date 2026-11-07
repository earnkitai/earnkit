import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, contract, evidence, liveRows } from './fixtures/evidence-builder';
import { evidenceSummary, ownEvidence, usageLine } from './own-evidence';
import { place } from './tiers';

const H = 3_600_000;
const X0 = { identical_pitch: 0, shared_contributors: 0 };

test('usageLine: the fixed template from one counted mainnet contract', () => {
  const e = evidence({ onchain: [contract({ funded_senders_90d: 1240, tx_90d: 12300, deployed_at: '2026-08-02T10:00:00Z' })] });
  assert.equal(usageLine(e, NOW), '1,240 distinct funded wallets in 90 days on Base, 12,300 transactions, live since 2026-08-02');
});

test('usageLine: null with zero funded senders, an uncounted or a testnet contract; never a sentence', () => {
  assert.equal(usageLine(evidence({ onchain: [contract({ funded_senders_90d: 0, tx_90d: 500 })] }), NOW), null);
  assert.equal(usageLine(evidence({ onchain: [contract({ funded_senders_90d: 40, counted: false })] }), NOW), null);
  assert.equal(usageLine(evidence({ onchain: [contract({ funded_senders_90d: 40, mainnet: false })] }), NOW), null);
  assert.equal(usageLine(evidence(), NOW), null);
});

test('ownEvidence skips the read inside 24 hours and reads after', async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return evidence();
  };
  const skipped = await ownEvidence({ repo_url: 'https://github.com/a/b' }, { read, now: NOW, lastReadAt: new Date(NOW.getTime() - 23 * H).toISOString() });
  assert.deepEqual(skipped, { evidence: null, read: false });
  assert.equal(reads, 0);
  const again = await ownEvidence({ repo_url: 'https://github.com/a/b' }, { read, now: NOW, lastReadAt: new Date(NOW.getTime() - 25 * H).toISOString() });
  assert.equal(again.read, true);
  const first = await ownEvidence({ repo_url: 'https://github.com/a/b' }, { read, now: NOW, lastReadAt: null });
  assert.equal(first.read, true);
  assert.equal(reads, 2);
});

test('evidenceSummary: the tier and the builder line; null when nothing was placed', () => {
  const e = evidence({ live: liveRows({ url: 'https://x.dev', url_ok: true }) });
  const s = evidenceSummary(place(e, X0, undefined, NOW), e);
  assert.equal(s?.tier, 'live');
  assert.match(s!.line, /^Your project reads as live, no verified usage yet\. Next: 25 funded wallets on mainnet in 90 days; you have 0\.$/);
  assert.equal(evidenceSummary(place(null, X0), null), null);
});
