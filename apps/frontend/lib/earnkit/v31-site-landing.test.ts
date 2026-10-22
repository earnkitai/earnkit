import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HomeView from '../../app/HomeView';
import { ARCH_PATH } from '../../app/components/landing/HeroArt';
import type { FeedCard } from './feed';
import type { Landing, Tile } from './landing';
import { SITE } from './site-theme';
import { unsign } from './fixtures/page-words';
import {
  ACTIVITY_INVITE_TEXT,
  ACTIVITY_INVITE_TITLE,
  ACTIVITY_MORE,
  CTA_INSTALL,
  EARN_FOOT,
  EARN_TITLE,
  HERO_SUB,
  HERO_TITLE,
  STEPS,
  STEPS_TITLE,
} from './site-copy';

/**
 * v3.1 site Task 6: the landing (Landing board): the hero (chip, title, sub line, the install CTA, the agent
 * marks, the painting with its arch light), the three steps, Activity (landing.activity) and Earning
 * opportunities (landingPrograms of landing.tiles), then the full footer.
 */
// The components use the automatic JSX runtime under Next; tsx compiles them classic, so React is a global here.
(globalThis as { React?: typeof React }).React = React;
const FRONTEND = join(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(join(FRONTEND, p), 'utf8');
const raw = (landing: Landing | null) => renderToStaticMarkup(React.createElement(HomeView, { landing }));
/** The markup with Money's sign spans unwrapped (test (j) pins the spans on `raw`). */
const html = (landing: Landing | null) => unsign(raw(landing));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
const esc = (s: string) => s.replace(/[().*+?^$|[\]\\{}]/g, '\\$&');
/** The markup of one section, by its id. */
const section = (h: string, id: string) => {
  const at = h.indexOf(`id="${id}"`);
  if (at < 0) return '';
  const start = h.lastIndexOf('<section', at);
  return h.slice(start, h.indexOf('</section>', at) + '</section>'.length);
};

const card = (id: number, o: Partial<FeedCard> = {}): FeedCard => ({
  id,
  handle: `dev${id}`,
  name: `Dev ${id}`,
  avatar: `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg`,
  project: 'EarnKit',
  week: '2026-10-12',
  text: null,
  summary: `Shipped part ${id}.`,
  chips: ['3 commits'],
  pinned: false,
  score: 60,
  commits: 279,
  ...o,
});
const tile = (id: string, o: Partial<Tile> = {}): Tile => ({
  id,
  title: id,
  chain: 'Base',
  prize: 'up to $5,000 per grant',
  prize_note: null,
  prize_usd: 5000,
  pool_usd: null,
  difficulty: 'Medium',
  days_left: 'rolling',
  status: 'active',
  in_person: false,
  logo: null,
  kind: 'grant',
  big: '$5K',
  when: 'Rolling',
  ...o,
});
const TILES: Tile[] = [
  tile('base-builder-grants', { title: 'Base Builder Grant Program', logo: '/programs/base-builder-grants.svg' }),
  tile('alliance-all19', { title: 'Alliance ALL19', big: '$400K', prize_usd: 400000, kind: 'investment', when: 'Closes Nov 18' }),
  tile('a16z-speedrun', { title: 'a16z speedrun SR008', big: '$1M', prize_usd: 1000000, kind: 'investment', when: 'Closes Nov 2', logo: '/programs/a16z-speedrun.png' }),
  tile('circle-developer-grants', { title: 'Circle Developer Grants', big: null, prize_usd: 0, prize: 'milestone-based USDC grants', kind: 'grant, in USDC' }),
  tile('monad-nitro', { title: 'Monad Nitro', big: '$500K' }),
];
const LANDING: Landing = {
  open_text: '$105K in grants open',
  open_more: null,
  open_chip: '$105K in grants open now',
  tiles: TILES,
  stats_line: null,
  won_line: null,
  activity: [
    card(1, { handle: 'jenilt', name: 'Jenil', score: 60 }),
    card(2, { score: 84, summary: null, text: 'Wrote the docs.' }),
    card(3, { score: 21, summary: null, text: null, chips: ['12 commits', 'went live'], commits: 0 }),
  ],
};

test('(a) order: chip, h1, sub, one install button in the hero, four agent marks; then the steps, Activity, Earning opportunities, the footer', () => {
  const h = html(LANDING);
  const hero = h.slice(0, h.indexOf('</section>'));
  const order = [
    LANDING.open_chip!,
    `>${HERO_TITLE}</h1>`,
    HERO_SUB,
    `>${CTA_INSTALL}</button>`,
    'aria-label="Grok Bot"',
    'aria-label="Claude Code"',
    'aria-label="Codex"',
    'aria-label="Muse"',
  ].map((s) => hero.indexOf(s));
  assert.ok(order.every((n) => n >= 0), `all in the hero: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in order');
  assert.equal((hero.match(/<button/g) ?? []).length, 1, 'one button in the hero');
  assert.equal((hero.match(/role="img"/g) ?? []).length, 4, 'four marks');
  assert.equal((h.match(/<h1/g) ?? []).length, 1);
  const after = [`>${STEPS_TITLE}</h2>`, '>Activity</h2>', `>${EARN_TITLE}</h2>`, '<footer'].map((s) => h.indexOf(s));
  assert.ok(after.every((n) => n > order.at(-1)!), `after the hero: ${after}`);
  assert.deepEqual([...after].sort((a, b) => a - b), after);
  // The deep page: the body turns s-deep.
  // React hoists the image preloads ahead of it; the page root is the first <div>.
  assert.match(h.slice(h.indexOf('<div')), /^<div[^>]*data-ek-deep=""/);
  // The marks take the text colour (no raw hex in the mark).
  assert.doesNotMatch(read('app/components/site/AgentMarks.tsx'), /#[0-9a-f]{3,8}\b/i);
  assert.match(h, /<span[^>]*role="img"[^>]*aria-label="Grok Bot"[^>]*class="[^"]*text-s-text/);
});

test('(b) the chip is landing.open_chip linking #earn; open_chip null renders no chip', () => {
  const h = html(LANDING);
  assert.match(h, new RegExp(`<a [^>]*href="#earn"[^>]*>.*?${esc(LANDING.open_chip!)}</span></a>`));
  const none = html({ ...LANDING, open_chip: null });
  assert.doesNotMatch(none, /href="#earn"/);
  assert.doesNotMatch(text(none), /open now/);
});

test('(c) Activity: 3 cards, names to /<handle>, x.com links, score colour by band, meta; no score span without a score; commits 0 drops the commits part', () => {
  const act = section(html(LANDING), 'activity');
  assert.ok(act, 'the Activity section');
  assert.match(act, /<a [^>]*href="\/leaderboard"[^>]*>See the leaderboard<\/a>/);
  assert.equal(ACTIVITY_MORE, 'See the leaderboard');
  const cards = act.split('<article').slice(1);
  assert.equal(cards.length, 3);
  for (const [i, handle] of ['jenilt', 'dev2', 'dev3'].entries()) {
    assert.match(cards[i], new RegExp(`<a [^>]*href="/${handle}"[^>]*>`), handle);
    assert.match(cards[i], new RegExp(`href="https://x.com/${handle}"`));
    assert.ok(cards[i].includes(`@${handle}`));
  }
  assert.match(cards[0], /class="[^"]*text-s-mid-text[^"]*"[^>]*>60</);
  assert.match(cards[1], /class="[^"]*text-s-good-text[^"]*"[^>]*>84</);
  assert.match(cards[2], /class="[^"]*text-s-low-text[^"]*"[^>]*>21</);
  assert.ok(text(cards[0]).includes('EarnKit · Week of Oct 12 · 279 commits'));
  assert.ok(text(cards[0]).includes('Shipped part 1.'), 'the summary');
  assert.ok(text(cards[1]).includes('Wrote the docs.'), 'the text without a summary');
  assert.ok(text(cards[2]).includes('12 commits · went live'), 'the chips without either');
  assert.ok(text(cards[2]).includes('EarnKit · Week of Oct 12 '), 'meta');
  assert.doesNotMatch(text(cards[2]), /Week of Oct 12 · /, 'commits 0: no commits part');
  assert.match(cards[0], /<img[^>]*src="https:\/\/pbs\.twimg\.com\/profile_images\/1\/a_normal\.jpg"/, 'the X photo');
  // Fix round 1: an empty summary falls back to the text.
  const blank = section(html({ ...LANDING, activity: [card(1, { summary: '', text: 'The note.' })] }), 'activity');
  assert.ok(text(blank).includes('The note.'));
  // Fix round 1: the name and the handle are each a 44px phone target, stacked without overlapping (each pulls in its outer side only).
  const name = cards[0].match(/<a [^>]*href="\/jenilt"[^>]*class="([^"]*)"/)?.[1] ?? cards[0].match(/<a [^>]*class="([^"]*)"[^>]*href="\/jenilt"/)?.[1] ?? '';
  const handle = cards[0].match(/<a [^>]*href="https:\/\/x\.com\/jenilt"[^>]*class="([^"]*)"/)?.[1] ?? '';
  for (const [cls, pull] of [[name, '-mt-[11px]'], [handle, '-mb-[13px]']] as const) {
    const c = cls.split(' ');
    assert.ok(c.includes('min-h-11') && c.includes(pull), cls);
    assert.ok(!c.some((x) => /^-my-|^-mb-/.test(x) && x !== pull) && !c.some((x) => /^-mt-/.test(x) && x !== pull), cls);
  }

  const noScore = section(html({ ...LANDING, activity: [card(1, { score: null }), card(2), card(3)] }), 'activity').split('<article')[1];
  assert.doesNotMatch(noScore, /text-s-(good|mid|low)-text/, 'no score span');
  const one = section(html({ ...LANDING, activity: [card(1, { commits: 1 })] }), 'activity');
  assert.ok(text(one).includes('· 1 commit '), 'one commit');
});

test('(d) 1 card adds the invite card; 0 hides Activity; landing null is the hero and steps only; no undefined, null, NaN or "["', () => {
  const one = section(html({ ...LANDING, activity: [card(1)] }), 'activity');
  const arts = one.split('<article').slice(1);
  assert.equal(arts.length, 2, 'one card and the invite');
  assert.ok(text(arts[1]).includes(ACTIVITY_INVITE_TITLE) && text(arts[1]).includes(ACTIVITY_INVITE_TEXT));
  assert.match(arts[1], new RegExp(`<button[^>]*>${esc(CTA_INSTALL)}</button>`));
  assert.equal(section(html({ ...LANDING, activity: [card(1), card(2)] }), 'activity').split('<article').length - 1, 3);

  const zero = html({ ...LANDING, activity: [] });
  assert.doesNotMatch(zero, />Activity<\/h2>/);
  assert.ok(zero.includes(`>${EARN_TITLE}</h2>`));

  const none = html(null);
  assert.ok(none.includes(`>${HERO_TITLE}</h1>`) && none.includes(`>${STEPS_TITLE}</h2>`));
  assert.doesNotMatch(none, />Activity<\/h2>/);
  assert.doesNotMatch(none, new RegExp(`>${EARN_TITLE}<`));
  assert.doesNotMatch(none, /href="#earn"/, 'no chip without data');

  const thin = { ...LANDING, activity: [card(1, { score: null, summary: null, text: null, chips: [], commits: 0, avatar: null })], tiles: [] };
  for (const l of [LANDING, thin, null, { ...LANDING, activity: [] }]) {
    const t = text(html(l).split('<footer')[0]);
    for (const bad of ['undefined', 'null', 'NaN', '[']) assert.ok(!t.includes(bad), `${bad} in: ${t.slice(0, 200)}`);
    assert.doesNotMatch(t, /\$(?![\d])/, 'no bare $');
  }
});

test('(e) Opportunities: 4 cards in tile order linking their guides, big numbers, kind words, when; prize text without a big number; id="earn"', () => {
  const earn = section(html(LANDING), 'earn');
  assert.ok(earn, 'the section has id="earn"');
  const links = [...earn.matchAll(/<a [^>]*href="(\/programs\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ['/programs/base-builder-grants', '/programs/alliance-all19', '/programs/a16z-speedrun', '/programs/circle-developer-grants']);
  const cards = earn.split('<a ').slice(1).map(text);
  assert.ok(cards[0].includes('Base Builder Grant Program') && cards[0].includes('$5K') && cards[0].includes('grant') && cards[0].includes('Rolling'));
  assert.ok(cards[1].includes('$400K') && cards[1].includes('investment') && cards[1].includes('Closes Nov 18'));
  assert.ok(cards[2].includes('$1M') && cards[2].includes('Closes Nov 2'));
  assert.ok(cards[3].includes('milestone-based USDC grants') && cards[3].includes('grant, in USDC'));
  assert.ok(!earn.includes('Monad Nitro'), 'four at most');
  assert.ok(text(earn).includes(EARN_FOOT));
  // Colours in order: blue, step, rust, step.
  const fills = [...earn.matchAll(/<a [^>]*class="([^"]*)"/g)].map((m) => m[1]);
  assert.match(fills[0], /var\(--ek-s-blue-top\)/);
  assert.match(fills[1], /from-s-step-top/);
  assert.match(fills[2], /var\(--ek-s-rust-top\)/);
  assert.match(fills[3], /from-s-step-top/);
  // A logo file on a white tile; no file: the monogram.
  assert.match(earn, /<img[^>]*src="\/programs\/base-builder-grants\.svg"/);
  assert.ok(text(earn).includes(' AA '), 'Alliance ALL19 monogram');
  // Below the fold: lazy, so React does not preload the logos (the browser's "preloaded but unused" warning).
  const logos = [...earn.matchAll(/<img[^>]*src="\/programs\/[^>]*>/g)].map((m) => m[0]);
  assert.ok(logos.length >= 2 && logos.every((l) => l.includes('loading="lazy"')), logos.join('\n'));

  const two = section(html({ ...LANDING, tiles: TILES.slice(0, 2) }), 'earn');
  assert.equal((two.match(/href="\/programs\//g) ?? []).length, 2);
  const empty = section(html({ ...LANDING, tiles: [] }), 'earn');
  assert.ok(empty && text(empty).includes(EARN_FOOT));
  assert.doesNotMatch(empty, /href="\/programs\//);
  // An upcoming tile is not on the landing.
  const up = section(html({ ...LANDING, tiles: [tile('soon', { status: 'upcoming', when: 'Not open yet' }), TILES[0]] }), 'earn');
  assert.deepEqual([...up.matchAll(/href="(\/programs\/[^"]+)"/g)].map((m) => m[1]), ['/programs/base-builder-grants']);
});

test('(f) the Earn step ends "Backers can buy in." only with EARNKIT_RAISING=on', () => {
  const was = process.env.EARNKIT_RAISING;
  try {
    delete process.env.EARNKIT_RAISING;
    const off = text(html(LANDING));
    assert.ok(off.includes(STEPS[2].text));
    assert.ok(!off.includes('Backers can buy in.'));
    process.env.EARNKIT_RAISING = 'on';
    const on = text(html(LANDING));
    assert.ok(on.includes(`${STEPS[2].text} Backers can buy in.`));
    for (const s of STEPS) assert.ok(on.includes(s.title) && on.includes(s.text), s.title);
  } finally {
    if (was === undefined) delete process.env.EARNKIT_RAISING;
    else process.env.EARNKIT_RAISING = was;
  }
});

test('(g) the hero painting: srcset of the three files, fetchpriority high; the arch clip path is the board\'s', () => {
  const h = html(LANDING);
  const img = h.match(/<img[^>]*hero-eckersberg[^>]*>/)?.[0] ?? '';
  for (const w of [800, 1600, 3200]) assert.ok(img.includes(`/art/hero-eckersberg-${w}.jpg ${w}w`), `${w}w`);
  assert.match(img, /fetchpriority="high"/i);
  // Fix round 1: object-cover fills the hero by its height, so the painting renders 1198px wide from md, 865px on a phone.
  assert.match(img, /sizes="\(min-width: 768px\) 1198px, 865px"/);
  assert.match(img, /alt=""/);
  const board = read('../../docs/design-docs-and-implementation-plans/v3.1-site-boards/Landing.dc.html');
  const d = board.match(/<clipPath id="ekArches"><path d="([^"]+)"/)?.[1];
  assert.ok(d);
  assert.equal(ARCH_PATH, d);
  assert.ok(h.includes(`d="${d}"`), 'rendered');
  assert.match(h, /<svg[^>]*viewBox="0 0 1600 1036"[^>]*preserveAspectRatio="xMidYMid slice"/);
  // At rest the glow is hidden; the drift layer carries data-hero-art and ek-drift.
  assert.match(h, /<circle[^>]*r="300"[^>]*/);
  assert.match(h, /<div[^>]*data-hero-art=""[^>]*class="[^"]*ek-drift/);
  // The client part listens only without reduced motion, for a mouse.
  const src = read('app/components/landing/HeroArt.tsx');
  assert.match(src, /^'use client';/);
  assert.match(src, /useReducedMotion\(\)/);
  assert.match(src, /if \(reduced\) return;/);
  assert.match(src, /pointerType !== 'mouse'/);
  assert.match(src, /getScreenCTM\(\)/);
});

test('(h) the landing colours are SITE tokens: the new card text pairs pass 4.5:1', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const [t, b] of [['onNavySoft', 'blueTop'], ['rustSub', 'rustTop'], ['muted', 'stepTop'], ['chipText', 'deep']] as const)
    assert.ok(contrast(SITE[t], SITE[b]) >= 4.5, `${t} on ${b}: ${contrast(SITE[t], SITE[b]).toFixed(2)}`);
  for (const f of ['Hero', 'HeroArt', 'Steps', 'Activity', 'Opportunities'])
    assert.doesNotMatch(read(`app/components/landing/${f}.tsx`), /#[0-9a-f]{3,8}\b|rgba?\(/i, f);
});

test('(i) fix round 1: every landing transition runs only without reduced motion (motion-safe:)', () => {
  const h = html({ ...LANDING, activity: [card(1)] }).split('<footer')[0];
  for (const m of h.matchAll(/class="([^"]*)"/g))
    for (const c of m[1].split(' ')) assert.ok(!/^(transition|duration-|ease-)/.test(c), `bare ${c} in: ${m[1]}`);
  assert.match(h, /motion-safe:transition-\[border-color,transform\]/, 'the Activity card');
});

test('(j) Task 7 fix round 1: the chip and the program numbers draw "$" in Funnel Sans (Money), the digits stay Kaftan', () => {
  const h = raw(LANDING);
  const sign = /<span data-ek-sign="" class="font-funnel-sans font-normal">\$<\/span>/;
  assert.match(h, new RegExp(`<span>${sign.source}105K in grants open now</span>`), 'the chip: one flex item, so the gap never splits the sign');
  const earn = section(h, 'earn');
  assert.match(earn, new RegExp(`<span class="ek-serif[^"]*">${sign.source}5K</span>`), 'a big number');
  assert.match(earn, new RegExp(`<span class="ek-serif[^"]*">${sign.source}1M</span>`));
  assert.doesNotMatch(earn.replace(new RegExp(sign.source, 'g'), ''), /ek-serif[^>]*>\$/, 'no Kaftan "$" left');
});
