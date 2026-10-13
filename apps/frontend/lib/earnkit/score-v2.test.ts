import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_V2, computeScoreV2, fade, type V2Input } from './score-v2';
import { calibrationV2 } from './score-calibration';

const NOW = new Date('2026-10-14T00:00:00Z');
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const cal = calibrationV2('v2-launch');
const empty: V2Input = { ships: [], touches: [], packages: [], earned: [], weeks: [] };
const ship = (key: string, aliveDaysAgo = 0) => ({ key, at: days(400), alive_at: days(aliveDaysAgo) });

test('2.1 the first ship lands half of Shipped; more ships add less each', () => {
  assert.equal(computeScoreV2({ ...empty, ships: [ship('a')] }, cal, NOW).parts.shipped.points, 10);
  assert.equal(computeScoreV2({ ...empty, ships: [ship('a'), ship('b')] }, cal, NOW).parts.shipped.points, 15);
  assert.equal(computeScoreV2({ ...empty, ships: [ship('a'), ship('b'), ship('c')] }, cal, NOW).parts.shipped.points, 17.5);
});

test('2.2 what they shipped keeps at least half its value forever', () => {
  const old = computeScoreV2({ ...empty, ships: [ship('a', 1000)] }, cal, NOW).parts.shipped.points;
  assert.equal(old, 5);
  const ninety = computeScoreV2({ ...empty, ships: [ship('a', 90)] }, cal, NOW).parts.shipped.points;
  assert.equal(ninety, 5); // 0.5^(90/90) = 0.5, the floor
  const thirty = computeScoreV2({ ...empty, ships: [ship('a', 30)] }, cal, NOW).parts.shipped.points;
  assert.ok(thirty > 5 && thirty < 10);
});

test('2.3 ranked means at least one confirmed ship; use without a ship is not ranked', () => {
  const touches = [{ project: 'p', actor: 'wallet:0x1', at: days(1), weight: 1, kind: 'caller' as const }];
  assert.equal(computeScoreV2({ ...empty, touches }, cal, NOW).ranked, false);
  assert.equal(computeScoreV2({ ...empty, ships: [ship('p')], touches }, cal, NOW).ranked, true);
});

test('2.4 stars and forks by other people count at most 5 toward Used', () => {
  const stars = Array.from({ length: 40 }, (_, i) => ({ project: 'p', actor: `gh:u${i}`, at: days(1), weight: 1, kind: 'star' as const }));
  const s = computeScoreV2({ ...empty, ships: [ship('p')], touches: stars }, cal, NOW);
  assert.equal(s.parts.used.raw.star_fork, 5);
  assert.equal(s.parts.used.raw.U, 5); // the cap applies to the faded sum (40 x 0.99 > 5)
});

test('2.5 one person counts once per project; Used fades with a 90-day half-life', () => {
  const t = (at: Date) => ({ project: 'p', actor: 'wallet:0x1', at, weight: 1, kind: 'caller' as const });
  const s = computeScoreV2({ ...empty, ships: [ship('p')], touches: [t(days(200)), t(days(90))] }, cal, NOW);
  assert.ok(Math.abs(s.parts.used.raw.U - 0.5) < 1e-9);
  assert.equal(s.perProject.get('p')!.people, 1);
});

test('2.6 Earned adds coin fees, contract fees and prizes, unfaded; Consistency fades by week', () => {
  const s = computeScoreV2({
    ...empty, ships: [ship('p')],
    earned: [{ project: 'p', usd: 4000, kind: 'prize' }, { project: 'p', usd: 1000, kind: 'coin_fees' }],
    weeks: Array.from({ length: 13 }, (_, i) => ({ week: `2026-W${String(41 - i).padStart(2, '0')}`, at: days(7 * i) })),
  }, cal, NOW);
  assert.equal(s.parts.earned.points, MAX_V2.earned); // $5,000 is the v2-launch bar
  // 13 weekly touches 0 to 84 days old fade to W = 9.60 of the 13-week bar: 20 x 9.60 / 13 = 14.77
  assert.ok(s.parts.consistency.points > 14.5 && s.parts.consistency.points < 15);
});

test('2.7 the score is a whole number from 0 to 100; nothing at all is 0', () => {
  assert.equal(computeScoreV2(empty, cal, NOW).score, 0);
  const s = computeScoreV2({ ...empty, ships: [ship('a')] }, cal, NOW);
  assert.equal(s.score, 10);
});

test('2.7b invalid dates and numbers never produce NaN', () => {
  const bad = new Date('nope');
  assert.equal(fade(bad, NOW), 0);
  assert.equal(fade(NOW, bad), 0);
  const s = computeScoreV2({
    ships: [{ key: 'a', at: bad, alive_at: bad }, { key: 'b', at: days(1), alive_at: null }],
    touches: [{ project: 'p', actor: 'x', at: bad, weight: NaN, kind: 'caller' }],
    packages: [{ project: 'p', users: NaN, at: bad }],
    earned: [{ project: 'p', usd: NaN, kind: 'prize' }],
    weeks: [{ week: '2026-W41', at: bad }],
  }, cal, NOW);
  assert.ok(Number.isInteger(s.score) && s.score >= 0 && s.score <= 100);
  for (const p of Object.values(s.parts)) assert.ok(Number.isFinite(p.points));
});
