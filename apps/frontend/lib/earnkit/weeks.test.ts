import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek } from './source-readers';
import { isoWeekOf, last52, lastFinishedMonday, mondayOf, mondayOfWeek, streakOf, weekLabel, weekOfMonday, weeksShipping } from './weeks';

const d = (s: string) => new Date(s);

test('1.3 isoWeekOf matches the readers\' isoWeek on every day of two years', () => {
  for (let t = Date.UTC(2025, 0, 1); t < Date.UTC(2027, 0, 10); t += 86_400_000) assert.equal(isoWeekOf(new Date(t)), isoWeek(new Date(t)));
});

test('1.4 Sunday 23:59 and Monday 00:00 UTC are two weeks; Mondays come back from any day', () => {
  assert.equal(isoWeekOf(d('2026-10-18T23:59:59Z')), '2026-W42');
  assert.equal(isoWeekOf(d('2026-10-19T00:00:00Z')), '2026-W43');
  assert.equal(mondayOf(d('2026-10-14T12:00:00Z')), '2026-10-12');
  assert.equal(mondayOf(d('2026-10-18T23:59:59Z')), '2026-10-12');
  assert.equal(mondayOf(d('2026-10-19T00:00:00Z')), '2026-10-19');
});

test('1.5 week 53 and the year turn', () => {
  assert.equal(isoWeekOf(d('2026-12-28T00:00:00Z')), '2026-W53');
  assert.equal(isoWeekOf(d('2027-01-03T10:00:00Z')), '2026-W53');
  assert.equal(isoWeekOf(d('2027-01-04T00:00:00Z')), '2027-W01');
  assert.equal(mondayOfWeek('2026-W53'), '2026-12-28');
  assert.equal(mondayOfWeek('2027-W01'), '2027-01-04');
  assert.equal(mondayOfWeek('2026-W54'), null);
  assert.equal(mondayOfWeek('nope'), null);
  assert.equal(weekOfMonday('2026-12-28'), '2026-W53');
  assert.equal(weekOfMonday('2026-12-29'), null, 'a Tuesday is not a week key');
  assert.equal(weekLabel('2026-10-12'), 'Week of Oct 12');
  assert.equal(lastFinishedMonday(d('2026-10-14T09:00:00Z')), '2026-10-05');
  assert.equal(lastFinishedMonday(d('2026-10-19T00:00:00Z')), '2026-10-12');
});

test('1.6 the streak counts back from this week, or from last week while this one is empty', () => {
  const now = d('2026-10-19T08:00:00Z'); // Monday of 2026-W43
  assert.equal(streakOf(['2026-W40', '2026-W41', '2026-W42'], now), 3, 'nothing yet this Monday: from last week');
  assert.equal(streakOf(['2026-W40', '2026-W41', '2026-W42', '2026-W43'], now), 4);
  assert.equal(streakOf(['2026-W39', '2026-W41', '2026-W42'], now), 2, 'a skipped week breaks it');
  assert.equal(streakOf(['2026-W40'], now), 0, 'two weeks back is no streak');
  assert.equal(streakOf(['2026-W52', '2026-W53', '2027-W01'], d('2027-01-05T00:00:00Z')), 3, 'across week 53');
  assert.equal(streakOf([], now), 0);
  assert.equal(weeksShipping(['2025-W40', '2026-W01', '2026-W42', '2026-W42', 'junk'], now), 2, 'last 52 weeks, distinct, valid only');
  const grid = last52(now);
  assert.equal(grid.length, 52);
  assert.equal(grid.at(-1), '2026-W43');
  assert.equal(grid[0], '2025-W44');
});
