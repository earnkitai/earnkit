import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { busyText, countHit, setSweepForTests } from './rate-limit';

after(() => sql().end());

test('C8: the busy line says how long the window has left, in minutes rounded up, hours over 90 minutes', () => {
  assert.equal(busyText(1), 'EarnKit is busy. Try again in about 1 minute.');
  assert.equal(busyText(60), 'EarnKit is busy. Try again in about 1 minute.');
  assert.equal(busyText(61), 'EarnKit is busy. Try again in about 2 minutes.');
  assert.equal(busyText(671), 'EarnKit is busy. Try again in about 12 minutes.');
  assert.equal(busyText(3_600), 'EarnKit is busy. Try again in about 60 minutes.');
  assert.equal(busyText(5_400), 'EarnKit is busy. Try again in about 90 minutes.');
  assert.equal(busyText(5_401), 'EarnKit is busy. Try again in about 2 hours.');
  assert.equal(busyText(86_400), 'EarnKit is busy. Try again in about 24 hours.');
});

test('B5: no hosted per-address tier; the hosted tier only raises the per-client install limit', async () => {
  const { LIMITS } = await import('./rate-limit');
  assert.ok(!('oauthRegisterHosted' in LIMITS));
  assert.ok(!('installHourHosted' in LIMITS));
  assert.ok(LIMITS.installClientHosted.limit > LIMITS.installClient.limit);
});

test('I5 (v6.1.9 final): the sweep compares windows against the caller\'s clock, so a fixed old clock keeps its counts', async () => {
  const old = new Date('2026-01-01T12:00:00Z');
  setSweepForTests(true);
  try {
    assert.equal(await countHit('i5-a', 3600, old), 1);
    assert.equal(await countHit('i5-a', 3600, old), 2);
    // A first hit of another window sweeps; the first window is not two days older than the caller's clock.
    assert.equal(await countHit('i5-b', 3600, old), 1);
    assert.equal(await countHit('i5-a', 3600, old), 3);
    // Three days later by the caller's clock, the old windows are swept.
    await countHit('i5-c', 3600, new Date(old.getTime() + 3 * 86_400_000));
    const left = await sql()<{ key: string }[]>`SELECT key FROM rate_windows WHERE key IN ('i5-a', 'i5-b')`;
    assert.equal(left.length, 0);
  } finally {
    setSweepForTests(undefined);
  }
});
