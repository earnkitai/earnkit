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
    'Where coin fees go',
    'The builder bonus',
    'The coin is optional',
    'No affiliation',
    'Contact',
  ])
    assert.match(h, new RegExp(`<h2[^>]*>${heading}</h2>`), heading);
  // Fee split, after Clanker's 20%.
  assert.match(t, /Clanker keeps 20%/);
  for (const [who, share] of [['Your project', '40%'], ['MINI buyback', '10%'], ['Builder bonus', '20%'], ['EarnKit', '30%']])
    assert.match(t, new RegExp(`${who} ${share}`), who);
  // Signals and weights; market cap only breaks ties; never trading volume.
  for (const w of ['40', '20', '20', '10', '10']) assert.ok(t.includes(` ${w} `));
  assert.match(t, /Market cap only breaks ties/);
  assert.match(t, /Trading volume never counts/);
  // Eligibility, review, payout split in WETH, after the end.
  assert.match(t, /submission page/);
  assert.match(t, /earnkit\.txt/);
  assert.match(t, /48 hours/);
  assert.match(t, /farmed/);
  assert.match(t, /WETH/);
  assert.match(t, /1st 25% 2nd 18% 3rd 14% 4th 11% 5th 9% 6th 7% 7th 6% 8th 4% 9th 3% 10th 3%/);
  // Where the bonus share goes after a round: the next month for a rolling program; the Safe once
  // a program ends, and for programs without public submissions.
  assert.match(t, /monthly round is followed by the next month's round/);
  assert.match(t, /Once a program ends, its coins' builder bonus share goes to EarnKit's Safe/);
  assert.match(t, /So does the share of programs whose submissions aren't public/);
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
  review_until: null,
  pool: '0.42',
  days_left: 26,
  removed: 0,
  rows: [
    { rank: 1, name: 'Tipjar', repo_url: 'https://github.com/a/tipjar', live_url: 'https://tipjar.app', score: '81.5', eligible: true, note: 'Yes', amount: null, tx: null },
    { rank: null, name: 'Splitly', repo_url: null, live_url: null, score: null, eligible: false, note: 'No: no coin', amount: null, tx: null },
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
  assert.match(t, /Ends Nov 1, 2026/);
  assert.match(t, /# Project Score Eligible/);
  assert.match(t, /1 Tipjar .*81\.5 Yes/);
  assert.match(t, /– Splitly .*– .*No: no coin/);
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
  assert.match(t, /Ended Nov 1, 2026/);
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
  assert.match(page, /try \{\s*round = decodeURIComponent\(raw\);\s*\} catch \{\s*notFound\(\);/);
  assert.doesNotMatch(page, /bonusBoard\(decodeURIComponent/);
  // The escape that made it throw.
  assert.throws(() => decodeURIComponent('%E0%A4%A'), URIError);
});
