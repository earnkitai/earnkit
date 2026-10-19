import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScoreV2, countUse, fade, scoreWhy, shippingOf, storedShipping, weekMask, type Ship } from './score-v2';
import { calibrationV2 } from './score-calibration';
import { isoWeekOf } from './weeks';

const NOW = new Date('2026-10-14T00:00:00Z'); // a Wednesday of 2026-W42
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const cal = calibrationV2();
/** The ISO weeks `ages` weeks before NOW's (0 = this week). */
const weeks = (...ages: number[]) => ages.map((a) => isoWeekOf(days(7 * a)));
const site: Ship = { key: 'site:a.earnkit.com', kind: 'site' };
const score = (ages: number[], ships: Ship[] = []) => computeScoreV2({ ships, commitWeeks: weeks(...ages) }, NOW);
const all12 = Array.from({ length: 12 }, (_, i) => i);

test('S1 Shipping: no commits is 0; any live ship adds the 10-point bonus once', () => {
  assert.equal(score([]).score, 0);
  assert.equal(score([], [site]).score, 10);
  const three: Ship[] = [site, { key: 'contract:base:0x1', kind: 'contract' }, { key: 'package:package_npm:x', kind: 'package' }];
  assert.equal(score([], three).score, 10, 'the bonus is 10 however many live ships');
  assert.equal(score([], three).shipped, 3);
});

test('S2 Shipping: this week only is round(90 x 12 / 78) = 14; 12 of 12 is 90, and 100 with a live ship', () => {
  assert.equal(score([0]).score, 14);
  assert.equal(score(all12).score, 90);
  assert.equal(score(all12, [site]).score, 100);
});

test('S3 Shipping: recent weeks weigh more (w = 12 - age); a week older than 12 counts nothing', () => {
  assert.equal(score([11]).score, 1, 'the oldest week weighs 1 of 78');
  assert.equal(score([1]).score, 13, '11 of 78');
  assert.equal(score([12, 20, 40]).score, 0);
  // 7 of the last 12, 3 of the last 4 (weeks 1-3), this week empty: weights 11+10+9+7+5+3+1 = 46 of 78.
  assert.equal(score([1, 2, 3, 5, 7, 9, 11]).score, 53);
});

test('S4 the parts keep { shipping } with its raw inputs; a malformed week is ignored', () => {
  const s = computeScoreV2({ ships: [site], commitWeeks: [...weeks(0, 2), 'w', '2026-W99'] }, NOW);
  assert.deepEqual(Object.keys(s.parts), ['shipping']);
  assert.deepEqual(s.parts.shipping.raw, { mask: 0b101, weeks: 2, recent: 2, live_ships: 1 });
  assert.equal(s.parts.shipping.points, s.score);
  assert.equal(weekMask(weeks(0, 11, 12), NOW), 1 | (1 << 11));
});

test('S5 shippingOf never passes 100 or reads a bad mask as points', () => {
  assert.equal(shippingOf(0xffff, 5), 100);
  assert.equal(shippingOf(Number.NaN, 0), 0);
  assert.equal(shippingOf(1.5, 0), 0);
});

test('S6 the why sentence: what an active week adds by the formula (this week, else next week)', () => {
  const why = (ages: number[], ships: Ship[] = []) => scoreWhy(score(ages, ships).parts);
  assert.equal(why([]), 'No code in the last 12 weeks. Ship code this week to add up to 14 points.');
  assert.equal(why([1, 2, 3, 5, 7, 9, 11]), 'Code in 7 of the last 12 weeks, 3 of the last 4. Ship code this week to add up to 14 points.');
  // This week active: next week with code (27) over next week without (13).
  assert.equal(why([0]), 'Code in 1 of the last 12 weeks, 1 of the last 4. Ship code next week to add up to 14 points.');
  // 12 of 12: next week without code drops to 76, with code stays 90.
  assert.equal(why(all12), 'Code in 12 of the last 12 weeks, 4 of the last 4. Ship code next week to add up to 14 points.');
  assert.equal(why(all12, [site]), 'Code in 12 of the last 12 weeks, 4 of the last 4. Ship code next week to add up to 14 points.');
  assert.equal(why([5]), 'Code in 1 of the last 12 weeks, 0 of the last 4. Ship code this week to add up to 14 points.');
});

test('S7 stored parts: an older four-part row (shipped, used, earned, consistency) never breaks a read', () => {
  const old = { shipped: { points: 10, raw: { S: 1 } }, used: { points: 24, raw: { U: 3 } }, earned: { points: 8, raw: { E: 120 } }, consistency: { points: 15, raw: { W: 4 } } };
  assert.equal(storedShipping(old), null);
  assert.equal(scoreWhy(old), null);
  for (const bad of [null, {}, 'x', { shipping: { points: 'a', raw: { mask: 1 } } }, { shipping: { points: 5, raw: {} } }]) assert.equal(scoreWhy(bad), null);
  // Shipping plus the old keys (or a later originality): the extra keys are ignored.
  const s = score([0, 1], [site]);
  assert.deepEqual(storedShipping({ ...old, ...s.parts, originality: { points: 40, raw: {} } }), { points: s.score, mask: 0b11, liveShips: 1 });
});

// ---- People and money (stored on the project rows, never scored) ----------------------------------

const use = (touches: Parameters<typeof countUse>[0]['touches']) => countUse({ touches, packages: [], earned: [] }, cal, NOW);

test('U1 stars and forks by other people count at most 5', () => {
  const stars = Array.from({ length: 40 }, (_, i) => ({ project: 'p', actor: `gh:u${i}`, at: days(1), weight: 1, kind: 'star' as const }));
  const u = use(stars);
  assert.equal(u.star_fork, 5);
  assert.equal(u.U, 5);
});

test('U2 one person counts once per project, faded with a 90-day half-life', () => {
  const t = (at: Date) => ({ project: 'p', actor: 'wallet:0x1', at, weight: 1, kind: 'caller' as const });
  const u = use([t(days(200)), t(days(90))]);
  assert.ok(Math.abs(u.U - 0.5) < 1e-9);
  assert.equal(u.perProject.get('p')!.people, 1);
});

test('U3 the same account starring and calling counts as a user, not a capped star; money is unfaded', () => {
  const at = days(1);
  for (const order of [0, 1]) {
    const t = [
      { project: 'p', actor: 'GH:Bob', at, weight: 1, kind: 'star' as const },
      { project: 'p', actor: 'gh:bob', at, weight: 1, kind: 'caller' as const },
    ];
    if (order) t.reverse();
    const u = use(t);
    assert.equal(u.star_fork, 0);
    assert.ok(Math.abs(u.people - fade(at, NOW)) < 1e-9);
  }
  const m = countUse({ touches: [], packages: [], earned: [{ project: 'p', usd: 4000, kind: 'prize' }, { project: 'p', usd: Number.NaN, kind: 'coin_fees' }] }, cal, NOW);
  assert.equal(m.E, 4000);
  assert.equal(m.perProject.get('p')!.usd, 4000);
  assert.equal(fade(new Date('nope'), NOW), 0);
});
