import test from 'node:test';
import assert from 'node:assert/strict';
import type { GapGrant, InvestorProgram, MoveCtx, MoveProgram } from './conversation';
import { readySet, worthUpTo } from './ready-set';

/*
 * v4.10 Task 2 (R2, R3): the ready set, from the owner's shape on 2026-11-01: Base one step away, a16z closing in 19
 * hours, Circle a long shot.
 */
const NOW = new Date('2026-11-01T10:31:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const prog = (o: Partial<MoveProgram> & { id: string }): MoveProgram => ({
  title: o.id, amount: null, when: 'rolling', ends_at: null, zone: 'UTC', investment: false, max_usd: null, ...o,
});
const BASE: GapGrant = {
  ...prog({ id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: 'up to $5,000', max_usd: 5_000 }),
  gaps: ['codes'], gap: 'EarnKit is one step away: add Builder Codes.', passed: false, doable: true,
};
const CIRCLE: GapGrant = {
  ...prog({ id: 'circle-developer-grants', title: 'Circle Developer Grants', amount: '$5K to $100K', max_usd: 100_000, longShot: true, why: 'they look for apps on Arc' }),
  gaps: [], gap: '', passed: false, doable: false,
};
const A16Z: InvestorProgram = {
  ...prog({ id: 'a16z-speedrun', title: 'a16z speedrun SR008', amount: 'up to $1M', ends_at: at(19 * 3_600_000), investment: true, max_usd: 1_000_000 }),
  odds: null,
};
const gap = (id: string, gaps: string[], o: Partial<GapGrant> = {}): GapGrant => ({ ...prog({ id }), gaps, gap: 'x', passed: false, doable: false, ...o });
const ctx = (o: Partial<MoveCtx> = {}): MoveCtx & { now: Date } => ({ now: NOW, fits: [], grants: [], investors: [], skip: new Set(), raised: new Set(), path: null, ...o });
const OWNER = { grants: [CIRCLE, BASE], investors: [A16Z] };

test('the owner shape gives Base, a16z, Circle, worth up to $1.1M', () => {
  const set = readySet(ctx(OWNER));
  assert.deepEqual(set.map((p) => [p.id, p.kind]), [['base-builder-grants', 'one_step'], ['a16z-speedrun', 'investor'], ['circle-developer-grants', 'long_shot']]);
  assert.equal(set[0].step, 'codes');
  assert.equal(set[0].needs, 'EarnKit is one step away: add Builder Codes.');
  assert.equal(set[2].why, 'they look for apps on Arc');
  assert.equal(worthUpTo(set), '$1.1M');
});

test('an investor program closing in 8 days is left out', () => {
  const week = { ...A16Z, ends_at: at(8 * DAY) };
  assert.deepEqual(readySet(ctx({ ...OWNER, investors: [week] })).map((p) => p.id), ['base-builder-grants', 'circle-developer-grants']);
  assert.equal(readySet(ctx({ ...OWNER, investors: [{ ...A16Z, ends_at: at(6 * DAY) }] })).length, 3);
});

test('a declined, applied-to or recently drafted program is left out (skip)', () => {
  for (const id of ['base-builder-grants', 'a16z-speedrun', 'circle-developer-grants']) {
    const set = readySet(ctx({ ...OWNER, skip: new Set([id]) }));
    assert.equal(set.length, 2);
    assert.ok(!set.some((p) => p.id === id));
  }
});

test('a program already closed is left out', () => {
  assert.deepEqual(readySet(ctx({ ...OWNER, investors: [{ ...A16Z, ends_at: at(-1000) }] })).map((p) => p.id), ['base-builder-grants', 'circle-developer-grants']);
});

test('Base gives way to a later grant when it closes before its step can be done', () => {
  const later = gap('later', ['codes'], { doable: true, max_usd: 2_000, ends_at: at(20 * DAY) });
  const early = { ...BASE, doable: false, ends_at: at(20 * 3_600_000) };
  assert.deepEqual(readySet(ctx({ grants: [early, later] })).map((p) => p.id), ['later']);
  // a step the agent can do is still one step away at that close
  assert.deepEqual(readySet(ctx({ grants: [{ ...BASE, ends_at: at(20 * 3_600_000) }, later] })).map((p) => p.id), ['base-builder-grants', 'later']);
});

test('four eligible fits give 3, by money and then by close', () => {
  const fit = (id: string, max_usd: number | null, ends: number | null) => prog({ id, max_usd, ends_at: ends === null ? null : at(ends * DAY) });
  const set = readySet(ctx({ fits: [fit('small', 1_000, 1), fit('big-late', 10_000, 20), fit('big-soon', 10_000, 5), fit('mid', 5_000, 2)] }));
  assert.deepEqual(set.map((p) => p.id), ['big-soon', 'big-late', 'mid']);
  assert.equal(worthUpTo(set), '$25K');
});

test('fits come before one-step grants, and a long-shot fit goes last', () => {
  const set = readySet(ctx({ fits: [prog({ id: 'fit', max_usd: 100 }), prog({ id: 'ls', max_usd: 9_999_999, longShot: true })], grants: [BASE] }));
  assert.deepEqual(set.map((p) => [p.id, p.kind]), [['fit', 'fit'], ['base-builder-grants', 'one_step'], ['ls', 'long_shot']]);
});

test('no programs gives []; no amounts gives a null total', () => {
  assert.deepEqual(readySet(ctx()), []);
  assert.equal(worthUpTo([]), null);
  const set = readySet(ctx({ fits: [prog({ id: 'a' }), prog({ id: 'b' })] }));
  assert.equal(set.length, 2);
  assert.equal(worthUpTo(set), null);
});

test('worthUpTo formats like the money line', () => {
  const p = (max_usd: number | null) => ({ ...readySet(ctx({ fits: [prog({ id: 'x', max_usd })] }))[0] });
  assert.equal(worthUpTo([p(5_000), p(100_500)]), '$105.5K');
  assert.equal(worthUpTo([p(500), p(null)]), '$500');
});
