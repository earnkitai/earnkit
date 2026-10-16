import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_ALLOWED, bannedIn, bannedInBench } from './fixtures/banned-words';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pageWords } from './fixtures/page-words';
import { CHAIN_LABEL, benchRank } from './rank';
import { bestFact } from './bench-data';
import BenchView, { BENCH_EMPTY, BENCH_TITLE, FILTER_RAISING, FILTER_WEEKLY, benchLine } from '../../app/bench/BenchView';
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

test('10.7 the Bench\'s words pass the v2.13 rule; its chips may name a chain (copy rules)', () => {
  const facts = [
    { people_week: 1, streak: 0, weeks_shipping: 0, shipped: true }, { people_week: 31, streak: 6, weeks_shipping: 9, shipped: true },
    { people_week: 0, streak: 6, weeks_shipping: 9, shipped: true }, { people_week: 0, streak: 1, weeks_shipping: 1, shipped: true },
    { people_week: 0, streak: 1, weeks_shipping: 9, shipped: true }, { people_week: 0, streak: 0, weeks_shipping: 0, shipped: true },
    { people_week: 0, streak: 0, weeks_shipping: 0, shipped: false },
  ].map(bestFact);
  for (const t of [BENCH_TITLE, benchLine(25), benchLine(1), BENCH_EMPTY, FILTER_RAISING, FILTER_WEEKLY, ...facts]) assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
  const row = { rank: 2, line: 'Top 4%', handle: 'maya_makes', name: 'Maya Chen', avatar: null, raising: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, chains: ['base' as const, 'robinhood' as const, 'arc' as const], project: 'Recipe planner', best: '31 people this week' };
  const page = pageWords(React.createElement(BenchView, { rows: [row], count: 25, chips: ['base', 'robinhood', 'arc'], filter: { chain: 'base', raising: true, weekly: false }, raising: true }));
  // Chain names only in the chips and the logos' alt text and tooltips (R14).
  assert.deepEqual(bannedInBench(page, ['Maya Chen', 'Recipe planner', '$RECIPE', ...Object.values(CHAIN_LABEL)]), [], page);
});

test('11.11 the profile\'s words pass the v2.13 rule on both tabs; chain names only in rank lines and logos (copy rules)', async () => {
  const { default: BenchProfileView, BENCH_SOURCES_LINE, LOG_EMPTY, TAB_LOG, TAB_PROJECT, confirmingCardLine, streakWords } = await import('../../app/[handle]/BenchProfileView');
  const { shippedWords } = await import('../../app/[handle]/ShipGrid');
  const { factChips, startedChips, startedLine } = await import('./week-facts');
  const { DATA } = await import('./fixtures/profile-data');
  const { benchShareText } = await import('./bench-data');
  const texts = [
    TAB_LOG, TAB_PROJECT, BENCH_SOURCES_LINE, LOG_EMPTY, confirmingCardLine('Maya Chen', 'Recipe planner'), streakWords(6)!, streakWords(1)!, shippedWords(9), shippedWords(1),
    benchShareText({ handle: 'maya_makes', bench: 'Top 4% on the Bench', project: null, streak: 0 }), benchShareText({ handle: 'maya_makes', bench: '#2 of 18 on the Bench', project: null, streak: 0 }),
    benchShareText({ handle: 'maya_makes', bench: null, project: 'Recipe planner', streak: 6 }), benchShareText({ handle: 'maya_makes', bench: null, project: null, streak: 0 }),
    startedLine('Recipe planner'), ...startedChips({ live: true, weeks: 3, people: 31 }), ...startedChips({ live: false, weeks: 1, people: 1 }),
    ...factChips({ went_live: true, won: [{ title: 'Base Builder Grants' }], users_up: { n: 31 }, earned: { usd: 120 }, shipped_code: { n: 12 }, streak: { w: 6 } }, { raising: 'RECIPE' }),
  ];
  for (const t of texts) assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
  // O3 fix round 1 (controller ruling): the grid says "Code in", never "Shipped" (the score part's word).
  assert.equal(shippedWords(9), 'Code in 9 of the last 52 weeks');
  assert.equal(shippedWords(1), 'Code in 1 of the last 52 weeks');
  const exempt = ['Maya Chen', 'Recipe planner', '$RECIPE', 'Base Builder Grants', 'Avalanche Team1 Mini Grants', 'https://recipes.app', 'https://github.com/maya/recipes', ...Object.values(CHAIN_LABEL)];
  for (const tab of ['log', 'project'] as const) {
    const page = pageWords(React.createElement(BenchProfileView, { data: DATA, tab }));
    assert.deepEqual(bannedInBench(page, exempt), [], page);
    // v2.13.1 O3: the Confirming page too.
    const confirming = pageWords(React.createElement(BenchProfileView, { data: { ...DATA, project: { ...DATA.project!, confirmed: false } }, tab }));
    assert.deepEqual(bannedInBench(confirming, exempt), [], confirming);
  }
});

test('12.7 the landing page\'s words pass the v2.13 rule (copy rules)', async () => {
  const { default: HomeView } = await import('../../app/HomeView');
  const { homeFixture } = await import('./fixtures/landing');
  const { BENCH_HERO_SUBTITLE, BENCH_HERO_SUBTITLE_NO_RAISE, BENCH_HERO_TITLE } = await import('../../app/components/sections/Hero');
  const { BENCH_TOP_TITLE, SEE_BENCH } = await import('../../app/components/sections/BenchTop');
  const { CAROUSEL_TITLE, SEE_ALL_UPDATES } = await import('../../app/components/sections/UpdateCarousel');
  const { BENCH_HOW_TITLE, BENCH_STEPS, BENCH_STEPS_NO_RAISE } = await import('../../app/components/sections/BenchHowItWorks');
  const { BENCH_FOOTER_TAGLINE } = await import('./footer-links');
  for (const t of [BENCH_HERO_TITLE, BENCH_HERO_SUBTITLE, BENCH_HERO_SUBTITLE_NO_RAISE, ...BENCH_STEPS_NO_RAISE, BENCH_TOP_TITLE, SEE_BENCH, CAROUSEL_TITLE, SEE_ALL_UPDATES, 'Grants open now', BENCH_HOW_TITLE, ...BENCH_STEPS, BENCH_FOOTER_TAGLINE])
    assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
  const row = { rank: 1, line: 'Top 1%', handle: 'maya_makes', name: 'Maya Chen', avatar: null, raising: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, chains: ['base' as const], project: 'Recipe planner', best: '31 people this week' };
  const card = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import. It plans a week.', chips: ['Went live', '+31 people'], pinned: false };
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...row, handle: `b${i}`, rank: i + 1 }));
  const page = pageWords(React.createElement(HomeView, { landing: { ...homeFixture, bench: { rows, chips: ['base', 'robinhood', 'arc'], cards: [card], raising: true } } }));
  // Names: the builder, the project, the coin, the programs' titles, the chains on the chips and logos (R14), the investors' logos (Backed by, unchanged).
  const investors = ['The LAO', 'IDEO', 'GCR'];
  const exempt = ['Maya Chen', 'Recipe planner', '$RECIPE', 'EarnKit', ...homeFixture.tiles.map((t) => t.title), ...Object.values(CHAIN_LABEL), ...investors];
  assert.deepEqual(bannedInBench(page, exempt), [], page);
});

test('13.8 no builder-visible bonus text under the flag: replies, landing, program pages, guides, the install modal, terms (acceptance 7)', async () => {
  const { default: HomeView } = await import('../../app/HomeView');
  const { homeFixture } = await import('./fixtures/landing');
  const { default: TermsPage } = await import('../../app/terms/page');
  const { default: GuideView } = await import('../../app/programs/[id]/GuideView');
  const { default: AddToAgent } = await import('../../app/components/sections/AddToAgent');
  const { default: ProgramCards } = await import('../../app/components/sections/ProgramCards');
  const { fullGuide } = await import('./fixtures/guide');
  const { toolDescriptions, serverInstructions } = await import('./mcp');
  const score = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  const bonusWords = /builder bonus|bonus pool|\bbonus\b/i;
  // Flag off: the guide's pill and the install modal's pill are today's (the switch is what hides them).
  delete process.env.EARNKIT_BENCH;
  assert.match(renderToStaticMarkup(React.createElement(GuideView, { page: fullGuide })), /Builder bonus/);
  assert.match(renderToStaticMarkup(React.createElement(AddToAgent, { onClose: () => {} })), /Builder bonus/);
  process.env.EARNKIT_BENCH = 'on';
  try {
    const pages = [
      renderToStaticMarkup(React.createElement(HomeView, { landing: { ...homeFixture, bench: { rows: [], chips: [], cards: [], raising: true } } })),
      renderToStaticMarkup(React.createElement(TermsPage)),
      // F3: no `bench` prop; GuideView reads the switch itself.
      renderToStaticMarkup(React.createElement(GuideView, { page: fullGuide })),
      renderToStaticMarkup(React.createElement(AddToAgent, { onClose: () => {}, bench: true })),
      // /programs under the flag: every card without its pill.
      renderToStaticMarkup(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1', layout: 'grid', bonus: false })),
      ...Object.values(toolDescriptions(true, true)), serverInstructions(true), serverInstructions(false),
    ];
    for (const p of pages) assert.doesNotMatch(p, bonusWords, p.slice(0, 200));
  } finally {
    delete process.env.EARNKIT_BENCH;
    if (score === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = score;
  }
});
