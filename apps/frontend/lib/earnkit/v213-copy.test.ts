import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_ALLOWED, bannedIn, bannedInBench } from './fixtures/banned-words';
import { benchRank } from './rank';

/** Builder and public text added in v2.13, checked by the v2.13 rule (plan B17). Names (projects, programs, $TICKERS) are exempt. */
const EXEMPT = ['Recipe planner', 'Avalanche Team1 Mini Grants', 'Base Builder Grants', 'EarnKit', 'tokens.fun', '$RECIPE', 'RECIPE'];
const s = (rank: number, total: number) => ({ ranked: true, rank, total });
export const TEXTS: string[] = [
  ...[s(18, 100), s(3, 1000), s(10, 19)].flatMap((x) => [benchRank(x)!.short, benchRank(x)!.phrase]),
  ...(['base', 'arc', 'robinhood'] as const).flatMap((chain) => [benchRank(s(1, 100), { chain })!.short, benchRank(s(2, 12), { chain })!.short]),
];

test('7.5 every v2.13 string passes the v2.13 copy rule', () => {
  for (const t of TEXTS) assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
});

test('7.6 the rule: chain names only inside a rank line, "percentile", "signal", "outcome", the builder bonus and "written by" never', () => {
  assert.notDeepEqual(bannedIn('Top 1% on Base', []), [], 'the v2.12.1 rule still bans it');
  assert.deepEqual(bannedInBench('Top 1% on Base', []), []);
  assert.deepEqual(bannedInBench('#3 of 12 on Robinhood Chain', []), []);
  assert.deepEqual(bannedInBench('12 commits', []), [], 'a fact chip');
  assert.deepEqual(bannedInBench('Arc pays up to $10K for payment apps.', []), [], 'program pitch (F10)');
  assert.deepEqual(bannedInBench('a tip jar on Arc', []), [], 'starter offer (F10)');
  for (const bad of ['Deploy on Base', 'Base pays more', 'top percentile', 'a strong signal', 'your outcome', 'the builder bonus', 'written by an agent', 'Your repo',
    'Base pays up to $5K for the builder bonus.', 'Arc pays up to $5K for Base apps.', 'Desktop 5% on Base', 'Stop 1% on Base'])
    assert.notDeepEqual(bannedInBench(bad, []), [], bad);
  assert.ok(BENCH_ALLOWED.every((r) => r.global), 'every allowance strips every match');
});
