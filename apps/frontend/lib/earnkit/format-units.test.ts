import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatExact } from './format-units';

test('formats a fractional amount exactly, without rounding to 3 decimals', () => {
  // 1234500 units at 6 decimals is 1.2345 — Number(...).toLocaleString() would round this to
  // "1.235", which is a different amount than the one signed onchain.
  assert.equal(formatExact(1234500n, 6), '1.2345');
});

test('an uneven split keeps all the fraction digits', () => {
  // The 10% fee split in sponsor-rules.ts can produce five fraction digits for a USDC (6
  // decimal) amount; all of them must round-trip to the display.
  assert.equal(formatExact(111050n, 6), '0.11105');
});

test('adds thousands separators to the integer part only', () => {
  assert.equal(formatExact(1234567890000n, 6), '1,234,567.89');
});

test('a whole number has no trailing decimal point', () => {
  assert.equal(formatExact(5000000000000n, 6), '5,000,000');
});

test('zero formats as "0"', () => {
  assert.equal(formatExact(0n, 6), '0');
});
