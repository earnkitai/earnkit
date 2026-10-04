import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEE_ALERT_USD, feeAlert, wethToUsd } from './fees';

test('wethToUsd', () => {
  assert.equal(wethToUsd(5n * 10n ** 16n, 3000), 150);
  assert.equal(wethToUsd(0n, 3000), 0);
});

test('feeAlert: only from $100, once per crossing and again for each $100 more; reset once claimed', () => {
  assert.equal(FEE_ALERT_USD, 100);
  assert.deepEqual(feeAlert(38, null), { show: false, next: null });
  assert.deepEqual(feeAlert(138, null), { show: true, next: 138 });
  assert.deepEqual(feeAlert(150, 138), { show: false, next: 138 });
  assert.deepEqual(feeAlert(240, 138), { show: true, next: 240 });
  assert.deepEqual(feeAlert(12, 240), { show: false, next: null }); // claimed
  assert.deepEqual(feeAlert(100, null), { show: true, next: 100 });
});
