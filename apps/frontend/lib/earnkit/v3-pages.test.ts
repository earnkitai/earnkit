import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.EARNKIT_RAISING = 'on';

import BenchView, { benchLine } from '../../app/leaderboard/BenchView';
import BenchRowItem from '../../app/leaderboard/BenchRowItem';
import { Chip } from '../../app/leaderboard/FilterChip';
import FeedView, { FEED_LINE, FEED_TITLE } from '../../app/feed/FeedView';
import ProgramCards, { PROGRAMS_TITLE } from '../../app/components/sections/ProgramCards';
import ProgramLogo from '../../app/components/sections/ProgramLogo';
import GuideView, { ANY_CHAIN } from '../../app/programs/[id]/GuideView';
import AskAgent from '../../app/programs/[id]/AskAgent';
import NotFound, { NOT_FOUND_LINE, NOT_FOUND_TITLE } from '../../app/not-found';
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
const ROW: BenchRow = { rank: 3, line: '#3 of 40 builders', points: 72, handle: 'maya_makes', name: 'Maya Chen', avatar: null, backing: null, chains: ['base'], project: 'Recipe planner', best: '31 people this week' };

// ---- (a) the leaderboard ------------------------------------------------------------------------

test('(a) the leaderboard: "Leaderboard", benchLine, hairline rows with data-rank and data-points, no "Shipping points", no "this week"', () => {
  const h = html(React.createElement(BenchView, { rows: [ROW, { ...ROW, rank: 4, handle: 'devon_ships', name: 'Devon Park', points: 60 }, { ...ROW, rank: 100, line: '#100 of 120 builders', handle: 'yu_mk', name: 'Yu Makoto', points: 12 }], count: 120, chips: ['base', 'arc'], filter: { chain: null, weekly: false } }));
  assert.match(h, /<h1[^>]*>Leaderboard<\/h1>/);
  assert.ok(h.includes(benchLine(120)) && benchLine(40) === '40 builders. Ranked by Shipping.');
  assert.doesNotMatch(h, /Shipping points/);
  assert.doesNotMatch(h, /builders?.{0,20}this week/, 'no "this week" after the rank (a best fact may say "31 people this week")');
  assert.equal((h.match(/data-row="/g) ?? []).length, 3);
  assert.equal((h.match(/data-rank=""/g) ?? []).length, 3);
  assert.equal((h.match(/data-points=""/g) ?? []).length, 3);
  assert.ok(h.includes('>#3<') && h.includes('>#4<') && h.includes('>#100<'), 'the rank number');
  // The list is ROWS (closes with a hairline); each row opens with one; no Panel wrapper, no middle dot in a row.
  assert.match(h, /<ol [^>]*class="[^"]*\bborder-b border-ek-line\b/);
  const rows = h.match(/<li data-row=[\s\S]*?<\/li>/g) ?? [];
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.match(r, /class="[^"]*\bborder-t border-ek-line\b/);
    // Task 7: the phone rank column is 3rem, so "#100" fits on one line.
    assert.match(r, /\bgrid-cols-\[3rem_minmax\(0,1fr\)_auto\]/);
    assert.doesNotMatch(r, /·/, 'the project and its best fact are two lines, not a dotted pair');
    assert.match(r, /md:grid-cols-\[3rem_minmax\(0,1fr\)_minmax\(0,1fr\)_5rem\]/);
    assert.match(r, /after:absolute after:inset-0/, 'the whole row is the link');
  }
  assert.ok(h.indexOf('Recipe planner') < h.indexOf('31 people this week'));
});

test('(a) the chips: hairline pills with aria-pressed, 44px on a phone, the on state inverted (never brand fill)', () => {
  const off = html(React.createElement(Chip, { on: false, href: '/leaderboard?chain=base' } as React.ComponentProps<typeof Chip>, 'Base'));
  const on = html(React.createElement(Chip, { on: true, href: '/leaderboard' } as React.ComponentProps<typeof Chip>, 'Base'));
  assert.match(off, /aria-pressed="false"/);
  assert.match(on, /aria-pressed="true"/);
  for (const c of [off, on]) {
    assert.match(c, /rounded-full/);
    assert.match(c, /\bh-11\b/);
    assert.match(c, /\bborder\b/);
    assert.doesNotMatch(c, /bg-ek-brand/);
  }
  assert.match(on, /bg-ek-text text-ek-page/);
  const h = html(React.createElement(BenchView, { rows: [ROW], count: 40, chips: ['base'], filter: { chain: null, weekly: false } }));
  assert.match(h, /href="\/leaderboard\?backed=1"[^>]*>Backed</);
  assert.match(h, /href="\/leaderboard\?weekly=1"[^>]*>Shipping every week</);
});

// ---- (f) nothing wider than a phone column -------------------------------------------------------

test('(f) a 390px leaderboard: no nowrap on row text, no min-w over 20rem, nothing cut', () => {
  const long = { ...ROW, name: 'Maximiliana Alexandrovna Montgomery-Featherstonehaugh', project: 'The Recipe Planner For Busy Families Who Cook Every Night', best: 'Went live, 3 weeks in a row, 1,204 people' };
  const row = html(React.createElement(BenchRowItem, { r: long }));
  assert.doesNotMatch(row, /whitespace-nowrap/);
  assert.doesNotMatch(row, /\btruncate\b|text-ellipsis|line-clamp|max-w-\[/);
  const page = html(React.createElement(BenchView, { rows: [long], count: 40, chips: ['base', 'arc', 'robinhood'], filter: { chain: null, weekly: false } }));
  for (const m of page.matchAll(/min-w-\[(\d+(?:\.\d+)?)rem\]/g)) assert.ok(Number(m[1]) <= 20, m[0]);
  assert.doesNotMatch(page, /min-w-\[\d+px\]/);
});

// ---- (b) the feed ----------------------------------------------------------------------------------

test('(b) the feed: H1 "Feed", the line, each week an H2 over a ROWS list of hairline rows (no gapped flex column)', () => {
  assert.equal(FEED_TITLE, 'Feed');
  assert.equal(FEED_LINE, 'What builders on the leaderboard shipped, week by week. Every fact is checked.');
  const card = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import.', summary: 'Fixed the timer.', chips: ['Went live'], pinned: false };
  const h = html(React.createElement(FeedView, { weeks: [{ monday: '2026-10-12', label: 'Week of Oct 12', cards: [card, { ...card, id: 2, handle: 'devon_ships', name: 'Devon Park' }] }, { monday: '2026-10-05', label: 'Week of Oct 5', cards: [{ ...card, id: 3, week: '2026-10-05' }] }] }));
  assert.match(h, /<h1[^>]*>Feed<\/h1>/);
  assert.ok(h.includes(FEED_LINE));
  assert.match(h, /<h2 class="[^"]*font-funnel-display[^"]*">Week of Oct 12<\/h2>/);
  assert.match(h, /<h2 class="[^"]*font-funnel-display[^"]*">Week of Oct 5<\/h2>/);
  assert.equal((h.match(/<ul class="[^"]*\bborder-b border-ek-line\b[^"]*">/g) ?? []).length, 2, 'one ROWS list per week');
  assert.equal((h.match(/<article [^>]*class="[^"]*\bborder-t border-ek-line\b/g) ?? []).length, 3, 'every row opens with a hairline');
  assert.doesNotMatch(h, /flex flex-col gap-4/);
  assert.ok(h.indexOf('Week of Oct 12') < h.indexOf('Week of Oct 5'));
});

// ---- (c) the programs page -------------------------------------------------------------------------

test('(c) /programs: H1 "Money open now", the money line and what it leaves out, then the rows', () => {
  assert.equal(PROGRAMS_TITLE, 'Money open now');
  const h = html(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1', figure: '$115K in grants and prizes open', more: 'Plus 2 accelerators and 1 hackathon.' }));
  assert.match(h, /<h1[^>]*>Money open now<\/h1>/);
  const t = text(h);
  const at = (s: string) => t.indexOf(s);
  assert.ok(at('Money open now') < at('$115K in grants and prizes open') && at('$115K in grants and prizes open') < at('Plus 2 accelerators and 1 hackathon.') && at('Plus 2 accelerators') < at("Crypto World's Fair Hackathon"), t);
  assert.doesNotMatch(h, /Open programs/);
  const page = readFileSync(join(FRONTEND, 'app/programs/page.tsx'), 'utf8');
  assert.match(page, /more=\{landing\.open_more\}/);
  assert.doesNotMatch(page, /Open programs/);
  // The landing's section is the same heading (h2) with the same words.
  assert.match(html(React.createElement(ProgramCards, { tiles: homeFixture.tiles })), /<h2[^>]*>Money open now<\/h2>/);
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
  assert.match(h, /<h2[^>]*>Your best bet<\/h2>/);
  assert.match(h, /Sources:/);
  assert.match(h, /href="\/programs"/);
  // The parts are a ROWS list: it closes with a hairline, each part opens with one.
  assert.match(h, /<div class="[^"]*\bborder-b border-ek-line\b[^"]*"><section/);
  assert.equal((h.match(/<section [^>]*class="[^"]*\bborder-t border-ek-line\b/g) ?? []).length, 3);
  // Any chain reads "Any chain"; the closed one says "Closed" (Task 7: facts start with a capital, as the row chips do).
  assert.match(html(React.createElement(GuideView, { page: { ...fullGuide, any_chain: true, chain: null } })), new RegExp(`<span[^>]*>${ANY_CHAIN}</span>`));
  assert.match(html(React.createElement(GuideView, { page: closedGuide })), /<span[^>]*>Closed<\/span>/);
  assert.match(html(React.createElement(GuideView, { page: emptyGuide })), /<span[^>]*>Rolling<\/span>/);
});

// ---- 404 -------------------------------------------------------------------------------------------

test('404: the title, the line and two links', () => {
  const h = html(React.createElement(NotFound));
  assert.match(h, new RegExp(`<h1[^>]*>${NOT_FOUND_TITLE}</h1>`));
  assert.ok(h.includes(NOT_FOUND_LINE));
  assert.match(h, /<a [^>]*href="\/leaderboard"/);
  assert.match(h, /<a [^>]*href="\/"/);
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
