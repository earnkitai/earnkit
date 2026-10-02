import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perWinnerUsd, trust, trustFor } from './programs';

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

test('perWinnerUsd: USDC sponsor prize / winners, else the file value, else null', () => {
  const sponsor = (symbol: string) =>
    ({
      kind: 'sponsor',
      prize: {
        token: '0x' + 'a'.repeat(40),
        symbol,
        decimals: 6,
        chain_id: 8453,
      },
      pool: '100',
      prize_total: '90',
      winners: 3,
      metric: 'unique_wallets',
      sponsor: { name: 'Acme' },
      criteria: 'Best',
      escrow: '0x' + 'b'.repeat(40),
      ref: '0x' + 'c'.repeat(64),
    }) as const;
  assert.equal(
    perWinnerUsd({ campaign: sponsor('USDC'), max_award_usd: null }),
    30,
  );
  assert.equal(
    perWinnerUsd({ campaign: sponsor('MINI'), max_award_usd: null }),
    null,
  );
  assert.equal(perWinnerUsd({ campaign: null, max_award_usd: '5000' }), 5000);
  assert.equal(perWinnerUsd({ campaign: null, max_award_usd: null }), null);
});
