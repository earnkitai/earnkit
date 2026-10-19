import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_ALLOWED, bannedIn, bannedInBench } from './fixtures/banned-words';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pageWords } from './fixtures/page-words';
import { CHAIN_LABEL, rankLine, scoreLine } from './rank';
import { bestFact } from './bench-data';
import BenchView, { BENCH_EMPTY, BENCH_TITLE, FILTER_WEEKLY, benchLine } from '../../app/leaderboard/BenchView';
import { raiseLine } from './coin-moments';
import { RAISE_LINES, showRaisingLine } from './raising';
import RaisingPill from '../../app/components/ui/RaisingPill';
import {
  NOT_ON_BENCH, STATE_COPY, VARIANT_COPY, fitsLine, ideasLine, noFitLine,
} from './bench-reply';
import { fitWhy } from './bench-find';

// The components are compiled with the classic JSX runtime here (as feed.test.ts).
(globalThis as { React?: typeof React }).React = React;

/** Builder and public text added in v2.13, checked by the v2.13 rule (plan B17). Names (projects, programs, $TICKERS) are exempt. */
const EXEMPT = ['Recipe planner', 'Avalanche Team1 Mini Grants', 'Base Builder Grants', 'EarnKit', 'tokens.fun', '$RECIPE', 'RECIPE'];
const s = (rank: number, total: number) => ({ ranked: true, rank, total });
export const TEXTS: string[] = [
  ...[s(18, 100), s(3, 1000), s(10, 19), s(70, 100)].flatMap((x) => [rankLine(x)!, scoreLine(62, rankLine(x))]),
  ...(['base', 'arc', 'robinhood'] as const).flatMap((chain) => [rankLine(s(1, 100), { chain })!, rankLine(s(2, 12), { chain })!]),
  // T8: the reply's lines. The 2b lines name a funder and the starter's offer through the BENCH_PITCH_ALLOWED hook (plan B12).
  // v2.14 T9, R16a: the four states' copy (STATE_COPY, VARIANT_COPY). R12: a fit line with its deadline and why, each why the matcher can give.
  NOT_ON_BENCH, STATE_COPY.not_counted.stand('Recipe planner'), STATE_COPY.ranked.stand('Recipe planner', 62, 'Top 18% of builders this week'), STATE_COPY.ranked.ask(),
  noFitLine('Recipe planner'),
  ...([
    { chains: { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' } }, live: true },
    { chains: { arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } }, live: false },
    { chains: { monad: { mainnet: false, testnet: true, evidence: 'x', basis: 'mention' } }, live: false },
    { chains: { robinhood: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' } }, live: true },
  ] as const).map((repo) => fitsLine('Avalanche Team1 Mini Grants', 'up to $10K', 'rolling',
    fitWhy({ chains: ['base', 'arc', 'monad', 'robinhood'], any_chain: false, tag: 'needs a live product' }, repo))),
  fitsLine('Base Builder Grants', 'up to $5K', 'closes Oct 30', fitWhy({ chains: [], any_chain: true, tag: null }, { chains: {}, live: false })),
  STATE_COPY.signed_out.ask('https://earnkit.com/signin/x'), STATE_COPY.no_project.ask(), STATE_COPY.not_counted.ask('https://earnkit.com/github/verify?n=x'),
  ...Object.values(VARIANT_COPY).flatMap((v) => [v.stand('Recipe planner'), v.ask('Recipe planner')]),
  ideasLine([{ who: 'Arc', prize: 'up to $10K', for: 'payment apps' }, { who: 'Base', prize: 'up to $5K', for: 'a live app' }]),
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

test('9.9 the pill says "Community round $RECIPE" (owner ruling B, v2.13.3) and links to the coin\'s tokens.fun page, nothing else', () => {
  const h = renderToStaticMarkup(React.createElement(RaisingPill, { symbol: 'RECIPE', url: 'https://tokens.fun/coin/0xabc', size: 'sm' }));
  assert.equal(pageWords(React.createElement(RaisingPill, { symbol: 'RECIPE', url: 'https://tokens.fun/coin/0xabc' })).trim(), 'Community round $RECIPE');
  assert.match(h, /^<a href="https:\/\/tokens\.fun\/coin\/0xabc" target="_blank" rel="noopener noreferrer"/);
});

test('10.7 the Bench\'s words pass the v2.13 rule; its chips may name a chain (copy rules)', () => {
  const facts = [
    { people_week: 1, streak: 0, weeks_shipping: 0, shipped: true }, { people_week: 31, streak: 6, weeks_shipping: 9, shipped: true },
    { people_week: 0, streak: 6, weeks_shipping: 9, shipped: true }, { people_week: 0, streak: 1, weeks_shipping: 1, shipped: true },
    { people_week: 0, streak: 1, weeks_shipping: 9, shipped: true }, { people_week: 0, streak: 0, weeks_shipping: 0, shipped: true },
    { people_week: 0, streak: 0, weeks_shipping: 0, shipped: false },
  ].map(bestFact);
  for (const t of [BENCH_TITLE, benchLine(25), benchLine(1), BENCH_EMPTY, FILTER_WEEKLY, ...facts]) assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
  const row = { rank: 2, line: 'Top 4%', points: 62, handle: 'maya_makes', name: 'Maya Chen', avatar: null, raising: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, chains: ['base' as const, 'robinhood' as const, 'arc' as const], project: 'Recipe planner', best: '31 people this week' };
  const page = pageWords(React.createElement(BenchView, { rows: [row], count: 25, chips: ['base', 'robinhood', 'arc'], filter: { chain: 'base', weekly: false } }));
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
    benchShareText({ handle: 'maya_makes', bench: 'Shipping 62 · Top 4% of builders this week', project: null, streak: 0 }), benchShareText({ handle: 'maya_makes', bench: 'Shipping 40 · #2 of 18 builders this week', project: null, streak: 0 }),
    benchShareText({ handle: 'maya_makes', bench: null, project: 'Recipe planner', streak: 6 }), benchShareText({ handle: 'maya_makes', bench: null, project: null, streak: 0 }),
    startedLine('Recipe planner'), ...startedChips({ live: true, weeks: 3, people: 31 }), ...startedChips({ live: false, weeks: 1, people: 1 }),
    ...factChips({ went_live: true, won: [{ title: 'Base Builder Grants' }], users_up: { n: 31 }, earned: { usd: 120 }, shipped_code: { n: 12 }, streak: { w: 6 } }),
  ];
  for (const t of texts) assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
  // O3 fix round 1 (controller ruling): the grid says "Code in", never "Shipped" (the score part's word).
  assert.equal(shippedWords(9), 'Code in 9 of the last 52 weeks');
  assert.equal(shippedWords(1), 'Code in 1 of the last 52 weeks');
  // Launch-ready L8: README is a file's name (the badge line), not shouting.
  const exempt = ['Maya Chen', 'Recipe planner', '$RECIPE', 'Base Builder Grants', 'Avalanche Team1 Mini Grants', 'https://recipes.app', 'https://github.com/maya/recipes', 'README', ...Object.values(CHAIN_LABEL)];
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
  const { BENCH_HERO_SUBTITLE, BENCH_HERO_TITLE } = await import('../../app/components/sections/Hero');
  const { BENCH_TOP_TITLE, SEE_BENCH } = await import('../../app/components/sections/BenchTop');
  const { CAROUSEL_TITLE, SEE_ALL_UPDATES } = await import('../../app/components/sections/UpdateCarousel');
  const { BENCH_FOOTER_TAGLINE } = await import('./footer-links');
  for (const t of [BENCH_HERO_TITLE, BENCH_HERO_SUBTITLE, BENCH_TOP_TITLE, SEE_BENCH, CAROUSEL_TITLE, SEE_ALL_UPDATES, 'Money open now', BENCH_FOOTER_TAGLINE])
    assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
  const row = { rank: 1, line: 'Top 1%', points: 62, handle: 'maya_makes', name: 'Maya Chen', avatar: null, raising: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, chains: ['base' as const], project: 'Recipe planner', best: '31 people this week' };
  const card = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import. It plans a week.', chips: ['Went live', '+31 people'], titles: [], pinned: false };
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...row, handle: `b${i}`, rank: i + 1 }));
  const page = pageWords(React.createElement(HomeView, { landing: { ...homeFixture, bench: { rows, count: 12, chips: ['base', 'robinhood', 'arc'], cards: [card], raising: true } } }));
  // Names: the builder, the project, the coin, the programs' titles, the chains on the chips and logos (R14), the investors' logos (Backed by, unchanged).
  const investors = ['The LAO', 'IDEO', 'GCR'];
  const exempt = ['Maya Chen', 'Recipe planner', '$RECIPE', 'EarnKit', ...homeFixture.tiles.map((t) => t.title), ...Object.values(CHAIN_LABEL), ...investors];
  assert.deepEqual(bannedInBench(page, exempt), [], page);
});

test('13.8 no builder-visible bonus text: replies, landing, program pages, guides, the install modal, terms (acceptance 7)', async () => {
  const { default: HomeView } = await import('../../app/HomeView');
  const { homeFixture } = await import('./fixtures/landing');
  const { default: TermsPage } = await import('../../app/terms/page');
  const { default: GuideView } = await import('../../app/programs/[id]/GuideView');
  const { default: AddToAgent } = await import('../../app/components/sections/AddToAgent');
  const { default: ProgramCards } = await import('../../app/components/sections/ProgramCards');
  const { fullGuide } = await import('./fixtures/guide');
  const { toolDescriptions, serverInstructions } = await import('./mcp');
  const bonusWords = /builder bonus|bonus pool|\bbonus\b/i;
  const pages = [
    renderToStaticMarkup(React.createElement(HomeView, { landing: { ...homeFixture, bench: { rows: [], count: 0, chips: [], cards: [], raising: true } } })),
    renderToStaticMarkup(React.createElement(HomeView, { landing: null })),
    renderToStaticMarkup(React.createElement(TermsPage)),
    renderToStaticMarkup(React.createElement(GuideView, { page: fullGuide })),
    renderToStaticMarkup(React.createElement(AddToAgent, { onClose: () => {} })),
    renderToStaticMarkup(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1', layout: 'grid' })),
    ...Object.values(toolDescriptions(true, true)), serverInstructions(),
  ];
  for (const p of pages) assert.doesNotMatch(p, bonusWords, p.slice(0, 200));
});
