import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScoreV2, mondayDay, scoreWhy, shippingOf, storedShipping, weekMask, type Ship } from './score-v2';
import { isoWeekOf } from './weeks';

const NOW = new Date('2026-10-14T00:00:00Z'); // a Wednesday of 2026-W42
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
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
  assert.deepEqual(s.parts.shipping.raw, { mask: 0b101, monday: mondayDay(NOW), weeks: 2, recent: 2, live_ships: 1 });
  assert.equal(new Date(mondayDay(NOW) * 86_400_000).toISOString(), '2026-10-12T00:00:00.000Z', 'NOW\'s Monday');
  assert.equal(s.parts.shipping.points, s.score);
  assert.equal(weekMask(weeks(0, 11, 12), NOW), 1 | (1 << 11));
});

test('S5 shippingOf never passes 100 or reads a bad mask as points', () => {
  assert.equal(shippingOf(0xffff, 5), 100);
  assert.equal(shippingOf(Number.NaN, 0), 0);
  assert.equal(shippingOf(1.5, 0), 0);
});

test('S6 the why sentence: what an active week adds by the formula (this week, else next week)', () => {
  const why = (ages: number[], ships: Ship[] = []) => scoreWhy(score(ages, ships).parts, NOW);
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
  assert.equal(scoreWhy(old, NOW), null);
  for (const bad of [null, {}, 'x', { shipping: { points: 'a', raw: { mask: 1 } } }, { shipping: { points: 5, raw: {} } }]) assert.equal(scoreWhy(bad, NOW), null);
  // Shipping plus the old keys (or a later originality): the extra keys are ignored.
  const s = score([0, 1], [site]);
  assert.deepEqual(storedShipping({ ...old, ...s.parts, originality: { points: 40, raw: {} } }), { points: s.score, mask: 0b11, monday: mondayDay(NOW), liveShips: 1 });
});

test('S8 the why of a row scored in an earlier week is read as of this week (never last week\'s "this week")', () => {
  const last = computeScoreV2({ ships: [], commitWeeks: weeks(0, 1, 2) }, NOW).parts; // scored with code this week
  const week = 7 * 86_400_000;
  assert.equal(scoreWhy(last, NOW), 'Code in 3 of the last 12 weeks, 3 of the last 4. Ship code next week to add up to 13 points.');
  // A week later the row's "this week" is last week: nothing yet this week (35 now, 48 with code).
  assert.equal(scoreWhy(last, new Date(NOW.getTime() + week)), 'Code in 3 of the last 12 weeks, 3 of the last 4. Ship code this week to add up to 13 points.');
  // 11 weeks later only the newest week is still inside the 12; 12 weeks later none is.
  assert.equal(scoreWhy(last, new Date(NOW.getTime() + 11 * week)), 'Code in 1 of the last 12 weeks, 0 of the last 4. Ship code this week to add up to 14 points.');
  assert.equal(scoreWhy(last, new Date(NOW.getTime() + 13 * week)), 'No code in the last 12 weeks. Ship code this week to add up to 14 points.');
  // A row without its Monday (scored before it was stored) reads as this week's.
  const { monday: _m, ...raw } = last.shipping.raw;
  assert.equal(scoreWhy({ shipping: { ...last.shipping, raw } }, new Date(NOW.getTime() + week)), scoreWhy(last, NOW));
});

