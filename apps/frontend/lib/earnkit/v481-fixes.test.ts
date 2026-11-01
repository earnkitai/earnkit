import test from 'node:test';
import assert from 'node:assert/strict';
import { bestMove, pickHook, type GapGrant, type InvestorProgram, type MoveCtx, type MoveProgram } from './conversation';

/**
 * v4.8.1 Task 1 (R1): investor programs and long shots never lead on their own. They lead only when the builder picked
 * them, is past the hook on them, or there is no grant move at all.
 */
/** The owner's dogfood, 2026-11-01 4:01 PM IST. */
const NOW = new Date('2026-11-01T10:31:00Z');
const PT = 'America/Los_Angeles';
const H = 3_600_000;
const inHours = (h: number) => new Date(NOW.getTime() + h * H).toISOString();
const prog = (o: Partial<MoveProgram> & { id: string }): MoveProgram => ({
  title: o.id, amount: '$1,000', when: 'rolling', ends_at: null, zone: 'UTC', investment: false, longShot: false, ...o,
});
/** a16z speedrun: an investor program, tagged "long shot", closing in 20 hours. */
const A16Z: InvestorProgram = {
  ...prog({ id: 'a16z-speedrun', title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1', ends_at: inHours(20), zone: PT, investment: true, longShot: true }),
  odds: 'speedrun says fewer than 0.4% of applicants are accepted',
};
/** Base: one step (Builder Codes), the agent can do it. */
const BASE: GapGrant = {
  ...prog({ id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: 'up to $5,000' }),
  gaps: ['codes'], gap: 'EarnKit is one step away: add Builder Codes.', passed: false, doable: true,
};
/** Arc Microgrants: closing in 17 hours, a chain gap the agent can't do. */
const ARC: GapGrant = {
  ...prog({ id: 'arc', title: 'Arc Microgrants: Built with Arc Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1', ends_at: inHours(17), zone: 'America/New_York' }),
  gaps: ['on Arc mainnet'], gap: 'Arc Microgrants needs EarnKit on Arc mainnet.', passed: false, doable: false,
};
/** Circle: rolling, a chain gap. */
const CIRCLE: GapGrant = {
  ...prog({ id: 'circle-grants', title: 'Circle Developer Grants', amount: 'up to $10,000' }),
  gaps: ['on Arc'], gap: 'Circle looks for apps on Arc.', passed: false, doable: false,
};
const gap = (id: string, gaps: string[], o: Partial<GapGrant> = {}): GapGrant => ({ ...prog({ id }), gaps, gap: 'x', passed: false, doable: false, ...o });
const ctx = (o: Partial<MoveCtx> = {}): MoveCtx => ({ now: NOW, fits: [], grants: [], investors: [], skip: new Set(), raised: new Set(), path: null, ...o });
const owner = (o: Partial<MoveCtx> = {}) => ctx({ grants: [ARC, BASE, CIRCLE], investors: [A16Z], ...o });
const at = NOW.toISOString();

test("v4.8.1 R1: the owner's 2026-11-01 shape leads with Base's one step, not a16z", () => {
  assert.deepEqual(bestMove(owner()), { kind: 'one_step', program: BASE });
});

test('v4.8.1 R1: a16z picked at the hook, or past it, keeps its place', () => {
  assert.deepEqual(bestMove(owner({ path: { stage: 'hook', program_id: A16Z.id, at, picked: true } })), { kind: 'investor', program: A16Z });
  assert.deepEqual(bestMove(owner({ path: { stage: 'draft', program_id: A16Z.id, at } })), { kind: 'investor', program: A16Z });
  // A hook EarnKit chose (not picked) is ranked again: Base leads.
  assert.deepEqual(bestMove(owner({ path: { stage: 'hook', program_id: A16Z.id, at } })), { kind: 'one_step', program: BASE });
});

test('v4.8.1 R1: with no grant move at all, a16z is the move, as an investor program', () => {
  assert.deepEqual(bestMove(ctx({ investors: [A16Z] })), { kind: 'investor', program: A16Z });
  // Arc (a chain gap closing within 48 hours) is no grant move, so a16z still leads.
  assert.deepEqual(bestMove(ctx({ grants: [ARC], investors: [A16Z] })), { kind: 'investor', program: A16Z });
  // A no-gap grant closing within 48 hours is a grant move: it is the only 'now'.
  const noGap = gap('nogap', [], { ends_at: inHours(30) });
  assert.deepEqual(bestMove(ctx({ grants: [noGap], investors: [A16Z] })), { kind: 'now', program: noGap });
});

test('v4.8.1 R1: a long-shot grant never leads over a non-long-shot grant', () => {
  const longOne = gap('long-one', ['codes'], { doable: true, longShot: true, ends_at: inHours(72) });
  const two = gap('two', ['a', 'b']);
  assert.deepEqual(bestMove(ctx({ grants: [longOne, two] })), { kind: 'closest', program: two, raise: false });
  // A long-shot no-gap grant closing soon is no 'now' while a grant move exists.
  const longNow = gap('long-now', [], { longShot: true, ends_at: inHours(10) });
  assert.deepEqual(bestMove(ctx({ grants: [longNow, two] })), { kind: 'closest', program: two, raise: false });
  // Alone, within 7 days, it leads with its own kind; past 7 days it is no move on its own.
  assert.deepEqual(bestMove(ctx({ grants: [longOne] })), { kind: 'one_step', program: longOne });
  const far = { ...longOne, ends_at: inHours(24 * 20) };
  assert.deepEqual(bestMove(ctx({ grants: [far] })), { kind: 'quiet' });
  // ... unless the builder picked it.
  assert.deepEqual(bestMove(ctx({ grants: [far, two], path: { stage: 'hook', program_id: far.id, at, picked: true } })), { kind: 'one_step', program: far });
  // Step 5 is soonest first across investor programs and long-shot grants.
  assert.deepEqual(bestMove(ctx({ grants: [longOne], investors: [A16Z] })), { kind: 'investor', program: A16Z });
});

test('v4.8.1 R1: a pick of a16z on the opener still hooks a16z', () => {
  const hook = pickHook(owner(), A16Z.id);
  assert.deepEqual(hook, { move: { kind: 'investor', program: A16Z }, pick: true, steps: false });
});

test('v4.8.1 fix round 1: a picked rolling long-shot grant is hooked on the reply after connecting, beside a closer grant', () => {
  const longShot = gap('monad', ['on Monad'], { longShot: true });
  const two = gap('two', ['a', 'b']);
  assert.deepEqual(pickHook(ctx({ grants: [longShot, two] }), 'monad'), { move: { kind: 'closest', program: longShot, raise: false }, pick: true, steps: false });
  // Unpicked, it never leads: the non-long-shot grant does.
  assert.deepEqual(bestMove(ctx({ grants: [longShot, two] })), { kind: 'closest', program: two, raise: false });
});
