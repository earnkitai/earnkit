import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { LIMITS, blockOf, busyText, clientIp, countHit, sweepWindows } from './rate-limit';
import { BUSY } from './mcp';

after(() => sql().end());

test('C8, #11 (v6.1.15): the hourly limit names itself and says how long the window has left, in minutes rounded up, hours over 90 minutes', () => {
  assert.equal(busyText(1), 'You have asked a lot this hour. Try again in about 1 minute.');
  assert.equal(busyText(60), 'You have asked a lot this hour. Try again in about 1 minute.');
  assert.equal(busyText(61), 'You have asked a lot this hour. Try again in about 2 minutes.');
  assert.equal(busyText(671), 'You have asked a lot this hour. Try again in about 12 minutes.');
  assert.equal(busyText(3_600), 'You have asked a lot this hour. Try again in about 60 minutes.');
  assert.equal(busyText(5_400), 'You have asked a lot this hour. Try again in about 90 minutes.');
  assert.equal(busyText(5_401), 'You have asked a lot this hour. Try again in about 2 hours.');
  assert.equal(busyText(86_400), 'You have asked a lot this hour. Try again in about 24 hours.');
  // `busy` stays only for errors.
  assert.equal(BUSY, 'EarnKit is busy. Try again in a minute.');
  assert.ok(!busyText(60).includes('busy'));
});

test('B5: no hosted per-address tier; the hosted tier only raises the per-client install limit', async () => {
  const { LIMITS } = await import('./rate-limit');
  assert.ok(!('oauthRegisterHosted' in LIMITS));
  assert.ok(!('installHourHosted' in LIMITS));
  assert.ok(LIMITS.installClientHosted.limit > LIMITS.installClient.limit);
});

test('I5 (v6.1.9 final), v6.1.16 Task 16: a hit never sweeps other keys; sweepWindows keeps a window 1 ms inside 2 days of the caller\'s clock and drops one 1 ms past', async () => {
  const old = new Date('2026-01-01T12:00:00Z');
  assert.equal(await countHit('i5-a', 3600, old), 1);
  assert.equal(await countHit('i5-a', 3600, old), 2);
  // Another key's hits, days later, leave i5-a alone: only the daily run sweeps.
  await countHit('i5-c', 3600, new Date(old.getTime() + 3 * 86_400_000));
  assert.equal(await countHit('i5-a', 3600, old), 3);
  const start = new Date('2026-01-01T12:00:00Z'); // i5-a's hour window starts here
  const twoDays = 2 * 86_400_000;
  assert.equal(await sweepWindows(new Date(start.getTime() + twoDays - 1)), 0);
  assert.equal(await sweepWindows(new Date(start.getTime() + twoDays)), 0);
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = 'i5-a'`).length, 1);
  assert.equal(await sweepWindows(new Date(start.getTime() + twoDays + 1)), 1);
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = 'i5-a'`).length, 0);
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = 'i5-c'`).length, 1);
});

test('B1 (v6.1.13): the shared hosted ceiling is gone; each address block has a daily cap of 5,000 sign-ups and 5,000 installs', () => {
  assert.ok(!('oauthRegisterHost' in LIMITS));
  assert.deepEqual(LIMITS.oauthRegisterBlock, { limit: 5_000, windowSeconds: 86_400 });
  assert.deepEqual(LIMITS.installBlock, { limit: 5_000, windowSeconds: 86_400 });
  const block = (ip: string) => blockOf(clientIp(new Headers({ 'x-forwarded-for': ip })));
  assert.equal(block('10.11.5.77'), '10.11.0.0/16');
  assert.equal(block('10.11.200.1'), '10.11.0.0/16');
  assert.equal(block('::ffff:10.11.5.78'), '10.11.0.0/16');
  assert.equal(block('2001:db8:11:5::1'), '2001:db8:11::/48');
  assert.equal(block('2001:0db8:0011:ffff:1:2:3:4'), '2001:db8:11::/48');
  assert.equal(block('[2001:db8::1]'), '2001:db8:0::/48');
  assert.equal(blockOf('unknown'), 'unknown');
  // M1 (fix round 1): the hex IPv4-mapped forms are the IPv4 address, never one shared ::/48.
  for (const ip of ['::ffff:a0b:54e', '::FFFF:0A0B:054E', '0:0:0:0:0:ffff:a0b:54e', '::ffff:0:a0b:54e'])
    assert.equal(clientIp(new Headers({ 'x-forwarded-for': ip })), '10.11.5.78', ip);
  assert.equal(block('::ffff:a0b:54e'), '10.11.0.0/16');
});
