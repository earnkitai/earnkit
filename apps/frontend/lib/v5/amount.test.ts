import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAP_RATES, KNOWN_CURRENCIES, UNKNOWN_CURRENCY, amountsOverCap, overCap, readAmount, underADollar, usdAt } from './amount';

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
  // L45-4 (v6.1.19): a four-letter code that is not one EarnKit knows is named.
  assert.deepEqual(readAmount({ amount: '5000', currency: 'EURO' }), { unknownCurrency: 'EURO' });
  // Fix round 1 (M4): 2 to 6 letters is a code; 7 is not one.
  assert.deepEqual(readAmount({ amount: '5000', currency: 'EUROS' }), { unknownCurrency: 'EUROS' });
  assert.equal(readAmount({ amount: '5000', currency: 'EUROSSS' }), 'bad');
  assert.equal(readAmount({}), null);
});

test('L22-4, L22-5 (v6.1.16), L45-4 (v6.1.19): the cap compares the given amount before rounding; a listed code at its rate; fix round 1: every coin at a cap rate, a code with none weighs as infinite', () => {
  assert.equal(overCap(10_000.99, 'USD', 10_000), true);
  assert.equal(overCap(10_000, 'USD', 10_000), false);
  assert.equal(overCap(50_000, 'EUR', 10_000), true);
  assert.equal(overCap(7_000, 'EUR', 10_000), false);
  assert.equal(overCap(1_000_000, 'JPY', 10_000), false);
  // Fix round 1 (security, v6.1.19): a coin never weighs 0: stablecoins at the peg, ETH, BTC and SOL at cap-only upper
  // bounds; a code with no cap rate weighs as infinite.
  assert.equal(overCap(10_001, 'USDC', 10_000), true);
  assert.equal(overCap(10_000, 'USDT', 10_000), false);
  assert.equal(overCap(1, 'ETH', 10_000), false);
  assert.equal(overCap(1.01, 'ETH', 10_000), true);
  assert.equal(overCap(0.05, 'BTC', 10_000), true);
  assert.equal(overCap(11, 'SOL', 10_000), true);
  assert.equal(overCap(1, 'XYZ', 10_000), true);
  assert.equal(amountsOverCap({ USD: 9_000, BTC: 5_000 }, 10_000), true);
  assert.equal(amountsOverCap({ USD: 9_000, USDC: 1_000 }, 10_000), false);
  for (const c of KNOWN_CURRENCIES) assert.ok(c === 'USD' || Object.hasOwn(CAP_RATES, c), c);
  assert.equal(amountsOverCap({ USD: 5_000, EUR: 4_000 }, 10_000), false);
  assert.equal(amountsOverCap({ USD: 5_000, EUR: 4_100 }, 10_000), true);
  // Each rate is above 1 unit's recent value, so a foreign amount never slips under a cap.
  for (const [code, rate] of Object.entries(CAP_RATES)) assert.ok(rate > 0, code);
  assert.ok(CAP_RATES.EUR >= 1.2 && CAP_RATES.GBP >= 1.4);
});

test('M2 (v6.1.16 Task 8 fix round 1): the reader keeps the given value unrounded, so the cap reads it first', () => {
  assert.deepEqual(readAmount({ amount: '10000.004' }), { value: 10000.004, currency: 'USD' });
  assert.equal(overCap(10000.004, 'USD', 10_000), true);
});

test('v6.1.16 Task 8 N3 (v6.1.17): an amount starting with 0. is never ambiguous; 1.234 still is', () => {
  assert.deepEqual(readAmount({ amount: '0.001' }), { value: 0.001, currency: 'USD' });
  assert.deepEqual(readAmount({ amount: '$0.500' }), { value: 0.5, currency: 'USD' });
  assert.deepEqual(readAmount({ amount: 'USD 0.250' }), { value: 0.25, currency: 'USD' });
  assert.equal(readAmount({ amount: '1.234' }), 'ambiguous');
  assert.equal(readAmount({ amount: '10.000' }), 'ambiguous');
});

test('v6.1.17 final round (Task 2 review N1): a leading 0, is a decimal comma, never a thousands group', () => {
  assert.deepEqual(readAmount({ amount: '0,500' }), { value: 0.5, currency: 'USD' });
  assert.deepEqual(readAmount({ amount: '0,001' }), { value: 0.001, currency: 'USD' });
  assert.deepEqual(readAmount({ amount: '€0,25' }), { value: 0.25, currency: 'EUR' });
  assert.deepEqual(readAmount({ amount: '5,000' }), { value: 5000, currency: 'USD' });
  assert.equal(readAmount({ amount: '0,5,000' }), 'bad');
});

test('L45-4 (v6.1.19): only known currencies are read; any other code is named, not weighed by its number', () => {
  assert.deepEqual(KNOWN_CURRENCIES, ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'SGD', 'BRL', 'ETH', 'BTC', 'SOL', 'USDC', 'USDT']);
  assert.deepEqual(readAmount({ amount: '1 ABC' }), { unknownCurrency: 'ABC' });
  assert.deepEqual(readAmount({ amount: '4999 XYZ' }), { unknownCurrency: 'XYZ' });
  assert.deepEqual(readAmount({ amount: '8999 KRW' }), { unknownCurrency: 'KRW' });
  assert.deepEqual(readAmount({ amount: '5000 MATIC' }), { unknownCurrency: 'MATIC' });
  assert.deepEqual(readAmount({ amount: '5k EUR' }), { value: 5000, currency: 'EUR' });
  assert.deepEqual(readAmount({ amount: 1, currency: 'abc' }), { unknownCurrency: 'ABC' });
  assert.deepEqual(readAmount({ amount: '5000 BTC' }), { value: 5000, currency: 'BTC' });
  assert.deepEqual(readAmount({ amount: 1, currency: 'btc' }), { value: 1, currency: 'BTC' });
  assert.deepEqual(readAmount({ amount: '250 USDC' }), { value: 250, currency: 'USDC' });
  assert.deepEqual(readAmount({ amount: 'USDT 1,000' }), { value: 1000, currency: 'USDT' });
  assert.equal(UNKNOWN_CURRENCY('ABC'), 'I do not know the currency "ABC". Say the amount with its currency.');
  assert.equal(usdAt(100, 'EUR'), 125);
  assert.equal(usdAt(100, 'XYZ'), null);
  assert.equal(usdAt(2, 'USDC'), 2);
});

test('L45-3 (v6.1.19): a win under one dollar once converted is under a dollar; a code with no rate is not judged', () => {
  assert.equal(underADollar(0.001, 'USD'), true);
  assert.equal(underADollar(0.99, 'USD'), true);
  assert.equal(underADollar(1, 'USD'), false);
  assert.equal(underADollar(100, 'JPY'), true);
  assert.equal(underADollar(200, 'JPY'), false);
  assert.equal(underADollar(0.000001, 'BTC'), true);
  assert.equal(underADollar(0.001, 'BTC'), false);
});
