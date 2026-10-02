import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, windowStart } from './rate-limit';

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
