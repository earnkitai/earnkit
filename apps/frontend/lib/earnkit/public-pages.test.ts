import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
import { HERO_EYEBROW, HERO_SUBTITLE, HERO_TITLE } from '../../app/components/sections/Hero';
import { HOW_TITLE, STEPS } from '../../app/components/sections/HowItWorks';
import { NO_CELL } from './present';
import BonusPill, { BONUS_PILL_COLORS, BONUS_PILL_TEXT, bonusPillLabel } from '../../app/components/ui/BonusPill';
import ProgramLogo, { monogram } from '../../app/components/sections/ProgramLogo';
import AddToAgent, { START_PROMPT } from '../../app/components/sections/AddToAgent';
import type { Landing } from './landing';
import { homeFixture } from './fixtures/landing';
import GuideView, { askPrompt, Unavailable } from '../../app/programs/[id]/GuideView';
import AskAgent from '../../app/programs/[id]/AskAgent';
import ProgramCards from '../../app/components/sections/ProgramCards';
import type { GuidePage } from './landing';
import { closedGuide, emptyGuide, fullGuide, partialGuide, predecessorGuide } from './fixtures/guide';
import { gatedGuidePage, guideDescription } from './landing';
import { shownUrl } from './untrusted-text';
import { FOOTER_COLUMNS, FOOTER_TAGLINE } from './footer-links';

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
  // v2.9 B11: the token is optional, said without "skip" (only token offers say it).
  assert.match(t, /Every entry is offered a token, named after the project\. Turn it down and there's no token\. No token means no builder bonus, nothing else\./);
  assert.doesNotMatch(t, /\bskip\b/i);
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
  for (const s of [HERO_EYEBROW, HERO_TITLE, HERO_SUBTITLE, '$1.3M+ open right now', 'Builder bonus', 'Add to your agent', 'Watch the demo', '120 agents earning'])
    assert.ok(t.includes(s), s);
  // v2.8: the hero is the title, the subtitle, the bonus pill and the buttons; the pool figure
  // heads the Open programs section.
  const order = [HERO_TITLE, HERO_SUBTITLE, 'Builder bonus', 'Add to your agent', 'Watch the demo', '120 agents earning', 'Open programs', '$1.3M+ open right now'].map((s) => t.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(!t.includes('Then ask:'));
  // v2.8 Ruling 20 (plan): every open program in one carousel row; no "See all".
  const cards = cardsOf(h);
  assert.equal(cards.length, homeFixture.tiles.length);
  assert.doesNotMatch(t, /See all/);
  // 44px tap targets: the footer links (Ruling 22, plan).
  for (const name of ['Programs', 'Docs', 'For sponsors', 'Policy', 'j@earnkit.com'])
    assert.match(h, new RegExp(`class="[^"]*min-h-11[^"]*"[^>]*>${name}</a>`), name);
  assert.match(h, /aria-label="@jenilt on X"[^>]*class="[^"]*min-h-11[^"]*min-w-11[^"]*"/);
  // v2.7.1: the pool is the big line, "up to $X per winner" under it; no pool, the per-winner amount.
  assert.ok(t.includes('$840K in prizes up to $30,000 per winner 8 days left Hard Builder bonus · 0.42 ETH'), t);
  assert.ok(t.includes('10,000 USDC pool 500 USDC per grant'));
  assert.ok(t.includes('up to $5,000 per grant rolling'));
  assert.ok(t.includes('$200K in grants $5K–$100K per grant rolling'));
  assert.doesNotMatch(t, /per winner rolling|grants? up to \$[\d,]+ per winner/); // review #1: grants never say "per winner"
  assert.ok(!t.includes('Prize ') && !t.includes('Ends ') && !t.includes('Difficulty '));
  // The section: no "Open now" eyebrow; review #5: no bonus line under the title (the pills say it).
  assert.match(t, /Open programs \$1\.3M\+ open right now Ask your agent CW Crypto World/);
  assert.doesNotMatch(t, /Every entry also competes|\(estimate\)/);
  assert.doesNotMatch(t, /Open now/i);
  // No stats strip, no duplicate open-money figure.
  assert.doesNotMatch(t, /Open money|EarnKit in numbers/);
  assert.equal(t.split('open right now').length, 2);
  // v2.8: no "Win twice" section; the programs come before How you earn.
  assert.doesNotMatch(h, /id="builder-bonus"|Win twice/);
  assert.doesNotMatch(h, /Leaderboards/);
  assert.ok(t.indexOf('Open programs') < t.indexOf(HOW_TITLE) && t.indexOf(HOW_TITLE) < t.indexOf('Add EarnKit'));
  // Footer (Ruling 22, plan): the real links only, the tagline, and the faded wordmark.
  for (const href of [...FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href)), '/'])
    assert.match(h, new RegExp(`href="${href.replace(/[.+]/g, '\\$&')}"`), href);
  assert.ok(t.includes(FOOTER_TAGLINE));
  // v2.8.1 (owner): the faded wordmark is the navbar's logo SVG, not text.
  assert.match(h, /<div aria-hidden="true" data-footer-wordmark=""[^>]*><svg[^>]*viewBox="0 0 124 23"/);
  // The design system: Funnel type, navy panels, the panel radius; no emojis, never "coin".
  assert.match(h, /rounded-\[40px\][^"]*md:rounded-\[56px\]/);
  assert.match(h, /<h2[^>]*font-funnel-display[^>]*>Open programs<\/h2>/);
  assert.doesNotMatch(t, /\bcoins?\b/i);
});

test('Review Focus 1: a failed read renders the headline and the button, without the live parts', () => {
  const h = home(null);
  const t = text(h);
  assert.ok(t.includes(HERO_TITLE));
  assert.ok(t.includes('Add to your agent'));
  assert.ok(!t.includes('Then ask:'));
  assert.ok(!t.includes('open right now'));
  assert.ok(!t.includes('Ask your agent'));
  assert.ok(!t.includes('Open programs'));
  assert.ok(!t.includes('agents earning'));
  // v2.8: the hero pill needs no read, and never claims an amount or "0 ETH".
  assert.ok(t.includes(`${HERO_SUBTITLE} Builder bonus Add to your agent Watch the demo`));
  assert.doesNotMatch(t, /Pools start|in pools so far|\b0 ETH|Win twice/);
  assert.ok(t.includes(HOW_TITLE) && t.includes(STEPS[2].title)); // How you earn stays
  assert.match(h, /id="how-you-earn-3"/);
});

// ---- v2.8 Task 2: the hero, How you earn, no Win twice.
test('v2.8: the hero is the title, the subtitle, the bonus pill to step 3 and the two buttons', () => {
  const h = home(homeFixture);
  const t = text(h);
  assert.match(h, new RegExp(`<h1[^>]*>${HERO_TITLE}</h1>`));
  assert.equal(HERO_TITLE, 'Earn rewards for building');
  assert.equal(HERO_SUBTITLE, 'Find live programs. EarnKit matches your projects and helps you win.');
  const pill = h.match(/<a[^>]*href="#how-you-earn-3"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
  assert.equal(text(pill).trim(), 'Builder bonus');
  assert.match(pill, /h-11/); // size lg
  const order = [HERO_EYEBROW, HERO_TITLE, HERO_SUBTITLE, 'Builder bonus', 'Add to your agent', 'Watch the demo'].map((s) => t.indexOf(s));
  assert.ok(order.every((n) => n >= 0), String(order));
  // Ruling C3: the "Agents only" pill sits right above the h1, in its v2.7 style.
  assert.equal(HERO_EYEBROW, 'Agents only');
  assert.match(h, /<p class="[^"]*rounded-full border-2 border-ek-blue-soft\/80[^"]*uppercase[^"]*">Agents only<\/p><h1 class="mt-8 /);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const gone of ['Win twice', 'Find things worth building for', 'on every program']) assert.ok(!t.includes(gone), gone);
  assert.doesNotMatch(h, /id="builder-bonus"|href="#builder-bonus"/);
  // Nothing else: from the h1 to the end of the hero section, only these carry text.
  const afterH1 = h.slice(h.indexOf('</h1>'));
  const hero = afterH1.slice(0, afterH1.indexOf('</section>'));
  const bits = [...hero.matchAll(/>([^<]+)</g)].map((m) => text(m[1]).trim()).filter(Boolean);
  assert.deepEqual(bits, [HERO_SUBTITLE, 'Builder bonus', 'Add to your agent', 'Watch the demo', homeFixture.stats_line]);
});

test('v2.8: How you earn is a visible h2 with the three steps; step 3 is the pill target', () => {
  const h = home(homeFixture);
  assert.equal(HOW_TITLE, 'How you earn');
  const h2 = h.match(/<h2[^>]*id="how-it-works"[^>]*>([^<]*)<\/h2>/) ?? h.match(/<h2[^>]*>(How you earn)<\/h2>/);
  assert.ok(h2, 'h2');
  assert.equal(h2![1], HOW_TITLE);
  assert.match(h2![0], /id="how-it-works"/);
  assert.doesNotMatch(h2![0], /sr-only/);
  assert.deepEqual(STEPS, [
    { title: 'Add EarnKit', body: 'One link, free.' },
    { title: 'Ask “What can I earn?”', body: 'Your agent finds programs you qualify for.' },
    { title: 'Submit and earn', body: "Launch your entry's token to compete for the builder bonus." },
  ]);
  const steps = [...h.matchAll(/<li[^>]*id="how-you-earn-(\d)"[^>]*>[\s\S]*?<h3[^>]*>([^<]*)<\/h3>[\s\S]*?<p[^>]*>([^<]*)<\/p>/g)].map((m) => ({
    n: m[1],
    title: text(m[2]).trim(),
    body: text(m[3]).trim(),
  }));
  assert.deepEqual(steps, STEPS.map((s, i) => ({ n: String(i + 1), ...s })));
  assert.match(h, /<li[^>]*id="how-you-earn-3"[^>]*class="[^"]*scroll-mt-4/);
  assert.doesNotMatch(h, /<li[^>]*id="how-you-earn-[12]"[^>]*class="[^"]*scroll-mt-4/); // step 3 only (the brief)
});

test('v2.8: a failed read keeps the hero and How you earn, without Open programs', () => {
  const t = text(home(null));
  for (const s of [HERO_EYEBROW, HERO_TITLE, HERO_SUBTITLE, 'Builder bonus', 'Add to your agent', 'Watch the demo', HOW_TITLE, ...STEPS.map((s) => s.title)]) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('Open programs'));
});

test('v2.8: /policy shows the builder bonus pill in its builder bonus section', () => {
  const h = html(React.createElement(PolicyPage));
  const sec = h.slice(h.indexOf('id="the-builder-bonus"'));
  const head = sec.slice(0, sec.indexOf('<h3'));
  assert.match(head, /<h2[^>]*>The builder bonus<\/h2>/);
  assert.match(head, /<span[^>]*class="[^"]*rounded-full[^"]*h-9[^"]*"[^>]*>[\s\S]*?<svg[^>]*aria-hidden="true"[\s\S]*?Builder bonus/);
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

test('v2.7.1: the header is Docs and the install, desktop and mobile; the X link is in the footer only', () => {
  const h = html(React.createElement(Header));
  assert.equal((h.match(/<button[^>]*>Add to your agent<\/button>/g) ?? []).length, 2); // desktop and mobile
  assert.equal((h.match(/<a[^>]*href="https:\/\/docs\.earnkit\.com"[^>]*>Docs<\/a>/g) ?? []).length, 2);
  assert.doesNotMatch(h, /x\.com\/jenilt/);
  assert.match(html(React.createElement(Footer)), /href="https:\/\/x\.com\/jenilt"/);
});

test('fix round 1, Important 4: the client Hero never imports the server money modules (viem, zod)', () => {
  const hero = readFileSync(join(import.meta.dirname, '../../app/components/sections/Hero.tsx'), 'utf8');
  assert.doesNotMatch(hero, /lib\/earnkit\/campaigns|from 'viem'|from 'zod'/);
  for (const f of ['ProgramCards.tsx', 'ProgramCard.tsx', 'carousel.ts', 'ProgramLogo.tsx', 'AddToAgent.tsx'])
    // Final review M1: only no-cell.ts, which imports nothing, may be shared at runtime.
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, `../../app/components/sections/${f}`), 'utf8'), /import (?!type)[^;]*lib\/earnkit\/(?!no-cell';)/, f);
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, 'no-cell.ts'), 'utf8'), /^import /m, 'no-cell.ts stays import-free');
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
  // v2.8 Ruling 19 (plan): the builder bonus pill under the steps.
  assert.ok(t.includes('Builder bonus Then ask your agent'), t);
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
  // v2.7.1: the figure is the open programs' pools.
  assert.match(llms, /prize pools/);
  assert.doesNotMatch(llms, /open money/);
});

// ---- v2.7 §2, Ruling 22 (plan): the program guide page (GuideView is the pure render;
// app/programs/[id]/page.tsx does the cached read) and the /programs index.
const guideHtml = (page: GuidePage) => html(React.createElement(GuideView, { page }));
/** Every element GuideView returns, walked through children (finds the client AskAgent's props). */
function elements(node: unknown, out: React.ReactElement[] = []): React.ReactElement[] {
  if (Array.isArray(node)) for (const n of node) elements(n, out);
  else if (React.isValidElement(node)) {
    out.push(node);
    elements((node.props as { children?: unknown }).children, out);
  }
  return out;
}
const asks = (page: GuidePage) =>
  elements(GuideView({ page })).filter((e) => e.type === AskAgent).map((e) => (e.props as { prompt: string }).prompt);

test('v2.7 §2: the full guide page', () => {
  const h = guideHtml(fullGuide);
  const t = text(h);
  assert.match(h, /<h1[^>]*>Arc Microgrants<\/h1>/);
  assert.match(h, /<img[^>]*src="\/programs\/arc-microgrants.svg"[^>]*alt="Arc Microgrants"/);
  assert.ok(t.includes('500 USDC × 20 grants · ends Oct 14'));
  assert.ok(t.includes('Difficulty: Medium. 20 of ~160 entries won last round.'));
  for (const heading of ['What won last time', 'What Arc wants now', 'Your best bet'])
    // The won section wraps its list (Ruling C12's event line goes above it when not own).
    assert.match(h, new RegExp(`<h2[^>]*>${heading}</h2>\\s*(?:<div>\\s*)?<ul`), heading);
  const items = [...h.matchAll(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]).trim());
  for (const line of [
    'USDC payroll and payouts (3 of 20 winners)',
    'Agent wallets paying for APIs (2 of 20)',
    'Example: PayStream, streamed salaries in USDC; cited for live mainnet demo',
    'Stablecoin payments', 'FX', 'Agentic commerce',
    'A USDC payout tool with a live mainnet demo',
  ])
    assert.ok(items.includes(line), line);
  // v2.7.1: the builder bonus is a pill beside Difficulty, linking to the leaderboard.
  assert.ok(t.includes('Difficulty: Medium. 20 of ~160 entries won last round. Builder bonus · 0.18 ETH'));
  assert.match(h, /<a[^>]*href="\/bonus\/arc-microgrants-2026-09-16"[^>]*>[\s\S]*?Builder bonus · <span[^>]*>0\.18 ETH<\/span>[\s\S]*?<\/a>/);
  assert.doesNotMatch(t, /leaderboard/);
  // Sources: labelled by what each backs (fix round 1), each link through shownUrl, host as title.
  assert.ok(t.includes('Sources: program page · past winners 1 · past winners 2 · priorities'));
  assert.doesNotMatch(t, /community\.arc\.io|\(2\)/);
  for (const { url } of fullGuide.sources)
    assert.match(h, new RegExp(`<a[^>]*href="${shownUrl(url)!.replace(/[.?]/g, '\\$&')}"[^>]*title="${new URL(url).hostname.replace(/\./g, '\\.')}"[^>]*rel="noopener noreferrer"`), url);
  // Every visible link is https, a local path, or the footer's contact mailto.
  for (const [, href] of h.matchAll(/href="([^"]+)"/g)) assert.match(href, /^(https:\/\/|\/|mailto:)/, href);
  // One primary action, with the program's own question; "All programs" goes to the index.
  assert.ok(t.includes('Ask your agent'));
  // Twice (fix round 1): under the difficulty line, above the fold, and in the action row.
  assert.deepEqual(asks(fullGuide), ['What can I earn on Arc Microgrants?', 'What can I earn on Arc Microgrants?']);
  assert.ok(h.indexOf('Ask your agent') < h.indexOf('What won last time'), 'the first is in the header');
  assert.equal(askPrompt('Arc Microgrants'), 'What can I earn on Arc Microgrants?');
  assert.match(h, /<a[^>]*href="\/programs"[^>]*>All programs<\/a>/);
  // No paragraphs of prose.
  for (const [, p] of h.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)) // never an svg <path>
    if (!p.includes(FOOTER_TAGLINE) && !p.includes('All rights reserved'))
      assert.ok(text(p).trim().length <= 140, text(p));
  assert.ok(t.includes(FOOTER_TAGLINE), 'the footer');
});

test('v2.7 §2: a partial guide leaves out the parts it has no data for', () => {
  const h = guideHtml(partialGuide);
  assert.doesNotMatch(h, /What won/);
  assert.match(h, /<h2[^>]*>What Arc wants now<\/h2>/);
  assert.match(h, /<h2[^>]*>Your best bet<\/h2>/);
});

test('v2.7 §2: an empty guide is the header, the difficulty and "Ask your agent"', () => {
  const h = guideHtml(emptyGuide);
  const t = text(h);
  assert.match(h, /<h1[^>]*>Circle Developer Grants<\/h1>/);
  assert.ok(t.includes('milestone-based USDC grants · rolling'));
  assert.ok(t.includes('Difficulty: Medium (estimate). No past results yet.'));
  assert.doesNotMatch(h, /<h2/);
  assert.doesNotMatch(t, /Builder bonus/);
  assert.equal(asks(emptyGuide).length, 2);
  assert.ok(asks(emptyGuide).every((p) => p === 'What can I earn on Circle Developer Grants?'));
  assert.match(h, /<span[^>]*aria-hidden="true"[^>]*>CD<\/span>/, 'the monogram (Ruling 1)');
  assert.ok(t.includes('Sources: program page'));
});

test('Ruling 22 (plan): a closed program still renders, "· closed", with no "Ask your agent"', () => {
  const h = guideHtml(closedGuide);
  const t = text(h);
  assert.ok(t.includes('500 USDC × 20 grants · closed'));
  assert.doesNotMatch(t, /Ask your agent/);
  assert.deepEqual(asks(closedGuide), []);
  assert.match(h, /href="\/programs"/);
});

test('Ruling 22 (plan): the guide route, the index, the sitemap and the logo CSP', () => {
  const read = (f: string) => readFileSync(join(import.meta.dirname, '../../', f), 'utf8');
  const page = read('app/programs/[id]/page.tsx');
  assert.match(page, /export const revalidate = 600;/);
  assert.match(page, /if \(page === null\) notFound\(\);/);
  // A runtime connection() in an ISR route is a 500 (DYNAMIC_SERVER_USAGE), not the panel.
  assert.doesNotMatch(page, /generateStaticParams/);
  assert.ok(page.includes('This guide is unavailable right now. Try again in a few minutes.'));
  assert.ok(page.includes('description: guideDescription(page)'));
  assert.ok(page.includes('`${page.title} guide · EarnKit`'));
  const index = read('app/programs/page.tsx');
  assert.match(index, /export const revalidate = 600;/);
  assert.ok(index.includes('Programs are unavailable right now.'));
  assert.doesNotMatch(index, /limit=/);
  const cache = read('app/lib/landing-cache.ts');
  assert.match(cache, /\['guide-v271'\], \{ revalidate: 600 \}/); // review #7: bumped with the GuidePage shape
  assert.match(cache, /\['guide-ids-v27'\], \{ revalidate: 600 \}/);
  assert.match(cache, /gatedGuidePage\(id, cachedIds, cachedGuide\)/);
  assert.match(cache, /export const getGuidePage = cache\(/);
  assert.match(cache, /console\.error\('\[guide\]'/);
  const sitemap = read('app/sitemap.ts');
  assert.ok(sitemap.includes('`${SITE}/programs`'));
  assert.ok(sitemap.includes('`${SITE}/programs/${p.id}`'));
  assert.match(sitemap, /status = 'active' AND source = 'file' AND campaign IS NULL\s+AND \(ends_at IS NULL OR ends_at > now\(\)\)/);
  // The logo files' sandbox CSP never matches a guide page route.
  const csp = /^\/programs\/([a-z0-9-]+\.(?:svg|png))$/;
  assert.ok(csp.test('/programs/arc-microgrants.svg'));
  assert.ok(!csp.test('/programs/arc-microgrants'));
  assert.ok(!csp.test('/programs'));
  assert.ok(read('next.config.ts').includes("source: '/programs/:file([a-z0-9-]+\\\\.(?:svg|png))'"));
});

test('/programs: every open program as cards under an h1, or the unavailable line', async () => {
  const h = html(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1', layout: 'grid' }));
  assert.match(h, /<h1[^>]*>Open programs<\/h1>/);
  assert.ok(!text(h).includes('By pool')); // v2.8: no eyebrow
  assert.doesNotMatch(text(h), /Open now/);
  assert.equal(cardsOf(h).length, homeFixture.tiles.length, 'no limit');
  assert.doesNotMatch(h, /See all/);
  // v2.7.1: the same pool total as the landing page, under the h1 (app/programs/page.tsx passes landing.open_text).
  const fig = text(html(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1', layout: 'grid', figure: homeFixture.open_text })));
  assert.ok(fig.includes(' Open programs $1.3M+ open right now Ask your agent CW Crypto World') && !fig.includes('By pool'), fig);
  const page = readFileSync(join(import.meta.dirname, '../../app/programs/page.tsx'), 'utf8');
  assert.match(page, /figure=\{landing\.open_text\}/);
  assert.match(page, /layout="grid"/);
  const u = text(html(React.createElement(Unavailable, { text: 'Programs are unavailable right now.' })));
  assert.ok(u.includes('Programs are unavailable right now.'));
  assert.ok(u.includes(FOOTER_TAGLINE), 'the footer');
});

// ---- v2.8 Task 3: the Open programs carousel and the slim card (Rulings 20, 21 (plan)).
/** The cards: each `<li>` of the section's list, holding its one link. */
function cardsOf(h: string): string[] {
  const sec = h.slice(h.indexOf('<section id="open-programs"'));
  const list = sec.slice(sec.indexOf('<ul'), sec.indexOf('</ul>') + 5);
  return [...list.matchAll(/<li[ >][\s\S]*?<\/li>/g)].map((m) => m[0]);
}
/** The section from its heading to the end of its list. */
function programsSection(h: string): string {
  const sec = h.slice(h.indexOf('<section id="open-programs"'));
  return sec.slice(0, sec.indexOf('</section>'));
}
const chipsOf = (card: string) => [...card.matchAll(/<span class="[^"]*\bek-chip\b[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);

test('3.1 v2.8: the section is the h2, the figure, one "Ask your agent", then a list of whole-card links', () => {
  const h = home(homeFixture);
  const sec = programsSection(h);
  const t = text(sec);
  assert.match(sec, /<h2[^>]*>Open programs<\/h2>/);
  const order = ['>Open programs</h2>', '$1.3M+ open right now', '>Ask your agent</button>', '<ul'].map((s) => sec.indexOf(s));
  assert.ok(order.every((n) => n >= 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(t.split('Ask your agent').length, 2, 'exactly one');
  assert.equal(h.split('Ask your agent').length, 2, 'none anywhere else on the page');
  const cards = cardsOf(h);
  assert.equal(cards.length, 7);
  for (const [i, c] of cards.entries()) {
    const id = homeFixture.tiles[i].id;
    assert.equal((c.match(/<a /g) ?? []).length, 1, id);
    assert.match(c, new RegExp(`<a [^>]*href="/programs/${id}"`), id);
    assert.doesNotMatch(c, /<button/, id);
  }
  assert.doesNotMatch(h, /See all/);
});

test('3.2 v2.8: each slim card: logo, title, big line, per-winner line, days left, difficulty word, bonus pill', () => {
  const tiles = [
    ...homeFixture.tiles,
    { ...homeFixture.tiles[0], id: 'no-bonus', title: 'No Bonus Fest', has_bonus: false, bonus_amount: null, prize_note: null },
  ];
  const cards = cardsOf(html(React.createElement(ProgramCards, { tiles })));
  assert.equal(cards.length, tiles.length);
  for (const [i, c] of cards.entries()) {
    const tl = tiles[i];
    const ct = text(c);
    assert.match(c, tl.logo ? new RegExp(`<img[^>]*src="${tl.logo}"`) : /aria-hidden="true"[^>]*>[A-Z]{1,2}<\/span>/, tl.id);
    assert.match(c, new RegExp(`<h3[^>]*>${tl.title.replace(/'/g, '&#x27;')}</h3>`), tl.id);
    assert.ok(ct.includes(tl.prize), tl.id);
    if (tl.prize_note) assert.ok(ct.includes(tl.prize_note), tl.id);
    assert.deepEqual(chipsOf(c), [tl.days_left, ...(tl.difficulty === NO_CELL ? [] : [tl.difficulty])], tl.id);
    assert.doesNotMatch(ct, /\(estimate\)/, tl.id);
    assert.equal(ct.includes(bonusPillLabel(tl.bonus_amount)), tl.has_bonus, tl.id);
    assert.equal(ct.includes('Builder bonus'), tl.has_bonus, tl.id);
    // The whole card's name: "<title>, <prize>".
    const label = c.match(/<a [^>]*aria-label="([^"]*)"/)?.[1]?.replace(/&#x27;/g, "'");
    assert.equal(label, `${tl.title}, ${tl.prize}`, tl.id);
    assert.doesNotMatch(ct, /\bcoins?\b|\u2014/i, tl.id);
  }
  // Colosseum: Hard (never "(estimate)"), the amount in the pill; Program Six: no difficulty chip, no pill.
  assert.deepEqual(chipsOf(cards[0]), ['8 days left', 'Hard']);
  assert.ok(text(cards[0]).includes('Builder bonus · 0.42 ETH'));
  assert.deepEqual(chipsOf(cards[5]), ['8 days left']);
  assert.ok(!text(cards[5]).includes('Builder bonus'));
  assert.ok(text(cards[4]).includes('Builder bonus') && !text(cards[4]).includes('Builder bonus ·'), 'no amount, no "0 ETH"');
  assert.deepEqual(chipsOf(cards[1]), ['ends today', 'Hard']);
  assert.deepEqual(chipsOf(cards[2]), ['rolling', 'Medium']);
});

test('3.3 v2.8: two arrow buttons (desktop only), a focusable snap scroller, snap-start cards', () => {
  const sec = programsSection(home(homeFixture));
  for (const label of ['Previous programs', 'Next programs']) {
    const b = sec.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
    assert.match(b, /type="button"/, label);
  }
  const arrows = sec.match(/<div class="([^"]*)"[^>]*><button[^>]*aria-label="Previous programs"/)?.[1] ?? '';
  assert.match(arrows, /(^| )hidden( |$)/);
  assert.match(arrows, /(^| )md:flex( |$)/);
  const ul = sec.match(/<ul[^>]*>/)?.[0] ?? '';
  for (const c of ['snap-x', 'snap-mandatory', 'overflow-x-auto']) assert.match(ul, new RegExp(`class="[^"]*(^|[ "])${c}( |")`), c);
  assert.match(ul, /tabindex="0"/);
  assert.match(ul, /aria-label="Open programs"/);
  for (const c of cardsOf(sec)) assert.match(c, /<li class="[^"]*\bsnap-start\b/);
});

test('3.4 v2.8: one tile is one card; both arrows render disabled until mounted', () => {
  const sec = programsSection(html(React.createElement(ProgramCards, { tiles: [homeFixture.tiles[0]] })));
  assert.equal(cardsOf(sec).length, 1);
  for (const label of ['Previous programs', 'Next programs'])
    assert.match(sec.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '', /disabled=""/, label);
});

test('3.5 v2.8: zero tiles or a failed read render no Open programs section', () => {
  for (const landing of [{ ...homeFixture, tiles: [] }, null]) {
    const h = home(landing);
    assert.doesNotMatch(h, /aria-label="Open programs"/);
    assert.ok(!text(h).includes('Open programs'));
  }
});

test('3.6 v2.8: /programs is a grid of the same slim cards, with no arrows and one "Ask your agent"', () => {
  const h = html(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1', layout: 'grid' }));
  const ul = h.match(/<ul[^>]*>/)?.[0] ?? '';
  assert.match(ul, /class="[^"]*\bgrid\b/);
  assert.doesNotMatch(ul, /snap-x|overflow-x-auto/);
  assert.doesNotMatch(h, /Previous programs|Next programs/);
  assert.equal(h.split('Ask your agent').length, 2);
  // The same cards as the carousel: same links, same text.
  const carousel = cardsOf(html(React.createElement(ProgramCards, { tiles: homeFixture.tiles })));
  assert.deepEqual(cardsOf(h).map((c) => text(c).trim()), carousel.map((c) => text(c).trim()));
  for (const c of cardsOf(h)) assert.doesNotMatch(c, /<button/);
});

test('3.7 v2.8: keyboard: cards are never taken out of the tab order; the arrows come before the scroller', () => {
  const src = (f: string) => readFileSync(join(import.meta.dirname, `../../app/components/sections/${f}`), 'utf8');
  for (const f of ['ProgramCard.tsx', 'ProgramCards.tsx']) assert.doesNotMatch(src(f), /tabIndex=\{-1\}/, f);
  const sec = programsSection(home(homeFixture));
  assert.doesNotMatch(sec, /tabindex="-1"/);
  assert.ok(sec.indexOf('aria-label="Previous programs"') < sec.indexOf('<ul'));
  assert.ok(sec.indexOf('aria-label="Next programs"') < sec.indexOf('<ul'));
  // HomeView and /programs pass no card cap.
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, '../../app/HomeView.tsx'), 'utf8'), /HOME_CARDS|limit=|seeAll/);
});

test('fix round 1, Minor 3: a predecessor round reads "What won before" and names the round', () => {
  const h = guideHtml(predecessorGuide);
  const t = text(h);
  assert.match(h, /<h2[^>]*>What won before<\/h2>/);
  assert.doesNotMatch(t, /last (time|round)/);
  assert.ok(t.includes("Difficulty: Medium. 20 of ~160 entries won in Arc's HackMoney 2026 track."));
});

test('Ruling C12: the web guide names the event under "What won before", never under "What won last time"', () => {
  const pre = guideHtml(predecessorGuide);
  assert.match(pre, /<h2[^>]*>What won before<\/h2>\s*<div>\s*<p[^>]*>in Arc&#x27;s HackMoney 2026 track<\/p>\s*<ul/);
  const own = guideHtml(fullGuide);
  assert.doesNotMatch(own, /<h2[^>]*>What won last time<\/h2>\s*<div>\s*<p/);
});

test('fix round 1, Important 1: a malformed or unknown id is a 404 with no per-id read', async () => {
  const read: string[] = [];
  let idReads = 0;
  const ids = async () => { idReads++; return ['arc-microgrants', 'old-closed']; };
  const reader = async (id: string) => { read.push(id); return fullGuide; };
  for (const id of ['Arc', '../x', 'a'.repeat(65), '', 'arc microgrants', 'x.svg']) assert.equal(await gatedGuidePage(id, ids, reader), null, id);
  assert.equal(idReads, 0, 'a malformed id reads nothing');
  assert.equal(await gatedGuidePage('nope', ids, reader), null);
  assert.equal(await gatedGuidePage('old-closed', ids, reader), fullGuide, 'closed ids keep their page');
  assert.equal(await gatedGuidePage('arc-microgrants', ids, reader), fullGuide);
  assert.deepEqual(read, ['old-closed', 'arc-microgrants'], 'only known ids are read');
  // A failed id-set read rejects (the unavailable panel), never null (a 404).
  await assert.rejects(gatedGuidePage('arc-microgrants', async () => { throw new Error('db down'); }, reader));
});

test('fix round 1, Minor 6: the description names only the parts the guide has', () => {
  assert.equal(guideDescription(fullGuide), 'What can I earn on Arc Microgrants? Difficulty, what won before, and what Arc wants now.');
  assert.equal(guideDescription(partialGuide), 'What can I earn on Arc Microgrants? Difficulty and what Arc wants now.');
  assert.equal(guideDescription(emptyGuide), 'What can I earn on Circle Developer Grants? Difficulty.');
});

test('fix round 1, Minor 5: every source_url in programs/*.json survives shownUrl (no source silently dropped)', () => {
  const dir = join(import.meta.dirname, '../../../../programs');
  const urls: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (k === 'source_url' && typeof x === 'string') urls.push(x);
        else walk(x);
      }
  };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) walk(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  assert.ok(urls.length >= 6);
  for (const u of urls) assert.notEqual(shownUrl(u), null, u);
});

test('v2.8 Ruling 19 (plan): the builder bonus pill at sm, md and lg, with and without an amount', () => {
  const heights = { sm: 'h-7', md: 'h-9', lg: 'h-11' } as const;
  for (const size of ['sm', 'md', 'lg'] as const) {
    for (const amount of [undefined, null, '0.42 ETH']) {
      const h = html(React.createElement(BonusPill, { size, amount }));
      const want = amount ? 'Builder bonus · 0.42 ETH' : 'Builder bonus';
      assert.equal(text(h).trim(), want, `${size} ${amount}`);
      assert.equal(bonusPillLabel(amount), want);
      assert.match(h, /^<span /, 'no href: a span');
      assert.match(h, new RegExp(`^<span class="[^"]*\\b${heights[size]}\\b`), size);
      for (const other of Object.values(heights).filter((x) => x !== heights[size])) assert.doesNotMatch(h, new RegExp(`\\b${other}\\b`), size);
      assert.match(h, /<svg[^>]*viewBox="0 0 16 16"[^>]*aria-hidden="true"/);
      assert.match(h, /bg-clip-text text-transparent/);
      assert.match(h, /padding-box/);
      assert.match(h, /border-box/);
    }
  }
  const a = html(React.createElement(BonusPill, { size: 'lg', href: '#how-you-earn-3' }));
  assert.match(a, /^<a [^>]*href="#how-you-earn-3"/);
  assert.equal(text(a).trim(), BONUS_PILL_TEXT);
  // Never "0 ETH", never an empty amount.
  for (const amount of ['0 ETH', '0.00 ETH', '', '  '])
    assert.equal(text(html(React.createElement(BonusPill, { amount }))).trim(), 'Builder bonus', JSON.stringify(amount));
  assert.equal(bonusPillLabel('<0.01 ETH'), 'Builder bonus · <0.01 ETH');
  // Two pills on one page keep distinct gradient ids.
  const two = html(React.createElement('div', null, React.createElement(BonusPill), React.createElement(BonusPill)));
  const ids = [...two.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.ok(two.includes(`fill="url(#${id})"`), id);
});

test('v2.8 Ruling 19 (plan): the pill has accessible contrast (each orange stop at least 4.5:1 on the navy fill)', () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (x: string, y: string) => {
    const [hi, lo] = [lum(x), lum(y)].sort((m, n) => n - m);
    return (hi + 0.05) / (lo + 0.05);
  };
  assert.equal(BONUS_PILL_COLORS.fill, '#0F1839');
  assert.ok(lum(BONUS_PILL_COLORS.fill) < 0.02, 'a navy fill');
  for (const stop of [BONUS_PILL_COLORS.from, BONUS_PILL_COLORS.to]) assert.ok(contrast(stop, BONUS_PILL_COLORS.fill) >= 4.5, stop);
});

test('10.11 the home page: "Builders using EarnKit won $12,500" under the stats line; absent (never "$0") without one', () => {
  const won = 'Builders using EarnKit won $12,500';
  const heroBits = (h: string) => {
    const afterH1 = h.slice(h.indexOf('</h1>'));
    return [...afterH1.slice(0, afterH1.indexOf('</section>')).matchAll(/>([^<]+)</g)].map((m) => text(m[1]).trim()).filter(Boolean);
  };
  assert.deepEqual(heroBits(home({ ...homeFixture, won_line: won })).slice(-2), [homeFixture.stats_line, won]);
  assert.deepEqual(heroBits(home({ ...homeFixture, stats_line: null, won_line: won })).slice(-1), [won]);
  for (const h of [home(homeFixture), home({ ...homeFixture, stats_line: null })]) {
    assert.doesNotMatch(text(h), /Builders using EarnKit/);
    assert.doesNotMatch(text(h), /won \$0/);
  }
});
