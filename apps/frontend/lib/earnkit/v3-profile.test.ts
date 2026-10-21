import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchProfileView, { BenchProfileSkeleton, TAB_LOG, TAB_MONEY, TAB_PROJECT, VISITOR_CTA, confirmingCardLine, noProjectLine } from '../../app/[handle]/BenchProfileView';
import MoneyTab, { APPLIED_EMPTY, APPLIED_TITLE, BACKING_TITLE, FITS_EMPTY, FITS_TITLE } from '../../app/[handle]/MoneyTab';
import ShareButton from '../../app/[handle]/ShareButton';
import { BADGE_COPY_LINE } from '../../app/[handle]/BadgeCopy';
import { tabOf } from '../../app/[handle]/handle-view';
import { DATA } from './fixtures/profile-data';
import { POINTS_PAGE_LINE } from './points';
import type { MoneyTabData, ProfileData } from './bench-data';

/**
 * v3 Stage 3 Task 3 (spec 5.6 Profile, 5.8): the profile as a header row, the three numbers, a grid, a dated log,
 * the Money tab and the share button, on the flat system. The rank parts are rendered as given (Task 4 changes the
 * words); this page adds no "this week" of its own.
 */
(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const MONEY: MoneyTabData = {
  fits: [{ title: 'Avalanche Team1 Mini Grants', prize: 'up to $10K', when: 'open all year', why: 'It fits your project.', href: '/programs/avalanche-team1-mini-grants' }],
  applied: [{ title: 'Base Builder Grants', status: 'won' }, { title: 'Arc Builder Grants', status: 'applied' }],
  backing: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1', backers: 2, earned_usd: 200 },
  points: 1200,
};
/** The fixture in Task 4's rank words (the page renders the parts it gets). */
const RANKED: ProfileData = {
  ...DATA, bench: '#3 of 40 builders', line: 'Shipping 62 · #3 of 40 builders',
  chainLines: [{ chain: 'base', label: 'Base', line: 'Top 1% of builders on Base' }],
  earned: { paid_usd: 340, waiting_usd: 0 }, money: MONEY,
};
const NO_PROJECT: ProfileData = {
  ...RANKED, backing: null, bench: null, rankListed: false, line: null, score: null, why: null, target: null, originality: null, chainLines: [], project: null, log: [], streak: 0,
  grid: RANKED.grid.map((g) => ({ ...g, on: false })), money: { fits: [], applied: [], backing: null, points: 0 },
};
const CONFIRMING: ProfileData = { ...RANKED, project: { ...RANKED.project!, confirmed: false } };
const numbers = (h: string) => {
  const at = h.indexOf('data-ek-numbers');
  assert.ok(at >= 0, 'data-ek-numbers');
  return h.slice(at, h.indexOf('</ul>', at));
};

test('(a) the three numbers row: the Shipping ring, the rank and Earned, each with its caption, in that order', () => {
  const h = html(React.createElement(BenchProfileView, { data: RANKED, tab: 'log' }));
  const row = numbers(h);
  assert.equal((row.match(/<li[ >]/g) ?? []).length, 3, row);
  for (const s of ['aria-label="Shipping 62 of 100"', '>Shipping<', '>#3<', '>of 40 builders<', '>$340<', '>Earned<']) assert.ok(row.includes(s), s);
  assert.ok(row.indexOf('Shipping 62 of 100') < row.indexOf('>#3<') && row.indexOf('>#3<') < row.indexOf('data-ek-earned'), 'order');
  assert.equal((h.match(/role="img" aria-label="Shipping/g) ?? []).length, 1, 'one ring');
  // The percentile form: "Top 4%" with "of builders" under it.
  const top = numbers(html(React.createElement(BenchProfileView, { data: { ...RANKED, bench: 'Top 4% of builders', line: 'Shipping 62 · Top 4% of builders' }, tab: 'log' })));
  assert.ok(top.includes('>Top 4%<') && top.includes('>of builders<'), top);
  // Unranked: no rank and no Earned figure (dashes in their place).
  const un = numbers(html(React.createElement(BenchProfileView, { data: { ...RANKED, bench: null, rankListed: false, line: null, chainLines: [] }, tab: 'log' })));
  assert.doesNotMatch(un, /data-ek-earned|>\$\d|>#\d/);
  // Under the row: the why and the target as one line, Originality, then the chain line with its logo.
  const t = text(h);
  assert.ok(t.includes('Code in 7 of the last 12 weeks, 3 of the last 4. Code this week passes #2.'), t);
  assert.ok(t.includes('Originality 72'), t);
  assert.ok(h.includes('Top 1% of builders on Base') && h.includes('alt="Base"'));
});

test('(b) the Money tab: Programs that fit, Applications, Backing (open only), then the points line; empty groups invite', () => {
  const h = html(React.createElement(BenchProfileView, { data: RANKED, tab: 'money' }));
  assert.match(h, /aria-current="page"[^>]*>Money/);
  for (const s of [`>${FITS_TITLE}</h2>`, `>${APPLIED_TITLE}</h2>`, `>${BACKING_TITLE}</h2>`]) assert.ok(h.includes(s), s);
  assert.ok(h.indexOf(FITS_TITLE) < h.indexOf(APPLIED_TITLE) && h.indexOf(APPLIED_TITLE) < h.indexOf(BACKING_TITLE), 'order');
  assert.match(h, /<a[^>]*href="\/programs\/avalanche-team1-mini-grants"[^>]*>[\s\S]*?Avalanche Team1 Mini Grants[\s\S]*?It fits your project\.[\s\S]*?up to \$10K[\s\S]*?open all year/);
  assert.ok(h.includes('Base Builder Grants') && h.includes('Arc Builder Grants'));
  assert.match(h, /Base Builder Grants[\s\S]{0,300}>Won</);
  // Final review: "Won" is text weight, never the accent (it would read as a link).
  assert.match(h, /class="[^"]*font-medium text-ek-text[^"]*">Won</);
  assert.match(h, /Arc Builder Grants[\s\S]{0,300}>Applied</);
  const t = text(h);
  // The coin's pill (Stage 2's "Backing · $SYM", the one link to tokens.fun here) with its backers and "$X in fees" (never "earned": the header Earned is prizes plus fees).
  assert.match(h, /data-pill="backing"[^>]*>Backing · \$RECIPE</);
  assert.ok(t.includes('2 backers') && t.includes('$200 in fees') && !t.includes('$200 earned'), t);
  assert.ok(t.includes('1,200 points') && t.includes(POINTS_PAGE_LINE), t);
  assert.ok(h.indexOf(BACKING_TITLE) < h.indexOf(POINTS_PAGE_LINE), 'points last');
  // Backing closed (or the flag off): no Backing group; empty fits and applications say what shows here.
  const none = html(React.createElement(MoneyTab, { money: { fits: [], applied: [], backing: null, points: 0 } }));
  assert.doesNotMatch(none, new RegExp(`>${BACKING_TITLE}</h2>`));
  assert.ok(none.includes(FITS_EMPTY) && none.includes(APPLIED_EMPTY), none);
  assert.ok(text(none).includes('0 points'));
  assert.equal(TAB_MONEY, 'Money');
  assert.equal(tabOf({ tab: 'money' }), 'money');
  assert.equal(tabOf({ tab: 'project' }), 'project');
  assert.equal(tabOf({}), 'log');
  assert.match(h, /href="\/maya_makes\?tab=money"/);
});

test('(c) the share button on the page itself: a secondary link to /<handle>/share', () => {
  const h = html(React.createElement(BenchProfileView, { data: RANKED, tab: 'log' }));
  assert.match(h, /<a[^>]*href="\/maya_makes\/share"[^>]*>Share<\/a>/, h.slice(0, 1500));
  const b = html(React.createElement(ShareButton, { handle: 'maya_makes' }));
  assert.match(b, /href="\/maya_makes\/share"/);
  // Final review: a reserved handle shares from its own page path, /b/<handle>/share.
  assert.match(html(React.createElement(ShareButton, { handle: 'terms' })), /href="\/b\/terms\/share"/);
  assert.match(b, /border-ek-line-strong/, 'secondary');
  // The Back button beside it when backing is open; neither is the primary.
  assert.match(h, /data-ek-back[^>]*>Back Recipe planner</);
  assert.equal((h.match(/rounded-full bg-ek-brand/g) ?? []).length, 1, 'one primary action: the visitor row');
});

test('(d) confirming and no project: the header row and a muted three-numbers row with dashes, never a rank or a grid', () => {
  for (const [d, line] of [[CONFIRMING, confirmingCardLine('Maya Chen', 'Recipe planner')], [NO_PROJECT, noProjectLine('Maya Chen')]] as const) {
    const h = html(React.createElement(BenchProfileView, { data: d, tab: 'log' }));
    assert.ok(h.includes(line), line);
    assert.ok(h.includes('Maya Chen') && h.includes('@maya_makes'), 'the header');
    const row = numbers(h);
    assert.equal((row.match(/<li[ >]/g) ?? []).length, 3, row);
    assert.equal((row.match(/–/g) ?? []).length, 3, 'three dashes');
    for (const s of ['>Shipping<', '>Rank<', '>Earned<']) assert.ok(row.includes(s), s);
    assert.doesNotMatch(h, /#3|of 40 builders|of 100|data-week=|Code in \d+ of/);
    assert.doesNotMatch(h, /animate-ping|animate-pulse/, 'nothing moves');
  }
});

test('(e) the page adds no "this week" of its own after "builders"', () => {
  for (const tab of ['log', 'project', 'money'] as const) {
    const h = text(html(React.createElement(BenchProfileView, { data: RANKED, tab })));
    assert.doesNotMatch(h, /builders this week/, tab);
  }
});

test('(f) the flat system: no card radius, no gradient, no glow, no uppercase; the grid is hairline cells with a brand fill', () => {
  for (const tab of ['log', 'project', 'money'] as const) {
    // v3.1 Task 5: the shared site footer (its CTA names the agent) is checked in v31-site-chrome.test.ts (the v3.1 card system).
    const h = html(React.createElement(BenchProfileView, { data: RANKED, tab })).replace(/<footer[\s\S]*<\/footer>/, '');
    assert.doesNotMatch(h, /rounded-\[24px\]|rounded-\[3px\]|bg-gradient|linear-gradient|drop-shadow|shadow-|uppercase|tracking-widest/, tab);
  }
  const h = html(React.createElement(BenchProfileView, { data: RANKED, tab: 'log' }));
  assert.match(h, /data-week="[^"]+" data-on="true"[^>]*class="[^"]*bg-ek-brand/);
  assert.match(h, /data-week="[^"]+" data-on="false"[^>]*class="[^"]*border-ek-line/);
  assert.doesNotMatch(h, /data-on="true"[^>]*style=/, 'no per-cell opacity ramp');
  assert.ok(h.includes('6 weeks in a row') && h.includes('Code in 6 of the last 52 weeks'));
  const sk = html(React.createElement(BenchProfileSkeleton, { head: { name: 'Maya Chen', handle: 'maya_makes', avatar: null } }));
  assert.doesNotMatch(sk, /rounded-\[24px\]|animate-/);
});

test('(g) the tabs are three links; the log rows carry the week left and the note as a quote; the visitor row and the sources line close the page', () => {
  const h = html(React.createElement(BenchProfileView, { data: RANKED, tab: 'log' }));
  for (const t of [TAB_LOG, TAB_PROJECT, TAB_MONEY]) assert.ok(h.includes(`>${t}</a>`), t);
  assert.equal((h.match(/data-shape="long"/g) ?? []).length, 3);
  assert.match(h, /data-shape="long"[^>]*class="[^"]*border-t border-ek-line/);
  assert.match(h, /data-ek-week=""[^>]*>Week of Oct 12</);
  assert.match(h, /<blockquote data-ek-note=""[^>]*><p[^>]*>Added fridge photo import/);
  assert.ok(h.includes(VISITOR_CTA));
  assert.equal((h.match(/Add to your agent/g) ?? []).length, 1);
});

test('(h) the badge: one line that expands to the markdown and Copy; the image always shows when ranked; none unranked', () => {
  const h = html(React.createElement(BenchProfileView, { data: RANKED, tab: 'log' }));
  assert.equal(BADGE_COPY_LINE, 'Badge for your README');
  assert.match(h, /<details[^>]*>\s*<summary[^>]*>[^<]*Badge for your README/);
  assert.ok(h.includes('https://earnkit.com/badge/maya_makes.svg)'), 'the markdown');
  assert.match(h, /<img[^>]*src="\/badge\/maya_makes\.svg"/, 'the image');
  assert.match(h, /<img[^>]*src="\/badge\/maya_makes\.svg"[^>]*alt="EarnKit badge"|<img[^>]*alt="EarnKit badge"[^>]*src="\/badge\/maya_makes\.svg"/, 'a meaningful alt');
  assert.ok(h.indexOf('<img') < h.indexOf('<details') || h.indexOf('src="/badge/') < h.indexOf('<details'), 'the image is outside the fold');
  const un = html(React.createElement(BenchProfileView, { data: NO_PROJECT, tab: 'log' }));
  assert.doesNotMatch(un, /badge/i);
});
