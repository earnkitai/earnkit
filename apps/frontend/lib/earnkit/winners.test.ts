import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWinners, rankEntries, standingText, type Candidate } from './winners';

const day = (d: number) => new Date(Date.UTC(2026, 9, d));
const e = (id: number, score: number | null, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  score,
  submitted_at: day(id),
  payout_wallet: `0x${String(id).padStart(40, '0')}`,
  installation_id: 100 + id,
  vetoed_at: null,
  payout_status: null,
  prize_tx: null,
  ...extra,
});
const c = { winners: 2, min_score: 10 };

test('rankEntries: score, then the earlier entry; unscored entries have no rank', () => {
  const list = [e(3, 20), e(1, 20), e(2, null), e(4, 30)];
  assert.deepEqual(rankEntries(list).map((x) => x.id), [4, 1, 3]);
});

test('pickWinners: one prize per payout wallet and per installation; vetoes and refusals move the next entry up', () => {
  const W = '0x' + 'f'.repeat(40);
  const all = [
    e(1, 50, { payout_wallet: W }),
    e(2, 40, { payout_wallet: W.toUpperCase().replace('0X', '0x') }), // same wallet
    e(3, 35, { installation_id: 101 }), // same installation as #1
    e(4, 30, { vetoed_at: day(20) }),
    e(5, 25, { payout_status: 'refused' }),
    e(6, 20),
    e(7, 9), // below the minimum
  ];
  const r = pickWinners(all, 2, 10);
  assert.deepEqual(r.winners.map((x) => x.id), [1, 6]);
  assert.deepEqual(r.skipped, [
    { id: 2, reason: 'one prize per payout wallet: another entry with this wallet is ahead' },
    { id: 3, reason: "one prize per agent: this agent's other entry is ahead" },
    { id: 4, reason: 'removed in review' },
    { id: 5, reason: "the payout wallet can't receive prizes" },
  ]);
});

test('standingText while running: no rank until scored, top, behind, short of the minimum, ties', () => {
  const all = [e(1, 30), e(2, 14), e(3, 10), e(4, 4), e(5, null)];
  const run = { state: 'running' as const, ended: false };
  assert.equal(standingText(all[4], all, c, run), 'not scored yet');
  assert.equal(standingText(all[0], all, c, run), '#1, in the top 2');
  assert.equal(standingText(all[2], all, c, run), '#3, 4 users behind #2');
  assert.equal(standingText(all[3], all, c, run), '#4, 6 users short of the 10 minimum');
  const tie = [e(1, 30), e(2, 14), e(3, 14)];
  assert.equal(standingText(tie[2], tie, c, run), '#3, level with #2 (the earlier entry wins ties)');
  const mine = [e(1, 30, { installation_id: 7 }), e(2, 20, { installation_id: 7 }), e(3, 12)];
  assert.equal(standingText(mine[1], mine, c, run), "#2, one prize per agent: this agent's other entry is ahead");
});

test('standingText after the end: winner, in review, not in top N', () => {
  const all = [e(1, 30), e(2, 20), e(3, 15)];
  assert.equal(standingText(all[0], all, c, { state: 'review', ended: true }), 'in review');
  assert.equal(standingText(all[0], all, c, { state: 'paying', ended: true }), 'winner');
  assert.equal(standingText({ ...all[1], prize_tx: '0xabc' }, all, c, { state: 'paid', ended: true }), 'winner');
  assert.equal(standingText(all[2], all, c, { state: 'review', ended: true }), 'not in top 2');
  assert.equal(standingText(all[2], all, c, { state: 'running', ended: true }), 'not in top 2');
});
