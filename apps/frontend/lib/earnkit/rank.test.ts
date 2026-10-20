import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANK_PERCENT_FROM, benchPercent, percentText, rankLine, scoreLine } from './rank';

test('7.1 P = 100 * rank / total: whole numbers rounded up from 1, one decimal rounded up under 1, never below 0.1 (review focus 1)', () => {
  assert.equal(benchPercent(10, 1000), 1, 'exactly 1');
  assert.equal(benchPercent(4, 100), 4);
  assert.equal(benchPercent(18, 100), 18);
  assert.equal(benchPercent(101, 200), 51, '50.5 rounds up');
  assert.equal(benchPercent(3, 1000), 0.3);
  assert.equal(benchPercent(1, 300), 0.4, '0.33 rounds up to 0.4');
  assert.equal(benchPercent(1, 1000), 0.1);
  assert.equal(benchPercent(1, 5000), 0.1, '0.02 floors at 0.1');
  assert.equal(benchPercent(7, 100), 7, 'naive ceil(rank/total*100) gives 8');
  assert.equal(benchPercent(21, 75), 28, 'naive gives 29');
  assert.equal(benchPercent(7, 10000), 0.1);
  assert.equal(benchPercent(11, 1000), 2, 'P in (1, 2)');
  assert.equal(percentText(0.3), '0.3');
  assert.equal(percentText(4), '4');
  assert.equal(RANK_PERCENT_FROM, 20);
});

test('7.2 under 20 ranked: "#N of M builders" for everyone; from 20: "Top P% of builders" in the top half, "#N of M" for the rest', () => {
  const s = (rank: number, total: number) => ({ ranked: true, rank, total });
  assert.equal(rankLine(s(1, 1)), '#1 of 1 builder');
  assert.equal(rankLine(s(19, 19)), '#19 of 19 builders', 'the last place still sees a rank');
  assert.equal(rankLine(s(10, 19)), '#10 of 19 builders');
  assert.equal(rankLine(s(18, 100)), 'Top 18% of builders');
  assert.equal(rankLine(s(3, 1000)), 'Top 0.3% of builders');
  assert.equal(rankLine(s(10, 20)), 'Top 50% of builders', 'P exactly 50 is the top half');
  assert.equal(rankLine(s(11, 20)), '#11 of 20 builders');
  assert.equal(rankLine(s(500_001, 1_000_000)), '#500,001 of 1,000,000 builders', 'thousands separators');
  assert.equal(rankLine(s(2004, 3500)), '#2,004 of 3,500 builders');
  for (const bad of [{ ranked: false, rank: 1, total: 30 }, s(0, 30), s(31, 30), s(Number.NaN, 30)]) assert.equal(rankLine(bad), null);
});

test('7.3 the same rule inside a chain\'s pool names the chain, from one ranked project', () => {
  const s = (rank: number, total: number) => ({ ranked: true, rank, total });
  assert.equal(rankLine(s(1, 100), { chain: 'base' }), 'Top 1% of builders on Base');
  assert.equal(rankLine(s(2, 12), { chain: 'robinhood' }), '#2 of 12 builders on Robinhood Chain');
  assert.equal(rankLine(s(1, 1), { chain: 'arc' }), '#1 of 1 builder on Arc');
});

test('7.4 the one score line: "Shipping 72 · #3 of 40 builders", the number alone without a rank', () => {
  assert.equal(scoreLine(72, rankLine({ ranked: true, rank: 3, total: 40 })), 'Shipping 72 · Top 8% of builders');
  assert.equal(scoreLine(72, rankLine({ ranked: true, rank: 3, total: 19 })), 'Shipping 72 · #3 of 19 builders');
  assert.equal(scoreLine(0, null), 'Shipping 0');
});
