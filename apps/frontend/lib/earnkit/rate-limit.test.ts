import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import {
  clientIp,
  hit,
  hitResult,
  ipKey,
  retryText,
  windowStart,
} from './rate-limit';

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

test("clientIp: X-Real-IP (set by Railway's edge) first, then the rightmost forwarded hop", () => {
  // A client-sent X-Forwarded-For never beats the edge's X-Real-IP.
  assert.equal(
    clientIp(
      new Headers({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '203.0.113.9' }),
    ),
    '203.0.113.9',
  );
  assert.equal(
    clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })),
    '203.0.113.9',
  );
  assert.equal(clientIp(new Headers(), '198.51.100.4'), '198.51.100.4');
  assert.equal(clientIp(new Headers()), 'unknown');
});

test('clientIp: IPv6 is keyed on its /64, so rotating within it shares one limit', () => {
  const v6 = (ip: string) => clientIp(new Headers({ 'x-real-ip': ip }));
  assert.equal(v6('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(v6('2001:db8::2'), v6('2001:db8::1'));
  assert.equal(v6('2001:db8:0:0:ffff:1:2:3'), '2001:db8:0:0::/64');
  assert.notEqual(v6('2001:db8:0:1::1'), v6('2001:db8::1'));
  assert.equal(v6('2001:0DB8:00ab:0001:aaaa::9'), '2001:db8:ab:1::/64');
  assert.equal(v6('[2001:db8::1]'), '2001:db8:0:0::/64');
  assert.equal(v6('::ffff:192.0.2.7'), '192.0.2.7');
  assert.equal(v6('::1'), '0:0:0:0::/64');
  assert.equal(ipKey('fe80::1%en0'), 'fe80:0:0:0::/64');
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
    // Windows near now: a fixed past date can be swept mid-test by any file's stale-window sweep
    // (over 2 days old), which made this test flaky (Part 2 fix wave).
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    const t0 = new Date(minute + 5_000);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => hit(key, 5, 60, t0)),
    );
    assert.equal(results.filter((r) => r.allowed).length, 5);
    assert.deepEqual(
      results.map((r) => r.remaining).sort(),
      [0, 0, 0, 0, 1, 2, 3, 4],
    );
    // The next minute is a fresh window, and its first hit clears the old one.
    const next = await hit(key, 5, 60, new Date(minute + 60_000));
    assert.deepEqual(next, { allowed: true, remaining: 4, retryAfter: 60 });
    const rows =
      await sql()`SELECT window_start FROM rate_windows WHERE key = ${key}`;
    assert.equal(rows.length, 1);
    await sql()`DELETE FROM rate_windows WHERE key = ${key}`;
  },
);
