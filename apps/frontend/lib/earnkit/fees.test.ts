import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { FEE_ALERT_USD, FEE_RETRY_MS, cachedFeesUsd, feeAlert, setFeeSource, wethToUsd } from './fees';

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

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  setFeeSource(null);
  if (process.env.DATABASE_URL) await sql().end();
});

test('cachedFeesUsd: reads in the background, caches, and backs off a failed wallet for an hour', db, async () => {
  const ok = '0x' + Math.floor(Math.random() * 1e12).toString(16).padStart(40, 'c');
  const bad = '0x' + Math.floor(Math.random() * 1e12).toString(16).padStart(40, 'd');
  const reads: string[] = [];
  setFeeSource({
    availableWeth: async (w) => {
      reads.push(w);
      if (w === bad) throw new Error('rpc down');
      return 5n * 10n ** 16n;
    },
    wethUsd: async () => 3000,
  });
  const settle = () => new Promise((r) => setTimeout(r, 200));
  try {
    assert.equal(await cachedFeesUsd([ok]), null); // never waits on a read
    await settle();
    assert.equal(await cachedFeesUsd([ok]), 150);
    assert.deepEqual(reads, [ok]);
    await cachedFeesUsd([bad]);
    await settle();
    await cachedFeesUsd([bad]);
    await settle();
    assert.deepEqual(reads, [ok, bad]); // not retried
    await cachedFeesUsd([bad], Date.now() + FEE_RETRY_MS + 1);
    await settle();
    assert.deepEqual(reads, [ok, bad, bad]);
  } finally {
    await sql()`DELETE FROM token_fees WHERE wallet IN ${sql()([ok, bad])}`;
  }
});
