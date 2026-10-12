import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, countProject, moneyOf, ringWeights, type ActorFacts, type FarmCtx, type Touch } from './anti-farming';
import { computeScore } from './score';
import { calibration } from './score-calibration';

const NOW = new Date('2026-10-12T12:00:00Z');
const d = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const OLD = { created_at: d(400), first_tx_at: d(400) };
const ctx = (o: Partial<FarmCtx> = {}, actors: string[] = []): FarmCtx => ({
  self: new Set(), actors: new Map<string, ActorFacts>(actors.map((a) => [a, OLD])), ring: new Map(), ...o,
});
const call = (actor: string, ago: number, extra: Partial<Touch> = {}): Touch => ({ project: 'p', actor, kind: 'caller', at: d(ago), ...extra });
const wallets = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `wallet:0x${prefix}${String(i).padStart(3, '0')}`);

test('3.1 self-exclusion: own wallets, own login and org members never count as users or fees', () => {
  const t = [call('wallet:0xme', 1, { fee_usd: 50 }), call('wallet:0xa', 2), call('wallet:0xb', 3), call('wallet:0xc', 4), { project: 'p', actor: 'gh:me', kind: 'stargazer' as const, at: d(1) }, { project: 'p', actor: 'gh:orgmate', kind: 'stargazer' as const, at: d(1) }];
  const c = countProject('p', t, ctx({ self: new Set(['wallet:0xme', 'gh:me', 'gh:orgmate']) }, ['wallet:0xa', 'wallet:0xb', 'wallet:0xc']));
  assert.equal(c.users, 3);
  assert.equal(c.fees_usd, 0);
});

test('3.2 one per account: a wallet calling 40 times counts once', () => {
  const t = [...Array.from({ length: 40 }, (_, i) => call('wallet:0xa', 1 + (i % 5))), call('wallet:0xb', 2), call('wallet:0xc', 3)];
  assert.equal(countProject('p', t, ctx({}, ['wallet:0xa', 'wallet:0xb', 'wallet:0xc'])).users, 3);
});

test('3.3 fee cap: one wallet\'s fees count at most 10% of the project\'s fees', () => {
  const t = [call('wallet:0xa', 1, { fee_usd: 900 }), ...wallets(10).map((w, i) => call(w, 1 + (i % 4), { fee_usd: 10 }))];
  const c = countProject('p', t, ctx({}, ['wallet:0xa', ...wallets(10)]));
  // total 1000, cap 100: 100 + 10 x 10
  assert.equal(c.fees_usd, 200);
  assert.equal(RULES.feeCap, 0.1);
});

test('3.4 spread: onchain users on fewer than 3 distinct days count 0', () => {
  const ws = wallets(30);
  const c = countProject('p', ws.map((w, i) => call(w, i % 2)), ctx({}, ws));
  assert.equal(c.users, 0);
});

test('3.5 spread: a day holding over 50% of users counts those users at 25%', () => {
  const burst = wallets(12, 'b');
  const rest = wallets(8, 'r');
  const t = [...burst.map((w) => call(w, 1)), ...rest.map((w, i) => call(w, 2 + (i % 4)))];
  const c = countProject('p', t, ctx({}, [...burst, ...rest]));
  assert.equal(c.users, 12 * 0.25 + 8);
});

test('3.6 fresh accounts: GitHub under 30 days and wallets first seen within 7 days of the call count 50%; unknown counts 50%', () => {
  const t: Touch[] = [
    { project: 'p', actor: 'gh:new', kind: 'stargazer', at: d(1) },
    { project: 'p', actor: 'gh:old', kind: 'stargazer', at: d(1) },
    { project: 'p', actor: 'gh:unknown', kind: 'stargazer', at: d(1) },
  ];
  const actors = new Map<string, ActorFacts>([['gh:new', { created_at: d(10) }], ['gh:old', { created_at: d(400) }]]);
  assert.equal(countProject('p', t, { self: new Set(), actors, ring: new Map() }).users, 0.5 + 1 + 0.5);
  const wt = [call('wallet:0xfresh', 1), call('wallet:0xold', 2), call('wallet:0xold2', 3)];
  const wa = new Map<string, ActorFacts>([['wallet:0xfresh', { first_tx_at: d(3) }], ['wallet:0xold', OLD], ['wallet:0xold2', OLD]]);
  assert.equal(countProject('p', wt, { self: new Set(), actors: wa, ring: new Map() }).users, 0.5 + 1 + 1);
});

test('3.7 rings: two people counting each other count each other once at 50%', () => {
  const owner = new Map([['gh:bob', 2], ['gh:alice', 1]]);
  const r = ringWeights([[2, 1], [1, 2]], 1, owner);
  assert.equal(r.ring.get('gh:bob'), RULES.ringWeight);
  const t: Touch[] = [{ project: 'p', actor: 'gh:bob', kind: 'stargazer', at: d(1) }, { project: 'p', actor: 'gh:carol', kind: 'stargazer', at: d(1) }];
  assert.equal(countProject('p', t, { self: new Set(), actors: new Map([['gh:bob', OLD], ['gh:carol', OLD]]), ...r }).users, 1.5);
  // one-way: no ring
  assert.equal(ringWeights([[2, 1]], 1, owner).ring.size, 0);
});

test('3.8 rings: a cluster of 5+ people all counting each other caps in-cluster credit at 5', () => {
  const people = [1, 2, 3, 4, 5, 6, 7];
  const owner = new Map(people.map((p) => [`gh:u${p}`, p]));
  const edges: [number, number][] = people.flatMap((a) => people.filter((b) => b !== a).map((b) => [a, b] as [number, number]));
  const r = ringWeights(edges, 1, owner);
  assert.equal(r.clusterCap?.cap, 5);
  const t: Touch[] = people.filter((p) => p !== 1).map((p) => ({ project: 'p', actor: `gh:u${p}`, kind: 'stargazer' as const, at: d(1) }));
  const c = countProject('p', t, { self: new Set(), actors: new Map(t.map((x) => [x.actor, OLD])), ...r });
  // 6 others at 0.5 each = 3, under the cap; with 12 others at 0.5 = 6 -> 5
  assert.equal(c.users, 3);
  const many = Array.from({ length: 13 }, (_, i) => i + 1);
  const owner2 = new Map(many.map((p) => [`gh:u${p}`, p]));
  const r2 = ringWeights(many.flatMap((a) => many.filter((b) => b !== a).map((b) => [a, b] as [number, number])), 1, owner2);
  const t2: Touch[] = many.filter((p) => p !== 1).map((p) => ({ project: 'p', actor: `gh:u${p}`, kind: 'stargazer' as const, at: d(1) }));
  assert.equal(countProject('p', t2, { self: new Set(), actors: new Map(t2.map((x) => [x.actor, OLD])), ...r2 }).users, 5);
});

test('3.9 money: fees + 0.01 x volume, volume capped per wallet like fees', () => {
  const t = [call('wallet:0xa', 1, { fee_usd: 10, volume_usd: 1000 }), ...wallets(9).map((w, i) => call(w, 1 + (i % 4), { fee_usd: 10, volume_usd: 1000 }))];
  const c = countProject('p', t, ctx({}, ['wallet:0xa', ...wallets(9)]));
  assert.equal(moneyOf(c), 100 + 0.01 * 10_000);
});

test('3.10 golden: a farmed project scores at or below its honest twin', () => {
  // Honest: 30 old wallets over 15 days, 10 old stargazers.
  const honestW = wallets(30, 'h');
  const honest: Touch[] = [
    ...honestW.map((w, i) => call(w, 1 + (i % 15), { fee_usd: 5 })),
    ...Array.from({ length: 10 }, (_, i) => ({ project: 'p', actor: `gh:fan${i}`, kind: 'stargazer' as const, at: d(5) })),
  ];
  const honestCtx = ctx({}, [...honestW, ...Array.from({ length: 10 }, (_, i) => `gh:fan${i}`)]);
  // Farmed: the same counts, but 5 self-calls, a one-day burst of fresh wallets, and a star ring of 10 accounts.
  const fresh = wallets(25, 'f');
  const ringPeople = Array.from({ length: 10 }, (_, i) => i + 2);
  const owner = new Map(ringPeople.map((p) => [`gh:ring${p}`, p] as [string, number]));
  const edges: [number, number][] = [1, ...ringPeople].flatMap((a) => [1, ...ringPeople].filter((b) => b !== a).map((b) => [a, b] as [number, number]));
  const farmed: Touch[] = [
    ...['wallet:0xme1', 'wallet:0xme2', 'wallet:0xme3', 'wallet:0xme4', 'wallet:0xme5'].map((w) => call(w, 1, { fee_usd: 5 })),
    ...fresh.map((w) => call(w, 1, { fee_usd: 5 })),
    ...ringPeople.map((p) => ({ project: 'p', actor: `gh:ring${p}`, kind: 'stargazer' as const, at: d(1) })),
  ];
  const farmedActors = new Map<string, ActorFacts>([
    ...fresh.map((w) => [w, { first_tx_at: d(2) }] as [string, ActorFacts]),
    ...ringPeople.map((p) => [`gh:ring${p}`, OLD] as [string, ActorFacts]),
  ]);
  const farmedCtx: FarmCtx = { self: new Set(['wallet:0xme1', 'wallet:0xme2', 'wallet:0xme3', 'wallet:0xme4', 'wallet:0xme5']), actors: farmedActors, ...ringWeights(edges, 1, owner) };
  const cal = calibration('v1-launch');
  const asInput = (c: ReturnType<typeof countProject>) => ({ key: 'p', title: 'p', users: c.users, money_usd: moneyOf(c), outcomes: c.outcomes, first_outcome_at: d(15), last_used_at: d(1), commit_weeks: [] });
  const h = computeScore([asInput(countProject('p', honest, honestCtx))], cal, NOW).score;
  const f = computeScore([asInput(countProject('p', farmed, farmedCtx))], cal, NOW).score;
  assert.ok(f <= h, `farmed ${f} > honest ${h}`);
  // Variant: 2 off-day wallets, so the burst x fresh path (0.25 x 0.5) is exercised too.
  const off = wallets(2, 'o');
  const farmed2 = [...farmed, call(off[0], 6, { fee_usd: 5 }), call(off[1], 9, { fee_usd: 5 })];
  const farmedCtx2: FarmCtx = { ...farmedCtx, actors: new Map([...farmedActors, ...off.map((w) => [w, { first_tx_at: d(300) }] as [string, ActorFacts])]) };
  const c2 = countProject('p', farmed2, farmedCtx2);
  assert.equal(c2.actors.get(fresh[0]), RULES.burstWeight * RULES.freshWeight);
  const f2 = computeScore([asInput(c2)], cal, NOW).score;
  assert.ok(f2 <= h, `farmed variant ${f2} > honest ${h}`);
  assert.ok(h > 0);
});

test('3.11 finite outputs: invalid dates are skipped and NaN money counts 0', () => {
  const ws = wallets(3);
  const t = [...ws.map((w, i) => call(w, 1 + i, { fee_usd: Number.NaN, volume_usd: Infinity })), call('wallet:0xbad', 1, { fee_usd: 5 })];
  t[3] = { ...t[3], at: new Date('nope') };
  const c = countProject('p', t, ctx({}, [...ws, 'wallet:0xbad']));
  assert.equal(c.users, 3);
  for (const n of [c.users, c.fees_usd, c.volume_usd, moneyOf(c)]) assert.ok(Number.isFinite(n));
  assert.ok(c.outcomes.every((o) => Number.isFinite(o.at.getTime()) && Number.isFinite(o.weight)));
});

test('3.12 rings: a partner owning several accounts adds 0.5 once per project', () => {
  const owner = new Map([['gh:bob', 2], ['wallet:0xb1', 2], ['wallet:0xb2', 2], ['wallet:0xb3', 2], ['gh:alice', 1]]);
  const r = ringWeights([[1, 2], [2, 1]], 1, owner);
  const t: Touch[] = [call('gh:bob', 1), call('wallet:0xb1', 1), call('wallet:0xb2', 2), call('wallet:0xb3', 3)].map((x) => ({ ...x, kind: 'stargazer' as const }));
  const c = countProject('p', t, { self: new Set(), actors: new Map<string, ActorFacts>(t.map((x) => [x.actor, OLD])), ...r });
  assert.equal(c.users, 0.5);
});

test('3.13 ids are case-insensitive: mixed-case self is excluded and 0xABC/0xabc dedupe', () => {
  const t = [call('wallet:0xABC', 1, { fee_usd: 9 }), call('wallet:0xdef', 2), call('wallet:0xDEF', 3), call('wallet:0xghi', 4), call('wallet:0xjkl', 5)];
  const c = countProject('p', t, ctx({ self: new Set(['wallet:0xabc']) }, ['wallet:0xdef', 'wallet:0xghi', 'wallet:0xjkl']));
  assert.equal(c.users, 3);
  assert.equal(c.fees_usd, 0);
  const u = countProject('p', [call('wallet:0xAAA', 1), call('wallet:0xaaa', 2), call('wallet:0xbbb', 3)], ctx({}, ['wallet:0xaaa', 'wallet:0xbbb']));
  assert.equal(u.actors.size, 2);
});

test('3.14 fresh wallet: a first transaction after the call is unknown data (50%)', () => {
  const t = [call('wallet:0xfut', 5), call('wallet:0xo1', 1), call('wallet:0xo2', 2)];
  const a = new Map<string, ActorFacts>([['wallet:0xfut', { first_tx_at: d(-300) }], ['wallet:0xo1', OLD], ['wallet:0xo2', OLD]]);
  assert.equal(countProject('p', t, { self: new Set(), actors: a, ring: new Map() }).users, 2.5);
});
