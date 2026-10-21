import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FeedView, { FEED_EMPTY, FEED_PAGE, FEED_TABS, FEED_TITLE } from '../../app/feed/FeedView';
import type { FeedCard } from './feed';
import type { FeedWeekStats } from './site-data';
import { FEED_STATS } from './site-copy';

/**
 * v3.1 site Task 9: the feed (Feed board): the title, the newest FEED_TABS weeks as tabs (`?week=<monday>`), the selected
 * week's four numbers (feedWeekStats), then its cards as full-width dark rows (photo, name, X glyph and @handle, project
 * and commits, the week's words, the score in its band colour), FEED_PAGE rows a page with quiet pagination.
 */
// The components use the automatic JSX runtime under Next; tsx compiles them classic, so React is a global here.
(globalThis as { React?: typeof React }).React = React;

type Week = { monday: string; label: string; cards: FeedCard[] };
const card = (id: number, o: Partial<FeedCard> = {}): FeedCard => ({
  id,
  handle: `bldr_${id}`,
  name: `Builder ${id}`,
  avatar: null,
  project: `Project ${id}`,
  week: '2026-10-12',
  text: `Note ${id}.`,
  summary: `Summary ${id}.`,
  chips: ['Went live'],
  pinned: false,
  score: 80 - id,
  commits: 10 + id,
  ...o,
});
const MONDAYS = ['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21'];
const LABELS = ['Week of Oct 12', 'Week of Oct 5', 'Week of Sep 28', 'Week of Sep 21'];
const weeksOf = (n: number, cards = 2): Week[] =>
  MONDAYS.slice(0, n).map((monday, w) => ({ monday, label: LABELS[w], cards: Array.from({ length: cards }, (_, i) => card(w * 100 + i + 1, { week: monday })) }));
const STATS: FeedWeekStats = { builders: 2, commits: 1234, went_live: 1, applications: 7 };
const view = (weeks: Week[], o: { week?: string | null; page?: number; stats?: FeedWeekStats | null } = {}) =>
  renderToStaticMarkup(React.createElement(FeedView, { weeks, week: o.week ?? null, page: o.page ?? 1, stats: o.stats === undefined ? STATS : o.stats }))
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const tabs = (h: string) => [...h.matchAll(/<a [^>]*href="\/feed\?week=([\d-]+)"[^>]*>(Week of [^<]+)</g)].map((m) => ({ monday: m[1], on: m[0].includes('aria-current="page"') }));
const rows = (h: string) => [...h.matchAll(/<article data-ek-feed-row="(\d+)"/g)].map((m) => Number(m[1]));

test('(a) three tabs for four weeks, the selected week aria-current; ?week of an unknown monday falls back to the newest', () => {
  assert.equal(FEED_TABS, 3);
  const h = view(weeksOf(4), { week: '2026-10-05' });
  assert.match(h, /<h1[^>]*>Feed<\/h1>/);
  assert.equal(FEED_TITLE, 'Feed');
  assert.deepEqual(tabs(h), [
    { monday: '2026-10-12', on: false },
    { monday: '2026-10-05', on: true },
    { monday: '2026-09-28', on: false },
  ]);
  assert.deepEqual(rows(h), [101, 102], 'the selected week\'s cards');
  for (const unknown of ['2020-01-06', 'nope', null]) {
    const u = view(weeksOf(4), { week: unknown });
    assert.deepEqual(tabs(u).map((t) => t.on), [true, false, false], String(unknown));
    assert.deepEqual(rows(u), [1, 2]);
  }
  // A fourth week (W4: only by URL) shows its cards and marks no tab.
  const fourth = view(weeksOf(4), { week: '2026-09-21' });
  assert.deepEqual(tabs(fourth).map((t) => t.on), [false, false, false]);
  assert.deepEqual(rows(fourth), [301, 302]);
  // One week: one tab.
  assert.equal(tabs(view(weeksOf(1))).length, 1);
});

test('(b) stats cards show "2", "1.2K", "1", "7" with their labels in order', () => {
  const h = view(weeksOf(1));
  const found = [...h.matchAll(/<div data-ek-stat="[a-z_]+"[^>]*><span[^>]*>([^<]+)<\/span><span[^>]*>([^<]+)<\/span><\/div>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(found, [
    [FEED_STATS.builders, '2'],
    [FEED_STATS.commits, '1.2K'],
    [FEED_STATS.live, '1'],
    [FEED_STATS.applications, '7'],
  ]);
  // Values of 0 show "0"; a failed read (null) hides the cards.
  const zero = view(weeksOf(1), { stats: { builders: 0, commits: 0, went_live: 0, applications: 0 } });
  assert.equal((zero.match(/data-ek-stat="/g) ?? []).length, 4);
  assert.equal([...zero.matchAll(/<span[^>]*ek-serif[^>]*>0<\/span>/g)].length, 4);
  assert.doesNotMatch(view(weeksOf(1), { stats: null }), /data-ek-stat=/);
  // The four fills: blue, step, rust, green gradients.
  for (const fill of ['--ek-s-blue-top', '--ek-s-step-top', '--ek-s-rust-top', '--ek-s-green-top']) assert.ok(h.includes(fill), fill);
});

test('(c) 14 cards: page 1 has 10 rows, a pager with 2 numbers; page 2 has 4', () => {
  assert.equal(FEED_PAGE, 10);
  const weeks = weeksOf(2, 14);
  const one = view(weeks);
  assert.equal(rows(one).length, 10);
  assert.deepEqual(rows(one), weeks[0].cards.slice(0, 10).map((c) => c.id));
  const pager = /<nav aria-label="Feed pages"[\s\S]*?<\/nav>/.exec(one)?.[0] ?? '';
  assert.ok(pager, 'a pager');
  assert.match(pager, />Newer</);
  assert.match(pager, />Older</);
  assert.match(pager, /aria-current="page"[^>]*>1</);
  assert.match(pager, /href="\/feed\?week=2026-10-12&page=2"[^>]*>2</);
  assert.equal([...pager.matchAll(/>(\d)</g)].length, 2, 'two page numbers');
  const two = view(weeks, { page: 2 });
  assert.deepEqual(rows(two), weeks[0].cards.slice(10).map((c) => c.id));
  // A hand-edited page past the end reads as the last one; the other week keeps its own pages.
  assert.deepEqual(rows(view(weeks, { page: 9 })), rows(two));
  assert.match(view(weeks, { week: '2026-10-05', page: 2 }), /href="\/feed\?week=2026-10-05"[^>]*>1</);
  // One page: no pager.
  assert.doesNotMatch(view(weeksOf(1, 10)), /Feed pages/);
});

test('(d) a row: photo, name to the page, @handle to X, project and commits, words, score; partial data never leaks', () => {
  const full = card(1, { name: 'Maya Chen', handle: 'maya_makes', project: 'Recipe planner', commits: 1234, score: 72, avatar: 'https://pbs.twimg.com/a.jpg' });
  const h = view([{ monday: '2026-10-12', label: 'Week of Oct 12', cards: [full] }]);
  const row = /<article data-ek-feed-row="1"[\s\S]*?<\/article>/.exec(h)![0];
  assert.match(row, /<img [^>]*src="https:\/\/pbs\.twimg\.com\/a\.jpg"/);
  assert.match(row, /href="\/maya_makes"[^>]*>(<span[^>]*>)?Maya Chen</);
  assert.match(row, /href="https:\/\/x\.com\/maya_makes"/);
  assert.ok(text(row).includes('Recipe planner · 1,234 commits'));
  assert.ok(text(row).includes('Summary 1.'), 'the summary first');
  assert.ok(!text(row).includes('Note 1.'));
  assert.match(row, /text-s-good-text[^"]*"[^>]*>72</);
  assert.doesNotMatch(row, /points/i, 'no points');
  for (const seg of row.split('</a>')) assert.ok((seg.match(/<a /g) ?? []).length <= 1, 'no nested links');

  const bare = card(2, { summary: null, text: null, chips: ['Went live', 'Applied to Base'], score: null, commits: 0, project: 'Solo' });
  const noteOnly = card(3, { summary: null, text: 'Shipped the import.', chips: [] });
  const nothing = card(4, { summary: null, text: null, chips: [] });
  const p = view([{ monday: '2026-10-12', label: 'Week of Oct 12', cards: [bare, noteOnly, nothing] }]);
  const b = /<article data-ek-feed-row="2"[\s\S]*?<\/article>/.exec(p)![0];
  assert.ok(text(b).includes('Went live · Applied to Base'), 'chips without words');
  assert.ok(text(b).includes(' Solo ') && !/commit/.test(text(b)), 'no commits part at 0');
  assert.doesNotMatch(b, /text-s-(good|mid|low)-text/, 'no score');
  assert.ok(text(p).includes('Shipped the import.'), 'the note without a summary');
  assert.doesNotMatch(/<article data-ek-feed-row="4"[\s\S]*?<\/article>/.exec(p)![0], /<p /, 'no empty words line');

  const empty = view([], { stats: null });
  assert.ok(text(empty).includes(FEED_EMPTY));
  assert.match(empty, /href="\/leaderboard"[^>]*>See the leaderboard</);
  assert.doesNotMatch(empty, /data-ek-stat=|Week of|Feed pages/);
  // Even with stats passed, zero weeks show none.
  assert.doesNotMatch(view([]), /data-ek-stat=/);
  for (const h2 of [h, p, empty, view(weeksOf(4)), view(weeksOf(2, 14), { page: 2 })]) {
    const t = text(h2.replace(/<footer[\s\S]*<\/footer>/, ''));
    assert.doesNotMatch(t, /undefined|null|NaN|\[|—/, t);
    assert.doesNotMatch(t, /\bpoints\b/i);
  }
});

test('(e) the page reads the stats once per request, cached by week (PROFILE_TAG, 300s); the deep page colour; the wide column', () => {
  const page = readFileSync(join(import.meta.dirname, '../../app/feed/page.tsx'), 'utf8');
  assert.equal((page.match(/feedWeekStats\(/g) ?? []).length, 1);
  assert.match(page, /\['feed-stats-v31', monday\], \{ revalidate: 300, tags: \[PROFILE_TAG\] \}/);
  const h = view(weeksOf(1));
  assert.match(h, /^<div data-ek-deep=""/);
  assert.match(h, /max-w-\[1240px\]/);
  assert.doesNotMatch(h, /#[0-9A-Fa-f]{6}\b/, 'no raw hex');
});
