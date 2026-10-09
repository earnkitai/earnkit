import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { FREE_CAPS, freeTierRoom, periodKey, takeFreeTier } from './free-tier';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('periodKey: a UTC day or month', () => {
  const now = new Date('2026-10-08T23:30:00Z');
  assert.equal(periodKey('day', now), '2026-10-08');
  assert.equal(periodKey('month', now), '2026-10');
  assert.equal(FREE_CAPS.r2Writes.cap, 900_000);
  assert.equal(FREE_CAPS.resendDay.cap, 100);
  assert.equal(FREE_CAPS.resendMonth.cap, 3_000);
});

// A day far from any other test's, so the counters start at zero.
const day = (n: number) => new Date(Date.UTC(2091, 0, 1 + n, 12));
const clear = (name: string, periods: string[]) => sql()`DELETE FROM free_tier_usage WHERE name = ${name} AND period IN ${sql()(periods)}`;

test('8.14 takeFreeTier: 100 a day then refused; concurrent takes stop at exactly 100; a new day starts again', db, async () => {
  const d1 = day(Number(process.pid % 300));
  const d2 = new Date(d1.getTime() + 86_400_000);
  await clear('resendDay', [periodKey('day', d1), periodKey('day', d2)]);
  try {
    for (let i = 0; i < 100; i++) assert.equal(await takeFreeTier('resendDay', 1, d1), true, `take ${i + 1}`);
    assert.equal(await takeFreeTier('resendDay', 1, d1), false, 'the 101st is refused');
    // A new day starts again; 120 at once succeed exactly 100 times.
    const got = await Promise.all(Array.from({ length: 120 }, () => takeFreeTier('resendDay', 1, d2)));
    assert.equal(got.filter(Boolean).length, 100);
    const [{ used }] = await sql()<{ used: number }[]>`
      SELECT used FROM free_tier_usage WHERE name = 'resendDay' AND period = ${periodKey('day', d2)}`;
    assert.equal(used, 100);
  } finally {
    await clear('resendDay', [periodKey('day', d1), periodKey('day', d2)]);
  }
});

test('8.14 r2Writes refuses a batch that would cross 900,000 and leaves the counter alone', db, async () => {
  const m = new Date(Date.UTC(2093, Number(process.pid % 12), 5));
  const key = periodKey('month', m);
  await clear('r2Writes', [key]);
  try {
    assert.equal(await takeFreeTier('r2Writes', 899_990, m), true);
    assert.equal(await freeTierRoom('r2Writes', 10, m), true);
    assert.equal(await freeTierRoom('r2Writes', 11, m), false);
    assert.equal(await takeFreeTier('r2Writes', 11, m), false, 'crosses 900,000');
    assert.equal(await takeFreeTier('r2Writes', 10, m), true, 'exactly 900,000 fits');
    assert.equal(await takeFreeTier('r2Writes', 1, m), false);
    assert.equal(await takeFreeTier('r2Writes', 900_001, new Date(Date.UTC(2094, 0, 1))), false, 'over the cap alone');
  } finally {
    await clear('r2Writes', [key]);
  }
});
