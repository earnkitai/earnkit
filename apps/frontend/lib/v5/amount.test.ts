import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAP_RATES, amountsOverCap, overCap, readAmount } from './amount';

test('L22-6 (v6.1.16): the seven spellings read 5,000 in USD, USD, USD, USD, USD, EUR and GBP', () => {
  const read = ['5k', '$5,000', '5000 USD', 'USD 5000', '5,000.00', '€5000', '£5000'].map((amount) => readAmount({ amount }));
  assert.deepEqual(read, [
    { value: 5000, currency: 'USD' }, { value: 5000, currency: 'USD' }, { value: 5000, currency: 'USD' }, { value: 5000, currency: 'USD' },
    { value: 5000, currency: 'USD' }, { value: 5000, currency: 'EUR' }, { value: 5000, currency: 'GBP' },
  ]);
  assert.deepEqual(readAmount({ amount: '5K' }), { value: 5000, currency: 'USD' });
  assert.deepEqual(readAmount({ amount: '2.5k EUR' }), { value: 2500, currency: 'EUR' });
});

test('L22-6 (v6.1.16): cents are kept, never rounded away; a dot-thousands amount is ambiguous', () => {
  assert.deepEqual(readAmount({ amount: '$2,500.50' }), { value: 2500.5, currency: 'USD' });
  assert.deepEqual(readAmount({ amount_usd: 1234.56 }), { value: 1234.56, currency: 'USD' });
  assert.deepEqual(readAmount({ amount: 0.4 }), { value: 0.4, currency: 'USD' });
  assert.equal(readAmount({ amount: '5.000' }), 'ambiguous');
  assert.equal(readAmount({ amount: '1.000.000' }), 'ambiguous');
  assert.equal(readAmount({ amount: 'lots' }), 'bad');
  assert.equal(readAmount({ amount: '5000', currency: 'EURO' }), 'bad');
  assert.equal(readAmount({}), null);
});

test('L22-4, L22-5 (v6.1.16): the cap compares the given amount before rounding; a listed code at its rate; an unknown code by its number', () => {
  assert.equal(overCap(10_000.99, 'USD', 10_000), true);
  assert.equal(overCap(10_000, 'USD', 10_000), false);
  assert.equal(overCap(50_000, 'EUR', 10_000), true);
  assert.equal(overCap(7_000, 'EUR', 10_000), false);
  assert.equal(overCap(1_000_000, 'JPY', 10_000), false);
  assert.equal(overCap(10_001, 'XYZ', 10_000), true);
  assert.equal(overCap(9_999, 'XYZ', 10_000), false);
  assert.equal(amountsOverCap({ USD: 5_000, EUR: 4_000 }, 10_000), false);
  assert.equal(amountsOverCap({ USD: 5_000, EUR: 4_100 }, 10_000), true);
  // Each rate is above 1 unit's recent value, so a foreign amount never slips under a cap.
  for (const [code, rate] of Object.entries(CAP_RATES)) assert.ok(rate > 0, code);
  assert.ok(CAP_RATES.EUR >= 1.2 && CAP_RATES.GBP >= 1.4);
});
