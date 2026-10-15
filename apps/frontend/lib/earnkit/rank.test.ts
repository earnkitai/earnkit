import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_PERCENT_FROM, CHAIN_CHIP_MIN, benchPercent, benchRank, percentText, rankWords, topPercentOf } from './rank';

test('2.8 under 50 ranked: "#N of M builders on EarnKit"', () => {
  assert.deepEqual(rankWords({ ranked: true, rank: 20, total: 40 }), { reply: "You're #20 of 40 builders on EarnKit.", short: '#20 of 40 builders on EarnKit' });
  assert.equal(rankWords({ ranked: true, rank: 1, total: 1 })?.short, '#1 of 1 builder on EarnKit');
});

test('2.8b under 50 ranked: only the top half gets a line; boundaries', () => {
  assert.equal(rankWords({ ranked: true, rank: 31, total: 40 }), null);
  assert.equal(rankWords({ ranked: true, rank: 21, total: 40 }), null);
  assert.equal(rankWords({ ranked: true, rank: 25, total: 49 })?.short, '#25 of 49 builders on EarnKit');
  assert.equal(rankWords({ ranked: true, rank: 26, total: 49 }), null);
  assert.equal(rankWords({ ranked: true, rank: 2, total: 3 })?.short, '#2 of 3 builders on EarnKit');
  assert.equal(rankWords({ ranked: true, rank: 3, total: 3 }), null);
  assert.equal(rankWords({ ranked: true, rank: 25, total: 50 })?.short, 'Top 50% of people building with AI');
  assert.equal(rankWords({ ranked: true, rank: 26, total: 50 }), null);
  assert.equal(rankWords({ ranked: true, rank: 5, total: 4 }), null);
});

test('2.9 from 50 ranked: "top N%" only when N is 50 or less; otherwise no rank line', () => {
  assert.equal(topPercentOf(10, 200), 5);
  assert.deepEqual(rankWords({ ranked: true, rank: 10, total: 200 }), { reply: "You're in the top 5% of people building with AI.", short: 'Top 5% of people building with AI' });
  assert.equal(rankWords({ ranked: true, rank: 100, total: 200 })?.short, 'Top 50% of people building with AI');
  assert.equal(rankWords({ ranked: true, rank: 101, total: 200 }), null);
});

test('2.10 not ranked: no rank line', () => {
  assert.equal(rankWords({ ranked: false, rank: 0, total: 40 }), null);
});

test('2.10b invalid numbers give no rank line', () => {
  assert.equal(rankWords({ ranked: true, rank: NaN, total: 40 }), null);
  assert.equal(rankWords({ ranked: true, rank: 3, total: NaN }), null);
});

test('7.1 P = 100 * rank / total: whole numbers rounded up from 1, one decimal rounded up under 1, never below 0.1 (review focus 1)', () => {
  assert.equal(benchPercent(10, 1000), 1, 'exactly 1');
  assert.equal(benchPercent(4, 100), 4);
  assert.equal(benchPercent(18, 100), 18);
  assert.equal(benchPercent(101, 200), 51, '50.5 rounds up');
  assert.equal(benchPercent(3, 1000), 0.3);
  assert.equal(benchPercent(1, 300), 0.4, '0.33 rounds up to 0.4');
  assert.equal(benchPercent(1, 1000), 0.1);
  assert.equal(benchPercent(1, 5000), 0.1, '0.02 floors at 0.1');
  assert.equal(percentText(0.3), '0.3');
  assert.equal(percentText(4), '4');
  assert.equal(BENCH_PERCENT_FROM, 20);
  assert.equal(CHAIN_CHIP_MIN, 10);
});

test('7.2 "Top P%" only from 20 ranked and P <= 50; "#N of M" under 20 in the top half; otherwise no line (review focus 1)', () => {
  const s = (rank: number, total: number) => ({ ranked: true, rank, total });
  assert.deepEqual(benchRank(s(18, 100)), { short: 'Top 18% on the Bench', phrase: 'top 18% of builders' });
  assert.deepEqual(benchRank(s(3, 1000)), { short: 'Top 0.3% on the Bench', phrase: 'top 0.3% of builders' });
  assert.deepEqual(benchRank(s(1, 9000)), { short: 'Top 0.1% on the Bench', phrase: 'top 0.1% of builders' });
  assert.deepEqual(benchRank(s(10, 20)), { short: 'Top 50% on the Bench', phrase: 'top 50% of builders' }, 'P exactly 50 shows');
  assert.equal(benchRank(s(500_001, 1_000_000)), null, '50.0001 does not');
  assert.equal(benchRank(s(11, 20)), null);
  assert.deepEqual(benchRank(s(10, 19)), { short: '#10 of 19 on the Bench', phrase: '#10 of 19 builders' });
  assert.equal(benchRank(s(11, 19)), null, 'outside the top half');
  assert.deepEqual(benchRank(s(1, 1)), { short: '#1 of 1 on the Bench', phrase: '#1 of 1 builder' });
  for (const bad of [{ ranked: false, rank: 1, total: 30 }, s(0, 30), s(31, 30), s(Number.NaN, 30)]) assert.equal(benchRank(bad), null);
});

test('7.3 the same rule inside a chain\'s pool names the chain', () => {
  const s = (rank: number, total: number) => ({ ranked: true, rank, total });
  assert.deepEqual(benchRank(s(1, 100), { chain: 'base' }), { short: 'Top 1% on Base', phrase: 'top 1% on Base' });
  assert.deepEqual(benchRank(s(1, 2000), { chain: 'arc' }), { short: 'Top 0.1% on Arc', phrase: 'top 0.1% on Arc' });
  assert.deepEqual(benchRank(s(2, 12), { chain: 'robinhood' }), { short: '#2 of 12 on Robinhood Chain', phrase: '#2 of 12 on Robinhood Chain' });
});
