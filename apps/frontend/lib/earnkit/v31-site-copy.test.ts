import { test } from 'node:test';
import assert from 'node:assert/strict';
import { committedProgram } from './fixtures/program-file';
import { SITE } from './site-theme';
import * as copy from './site-copy';
import {
  agoWords, compactCount, compactUsd, firstName, heroChipText, logoColor, monthDay, monthYear, nextUpdateLine,
  programKind, scoreBand, standingTier, streakNote, weekLine,
} from './site-copy';

/** v3.1 site Task 2: the page copy (verbatim) and the pure formatters every site page shares. */

test('(a) scoreBand: 70+, 40 to 69, under 40', () => {
  assert.deepEqual([100, 70, 69, 40, 39, 0].map(scoreBand), ['good', 'good', 'mid', 'mid', 'low', 'low']);
});

test('(b) compactUsd and compactCount', () => {
  assert.deepEqual([750, 999, 1000, 5000, 105_000, 400_000, 1_000_000, 1_250_000, 999_999].map(compactUsd), ['$750', '$999', '$1K', '$5K', '$105K', '$400K', '$1M', '$1.3M', '$1M']);
  assert.deepEqual([0, 999, 1000, 1200, 12_000, 1_200_000].map(compactCount), ['0', '999', '1K', '1.2K', '12K', '1.2M']);
});

test('(c) agoWords at the edges of every range', () => {
  const now = Date.UTC(2026, 9, 21, 12);
  const ago = (ms: number) => agoWords(new Date(now - ms), new Date(now));
  assert.equal(ago(0), 'just now');
  assert.equal(ago(59e3), 'just now');
  assert.equal(ago(60e3), '1m ago');
  assert.equal(ago(59 * 60e3 + 59e3), '59m ago');
  assert.equal(ago(3600e3), '1h ago');
  assert.equal(ago(2 * 3600e3), '2h ago');
  assert.equal(ago(23 * 3600e3 + 59 * 60e3), '23h ago');
  assert.equal(ago(24 * 3600e3), 'yesterday');
  assert.equal(ago(47 * 3600e3 + 59 * 60e3), 'yesterday');
  assert.equal(ago(48 * 3600e3), '2 days ago');
  assert.equal(ago(13 * 86400e3), '13 days ago');
  assert.equal(ago(14 * 86400e3), 'on Oct 7');
  assert.equal(agoWords(new Date('2026-10-01T09:00:00Z'), new Date('2026-10-30T09:00:00Z')), 'on Oct 1');
});

test('(d) firstName, standingTier, logoColor', () => {
  assert.equal(firstName('Maya Chen', 'mayac'), 'Maya');
  assert.equal(firstName('  Ari ', 'ari'), 'Ari');
  assert.equal(firstName('@mayac', 'mayac'), 'mayac');
  assert.equal(firstName('', 'mayac'), 'mayac');
  assert.deepEqual([1, 5, 5.1, 10, 10.1, 25, 25.1].map(standingTier), ['gold', 'gold', 'silver', 'silver', 'bronze', 'bronze', null]);
  const palette = ['#FF6A1F', '#7C3AED', '#16A34A', '#2D6BE0', '#DB2777', '#0891B2', '#CA8A04'];
  assert.deepEqual([SITE.logoOrange, SITE.logoViolet, SITE.logoGreen, SITE.logoBlue, SITE.logoPink, SITE.logoCyan, SITE.logoAmber], palette);
  for (const n of ['Relay', 'Pollen', 'Tipjar', 'Ledgerly', '', 'x']) {
    assert.ok(palette.includes(logoColor(n)), n);
    assert.equal(logoColor(n), logoColor(n), 'stable');
  }
  assert.ok(new Set(['Relay', 'Pollen', 'Tipjar', 'Ledgerly', 'Quill', 'Orbit', 'Mintbox', 'Gridline'].map(logoColor)).size >= 3, 'spreads');
});

test('(e) metal pill, avatar and logo tokens carry the board values', () => {
  assert.deepEqual([SITE.goldTop, SITE.goldMid, SITE.goldBottom, SITE.goldInk], ['#FFE8A3', '#F2C14E', '#C98A1E', '#3A2500']);
  assert.deepEqual([SITE.silverTop, SITE.silverMid, SITE.silverBottom, SITE.silverInk], ['#FFFFFF', '#DDE3EE', '#A7B1C4', '#1E2533']);
  assert.deepEqual([SITE.bronzeTop, SITE.bronzeMid, SITE.bronzeBottom, SITE.bronzeInk], ['#FFD7B5', '#E0985E', '#A9602C', '#3A1A05']);
  assert.deepEqual([SITE.avatarTop, SITE.avatarBottom], ['#3A4366', '#1C2238']);
});

test('(f) heroChipText, streakNote, weekLine, monthDay, monthYear', () => {
  assert.equal(heroChipText(105_000, false), '$105K in grants open now');
  assert.equal(heroChipText(105_000, true), '$105K in grants and prizes open now');
  assert.equal(heroChipText(0, true), null);
  assert.equal(streakNote(1, 1), 'Week 2 starts Monday');
  assert.equal(streakNote(3, 9), 'Code in 9 of 12 weeks');
  assert.equal(streakNote(0, 4), 'Code in 4 of 12 weeks');
  assert.deepEqual([0, 1, 14].map(weekLine), ['Ship by Sunday', 'This week: 1 commit', 'This week: 14 commits']);
  assert.equal(monthDay(new Date('2026-10-12T23:59:00Z')), 'Oct 12');
  assert.equal(monthYear(new Date('2026-10-12T00:00:00Z')), 'Oct 2026');
});

test('(g) nextUpdateLine: the Monday after the week now is in, UTC', () => {
  assert.equal(nextUpdateLine(new Date('2026-10-21T12:00:00Z')), 'Next update posts Monday, Oct 26');
  assert.equal(nextUpdateLine(new Date('2026-10-26T01:00:00Z')), 'Next update posts Monday, Nov 2');
  assert.equal(nextUpdateLine(new Date('2026-10-25T23:59:00Z')), 'Next update posts Monday, Oct 26');
});

test('(h) programKind on the four committed program files', () => {
  const kind = (f: string) => programKind(committedProgram(f));
  assert.equal(kind('base-builder-grants'), 'grant');
  assert.equal(kind('alliance-all19'), 'investment');
  assert.equal(kind('a16z-speedrun'), 'investment');
  assert.equal(kind('circle-developer-grants'), 'grant, in USDC');
  assert.equal(programKind({}), 'grant');
});

test('(i) copy constants are exact', () => {
  assert.equal(copy.HERO_TITLE, 'Get funded for shipping.');
  assert.equal(copy.HERO_SUB, 'Ship. Get ranked. Get funded. All from your agent.');
  assert.equal(copy.CTA_INSTALL, 'Add EarnKit to your agent');
  assert.equal(copy.NAV_INSTALL, 'Add to your agent');
  assert.equal(copy.STEPS_TITLE, 'From commit to capital');
  assert.deepEqual(copy.STEPS, [
    { title: 'Connect', text: "Add EarnKit to your agent, sign in with X and pick the repo you're building." },
    { title: 'Ship', text: 'Every day we read your commits and score how steadily you ship, out of 100.' },
    { title: 'Get funded', text: 'We match your repo to open grants. Your agent drafts the application for you to send.', backing: 'People can back you by buying your coin.' },
  ]);
  assert.equal(copy.SCORE_UNIT, 'Shipping');
  assert.equal(copy.ROLLING, 'Rolling, apply anytime');
  assert.equal(copy.BENCH_VERIFIED, 'From GitHub commits, read daily. Not self-reported.');
  assert.equal(copy.SCORE_SOURCE, 'From GitHub commits, not self-reported.');
  assert.equal(copy.SCORE_HOW, "How it's scored");
  assert.equal(copy.SCORE_HOW_HREF, '/docs#score');
  assert.equal(copy.streakRun(5), '5-week streak');
  assert.equal(copy.streakRun(1), '1-week streak');
  assert.equal(copy.ACTIVITY_TITLE, 'Activity');
  assert.equal(copy.ACTIVITY_MORE, 'See the leaderboard');
  assert.equal(copy.ACTIVITY_INVITE_TITLE, 'Your week goes here.');
  assert.equal(copy.ACTIVITY_INVITE_TEXT, 'Add EarnKit and your first update posts on Monday.');
  assert.equal(copy.EARN_TITLE, 'Earning opportunities');
  assert.equal(copy.EARN_FOOT, 'Your agent finds the fit and drafts the application.');
  assert.equal(copy.FOOT_CTA, 'Your next week starts now.');
  assert.equal(copy.ART_CREDIT, 'Art: C.W. Eckersberg, 1815 · G.P. Panini, c. 1734');
  assert.equal(copy.FOOT_GET_PAGE, 'Get your page');
  assert.equal(copy.SCORE_TITLE, 'Shipping score');
  assert.equal(copy.scoreNote('Maya'), 'How often Maya ships, out of 100, over 12 weeks.');
  assert.equal(copy.SCORE_PENDING, 'Shows once the project is on the leaderboard.');
  assert.equal(copy.STREAK_TITLE, 'Streak');
  assert.equal(copy.PROFILE_ACTIVITY, 'Activity');
  assert.equal(copy.shippedAgo('2h ago'), 'Shipped 2h ago');
  assert.equal(copy.HIGHLIGHTS_TITLE, 'Highlights');
  assert.equal(copy.backOn('Maya'), 'Back Maya on Base');
  assert.equal(copy.backLabel('Maya'), 'Back Maya');
  assert.equal(copy.keepsLine('Maya'), 'Maya keeps 40% of fees');
  assert.equal(copy.feesBy('Maya'), 'earned by Maya');
  assert.equal(copy.BACKERS, 'backers');
  assert.equal(copy.leaderboardLine(1), '1 builder, ranked by how often they ship');
  assert.equal(copy.leaderboardLine(1234), '1,234 builders, ranked by how often they ship');
  assert.deepEqual(copy.FILTERS, { all: 'All', base: 'Base', backed: 'Backed' });
  assert.equal(copy.BACKED_TAG, 'Backed');
  assert.deepEqual(copy.FEED_STATS, { builders: 'Builders shipped', commits: 'Commits', live: 'Went live', applications: 'Applications sent' });
  assert.equal(copy.NOT_FOUND_BIG, '404');
  assert.equal(copy.NOT_FOUND_TEXT, 'Nothing shipped here.');
  assert.equal(copy.NOT_FOUND_HOME, 'Back home');
});

test('(copy) every exported string and every function output has no banned punctuation, words or shouting', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  const samples: Record<string, unknown[]> = {
    compactUsd: [750, 5000, 1_250_000], compactCount: [999, 12_000], agoWords: [now], firstName: ['Maya Chen'], logoColor: ['Relay'],
    heroChipText: [105_000], programKind: [{ investment: true }], streakNote: [1, 3], weekLine: [0, 1, 14], nextUpdateLine: [now],
    monthDay: [now], monthYear: [now], scoreNote: ['Maya'], shippedAgo: ['2h ago'], backOn: ['Maya'], backLabel: ['Maya'],
    keepsLine: ['Maya'], feesBy: ['Maya'], leaderboardLine: [0, 1, 1234], streakRun: [1, 5],
  };
  for (const [name, v] of Object.entries(copy)) {
    if (typeof v !== 'function') { walk(v); continue; }
    for (const s of samples[name] ?? []) {
      const args = name === 'agoWords' ? [new Date(now.getTime() - 7200e3), now] : name === 'firstName' ? [s, 'mayac'] : name === 'heroChipText' ? [s, true] : name === 'streakNote' ? [s, 9] : [s];
      walk((v as (...a: unknown[]) => unknown)(...args));
    }
  }
  walk(heroChipText(105_000, false));
  assert.ok(out.length > 60, `swept ${out.length} strings`);
  const rules: [string, RegExp][] = [
    ['em dash', /—/], ['en dash', /–/], ['emoji', /\p{Extended_Pictographic}/u],
    ['all-caps word', /\b[A-Z]{3,}\b(?<!\bUSDC\b)/], ['points', /\bpoints\b/i], ['community round', /community round/i],
    ['builders then this week', /builders[\s\S]{0,20}this week/i],
  ];
  for (const s of out) for (const [label, r] of rules) assert.doesNotMatch(s, r, `${label} in "${s}"`);
});
