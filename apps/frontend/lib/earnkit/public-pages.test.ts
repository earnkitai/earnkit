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
import { BONUS_PILLS } from '../../app/components/sections/BuilderBonus';
import { BONUS_TOP } from './present';
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
  for (const s of ['Agents only', 'Find things worth building for.', 'Find live builder programs and start building with your agent.', '$1.3M+ open right now', '+ Builder bonus on every program', 'Add to your agent', 'Watch the demo', '120 agents earning'])
    assert.ok(t.includes(s), s);
  // v2.7.2: the hero is the promise, the orange bonus pill and the buttons; no figure, no "Then ask"
  // line. The pool figure heads the Open programs section instead.
  const order = ['Find things worth building for.', 'Find live builder programs', '+ Builder bonus on every program', 'Add to your agent', '120 agents earning', 'Open programs', '$1.3M+ open right now'].map((s) => t.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(h, /<a[^>]*href="#builder-bonus"[^>]*>\+ Builder bonus on every program<\/a>/);
  assert.match(h, /<a[^>]*href="#builder-bonus"[^>]*class="[^"]*bg-ek-orange[^"]*"/);
  assert.ok(!t.includes('Then ask:'));
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
  // v2.7.1: the pool is the big line, "up to $X per winner" under it; no pool, the per-winner amount.
  assert.ok(t.includes('$840K in prizes up to $30,000 per winner 8 days left Hard (estimate) + 0.42 ETH bonus'));
  assert.ok(t.includes('10,000 USDC pool 500 USDC per grant'));
  assert.ok(t.includes('up to $5,000 per grant rolling'));
  assert.ok(t.includes('$200K in grants $5K–$100K per grant rolling'));
  assert.doesNotMatch(t, /per winner rolling|grants? up to \$[\d,]+ per winner/); // review #1: grants never say "per winner"
  assert.ok(!t.includes('Prize ') && !t.includes('Ends ') && !t.includes('Difficulty '));
  // The section: no "Open now" eyebrow; review #5: no bonus line under the title (the pills say it).
  assert.match(t, /Open programs \$1\.3M\+ open right now See all CW Crypto World/);
  assert.doesNotMatch(t, /Every entry also competes/);
  assert.doesNotMatch(t, /Open now/i);
  for (const [i, c] of cards.entries()) {
    const ct = text(c);
    const tl = homeFixture.tiles[i];
    assert.ok(ct.includes('Ask your agent'), tl.id);
    assert.match(c, new RegExp(`href="/programs/${tl.id}"[^>]*>Guide</a>`), tl.id);
    for (const v of [tl.title, tl.chain, tl.prize, tl.ends]) assert.ok(ct.includes(v), `${tl.id}: ${v}`);
    // Chips: the deadline and the difficulty (none for "—"); the bonus pill whenever the program has one.
    const chips = [...c.slice(0, c.indexOf('Ask your agent')).matchAll(/<li class="rounded-full[^"]*"[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
    assert.deepEqual(chips, [tl.ends, ...(tl.difficulty === '—' ? [] : [tl.difficulty]), ...(tl.bonus ? [tl.bonus] : [])], tl.id);
  }
  assert.ok(t.includes('+ 0.42 ETH bonus') && t.includes('+ Builder bonus'));
  // No stats strip, no duplicate open-money figure.
  assert.doesNotMatch(t, /Open money|EarnKit in numbers/);
  assert.equal(t.split('open right now').length, 2);
  // v2.7.1: the builder bonus section, between the programs and how it works.
  const bb = h.slice(h.indexOf('id="builder-bonus"'));
  assert.ok(h.includes('id="builder-bonus"'));
  const bt = text(bb.slice(0, bb.indexOf('</section>')));
  for (const s of ['Win twice.', 'Top 10 on every program', 'Paid in ETH', 'Ranked on real users', '0.60 ETH in pools so far', 'See programs']) assert.ok(bt.includes(s), s);
  assert.match(bb, /<a[^>]*href="\/programs"[^>]*>See programs<\/a>/);
  assert.doesNotMatch(h, /Leaderboards/);
  assert.equal(BONUS_PILLS[0], `Top ${BONUS_TOP} on every program`); // the payout split's length
  assert.ok(t.indexOf('Open programs') < t.indexOf('Win twice.') && t.indexOf('Win twice.') < t.indexOf('Add EarnKit'));
  // The 3 steps.
  for (const s of ['Add EarnKit', 'One link, free.', 'Ask “What can I earn?”', 'Your agent finds programs you qualify for.', 'Your agent builds and submits', 'With a token that joins the builder bonus.'])
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
  assert.ok(t.includes('Find things worth building for.'));
  assert.ok(t.includes('Add to your agent'));
  assert.ok(!t.includes('Then ask:'));
  assert.ok(!t.includes('open right now'));
  assert.ok(!t.includes('Ask your agent'));
  assert.ok(!t.includes('Open programs'));
  assert.ok(!t.includes('agents earning'));
  // Review #2: the bonus section keeps its pills but shows no figure: the read failed, so it
  // never claims the pools are empty (or "0 ETH").
  for (const s of ['Win twice.', 'Top 10 per program', 'Paid in ETH', 'Ranked on real users']) assert.ok(t.includes(s), s);
  assert.doesNotMatch(t, /Pools start|in pools so far|\b0 ETH/);
  // Review #6: "on every program" only when the read shows it.
  assert.ok(t.includes('+ Builder bonus Add to your agent'));
  assert.doesNotMatch(t, /on every program/);
  assert.ok(t.includes('Your agent builds and submits')); // how it works stays
});

test('review #2, #6: a successful read with empty pools says so; a program without the bonus drops "every"', () => {
  const t = text(home({ ...homeFixture, bonus_pools: null }));
  assert.ok(t.includes('Win twice. See programs Pools start with the first entry'));
  const some = text(home({ ...homeFixture, bonus_every: false }));
  assert.ok(some.includes('+ Builder bonus Add to your agent') && some.includes('Top 10 per program'));
  assert.doesNotMatch(some, /on every program/);
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

test('v2.7.1: the header is Docs and the install, desktop and mobile; Follow on X is in the footer only', () => {
  const h = html(React.createElement(Header));
  assert.equal((h.match(/<button[^>]*>Add to your agent<\/button>/g) ?? []).length, 2); // desktop and mobile
  assert.equal((h.match(/<a[^>]*href="https:\/\/docs\.earnkit\.com"[^>]*>Docs<\/a>/g) ?? []).length, 2);
  assert.doesNotMatch(h, /Follow on X/);
  assert.match(html(React.createElement(Footer)), /Follow on X/);
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
  // v2.7.1: one pill under the steps.
  assert.ok(t.includes('+ Builder bonus on every entry Then ask your agent'));
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
  assert.ok(t.includes('Difficulty: Medium — 20 of ~160 entries won last round'));
  for (const heading of ['What won last time', 'What Arc wants now', 'Your best bet'])
    // The won section wraps its list (Ruling C12's event line goes above it when not own).
    assert.match(h, new RegExp(`<h2[^>]*>${heading}</h2>\\s*(?:<div>\\s*)?<ul`), heading);
  const items = [...h.matchAll(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]).trim());
  for (const line of [
    'USDC payroll and payouts (3 of 20 winners)',
    'Agent wallets paying for APIs (2 of 20)',
    'Example: PayStream — streamed salaries in USDC; cited for live mainnet demo',
    'Stablecoin payments', 'FX', 'Agentic commerce',
    'A USDC payout tool with a live mainnet demo',
  ])
    assert.ok(items.includes(line), line);
  // v2.7.1: the builder bonus is a pill beside Difficulty, linking to the leaderboard.
  assert.ok(t.includes('Difficulty: Medium — 20 of ~160 entries won last round + 0.18 ETH bonus'));
  assert.match(h, /<a[^>]*href="\/bonus\/arc-microgrants-2026-09-16"[^>]*>\+ 0\.18 ETH bonus<\/a>/);
  assert.doesNotMatch(t, /leaderboard/);
  // Sources: labelled by what each backs (fix round 1), each link through shownUrl, host as title.
  assert.ok(t.includes('Sources: program page · past winners 1 · past winners 2 · priorities'));
  assert.doesNotMatch(t, /community\.arc\.io|\(2\)/);
  for (const { url } of fullGuide.sources)
    assert.match(h, new RegExp(`<a[^>]*href="${shownUrl(url)!.replace(/[.?]/g, '\\$&')}"[^>]*title="${new URL(url).hostname.replace(/\./g, '\\.')}"[^>]*rel="noopener noreferrer"`), url);
  // Every visible link is https or a local path.
  for (const [, href] of h.matchAll(/href="([^"]+)"/g)) assert.match(href, /^(https:\/\/|\/)/, href);
  // One primary action, with the program's own question; "All programs" goes to the index.
  assert.ok(t.includes('Ask your agent'));
  // Twice (fix round 1): under the difficulty line, above the fold, and in the action row.
  assert.deepEqual(asks(fullGuide), ['What can I earn on Arc Microgrants?', 'What can I earn on Arc Microgrants?']);
  assert.ok(h.indexOf('Ask your agent') < h.indexOf('What won last time'), 'the first is in the header');
  assert.equal(askPrompt('Arc Microgrants'), 'What can I earn on Arc Microgrants?');
  assert.match(h, /<a[^>]*href="\/programs"[^>]*>All programs<\/a>/);
  // No paragraphs of prose.
  for (const [, p] of h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g))
    if (!p.includes('Where agents earn.') && !p.includes('All rights reserved'))
      assert.ok(text(p).trim().length <= 140, text(p));
  assert.ok(t.includes('Where agents earn.'), 'the footer');
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
  assert.ok(t.includes('Difficulty: Medium (estimate) — no past results yet'));
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
  const h = html(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1' }));
  assert.match(h, /<h1[^>]*>Open programs<\/h1>/);
  assert.ok(text(h).includes('By pool'));
  assert.doesNotMatch(text(h), /Open now/);
  assert.equal([...h.matchAll(/>Guide</g)].length, homeFixture.tiles.length, 'no limit');
  assert.doesNotMatch(h, /See all/);
  // v2.7.1: the same pool total as the landing page, under the h1 (app/programs/page.tsx passes landing.open_text).
  const fig = text(html(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1', figure: homeFixture.open_text })));
  assert.ok(fig.includes('By pool Open programs $1.3M+ open right now CW Crypto World'), fig);
  assert.match(readFileSync(join(import.meta.dirname, '../../app/programs/page.tsx'), 'utf8'), /figure=\{landing\.open_text\}/);
  const u = text(html(React.createElement(Unavailable, { text: 'Programs are unavailable right now.' })));
  assert.ok(u.includes('Programs are unavailable right now.'));
  assert.ok(u.includes('Where agents earn.'), 'the footer');
});

test('fix round 1, Minor 3: a predecessor round reads "What won before" and names the round', () => {
  const h = guideHtml(predecessorGuide);
  const t = text(h);
  assert.match(h, /<h2[^>]*>What won before<\/h2>/);
  assert.doesNotMatch(t, /last (time|round)/);
  assert.ok(t.includes("Difficulty: Medium — 20 of ~160 entries won in Arc's HackMoney 2026 track"));
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
