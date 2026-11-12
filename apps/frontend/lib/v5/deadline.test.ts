import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDay, closesLead, closesWords, dayWords } from './deadline';

const NOW = new Date('2026-11-04T12:00:00Z');

test('L23-9 (v6.1.16): closesWords: under an hour, today, tomorrow, in n days within 14, else the day; closed once passed', () => {
  assert.equal(closesWords('2026-11-04T12:30:00Z', NOW, 'UTC'), 'closes in under an hour');
  // One minute before the close.
  assert.equal(closesWords('2026-11-04T12:01:00Z', NOW, 'UTC'), 'closes in under an hour');
  assert.equal(closesWords('2026-11-04T13:00:00Z', NOW, 'UTC'), 'closes today');
  assert.equal(closesWords('2026-11-05T11:00:00Z', NOW, 'UTC'), 'closes tomorrow');
  assert.equal(closesWords('2026-11-06T11:00:00Z', NOW, 'UTC'), 'closes in 2 days');
  assert.equal(closesWords('2026-11-18T23:00:00Z', NOW, 'UTC'), 'closes in 14 days');
  assert.equal(closesWords('2026-11-20T12:00:00Z', NOW, 'UTC'), 'closes Nov 20');
  assert.equal(closesWords('2027-02-10T12:00:00Z', NOW, 'UTC'), 'closes Feb 10, 2027');
  assert.equal(closesWords('2026-11-04T12:00:00Z', NOW, 'UTC'), 'closed');
  // The day is the program's own: 23:00 UTC on Nov 4 is Nov 5 in Kolkata.
  assert.equal(closesWords('2026-11-04T23:00:00Z', NOW, 'Asia/Kolkata'), 'closes tomorrow');
  assert.equal(closesLead('2026-11-04T13:00:00Z', NOW, 'UTC'), 'Closes today');
});

test('L23-11 (v6.1.16): dayWords: "Nov 6" in the current year, "Nov 6, 2025" in any other, in the zone given', () => {
  assert.equal(dayWords(new Date('2026-11-06T12:00:00Z'), NOW), 'Nov 6');
  // 370 days back.
  assert.equal(dayWords(new Date(NOW.getTime() - 370 * 86_400_000), NOW), 'Oct 30, 2025');
  assert.equal(dayWords(new Date('2025-11-06T12:00:00Z'), new Date('2026-11-11T12:00:00Z')), 'Nov 6, 2025');
  assert.equal(dayWords(new Date('2027-02-10T12:00:00Z'), NOW), 'Feb 10, 2027');
  assert.equal(dayWords(new Date('2026-12-31T23:30:00Z'), NOW, 'Asia/Kolkata'), 'Jan 1, 2027');
});

test("closeDay: the day in the program's zone, null when rolling", () => {
  const a16z = { summary: 'Up to $1M · closes Nov 1, 11:59 PM PT', ends_at: '2026-11-02T07:59:59Z' };
  assert.equal(closeDay(a16z), 'Nov 1');
  assert.equal(closeDay({ ...a16z, summary: 'Up to $1M' }), 'Nov 2');
  assert.equal(closeDay({ ...a16z, tz: 'Asia/Kolkata', summary: 'Up to $1M' }), 'Nov 2');
  assert.equal(closeDay({ summary: 'Up to $5K · rolling', ends_at: '2026-12-01T00:00:00Z' }), null);
  assert.equal(closeDay({ summary: 'Up to $5K', ends_at: null }), null);
});
