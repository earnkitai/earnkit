import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, contract, evidence, liveRows } from './fixtures/evidence-builder';
import { evidenceSummary, ownEvidence, usageLine } from './own-evidence';
import { place } from './tiers';

const H = 3_600_000;
const X0 = { identical_pitch: 0, shared_contributors: 0 };

test('usageLine: the fixed template from one counted mainnet contract', () => {
  const e = evidence({ onchain: [contract({ funded_senders_90d: 1240, tx_90d: 12300, deployed_at: '2026-08-02T10:00:00Z' })] });
  assert.equal(usageLine(e, NOW), '1,240 distinct senders the deployer did not fund in 90 days on Base, 12,300 transactions, live since 2026-08-02');
});

test('I1 (v6.1.14 fix round 1): the draft usage line names senders the deployer did not fund, never funded wallets', () => {
  const e = evidence({ onchain: [contract({ funded_senders_90d: 3, tx_90d: 40 })] });
  assert.match(usageLine(e, NOW)!, /^3 distinct senders the deployer did not fund in 90 days on Base, /);
  assert.doesNotMatch(usageLine(e, NOW)!, /funded wallets/);
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
  assert.match(s!.line, /^Your project is live, with no verified usage yet\. Next: about 25 outside users in 90 days; I count 0\.$/);
  assert.equal(evidenceSummary(place(null, X0), null), null);
});
