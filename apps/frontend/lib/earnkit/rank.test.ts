import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankWords, topPercentOf } from './rank';

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
