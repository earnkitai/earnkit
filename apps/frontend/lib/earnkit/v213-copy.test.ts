import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_ALLOWED, bannedIn, bannedInBench } from './fixtures/banned-words';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pageWords } from './fixtures/page-words';
import { benchRank } from './rank';
import { raiseLine } from './coin-moments';
import { RAISE_LINES, showRaisingLine } from './raising';
import RaisingPill from '../../app/components/ui/RaisingPill';
import {
  CONFIRMED_LINE, NO_PROJECT_LINE, POST_UPDATE_ASK, UPDATES_ASK, buildAsk, claimToJoinLine, confirmingLine, enterAsk, fitsLine, goLiveAsk, ideasLine, onBenchLine,
} from './bench-reply';

// The components are compiled with the classic JSX runtime here (as feed.test.ts).
(globalThis as { React?: typeof React }).React = React;

/** Builder and public text added in v2.13, checked by the v2.13 rule (plan B17). Names (projects, programs, $TICKERS) are exempt. */
const EXEMPT = ['Recipe planner', 'Avalanche Team1 Mini Grants', 'Base Builder Grants', 'EarnKit', 'tokens.fun', '$RECIPE', 'RECIPE'];
const s = (rank: number, total: number) => ({ ranked: true, rank, total });
export const TEXTS: string[] = [
  ...[s(18, 100), s(3, 1000), s(10, 19)].flatMap((x) => [benchRank(x)!.short, benchRank(x)!.phrase]),
  ...(['base', 'arc', 'robinhood'] as const).flatMap((chain) => [benchRank(s(1, 100), { chain })!.short, benchRank(s(2, 12), { chain })!.short]),
  // T8: the reply's lines. The 2b lines name a funder and the starter's offer through the BENCH_PITCH_ALLOWED hook (plan B12).
  NO_PROJECT_LINE, confirmingLine('Recipe planner'), onBenchLine('Recipe planner', 'top 18% of builders', 6), UPDATES_ASK, POST_UPDATE_ASK,
  goLiveAsk('Recipe planner'), enterAsk('Base Builder Grants'), fitsLine('Avalanche Team1 Mini Grants', 'up to $10K', 'Recipe planner', 'open all year'),
  claimToJoinLine('Recipe planner', 'earnkit.com/claim/abcdefghijkl'), CONFIRMED_LINE('Recipe planner'),
  ideasLine([{ who: 'Arc', prize: 'up to $10K', for: 'payment apps' }, { who: 'Base', prize: 'up to $5K', for: 'a live app' }]), buildAsk('a tip jar on Arc'),
  // T9: the raise lines and the pill's words.
  raiseLine('Recipe planner', 'RECIPE', null), showRaisingLine('RECIPE'), RAISE_LINES.on('RECIPE'), RAISE_LINES.off, RAISE_LINES.notLaunched,
  pageWords(React.createElement(RaisingPill, { symbol: 'RECIPE', url: 'https://tokens.fun/coin/0xabc' })),
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

test('9.9 the pill says "Raising $RECIPE" and links to the coin\'s tokens.fun page, nothing else', () => {
  const h = renderToStaticMarkup(React.createElement(RaisingPill, { symbol: 'RECIPE', url: 'https://tokens.fun/coin/0xabc', size: 'sm' }));
  assert.equal(pageWords(React.createElement(RaisingPill, { symbol: 'RECIPE', url: 'https://tokens.fun/coin/0xabc' })).trim(), 'Raising $RECIPE');
  assert.match(h, /^<a href="https:\/\/tokens\.fun\/coin\/0xabc" target="_blank" rel="noopener noreferrer"/);
});
