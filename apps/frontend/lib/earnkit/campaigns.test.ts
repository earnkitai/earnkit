import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EntryError,
  parseAddresses,
  presentYourEntries,
  validateEntry,
  type CampaignConfig,
} from './campaigns';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const W = '0x' + 'c'.repeat(40);
const window = {
  starts_at: new Date('2026-09-30T00:00:00Z'),
  ends_at: new Date('2026-10-14T23:59:00Z'),
};
const during = async () => 'during' as const;

test('parses comma, space, and array forms; dedupes; lowercases', () => {
  assert.deepEqual(
    parseAddresses(`${A.toUpperCase().replace('0X', '0x')}, ${B} ${A}`),
    [A, B],
  );
  assert.deepEqual(parseAddresses([A, B]), [A, B]);
  assert.deepEqual(parseAddresses(undefined), []);
});

test('valid entry', async () => {
  assert.deepEqual(
    await validateEntry(
      { contracts: `${A},${B}`, payout_wallet: W },
      window,
      during,
    ),
    {
      contracts: [A, B],
      payoutWallet: W,
    },
  );
});

test('rejects bad entries with a clear reason', async () => {
  const bad = async (
    data: Record<string, unknown>,
    deployed: (
      c: string,
    ) => Promise<'not_contract' | 'before_start' | 'during'> = during,
  ) => assert.rejects(validateEntry(data, window, deployed), EntryError);
  await bad({ payout_wallet: W }); // no contracts
  await bad({ contracts: 'nope', payout_wallet: W });
  await bad({ contracts: A, payout_wallet: 'nope' });
  await bad({ contracts: A, payout_wallet: W }, async () => 'not_contract'); // not a contract
  await bad({ contracts: A, payout_wallet: W }, async () => 'before_start'); // deployed before start
  await bad({
    contracts: Array.from(
      { length: 6 },
      (_, i) => '0x' + String(i).repeat(40),
    ).join(','),
    payout_wallet: W,
  });
});

const campaign: CampaignConfig = {
  prize: { token: A, symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5,
  amount_each: '75000000',
  metric: 'unique_wallets',
  min_score: 10,
};

test('entries show rank while running and the prize once paid; wins announce once', () => {
  const lastCheck = new Date('2026-10-15T00:00:00Z');
  const { section, wins } = presentYourEntries(
    [
      {
        name: 'Alpha',
        campaign_title: 'C1',
        campaign,
        score: 41,
        rank: 3,
        entries: 12,
        prize_tx: null,
        prize_paid_at: null,
      },
      {
        name: 'Beta',
        campaign_title: 'C1',
        campaign,
        score: 90,
        rank: 1,
        entries: 12,
        prize_tx: '0xabc',
        prize_paid_at: new Date('2026-10-16T00:00:00Z'),
      },
      {
        name: 'Gamma',
        campaign_title: 'C1',
        campaign,
        score: null,
        rank: 12,
        entries: 12,
        prize_tx: null,
        prize_paid_at: null,
      },
    ],
    lastCheck,
  );
  assert.match(section!, /Alpha: #3 of 12 in C1 · 41 wallets \(min 10\)/);
  assert.match(section!, /Beta: you won 75,000,000 MINI in C1 \(tx 0xabc\)/);
  assert.match(section!, /Gamma: #12 of 12 in C1 · not scored yet/);
  assert.deepEqual(wins, ['you won 75,000,000 MINI with Beta']);
  assert.deepEqual(presentYourEntries([], null), { section: null, wins: [] });
});
