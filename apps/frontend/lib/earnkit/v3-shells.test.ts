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
import { walletOtherMethod } from './wallet-proof';
import { WORDMARK_D } from '../../app/components/ui/Logo';
import { benchCard, headlineSize } from '../../app/[handle]/card-response';
import type { BenchCardFacts } from './bench-data';

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
  await assertFlatShell(walletOtherMethod(), 405, 'wallet 405');
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

const FACTS: BenchCardFacts = {
  handle: 'maya_makes', name: 'Maya Chen', avatar: null, bench: 'Shipping 91 · #1 of 40 builders', project: 'recipes', streak: 6, raising: 'RCP', score: 91, earned: 340,
};

test('T6.3 the card: black from THEME, the wordmark, name and handle, the rank line as the 64px headline, Shipping and Earned, project and streak, the URL, the Backing pill', () => {
  const src = readFileSync(join(ROOT, 'app/[handle]/card-response.tsx'), 'utf8');
  assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b/i, 'no hex outside THEME');
  assert.match(src, /from '\.\.\/\.\.\/lib\/earnkit\/theme'/);
  assert.doesNotMatch(src, /gradient\(/);
  const html = renderToStaticMarkup(benchCard(FACTS, null, true));
  assert.ok(html.includes(`background-color:${THEME.page}`), 'black');
  assert.ok(html.includes(WORDMARK_D.slice(0, 40)), 'the wordmark');
  assert.ok(html.includes('Maya Chen') && html.includes('@maya_makes'));
  assert.match(html, /font-size:64px[^>]*>#1 of 40 builders</, 'the rank line is the 64px headline');
  assert.match(html, />91<[\s\S]*?>Shipping</, 'Shipping');
  assert.match(html, />\$340<[\s\S]*?>Earned</, 'Earned');
  assert.ok(html.includes('recipes · 6 weeks in a row'), 'project and streak');
  assert.ok(html.includes('earnkit.com/maya_makes'), 'the URL');
  assert.ok(html.includes('Backing · $RCP'), 'the pill');
  assert.doesNotMatch(html, /Shipping 91 · /, 'the score line is split into its numbers, not repeated');
  assert.equal(headlineSize('#1 of 40 builders'), 64);
  // No Earned at zero; no pill while closed; unranked: the project is the headline and no number shows.
  const quiet = renderToStaticMarkup(benchCard({ ...FACTS, earned: null, raising: null }, null, true));
  assert.doesNotMatch(quiet, /Earned|Backing/);
  const unranked = renderToStaticMarkup(benchCard({ ...FACTS, bench: null, score: null, earned: null }, null, true));
  assert.doesNotMatch(unranked, /Shipping|Earned|>91</);
  assert.match(unranked, /font-size:64px[^>]*>recipes</);
  // Every colour on the card is a THEME value.
  for (const hex of html.match(/#[0-9a-f]{6}/gi) ?? []) assert.ok(Object.values(THEME).includes(hex as never), `card hex ${hex}`);
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
