import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALIBRATIONS, LIVE_CALIBRATION, calibration } from './score-calibration';
import { FORMULA, computeScore, partDeltas, percentileOf, topPercent, type ProjectInput } from './score';

const NOW = new Date('2026-10-12T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const cal = calibration('v1-launch');
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-3, `${a} vs ${b}`);
const project = (o: Partial<ProjectInput> = {}): ProjectInput => ({
  key: 'p', title: 'p', users: 0, money_usd: 0, outcomes: [], first_outcome_at: null, last_used_at: null, commit_weeks: [], ...o,
});

test('2.1 v1-launch bars are the spec table; the live calibration is v1-launch', () => {
  assert.equal(LIVE_CALIBRATION, 'v1-launch');
  assert.deepEqual(
    { users: cal.users, money: cal.money_usd, weeks: cal.weeks, days: cal.staying_days },
    { users: 500, money: 5000, weeks: 13, days: 60 },
  );
  assert.equal(FORMULA, 'v1');
  assert.throws(() => calibration('nope'), /unknown calibration/);
  assert.equal(Object.keys(CALIBRATIONS).length, 1);
});

test('2.2 nothing verified scores 0, whatever the commits (owner rule 1)', () => {
  const s = computeScore([project({ commit_weeks: ['2026-W40', '2026-W41'] })], cal, NOW);
  assert.equal(s.score, 0);
  assert.equal(s.parts.consistency.points, 0);
  assert.equal(s.top, null);
});

test('2.3 users: 45 x min(1, log10(1+U)/log10(1+Ubar)); full at the bar', () => {
  near(computeScore([project({ users: 49 })], cal, NOW).parts.users.points, 45 * (Math.log10(50) / Math.log10(501)));
  assert.equal(computeScore([project({ users: 500 })], cal, NOW).parts.users.points, 45);
  assert.equal(computeScore([project({ users: 50_000 })], cal, NOW).parts.users.points, 45);
  assert.equal(computeScore([project({ users: 49 })], cal, NOW).parts.users.raw.U, 49);
});

test('2.4 money: 20 x min(1, log10(1+M)/log10(1+Mbar)), summed over projects', () => {
  const s = computeScore([project({ key: 'a', money_usd: 300 }), project({ key: 'b', money_usd: 199 })], cal, NOW);
  near(s.parts.money.points, 20 * (Math.log10(500) / Math.log10(5001)));
  assert.equal(s.parts.money.raw.M, 499);
});

test('2.5 staying power: share of projects used Dbar+ days after their first outcome; the best counts double', () => {
  const stayed = project({ key: 'a', users: 100, first_outcome_at: day(90), last_used_at: day(1) }); // 89 days >= 60
  const brief = project({ key: 'b', users: 5, first_outcome_at: day(20), last_used_at: day(1) });   // 19 days
  // a is best (most users): weight 2; b weight 1 -> 2/3
  near(computeScore([stayed, brief], cal, NOW).parts.staying.points, 15 * (2 / 3));
  // best one didn't stay: 1/3
  near(computeScore([{ ...stayed, users: 1 }, { ...brief, users: 200 }].map((p, i) => ({ ...p, key: String(i) })), cal, NOW).parts.staying.points, 15 * (1 / 3));
});

test('2.6 recency: 90-day half-life over outcome weights, 10 x min(1, recent / max(1, all))', () => {
  const s = computeScore([project({ users: 2, outcomes: [{ at: day(0), weight: 1 }, { at: day(90), weight: 1 }] })], cal, NOW);
  near(s.parts.recency.points, 10 * ((1 + 0.5) / 2));
  // one small outcome long ago: recent < 1, all = 1 -> max(1, all) = 1
  near(computeScore([project({ users: 1, outcomes: [{ at: day(180), weight: 1 }] })], cal, NOW).parts.recency.points, 10 * 0.25);
});

test('2.7 consistency: weeks with commits on repos that have an outside user, union, 10 x min(1, weeks / Wbar)', () => {
  const s = computeScore(
    [project({ key: 'a', users: 3, commit_weeks: ['2026-W30', '2026-W31'] }), project({ key: 'b', users: 1, commit_weeks: ['2026-W31', '2026-W32'] }), project({ key: 'c', commit_weeks: ['2026-W33'] })],
    cal, NOW,
  );
  near(s.parts.consistency.points, 10 * (3 / 13));
  assert.equal(s.parts.consistency.raw.weeks, 3);
});

test('2.8 the score is round(sum of parts) and never above 100', () => {
  const big = project({ users: 10_000, money_usd: 10_000_000, first_outcome_at: day(400), last_used_at: day(0),
    outcomes: [{ at: day(0), weight: 10 }], commit_weeks: Array.from({ length: 30 }, (_, i) => `2026-W${10 + i}`) });
  assert.equal(computeScore([big], cal, NOW).score, 100);
  const s = computeScore([project({ users: 49 })], cal, NOW);
  const sum = Object.values(s.parts).reduce((n, p) => n + p.points, 0);
  assert.equal(s.score, Math.round(sum));
});

test('2.9 the stored raw inputs recompute the same score under the same calibration', () => {
  const input = [project({ users: 120, money_usd: 40, outcomes: [{ at: day(3), weight: 4 }], first_outcome_at: day(70), last_used_at: day(3), commit_weeks: ['2026-W41'] })];
  assert.deepEqual(computeScore(input, cal, NOW), computeScore(structuredClone(input), cal, NOW));
});

test('2.10 percentile is the share with a lower score; Top N% = max(1, ceil(100 - p))', () => {
  const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(percentileOf(9, all), 90);
  assert.equal(topPercent(90), 10);
  assert.equal(percentileOf(0, all), 0);
  assert.equal(topPercent(0), 100);
  assert.equal(topPercent(99.5), 1);
  assert.equal(topPercent(100), 1);
  assert.equal(percentileOf(5, [5, 5, 5]), 0, 'ties are not lower');
  assert.equal(percentileOf(5, []), 0);
  assert.equal(topPercent(77.9), 23);
});

test('2.11 partDeltas: each part\'s points now minus before (before missing: all of now)', () => {
  const a = computeScore([project({ users: 10 })], cal, NOW).parts;
  const b = computeScore([project({ users: 100 })], cal, NOW).parts;
  const d = partDeltas(b, a);
  near(d.users, b.users.points - a.users.points);
  assert.equal(d.money, 0);
  assert.equal(partDeltas(a, null).users, a.users.points);
});
