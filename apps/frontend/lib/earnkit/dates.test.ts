import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDeadline } from './dates';

test('formatDeadline: "Mon D, YYYY, HH:MM UTC" from a Date or an ISO string', () => {
  assert.equal(
    formatDeadline(new Date('2026-10-06T06:51:30Z')),
    'Oct 6, 2026, 06:51 UTC',
  );
  assert.equal(
    formatDeadline('2026-10-06T06:51:00Z'),
    'Oct 6, 2026, 06:51 UTC',
  );
});

test('formatDeadline converts offsets to UTC and pads hours and minutes', () => {
  assert.equal(
    formatDeadline('2026-10-14T23:59:00-04:00'),
    'Oct 15, 2026, 03:59 UTC',
  );
  assert.equal(
    formatDeadline('2026-01-01T00:05:00Z'),
    'Jan 1, 2026, 00:05 UTC',
  );
  assert.equal(
    formatDeadline('2026-12-31T09:00:00Z'),
    'Dec 31, 2026, 09:00 UTC',
  );
});
