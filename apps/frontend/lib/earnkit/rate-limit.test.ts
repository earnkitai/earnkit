import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { clientIp, hit, hitResult, retryText, windowStart } from './rate-limit';

test('windowStart: fixed minute windows', () => {
  assert.equal(
    windowStart(new Date('2026-10-03T10:00:59.999Z'), 60_000).toISOString(),
    '2026-10-03T10:00:00.000Z',
  );
  assert.equal(
    windowStart(new Date('2026-10-03T10:01:00.000Z'), 60_000).toISOString(),
    '2026-10-03T10:01:00.000Z',
  );
});

test('hitResult: allowed up to the limit, then refused until the window ends', () => {
  const now = new Date('2026-10-03T10:00:20.000Z');
  assert.deepEqual(hitResult(1, 5, 60, now), {
    allowed: true,
    remaining: 4,
    retryAfter: 40,
  });
  assert.deepEqual(hitResult(5, 5, 60, now), {
    allowed: true,
    remaining: 0,
    retryAfter: 40,
  });
  assert.equal(hitResult(6, 5, 60, now).allowed, false);
  // Daily windows end at UTC midnight.
  assert.equal(
    hitResult(1, 5, 86_400, new Date('2026-10-03T23:00:00.000Z')).retryAfter,
    3_600,
  );
});

test('retryText: readable waits', () => {
  assert.equal(retryText(1), 'a minute');
  assert.equal(retryText(61), '2 minutes');
  assert.equal(retryText(3_600), 'an hour');
  assert.equal(retryText(5 * 3_600 + 1), '6 hours');
});

test('clientIp: the proxy-appended (rightmost) forwarded address, not a client-sent one', () => {
  assert.equal(
    clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })),
    '203.0.113.9',
  );
  assert.equal(
    clientIp(new Headers({ 'x-real-ip': '198.51.100.2' })),
    '198.51.100.2',
  );
  assert.equal(clientIp(new Headers()), 'unknown');
});

// Against a real database when one is configured (the local stack); skipped otherwise.
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test(
  'hit: counts atomically under parallel calls, and a new window starts over',
  db,
  async () => {
    const key = `test:${process.pid}:${Date.now()}`;
    const t0 = new Date('2026-10-03T10:00:05.000Z');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => hit(key, 5, 60, t0)),
    );
    assert.equal(results.filter((r) => r.allowed).length, 5);
    assert.deepEqual(
      results.map((r) => r.remaining).sort(),
      [0, 0, 0, 0, 1, 2, 3, 4],
    );
    // The next minute is a fresh window, and its first hit clears the old one.
    const next = await hit(key, 5, 60, new Date('2026-10-03T10:01:00.000Z'));
    assert.deepEqual(next, { allowed: true, remaining: 4, retryAfter: 60 });
    const rows =
      await sql()`SELECT window_start FROM rate_windows WHERE key = ${key}`;
    assert.equal(rows.length, 1);
    await sql()`DELETE FROM rate_windows WHERE key = ${key}`;
  },
);
