import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HomeView from '../../app/HomeView';
import Header from '../../app/components/common/Header';
import Hero, { BENCH_HERO_SUBTITLE, BENCH_HERO_TITLE } from '../../app/components/sections/Hero';
import FeaturedCard from '../../app/components/sections/FeaturedCard';
import { BENCH_TOP_EMPTY, BENCH_TOP_TITLE, benchLine } from '../../app/components/sections/BenchTop';
import { FEED_SECTION_TITLE } from '../../app/components/sections/FeedRows';
import { PROGRAMS_EMPTY } from '../../app/components/sections/ProgramCards';
import ProgramRow from '../../app/components/sections/ProgramRow';
import AddToAgent from '../../app/components/sections/AddToAgent';
import { FEATURED_HANDLE_DEFAULT, featuredHandle, readLanding, type FeaturedData, type Landing } from './landing';
import { RESERVED_ROUTES } from './reserved-routes';
import { homeFixture } from './fixtures/landing';
import { person, withEnv } from './fixtures/find';
import { upsertWeekFacts } from './week-facts';
import { sql } from './db';

// The components are compiled with the classic JSX runtime here (as landing.test.ts).
(globalThis as { React?: typeof React }).React = React;

const FRONTEND = join(import.meta.dirname, '../..');
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");
const page = (landing: Landing | null) => html(React.createElement(HomeView, { landing }));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const ROW = { rank: 1, line: '#1 of 12 builders this week', points: 62, handle: 'maya_makes', name: 'Maya Chen', avatar: null, backing: null, chains: ['base' as const], project: 'Recipe planner', best: '31 people this week' };
const CARD = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import. It plans a week.', chips: ['Went live', '12 commits'], summary: 'Shipped the fridge import and a weekly plan.', pinned: false, confirmed: true };
const FEATURED: FeaturedData = {
  f: { handle: 'jenilt', name: 'Jenil Thakker', avatar: null, bench: 'Shipping 72 · #3 of 40 builders this week', project: 'EarnKit', streak: 6, raising: null },
  rank: '#3',
  log: [
    { week: '2026-10-12', summary: 'Shipped the weekly ship log and the leaderboard rows.' },
    { week: '2026-10-05', summary: 'Added the Money tab and the backing button.' },
  ],
  points: 72,
  earned: 1240,
};
const full: Landing = {
  ...homeFixture,
  featured: FEATURED,
  bench: { rows: Array.from({ length: 12 }, (_, i) => ({ ...ROW, handle: `b${i}`, rank: i + 1 })), count: 12, chips: ['base'], cards: [CARD], raising: false },
};
const emptyBench: Landing = { ...homeFixture, tiles: [], open_text: null, open_more: null, featured: null, bench: { rows: [], count: 0, chips: [], cards: [], raising: false } };

test('(a) the sections in order: hero, Leaderboard, Feed, Money open now, Backed by', () => {
  const h = page(full);
  const at = [BENCH_HERO_TITLE, `>${BENCH_TOP_TITLE}</h2>`, `>${FEED_SECTION_TITLE}</h2>`, '>Money open now</h2>', '>Backed by</h2>'].map((s) => h.indexOf(s));
  assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), at.join(','));
  assert.equal(BENCH_TOP_TITLE, 'Leaderboard');
  assert.equal(FEED_SECTION_TITLE, 'Feed');
  assert.equal((h.match(/data-row=/g) ?? []).length, 10, 'the top 10');
  assert.ok(h.includes('12 builders. Ranked by Shipping.'));
  assert.match(h, /href="\/leaderboard"[^>]*>See the full leaderboard</);
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
  for (const h of [page(full), page(null), page(emptyBench), html(React.createElement(AddToAgent, { onClose: () => {} }))]) {
    assert.doesNotMatch(h, /<video|builder-blue|\buppercase\b|gradient|animate-marquee|rounded-\[24px\]/);
  }
  assert.ok(!page({ ...full, stats_line: '120 agents earning', won_line: 'Builders using EarnKit won $12,500' }).includes('agents earning'));
  assert.equal(BENCH_HERO_SUBTITLE, 'Add EarnKit to the agent you already use. It writes your weekly ship log from real commits, ranks you against every builder, and routes you to grants, accelerators and backers.');
  assert.equal(BENCH_HERO_TITLE, 'Ship every week. Get funded.');
  assert.equal(benchLine(1), '1 builder. Ranked by Shipping.');
  assert.equal(benchLine(12), '12 builders. Ranked by Shipping.');
  assert.equal(BENCH_TOP_EMPTY, 'Nobody on the leaderboard yet. Add EarnKit to your agent and be first.');
});

test('(e) HomeView with landing = null and with an empty bench renders the hero and the empty lines, never throws', () => {
  const none = page(null);
  assert.ok(none.includes(BENCH_HERO_TITLE) && none.includes(BENCH_HERO_SUBTITLE) && none.includes('>Backed by<'));
  assert.doesNotMatch(none, /data-row=|data-featured=/);
  // A failed read claims nothing about the live parts.
  assert.ok(!none.includes(BENCH_TOP_EMPTY) && !none.includes(PROGRAMS_EMPTY));
  const empty = page(emptyBench);
  assert.ok(empty.includes(BENCH_HERO_TITLE));
  assert.ok(empty.includes(BENCH_TOP_EMPTY), 'the empty leaderboard line');
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
  // The landing shows it only with data.
  assert.match(page(full), /data-featured=""/);
});

test('(g) the featured handle: LANDING_FEATURED_HANDLE, default jenilt', async () => {
  assert.equal(FEATURED_HANDLE_DEFAULT, 'jenilt');
  await withEnv({ LANDING_FEATURED_HANDLE: undefined }, async () => assert.equal(featuredHandle(), 'jenilt'));
  await withEnv({ LANDING_FEATURED_HANDLE: 'maya_makes' }, async () => assert.equal(featuredHandle(), 'maya_makes'));
  await withEnv({ LANDING_FEATURED_HANDLE: '  ' }, async () => assert.equal(featuredHandle(), 'jenilt'));
});

test('(h) the deletions: the video, the graphics folder, the final CTA image and favicon-16x16 (and its reserved name)', () => {
  for (const f of ['public/videos/earnkit-launch.mp4', 'public/images/graphics', 'public/images/landing/FINAL_CTA.png', 'public/favicon-16x16.png', 'app/components/sections/CarouselRow.tsx', 'app/components/sections/UpdateCarousel.tsx', 'app/components/sections/ProgramCard.tsx'])
    assert.ok(!existsSync(join(FRONTEND, f)), f);
  assert.ok(!RESERVED_ROUTES.has('favicon-16x16'));
  assert.ok(RESERVED_ROUTES.has('favicon-32x32'));
});

test('(i) the install modal: a flat sheet, a bottom sheet on phones, hairline tabs, 44px targets', () => {
  const h = html(React.createElement(AddToAgent, { onClose: () => {} }));
  const panel = h.match(/<div class="([^"]*)"[^>]*><button[^>]*aria-label="Close"/)?.[1] ?? '';
  for (const c of ['fixed', 'inset-x-0', 'bottom-0', 'bg-ek-surface']) assert.match(panel, new RegExp(`(^| )${c}( |$)`), c);
  assert.doesNotMatch(panel, /rounded|gradient|shadow/);
  // Tabs: a hairline row, the active tab marked by a bottom line, 44px tall.
  const tabs = [...h.matchAll(/<button[^>]*role="tab"[^>]*class="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(tabs.length, 6);
  for (const c of tabs) assert.match(c, /min-h-11/);
  assert.doesNotMatch(h, /rounded-full pl-3 pr-4/, 'no pill tabs');
  // The link's Copy is the primary button.
  assert.match(h, /<button[^>]*aria-label="Copy the EarnKit link"[^>]*class="[^"]*bg-ek-brand/);
  // Review round 1: the backdrop is a token that carries alpha (ek-glass). A `/NN` opacity modifier on a var() token
  // emits no CSS at all (tailwind.config.ts has no <alpha-value>), so none may appear anywhere under app/.
  const overlay = h.match(/<div role="dialog"[^>]*class="([^"]*)"/)?.[1] ?? '';
  assert.match(overlay, /(^| )bg-ek-glass( |$)/);
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
  for (const f of files(join(FRONTEND, 'app'))) assert.doesNotMatch(readFileSync(f, 'utf8'), /\b(?:bg|text|border|ring|from|to)-ek-[a-z-]+\/\d/, f);
});

test('(j) ProgramRow: one link per row with the title, the award and the chips in order', () => {
  const tile = { ...homeFixture.tiles[0], days_left: 'not open yet', in_person: true, difficulty: 'Hard' };
  const h = html(React.createElement(ProgramRow, { tile }));
  assert.equal((h.match(/<a /g) ?? []).length, 1);
  assert.match(h, /<a [^>]*href="\/programs\/colosseum-worlds-fair"/);
  assert.match(h, /<a [^>]*aria-label="Crypto World's Fair Hackathon, \$840K in prizes"/);
  assert.match(h, /<h3[^>]*>Crypto World's Fair Hackathon<\/h3>/);
  const chips = [...h.matchAll(/<span class="ek-chip[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['Not open yet', 'In person', 'Hard']);
  assert.ok(text(h).includes('$840K in prizes') && text(h).includes('up to $30,000 per winner'));
  assert.doesNotMatch(h, /rounded-2xl|p-6|aspect-/);
});

// ---- (d) readLanding.featured against the database.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const now = new Date('2026-10-20T12:00:00Z');
const RUN = `${process.pid}${Date.now().toString(36)}`.slice(-10);

/** A listed, ranked, claimed builder with three summarised weeks on a public repo. */
async function featuredPerson(handle: string, o: { hidden?: boolean; held?: boolean; ranked?: boolean } = {}): Promise<number> {
  const key = `feat${RUN}/site`;
  const id = await person({ projects: [{ key, name: 'EarnKit', confirmed: true, streak: 3, weeks_shipping: 3 }], score: 72, ranked: o.ranked ?? true, main: key, claimed: handle });
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${id} AND kind = 'repo'`;
  await sql()`UPDATE builder_profiles SET hidden = ${o.hidden ?? false}, held = ${o.held ?? false}, x_name = 'Jenil Thakker' WHERE builder_id = ${id}`;
  for (const [i, monday] of ['2026-10-12', '2026-10-05', '2026-09-28'].entries())
    await upsertWeekFacts(id, key, monday, { shipped_code: { n: 12 - i }, streak: { w: 3 - i }, approved: true }, [`Week ${i}`], `Shipped week ${i} of the site.`);
  return id;
}

test('(d) featured: a listed ranked builder with the log; null when hidden, held, unranked or missing', dbTest, async () => {
  const handle = `ft${RUN}`;
  await featuredPerson(handle);
  const on = await withEnv({ LANDING_FEATURED_HANDLE: handle }, () => readLanding(now));
  assert.ok(on.featured, 'featured');
  assert.equal(on.featured.f.handle, handle);
  assert.equal(on.featured.f.name, 'Jenil Thakker');
  assert.match(on.featured.f.bench ?? '', /^Shipping 72 · #\d/);
  assert.equal(on.featured.points, 72);
  assert.match(on.featured.rank ?? '', /^#\d/);
  assert.deepEqual(on.featured.log.map((l) => l.week), ['2026-10-12', '2026-10-05']);
  assert.equal(on.featured.log[0].summary, 'Shipped week 0 of the site.');
  assert.equal(on.featured.earned, null, 'nothing earned: null, never 0');
  assert.deepEqual(JSON.parse(JSON.stringify(on)), on, 'plain JSON');
  // The feed rows are the last finished week's, at most 6.
  assert.ok(on.bench && on.bench.cards.length <= 6);
  assert.ok(on.bench!.cards.every((c) => c.week === on.bench!.cards[0].week), 'one week');

  const hidden = `fh${RUN}`;
  await featuredPerson(hidden, { hidden: true });
  assert.equal((await withEnv({ LANDING_FEATURED_HANDLE: hidden }, () => readLanding(now))).featured, null, 'hidden');
  const held = `fd${RUN}`;
  await featuredPerson(held, { held: true });
  assert.equal((await withEnv({ LANDING_FEATURED_HANDLE: held }, () => readLanding(now))).featured, null, 'held');
  const unranked = `fu${RUN}`;
  await featuredPerson(unranked, { ranked: false });
  assert.equal((await withEnv({ LANDING_FEATURED_HANDLE: unranked }, () => readLanding(now))).featured, null, 'unranked');
  assert.equal((await withEnv({ LANDING_FEATURED_HANDLE: `nobody${RUN}` }, () => readLanding(now))).featured, null, 'missing');
  assert.equal((await withEnv({ LANDING_FEATURED_HANDLE: 'not a handle!' }, () => readLanding(now))).featured, null, 'malformed');
});

test('(l) review round 1: a failing featured read is logged and leaves featured null; the bench and the tiles still arrive', dbTest, async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const l = await readLanding(now, { featured: () => Promise.reject(new Error('featured boom')) });
  assert.equal(l.featured, null);
  assert.ok(l.bench && Array.isArray(l.bench.rows) && Array.isArray(l.tiles));
  assert.ok(logged.mock.calls.some((c) => c.arguments[0] === '[landing] featured'), 'logged');
  // The cache key names the featured handle, so a changed handle never serves the old card.
  const { landingCacheKey } = await import('../../app/lib/landing-cache');
  await withEnv({ LANDING_FEATURED_HANDLE: 'someone', EARNKIT_RAISING: undefined }, async () => assert.match(landingCacheKey(), /^landing-v3-someone/));
});

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
