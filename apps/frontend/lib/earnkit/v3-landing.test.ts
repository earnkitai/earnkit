import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HomeView from '../../app/HomeView';
import Header from '../../app/components/common/Header';
import Hero, { BENCH_HERO_SUBTITLE, BENCH_HERO_TITLE } from '../../app/components/sections/Hero';
import FeaturedCard, { type FeaturedData } from '../../app/components/sections/FeaturedCard';
import { FEED_SECTION_TITLE } from '../../app/components/sections/FeedRows';
import { PROGRAMS_EMPTY } from '../../app/components/sections/ProgramCards';
import ProgramRow from '../../app/components/sections/ProgramRow';
import AddToAgent from '../../app/components/sections/AddToAgent';
import { type Landing } from './landing';
import { RESERVED_ROUTES } from './reserved-routes';
import { homeFixture } from './fixtures/landing';
import { withEnv } from './fixtures/find';
import { sql } from './db';

// The components are compiled with the classic JSX runtime here (as landing.test.ts).
(globalThis as { React?: typeof React }).React = React;

const FRONTEND = join(import.meta.dirname, '../..');
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");
const page = (landing: Landing | null) => html(React.createElement(HomeView, { landing }));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const CARD = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import. It plans a week.', chips: ['Went live', '12 commits'], summary: 'Shipped the fridge import and a weekly plan.', pinned: false, confirmed: true, score: 62, commits: 12 };
const FEATURED: FeaturedData = {
  f: { handle: 'jenilt', name: 'Jenil Thakker', avatar: null, bench: 'Shipping 72 · #3 of 40 builders', project: 'EarnKit', streak: 6, raising: null, score: 72, earned: null },
  rank: '#3',
  log: [
    { week: '2026-10-12', summary: 'Shipped the weekly ship log and the leaderboard rows.' },
    { week: '2026-10-05', summary: 'Added the Money tab and the backing button.' },
  ],
  points: 72,
  earned: 1240,
};
const full: Landing = { ...homeFixture, activity: [CARD] };
const emptyBench: Landing = { ...homeFixture, tiles: [], open_text: null, open_more: null, open_chip: null, activity: [] };

test('(a) the sections in order: hero, Feed (Activity), Money open now, Backed by', () => {
  const h = page(full);
  const at = [BENCH_HERO_TITLE, `>${FEED_SECTION_TITLE}</h2>`, '>Money open now</h2>', '>Backed by</h2>'].map((s) => h.indexOf(s));
  assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), at.join(','));
  assert.equal(FEED_SECTION_TITLE, 'Feed');
  assert.doesNotMatch(h, /data-row=/, 'no leaderboard rows on the landing');
  assert.match(h, /href="\/feed"[^>]*>See all</);
  // The feed rows are the long card (Task 3 restyles it), never the square one; no carousel.
  assert.match(h, /data-shape="long"/);
  assert.doesNotMatch(h, /data-shape="square"|snap-x|Previous programs|Next programs/);
  assert.ok(h.includes('Shipped the fridge import and a weekly plan.'));
});

test('(b) exactly two "Add to your agent" buttons: one in the header, one in the hero', () => {
  const count = (h: string) => (h.match(/<button[^>]*>Add to your agent<\/button>/g) ?? []).length;
  assert.equal(count(html(React.createElement(Header))), 1);
  assert.equal(count(html(React.createElement(Hero, { featured: null }))), 1);
  assert.equal(count(page(full)), 1, 'HomeView carries the hero button; the header is in the layout');
  assert.ok(!page(full).includes('Watch the demo'));
});

test('(c) nothing of the old kit in the HTML: no video, no builder image, no uppercase, no gradient, no stats line', () => {
  // v3.1 Task 5: the shared site footer (its CTA names the agent) is checked in v31-site-chrome.test.ts (the v3.1 card system); the install sheet's v3.1 look is pinned in (i).
  for (const h of [page(full), page(null), page(emptyBench)].map((x) => x.replace(/<footer[\s\S]*<\/footer>/, ''))) {
    assert.doesNotMatch(h, /<video|builder-blue|\buppercase\b|gradient|animate-marquee|rounded-\[24px\]/);
  }
  assert.ok(!page({ ...full, stats_line: '120 agents earning', won_line: 'Builders using EarnKit won $12,500' }).includes('agents earning'));
  assert.equal(BENCH_HERO_SUBTITLE, 'Add EarnKit to the agent you already use. It writes your weekly ship log from real commits, ranks you against every builder, and routes you to grants, accelerators and backers.');
  assert.equal(BENCH_HERO_TITLE, 'Ship every week. Get funded.');
});

test('(e) HomeView with landing = null and with an empty bench renders the hero and the empty lines, never throws', () => {
  const none = page(null);
  assert.ok(none.includes(BENCH_HERO_TITLE) && none.includes(BENCH_HERO_SUBTITLE) && none.includes('>Backed by<'));
  assert.doesNotMatch(none, /data-row=|data-featured=/);
  // A failed read claims nothing about the live parts.
  assert.ok(!none.includes(PROGRAMS_EMPTY));
  const empty = page(emptyBench);
  assert.ok(empty.includes(BENCH_HERO_TITLE));
  assert.ok(empty.includes(PROGRAMS_EMPTY), 'the empty money line');
  assert.equal(PROGRAMS_EMPTY, 'No programs are open right now.');
  assert.doesNotMatch(empty, /data-featured=|data-row=|See the full leaderboard/);
  assert.ok(!empty.includes(`>${FEED_SECTION_TITLE}</h2>`), 'no feed section without rows');
});

test('(f) FeaturedCard: the handle and name, the three numbers, the streak, two log lines, one link to the page', () => {
  const h = html(React.createElement(FeaturedCard, FEATURED));
  const t = text(h);
  assert.match(h, /data-featured=""/);
  assert.ok(t.includes('Jenil Thakker') && t.includes('@jenilt'));
  for (const s of ['72', 'Shipping', '#3', 'Rank', '$1,240', 'Earned', '6 weeks in a row', 'Shipped the weekly ship log', 'Added the Money tab']) assert.ok(t.includes(s), s);
  assert.equal((h.match(/<a /g) ?? []).length, 1, 'one link');
  assert.match(h, /<a [^>]*href="\/jenilt"/);
  // Final review: the link's name is its content (the name first); no aria-label hiding it.
  assert.doesNotMatch(h, /<a [^>]*aria-label=/);
  assert.match(h, /<ul class="grid[^"]*grid-cols-3/);
  // Review round 1: nothing earned (null) means no Earned number, never "$0", and a two-column grid.
  const twoHtml = html(React.createElement(FeaturedCard, { ...FEATURED, earned: null }));
  const two = text(twoHtml);
  assert.ok(!two.includes('Earned') && !two.includes('$'));
  assert.match(twoHtml, /<ul class="grid[^"]*grid-cols-2/);
  assert.doesNotMatch(twoHtml, /grid-cols-3/);
  // The rank is structured data ("Top 4%" the same way); no rank, one column.
  const top = text(html(React.createElement(FeaturedCard, { ...FEATURED, rank: 'Top 4%' })));
  assert.ok(top.includes('Top 4%') && top.includes('Rank'));
  assert.match(html(React.createElement(FeaturedCard, { ...FEATURED, rank: null, earned: null })), /grid-cols-1/);
  assert.doesNotMatch(h, /uppercase|gradient|shadow/);
});

test('(h) the deletions: the video, the graphics folder, the final CTA image and favicon-16x16 (and its reserved name)', () => {
  for (const f of ['public/videos/earnkit-launch.mp4', 'public/images/graphics', 'public/images/landing/FINAL_CTA.png', 'public/favicon-16x16.png', 'app/components/sections/CarouselRow.tsx', 'app/components/sections/UpdateCarousel.tsx', 'app/components/sections/ProgramCard.tsx'])
    assert.ok(!existsSync(join(FRONTEND, f)), f);
  assert.ok(!RESERVED_ROUTES.has('favicon-16x16'));
  assert.ok(RESERVED_ROUTES.has('favicon-32x32'));
});

test('(i) the install modal: v3.1 SITE sheet (panel, 32px radius, scrim), a bottom sheet on phones, SegTabs pill tabs, 44px targets', () => {
  const h = html(React.createElement(AddToAgent, { onClose: () => {} }));
  const panel = h.match(/<div class="([^"]*)"[^>]*><button[^>]*aria-label="Close"/)?.[1] ?? '';
  for (const c of ['fixed', 'inset-x-0', 'bottom-0', 'bg-s-panel', 'rounded-t-[32px]', 'sm:rounded-[32px]']) assert.ok(panel.split(' ').includes(c), c);
  assert.doesNotMatch(panel, /gradient|shadow/);
  // Tabs: one SegTabs rail (page colour) that scrolls on a phone, the current tab a white pill, 44px tall.
  const tabs = [...h.matchAll(/<button[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*class="([^"]*)"/g)];
  assert.equal(tabs.length, 6);
  const rail = h.match(/<div role="tablist"[^>]*class="([^"]*)"/)?.[1] ?? '';
  assert.doesNotMatch(rail, /(^| )flex-wrap( |$)/, rail);
  for (const c of ['flex-nowrap', 'overflow-x-auto', 'no-scrollbar', 'rounded-full', 'bg-s-page']) assert.ok(rail.split(' ').includes(c), c);
  for (const [, on, c] of tabs) {
    assert.match(c, /(^| )min-h-11( |$)/);
    assert.match(c, /(^| )rounded-full( |$)/);
    assert.equal(c.split(' ').includes('bg-s-light'), on === 'true');
  }
  // Code blocks: the page colour, rounded 22px.
  assert.match(h, /<div class="[^"]*\brounded-\[22px\] bg-s-page\b/);
  // The link's Copy is the primary (blue) button.
  assert.match(h, /<button[^>]*aria-label="Copy the EarnKit link"[^>]*class="[^"]*bg-s-blue/);
  // The backdrop is the scrim token (it carries its own alpha). A `/NN` opacity modifier on a var() token
  // emits no CSS at all (tailwind.config.ts has no <alpha-value>), so none may appear anywhere under app/.
  const overlay = h.match(/<div role="dialog"[^>]*class="([^"]*)"/)?.[1] ?? '';
  assert.match(overlay, /(^| )bg-s-scrim( |$)/);
  assert.doesNotMatch(h, /\bek-(?:page|surface|glass|brand|line|muted|text|body|accent|chip)\b/, 'no v3 tokens left in the sheet');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
  for (const f of files(join(FRONTEND, 'app'))) assert.doesNotMatch(readFileSync(f, 'utf8'), /\b(?:bg|text|border|divide|fill|stroke|outline|shadow|ring|from|via|to)-(?:ek|s)-[a-z0-9-]+\/\d/, f);
});

test('(j) ProgramRow: one link per row with the title, the award and the chips in order', () => {
  const tile = { ...homeFixture.tiles[0], days_left: 'not open yet', in_person: true, difficulty: 'Hard' };
  const h = html(React.createElement(ProgramRow, { tile }));
  assert.equal((h.match(/<a /g) ?? []).length, 1);
  assert.match(h, /<a [^>]*href="\/programs\/colosseum-worlds-fair"/);
  // Final review: named by its title and award (aria-labelledby), never an aria-label that hides the row's content.
  assert.doesNotMatch(h, /<a [^>]*aria-label=/);
  assert.match(h, /<a [^>]*aria-labelledby="program-colosseum-worlds-fair-title program-colosseum-worlds-fair-prize"/);
  assert.match(h, /<h3 id="program-colosseum-worlds-fair-title"[^>]*>Crypto World's Fair Hackathon<\/h3>/);
  assert.match(h, /<p id="program-colosseum-worlds-fair-prize"[^>]*>\$840K in prizes<\/p>/);
  const chips = [...h.matchAll(/<span class="ek-chip[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['Not open yet', 'In person', 'Hard']);
  assert.ok(text(h).includes('$840K in prizes') && text(h).includes('up to $30,000 per winner'));
  assert.doesNotMatch(h, /rounded-2xl|p-6|aspect-/);
});

test('(l) the landing cache key moved with the v3.1 Landing shape and names the raising flag only', async () => {
  const { landingCacheKey } = await import('../../app/lib/landing-cache');
  await withEnv({ EARNKIT_RAISING: undefined }, async () => assert.equal(landingCacheKey(), 'landing-v31-off'));
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => assert.equal(landingCacheKey(), 'landing-v31-raising'));
});

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
