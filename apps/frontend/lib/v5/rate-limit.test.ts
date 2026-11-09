import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyText } from './rate-limit';

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
