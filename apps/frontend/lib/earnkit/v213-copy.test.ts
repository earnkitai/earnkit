import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mondayOpener } from './weekly-moment';
import { BENCH_ALLOWED, bannedIn, bannedInBench } from './fixtures/banned-words';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pageWords } from './fixtures/page-words';
import { CHAIN_LABEL, rankLine, scoreLine } from './rank';
import { bestFact } from './bench-data';
import BenchView, { BENCH_EMPTY, BENCH_TITLE, FILTER_WEEKLY } from '../../app/leaderboard/BenchView';
import { leaderboardLine } from './site-copy';
import {
  INTRO_LINE, MOMENT_ADDED, SHIP_ASK, TITLES_ASK, grantHook, qualifyAsk, qualifyGap, qualifySteps, STATE_COPY, VARIANT_COPY, applyAsk, connectAsk, connectStanding, introWhat,
  qualifyLine, standingLine, youreIn,
} from './bench-reply';
import { fitWhy } from './bench-find';

// The components are compiled with the classic JSX runtime here (as feed.test.ts).
(globalThis as { React?: typeof React }).React = React;

/** Builder and public text added in v2.13, checked by the v2.13 rule (plan B17). Names (projects, programs, $TICKERS) are exempt. */
const EXEMPT = ['Recipe planner', 'Avalanche Team1 Mini Grants', 'Base Builder Grants', 'Builder Codes', 'EarnKit', 'tokens.fun', '$RECIPE', 'RECIPE'];
const s = (rank: number, total: number) => ({ ranked: true, rank, total });
export const TEXTS: string[] = ([
  ...[s(18, 100), s(3, 1000), s(10, 19), s(70, 100)].flatMap((x) => [rankLine(x)!, scoreLine(62, rankLine(x))]),
  ...(['base', 'arc', 'robinhood'] as const).flatMap((chain) => [rankLine(s(1, 100), { chain })!, rankLine(s(2, 12), { chain })!]),
  // T8: the reply's lines. The 2b lines name a funder and the starter's offer through the BENCH_PITCH_ALLOWED hook (plan B12).
  // v2.14 T9, R16a, v3.1 Task 16: the states' copy (STATE_COPY, VARIANT_COPY) and the owner-approved reply lines. R12: each
  // why the matcher can give (the page's fit lines).
  INTRO_LINE, introWhat({ org: 'Base', amount: '$5,000', chain: 'Base' }), introWhat(null), youreIn('maya'), TITLES_ASK,
  grantHook({ org: 'Base', amount: '$5,000', chain: 'Base' }), qualifyGap('Recipe planner', { missing: ['base', 'codes', 'use'], steps: ['base', 'codes', 'use'] }), qualifyAsk({ org: 'Base', amount: '$5,000', chain: 'Base' }, ['base', 'codes', 'use'], 'Recipe planner'),
  qualifySteps({ org: 'Base', amount: '$5,000', chain: 'Base' }, ['base', 'codes', 'use']),
  STATE_COPY.not_counted.stand('Recipe planner'), standingLine('Recipe planner', 'Top 18% of builders', 3, 340), connectStanding('Recipe planner', '#3 of 12 builders', 2),
  connectAsk('earnkit.com/maya'), qualifyLine({ title: 'Base Builder Grants', amount: '$5,000', when: 'closes Oct 30' }), applyAsk('Base Builder Grants', '$5,000', null),
  SHIP_ASK, mondayOpener('Maya', null, { shipped: true }), MOMENT_ADDED,
  ...([
    { chains: { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' } }, live: true },
    { chains: { arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } }, live: false },
    { chains: { monad: { mainnet: false, testnet: true, evidence: 'x', basis: 'mention' } }, live: false },
    { chains: { robinhood: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' } }, live: true },
  ] as const).map((repo) => fitWhy({ chains: ['base', 'arc', 'monad', 'robinhood'], any_chain: false, tag: 'needs a live product' }, repo)),
  fitWhy({ chains: [], any_chain: true, tag: null }, { chains: {}, live: false }),
  STATE_COPY.signed_out.ask('https://earnkit.com/signin/x'), STATE_COPY.no_project.noApp(), STATE_COPY.no_project.ask('https://earnkit.com/github/verify?n=x', false), STATE_COPY.not_counted.ask('https://earnkit.com/github/verify?n=x', false),
  ...Object.values(VARIANT_COPY).flatMap((v) => [v.stand('Recipe planner'), v.ask('Recipe planner')]),
] as (string | null)[]).filter((x): x is string => x !== null);

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

test('10.7 the Bench\'s words pass the v2.13 rule; its chips may name a chain (copy rules)', () => {
  const facts = [
    { people_week: 1, streak: 0, weeks_shipping: 0, shipped: true }, { people_week: 31, streak: 6, weeks_shipping: 9, shipped: true },
    { people_week: 0, streak: 6, weeks_shipping: 9, shipped: true }, { people_week: 0, streak: 1, weeks_shipping: 1, shipped: true },
    { people_week: 0, streak: 1, weeks_shipping: 9, shipped: true }, { people_week: 0, streak: 0, weeks_shipping: 0, shipped: true },
    { people_week: 0, streak: 0, weeks_shipping: 0, shipped: false },
  ].map(bestFact);
  for (const t of [BENCH_TITLE, leaderboardLine(25), leaderboardLine(1), BENCH_EMPTY, FILTER_WEEKLY, ...facts]) assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
  const row = { rank: 2, line: 'Top 4%', points: 62, handle: 'maya_makes', name: 'Maya Chen', avatar: null, backing: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, chains: ['base' as const, 'robinhood' as const, 'arc' as const], project: 'Recipe planner', best: '31 people this week', streak: 0 };
  const page = pageWords(React.createElement(BenchView, { rows: [row], count: 25, chips: ['base', 'robinhood', 'arc'], filter: { chain: 'base', weekly: false }, page: 1 }));
  // Chain names only in the filter tabs (R14; v3.1 Task 8: rows carry no chain logos).
  assert.deepEqual(bannedInBench(page, ['Maya Chen', 'Recipe planner', '$RECIPE', ...Object.values(CHAIN_LABEL)]), [], page);
});

test('11.11 the profile\'s words pass the v2.13 rule; chain names only in the Base tile and highlights (copy rules)', async () => {
  const { default: BenchProfileView, confirmingCardLine, noProjectLine, streakWords } = await import('../../app/[handle]/BenchProfileView');
  const { shippedWords } = await import('../../app/[handle]/ShipGrid');
  const { factChips, startedChips, startedLine } = await import('./week-facts');
  const { DATA, JENIL, JENIL_SITE, MAYA, MAYA_SITE, SAM, SAM_SITE, siteOf } = await import('./fixtures/profile-data');
  const { benchShareText } = await import('./bench-data');
  const c = await import('./site-copy');
  const texts = [
    confirmingCardLine('Maya Chen', 'Recipe planner'), noProjectLine('Maya Chen'), streakWords(6)!, streakWords(1)!, shippedWords(9), shippedWords(1),
    benchShareText({ project: 'Recipe planner', streak: 6 }), benchShareText({ project: 'Recipe planner', streak: 0 }),
    startedLine('Recipe planner'), ...startedChips({ live: true, weeks: 3, people: 31 }), ...startedChips({ live: false, weeks: 1, people: 1 }),
    ...factChips({ went_live: true, won: [{ title: 'Base Builder Grants' }], users_up: { n: 31 }, earned: { usd: 120 }, shipped_code: { n: 12 }, streak: { w: 6 } }),
    c.SCORE_TITLE, c.scoreNote('Maya'), c.SCORE_PENDING, c.STREAK_TITLE, c.PROFILE_ACTIVITY, c.shippedAgo('2h ago'), c.HIGHLIGHTS_TITLE,
  ];
  for (const t of texts) assert.deepEqual(bannedInBench(t, EXEMPT), [], t);
  // O3 fix round 1 (controller ruling): the grid says "Code in", never "Shipped" (the score part's word).
  assert.equal(shippedWords(9), 'Code in 9 of the last 52 weeks');
  assert.equal(shippedWords(1), 'Code in 1 of the last 52 weeks');
  // v3.1 Task 7: the approved Profile boards name commits ("279 commits", "This week: 14 commits"), the repo in the
  // Builder Code highlight ("Builder Code in the repo", owner-approved 2026-10-22) and contracts ("[N] contracts on Base"), so those words are allowed on the
  // profile; every other word is checked.
  const allowed = [String(/\bcommits?\b/i), String(/\brepos?\b/i), String(/\bcontracts?\b/i)];
  const banned = (t: string, exempt: string[]) => bannedInBench(t, exempt).filter((w) => !allowed.includes(w));
  assert.ok(bannedInBench('This week: 14 commits', []).every((w) => allowed.includes(w)));
  const names = ['Maya Chen', 'Maya', 'Jenil', 'Sam', 'Recipe planner', 'EarnKit', 'Tipjar', 'Ledgerly', '$TIPJAR', 'Alliance ALL19', 'Base Builder Grant Program', 'Base Builder Code', 'Builder Code in the repo', ...Object.values(CHAIN_LABEL)];
  const exempt = [...names, 'https://recipes.app', 'earnkit.com', 'tipjar.xyz', 'github.com/sam/ledgerly'];
  const confirming = { ...DATA, project: { ...DATA.project!, confirmed: false } };
  for (const [d, site] of [[DATA, siteOf(DATA)], [confirming, siteOf(confirming)], [JENIL, JENIL_SITE], [MAYA, MAYA_SITE], [SAM, SAM_SITE]] as const) {
    const page = pageWords(React.createElement(BenchProfileView, { data: d, site, page: 1 }));
    assert.deepEqual(banned(page, exempt), [], page);
  }
});

test('12.7 the landing page\'s words pass the v2.13 rule (copy rules)', async () => {
  const { default: HomeView } = await import('../../app/HomeView');
  const { homeFixture } = await import('./fixtures/landing');
  // v3.1 Task 6: the landing's words are site-copy's (the v3 hero, BenchTop and FeedRows left with their sections).
  const c = await import('./site-copy');
  const { BENCH_FOOTER_TAGLINE } = await import('./footer-links');
  // The owner-approved v3.1 Landing board names commits ("From commit to capital", "279 commits"), so that word of the
  // v2.13 Bench rule is allowed on the landing. "repo" is allowed only in the steps' owner-approved phrases (clarity batch:
  // "pick the repo you're building", "We match your repo to open grants"), so a repo word anywhere else still fails.
  const commits = String(/\bcommits?\b/i);
  const banned = (t: string, exempt: string[]) => bannedInBench(t, exempt).filter((w) => w !== commits);
  for (const s of c.STEPS) assert.deepEqual(bannedInBench(s.text, EXEMPT), [], s.text);
  assert.ok(banned('Pick your repo.', EXEMPT).length > 0, 'repo outside the Connect step still fails');
  for (const t of [c.HERO_TITLE, c.HERO_SUB, c.CTA_INSTALL, c.STEPS_TITLE, ...c.STEPS.flatMap((s) => [s.title, s.text]), c.ACTIVITY_TITLE, c.ACTIVITY_MORE, c.ACTIVITY_INVITE_TITLE, c.ACTIVITY_INVITE_TEXT, c.EARN_TITLE, c.EARN_FOOT, BENCH_FOOTER_TAGLINE])
    assert.deepEqual(banned(t, EXEMPT), [], t);
  const card = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import. It plans a week.', chips: ['Went live', '+31 people'], summary: null, pinned: false, score: 62, commits: 12 };
  const page = pageWords(React.createElement(HomeView, { landing: { ...homeFixture, activity: [card] } }));
  // Names: the builder, the project, the coin, the programs' titles, the chains on the chips and logos (R14), the agents' marks.
  const agents = ['Grok Bot', 'Claude Code', 'Codex', 'Muse'];
  const exempt = ['Maya Chen', 'Recipe planner', '$RECIPE', 'EarnKit', ...homeFixture.tiles.map((t) => t.title), ...Object.values(CHAIN_LABEL), ...agents];
  assert.deepEqual(banned(page, exempt), [], page);
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
    renderToStaticMarkup(React.createElement(HomeView, { landing: { ...homeFixture, activity: [] } })),
    renderToStaticMarkup(React.createElement(HomeView, { landing: null })),
    renderToStaticMarkup(React.createElement(TermsPage)),
    renderToStaticMarkup(React.createElement(GuideView, { page: fullGuide })),
    renderToStaticMarkup(React.createElement(AddToAgent, { onClose: () => {} })),
    renderToStaticMarkup(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1' })),
    ...Object.values(toolDescriptions(true, true)), serverInstructions(),
  ];
  for (const p of pages) assert.doesNotMatch(p, bonusWords, p.slice(0, 200));
});
