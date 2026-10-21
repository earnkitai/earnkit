import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchView, { FILTER_BACKED, LEADERBOARD_PAGE, pageHref } from '../../app/leaderboard/BenchView';
import { benchRows, type BenchFilter, type BenchRow } from './bench-data';
import { sql } from './db';
import { person, withEnv } from './fixtures/find';
import { RANK_MIN_POOL } from './rank';
import { leaderboardLine } from './site-copy';

/**
 * v3.1 site Task 8: the leaderboard (Leaderboard board): the podium (blue, navy, rust, metal place pills), the rows
 * (photo, name, X glyph and @handle, project, Backed tag, streak, score in its band colour), the filter rail (All, Base,
 * Backed), LEADERBOARD_PAGE rows a page. Under RANK_MIN_POOL no "#N", no metal pill, no "of N builders". Backed only
 * while EARNKIT_RAISING is on and never for EarnKit's own repo.
 */
// The components use the automatic JSX runtime under Next; tsx compiles them classic, so React is a global here.
(globalThis as { React?: typeof React }).React = React;
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const PLAIN: BenchFilter = { chain: null, weekly: false };
/** n ranked rows, best first: scores 95 down by 3 (all three bands), streak 14 for the first and 1 for the last. */
const rowsOf = (n: number): BenchRow[] =>
  Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    line: `#${i + 1} of ${n} builders`,
    points: Math.max(1, 95 - 3 * i),
    handle: `bldr_${i + 1}`,
    name: `Builder ${i + 1}`,
    avatar: null,
    backing: null,
    chains: ['base'],
    project: `Project ${i + 1}`,
    best: '2 weeks in a row',
    streak: i === 0 ? 14 : i === n - 1 ? 1 : 3,
  }));
const view = (rows: BenchRow[], o: { count?: number; chips?: ('base' | 'arc' | 'robinhood')[]; filter?: BenchFilter; page?: number } = {}) =>
  renderToStaticMarkup(
    React.createElement(BenchView, { rows, count: o.count ?? rows.length, chips: o.chips ?? ['base'], filter: o.filter ?? PLAIN, page: o.page ?? 1 }),
  ).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** The markup inside the element whose open tag carries `marker`, through its matching close (same tag name). */
const block = (h: string, marker: string) => {
  const at = h.indexOf(marker);
  assert.ok(at >= 0, marker);
  const start = h.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/.exec(h.slice(start))![1];
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g');
  re.lastIndex = start;
  for (let m = re.exec(h); m; m = re.exec(h)) {
    if (m[2]) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return h.slice(start, m.index + m[0].length);
  }
  return h.slice(start);
};
const listRows = (h: string) => [...h.matchAll(/<li data-row="([^"]+)"/g)].map((m) => m[1]);
const places = (h: string) => [...h.matchAll(/>#(\d+)</g)].map((m) => Number(m[1]));

test('(a) 12 rows, count 12: three podium cards (#1 gold blue, #2 silver navy, #3 bronze rust); 9 list rows #4 to #12; streaks; score bands', () => {
  const h = view(rowsOf(12));
  const cards = [1, 2, 3].map((n) => block(h, `data-ek-podium="${n}"`));
  const spec = [
    { place: '#1', metal: 'text-s-gold-ink', fill: 'bg-s-blue' },
    { place: '#2', metal: 'text-s-silver-ink', fill: 'bg-s-navy' },
    { place: '#3', metal: 'text-s-bronze-ink', fill: 'bg-s-rust' },
  ];
  for (const [i, c] of cards.entries()) {
    const s = spec[i];
    assert.match(c, new RegExp(`data-ek-place=""[^>]*class="[^"]*${s.metal}[^"]*"[^>]*>${s.place}<`), c);
    assert.match(c, new RegExp(`^<article [^>]*class="[^"]*\\b${s.fill}\\b`), c);
    assert.match(c, new RegExp(`href="/bldr_${i + 1}"[^>]*>Builder ${i + 1}<`), 'the name links to the page');
    assert.match(c, new RegExp(`href="https://x\\.com/bldr_${i + 1}"`), 'the @handle links to X');
    assert.ok(text(c).includes(`· Project ${i + 1}`), c);
    assert.ok(text(c).includes('Shipping'));
  }
  assert.ok(text(cards[0]).includes('14 weeks') && text(cards[0]).includes('95'));
  assert.equal(listRows(h).length, 9);
  assert.deepEqual(listRows(h), Array.from({ length: 9 }, (_, i) => `bldr_${i + 4}`));
  assert.deepEqual(places(block(h, 'aria-label="Builders"')), [4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const last = block(h, 'data-row="bldr_12"');
  assert.ok(text(last).includes('1 week') && !text(last).includes('1 weeks'));
  assert.ok(text(block(h, 'data-row="bldr_4"')).includes('3 weeks'));
  // Scores by band (S13): row 4 is 95 - 9 = 86 (good), row 12 is 95 - 33 = 62 (mid), a 22 is low.
  assert.match(block(h, 'data-row="bldr_4"'), /class="[^"]*text-s-good-text[^"]*"[^>]*>86</);
  assert.match(last, /class="[^"]*text-s-mid-text[^"]*"[^>]*>62</);
  const low = view(rowsOf(12).map((r) => (r.rank === 5 ? { ...r, points: 22 } : r)));
  assert.match(block(low, 'data-row="bldr_5"'), /class="[^"]*text-s-low-text[^"]*"[^>]*>22</);
  // The X glyph and @handle in a row are text: the row is the link.
  assert.match(last, /<a [^>]*href="\/bldr_12"/);
  assert.ok(text(last).includes('@bldr_12 · Project 12'), last);
  assert.doesNotMatch(last, /x\.com/);
  assert.ok(h.includes(leaderboardLine(12)));
  assert.doesNotMatch(text(h), /\bpoints?\b/i, 'no points on the page');
});

test('(b) the filter rail: All on for the plain filter; Base only with a base chip; Backed only with EARNKIT_RAISING=on; ?backed=1 marks Backed', () =>
  withEnv({ EARNKIT_RAISING: undefined }, async () => {
    const tabs = (h: string) => [...block(h, 'aria-label="Filters"').matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((m) => ({ href: /href="([^"]*)"/.exec(m[1])![1], on: m[1].includes('aria-current="page"'), label: m[2] }));
    const off = view(rowsOf(12));
    assert.deepEqual(tabs(off), [{ href: '/leaderboard', on: true, label: 'All' }, { href: '/leaderboard?chain=base', on: false, label: 'Base' }]);
    assert.deepEqual(tabs(view(rowsOf(12), { chips: ['arc'] })).map((t) => t.label), ['All'], 'no Base tab without a Base project');
    assert.equal(tabs(view(rowsOf(12), { filter: { chain: 'base', weekly: false } })).find((t) => t.on)?.label, 'Base');
    // Old links still filter (the rows are the caller's) and mark no tab (W3).
    for (const filter of [{ chain: 'arc' as const, weekly: false }, { chain: null, weekly: true }]) assert.equal(tabs(view(rowsOf(12), { filter })).filter((t) => t.on).length, 0);
    await withEnv({ EARNKIT_RAISING: 'on' }, async () => {
      const on = view(rowsOf(12));
      assert.deepEqual(tabs(on).map((t) => t.label), ['All', 'Base', FILTER_BACKED]);
      assert.equal(tabs(on).at(-1)!.href, '/leaderboard?backed=1');
      const backed = tabs(view(rowsOf(12), { filter: { chain: null, weekly: false, backed: true } }));
      assert.deepEqual(backed.filter((t) => t.on).map((t) => t.label), [FILTER_BACKED]);
    });
  }));

test('(c) count 9 (under RANK_MIN_POOL): no "#" place text, no metal pill, no "of 9 builders"; the line still reads', () => {
  assert.equal(RANK_MIN_POOL, 10);
  const h = view(rowsOf(9));
  assert.ok(text(h).includes('9 builders, ranked by how often they ship'));
  assert.doesNotMatch(text(h), /#\d/, 'no place text');
  assert.doesNotMatch(h, /data-ek-place|data-rank|text-s-(gold|silver|bronze)-ink/, 'no metal pill, no place column');
  assert.doesNotMatch(h, /of 9 builders/);
  assert.equal(count(h, /data-ek-podium=/g), 3);
  assert.equal(listRows(h).length, 6);
  // 10 ranked: they show.
  const ten = view(rowsOf(10));
  assert.ok(ten.includes('data-ek-place') && places(ten).includes(10));
});

test('(d) 45 rows: page 1 shows the podium and rows 4 to 20, "1 of 3"; page 2 rows 21 to 40, no podium, Previous enabled', () => {
  assert.equal(LEADERBOARD_PAGE, 20);
  const rows = rowsOf(45);
  const p1 = view(rows);
  assert.equal(count(p1, /data-ek-podium=/g), 3);
  assert.deepEqual(listRows(p1), Array.from({ length: 17 }, (_, i) => `bldr_${i + 4}`));
  assert.ok(text(block(p1, 'aria-label="Pages"')).includes('1 of 3'));
  assert.match(p1, /<span aria-disabled="true"[^>]*>Previous<\/span>/);
  assert.match(p1, /<a [^>]*href="\/leaderboard\?page=2"[^>]*>Next<\/a>/);
  const p2 = view(rows, { page: 2 });
  assert.equal(count(p2, /data-ek-podium=/g), 0);
  assert.deepEqual(listRows(p2), Array.from({ length: 20 }, (_, i) => `bldr_${i + 21}`));
  assert.match(p2, /<a [^>]*href="\/leaderboard"[^>]*>Previous<\/a>/);
  assert.match(p2, /<a [^>]*href="\/leaderboard\?page=3"[^>]*>Next<\/a>/);
  assert.ok(text(p2).includes('2 of 3'));
  // Page 3 holds 41 to 45; a page past the end reads as the last; a filter keeps its query.
  assert.deepEqual(listRows(view(rows, { page: 99 })), ['bldr_41', 'bldr_42', 'bldr_43', 'bldr_44', 'bldr_45']);
  assert.equal(pageHref({ chain: 'base', weekly: false }, 2), '/leaderboard?chain=base&page=2');
  // One page: no pager.
  assert.doesNotMatch(view(rowsOf(12)), /aria-label="Pages"/);
});

test('(e) a row with backing shows "Backed" (navy tag); none without', () => {
  const rows = rowsOf(12).map((r) => (r.rank === 5 ? { ...r, backing: { symbol: 'KIT', url: 'https://tokens.fun/coin/0xabc' } } : r));
  const h = view(rows);
  const row = block(h, 'data-row="bldr_5"');
  assert.match(row, /data-ek-backed=""[^>]*class="[^"]*\bbg-s-navy\b[^"]*\btext-s-on-navy\b[^"]*"[^>]*>Backed</);
  assert.doesNotMatch(row, /Backing|\$KIT|tokens\.fun/, 'the tag only, never the coin');
  for (const r of listRows(h).filter((x) => x !== 'bldr_5')) assert.doesNotMatch(block(h, `data-row="${r}"`), /Backed/);
  assert.doesNotMatch(view(rowsOf(12)), /data-ek-backed/);
});

test('(f) no <a> inside an <a>', () => {
  const rows = rowsOf(45).map((r) => ({ ...r, backing: { symbol: 'KIT', url: 'https://tokens.fun/coin/0xabc' } }));
  for (const h of [view(rows), view(rows, { page: 2 }), view(rowsOf(9))]) {
    let depth = 0;
    for (const m of h.matchAll(/<(\/?)a\b/g)) {
      depth += m[1] ? -1 : 1;
      assert.ok(depth <= 1, 'nested link');
    }
  }
});

test('(g) EarnKit\'s own repo never shows Backing: with EARNKIT_RAISING on and an open coin, no tag, no Backed filter row', db, () =>
  withEnv({ EARNKIT_RAISING: 'on' }, async () => {
    const coin = async (id: number, key: string, symbol: string) =>
      sql()`
        INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at, coin_launched_at)
        VALUES ('earnkit-coin', ${symbol}, ${`https://github.com/${key}`}, ${`github.com/${key}`}, ${id}, ${symbol}, 'launched', ${`https://tokens.fun/coin/0x${id}`}, now(), now())`;
    const tag = `v31lb${process.pid % 100000}`;
    const own = await person({ projects: [{ key: 'earnkitai/earnkit', name: 'EarnKit', confirmed: true, streak: 3 }], score: 80, ranked: true, main: 'earnkitai/earnkit', claimed: `${tag}a` });
    const other = await person({ projects: [{ key: `${tag}/kit`, name: 'Kit', confirmed: true, streak: 2 }], score: 70, ranked: true, main: `${tag}/kit`, claimed: `${tag}b` });
    await coin(own, 'earnkitai/earnkit', 'EARNKIT');
    await coin(other, `${tag}/kit`, 'KIT');
    const all = await benchRows(PLAIN, { only: [own, other] });
    const byHandle = new Map(all.rows.map((r) => [r.handle, r]));
    assert.equal(byHandle.get(`${tag}a`)!.backing, null, 'never for earnkitai/earnkit');
    assert.ok(byHandle.get(`${tag}b`)!.backing, 'another open coin is Backed');
    const backed = await benchRows({ ...PLAIN, backed: true }, { only: [own, other] });
    assert.deepEqual(backed.rows.map((r) => r.handle), [`${tag}b`]);
    const h = view(all.rows, { count: all.count });
    const mine = block(h, `data-ek-podium="1"`);
    assert.ok(text(mine).includes(`@${tag}a`), mine);
    assert.doesNotMatch(mine, /Backed|Backing|EARNKIT|tokens\.fun/);
    assert.doesNotMatch(h, /\$EARNKIT|Backing ·/);
    // Another org repo of EarnKit's is excluded too.
    const kit = await person({ projects: [{ key: 'earnkitai/chain-kits', name: 'Kits', confirmed: true, streak: 1 }], score: 60, ranked: true, main: 'earnkitai/chain-kits', claimed: `${tag}c` });
    await coin(kit, 'earnkitai/chain-kits', 'KITS');
    assert.equal((await benchRows(PLAIN, { only: [kit] })).rows[0].backing, null);
  }));

function count(h: string, re: RegExp) {
  return (h.match(re) ?? []).length;
}
