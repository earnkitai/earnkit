import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignRow } from './leaderboard';
import type { CampaignConfig } from './campaigns';

const campaign: CampaignConfig = {
  kind: 'earnkit',
  prize: { token: '0x' + 'a'.repeat(40), symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5, amount_each: '1', prize_usd_total: 500, metric: 'unique_wallets', min_score: 10,
};
const now = new Date('2026-10-04T12:00:00Z');
const p = { id: 'c1', title: 'C1', campaign, ends_at: new Date('2026-10-18T23:59:00Z'), status: 'active' as const, state: null };
const entry = (id: number, score: number | null) => ({
  id, program_id: 'c1', score, submitted_at: new Date(Date.UTC(2026, 9, 1, id)), payout_wallet: `0x${String(id).padStart(40, '0')}`,
  installation_id: id, vetoed_at: null, payout_status: null, prize_tx: null,
});

test('campaignRow: live numbers without an entry; the builder\'s best standing with one', () => {
  const entries = [30, 25, 20, 18, 14, 9, null].map((s, i) => entry(i + 1, s));
  const row = campaignRow(p, entries, new Set(), now);
  assert.deepEqual(
    { prize: row.prize, entries: row.entries, cutoff: row.cutoff, you: row.you, open: row.open, each: row.prize_usd_each },
    { prize: '$100 each to top 5 (in MINI)', entries: 7, cutoff: 14, you: null, open: true, each: 100 },
  );
  assert.equal(campaignRow(p, entries, new Set([6, 7]), now).you, '#6, 1 user short of the 10 minimum');
  assert.equal(campaignRow(p, entries, new Set([3, 7]), now).you, '#3, in the top 5');
  assert.equal(campaignRow(p, entries, new Set([7]), now).you, 'not scored yet');
  const ended = campaignRow({ ...p, ends_at: new Date('2026-10-01T00:00:00Z'), state: 'review' }, entries, new Set([2]), now);
  assert.deepEqual([ended.open, ended.you], [false, 'in review']);
});
