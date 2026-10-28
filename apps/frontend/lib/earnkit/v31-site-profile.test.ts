import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchProfileView, { BenchProfileSkeleton, confirmingCardLine, noProjectLine } from '../../app/[handle]/BenchProfileView';
import { JENIL, JENIL_SITE, MAYA, MAYA_SITE, SAM, SAM_SITE } from './fixtures/profile-data';
import type { ProfileData } from './bench-data';
import { PRIVATE_NAME } from './page-data';
import type { ProfileSite } from './site-data';
import { SCORE_PENDING, nextUpdateLine, weekLine } from './site-copy';
import Money from '../../app/components/site/Money';

/**
 * v3.1 site Task 7: the profile (Profile, BackedBuilder and NewBuilder boards): the blue hero, the navy Shipping
 * score, the rust Streak, the white Activity card, the Token card (only with site.token) and Highlights, then the
 * minimal footer. No points, no Originality, no 52-week grid, no tabs, no Earned, no rank under RANK_MIN_POOL.
 */
// The components use the automatic JSX runtime under Next; tsx compiles them classic, so React is a global here.
(globalThis as { React?: typeof React }).React = React;
const FRONTEND = join(import.meta.dirname, '../..');
const page = (data: ProfileData, site: ProfileSite, n = 1) =>
  renderToStaticMarkup(React.createElement(BenchProfileView, { data, site, page: n })).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
const text = (h: string) => h.replace(/<span data-ek-sign=""[^>]*>([^<]*)<\/span>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
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
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;

test('(a) Jenil: name, @jenilt, the X and GitHub buttons, Share, the EarnKit mark, the Base tile, the about line and the link', () => {
  const h = page(JENIL, JENIL_SITE);
  const hero = block(h, 'data-ek-hero');
  assert.match(hero, /<h1[^>]*>Jenil<\/h1>/);
  assert.ok(text(hero).includes('@jenilt'));
  assert.match(hero, /<a[^>]*href="https:\/\/x\.com\/jenilt"[^>]*aria-label="X profile"/);
  assert.match(hero, /<a[^>]*href="https:\/\/github\.com\/earnkitai\/earnkit"[^>]*aria-label="GitHub"/);
  assert.match(hero, /<a[^>]*href="\/jenilt\/share"[^>]*>Share<\/a>/);
  assert.match(hero, /data-ek-mark="earnkit"/, 'the EarnKit mark');
  assert.match(hero, /role="img" aria-label="Built on Base"[^>]*>[\s\S]*?<svg[^>]*viewBox="0 0 1280 1280"/, 'the Base tile');
  assert.ok(text(hero).includes('Connects builders with capital, from the agent they already use.'));
  assert.match(hero, /<a[^>]*href="https:\/\/earnkit\.com"[^>]*><span[^>]*>earnkit\.com<\/span><svg/);
  // Every external link opens apart from the page.
  for (const m of hero.matchAll(/<a [^>]*href="https:[^"]*"[^>]*>/g)) assert.match(m[0], /target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/, m[0]);
  // Another project: its letter tile on its colour, never the EarnKit mark.
  const maya = block(page(MAYA, MAYA_SITE), 'data-ek-hero');
  assert.doesNotMatch(maya, /data-ek-mark="earnkit"/);
  assert.match(maya, /data-ek-mark="letter"[^>]*>T</);
});

test('(b) the score ring and the streak card', () => {
  const h = page(JENIL, JENIL_SITE);
  const score = block(h, 'data-ek-score');
  assert.match(score, /role="img" aria-label="Shipping score 60 out of 100"/);
  assert.match(score, /stroke-linecap="round"/);
  assert.match(score, /stop-color="#FDBA74"[\s\S]*stop-color="#F97316"/, 'the mid band, light to deep');
  assert.equal(count(score, /<stop /g), 2, 'one hue: two stops');
  assert.match(score, /class="ek-arc"/);
  assert.ok(text(score).includes('How often Jenil ships, out of 100, over 12 weeks.'));
  // Clarity batch: where the number comes from, and how it's scored (the docs' #score card).
  assert.ok(text(score).includes('How often Jenil ships, out of 100, over 12 weeks. From GitHub commits, not self-reported.'));
  assert.match(score, /<a class="[^"]*underline[^"]*" href="\/docs#score">How it(&#x27;|')s scored<\/a>/);
  const streak = block(h, 'data-ek-streak');
  assert.ok(text(streak).includes('5 weeks'));
  const squares = block(streak, 'aria-label="Code in 7 of the last 12 weeks"');
  assert.equal(count(squares, /<span /g), 12);
  assert.equal(count(squares, /bg-s-rust-on/g), 7);
  assert.ok(text(streak).includes('Code in 7 of 12 weeks') && text(streak).includes('This week: 14 commits'));
  // Other bands: good and low.
  assert.match(block(page({ ...JENIL, score: 84 }, JENIL_SITE), 'data-ek-score'), /stop-color="#6EE7A0"[\s\S]*stop-color="#16A34A"/);
  assert.match(block(page({ ...JENIL, score: 22 }, JENIL_SITE), 'data-ek-score'), /stop-color="#FCA5A5"[\s\S]*stop-color="#E5484D"/);
});

test('(c) Activity: the live dot, 3 week cards a page, the pager; page 2 shows the next 3', () => {
  const h = page(JENIL, JENIL_SITE);
  const act = block(h, 'data-ek-activity');
  assert.ok(text(act).includes('Shipped 2h ago'));
  assert.match(act, /class="[^"]*ek-pulse[^"]*"/);
  assert.equal(count(act, /<article/g), 3);
  assert.ok(text(act).includes('Week of Oct 12') && text(act).includes('279 commits'));
  assert.ok(!text(act).includes('Week of Sep 21'));
  const pager = block(act, 'aria-label="Activity pages"');
  assert.ok(pager.includes('>Newer<') && pager.includes('>Older<'));
  assert.match(pager, /aria-current="page"[^>]*>1</);
  assert.match(pager, /href="\/jenilt\?page=2"/);
  const two = block(page(JENIL, JENIL_SITE, 2), 'data-ek-activity');
  assert.equal(count(two, /<article/g), 3);
  for (const w of ['Week of Sep 21', 'Week of Sep 14', 'Week of Aug 24']) assert.ok(text(two).includes(w), w);
  assert.ok(!text(two).includes('Week of Oct 12'));
  assert.match(two, /href="\/jenilt"[^>]*>Newer</, 'page 1 is the plain URL');
  // Out of range reads as the last page; a week older than 7 days gets a static grey dot; no dot line without a push.
  assert.equal(count(block(page(JENIL, JENIL_SITE, 99), 'data-ek-activity'), /<article/g), 3);
  const old = block(page(JENIL, { ...JENIL_SITE, lastShippedAt: new Date(Date.now() - 9 * 86_400_000).toISOString() }), 'data-ek-activity');
  assert.doesNotMatch(old, /ek-pulse/);
  assert.match(old, /bg-s-ink-muted/);
  assert.doesNotMatch(text(block(page(JENIL, { ...JENIL_SITE, lastShippedAt: null }), 'data-ek-activity')), /Shipped (\d|just|yesterday|on )/);
  // An unconfirmed week says so under the week; zero commits hides the commits part.
  const un = block(page({ ...JENIL, log: [{ ...JENIL.log[0], confirmed: false, commits: 0 }] }, JENIL_SITE), 'data-ek-activity');
  assert.ok(text(un).includes('Not yet confirmed'));
  assert.ok(!text(un).includes('0 commits'));
});

test('(d) Token card: only with site.token, with the board copy; site.token null renders none of it', () => {
  const h = page(MAYA, MAYA_SITE);
  const tok = block(h, 'data-ek-token');
  // v4.0 Task 9: the owner-approved wording ("<first>'s token on Base", holders, Trade).
  for (const s of ['$TIPJAR', "Maya's token on Base", '23', 'holders', '$412', 'earned by Maya', 'Maya keeps 40% of fees']) assert.ok(text(tok).includes(s), s);
  const bars = block(tok, 'aria-label="New holders each week, last 12 weeks"');
  assert.equal(count(bars, /<span /g), 12);
  assert.equal(count(bars, /bg-s-bar-on/g), 1, 'the last bar only');
  assert.match(tok, /<a[^>]*href="https:\/\/tokens\.fun\/c\/tipjar"[^>]*>Trade<\/a>/);
  assert.match(tok, /<a[^>]*href="https:\/\/tokens\.fun\/c\/tipjar"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  // Review Focus 1: no Token card, no Back link, no coin line, whatever ProfileData.backing says.
  const none = page(MAYA, { ...MAYA_SITE, token: null });
  assert.doesNotMatch(none, /data-ek-token|tokens\.fun/);
  for (const s of ['$TIPJAR', "Maya's token", 'Trade', 'earned by Maya', 'keeps 40%', 'holders']) assert.ok(!text(none).includes(s), s);
});

test('(e) the standing pill: metal, its place as the title; standing null shows no rank anywhere', () => {
  const h = page(MAYA, MAYA_SITE);
  const pill = block(h, 'data-ek-standing');
  assert.match(pill, /title="Top 3% of builders"/);
  assert.match(pill, /var\(--ek-s-gold-top\)[^"]*var\(--ek-s-gold-mid\)[^"]*var\(--ek-s-gold-bottom\)/);
  assert.match(pill, /text-s-gold-ink/);
  assert.ok(text(pill).includes('Top 3% of builders'));
  for (const tier of ['silver', 'bronze'] as const)
    assert.match(page(MAYA, { ...MAYA_SITE, standing: { label: 'Top 10% of builders', tier, title: 'Top 10% of builders' } }), new RegExp(`--ek-s-${tier}-top`));
  // Review Focus 2: under the pool (standing null) the page says no rank, even with ProfileData's rank words.
  const none = page(MAYA, { ...MAYA_SITE, standing: null });
  assert.doesNotMatch(none, /data-ek-standing/);
  const t = text(none);
  assert.doesNotMatch(t, /Top \d|#\d|#|of \d+ builders/, t);
});

test('(f) first week, no project, confirming: every card has text; nothing reads undefined, null, NaN, "[" or points', () => {
  const sam = page(SAM, SAM_SITE);
  const score = block(sam, 'data-ek-score');
  // QA item 5: no placeholder glyph in the ring (no dash of any kind, no number); the card line explains it.
  assert.ok(text(score).includes(SCORE_PENDING));
  assert.doesNotMatch(text(score), /[-\u2013\u2014]|\d/, text(score));
  assert.doesNotMatch(score, /ek-serif absolute inset-0/, 'no number span in the ring');
  assert.doesNotMatch(score, /ek-arc|<stop /, 'track only');
  assert.match(score, /aria-label="Shipping score not shown yet"/);
  const t = text(sam);
  for (const s of ['Week 2 starts Monday', 'Ship by Sunday', '1 week', nextUpdateLine(new Date()), 'Building Ledgerly since Oct 2026', 'Writing code since 2021']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('Not in the repo'), 'final fix 4: never the negative Builder Code line');
  assert.match(block(sam, 'data-ek-activity'), /border-dashed/);
  const noProject: ProfileData = { ...SAM, project: null, log: [], streak: 0, grid: SAM.grid.map((g) => ({ ...g, on: false })) };
  const noProjectSite: ProfileSite = { ...SAM_SITE, project: null, lastShippedAt: null, highlights: [{ icon: 'start', title: 'On EarnKit since Oct 12', sub: 'No project on the leaderboard yet' }] };
  const confirming: ProfileData = { ...MAYA, project: { ...MAYA.project!, confirmed: false } };
  const pages: [string, string][] = [
    ['sam', sam],
    ['no project', page(noProject, noProjectSite)],
    ['confirming', page(confirming, { ...MAYA_SITE, standing: null, token: null, thisWeek: 0 })],
    ['jenil', page(JENIL, JENIL_SITE)],
    ['maya', page(MAYA, MAYA_SITE)],
  ];
  for (const [name, h] of pages) {
    for (const m of ['data-ek-hero', 'data-ek-score', 'data-ek-streak', 'data-ek-activity', 'data-ek-highlights'])
      assert.ok(text(block(h, m)).trim().length > 0, `${name} ${m}`);
    const body = text(h.split('<footer')[0]);
    assert.doesNotMatch(body, /undefined|null|NaN|\[|\bpoints?\b|\$ /, `${name}: ${body}`);
  }
  const np = pages[1][1];
  assert.ok(text(np).includes(noProjectLine('Sam')));
  assert.ok(text(block(np, 'data-ek-streak')).includes('0 weeks'));
  assert.equal(count(block(np, 'data-ek-streak'), /bg-s-rust-on/g), 0);
  const conf = pages[2][1];
  assert.ok(text(conf).includes(confirmingCardLine('Maya', 'Tipjar')));
  const act = block(conf, 'data-ek-activity');
  assert.equal(count(act, /<article/g), 0, 'confirming: only the dashed box');
  assert.match(act, /border-dashed/);
  assert.ok(text(block(conf, 'data-ek-streak')).includes('0 weeks'));
  assert.ok(text(block(conf, 'data-ek-score')).includes(SCORE_PENDING));
});

test('(g) a hidden repo: Private project, no github.com link, no about line', () => {
  const data: ProfileData = { ...MAYA, project: { ...MAYA.project!, name: PRIVATE_NAME, what: null, live: null, repo: null } };
  const site: ProfileSite = {
    ...MAYA_SITE, token: null, standing: null,
    project: { name: PRIVATE_NAME, about: null, link: null, repo: null, onBase: true, earnkit: false, letter: 'P', color: MAYA_SITE.project!.color },
    highlights: [{ icon: 'consistency', title: 'Shipped in 11 of the last 52 weeks', sub: 'Building since Aug 2026' }],
  };
  const h = page(data, site);
  const hero = block(h, 'data-ek-hero');
  assert.ok(text(hero).includes('Private project'));
  assert.doesNotMatch(h, /github\.com/);
  assert.doesNotMatch(hero, /aria-label="GitHub"/);
  assert.doesNotMatch(text(hero), /Tips for creators/);
  assert.doesNotMatch(hero, /data-ek-about/);
});

test('(h) no Originality, no points, no 52-week grid, no tabs, no Earned, no badge; the minimal footer', () => {
  for (const [d, s] of [[JENIL, JENIL_SITE], [MAYA, MAYA_SITE], [SAM, SAM_SITE]] as const) {
    const h = page(d, s);
    assert.doesNotMatch(h, /Originality|data-ek-grid|data-ek-numbers|aria-label="Tabs"|\?tab=|>Earned<|badge/i);
    assert.doesNotMatch(text(h), /\bpoints?\b/i);
    // The minimal footer: "Get your page", no painting.
    assert.ok(h.includes('Get your page'));
    assert.doesNotMatch(h.slice(h.indexOf('<footer')), /<img/);
  }
  // Layout: two rows on one column template (QA item 3: one seam), every child min-w-0; card radii 28px on a phone, 36px from md.
  const h = page(JENIL, JENIL_SITE);
  for (const m of ['data-ek-hero', 'data-ek-score', 'data-ek-streak', 'data-ek-activity', 'data-ek-highlights'])
    assert.match(block(h, m).slice(0, 400), /rounded-\[28px\][^"]*md:rounded-\[36px\]/, m);
  const rows = [...h.matchAll(/<section aria-label="(Profile|Activity and highlights)" class="([^"]*)"/g)];
  assert.equal(rows.length, 2);
  for (const [, , cls] of rows) assert.ok(cls.startsWith('grid grid-cols-1 gap-4 min-[844px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]'), cls);
  assert.doesNotMatch(h, /flex-\[3_1_460px\]|flex-\[2_1_320px\]|flex-\[3_1_520px\]/, 'no flex bases left to split the rows apart');
});

test('(i) the skeleton is the three card shapes as flat panels, with the name; the files hold no raw colour; transitions are motion-safe', () => {
  const sk = renderToStaticMarkup(React.createElement(BenchProfileSkeleton, { head: { name: 'Maya Chen', handle: 'maya_makes', avatar: null } }));
  assert.ok(sk.includes('Maya Chen') && sk.includes('aria-busy="true"'));
  assert.ok(count(sk, /bg-s-panel/g) >= 3, sk);
  assert.doesNotMatch(sk, /animate-/);
  const dir = join(FRONTEND, 'app/[handle]/site');
  const files = [...readdirSync(dir).map((f) => join(dir, f)), join(FRONTEND, 'app/[handle]/BenchProfileView.tsx'), join(FRONTEND, 'app/[handle]/ScoreRing.tsx')];
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /#[0-9a-f]{3,8}\b|rgba?\(/i, f);
  const h = page(MAYA, MAYA_SITE).split('<footer')[0];
  for (const m of h.matchAll(/class="([^"]*)"/g))
    for (const c of m[1].split(' ')) assert.ok(!/^(transition|duration-|ease-)/.test(c), `bare ${c} in: ${m[1]}`);
});

test('(j) phone: names, handles and project names wrap; every link and button is 44px tall', () => {
  const long: ProfileData = { ...MAYA, name: 'Bartholomew Maximilian Featherstonehaugh-Wolfe III', handle: 'a_very_long_han' };
  const h = page(long, { ...MAYA_SITE, project: { ...MAYA_SITE.project!, name: 'An extraordinarily long project name here' } });
  assert.match(h, /<h1[^>]*class="[^"]*break-words/);
  // An inline link inside a sentence ("How it's scored") is 44px to the touch through INLINE_LINK's -my-3 py-3.
  for (const m of h.split('<footer')[0].matchAll(/<a [^>]*class="([^"]*)"/g)) assert.match(m[1], /min-h-11|h-11|-my-3 py-3/, m[0]);
});

test('(k) v3.1 streak fix: the Streak card shows the data\'s own grid and streak (profileData counted this week); the first-week note gives way while shipping', () => {
  // profileData lit the 12th square (this week) and counted it: the card shows exactly that, never adds a week itself.
  const grid = SAM.grid.map((g, i) => ({ ...g, on: i >= 50 }));
  const h = page({ ...SAM, grid, streak: 2 }, { ...SAM_SITE, thisWeek: 6 });
  const streak = block(h, 'data-ek-streak');
  const squares = block(streak, 'aria-label="Code in 2 of the last 12 weeks"');
  assert.match(squares.match(/<span [^>]*>/g)![11], /bg-s-rust-on/);
  assert.ok(text(streak).includes('2 weeks') && text(streak).includes('Code in 2 of 12 weeks') && text(streak).includes('This week: 6 commits'));
  assert.ok(!text(streak).includes('Week 2 starts Monday'));
  // This week alone is 1 week.
  const gap = block(page({ ...SAM, grid: SAM.grid.map((g, i) => ({ ...g, on: i === 51 })), streak: 1 }, { ...SAM_SITE, thisWeek: 3 }), 'data-ek-streak');
  assert.ok(text(gap).includes('1 week') && gap.includes('aria-label="Code in 1 of the last 12 weeks"'));
  // Nothing this week: as given.
  assert.ok(text(block(page(JENIL, JENIL_SITE), 'data-ek-streak')).includes('5 weeks'));
  assert.ok(text(block(page({ ...SAM, grid: SAM.grid.map((g, i) => ({ ...g, on: i === 50 })), streak: 1 }, SAM_SITE), 'data-ek-streak')).includes('Week 2 starts Monday'));
  // Quiet pages never light it.
  const conf = block(page({ ...MAYA, project: { ...MAYA.project!, confirmed: false } }, { ...MAYA_SITE, thisWeek: 9 }), 'data-ek-streak');
  assert.ok(!conf.includes('bg-s-rust-on') && text(conf).includes('0 weeks'));
  assert.equal(weekLine(123456), 'This week: 123,456 commits');
});

test('(l) fix round 1: money signs in Funnel Sans; the coin is the project tile; no repeated commits chip; the minimal footer gap', () => {
  const sign = (h: string) => h.match(/<span data-ek-sign="" class="font-funnel-sans[^"]*">\$<\/span>/g) ?? [];
  assert.equal(renderToStaticMarkup(React.createElement(Money, { text: '$412' })), '<span data-ek-sign="" class="font-funnel-sans font-normal">$</span>412');
  assert.equal(renderToStaticMarkup(React.createElement(Money, { text: 'up to €5,000 or £3' })).match(/data-ek-sign/g)!.length, 2);
  assert.equal(renderToStaticMarkup(React.createElement(Money, { text: 'Tipjar' })), 'Tipjar');
  const tok = block(page(MAYA, MAYA_SITE), 'data-ek-token');
  assert.equal(sign(tok).length, 2, 'the ticker and the fees');
  assert.match(tok, /<span data-ek-sign[^>]*>\$<\/span>TIPJAR/);
  assert.match(tok, /<span data-ek-sign[^>]*>\$<\/span>412/);
  // v4.0 Task 9: the circle is the builder's (their initial on its colour without a photo), never the project tile.
  const coin = page(MAYA, { ...MAYA_SITE, token: { ...MAYA_SITE.token!, letter: 'M', color: 'rgb(1, 2, 3)' }, project: { ...MAYA_SITE.project!, letter: 'Q', color: 'x' } });
  assert.match(block(coin, 'data-ek-token'), /style="background:rgb\(1, 2, 3\)">M</);
  // A facts-only week with its commits at the right does not repeat them in the words.
  const act = block(page({ ...JENIL, log: [{ week: '2026-10-12', text: null, chips: ['Went live', '12 commits'], commits: 12 }] }, JENIL_SITE), 'data-ek-activity');
  assert.equal((text(act).match(/12 commits/g) ?? []).length, 1);
  assert.ok(text(act).includes('Went live'));
  const only = block(page({ ...JENIL, log: [{ week: '2026-10-12', text: null, chips: ['12 commits'], commits: 12 }] }, JENIL_SITE), 'data-ek-activity');
  assert.equal((text(only).match(/12 commits/g) ?? []).length, 1);
  // The minimal footer sits 72px under the cards on desktop.
  assert.match(page(JENIL, JENIL_SITE), /<footer class="[^"]*md:mt-\[72px\]/);
});
