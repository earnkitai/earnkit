import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brandShell } from './brand-page';
import { UNSUB_BAD, UNSUB_CONFIRM, UNSUB_DONE, digestUnsubscribeGet, digestUnsubscribePost, unsubToken } from './digest';
import { sql } from './db';
import { badgeSvg } from './badge';
import { THEME } from './theme';
import { WEEK_TEXT, weekGet } from './week-links';
import { VERIFY_PAGE, confirmPage, verifyPage } from './github-verify';
import { signinPage } from './x-install';
import { benchCard, factsLine } from '../../app/[handle]/card-response';
import { shareCardFacts, type ShareCardFacts } from '../../app/[handle]/card-facts';
import type { ProfileData } from './bench-data';
import type { ProfileSite } from './site-data';
import { SITE } from './site-theme';

/**
 * v3 Stage 3 Task 6 (spec 5.6, 5.8): the route-handler HTML pages, the share card, the README badge and the OG image
 * draw the flat system from THEME: a black page, Funnel Display for display and numbers, Funnel Sans for text, one
 * accent, hairlines, no gradient, no shadow, no radius on a panel.
 */
(globalThis as { React?: typeof React }).React = React;
process.env.EARNKIT_AUTH_SECRET ??= 'shells-test-secret';
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const ROOT = join(import.meta.dirname, '..', '..');
const shellCss = (html: string) => html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const outsideStyle = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '');

async function assertFlatShell(res: Response | string, status: number | null, label: string) {
  const html = typeof res === 'string' ? res : await res.text();
  if (typeof res !== 'string' && status !== null) assert.equal(res.status, status, `${label}: status`);
  assert.ok(html.startsWith('<!doctype html>'), `${label}: a full page`);
  assert.ok(html.includes('<header class="ek-top">'), `${label}: the top bar`);
  const css = shellCss(html);
  assert.match(css, new RegExp(`body\\{[^}]*background:${THEME.page}`), `${label}: the black page`);
  assert.match(css, /@font-face\{font-family:"Funnel Sans"/, `${label}: Funnel Sans embedded`);
  assert.match(css, /body\{[^}]*"Funnel Sans"/, `${label}: text in Funnel Sans`);
  assert.match(css, /h1\{[^}]*"Funnel Display"/, `${label}: the headline in Funnel Display`);
  assert.doesNotMatch(css, /gradient\(|box-shadow/, `${label}: flat`);
  assert.doesNotMatch(css, /\.ek-panel\{[^}]*border-radius/, `${label}: no panel radius`);
  assert.doesNotMatch(css, /#0F1839|#579DFF|#A3C5FE|#FF7A1A|#F6F9FE/i, `${label}: no old brand hex`);
  assert.doesNotMatch(outsideStyle(html), /—/, `${label}: no em dash`);
  return html;
}

test('T6.1 every brandShell page is the flat system from THEME: black page, Funnel Sans text, Funnel Display headline, the top bar', async () => {
  await assertFlatShell(brandShell('<h1>Hello</h1>'), null, 'brandShell');
  await assertFlatShell(verifyPage(VERIFY_PAGE.expired, 410), 410, 'verify expired');
  await assertFlatShell(confirmPage({ repo_key: 'a/b', handle: 'ada' }, 'n', 'c'), null, 'GitHub confirm');
  await assertFlatShell(signinPage('Hello.', 200), 200, 'sign-in line');
  const week = await weekGet(new Request('http://localhost/api/week?t=bad'));
  const weekHtml = await assertFlatShell(week, 400, 'week bad');
  assert.ok(weekHtml.includes(WEEK_TEXT.bad));
  // The shell's CSS is built from THEME, never from its own hex.
  const css = shellCss(brandShell('<p>x</p>'));
  for (const hex of css.match(/#[0-9a-f]{6}/gi) ?? []) assert.ok(Object.values(THEME).includes(hex as never), `shell hex ${hex} is a THEME value`);
  // The button is BTN_PRIMARY: a 48px pill, brand fill, white text, the accent on hover.
  assert.match(css, /\.ek-btn\{[^}]*min-height:48px/);
  assert.match(css, /\.ek-btn\{[^}]*border-radius:999px/);
  assert.match(css, new RegExp(`\\.ek-btn:hover\\{background:${THEME.accent}\\}`));
  // Rows are hairlines; the code block is a flat surface.
  assert.match(css, new RegExp(`\\.ek-row\\{[^}]*border-top:1px solid ${THEME.hairline.replace(/[.()]/g, '\\$&')}`));
  assert.match(css, new RegExp(`\\.ek-code\\{[^}]*background:${THEME.surface}`));
  assert.doesNotMatch(css, /\.ek-code\{[^}]*border-radius:(?!0)/);
});

test('T6.2 the unsubscribe pages go through brandShell and keep their status and their words', async () => {
  const bad = digestUnsubscribeGet(new Request('http://localhost/api/digest/unsubscribe?t=bad'));
  const badHtml = await assertFlatShell(bad, 400, 'unsubscribe bad');
  assert.ok(badHtml.includes(UNSUB_BAD));
  assert.equal(bad.headers.get('cache-control'), 'no-store');
  assert.equal(bad.headers.get('x-robots-tag'), 'noindex');
  const t = unsubToken(42);
  const confirm = digestUnsubscribeGet(new Request(`http://localhost/api/digest/unsubscribe?t=${encodeURIComponent(t)}`));
  const confirmHtml = await assertFlatShell(confirm, 200, 'unsubscribe confirm');
  assert.ok(confirmHtml.includes(`<h1>${UNSUB_CONFIRM}</h1>`), 'the question is the headline');
  assert.match(confirmHtml, /<form method="post"[^>]*><button class="ek-btn" type="submit">Unsubscribe<\/button><\/form>/);
  const badPost = await digestUnsubscribePost(new Request('http://localhost/api/digest/unsubscribe?t=bad', { method: 'POST' }));
  await assertFlatShell(badPost, 400, 'unsubscribe bad post');
  assert.ok(typeof UNSUB_DONE === 'string');
});

const FACTS: ShareCardFacts = {
  handle: 'maya_makes', name: 'Maya Chen', avatar: null, url: 'earnkit.com/maya_makes', idle: null,
  project: { name: 'recipes', letter: 'R', color: SITE.logoViolet, onBase: true, live: 'recipes.app', facts: ['6 weeks in a row', 'Building since Mar 2025'] },
  tiles: [{ kind: 'score', score: 91, rank: '#1 of 40 builders' }, { kind: 'backing', symbol: 'RCP', backers: 14 }],
};

test('T6.3 (GTM W4) the card: the v3.1 site tokens only, the blue hero (name, @handle, project, live host, facts, the URL with the mark), the ring with the rank, Backing', () => {
  const src = readFileSync(join(ROOT, 'app/[handle]/card-response.tsx'), 'utf8');
  assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b/i, 'no hex outside SITE');
  assert.match(src, /from '\.\.\/\.\.\/lib\/earnkit\/site-theme'/);
  assert.doesNotMatch(src, /gradient\(/, 'flat cards, as the profile');
  const html = renderToStaticMarkup(benchCard(FACTS, null));
  assert.ok(html.includes(`background-color:${SITE.page}`) && html.includes(`background-color:${SITE.blue}`), 'the page ground and the blue hero');
  assert.ok(html.includes('Maya Chen') && html.includes('@maya_makes'));
  // The quiet facts are one line that fits the panel: the second only when both fit (factsLine).
  assert.match(html, />recipes<[\s\S]*?>recipes\.app<[\s\S]*?>6 weeks in a row</, 'project, live host, facts');
  assert.equal(factsLine(['6 weeks in a row', 'Building since Mar 2025']), '6 weeks in a row');
  assert.equal(factsLine(['Building since Mar 2025', 'Won Base Batches']), 'Building since Mar 2025');
  assert.equal(factsLine(['3 weeks in a row', 'Won Arc grants']), '3 weeks in a row · Won Arc grants');
  assert.match(html, />91<[\s\S]*?>Shipping score<|>Shipping score<[\s\S]*?>91</, 'the ring');
  assert.match(html, />#1<[\s\S]*?>of 40 builders</, 'the rank helper\'s line, split');
  assert.match(html, />Backing open<[\s\S]*?>\$RCP<[\s\S]*?>14 backers</, 'Backing');
  assert.ok(html.includes('earnkit.com/maya_makes'), 'the URL');
  assert.doesNotMatch(html, /stroke-dasharray="[^"]*NaN/);
  // Every colour on the card is a SITE value.
  const site = Object.values(SITE).map((v) => v.toLowerCase());
  for (const hex of html.match(/#[0-9a-f]{6}\b/gi) ?? []) assert.ok(site.includes(hex.toLowerCase()), `card hex ${hex}`);
  // A painting fills a slot no fact fills; without one the hero takes the width.
  const art = { tall: 'data:image/jpeg;base64,AAAA', half: 'data:image/jpeg;base64,BBBB' };
  const one = renderToStaticMarkup(benchCard({ ...FACTS, tiles: [FACTS.tiles[0]] }, null, [], art));
  assert.ok(one.includes('BBBB') && !one.includes('AAAA'), 'one fact: the half painting');
  const none = renderToStaticMarkup(benchCard({ ...FACTS, tiles: [] }, null, [], art));
  assert.ok(none.includes('AAAA') && !none.includes('BBBB'), 'no fact: the tall painting');
  assert.ok(!renderToStaticMarkup(benchCard(FACTS, null, [], art)).includes('data:image/jpeg'), 'two facts: no painting');
  const bare = renderToStaticMarkup(benchCard({ ...FACTS, tiles: [] }, null));
  assert.ok(bare.includes('width:1152px'), 'no painting read: the wide hero');
});

test('GTM W4 shareCardFacts: verified facts only, in the page\'s words; no confirmed project, one calm line; never a near-empty card', () => {
  const d = (o: Partial<ProfileData> = {}) =>
    ({
      handle: 'kai', name: 'Kai N', avatar: null, streak: 5, score: 64, rankListed: true, bench: 'Top 4% of builders',
      grid: [], project: { name: 'Paylink', confirmed: true, chains: ['base'] }, ...o,
    }) as unknown as ProfileData;
  const site = (o: Partial<ProfileSite> = {}) =>
    ({
      highlights: [
        { icon: 'live', title: 'Live at paylink.app', sub: 'Up 7 of the last 7 days checked' },
        { icon: 'consistency', title: 'Shipped in 38 of the last 52 weeks', sub: 'Building Paylink since Jan 2025' },
        { icon: 'won', title: 'Won Base Batches', sub: 'Oct 2026' },
      ],
      token: null, starting: false,
      project: { name: 'Paylink', about: null, link: null, repo: null, onBase: true, earnkit: false, letter: 'P', color: SITE.logoGreen },
      ...o,
    }) as unknown as ProfileSite;
  const f = shareCardFacts(d(), site());
  assert.deepEqual(f.tiles.map((t) => t.kind), ['score', 'won']);
  assert.deepEqual(f.tiles[0], { kind: 'score', score: 64, rank: 'Top 4% of builders' });
  assert.equal(f.project?.live, 'paylink.app');
  assert.deepEqual(f.project?.facts, ['5 weeks in a row', 'Building since Jan 2025']);
  assert.equal(f.url, 'earnkit.com/kai');
  // Unranked: no ring; the win and the streak take the slots, "Building since" reads under the name.
  const u = shareCardFacts(d({ rankListed: false, score: null, bench: null }), site());
  assert.deepEqual(u.tiles.map((t) => t.kind), ['won', 'streak']);
  assert.deepEqual(u.project?.facts, ['Building since Jan 2025']);
  // Backing (the Token card: EARNKIT_RAISING on, coin live): backers only from 5.
  const b = shareCardFacts(d(), site({ token: { symbol: 'PAY', backers: 4 } as ProfileSite['token'] }));
  assert.deepEqual(b.tiles[1], { kind: 'backing', symbol: 'PAY', backers: null });
  // v3.1 Highlights competence (2026-10-25): no commits tile (the page shows no commit count); "Building since" stays a fact.
  const c = shareCardFacts(d({ rankListed: false, score: null, streak: 0 }), site({ highlights: site().highlights.filter((h) => h.icon !== 'won') }));
  assert.deepEqual(c.tiles, []);
  assert.deepEqual(c.project?.facts, ['Building since Jan 2025']);
  // A confirming project is never named; no project: the calm line and when they joined.
  const start = [{ icon: 'start', title: 'On EarnKit since Oct 23', sub: 'No project on the leaderboard yet' }];
  for (const x of [d({ project: { name: 'Paylink', confirmed: false } as ProfileData['project'] }), d({ project: null })]) {
    const i = shareCardFacts(x, site({ highlights: start as ProfileSite['highlights'] }));
    assert.equal(i.project, null);
    assert.deepEqual(i.idle, { line: 'Building with AI', sub: 'On EarnKit since Oct 23' });
    assert.deepEqual(i.tiles, []);
  }
  assert.equal(shareCardFacts(d({ project: null }), site({ starting: true, highlights: start as ProfileSite['highlights'] })).idle?.line, 'Getting started on Base');
});

test('T6.4 the badge: unchanged geometry, label black, value brand blue, white text, muted when not found, aria-label unchanged', () => {
  const svg = badgeSvg('Shipping 72 · #3');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20" role="img" aria-label="EarnKit: Shipping 72 · #3">/);
  assert.ok(svg.includes(`fill="${THEME.page}"`) && svg.includes(`fill="${THEME.brand}"`), 'label black, value brand');
  assert.equal(svg.match(new RegExp(`fill="${THEME.text}"`, 'g'))?.length, 2, 'white text on both halves');
  assert.doesNotMatch(svg, /#0F1839|#579DFF|#F6F9FE|#3A4466/i);
  const miss = badgeSvg('not found', { muted: true });
  assert.ok(miss.includes(`fill="${THEME.muted}"`) && !miss.includes(`fill="${THEME.brand}"`));
  assert.match(miss, /aria-label="EarnKit: not found"/);
});

test('T6.5 scripts/og.mts renders a 1200x630 PNG from the hero words, and public/og.png is one', async () => {
  const { ogImage } = await import('../../scripts/og.mjs');
  const png = await ogImage();
  const ihdr = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual(ihdr(png), { w: 1200, h: 630 });
  assert.deepEqual(ihdr(readFileSync(join(ROOT, 'public/og.png'))), { w: 1200, h: 630 });
  const src = readFileSync(join(ROOT, 'scripts/og.mts'), 'utf8');
  assert.match(src, /BENCH_HERO_TITLE/);
  assert.match(src, /BENCH_HERO_SUBTITLE/);
  assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b/i, 'no hex outside THEME');
});
