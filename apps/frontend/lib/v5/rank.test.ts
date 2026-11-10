import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankGaps, rankReady, shownGapsOf } from './rank';
import type { Gap, Verdict } from './eligibility';
import type { ProgramRow } from './programs';
import { programFixture } from './fixtures/program';

const row = (id: string, over: Record<string, unknown> = {}): ProgramRow => ({
  id, file: programFixture({ id, ...over }), source: 'file', created_at: new Date(0), updated_at: new Date(0), verified_at: null, stale_since: null,
});
const v = (id: string, over: Partial<Verdict> = {}): Verdict => ({ program_id: id, status: 'ready', gaps: [], reason: null, long_shot: null, rules: [], ...over });
const gap = (effort: Gap['effort']): Gap => ({ kind: 'feature', item: 'feature:x', what: 'x', effort, agent_can: false });

test('rankReady: not long shot first, then bigger award with unknown last, then sooner deadline', () => {
  const programs = new Map([
    row('small', { max_award_usd: 1000 }), row('big', { max_award_usd: 9000 }), row('none'),
    row('long', { max_award_usd: 50000 }),
    row('soon', { max_award_usd: 1000, ends_at: '2026-12-01T00:00:00Z' }),
  ].map((r) => [r.id, r]));
  const out = rankReady([v('none'), v('long', { long_shot: 'few prizes for many entries' }), v('small'), v('soon'), v('big')], programs);
  assert.deepEqual(out.map((x) => x.program_id), ['big', 'soon', 'small', 'none', 'long']);
});

test('rankGaps: fewest gaps, then lowest effort, then money', () => {
  const programs = new Map([row('a', { max_award_usd: 100 }), row('b', { max_award_usd: 900 }), row('c'), row('d')].map((r) => [r.id, r]));
  const out = rankGaps(
    [v('a', { status: 'gap', gaps: [gap('days')] }), v('b', { status: 'gap', gaps: [gap('days')] }),
     v('c', { status: 'gap', gaps: [gap('minutes'), gap('hours')] }), v('d', { status: 'gap', gaps: [gap('minutes')] })],
    programs,
  );
  assert.deepEqual(out.map((x) => x.program_id), ['d', 'b', 'a', 'c']);
});

const remote = () => false;
const ruleGap = (note: string): Gap => ({ kind: 'rule', item: `rule:${note}`, what: note, effort: 'hours', agent_can: false });

test('rankGaps (R18b): real changes first, rule-only programs after, each ranked as before', () => {
  const programs = new Map([row('r-big', { max_award_usd: 90000 }), row('r-small', { max_award_usd: 100 }), row('real-days', { max_award_usd: 10 }), row('real-weeks'), row('mixed')].map((r) => [r.id, r]));
  const out = rankGaps(
    [v('r-small', { status: 'gap', gaps: [ruleGap('a')] }), v('r-big', { status: 'gap', gaps: [ruleGap('b')] }),
     v('real-weeks', { status: 'gap', gaps: [gap('weeks')] }), v('mixed', { status: 'gap', gaps: [gap('hours'), ruleGap('c')] }),
     v('real-days', { status: 'gap', gaps: [gap('days')] })],
    programs,
  );
  // v6.1.8 fix round 1: a rule is not a change, so 'mixed' (one hours change and a rule) leads the one-change programs.
  assert.deepEqual(out.map((x) => x.program_id), ['mixed', 'real-days', 'real-weeks', 'r-big', 'r-small']);
});

test('shownGapsOf (R18b): three rule-only and two real gaps show the two real then one rule-only; all is unchanged', () => {
  const real = [v('x1', { status: 'gap', gaps: [gap('hours')] }), v('x2', { status: 'gap', gaps: [gap('days')] })];
  const rules = [v('r1', { status: 'gap', gaps: [ruleGap('a')] }), v('r2', { status: 'gap', gaps: [ruleGap('b')] }), v('r3', { status: 'gap', gaps: [ruleGap('c')] })];
  const ranked = [...real, ...rules];
  assert.deepEqual(shownGapsOf(ranked, false, 3, remote).map((x) => x.program_id), ['x1', 'x2', 'r1']);
  assert.deepEqual(shownGapsOf(ranked, true, 3, remote), ranked);
  // More real changes than slots: the rule-only one still takes the last slot; none: the real ones fill them all.
  const four = [...real, v('x3', { status: 'gap', gaps: [gap('days')] }), v('x4', { status: 'gap', gaps: [gap('days')] })];
  assert.deepEqual(shownGapsOf([...four, ...rules], false, 3, remote).map((x) => x.program_id), ['x1', 'x2', 'r1']);
  assert.deepEqual(shownGapsOf(four, false, 3, remote).map((x) => x.program_id), ['x1', 'x2', 'x3']);
  // No rule-free program: the rule-only one alone, a list of one (N-2, v6.1.9 fix round 1).
  assert.deepEqual(shownGapsOf(rules, false, 3, remote).map((x) => x.program_id), ['r1']);
});

test('shownGapsOf (R18d): an in-person rule-only program never takes the rule-only slot; all still lists it', () => {
  const real = [v('x1', { status: 'gap', gaps: [gap('hours')] }), v('x2', { status: 'gap', gaps: [gap('hours')] })];
  const rules = [v('attend', { status: 'gap', gaps: [ruleGap('a')] }), v('r2', { status: 'gap', gaps: [ruleGap('b')] })];
  const inPerson = (x: Verdict) => x.program_id === 'attend';
  assert.deepEqual(shownGapsOf([...real, ...rules], false, 3, inPerson).map((x) => x.program_id), ['x1', 'x2', 'r2']);
  assert.deepEqual(shownGapsOf([...real, rules[0]], false, 3, inPerson).map((x) => x.program_id), ['x1', 'x2']);
  assert.deepEqual(shownGapsOf([...real, ...rules], true, 3, inPerson).map((x) => x.program_id), ['x1', 'x2', 'attend', 'r2']);
});

test('rankGaps (R18e): rule-only programs naming a project mainnet first, then chain-agnostic, then the rest, each by award', () => {
  const programs = new Map([
    row('agnostic-big', { chains: [], any_chain: true, max_award_usd: 900000 }),
    row('base-rule', { chains: ['base'] }),
    row('arc-rule', { chains: ['arc'], max_award_usd: 500000 }),
    row('agnostic-small', { chains: [], any_chain: true, max_award_usd: 1000 }),
    row('real', { chains: ['arc'] }),
  ].map((r) => [r.id, r]));
  const input = [
    v('agnostic-big', { status: 'gap', gaps: [ruleGap('a')] }), v('arc-rule', { status: 'gap', gaps: [ruleGap('b')] }),
    v('agnostic-small', { status: 'gap', gaps: [ruleGap('c')] }), v('base-rule', { status: 'gap', gaps: [ruleGap('d')] }),
    v('real', { status: 'gap', gaps: [gap('days')] }),
  ];
  // A Base project: the Base rule-only program before the $900K chain-agnostic one.
  assert.deepEqual(rankGaps(input, programs, new Set(['base'])).map((x) => x.program_id), ['real', 'base-rule', 'agnostic-big', 'agnostic-small', 'arc-rule']);
  // No chain: chain-agnostic first, then the rest by award.
  assert.deepEqual(rankGaps(input, programs, new Set()).map((x) => x.program_id), ['real', 'agnostic-big', 'agnostic-small', 'arc-rule', 'base-rule']);
  assert.deepEqual(rankGaps(input, programs).map((x) => x.program_id), ['real', 'agnostic-big', 'agnostic-small', 'arc-rule', 'base-rule']);
  // The default list's one rule-only slot takes the one on the project's chain, in the last slot only (N-2 beats N-4,
  // v6.1.9 fix round 2): after one rule-free program it would be line two, so the list is that one; with two it is third.
  const names = (x: Verdict, c: string) => programs.get(x.program_id)!.file.chains.includes(c);
  assert.deepEqual(shownGapsOf(rankGaps(input, programs, new Set(['base'])), false, 3, remote, ['base'], names).map((x) => x.program_id), ['real']);
  const two = [v('real', { status: 'gap', gaps: [gap('days')] }), v('real2', { status: 'gap', gaps: [gap('days')] }), ...input.slice(0, 4)];
  assert.deepEqual(shownGapsOf(two, false, 3, remote, ['base'], (x, c) => x.program_id === 'base-rule' && c === 'base').map((x) => x.program_id), ['real', 'real2', 'base-rule']);
});

test('shownGapsOf (R18f): in-person programs never appear in the default gap list; all still lists them', () => {
  const ranked = [
    v('attend-real', { status: 'gap', gaps: [gap('minutes')] }), v('x1', { status: 'gap', gaps: [gap('hours')] }),
    v('attend-rule', { status: 'gap', gaps: [ruleGap('a')] }), v('r1', { status: 'gap', gaps: [ruleGap('b')] }),
  ];
  const inPerson = (x: Verdict) => x.program_id.startsWith('attend');
  assert.deepEqual(shownGapsOf(ranked, false, 3, inPerson).map((x) => x.program_id), ['x1']);
  assert.deepEqual(shownGapsOf([ranked[0], ranked[2], ranked[3]], false, 3, inPerson).map((x) => x.program_id), ['r1']);
  assert.deepEqual(shownGapsOf([...ranked, v('x2', { status: 'gap', gaps: [gap('hours')] })], false, 3, inPerson).map((x) => x.program_id), ['x1', 'x2', 'r1']);
  assert.deepEqual(shownGapsOf([ranked[0], ranked[2]], false, 3, inPerson), []);
  assert.deepEqual(shownGapsOf(ranked, true, 3, inPerson), ranked);
});

test('rankGaps (R18e tie-break): among rule-only programs on the project chains with no award, the first reported chain first, then catalog order (v6.1.7)', () => {
  const programs = new Map([
    row('arb-rule', { chains: ['arbitrum'] }),
    row('arb-other', { chains: ['arbitrum'] }),
    row('base-rule', { chains: ['base'] }),
    row('arb-award', { chains: ['arbitrum'], max_award_usd: 1000 }),
  ].map((r) => [r.id, r]));
  const input = ['arb-rule', 'arb-other', 'base-rule', 'arb-award'].map((id) => v(id, { status: 'gap', gaps: [ruleGap(id)] }));
  const both = new Set(['arbitrum', 'base']);
  // A stated award still ranks first; then the program on the first reported chain; then catalog order.
  assert.deepEqual(rankGaps(input, programs, both, 'base').map((x) => x.program_id), ['arb-award', 'base-rule', 'arb-rule', 'arb-other']);
  assert.deepEqual(rankGaps(input, programs, both, 'arbitrum').map((x) => x.program_id), ['arb-award', 'arb-rule', 'arb-other', 'base-rule']);
  assert.deepEqual(rankGaps(input, programs, both).map((x) => x.program_id), ['arb-award', 'arb-rule', 'arb-other', 'base-rule']);
  const names = (x: Verdict, c: string) => programs.get(x.program_id)!.file.chains.includes(c);
  assert.deepEqual(shownGapsOf(rankGaps(input.slice(0, 3), programs, both, 'base'), false, 3, remote, ['base', 'arbitrum'], names).map((x) => x.program_id), ['base-rule']);
});

test('C60 (v6.1.8): the money sort reads the larger of the award and the pool, so a $1M pool outranks a $100K award', () => {
  const programs = new Map([
    row('award', { max_award_usd: 100_000 }), row('pool', { max_award_usd: 100_000, pool_usd: 1_000_000, reward: '$1,000,000 in prizes' }),
    row('pool-only', { pool_usd: 500_000, reward: '$500,000 in prizes' }),
  ].map((r) => [r.id, r]));
  assert.deepEqual(rankReady([v('award'), v('pool-only'), v('pool')], programs).map((x) => x.program_id), ['pool', 'pool-only', 'award']);
  const g = (id: string) => v(id, { status: 'gap', gaps: [gap('hours')] });
  assert.deepEqual(rankGaps([g('award'), g('pool-only'), g('pool')], programs).map((x) => x.program_id), ['pool', 'pool-only', 'award']);
});

test('fix round 1 (v6.1.8): rule gaps do not count toward the number of changes; a $1M pool with a demo video and a rule outranks a $100K live link', () => {
  const programs = new Map([row('vr', { max_award_usd: 100_000, pool_usd: 1_000_000, reward: '$1,000,000 in prizes' }), row('floss', { max_award_usd: 100_000 }), row('two', { max_award_usd: 9_000_000 })].map((r) => [r.id, r]));
  const out = rankGaps(
    [v('floss', { status: 'gap', gaps: [gap('hours')] }), v('two', { status: 'gap', gaps: [gap('hours'), gap('hours')] }), v('vr', { status: 'gap', gaps: [gap('hours'), ruleGap('vr')] })],
    programs,
  );
  assert.deepEqual(out.map((x) => x.program_id), ['vr', 'floss', 'two']);
});

test('shownGapsOf (v6.1.8 fix round 2): at most one rule-bearing program, the best-ranked, in the last slot; rule-free ones fill the rest', () => {
  const mixed = (id: string) => v(id, { status: 'gap', gaps: [gap('hours'), ruleGap(id)] });
  const free = (id: string) => v(id, { status: 'gap', gaps: [gap('hours')] });
  // Rank order: a change-plus-rule program ranked first (Meta VR), another one, two rule-free, a rule-only one.
  const ranked = [mixed('vr'), mixed('codegeist'), free('circle'), free('floss'), v('otf', { status: 'gap', gaps: [ruleGap('otf')] })];
  assert.deepEqual(shownGapsOf(ranked, false, 3, remote).map((x) => x.program_id), ['circle', 'floss', 'vr']);
  assert.deepEqual(shownGapsOf(ranked, true, 3, remote), ranked);
  // No rule-free program: the one rule-bearing program alone, a list of one (N-2, v6.1.9 fix round 1).
  assert.deepEqual(shownGapsOf([mixed('vr'), mixed('codegeist'), v('otf', { status: 'gap', gaps: [ruleGap('otf')] })], false, 3, remote).map((x) => x.program_id), ['vr']);
});

test('shownGapsOf (v6.1.8 fix round 3): the rule slot prefers a program naming the project\'s chains, the first chain first; else rank order', () => {
  const on: Record<string, string[]> = { vr: [], base: ['base'], arb: ['arbitrum'], arbRule: ['arbitrum'] };
  const names = (x: Verdict, c: string) => (on[x.program_id] ?? []).includes(c);
  const ranked = [
    v('vr', { status: 'gap', gaps: [gap('hours'), ruleGap('vr')] }), v('circle', { status: 'gap', gaps: [gap('hours')] }),
    v('arb', { status: 'gap', gaps: [gap('days'), ruleGap('a')] }), v('base', { status: 'gap', gaps: [ruleGap('b')] }),
    v('floss', { status: 'gap', gaps: [gap('hours')] }),
  ];
  const show = (chains: string[]) => shownGapsOf(ranked, false, 3, remote, chains, names).map((x) => x.program_id);
  // The chosen one always takes the last slot, after two rule-free programs (N-2 beats N-4, v6.1.9 fix round 2).
  assert.deepEqual(show(['base', 'arbitrum']), ['circle', 'floss', 'base']);
  assert.deepEqual(show(['arbitrum', 'base']), ['circle', 'floss', 'arb']);
  assert.deepEqual(show(['monad', 'arbitrum']), ['circle', 'floss', 'arb']);
  assert.deepEqual(show([]), ['circle', 'floss', 'vr']);
  assert.deepEqual(show(['monad']), ['circle', 'floss', 'vr']);
  // With one rule-free program it would be line two: the list is that one alone (N-2, v6.1.9).
  assert.deepEqual(shownGapsOf(ranked.slice(0, 4), false, 3, remote, ['base'], names).map((x) => x.program_id), ['circle']);
});

test('N-2 (v6.1.9): a rule-bearing program off the project\'s chains takes only the last slot; with fewer rule-free programs the list is shorter', () => {
  const mixed = (id: string) => v(id, { status: 'gap', gaps: [gap('hours'), ruleGap(id)] });
  const free = (id: string) => v(id, { status: 'gap', gaps: [gap('hours')] });
  // Two rule-free programs: the rule-bearing one is line three.
  assert.deepEqual(shownGapsOf([mixed('vr'), free('a'), free('b'), free('c')], false, 3, remote).map((x) => x.program_id), ['a', 'b', 'vr']);
  // One rule-free program (the SaaS, CLI and dotfiles shape): that one alone, never Meta VR as the second line.
  assert.deepEqual(shownGapsOf([mixed('vr'), free('floss')], false, 3, remote).map((x) => x.program_id), ['floss']);
  // None: the rule-bearing program alone, a list of one (fix round 1); nothing at all, no step line; filter.all lists all.
  assert.deepEqual(shownGapsOf([mixed('vr'), mixed('codegeist')], false, 3, remote).map((x) => x.program_id), ['vr']);
  assert.deepEqual(shownGapsOf([], false, 3, remote), []);
  assert.deepEqual(shownGapsOf([mixed('vr'), mixed('codegeist')], true, 3, remote).map((x) => x.program_id), ['vr', 'codegeist']);
});

test('N-3 (v6.1.9, Review Focus 2): a program the builder acted on heads the default list, rule-only or not, and takes the one rule-bearing place', () => {
  const free = (id: string) => v(id, { status: 'gap', gaps: [gap('hours')] });
  const vrRule = v('vr', { status: 'gap', gaps: [ruleGap('vr')] });
  const codegeist = v('codegeist', { status: 'gap', gaps: [gap('hours'), ruleGap('cg')] });
  const acted = (x: Verdict) => x.program_id === 'vr';
  // Rule-only after its demo video was marked done, ranked last: still first, and no second rule-bearing program.
  assert.deepEqual(shownGapsOf([codegeist, free('a'), free('b'), vrRule], false, 3, remote, [], () => false, acted).map((x) => x.program_id), ['vr', 'a', 'b']);
  assert.deepEqual(shownGapsOf([codegeist, vrRule], false, 3, remote, [], () => false, acted).map((x) => x.program_id), ['vr']);
  // A rule-free acted-on program heads too; the rest fill as before, the rule-bearing one in the last slot.
  assert.deepEqual(shownGapsOf([codegeist, free('a'), free('b')], false, 3, remote, [], () => false, (x) => x.program_id === 'b').map((x) => x.program_id), ['b', 'a', 'codegeist']);
  assert.deepEqual(shownGapsOf([codegeist, free('a'), free('b')], false, 3, remote, [], () => false, (x) => x.program_id === 'b' || x.program_id === 'a').map((x) => x.program_id), ['a', 'b', 'codegeist']);
  // Only the last slot: one acted-on program and no other rule-free one leaves the rule-bearing program out.
  assert.deepEqual(shownGapsOf([codegeist, free('b')], false, 3, remote, [], () => false, (x) => x.program_id === 'b').map((x) => x.program_id), ['b']);
  // filter.all keeps rank order.
  assert.deepEqual(shownGapsOf([codegeist, vrRule], true, 3, remote, [], () => false, acted).map((x) => x.program_id), ['codegeist', 'vr']);
});

test('N-4 (v6.1.9, Review Focus 3): a program on the project\'s own chain ranks first, the reported chain before the read one; another chain\'s deploy after them', () => {
  const programs = new Map([
    row('arb-deploy', { chains: ['arbitrum'], max_award_usd: 100_000 }), row('arc-deploy', { chains: ['arc'], max_award_usd: 100_000 }),
    row('base-rule', { chains: ['base'] }), row('floss', { chains: [], any_chain: true, max_award_usd: 100_000 }), row('opt-rule', { chains: ['optimism'] }),
  ].map((r) => [r.id, r]));
  const deploy = (id: string, c: string): Verdict => v(id, { status: 'gap', gaps: [{ kind: 'chain', item: `chain:${c}`, what: `deploy the contract on ${c}`, effort: 'hours', agent_can: false }] });
  const input = [deploy('arb-deploy', 'arbitrum'), deploy('arc-deploy', 'arc'), v('base-rule', { status: 'gap', gaps: [ruleGap('b')] }), v('floss', { status: 'gap', gaps: [gap('hours')] }), v('opt-rule', { status: 'gap', gaps: [ruleGap('o')] })];
  const base = new Set(['base']);
  const ranked = rankGaps(input, programs, base, 'base', ['base']);
  assert.deepEqual(ranked.map((x) => x.program_id), ['base-rule', 'arb-deploy', 'arc-deploy', 'floss', 'opt-rule']);
  const names = (x: Verdict, c: string) => programs.get(x.program_id)!.file.chains.includes(c);
  // The rule-bearing Base program still takes only the last slot (N-2 beats N-4, fix round 2); own-chain-first orders
  // the rule-free ones (project A's Base Builder Grant leads its list that way, find.test.ts).
  assert.deepEqual(shownGapsOf(ranked, false, 3, remote, ['base'], names).map((x) => x.program_id), ['arb-deploy', 'arc-deploy', 'base-rule']);
  const baseFree = row('base-free', { chains: ['base'], max_award_usd: 5_000 });
  programs.set(baseFree.id, baseFree);
  const withBase = rankGaps([...input, v('base-free', { status: 'gap', gaps: [gap('hours'), gap('hours')] })], programs, base, 'base', ['base']);
  assert.deepEqual(shownGapsOf(withBase, false, 3, remote, ['base'], names).map((x) => x.program_id), ['base-free', 'arb-deploy', 'base-rule']);
  // A Base project whose code also reads Arbitrum: Base (reported) first, then the Arbitrum deploy, then Arc.
  assert.deepEqual(rankGaps(input, programs, base, 'base', ['base', 'arbitrum']).map((x) => x.program_id), ['base-rule', 'arb-deploy', 'arc-deploy', 'floss', 'opt-rule']);
  // Arbitrum reported first: the Arbitrum deploy leads.
  assert.deepEqual(rankGaps(input, programs, base, 'arbitrum', ['arbitrum', 'base']).map((x) => x.program_id), ['arb-deploy', 'base-rule', 'arc-deploy', 'floss', 'opt-rule']);
  // No chains: unchanged.
  assert.deepEqual(rankGaps(input, programs).map((x) => x.program_id), rankGaps(input, programs, new Set(), undefined, []).map((x) => x.program_id));
});
