import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trust, trustFor } from './programs';

test('trust: within 7 days the agent is told not to re-read the source; older, just the date', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  assert.deepEqual(trust(new Date('2026-09-30'), now), {
    verified_at: '2026-09-30',
    verified_note:
      'EarnKit checked these facts against source_url 2 days ago; no need to re-read it.',
  });
  assert.deepEqual(trust(new Date('2026-09-20'), now), {
    verified_at: '2026-09-20',
  });
  assert.deepEqual(trust(null, now), { verified_at: null });
});

test('trustFor: a sponsor campaign points at its escrow and claims no verified_at', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  assert.deepEqual(trustFor('sponsor', new Date('2026-10-02'), now), {
    verified_note:
      'Set by the sponsor; the prize is held in escrow onchain (campaign.escrow).',
  });
  assert.deepEqual(
    trustFor('file', new Date('2026-09-30'), now),
    trust(new Date('2026-09-30'), now),
  );
});
