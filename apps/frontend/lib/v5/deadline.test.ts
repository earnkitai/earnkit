import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDay, timeLeftWords } from './deadline';

const NOW = new Date('2026-11-04T12:00:00Z');

test('timeLeftWords: hours under 48, days after, null once passed', () => {
  assert.equal(timeLeftWords('2026-11-04T12:30:00Z', NOW), 'in under an hour');
  assert.equal(timeLeftWords('2026-11-04T13:00:00Z', NOW), 'in 1 hour');
  assert.equal(timeLeftWords('2026-11-06T11:00:00Z', NOW), 'in 47 hours');
  assert.equal(timeLeftWords('2026-11-20T12:00:00Z', NOW), 'in 16 days');
  assert.equal(timeLeftWords('2026-11-04T12:00:00Z', NOW), null);
});

test("closeDay: the day in the program's zone, null when rolling", () => {
  const a16z = { summary: 'Up to $1M · closes Nov 1, 11:59 PM PT', ends_at: '2026-11-02T07:59:59Z' };
  assert.equal(closeDay(a16z), 'Nov 1');
  assert.equal(closeDay({ ...a16z, summary: 'Up to $1M' }), 'Nov 2');
  assert.equal(closeDay({ ...a16z, tz: 'Asia/Kolkata', summary: 'Up to $1M' }), 'Nov 2');
  assert.equal(closeDay({ summary: 'Up to $5K · rolling', ends_at: '2026-12-01T00:00:00Z' }), null);
  assert.equal(closeDay({ summary: 'Up to $5K', ends_at: null }), null);
});
