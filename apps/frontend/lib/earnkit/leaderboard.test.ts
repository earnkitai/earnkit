import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignRow, earnkitCampaignRows } from './leaderboard';
import type { CampaignConfig } from './campaigns';
import { sql } from './db';

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

test('I1: the cutoff is the last payable pick (min score, vetoes, one prize per wallet), else null', () => {
  // Under the minimum: nobody is payable, so the field is "not full", never "#5 has 2 users".
  const low = campaignRow(p, [30, 8, 5, 3, 2].map((s, i) => entry(i + 1, s)), new Set(), now);
  assert.deepEqual([low.cutoff, low.scored, low.min_score], [null, 5, 10]);
  // A vetoed #1 and a repeated wallet don't hold a slot: the bar is the 5th payable entry.
  const entries = [40, 30, 25, 20, 18, 14, 12].map((s, i) => entry(i + 1, s));
  entries[0].vetoed_at = new Date() as never;
  entries[2].payout_wallet = entries[1].payout_wallet;
  assert.equal(campaignRow(p, entries, new Set(), now).cutoff, 12);
  // Before the first scoring nothing is scored.
  assert.equal(campaignRow(p, [entry(1, null), entry(2, null)], new Set(), now).scored, 0);
});

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('earnkitCampaignRows: an ended entry made elsewhere with a wallet this agent owns (any case) is "yours"', db, async () => {
  const tag = `test-rows-${process.pid}-${Date.now()}`;
  const ids = [`${tag}-open`, `${tag}-ended`, `${tag}-other`];
  const wallet = '0xAbCdEf0000000000000000000000000000000001';
  const insert = (id: string, endsInMs: number, status: string) => sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, campaign, ends_at)
    VALUES (${id}, 'o', ${id}, 'd', 'https://x', 'https://x', 'r', 's', ${status}, 'unknown', ${sql().json(campaign as never)}, ${new Date(Date.now() + endsInMs)})`;
  await insert(ids[0], 86_400_000, 'active');
  await insert(ids[1], -86_400_000, 'closed');
  await insert(ids[2], -86_400_000, 'closed');
  const [me] = await sql()`INSERT INTO installations (token_hash) VALUES (${tag + '-me'}) RETURNING id`;
  const [other] = await sql()`INSERT INTO installations (token_hash) VALUES (${tag + '-other'}) RETURNING id`;
  try {
    await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${me.id}, ${wallet.toLowerCase()})`;
    await sql()`INSERT INTO campaign_runs (program_id, state) VALUES (${ids[1]}, 'review')`;
    await sql()`
      INSERT INTO projects (program_id, name, installation_id, payout_wallet, score) VALUES
        (${ids[1]}, 'mine', ${other.id}, ${wallet}, 15),
        (${ids[2]}, 'theirs', ${other.id}, ${'0x' + '4'.repeat(40)}, 15)`;
    const rows = (await earnkitCampaignRows(me.id)).filter((r) => ids.includes(r.id));
    assert.deepEqual(
      rows.map((r) => [r.id, r.open, r.you]),
      [[ids[1], false, 'in review'], [ids[0], true, null]],
    );
  } finally {
    await sql()`DELETE FROM projects WHERE program_id IN ${sql()(ids)}`;
    await sql()`DELETE FROM campaign_runs WHERE program_id IN ${sql()(ids)}`;
    await sql()`DELETE FROM programs WHERE id IN ${sql()(ids)}`;
    await sql()`DELETE FROM installations WHERE id IN ${sql()([me.id, other.id])}`;
  }
});
