import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HomeView from '../../app/HomeView';
import Header from '../../app/components/common/Header';
import Hero from '../../app/components/landing/Hero';
import Opportunities from '../../app/components/landing/Opportunities';
import { CTA_INSTALL, EARN_FOOT, EARN_TITLE, HERO_SUB, HERO_TITLE, NAV_INSTALL, STEPS_TITLE } from './site-copy';
import AddToAgent, { AGENTS } from '../../app/components/sections/AddToAgent';
import { type Landing } from './landing';
import { RESERVED_ROUTES } from './reserved-routes';
import { homeFixture } from './fixtures/landing';
import { withEnv } from './fixtures/find';
import { sql } from './db';
import { unsign } from './fixtures/page-words';

// The components are compiled with the classic JSX runtime here (as landing.test.ts).
(globalThis as { React?: typeof React }).React = React;

const FRONTEND = join(import.meta.dirname, '../..');
// v3.1 Task 7: Money draws currency signs in their own span; read them as one word.
const html = (el: React.ReactElement) => unsign(renderToStaticMarkup(el)).replace(/&#x27;/g, "'");
const page = (landing: Landing | null) => html(React.createElement(HomeView, { landing }));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const CARD = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import. It plans a week.', chips: ['Went live', '12 commits'], summary: 'Shipped the fridge import and a weekly plan.', pinned: false, confirmed: true, score: 62, commits: 12 };
const full: Landing = { ...homeFixture, activity: [CARD] };
const emptyBench: Landing = { ...homeFixture, tiles: [], open_text: null, open_more: null, open_chip: null, activity: [] };

test('(a) v3.1 Task 6: the sections in order: hero, From commit to capital, Activity, Earning opportunities', () => {
  const h = page(full);
  const at = [`>${HERO_TITLE}</h1>`, `>${STEPS_TITLE}</h2>`, '>Activity</h2>', `>${EARN_TITLE}</h2>`].map((s) => h.indexOf(s));
  assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), at.join(','));
  assert.doesNotMatch(h, /data-row=|>Backed by</, 'no leaderboard rows, no Backed by (S19) on the landing');
  assert.match(h, /href="\/leaderboard"[^>]*>See the leaderboard</);
  // No carousel; the Activity card carries the week's summary.
  assert.doesNotMatch(h, /data-shape="square"|snap-x|Previous programs|Next programs/);
  assert.ok(h.includes('Shipped the fridge import and a weekly plan.'));
});

test('(b) one install button on the landing (the hero CTA, "Add EarnKit to your agent"); the header keeps "Add to your agent"', () => {
  const count = (h: string, label: string) => (h.match(new RegExp(`<button[^>]*>${label}</button>`, 'g')) ?? []).length;
  assert.equal(count(html(React.createElement(Header)), NAV_INSTALL), 1);
  assert.equal(count(html(React.createElement(Hero, { chip: null })), CTA_INSTALL), 1);
  const hero = page(full).slice(0, page(full).indexOf('</section>'));
  assert.equal((hero.match(/<button/g) ?? []).length, 1, 'HomeView carries the hero button; the header is in the layout');
  // Three Activity cards: no invite card, so the hero's is the page's only install button above the footer.
  const three = page({ ...full, activity: [CARD, { ...CARD, id: 2 }, { ...CARD, id: 3 }] });
  assert.equal((three.split('<footer')[0].match(/<button/g) ?? []).length, 1);
  assert.ok(!page(full).includes('Watch the demo'));
});

test('(c) nothing of the old kit in the HTML: no video, no builder image, no uppercase, no stats line', () => {
  // v3.1 Task 5: the shared site footer (its CTA names the agent) is checked in v31-site-chrome.test.ts (the v3.1 card system); the install sheet's v3.1 look is pinned in (i).
  for (const h of [page(full), page(null), page(emptyBench)].map((x) => x.replace(/<footer[\s\S]*<\/footer>/, ''))) {
    // v3.1: the card system uses gradients (Landing board), so the old "no gradient" rule left with the v3 kit.
    assert.doesNotMatch(h, /<video|builder-blue|\buppercase\b|animate-marquee|rounded-\[24px\]/);
  }
  assert.ok(!page({ ...full, stats_line: '120 agents earning', won_line: 'Builders using EarnKit won $12,500' }).includes('agents earning'));
  assert.equal(HERO_TITLE, 'Get funded for shipping.');
  assert.equal(HERO_SUB, 'Ship. Get ranked. Get funded. All from your agent.');
});

test('(e) HomeView with landing = null and with no programs renders the hero and the steps, never throws', () => {
  const none = page(null);
  assert.ok(none.includes(HERO_TITLE) && none.includes(HERO_SUB) && none.includes(STEPS_TITLE));
  assert.doesNotMatch(none, /data-row=|data-featured=/);
  // A failed read claims nothing about the live parts.
  assert.ok(!none.includes(EARN_TITLE) && !none.includes(EARN_FOOT));
  const empty = page(emptyBench);
  assert.ok(empty.includes(HERO_TITLE));
  assert.ok(empty.includes(EARN_FOOT), 'no open program: the title and the foot line');
  assert.doesNotMatch(empty, /href="\/programs\//);
  assert.doesNotMatch(empty, /data-featured=|data-row=/);
  assert.ok(!empty.includes('>Activity</h2>'), 'no Activity section without cards');
});

test('(f) the hero: the chip (to #earn) only with money open, the one-line title, the sub line, the four agent marks', () => {
  const h = html(React.createElement(Hero, { chip: '$5K in grants open now' }));
  assert.match(h, /<a [^>]*href="#earn"[^>]*>.*\$5K in grants open now<\/span><\/a>/);
  // Review fix: the chip grows to two lines on a narrow phone instead of overflowing a fixed height: a 44px minimum,
  // vertical padding, a 22px radius (a pill on one line, a rounded card on two), full pill from md.
  const chip = h.match(/<a [^>]*href="#earn"[^>]*class="([^"]*)"/)?.[1] ?? h.match(/<a [^>]*class="([^"]*)"[^>]*href="#earn"/)?.[1] ?? '';
  for (const c of ['min-h-11', 'py-2', 'rounded-[22px]', 'max-w-full', 'md:min-h-9', 'md:rounded-full']) assert.ok(chip.split(' ').includes(c), c);
  for (const c of ['h-11', 'md:h-9']) assert.ok(!chip.split(' ').includes(c), c);
  assert.doesNotMatch(html(React.createElement(Hero, { chip: null })), /href="#earn"/);
  assert.match(h, /<h1 class="[^"]*whitespace-nowrap[^"]*">Get funded for shipping.<\/h1>/);
  assert.equal((h.match(/role="img"/g) ?? []).length, 4);
  assert.doesNotMatch(h, /\buppercase\b/);
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
  // Tabs: one SegTabs rail (page colour) that wraps (install fixes: never cut off, no scroll), the current tab a white pill, 44px tall.
  const tabs = [...h.matchAll(/<button[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*class="([^"]*)"/g)];
  assert.equal(tabs.length, AGENTS.length);
  const rail = h.match(/<div role="tablist"[^>]*class="([^"]*)"/)?.[1] ?? '';
  for (const c of ['flex-wrap', 'rounded-[26px]', 'bg-s-page']) assert.ok(rail.split(' ').includes(c), c);
  for (const c of ['flex-nowrap', 'overflow-x-auto']) assert.ok(!rail.split(' ').includes(c), c);
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

test('(j) Opportunities: one link per open program to its guide, with its title, big number, kind and when', () => {
  const tile = { ...homeFixture.tiles[0], when: 'Closes Nov 2', kind: 'hackathon' };
  const h = html(React.createElement(Opportunities, { programs: [tile] }));
  assert.equal((h.match(/<a /g) ?? []).length, 1);
  assert.match(h, /<a [^>]*href="\/programs\/colosseum-worlds-fair"/);
  // Named by its content (title, award), never an aria-label that hides it.
  assert.doesNotMatch(h, /<a [^>]*aria-label=/);
  const t = text(h);
  for (const s of ["Crypto World's Fair Hackathon", '$30K', 'hackathon', 'Closes Nov 2']) assert.ok(t.includes(s), s);
  // An upcoming program is not on the landing (HomeView picks landingPrograms).
  assert.doesNotMatch(page({ ...full, tiles: [{ ...tile, status: 'upcoming' as const }] }), /href="\/programs\/colosseum-worlds-fair"/);
});

test('(l) the landing cache key moved with the v3.1 Landing shape; v4.0 Task 11: it no longer reads EARNKIT_RAISING', async () => {
  const { landingCacheKey } = await import('../../app/lib/landing-cache');
  await withEnv({ EARNKIT_RAISING: undefined }, async () => assert.equal(landingCacheKey(), 'landing-v31-off'));
  await withEnv({ EARNKIT_RAISING: 'on' }, async () => assert.equal(landingCacheKey(), 'landing-v31-off'));
});

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
