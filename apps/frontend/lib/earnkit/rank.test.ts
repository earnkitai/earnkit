import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankWords, topPercentOf } from './rank';

test('2.8 under 50 ranked: "#N of M builders on EarnKit"', () => {
  assert.deepEqual(rankWords({ ranked: true, rank: 31, total: 40 }), { reply: "You're #31 of 40 builders on EarnKit.", short: '#31 of 40 builders on EarnKit' });
  assert.equal(rankWords({ ranked: true, rank: 1, total: 1 })?.short, '#1 of 1 builder on EarnKit');
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
