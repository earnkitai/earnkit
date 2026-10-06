import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BONUS_NOTE,
  bonusCell,
  bonusProgramIds,
  closesInDays,
  endsOf,
  fieldText,
  openMoneyUsd,
  presentFirstMessage,
  programUpdates,
  table,
  youCould,
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
  submission_proof: { host: 'dorahacks.io' },
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
  submission_proof: { host: 'colosseum.com' },
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

const NOTE =
  "Builder bonus: paid by EarnKit from coin fees. EarnKit isn't affiliated with or endorsed by any program's organizer. Details: earnkit.com/policy";
const WEI = (eth: string) => BigInt(Math.round(Number(eth) * 1e6)) * 10n ** 12n;

test('v2.5 §1 golden (a): repos fit 2 programs: $X in open money, the bonus table, the note, one offer', () => {
  const text = presentFirstMessage(msg({
    alerts: ['your token $TIP has $138 in fees to claim (tokens.fun/coin/0xabc)'],
    cards: [base, { ...arc, bonus_pool_wei: WEI('0.42') }],
    repos: repos(
      v('base-builder-grants', 'likely', 'looks eligible if it has real users'),
      v('arc-microgrants', 'likely', 'looks eligible'),
    ),
  }));
  assert.equal(text, [
    'Since you last checked: your token $TIP has $138 in fees to claim (tokens.fun/coin/0xabc).',
    'EarnKit matches you to $5,500 in open money you qualify for.',
    '| Program | Prize | Builder bonus | Ends | Your repo |\n|---|---|---|---|---|\n| Base Builder Grant Program | up to $5,000 | new pool | rolling | tipjar |\n| Arc Microgrants | 500 USDC × 20 grants | 0.42 ETH so far | Oct 14 | tipjar |',
    NOTE,
    'Want me to start on Arc Microgrants with tipjar?',
  ].join('\n\n'));
  noEmoji(text);
});

test('v2.5 §1 golden (b): no repos: open money ranked by prize, ideas grouped by program (2 each, 6 in all), build one', () => {
  const ideas = (p: string) => [`${p} idea one`, `${p} idea two`, `${p} idea three`];
  const text = presentFirstMessage(msg({
    cards: [
      { ...tiny, ideas: ideas('Tiny') },
      { ...arc, ideas: ideas('Arc') },
      { ...base, ideas: ideas('Base') },
      { ...monad, ideas: [] },
    ],
  }));
  assert.equal(text, [
    '$5,550 is open right now. I can build an entry for you.',
    '| Program | You could win | Builder bonus | Ends |\n|---|---|---|---|\n| Base Builder Grant Program | up to $5,000 | new pool | rolling |\n| Arc Microgrants | 500 USDC × 20 grants | new pool | Oct 14 |\n| Tiny Bounty | 50 USDC | new pool | Oct 9 |\n| Monad Metropolis Hackathon | $250K+ prize pool | new pool | Oct 13 |',
    NOTE,
    "Ideas I can build:\n- Base Builder Grant Program: Base idea one\n- Base Builder Grant Program: Base idea two\n- Arc Microgrants: Arc idea one\n- Arc Microgrants: Arc idea two\n- Tiny Bounty: Tiny idea one\n- Tiny Bounty: Tiny idea two",
    "Pick one and I'll start.",
  ].join('\n\n'));
  noEmoji(text);
  // A GitHub user with no repos counts as no repo.
  const none = presentFirstMessage(msg({ cards: [{ ...arc, ideas: ['Arc idea'] }], repos: { checked: 0, fits: [] } }));
  assert.match(none, /^\$500 is open right now\. I can build an entry for you\.\n\n/);
  assert.match(none, /\n\nIdeas I can build:\n- Arc Microgrants: Arc idea\n\nPick one and I'll start\.$/);
  assert.doesNotMatch(none, /None of your/);
  // Honest offer rules still win: keep going, and chat-only agents.
  assert.match(presentFirstMessage(msg({ cards: [{ ...arc, ideas: ['x'] }], workingOn: ['arc-microgrants'] })), /Want me to keep going on Arc Microgrants\?$/);
  assert.match(presentFirstMessage(msg({ cards: [{ ...arc, ideas: ['x'] }], agentCanBuild: false })), /can't build or deploy from here/);
});

test('v2.5 §1 golden (c): a program without a per-winner amount is not counted in $X; its prize cell is its own words', () => {
  const text = presentFirstMessage(msg({
    cards: [arc, monad],
    repos: repos(v('arc-microgrants', 'likely', 'looks eligible'), v('monad-metropolis', 'likely', 'looks eligible')),
  }));
  assert.match(text, /^EarnKit matches you to \$500 in open money you qualify for\.\n\n/);
  assert.match(text, /\| Monad Metropolis Hackathon \| \$250K\+ prize pool \| new pool \| Oct 13 \| tipjar \|/);
  assert.equal(openMoneyUsd([arc, monad, arc]), 500);
  assert.equal(openMoneyUsd([monad]), 0);
  // Nothing countable: no "$0" line.
  const unknown = presentFirstMessage(msg({ cards: [monad], repos: repos(v('monad-metropolis', 'likely', 'looks eligible')) }));
  assert.match(unknown, /^Your repos fit these open programs:\n\n\| Program \| Prize \| Builder bonus \| Ends \| Your repo \|/);
  assert.doesNotMatch(unknown, /\$0/);
});

test('v2.5 §1 golden (d): the bonus cell', () => {
  assert.equal(bonusCell({ ...arc, bonus_pool_wei: WEI('0.42') }), '0.42 ETH so far');
  assert.equal(bonusCell({ ...arc, bonus_pool_wei: null }), 'new pool');
  assert.equal(bonusCell({ ...arc, bonus_pool_wei: 0n }), 'new pool');
  assert.equal(bonusCell(arc), 'new pool');
  assert.equal(bonusCell({ ...arc, bonus_pool_wei: 3n * 10n ** 15n }), 'under 0.01 ETH so far');
  assert.equal(bonusCell({ ...arc, bonus_pool_wei: 15n * 10n ** 17n }), '1.50 ETH so far');
  // Ruling 7 (plan): a program opts out with builder_bonus: false, never through submission_proof.
  assert.equal(bonusCell({ ...base, builder_bonus: false }), '—');
  assert.equal(bonusCell({ ...base, builder_bonus: false, bonus_pool_wei: WEI('1') }), '—');
});

test('v2.6 §1: the builder bonus cell', () => {
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: null }), 'new pool');
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: 0n }), 'new pool');
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: WEI('0.42') }), '0.42 ETH so far');
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: WEI('0.004') }), 'under 0.01 ETH so far');
  assert.equal(bonusCell({ builder_bonus: false, bonus_pool_wei: null }), '—');
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: null, bonus_closed: true }), '—');
});

test('v2.6 §1: no repo and no GitHub user: "$X is open right now", "You could win", ideas, pick one', () => {
  const text = presentFirstMessage(msg({
    cards: [
      { ...base, ideas: ['Base idea one', 'Base idea two', 'Base idea three'] },
      { ...arc, ideas: ['Arc idea'], bonus_pool_wei: WEI('0.18') },
      monad, circle, colosseum, tiny,
    ],
  }));
  // $X = every open curated program's per-winner prize, not only the 5 shown: 5000+500+50 (+0 for
  // programs without a stated amount).
  assert.equal(text.split('\n\n')[0], '$5,550 is open right now. I can build an entry for you.');
  assert.match(text, /\| Program \| You could win \| Builder bonus \| Ends \|/);
  assert.match(text, /\| Arc Microgrants \| 500 USDC × 20 grants \| 0\.18 ETH so far \| Oct 14 \|/);
  assert.match(text, /\| Base Builder Grant Program \| up to \$5,000 \| new pool \| rolling \|/);
  assert.match(text, /\nIdeas I can build:\n- Base Builder Grant Program: Base idea one\n- Base Builder Grant Program: Base idea two\n- Arc Microgrants: Arc idea\n/);
  assert.ok(text.endsWith("Pick one and I'll start."));
  assert.ok(text.includes(BONUS_NOTE), 'the no-affiliation note stays under any bonus table');
  assert.doesNotMatch(text, /qualify/);
  noEmoji(text);
});

test('v2.6 §1: with repos, the brand hook keeps "qualify"', () => {
  const text = presentFirstMessage(msg({
    cards: [base, { ...arc, bonus_pool_wei: WEI('0.42') }],
    repos: repos(v('base-builder-grants', 'likely', ''), v('arc-microgrants', 'likely', '')),
    githubGiven: true,
  }));
  assert.equal(text.split('\n\n')[0], 'EarnKit matches you to $5,500 in open money you qualify for.');
  assert.match(text, /\| Base Builder Grant Program \| up to \$5,000 \| new pool \| rolling \| tipjar \|/);
  assert.doesNotMatch(text, /You could/);
});

test('Ruling 11 (plan): a GitHub user with no repos found never gets "You could"', () => {
  const text = presentFirstMessage(msg({ cards: [{ ...arc, ideas: ['Arc idea'] }], repos: { checked: 0, fits: [] }, githubGiven: true }));
  assert.match(text, /^\$500 is open right now\. I can build an entry for you\.\n\n\| Program \| Prize \| Builder bonus \| Ends \|/);
  assert.doesNotMatch(text, /could/i);
  assert.equal(youCould(null, false), true);
  assert.equal(youCould(null, true), false);
  assert.equal(youCould({ checked: 0, fits: [] }, false), false);
  assert.equal(youCould({ error: 'x' }, false), false);
});

test('v2.6 §1: an opted-out program shows "—" and no shown program is opted out leaves no note', () => {
  const text = presentFirstMessage(msg({ cards: [{ ...base, builder_bonus: false }, { ...tiny, builder_bonus: false }] }));
  assert.match(text, /\| Base Builder Grant Program \| up to \$5,000 \| — \| rolling \|/);
  assert.match(text, /\| Tiny Bounty \| 50 USDC \| — \| Oct 9 \|/);
  assert.doesNotMatch(text, /Builder bonus: paid/);
});

test('v2.6 §1: chat-only agents get the $X headline with no "I can build" sentence, and the chat-only offer', () => {
  const text = presentFirstMessage(msg({ cards: [base, arc, tiny], agentCanBuild: false }));
  assert.match(text, /^\$5,550 is open right now\.\n\n/);
  assert.doesNotMatch(text, /I can build an entry for you/);
  assert.match(text, /can't build or deploy from here/);
});

test('v2.5 §1 golden (e): the note sits under the bonus tables only when a bonus shows', () => {
  assert.equal(BONUS_NOTE, NOTE);
  const shown = presentFirstMessage(msg({ cards: [arc] }));
  assert.equal((shown.match(/Builder bonus: paid by EarnKit/g) ?? []).length, 1);
  assert.match(shown, /\| Oct 14 \|\n\nBuilder bonus: paid by EarnKit from coin fees\. EarnKit isn't affiliated with or endorsed by any program's organizer\. Details: earnkit\.com\/policy\n\n/);
  // v2.6: a program only opts out with builder_bonus: false; base and tiny have a bonus by default.
  const none = presentFirstMessage(msg({ cards: [{ ...base, builder_bonus: false }, { ...tiny, builder_bonus: false }] }));
  assert.doesNotMatch(none, /Builder bonus: paid/);
});

test('fix round 1: the note sits right under the table that shows a bonus, never under the campaign table', () => {
  const text = presentFirstMessage(msg({
    campaigns: [{ ...campaign, you: '#3, in the top 5' }],
    cards: [arc, base, tiny],
    repos: repos(v('arc-microgrants', 'likely', 'ok')),
  }));
  const parts = text.split('\n\n');
  const note = parts.indexOf(NOTE);
  // v2.6: base and tiny now have a bonus too (opted out only via builder_bonus: false), so the
  // "Also open" table is the last one that shows a bonus, and the note sits under it instead —
  // still never adjacent to the campaign table.
  assert.equal(parts[note - 2], 'Also open:');
  assert.match(parts[note - 1], /^\| Program \| Prize \| Builder bonus \| Ends \|\n\|---\|---\|---\|---\|\n\| Base Builder Grant Program/);
  assert.match(parts[note + 1], /Want me to start on Arc Microgrants with tipjar\?/);
  assert.doesNotMatch(parts[note - 1] + parts[note + 1], /\| Win \|/);
  assert.equal(parts.filter((p) => p === NOTE).length, 1);
});

test('fix round 1: ideas cap at 6 in all, 2 per program', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ ...tiny, id: `p${i}`, title: `P${i}`, ideas: ['a', 'b', 'c'] }));
  const text = presentFirstMessage(msg({ cards: many }));
  assert.match(text, /Ideas I can build:\n- P0: a\n- P0: b\n- P1: a\n- P1: b\n- P2: a\n- P2: b\n\nPick one and I'll start\.$/);
});

test('ruling 3 / v2.6 §1: bonusProgramIds lists every shown program with a builder bonus, opted-out ones excluded', () => {
  const extra = Array.from({ length: 6 }, (_, i) => ({ ...arc, id: `x${i}`, max_award_usd: 10_000 + i, submission_proof: null }));
  // Six programs plus Arc and Base (lowest prize): only the top 5 are shown, so only they are read.
  // submission_proof: null on the extras shows the read no longer depends on it (Ruling 7 (plan)).
  assert.deepEqual(bonusProgramIds({ cards: [arc, base, ...extra], repos: null }), ['x5', 'x4', 'x3', 'x2', 'x1']);
  // An opted-out program on screen is excluded even though it would otherwise be shown.
  assert.deepEqual(
    bonusProgramIds({ cards: [arc, { ...base, builder_bonus: false }], repos: null }),
    ['arc-microgrants'],
  );
  // A fitted program and an unfitted one on screen are both listed (no submission_proof needed).
  assert.deepEqual(
    bonusProgramIds({ cards: [arc, base], repos: repos(v('arc-microgrants', 'likely', 'ok')) }),
    ['arc-microgrants', 'base-builder-grants'],
  );
});

test('v2.5: no open EarnKit campaign, no campaign table (Campaign #1 is closed)', () => {
  const text = presentFirstMessage(msg({ campaigns: [{ ...campaign, open: false, you: null }], cards: [arc] }));
  assert.doesNotMatch(text, /\| Win \|/);
  assert.doesNotMatch(text, /Campaign #1/);
  // Open: still shown, after the open money, and still offered first.
  const open = presentFirstMessage(msg({ campaigns: [campaign], cards: [arc], repos: repos(v('arc-microgrants', 'likely', 'ok')) }));
  assert.match(open, /^EarnKit matches you to \$500 in open money you qualify for\.[\s\S]*\| Win \| Prize \| Ends \| You \|/);
  assert.match(open, /Want me to build your entry for the \$100\?$/);
});

test('golden: an entered builder, a fit that needs a step, other programs (at most 5), sponsored last, the fastest offer', () => {
  const text = presentFirstMessage(msg({
    campaigns: [{ ...campaign, you: '#3, in the top 5' }],
    cards: [arc, base, monad, circle, colosseum, tiny, sponsored],
    repos: repos(v('arc-microgrants', 'after_step', 'needs a live link', 'minutes'), v('sponsor-abc', 'likely', 'looks eligible')),
  }));
  assert.equal(text, [
    'EarnKit matches you to $500 in open money you qualify for.',
    '| Program | Prize | Builder bonus | Ends | Your repo |\n|---|---|---|---|---|\n| Arc Microgrants | 500 USDC × 20 grants | new pool | Oct 14 | tipjar, needs a live link |',
    '| Win | Prize | Ends | You |\n|---|---|---|---|\n| EarnKit Campaign #1: Base apps with real users | $100 each to top 5 (in MINI) | Oct 18, 14 days left | #3, in the top 5 |',
    "Also open:\n\n| Program | Prize | Builder bonus | Ends |\n|---|---|---|---|\n| Base Builder Grant Program | up to $5,000 | new pool | rolling |\n| Tiny Bounty | 50 USDC | new pool | Oct 9 |\n| Crypto World's Fair Hackathon | Tempo $100K, Base $25K tracks | new pool | Oct 12 |\n| Monad Metropolis Hackathon | $250K+ prize pool | new pool | Oct 13 |\n| Circle Developer Grants | milestone-based USDC grants | new pool | rolling |",
    NOTE,
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
  assert.match(text, /^\$350 is open right now\. I can build an entry for you\.\n\n/);
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

test('an ended campaign the builder is in: no table (none open), the offer waits for results', () => {
  const text = presentFirstMessage(msg({ campaigns: [{ ...campaign, open: false, you: 'in review' }] }));
  assert.doesNotMatch(text, /\| Win \|/);
  assert.doesNotMatch(text, /build your entry/);
  assert.equal(text, 'Nothing is open right now. Want me to tell you when the results are in?');
  const lost = presentFirstMessage(msg({ campaigns: [{ ...campaign, open: false, you: 'not in top 5' }] }));
  assert.equal(lost, 'Nothing is open right now. Want me to tell you when something opens?');
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

test('I2: a program whose round already froze shows no bonus to win ("—")', () => {
  assert.equal(bonusCell({ ...arc, bonus_pool_wei: null, bonus_closed: true }), '—');
  assert.equal(bonusCell({ ...arc, bonus_pool_wei: null, bonus_closed: false }), 'new pool');
});

test('Ruling 25: a repo whose coin is entered in another program shows no builder bonus in that row', () => {
  const fits = {
    checked: 1,
    fits: [{
      repo: 'tipjar',
      repo_url: 'https://github.com/alice/tipjar',
      verdicts: [v('arc-microgrants', 'likely', 'looks eligible'), v('colosseum-worlds-fair', 'likely', 'looks eligible')],
    }],
  };
  const text = presentFirstMessage(msg({
    // Ruling 7 (plan): the bonus no longer depends on submission_proof, so these cards drop it.
    cards: [{ ...arc, submission_proof: null, bonus_pool_wei: WEI('0.42') }, { ...colosseum, submission_proof: null }],
    repos: fits,
    repoCoins: new Map([['github.com/alice/tipjar', { program_id: 'arc-microgrants', title: 'Arc Microgrants' }]]),
  }));
  // Arc: the coin's own program keeps its pool; Colosseum: no new coin, so no bonus there.
  assert.match(text, /\| Arc Microgrants \| 500 USDC × 20 grants \| 0\.42 ETH so far \|/);
  assert.match(text, /\| Crypto World's Fair Hackathon \| [^|]+ \| no builder bonus: this repo's coin is entered in Arc Microgrants \|/);
  noEmoji(text);
});
