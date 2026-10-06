import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PolicyPage from '../../app/policy/page';
import BoardView from '../../app/bonus/[round]/BoardView';
import Footer from '../../app/components/common/Footer';
import type { Board } from './bonus-board';
import { resolveRoundParam } from './bonus-rounds';
import HomeView from '../../app/HomeView';
import Header from '../../app/components/common/Header';
import ProgramLogo, { monogram } from '../../app/components/sections/ProgramLogo';
import AddToAgent, { START_PROMPT } from '../../app/components/sections/AddToAgent';
import type { Landing } from './landing';
import { homeFixture } from './fixtures/landing';

// The test runner compiles JSX with the classic runtime (no tsconfig at the repo root).
(globalThis as { React?: typeof React }).React = React;

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const view = (b: Board) => html(React.createElement(BoardView, { board: b }));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('/policy: every section, the fee split and payout tables, the weights, plain words', () => {
  const h = html(React.createElement(PolicyPage));
  const t = text(h);
  for (const heading of [
    'How matching works',
    'Where token fees go',
    'The builder bonus',
    'The token is optional',
    'No affiliation',
    'Contact',
  ])
    assert.match(h, new RegExp(`<h2[^>]*>${heading}</h2>`), heading);
  // Fee split, after the launch protocol's 20%.
  assert.match(t, /The launch protocol keeps 20% of trading fees/);
  for (const [who, share] of [['Your project', '40%'], ['MINI buyback', '10%'], ['Builder bonus', '20%'], ['EarnKit', '30%']])
    assert.match(t, new RegExp(`${who} ${share}`), who);
  // Signals and weights; market cap only breaks ties; never trading volume.
  for (const w of ['40', '20', '20', '10', '10']) assert.ok(t.includes(` ${w} `));
  assert.match(t, /Market cap only breaks ties/);
  assert.match(t, /Trading volume never counts/);
  // Eligibility, review, payout split in WETH, after the end.
  assert.match(t, /entry page/);
  assert.match(t, /earnkit\.txt/);
  assert.match(t, /48 hours/);
  assert.match(t, /farmed/);
  assert.match(t, /WETH/);
  assert.match(t, /1st 25% 2nd 18% 3rd 14% 4th 11% 5th 9% 6th 7% 7th 6% 8th 4% 9th 3% 10th 3%/);
  // Where the bonus share goes after a round: the next month for a rolling program; the Safe once
  // a program ends, and for programs without public submissions.
  assert.match(t, /monthly round is followed by the next month's round/);
  assert.match(t, /Once a program ends, its tokens' builder bonus share goes to EarnKit's Safe/);
  assert.match(t, /So does the share of programs that opted out/);
  // v2.6 §3-§4: the bonus is on every program unless it opts out; how a submission counts; a token
  // needs only the token line (no public payout wallet).
  assert.match(t, /Every program except EarnKit campaigns has a builder bonus unless it opts out\./);
  assert.match(t, /If EarnKit can't load an entry page, the builder's confirmation counts and is reviewed too\./);
  assert.ok(
    t.includes('Programs without public entry pages: the builder confirms the submission; the owner reviews the top 10 before paying.'),
  );
  assert.match(t, /Programs with public entry pages: your entry page links your repo or live product\./);
  assert.match(t, /You can push to the repo: its earnkit\.txt carries the token line your agent adds\./);
  assert.doesNotMatch(t, /names your payout wallet/);
  assert.doesNotMatch(h, /submissions aren&apos;t public show/);
  assert.doesNotMatch(t, /submissions aren't public/);
  assert.doesNotMatch(t, /round ends go to EarnKit/);
  assert.match(t, /skip/i);
  assert.match(t, /isn't affiliated with or endorsed by/);
  assert.match(h, /mailto:j@earnkit\.com/);
  // The public name is "builder bonus", never "vault"; no emojis.
  assert.doesNotMatch(t, /vault/i);
  assert.doesNotMatch(t, /\p{Emoji_Presentation}/u);
  // The homepage's design system: Funnel type, ek tokens, the panel radius.
  assert.match(h, /<h1 class="[^"]*font-funnel-display/);
  assert.match(h, /rounded-\[40px\][^"]*md:rounded-\[56px\]/);
  assert.match(h, /bg-ek-navy-deep/);
});

test('footer: links the policy page', () => {
  assert.match(html(React.createElement(Footer)), /href="\/policy"/);
});

const board = (o: Partial<Board> = {}): Board => ({
  round: 'base-builder-grants:2026-10',
  title: 'Base Builder Grants',
  state: 'open',
  ends_at: new Date('2026-11-01T00:00:00Z'),
  // Ruling 29: the month's last day, as the first message and the entry reply show it.
  ends_label: 'Oct 31',
  review_until: null,
  pool: '0.42',
  days_left: 26,
  removed: 0,
  rows: [
    { rank: 1, name: 'Tipjar', repo_url: 'https://github.com/a/tipjar', live_url: 'https://tipjar.app', score: '81.5', eligible: true, note: 'Yes', amount: null, tx: null },
    { rank: null, name: 'Splitly', repo_url: null, live_url: null, score: null, eligible: false, note: 'No: no token', amount: null, tx: null },
  ],
  ...o,
});

test('/bonus/<round> open: name, disclaimer, pool so far, days left, the rank/project/score/eligible table', () => {
  const h = view(board());
  const t = text(h);
  assert.match(h, /<h1[^>]*>Base Builder Grants<\/h1>/);
  assert.match(t, /EarnKit isn't affiliated with or endorsed by the organizer\./);
  assert.match(t, /Pool so far 0\.42 ETH/);
  assert.match(t, /Days left 26/);
  assert.match(t, /Ends Oct 31/);
  assert.match(t, /# Project Score Eligible/);
  assert.match(t, /1 Tipjar .*81\.5 Yes/);
  assert.match(t, /– Splitly .*– .*No: no token/);
  assert.match(h, /href="\/policy"/);
  assert.match(h, /href="https:\/\/tipjar\.app\/"/);
  assert.doesNotMatch(t, /vault/i);
});

test('/bonus/<round> paid: frozen places with amounts, paid rows link their transaction, removals counted', () => {
  const tx = '0x' + 'c'.repeat(64);
  const h = view(
      board({
        state: 'paid',
        days_left: 0,
        removed: 1,
        rows: [
          { rank: 1, name: 'Tipjar', repo_url: null, live_url: null, score: '81.5', eligible: true, note: 'Yes', amount: '0.105', tx },
          { rank: 2, name: 'Mintboard', repo_url: null, live_url: null, score: '60.0', eligible: true, note: 'Yes', amount: '0.0756', tx: null },
        ],
      }),
  );
  const t = text(h);
  assert.match(t, /Winners/);
  assert.match(t, /Pool 0\.42 ETH/);
  assert.match(h, new RegExp(`href="https://basescan.org/tx/${tx}"`));
  assert.equal(h.match(/basescan\.org\/tx\//g)?.length, 1);
  assert.match(t, /0\.105 ETH/);
  // An ended round says when it ended and where it is, not "0 days left".
  assert.match(t, /Ended Oct 31/);
  assert.match(t, /Status Paid/);
  assert.doesNotMatch(t, /Days left/);
  assert.match(t, /1 entry was removed in review/);
  // Every frozen row was eligible at the round's end: no Eligible column that only says "Yes".
  assert.doesNotMatch(t, /Eligible/);
});

test('/bonus/<round> review: the top 10 are public until the review closes', () => {
  const t = text(view(board({ state: 'review', days_left: 0, review_until: new Date('2026-11-03T00:00:00Z') })));
  assert.match(t, /In review/);
  assert.match(t, /Nov 3, 2026/);
  assert.match(t, /48-hour review/);
});

test('/bonus/<round>: links defend themselves: a javascript: or http: URL renders no link, a bad tx hash no link', () => {
  const h = view(
    board({
      state: 'paid',
      rows: [
        { rank: 1, name: 'Evil', repo_url: 'javascript:alert(1)', live_url: 'http://plain.example', score: '1.0', eligible: true, note: 'Yes', amount: '0.1', tx: 'javascript:alert(1)' },
      ],
    }),
  );
  assert.doesNotMatch(h, /javascript:/);
  assert.doesNotMatch(h, /href="http:\/\/plain/);
  assert.doesNotMatch(h, /basescan\.org\/tx/);
  assert.match(text(h), /Evil/);
});

test('M1: the public round page answers a malformed round escape with a 404 (notFound), never a 500', () => {
  const page = readFileSync(join(import.meta.dirname, '../../app/bonus/[round]/page.tsx'), 'utf8');
  // The page resolves the segment with resolveRoundParam, which answers null for a malformed escape.
  assert.match(page, /const round = resolveRoundParam\(\(await params\)\.round\);\s*if \(round === null\) notFound\(\);/);
  assert.doesNotMatch(page, /bonusBoard\(decodeURIComponent/);
  // The escape that made it throw.
  assert.throws(() => decodeURIComponent('%E0%A4%A'), URIError);
  assert.equal(resolveRoundParam('%E0%A4%A'), null);
});

test('Ruling 12 (plan): the board page resolves the slug and the v2.5 ":" form to the same round', () => {
  assert.equal(resolveRoundParam('arc-microgrants-2026-09-16'), 'arc-microgrants:2026-09-16');
  assert.equal(resolveRoundParam('arc-microgrants%3A2026-09-16'), 'arc-microgrants:2026-09-16');
  assert.equal(resolveRoundParam('arc-microgrants:2026-09-16'), 'arc-microgrants:2026-09-16');
  const sitemap = readFileSync(join(import.meta.dirname, '../../app/sitemap.ts'), 'utf8');
  assert.match(sitemap, /\/bonus\/\$\{boardSlug\(r\.round_key\)\}/);
});

// ---- v2.7 §1: the homepage (HomeView is the pure render; app/page.tsx does the cached read).
const home = (landing: Landing | null) => html(React.createElement(HomeView, { landing }));

test('v2.7 §1: the full home view', () => {
  const h = home(homeFixture);
  const t = text(h);
  for (const s of ['Your agent finds money you already qualify for.', '$60,500 open right now', 'Add to your agent', 'Then ask: What can I earn?', 'Watch the demo', 'Agents only'])
    assert.ok(t.includes(s), s);
  // 6 cards, then "See all" to /programs; below `sm`, 3 cards, then "See all programs" (fix round 1).
  const cards = h.split(/<li class="[^"]*rounded-\[32px\] bg-ek-navy p-6/).slice(1);
  assert.equal(cards.length, 6);
  assert.ok(!t.includes('Program Seven'));
  assert.match(h, /<a[^>]*href="\/programs"[^>]*>See all<\/a>/);
  const seeAllMobile = h.match(/<a [^>]*>See all programs<\/a>/)?.[0] ?? '';
  assert.match(seeAllMobile, /href="\/programs"/);
  assert.match(seeAllMobile, /(^|[ "])sm:hidden[ "]/);
  assert.match(seeAllMobile, /min-h-12/);
  const liClass = [...h.matchAll(/<li class="([^"]*rounded-\[32px\] bg-ek-navy p-6[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(liClass.map((c) => /(^| )hidden sm:flex( |$)/.test(c)), [false, false, false, true, true, true]);
  // 44px tap targets: both "See all" links and the footer links.
  assert.match(h, /min-h-11[^"]*"[^>]*>See all<\/a>/);
  for (const name of ['Docs', 'Policy', 'Programs']) assert.match(h, new RegExp(`class="[^"]*min-h-11[^"]*"[^>]*>${name}</a>`), name);
  // Ruling C8: the per-winner line first; the curated pool text as a small line under it.
  assert.ok(t.includes('Prize up to $30,000 per winner $840K+ in prizes'));
  assert.ok(t.includes('Prize up to $5,000 per winner Ends'));
  assert.ok(t.includes('Prize milestone-based USDC grants Ends'));
  for (const [i, c] of cards.entries()) {
    const ct = text(c);
    const tl = homeFixture.tiles[i];
    assert.ok(ct.includes('Ask your agent'), tl.id);
    assert.match(c, new RegExp(`href="/programs/${tl.id}"[^>]*>Guide</a>`), tl.id);
    for (const v of [tl.title, tl.chain, tl.prize, tl.difficulty, tl.ends, tl.bonus!]) assert.ok(ct.includes(v), `${tl.id}: ${v}`);
  }
  // The strip.
  for (const s of ['Open money $60,500', 'Agents earning 120', 'Builder bonus 0.60 ETH so far']) assert.ok(t.includes(s), s);
  // The 3 steps.
  for (const s of ['Add EarnKit', 'One link, any agent. Free, no account.', 'Ask “What can I earn?”', 'Your agent shows open money you qualify for.', 'Your agent builds and submits', 'Your entry gets a token and joins the builder bonus.'])
    assert.ok(t.includes(s), s);
  // Footer: Docs, Policy, Programs.
  for (const href of ['https://docs.earnkit.com', '/policy', '/programs']) assert.match(h, new RegExp(`href="${href}"`), href);
  assert.ok(t.includes('Docs · Policy · Programs'));
  // The design system: Funnel type, navy panels, the panel radius; no emojis, never "coin".
  assert.match(h, /rounded-\[40px\][^"]*md:rounded-\[56px\]/);
  assert.match(h, /<h2[^>]*font-funnel-display[^>]*>Open programs<\/h2>/);
  assert.doesNotMatch(t, /\bcoins?\b/i);
});

test('Review Focus 1: a failed read renders the headline and the button, without the live parts', () => {
  const h = home(null);
  const t = text(h);
  assert.ok(t.includes('Your agent finds money you already qualify for.'));
  assert.ok(t.includes('Add to your agent'));
  assert.ok(t.includes('Then ask: What can I earn?'));
  assert.ok(!t.includes('open right now'));
  assert.ok(!t.includes('Ask your agent'));
  assert.ok(!t.includes('Open programs'));
  assert.ok(!t.includes('Open money'));
  assert.ok(t.includes('Your agent builds and submits')); // how it works stays
});

test('Ruling 1 (plan): no logo renders the monogram, never an <img>; a logo is a local <img>', () => {
  const none = html(React.createElement(ProgramLogo, { logo: null, title: 'Arc Microgrants' }));
  assert.match(none, />AM</);
  assert.doesNotMatch(none, /<img/);
  assert.match(none, /font-funnel-display/);
  assert.match(none, /bg-ek-navy/);
  const one = html(React.createElement(ProgramLogo, { logo: '/programs/arc-microgrants.svg', title: 'Arc Microgrants' }));
  assert.match(one, /<img src="\/programs\/arc-microgrants.svg" alt="Arc Microgrants"/);
  assert.equal(monogram('Base Builder Grant Program'), 'BB');
  assert.equal(monogram('Monad'), 'M');
});

test('fix round 1: the header\'s call to action is the install; Follow on X stays on desktop', () => {
  const h = html(React.createElement(Header));
  assert.equal((h.match(/<button[^>]*>Add to your agent<\/button>/g) ?? []).length, 2); // desktop and mobile
  const mobile = h.slice(h.indexOf('md:hidden'));
  assert.doesNotMatch(mobile, /Follow on X/);
  assert.match(h.slice(0, h.indexOf('md:hidden')), /Follow on X/);
});

test('fix round 1, Important 4: the client Hero never imports the server money modules (viem, zod)', () => {
  const hero = readFileSync(join(import.meta.dirname, '../../app/components/sections/Hero.tsx'), 'utf8');
  assert.doesNotMatch(hero, /lib\/earnkit\/campaigns|from 'viem'|from 'zod'/);
  for (const f of ['ProgramCards.tsx', 'ProgramLogo.tsx', 'AddToAgent.tsx'])
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, `../../app/components/sections/${f}`), 'utf8'), /import (?!type)[^;]*lib\/earnkit\//, f);
});

test('fix round 1: a logo path that is not a local programs file renders the monogram', () => {
  for (const logo of ['https://evil.example/x.svg', '/programs/../x.svg', 'javascript:alert(1)', '/programs/x.gif'])
    assert.doesNotMatch(html(React.createElement(ProgramLogo, { logo, title: 'Arc Microgrants' })), /<img/, logo);
});

test('v2.7 §1: the install modal asks the starting phrase, or the program\'s own', () => {
  assert.equal(START_PROMPT, 'What can I earn?');
  const t = text(html(React.createElement(AddToAgent, { onClose: () => {}, prompt: 'What can I earn on Arc Microgrants?' })));
  assert.ok(t.includes('Then ask your agent: “What can I earn on Arc Microgrants?”'));
  assert.ok(text(html(React.createElement(AddToAgent, { onClose: () => {} }))).includes('Then ask your agent: “What can I earn?”'));
});

test('v2.7: the site description and llms.txt use the starting phrase and name the guides', () => {
  const layout = readFileSync(join(import.meta.dirname, '../../app/layout.tsx'), 'utf8');
  assert.ok(layout.includes('EarnKit gives your AI agent live builder programs with real rewards. Add it to your agent, ask "What can I earn?", build, and submit.'));
  const llms = readFileSync(join(import.meta.dirname, '../../public/llms.txt'), 'utf8');
  assert.ok(llms.includes('What can I earn?'));
  assert.match(llms, /earnkit\.com\/programs\/<id>/);
  assert.doesNotMatch(llms, /Anything worth building/);
  // Ruling C9: the homepage publishes live figures, so llms.txt no longer forbids stating them.
  assert.doesNotMatch(llms, /Do not state any/);
  assert.match(llms, /earnkit\.com\/api\/stats/);
  assert.match(llms, /open money/);
});
