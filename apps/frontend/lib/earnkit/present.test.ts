import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  closesInDays,
  endsOf,
  fieldText,
  presentFirstMessage,
  programUpdates,
  table,
  type Card,
  type CampaignRow,
  type FirstMessage,
} from './present';
import type { Verdict } from './match';

const NOW = new Date('2026-10-04T12:00:00Z');
const campaign: CampaignRow = {
  id: 'earnkit-campaign-1-base',
  title: 'EarnKit Campaign #1: Base apps with real users',
  prize: '$100 each to top 5 (in MINI)',
  prize_usd_each: 100,
  ends_at: new Date('2026-10-18T23:59:00Z'),
  entries: 12,
  cutoff: 14,
  scored: 12,
  winners: 5,
  min_score: 10,
  you: null,
  open: true,
};
const base: Card = {
  id: 'base-builder-grants', title: 'Base Builder Grant Program', summary: 'up to $5,000 · rolling',
  tag: 'needs a live product', each_time: ['a short Loom', 'usage numbers'], ends_at: null, max_award_usd: 5000, builder_fields: 10,
};
const arc: Card = {
  id: 'arc-microgrants', title: 'Arc Microgrants', summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET',
  tag: null, each_time: [], ends_at: new Date('2026-10-15T03:59:00Z'), max_award_usd: 500, builder_fields: 1,
};
const monad: Card = {
  id: 'monad-metropolis', title: 'Monad Metropolis Hackathon', summary: '$250K+ prize pool · closes Oct 13, 11:59 PM ET',
  tag: 'long shot', each_time: [], ends_at: new Date('2026-10-14T03:59:00Z'), builder_fields: 0,
};
const circle: Card = {
  id: 'circle-developer-grants', title: 'Circle Developer Grants', summary: 'milestone-based USDC grants · rolling',
  tag: 'needs a live product', each_time: ['a milestone plan'], ends_at: null, builder_fields: 0,
};
const colosseum: Card = {
  id: 'colosseum-worlds-fair', title: "Crypto World's Fair Hackathon", summary: 'Tempo $100K, Base $25K tracks · closes Oct 12, 11:59 PM PT',
  tag: 'long shot', each_time: ['a pitch video', 'a demo video'], ends_at: new Date('2026-10-13T06:59:00Z'), builder_fields: 4,
};
const tiny: Card = {
  id: 'tiny', title: 'Tiny Bounty', summary: '50 USDC · closes Oct 9', tag: null, each_time: [],
  ends_at: new Date('2026-10-09T23:59:00Z'), max_award_usd: 50, builder_fields: 0,
};
const sponsored: Card = {
  id: 'sponsor-abc', title: '"Build on Acme"', summary: 'by "Acme" · Sponsored · unverified · 1,000 USDC pool in escrow · closes Oct 20',
  tag: null, each_time: [], ends_at: new Date('2026-10-20T00:00:00Z'), sponsored: true, max_award_usd: 300,
};
const v = (program_id: string, status: Verdict['status'], note: string, effort: Verdict['effort'] = 'none'): Verdict => ({
  program_id, program: program_id, status, missing: [], effort, note,
});
const repos = (...verdicts: Verdict[]) => ({
  checked: 1,
  fits: [{ repo: 'tipjar', repo_url: null, verdicts }],
});
const msg = (m: Partial<FirstMessage>): FirstMessage => ({
  alerts: [], campaigns: [], cards: [], repos: null, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, ...m,
});
const noEmoji = (s: string) => assert.doesNotMatch(s, /\p{Extended_Pictographic}/u);

test('v2.4 §1 golden: alerts, the campaign, what the repos qualify for, one offer (the spec example)', () => {
  const text = presentFirstMessage(msg({
    alerts: ['your token $TIP has $138 in fees to claim (tokens.fun/coin/0xabc)'],
    campaigns: [campaign],
    cards: [base, arc],
    repos: repos(
      v('base-builder-grants', 'likely', 'looks eligible if it has real users'),
      v('arc-microgrants', 'likely', 'looks eligible'),
    ),
  }));
  assert.equal(text, [
    'Since you last checked: your token $TIP has $138 in fees to claim (tokens.fun/coin/0xabc).',
    '| Win | Prize | Ends | You |\n|---|---|---|---|\n| EarnKit Campaign #1: Base apps with real users | $100 each to top 5 (in MINI) | Oct 18, 14 days left | 12 entered, #5 has 14 users |',
    'Your repos already qualify for:\n\n| Program | Prize | Ends | Repo |\n|---|---|---|---|\n| Base Builder Grant Program | up to $5,000 | rolling | tipjar |\n| Arc Microgrants | 500 USDC × 20 grants | Oct 14 | tipjar |',
    'Want me to build your entry for the $100?',
  ].join('\n\n'));
  noEmoji(text);
});

test('golden: an entered builder, a fit that needs a step, other programs (at most 5), sponsored last, the fastest offer', () => {
  const text = presentFirstMessage(msg({
    campaigns: [{ ...campaign, you: '#3, in the top 5' }],
    cards: [arc, base, monad, circle, colosseum, tiny, sponsored],
    repos: repos(v('arc-microgrants', 'after_step', 'needs a live link', 'minutes'), v('sponsor-abc', 'likely', 'looks eligible')),
  }));
  assert.equal(text, [
    '| Win | Prize | Ends | You |\n|---|---|---|---|\n| EarnKit Campaign #1: Base apps with real users | $100 each to top 5 (in MINI) | Oct 18, 14 days left | #3, in the top 5 |',
    'Your repos can enter:\n\n| Program | Prize | Ends | Repo |\n|---|---|---|---|\n| Arc Microgrants | 500 USDC × 20 grants | Oct 14 | tipjar, needs a live link |',
    "Also open:\n\n| Program | Prize | Ends |\n|---|---|---|\n| Base Builder Grant Program | up to $5,000 | rolling |\n| Tiny Bounty | 50 USDC | Oct 9 |\n| Crypto World's Fair Hackathon | Tempo $100K, Base $25K tracks | Oct 12 |\n| Monad Metropolis Hackathon | $250K+ prize pool | Oct 13 |\n| Circle Developer Grants | milestone-based USDC grants | rolling |",
    'Sponsored (set by sponsors; EarnKit didn\'t write or check them):\n\n| Campaign | Details |\n|---|---|\n| "Build on Acme" | by "Acme" · Sponsored · unverified · 1,000 USDC pool in escrow · closes Oct 20 |',
    'Want me to start on Arc Microgrants with tipjar?',
  ].join('\n\n'));
  noEmoji(text);
});

test('other programs are capped at 5 rows, with one line for the rest', () => {
  const more = Array.from({ length: 7 }, (_, i) => ({ ...tiny, id: `t${i}`, title: `Bounty ${i}` }));
  const text = presentFirstMessage(msg({ cards: more }));
  assert.equal((text.match(/^\| Bounty /gm) ?? []).length, 5);
  assert.match(text, /\n\n2 more open: ask me for the full list\.\n\n/);
  assert.match(text, /^Open now:/);
});

test('Fastest: prize per hour of effort; programs needing videos or forms never go first', () => {
  // The grant pays most per hour but needs a Loom and 10 personal answers: Arc is offered.
  const text = presentFirstMessage(msg({
    campaigns: [{ ...campaign, you: '#3, in the top 5' }],
    cards: [base, arc],
    repos: repos(v('base-builder-grants', 'likely', 'looks eligible', 'none'), v('arc-microgrants', 'after_step', 'needs a live link', 'minutes')),
  }));
  assert.match(text, /Want me to start on Arc Microgrants with tipjar\?$/);
  // Only forms programs fit: offered, saying up front what only the builder can give.
  const only = presentFirstMessage(msg({ cards: [base], repos: repos(v('base-builder-grants', 'likely', 'looks eligible')) }));
  assert.match(only, /Want me to start on Base Builder Grant Program with tipjar\? It needs a short Loom from you\.$/);
  const answers = presentFirstMessage(msg({
    cards: [{ ...arc, builder_fields: 3 }], repos: repos(v('arc-microgrants', 'likely', 'looks eligible')),
  }));
  assert.match(answers, /Want me to start on Arc Microgrants with tipjar\? It needs 3 answers only you can give\.$/);
});

test('one offer: keep going beats the campaign; a sponsor campaign is never offered or in the repo table', () => {
  const resume = presentFirstMessage(msg({ campaigns: [campaign], cards: [arc], workingOn: ['arc-microgrants'] }));
  assert.match(resume, /Want me to keep going on Arc Microgrants\?$/);
  const sponsorOnly = presentFirstMessage(msg({ cards: [sponsored], repos: repos(v('sponsor-abc', 'likely', 'looks eligible')) }));
  assert.doesNotMatch(sponsorOnly, /Your repos/);
  assert.match(sponsorOnly, /None of your 1 repo fits an open program yet\./);
  assert.match(sponsorOnly, /Pick one and I'll start\.$/);
});

test('chat-only agents are told honestly; repo errors in one line; nothing open', () => {
  assert.match(presentFirstMessage(msg({ cards: [arc], agentCanBuild: false })), /can't build or deploy from here/);
  assert.match(presentFirstMessage(msg({ cards: [arc], repos: { error: 'GitHub said no' } })), /^Couldn't read your repos: GitHub said no/);
  assert.equal(presentFirstMessage(msg({})), 'Nothing is open right now. Want me to tell you when something opens?');
  assert.equal(
    presentFirstMessage(msg({ alerts: ['you won $100 in MINI with Tip Jar (basescan.org/tx/0x1)'] })),
    'Since you last checked: you won $100 in MINI with Tip Jar (basescan.org/tx/0x1).\n\nNothing is open right now. Want me to tell you when something opens?',
  );
});

test('an ended campaign the builder is in shows how it ended for them', () => {
  const text = presentFirstMessage(msg({ campaigns: [{ ...campaign, open: false, you: 'in review' }] }));
  assert.match(text, /\| EarnKit Campaign #1: Base apps with real users \| \$100 each to top 5 \(in MINI\) \| ended Oct 18 \| in review \|/);
  assert.doesNotMatch(text, /build your entry/);
  assert.match(text, /\n\nNothing else is open right now\. Want me to tell you when the results are in\?$/);
  const lost = presentFirstMessage(msg({ campaigns: [{ ...campaign, open: false, you: 'not in top 5' }] }));
  assert.match(lost, /\n\nNothing else is open right now\. Want me to tell you when something opens\?$/);
});

test('Review Focus 5: a "|" in a cell is escaped so the table renders', () => {
  assert.equal(table(['A', 'B'], [['x | y', 'z']]), '| A | B |\n|---|---|\n| x \\| y | z |');
  const text = presentFirstMessage(msg({ cards: [{ ...arc, title: 'Arc | Grants' }] }));
  assert.match(text, /\| Arc \\\| Grants \|/);
});

test('fieldText and endsOf', () => {
  assert.equal(fieldText({ ...campaign, entries: 0, scored: 0, cutoff: null }), 'no entries yet');
  assert.equal(fieldText({ ...campaign, entries: 3, scored: 3, cutoff: null }), '3 entered, top 5 not full (10 users to qualify)');
  // I2: before the first scoring a full field isn't "not full".
  assert.equal(fieldText({ ...campaign, entries: 12, scored: 0, cutoff: null }), '12 entered, not scored yet');
  assert.equal(endsOf(arc), 'Oct 14');
  assert.equal(endsOf(base), 'rolling');
  assert.equal(endsOf({ ...arc, summary: '500 USDC' }), 'Oct 15');
});

test('programUpdates: curated programs by name, sponsored ones counted, nothing on a first check', () => {
  const cards: Card[] = [
    { ...arc, is_new: true },
    { ...tiny, closes_in_days: 1 },
    { ...sponsored, is_new: true },
  ];
  assert.deepEqual(programUpdates(cards, false), ['new: Arc Microgrants', '1 new sponsored campaign', 'Tiny Bounty closes in 1 day']);
  assert.deepEqual(programUpdates(cards, true), []);
});

test('closesInDays: within 3 days only, never negative', () => {
  const now = new Date('2026-10-04T00:00:00Z');
  assert.equal(closesInDays(new Date('2026-10-06T12:00:00Z'), now), 2);
  assert.equal(closesInDays(new Date('2026-10-20T00:00:00Z'), now), null);
  assert.equal(closesInDays(new Date('2026-10-03T00:00:00Z'), now), 0);
  assert.equal(closesInDays(null, now), null);
});

test('ruling 12: EarnKit campaigns by prize per winner, then the earlier end; the offer names the top one', () => {
  const small = { ...campaign, id: 'c-small', title: 'Small', prize_usd_each: 50, ends_at: new Date('2026-10-08T00:00:00Z') };
  const bigLate = { ...campaign, id: 'c-big-late', title: 'Big late', prize_usd_each: 200, ends_at: new Date('2026-10-30T00:00:00Z') };
  const bigSoon = { ...campaign, id: 'c-big-soon', title: 'Big soon', prize_usd_each: 200, ends_at: new Date('2026-10-20T00:00:00Z') };
  const text = presentFirstMessage(msg({ campaigns: [small, bigLate, bigSoon] }));
  const order = [...text.matchAll(/^\| (Small|Big late|Big soon) \|/gm)].map((m) => m[1]);
  assert.deepEqual(order, ['Big soon', 'Big late', 'Small']);
  assert.match(text, /Want me to build your entry for the \$200\?$/);
});

test('I3 offers: no repos known asks to check them; repos known with no fit offers the top quick program', () => {
  const noRepos = presentFirstMessage(msg({ campaigns: [{ ...campaign, you: '#3, in the top 5' }], cards: [base, arc, tiny] }));
  assert.match(noRepos, /\n\nWant me to check which of your repos already qualify\?$/);
  const noFit = presentFirstMessage(msg({ cards: [base, arc, tiny], repos: repos(v('arc-microgrants', 'no', 'not on Arc')) }));
  // Base pays more but needs a Loom and 10 personal answers: Arc is the top program without forms.
  // Ruling 28: the repo was ruled out, so the offer is to build something new, never "start on".
  assert.match(noFit, /\n\nWant me to build something new for Arc Microgrants \(500 USDC × 20 grants\)\?$/);
  assert.doesNotMatch(noFit, /start on/);
  // A repo error counts as "no repos known".
  assert.match(presentFirstMessage(msg({ cards: [arc], repos: { error: 'GitHub said no' } })), /check which of your repos already qualify\?$/);
  // An open campaign without an entry stays the top choice.
  assert.match(presentFirstMessage(msg({ campaigns: [campaign], cards: [arc] })), /build your entry for the \$100\?$/);
});

test('days left counts UTC calendar days: never "ends today" a day early', () => {
  const ends = new Date('2026-10-18T06:00:00Z');
  const at = (now: string) => presentFirstMessage(msg({ campaigns: [{ ...campaign, ends_at: ends }], now: new Date(now) }));
  assert.match(at('2026-10-17T23:00:00Z'), /\| Oct 18, 1 day left \|/);
  assert.match(at('2026-10-18T01:00:00Z'), /\| Oct 18, ends today \|/);
  assert.match(at('2026-10-04T12:00:00Z'), /\| Oct 18, 14 days left \|/);
});

test('Ruling 28: repos known, nothing fits, only forms programs open: build something new, saying what it needs', () => {
  const text = presentFirstMessage(msg({
    cards: [circle, base], repos: repos(v('base-builder-grants', 'no', 'not on Base')),
  }));
  assert.match(text, /None of your 1 repo fits an open program yet\./);
  assert.match(text, /\n\nWant me to build something new for Base Builder Grant Program \(up to \$5,000\)\? It needs a short Loom from you\.$/);
  assert.doesNotMatch(text, /Pick one/);
  const answers = presentFirstMessage(msg({
    cards: [{ ...arc, builder_fields: 3 }], repos: repos(v('arc-microgrants', 'no', 'not on Arc')),
  }));
  assert.match(answers, /Want me to build something new for Arc Microgrants \(500 USDC × 20 grants\)\? It needs 3 answers only you can give\.$/);
});

test('I7: closing-soon and new non-campaign programs stay in the body; they never start the reply as an alert', () => {
  const cards: Card[] = [{ ...arc, is_new: true }, { ...tiny, closes_in_days: 1 }, { ...sponsored, is_new: true }];
  const updates = programUpdates(cards, false);
  const quiet = presentFirstMessage(msg({ cards, updates }));
  assert.doesNotMatch(quiet, /Since you last checked/);
  assert.doesNotMatch(quiet, /^Updates/);
  assert.match(quiet, /\n\nUpdates: new: Arc Microgrants; 1 new sponsored campaign; Tiny Bounty closes in 1 day\.\n\nWant me to /);
  // Real news (a win) still leads; the updates stay below.
  const news = presentFirstMessage(msg({ alerts: ['you won $100 in MINI with Tip Jar (basescan.org/tx/0x1)'], cards, updates }));
  assert.match(news, /^Since you last checked: you won \$100 in MINI with Tip Jar \(basescan\.org\/tx\/0x1\)\.\n\n/);
  assert.doesNotMatch(news.split('\n\n')[0], /closes in|new: Arc/);
  // Only a sponsored card: its table comes first, the update after it.
  const sponsorOnly = presentFirstMessage(msg({ cards: [{ ...sponsored, is_new: true }], updates: programUpdates([{ ...sponsored, is_new: true }], false) }));
  assert.match(sponsorOnly, /^Sponsored /);
});

test('I7: list_programs feeds program updates to the body, not the alert line', () => {
  const src = readFileSync(join(import.meta.dirname, 'tools.ts'), 'utf8');
  assert.match(src, /alerts: alerts\.lines,\n\s*updates: programUpdates\(cards, lastCheck === null\),/);
});
