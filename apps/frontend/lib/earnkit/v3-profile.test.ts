import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchProfileView, { BenchProfileSkeleton, confirmingCardLine, noProjectLine } from '../../app/[handle]/BenchProfileView';
import ShareButton, { SHARE_LABEL } from '../../app/[handle]/ShareButton';
import { pageOf, tabOf } from '../../app/[handle]/handle-view';
import { DATA, siteOf } from './fixtures/profile-data';
import type { ProfileData } from './bench-data';
import type { ProfileSite } from './site-data';

/**
 * v3 Stage 3 (spec 5.6 Profile, 5.8), rewritten for v3.1 site Task 7 (plan S15): the profile keeps Share (to
 * /<handle>/share), the Shipping ring and the dated log; the tabs, the numbers row (rank, Earned), Originality, points,
 * the 52-week grid, the visitor row and the badge left the page. `?tab=` is still parsed and ignored; `?page=` pages
 * the Activity card. The rank rules live on: no rank while unranked, confirming or without a project, and never
 * "builders this week".
 */
(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const view = (data: ProfileData, site: ProfileSite = siteOf(data), page = 1) => html(React.createElement(BenchProfileView, { data, site, page }));

/** The fixture in Task 4's rank words: the page must not print them (the standing pill is the one rank on the page). */
const RANKED: ProfileData = {
  ...DATA, bench: '#3 of 40 builders', line: 'Shipping 62 · #3 of 40 builders',
  chainLines: [{ chain: 'base', label: 'Base', line: 'Top 1% of builders on Base' }],
  earned: { paid_usd: 340, waiting_usd: 0 }, points: 1200,
};
const NO_PROJECT: ProfileData = {
  ...RANKED, backing: null, bench: null, rankListed: false, line: null, score: null, why: null, target: null, originality: null, chainLines: [], project: null, log: [], streak: 0,
  grid: RANKED.grid.map((g) => ({ ...g, on: false })),
};
const CONFIRMING: ProfileData = { ...RANKED, project: { ...RANKED.project!, confirmed: false } };

test('(a) one Shipping ring with its number; no rank words, no Earned, no Originality, no points from ProfileData', () => {
  const h = view(RANKED);
  assert.equal((h.match(/role="img" aria-label="Shipping score 62 out of 100"/g) ?? []).length, 1, 'one ring');
  const t = text(h);
  for (const s of ['#3', 'of 40 builders', 'Top 1% of builders on Base', 'Earned', '$340', 'Originality', 'points', 'Code this week passes #2.']) assert.ok(!t.includes(s), s);
  // The one rank on the page is the standing pill, and only when site.standing says so (Task 3: RANK_MIN_POOL).
  const pill = view(RANKED, siteOf(RANKED, { standing: { label: 'Top 8% on Base', tier: 'silver', title: '#3 of 40 builders on Base' } }));
  assert.match(pill, /data-ek-standing="" title="#3 of 40 builders on Base"[^>]*>[\s\S]*?Top 8% on Base</);
});

test('(b) tabs are gone: no tab rail, no ?tab= link, no Money or Project group; tabOf still parses and is ignored; pageOf reads ?page=', () => {
  const h = view(RANKED);
  assert.doesNotMatch(h, /aria-label="Tabs"|\?tab=|Ship log|Programs that fit|Ways to get funded|Backing · \$RECIPE/);
  assert.equal(tabOf({ tab: 'money' }), 'money');
  assert.equal(tabOf({ tab: 'project' }), 'project');
  assert.equal(tabOf({}), 'log');
  assert.equal(pageOf({ page: '2' }), 2);
  assert.equal(pageOf({ page: ['3', '4'] }), 3);
  for (const bad of [{}, { page: '0' }, { page: '-1' }, { page: '1.5' }, { page: 'x' }]) assert.equal(pageOf(bad), 1, JSON.stringify(bad));
});

test('(c) Share on the page itself: the white pill to /<handle>/share; a reserved handle shares from /b/<handle>/share', () => {
  const h = view(RANKED);
  assert.match(h, /<a[^>]*href="\/maya_makes\/share"[^>]*>Share<\/a>/);
  assert.equal(SHARE_LABEL, 'Share');
  const b = html(React.createElement(ShareButton, { handle: 'maya_makes' }));
  assert.match(b, /href="\/maya_makes\/share"/);
  assert.match(b, /bg-s-light[^"]*text-s-ink/, 'the white pill');
  assert.match(b, /min-h-11/, '44px');
  assert.match(html(React.createElement(ShareButton, { handle: 'terms' })), /href="\/b\/terms\/share"/);
  // v3.1: the Back button left the hero (backing is the Token card's, from site.token only).
  assert.doesNotMatch(h, /data-ek-back|Back Recipe planner/);
});

test('(d) confirming and no project: the hero and one calm line; no score, no rank, no lit week, nothing moves', () => {
  for (const [d, line] of [[CONFIRMING, confirmingCardLine('Maya Chen', 'Recipe planner')], [NO_PROJECT, noProjectLine('Maya Chen')]] as const) {
    const h = view(d);
    assert.ok(h.includes(line), line);
    assert.ok(h.includes('Maya Chen') && h.includes('@maya_makes'), 'the hero');
    assert.match(h, /aria-label="Shipping score not shown yet"/);
    assert.doesNotMatch(h, /#3|of 40 builders|out of 100|bg-s-rust-on|data-ek-standing/);
    assert.doesNotMatch(h, /ek-pulse|animate-ping|animate-pulse/, 'nothing moves');
  }
});

test('(e) the page adds no "this week" of its own after "builders"', () => {
  for (const site of [siteOf(RANKED), siteOf(RANKED, { thisWeek: 14, standing: { label: 'Top 3% of builders', tier: 'gold', title: '#1 of 40 builders' } })])
    assert.doesNotMatch(text(view(RANKED, site)), /builders this week/);
});

test('(f) the skeleton: the name and handle at once on a flat hero, the other cards as flat shapes, nothing animated', () => {
  const sk = html(React.createElement(BenchProfileSkeleton, { head: { name: 'Maya Chen', handle: 'maya_makes', avatar: null } }));
  assert.ok(sk.includes('Maya Chen') && sk.includes('@maya_makes'));
  assert.match(sk, /aria-busy="true"/);
  assert.doesNotMatch(sk, /animate-|ek-pulse|ek-arc|linear-gradient/);
});

test('(g) the dated log: week cards with the week, the commits and the words; a facts-only week reads its chips; the Started card its line', () => {
  const h = view(RANKED);
  const act = h.slice(h.indexOf('data-ek-activity'));
  assert.equal((act.match(/<article/g) ?? []).length, 3);
  assert.match(act, />Week of Oct 12</);
  assert.ok(text(act).includes('Added fridge photo import'));
  assert.ok(text(act).includes('3 commits'));
  assert.ok(text(act).includes('Started tracking Recipe planner.'));
});

test('(h) no badge, no visitor row, no sources line on the page (the badge route stays)', () => {
  const h = view(RANKED);
  assert.doesNotMatch(h, /badge|Want your own page|Every fact is checked/i);
});
