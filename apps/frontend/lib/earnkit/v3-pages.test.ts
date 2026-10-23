import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.EARNKIT_RAISING = 'on';

import BenchView from '../../app/leaderboard/BenchView';
import BenchRowItem from '../../app/leaderboard/BenchRowItem';
import FeedView, { FEED_LINE, FEED_TITLE } from '../../app/feed/FeedView';
import HomeView from '../../app/HomeView';
import { EARN_TITLE, leaderboardLine } from './site-copy';
import ProgramLogo from '../../app/components/sections/ProgramLogo';
import GuideView, { ANY_CHAIN } from '../../app/programs/[id]/GuideView';
import AskAgent from '../../app/programs/[id]/AskAgent';
import NotFound, { metadata as notFoundMeta } from '../../app/not-found';
import { NOT_FOUND_BIG, NOT_FOUND_HOME, NOT_FOUND_METADATA, NOT_FOUND_TEXT, NOT_FOUND_TITLE } from './site-copy';
import { rankLine, rankSplit, scoreLine } from './rank';
import { shareText } from './weekly-moment';
import { badgeValue } from './badge';
import { homeFixture } from './fixtures/landing';
import { closedGuide, emptyGuide, fullGuide, upcomingGuide } from './fixtures/guide';
import type { BenchRow } from './bench-data';

/**
 * v3 Stage 3 Task 4 (spec 5.2, 5.6): the leaderboard, the feed, the programs page and the guide as rows in the
 * flat system; "of N builders" everywhere (never "this week" after "builders").
 */
(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROW: BenchRow = { rank: 3, line: '#3 of 40 builders', points: 72, handle: 'maya_makes', name: 'Maya Chen', avatar: null, backing: null, chains: ['base'], project: 'Recipe planner', best: '31 people this week', streak: 0 };

// ---- (a) the leaderboard ------------------------------------------------------------------------

test('(a) the leaderboard (v3.1 Task 8): "Leaderboard", leaderboardLine, a podium then rows with data-rank and data-points, no "Shipping points", no "this week"', () => {
  const top = [1, 2, 3].map((rank) => ({ ...ROW, rank, line: `#${rank} of 120 builders`, handle: `top_${rank}`, name: `Top ${rank}` }));
  const h = html(React.createElement(BenchView, { rows: [...top, { ...ROW, rank: 4, handle: 'devon_ships', name: 'Devon Park', points: 60 }, { ...ROW, rank: 100, line: '#100 of 120 builders', handle: 'yu_mk', name: 'Yu Makoto', points: 12 }], count: 120, chips: ['base', 'arc'], filter: { chain: null, weekly: false }, page: 1 }));
  assert.match(h, /<h1 class="ek-serif[^"]*">Leaderboard<\/h1>/);
  assert.ok(h.includes(leaderboardLine(120)) && leaderboardLine(40) === '40 builders, ranked by how often they ship');
  assert.doesNotMatch(h, /Shipping points/);
  assert.doesNotMatch(text(h), /builders?.{0,20}this week/, 'no "this week" after the rank');
  assert.equal((h.match(/data-ek-podium="/g) ?? []).length, 3);
  assert.equal((h.match(/data-row="/g) ?? []).length, 2);
  assert.equal((h.match(/data-rank=""/g) ?? []).length, 2);
  assert.equal((h.match(/data-points=""/g) ?? []).length, 2);
  assert.ok(h.includes('>#1<') && h.includes('>#4<') && h.includes('>#100<'), 'the rank number');
  const rows = h.match(/<li data-row=[\s\S]*?<\/li>/g) ?? [];
  for (const r of rows) {
    assert.match(r, /^<li data-row="[^"]+"><a [^>]*href="\/[^"]+"/, 'the whole row is the link');
    assert.match(r, /hover:bg-s-panel-hover/);
    assert.match(r, /data-rank="" class="w-9 shrink-0/, 'a fixed rank column: "#100" fits');
  }
});

test('(a) the filter tabs: a SegTabs rail of links, 44px on a phone, the current one aria-current and white', () => {
  const h = html(React.createElement(BenchView, { rows: [ROW], count: 40, chips: ['base'], filter: { chain: null, weekly: false }, page: 1 }));
  const rail = h.slice(h.indexOf('<nav aria-label="Filters"'), h.indexOf('</nav>', h.indexOf('<nav aria-label="Filters"')));
  assert.match(rail, /rounded-full p-1 bg-s-panel/);
  for (const a of rail.match(/<a [^>]*>/g) ?? []) assert.match(a, /\bmin-h-11\b/);
  assert.match(rail, /<a aria-current="page" class="[^"]*bg-s-light text-s-ink[^"]*" href="\/leaderboard">All<\/a>/);
  assert.match(rail, /href="\/leaderboard\?backed=1"[^>]*>Backed</);
  assert.doesNotMatch(rail, /weekly=1|Shipping every week/, 'W3: no weekly tab');
});

// ---- (f) nothing wider than a phone column -------------------------------------------------------

test('(f) a 390px leaderboard: no nowrap on row text, no min-w over 20rem, names and projects wrap (only the @handle truncates)', () => {
  const long = { ...ROW, name: 'Maximiliana Alexandrovna Montgomery-Featherstonehaugh', project: 'The Recipe Planner For Busy Families Who Cook Every Night', best: 'Went live, 3 weeks in a row, 1,204 people', streak: 0 };
  const row = html(React.createElement(BenchRowItem, { r: long, ranked: true }));
  assert.doesNotMatch(row, /whitespace-nowrap/);
  assert.doesNotMatch(row, /text-ellipsis|line-clamp|max-w-\[/);
  assert.equal((row.match(/\btruncate\b/g) ?? []).length, 1, 'only the @handle');
  assert.equal((row.match(/\[overflow-wrap:anywhere\]/g) ?? []).length, 2, 'the name and the project wrap');
  const page = html(React.createElement(BenchView, { rows: [long, long, long, long].map((r, i) => ({ ...r, handle: `h${i}` })), count: 40, chips: ['base', 'arc', 'robinhood'], filter: { chain: null, weekly: false }, page: 1 }));
  for (const m of page.matchAll(/min-w-\[(\d+(?:\.\d+)?)rem\]/g)) assert.ok(Number(m[1]) <= 20, m[0]);
  assert.doesNotMatch(page, /min-w-\[\d+px\]/);
});

// ---- (b) the feed ----------------------------------------------------------------------------------

test('(b) the feed (v3.1 site Task 9): H1 "Feed", the line as the description, week tabs, full-width dark rows (no grid, no white card), the note quoted', () => {
  assert.equal(FEED_TITLE, 'Feed');
  assert.equal(FEED_LINE, 'What builders on the leaderboard shipped, week by week. Every fact is checked.');
  assert.match(readFileSync(join(FRONTEND, 'app/feed/page.tsx'), 'utf8'), /description: FEED_LINE/);
  const card = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import.', summary: 'Fixed the timer.', chips: ['Went live'], pinned: false, score: 62, commits: 12 };
  const weeks = [{ monday: '2026-10-12', label: 'Week of Oct 12', cards: [card, { ...card, id: 2, handle: 'devon_ships', name: 'Devon Park' }] }, { monday: '2026-10-05', label: 'Week of Oct 5', cards: [{ ...card, id: 3, week: '2026-10-05' }] }];
  const h = html(React.createElement(FeedView, { weeks, week: null, page: 1, stats: null }));
  assert.match(h, /<h1[^>]*>Feed<\/h1>/);
  assert.match(h, /<nav aria-label="Weeks"[^>]*>[\s\S]*Week of Oct 12[\s\S]*Week of Oct 5[\s\S]*<\/nav>/);
  // The selected (newest) week's rows only; each a full-width dark card in one column.
  assert.equal((h.match(/<article data-ek-feed-row="/g) ?? []).length, 2);
  assert.match(h, /<ul class="flex flex-col gap-3">/);
  assert.doesNotMatch(h, /grid-cols-3|bg-s-light text-s-ink[^"]*rounded/);
  // The builder's note stays, quoted under the summary.
  assert.equal((h.match(/<blockquote data-ek-note=""/g) ?? []).length, 2);
  assert.match(h, /<article data-ek-feed-row="1" class="[^"]*--ek-s-card-top[^"]*"/);
});

// ---- (c) the programs page -------------------------------------------------------------------------

test('(c) /programs: a permanent redirect to the landing\'s #earn section (v3.1 W10), "Earning opportunities"', () => {
  assert.match(readFileSync(join(FRONTEND, 'app/programs/page.tsx'), 'utf8'), /permanentRedirect\('\/#earn'\)/);
  const h = html(React.createElement(HomeView, { landing: homeFixture }));
  assert.match(h, new RegExp(`<section id="earn"[^>]*>\\s*<h2[^>]*>${EARN_TITLE}</h2>`));
  assert.doesNotMatch(h, /Open programs|Money open now/);
});


test('(c) a program logo sits on a light disc so a dark mark reads on the black page; the monogram keeps its raised disc', () => {
  const one = html(React.createElement(ProgramLogo, { logo: '/programs/arc-microgrants.svg', title: 'Arc Microgrants', size: 40 }));
  assert.match(one, /<span[^>]*class="[^"]*\brounded-full\b[^"]*\bbg-ek-text\b[^"]*"[^>]*>\s*<img src="\/programs\/arc-microgrants.svg" alt="Arc Microgrants"/);
  assert.match(one, /overflow-hidden/);
  const none = html(React.createElement(ProgramLogo, { logo: null, title: 'Arc Microgrants', size: 40 }));
  assert.match(none, /bg-ek-raised/);
  assert.doesNotMatch(none, /bg-ek-text/);
});

// ---- (d) the guide ---------------------------------------------------------------------------------

/** Every element GuideView returns, walked through children (finds the client AskAgent's props). */
function elements(node: unknown, out: React.ReactElement[] = []): React.ReactElement[] {
  if (Array.isArray(node)) for (const n of node) elements(n, out);
  else if (React.isValidElement(node)) {
    out.push(node);
    elements((node.props as { children?: unknown }).children, out);
  }
  return out;
}
const asks = (page: Parameters<typeof GuideView>[0]['page']) => elements(GuideView({ page })).filter((e) => e.type === AskAgent);

test('(d) an upcoming guide: "Not open yet" as its own fact, the opens_note line, no Ask button', () => {
  const h = html(React.createElement(GuideView, { page: upcomingGuide }));
  assert.match(h, /<h1[^>]*>Base Batches 005<\/h1>/);
  assert.match(h, /<span[^>]*>Not open yet<\/span>/);
  assert.ok(h.includes('Applications open in November. Build on Base now.'));
  assert.doesNotMatch(h, /Ask your agent/);
  assert.equal(asks(upcomingGuide).length, 0);
  assert.doesNotMatch(h, /<h2/, 'no parts without data');
});

test('(d) the guide header: the facts as separate muted spans (award, when, chain), never one dotted string; one Ask on an open program', () => {
  const h = html(React.createElement(GuideView, { page: fullGuide }));
  const [award, when] = fullGuide.guide.header.slice(fullGuide.title.length + 3).split(' · ');
  assert.match(h, new RegExp(`<span[^>]*>${award.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`));
  // Task 7: each fact starts with a capital on the page ("Ends Oct 14"), as the row chips do; get_program's text is unchanged.
  assert.match(h, new RegExp(`<span[^>]*>${when.charAt(0).toUpperCase() + when.slice(1)}</span>`));
  assert.match(h, /<span[^>]*>Arc<\/span>/, 'the chain is a fact of its own');
  assert.doesNotMatch(h, new RegExp(`${award.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · `), 'no dotted facts string');
  assert.ok(text(h).includes('Difficulty: '));
  assert.equal(asks(fullGuide).length, 1);
  assert.match(h, /<h2[^>]*>What Arc wants now<\/h2>/);
  assert.match(h, /<h2[^>]*>Most likely to win<\/h2>/);
  assert.match(h, /Sources:/);
  assert.match(h, /href="\/#earn"/);
  // The parts are a ROWS list: it closes with a hairline, each part opens with one.
  assert.match(h, /<div class="[^"]*\bborder-b border-ek-line\b[^"]*"><section/);
  assert.equal((h.match(/<section [^>]*class="[^"]*\bborder-t border-ek-line\b/g) ?? []).length, 3);
  // Any chain reads "Any chain"; the closed one says "Closed" (Task 7: facts start with a capital, as the row chips do).
  assert.match(html(React.createElement(GuideView, { page: { ...fullGuide, any_chain: true, chain: null } })), new RegExp(`<span[^>]*>${ANY_CHAIN}</span>`));
  assert.match(html(React.createElement(GuideView, { page: closedGuide })), /<span[^>]*>Closed<\/span>/);
  assert.match(html(React.createElement(GuideView, { page: emptyGuide })), /<span[^>]*>Rolling<\/span>/);
});

// ---- 404 -------------------------------------------------------------------------------------------

test('404 (v3.1 NotFound board): "404", the line as the h1, one "Back home" link to /; its own title "Not found | EarnKit" (QA item 13), noindex', () => {
  const h = html(React.createElement(NotFound));
  const main = h.split('<footer')[0];
  assert.ok(main.includes(`>${NOT_FOUND_BIG}<`));
  assert.match(main, new RegExp(`<h1[^>]*>${NOT_FOUND_TEXT.replace('.', '\\.')}</h1>`));
  assert.deepEqual([...main.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]), [['/', NOT_FOUND_HOME]]);
  assert.equal(NOT_FOUND_TITLE, 'Not found | EarnKit');
  assert.deepEqual(notFoundMeta, { title: NOT_FOUND_TITLE, robots: { index: false } });
  assert.deepEqual(NOT_FOUND_METADATA, notFoundMeta);
  // One <title> per page: the component renders none; routes that call notFound() set it through generateMetadata.
  assert.ok(!h.includes('<title'), h.slice(0, 200));
});

test('404 title: each route that calls notFound() for a missing entity returns NOT_FOUND_METADATA from generateMetadata (pinned in the source: these read request-scoped data and the "@/" alias)', () => {
  const app = join(dirname(fileURLToPath(import.meta.url)), '../../app');
  for (const f of ['[handle]/handle-view.tsx', 'b/[slug]/page.tsx', 'programs/[id]/page.tsx', 'campaigns/[slug]/page.tsx', 'p/[id]/page.tsx']) {
    const src = readFileSync(join(app, f), 'utf8');
    assert.match(src, /NOT_FOUND_METADATA/, f);
    assert.match(src, /generateMetadata|handleMetadata/, f);
  }
});

// ---- (e) wording: "of N builders" ---------------------------------------------------------------

test('(e) rankLine, scoreLine, rankSplit, shareText and the badge: "of N builders", never "this week"', () => {
  const s = (rank: number, total: number) => ({ ranked: true, rank, total });
  assert.equal(rankLine(s(3, 19)), '#3 of 19 builders');
  assert.equal(rankLine(s(1, 1)), '#1 of 1 builder');
  assert.equal(rankLine(s(3, 40)), 'Top 8% of builders', 'from 20 ranked, the top half reads as Top P% (rank.ts rule kept)');
  assert.equal(rankLine(s(30, 40)), '#30 of 40 builders');
  assert.equal(rankLine(s(2, 12), { chain: 'arc' }), '#2 of 12 builders on Arc');
  assert.equal(rankLine(s(1, 100), { chain: 'base' }), 'Top 1% of builders on Base');
  assert.equal(rankLine(s(2004, 3500)), '#2,004 of 3,500 builders');
  assert.equal(scoreLine(72, rankLine(s(3, 19))), 'Shipping 72 · #3 of 19 builders');
  assert.deepEqual(rankSplit('#3 of 19 builders'), { lead: '#3', rest: 'of 19 builders' });
  assert.deepEqual(rankSplit('Top 4% of builders'), { lead: 'Top 4%', rest: 'of builders' });
  assert.equal(shareText({ score: 72, rank: 3, total: 40 } as Parameters<typeof shareText>[0]), 'My week on EarnKit: Shipping 72 · #3 of 40 builders');
  assert.equal(badgeValue({ rank: '#3 of 40 builders', score: 72 }), 'Shipping 72 · #3');
  for (const t of [rankLine(s(3, 19)), rankLine(s(3, 40)), rankLine(s(2, 12), { chain: 'arc' }), shareText({ score: 1, rank: 1, total: 1 } as Parameters<typeof shareText>[0])]) assert.doesNotMatch(String(t), /this week/);
});

/** Source with comments removed (block, line, JSX and SQL comments): what can reach a person. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? (['node_modules', 'fixtures'].includes(f) ? [] : walk(p)) : [p];
  });

test('(e) the words "builders this week" leave app/ and lib/ (non-test source, comments aside)', () => {
  const found: string[] = [];
  for (const f of [...walk(join(FRONTEND, 'app')), ...walk(join(FRONTEND, 'lib'))]) {
    if (!/\.(tsx?|mts)$/.test(f) || /\.test\.ts$/.test(f)) continue;
    stripComments(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
      if (/builders?.{0,20}this week/.test(line)) found.push(`${relative(FRONTEND, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, []);
});
