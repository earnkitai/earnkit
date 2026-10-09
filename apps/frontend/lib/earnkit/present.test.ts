import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BONUS_TOP,
  bonusCell,
  NO_CELL,
  bonusLine,
  bonusProgramIds,
  closesInDays,
  enterableWithoutRepo,
  difficultyCell,
  endsOf,
  entriesLine,
  fieldText,
  presentFirstMessage,
  programUpdates,
  table,
  youCould,
  LOW_ODDS_HEADING,
  MORE_QUESTION,
  layout,
  leadLine,
  lowOddsCell,
  type Card,
  type CampaignRow,
  type FirstMessage,
} from './present';
import { BONUS_SPLIT_BPS } from './bonus-payout';
import { moneyText, openMoneyUsd } from './stats';
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
/** Review Focus 4 fixture: an open EarnKit campaign without an entry yet. */
const openCampaign: CampaignRow = { ...campaign, open: true, you: null, prize_usd_each: 100 };
const base: Card = {
  id: 'base-builder-grants', title: 'Base Builder Grant Program', summary: 'up to $5,000 · rolling',
  tag: 'needs a live product', each_time: ['a short Loom', 'usage numbers'], ends_at: null, max_award_usd: 5000, builder_fields: 10,
};
const arc: Card = {
  id: 'arc-microgrants', title: 'Arc Microgrants', summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET',
  tag: null, each_time: [], ends_at: new Date('2026-10-15T03:59:00Z'), max_award_usd: 500, builder_fields: 1,
  submission_proof: { host: 'dorahacks.io' }, pool_usd: 10000,
};
const monad: Card = {
  id: 'monad-metropolis', title: 'Monad Metropolis Hackathon', summary: '$250K+ prize pool · closes Oct 13, 11:59 PM ET',
  tag: 'long shot', each_time: [], ends_at: new Date('2026-10-14T03:59:00Z'), builder_fields: 0,
  pool_usd: 250000, pool_plus: true,
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
/** v2.10 item 6: a scored product with good odds (fits without a product read as low odds). */
const GOOD = { score: 6, tier: 'product' as const, missing: [], traction: 8, odds: 'good' as const, low_reason: null };
const repos = (...verdicts: Verdict[]) => ({
  checked: 1,
  fits: [{ repo: 'tipjar', repo_url: null, verdicts, product: GOOD }],
});
/** A single repo that fits one program with a "likely" verdict (brief helper). */
const fit = (repo: string, program_id: string, repo_url: string | null = null) => ({
  checked: 1,
  fits: [{ repo, repo_url, verdicts: [v(program_id, 'likely', '')], product: GOOD }],
});
/** v2.10 item 2: the v2.9 tables are behind "show more", so these fixtures pass `more: true`; `short` doesn't. */
const msg = (m: Partial<FirstMessage>): FirstMessage => ({
  alerts: [], campaigns: [], cards: [], repos: null, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: true, ...m,
});
const short = (m: Partial<FirstMessage>): FirstMessage => msg({ ...m, more: false });
const noEmoji = (s: string) => assert.doesNotMatch(s, /\p{Extended_Pictographic}/u);
/** Sets a card's open-round bonus pool, in ETH. */
const pool = (c: Card, eth: number) => ({ ...c, bonus_pool_wei: BigInt(Math.round(eth * 100)) * 10n ** 16n, bonus_tokens: 1 });
const WEI = (eth: string) => BigInt(Math.round(Number(eth) * 1e6)) * 10n ** 12n;
/** v2.10 item 1: the bonus line before the close while no token is in the round yet. */
const NO_POOL_YET = 'Builder bonus: no tokens yet, so yours would be first';
/** Fix round 1, Minor 3: escape once for reuse inside `new RegExp(...)`, instead of inline each time. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NO_POOL_RE = esc(NO_POOL_YET);

/** Every committed curated program file as a list_programs card (open, no pools). */
async function committedCards(): Promise<Card[]> {
  const { readdirSync } = await import('node:fs');
  const { ProgramFile } = await import('./program-file');
  const { programCard } = await import('./programs');
  const dir = join(import.meta.dirname, '../../../../programs');
  const cards = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ProgramFile.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))))
    .filter((p) => !p.campaign)
    .map((p) =>
      programCard(
        {
          ...p,
          logo: p.logo ?? null,
          focus: p.focus ?? null,
          best_bet: p.best_bet ?? null,
          winners_per_round: p.winners_per_round ?? null,
          tag: p.tag ?? null,
          campaign: null,
          ends_at: new Date('2099-01-01T00:00:00Z'),
          verified_at: new Date(p.verified_at),
          created_at: new Date(),
          opened_at: null,
          starts_at: null,
          source: 'file',
          max_award_usd: p.max_award_usd == null ? null : String(p.max_award_usd),
          pool_usd: p.pool_usd == null ? null : String(p.pool_usd),
          min_award_usd: p.min_award_usd == null ? null : String(p.min_award_usd),
          needs_repo: p.needs_repo ?? null,
        },
        [],
      ),
    );
  return cards;
}

test('v2.5 §1 golden (a): repos fit 2 programs: $X in open money, the Difficulty column, one offer closed by the bonus', () => {
  const text = presentFirstMessage(msg({
    alerts: ['your token $TIP has $138 in fees to claim (tokens.fun/coin/0xabc)'],
    cards: [base, { ...arc, bonus_pool_wei: WEI('0.42'), bonus_tokens: 1 }],
    repos: repos(
      v('base-builder-grants', 'likely', 'looks eligible if it has real users'),
      v('arc-microgrants', 'likely', 'looks eligible'),
    ),
  }));
  assert.equal(text, [
    'Since you last checked: your token $TIP has $138 in fees to claim (tokens.fun/coin/0xabc).',
    'EarnKit matches you to $5.5K in prizes you qualify for.',
    '| Program | Prize | Difficulty | Ends | Your repo |\n|---|---|---|---|---|\n| Base Builder Grant Program | up to $5,000 |  | rolling | tipjar |\n| Arc Microgrants | 500 USDC × 20 grants |  | Oct 14, 11:59 PM ET | tipjar |',
    // Ruling H8: the offered program's (Base's) empty pool, then the offer. Ruling F5: the top prize
    // among the fits; Arc's 0.42 ETH is not summed in.
    'Builder bonus: no tokens yet, so yours would be first',
    'Want me to start on Base Builder Grant Program with tipjar? It needs a short Loom from you.',
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
    '$5.5K+ in prizes open right now.',
    '| Program | You could win | Difficulty | Ends |\n|---|---|---|---|\n| Base Builder Grant Program | up to $5,000 |  | rolling |\n| Arc Microgrants | 500 USDC × 20 grants |  | Oct 14, 11:59 PM ET |\n| Tiny Bounty | 50 USDC |  | Oct 9 |\n| Monad Metropolis Hackathon | $250K+ prize pool |  | Oct 13, 11:59 PM ET |',
    "Ideas I can build:\n- Base Builder Grant Program: Base idea one\n- Base Builder Grant Program: Base idea two\n- Arc Microgrants: Arc idea one\n- Arc Microgrants: Arc idea two\n- Tiny Bounty: Tiny idea one\n- Tiny Bounty: Tiny idea two",
    `Pick one and I'll start.`,
  ].join('\n\n'));
  noEmoji(text);
  // A GitHub user with no repos counts as no repo.
  const none = presentFirstMessage(msg({ cards: [{ ...arc, ideas: ['Arc idea'] }], repos: { checked: 0, fits: [] } }));
  assert.match(none, /^\$500 in prizes open right now\.\n\n/);
  assert.match(none, new RegExp(`\\n\\nIdeas I can build:\\n- Arc Microgrants: Arc idea\\n\\nPick one and I'll start\\.$`));
  assert.doesNotMatch(none, /None of your/);
  // Honest offer rules still win: keep going, and chat-only agents.
  assert.match(
    presentFirstMessage(msg({ cards: [{ ...arc, ideas: ['x'] }], workingOn: ['arc-microgrants'] })),
    /Builder bonus: no tokens yet, so yours would be first\n\nWant me to keep going on Arc Microgrants\?$/,
  );
  assert.match(presentFirstMessage(msg({ cards: [{ ...arc, ideas: ['x'] }], agentCanBuild: false })), /can't build or deploy from here/);
});

test('v2.5 §1 golden (c): a program without a per-winner amount is not counted in $X; its prize cell is its own words', () => {
  const text = presentFirstMessage(msg({
    cards: [arc, monad],
    repos: repos(v('arc-microgrants', 'likely', 'looks eligible'), v('monad-metropolis', 'likely', 'looks eligible')),
  }));
  // v2.9 F21: the one money figure (openMoneyUsd over the rows you qualify for), never a pool.
  assert.match(text, /^EarnKit matches you to \$500 in prizes you qualify for\.\n\n/);
  assert.match(text, /\| Monad Metropolis Hackathon \| \$250K\+ prize pool \|  \| Oct 13, 11:59 PM ET \| tipjar \|/);
  assert.equal(openMoneyUsd([arc, monad]), 500);
  assert.equal(openMoneyUsd([monad]), 0);
  assert.equal(moneyText(openMoneyUsd([monad])), null);
  // Nothing countable: no "$0" line.
  const unknown = presentFirstMessage(msg({ cards: [circle], repos: repos(v('circle-developer-grants', 'likely', 'looks eligible')) }));
  assert.match(unknown, /^Your repos fit these open programs:\n\n\| Program \| Prize \| Difficulty \| Ends \| Your repo \|/);
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
  assert.equal(bonusCell({ ...base, builder_bonus: false }), NO_CELL);
  assert.equal(bonusCell({ ...base, builder_bonus: false, bonus_pool_wei: WEI('1') }), NO_CELL);
});

test('v2.6 §1: the builder bonus cell', () => {
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: null }), 'new pool');
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: 0n }), 'new pool');
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: WEI('0.42') }), '0.42 ETH so far');
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: WEI('0.004') }), 'under 0.01 ETH so far');
  assert.equal(bonusCell({ builder_bonus: false, bonus_pool_wei: null }), NO_CELL);
  assert.equal(bonusCell({ builder_bonus: true, bonus_pool_wei: null, bonus_closed: true }), NO_CELL);
});

test('v2.6 §1: no repo and no GitHub user: "$X is open right now", "You could win", ideas, pick one', () => {
  const text = presentFirstMessage(msg({
    cards: [
      { ...base, ideas: ['Base idea one', 'Base idea two', 'Base idea three'] },
      { ...arc, ideas: ['Arc idea'], bonus_pool_wei: WEI('0.18'), bonus_tokens: 1 },
      monad, circle, colosseum, tiny,
    ],
  }));
  // $X = every open curated program's per-winner prize, not only the 5 shown: 5000+500+50 (+0 for
  // programs without a stated amount).
  assert.equal(text.split('\n\n')[0], '$5.5K+ in prizes open right now.');
  assert.match(text, /\| Program \| You could win \| Difficulty \| Ends \|/);
  assert.match(text, /\| Arc Microgrants \| 500 USDC × 20 grants \|  \| Oct 14, 11:59 PM ET \|/);
  assert.match(text, /\| Base Builder Grant Program \| up to \$5,000 \|  \| rolling \|/);
  assert.match(text, /\nIdeas I can build:\n- Base Builder Grant Program: Base idea one\n- Base Builder Grant Program: Base idea two\n- Arc Microgrants: Arc idea\n/);
  // Ruling H8: "Pick one" names no program, so no bonus line.
  assert.ok(text.endsWith("\n\nPick one and I'll start."), text);
  assert.doesNotMatch(text, /Builder bonus/);
  assert.doesNotMatch(text, /qualify/);
  noEmoji(text);
});

test('v2.6 §1: with repos, the brand hook keeps "qualify"', () => {
  const text = presentFirstMessage(msg({
    cards: [base, { ...arc, bonus_pool_wei: WEI('0.42'), bonus_tokens: 1 }],
    repos: repos(v('base-builder-grants', 'likely', ''), v('arc-microgrants', 'likely', '')),
    githubGiven: true,
  }));
  assert.equal(text.split('\n\n')[0], 'EarnKit matches you to $5.5K in prizes you qualify for.');
  assert.match(text, /\| Base Builder Grant Program \| up to \$5,000 \|  \| rolling \| tipjar \|/);
  assert.doesNotMatch(text, /You could/);
});

test('Ruling 11 (plan): a GitHub user with no repos found never gets "You could"', () => {
  const text = presentFirstMessage(msg({ cards: [{ ...arc, ideas: ['Arc idea'] }], repos: { checked: 0, fits: [] }, githubGiven: true }));
  assert.match(text, /^\$500 in prizes open right now\.\n\n\| Program \| Prize \| Difficulty \| Ends \|/);
  assert.doesNotMatch(text, /could/i);
  assert.equal(youCould(null, false), true);
  assert.equal(youCould(null, true), false);
  assert.equal(youCould({ checked: 0, fits: [] }, false), false);
  assert.equal(youCould({ error: 'x' }, false), false);
});

test('fix round 1, finding 1: "You could" with no ideas still closes with "Pick one and I\'ll start.", never "qualify"', () => {
  const text = presentFirstMessage(msg({ cards: [{ ...arc, bonus_pool_wei: WEI('0.42'), bonus_tokens: 1 }] }));
  assert.match(text, /^\$500 in prizes open right now\.\n\n/);
  // No ideas on this card (arc carries none here), so the old code fell through to "Want me to
  // check which of your repos already qualify?" — there's nothing to check with repos === null.
  assert.ok(text.endsWith("\n\nPick one and I'll start."), text);
  assert.doesNotMatch(text, /qualify/);
});

test('fix round 1, finding 2: a GitHub matching error is treated like 0 repos found: "$X is open right now" plus ideas', () => {
  const text = presentFirstMessage(msg({
    cards: [{ ...arc, ideas: ['Arc idea'] }],
    repos: { error: 'GitHub said no' },
  }));
  assert.match(text, /^Couldn't read your repos: GitHub said no\n\n\$500 in prizes open right now\.\n\n\| Program \| Prize \| Difficulty \| Ends \|/);
  assert.match(text, /\nIdeas I can build:\n- Arc Microgrants: Arc idea\n/);
  assert.ok(text.endsWith(`Pick one and I'll start.`));
  assert.doesNotMatch(text, /You could/);
});

test('v2.6 §1: an opted-out program has no bonus sentence when every shown program opts out', () => {
  const text = presentFirstMessage(msg({ cards: [{ ...base, builder_bonus: false }, { ...tiny, builder_bonus: false }] }));
  assert.match(text, /\| Base Builder Grant Program \| up to \$5,000 \|  \| rolling \|/);
  assert.match(text, /\| Tiny Bounty \| 50 USDC \|  \| Oct 9 \|/);
  assert.doesNotMatch(text, /builder bonus/i);
  // fix round 1, finding 1: no ideas here either; still "Pick one", never "check your repos".
  // v2.10 item 1: no bonus line and no token line.
  assert.ok(text.endsWith("Pick one and I'll start."), text);
  assert.doesNotMatch(text, /token/);
});

test('v2.6 §1: chat-only agents get the $X headline with no "I can build" sentence, and the chat-only offer', () => {
  const text = presentFirstMessage(msg({ cards: [base, arc, tiny], agentCanBuild: false }));
  assert.match(text, /^\$5.5K\+ in prizes open right now\.\n\n/);
  assert.doesNotMatch(text, /I can build an entry for you/);
  assert.match(text, /can't build or deploy from here/);
  // Ruling H8: the chat-only text names no program here, so no bonus line; it closes the reply.
  assert.doesNotMatch(text, /Builder bonus/);
  assert.match(text, /\n\n[^\n]*can't build or deploy from here, but I can plan it and write every answer for you to submit\. To have it done for you, add EarnKit to a coding agent \(Claude Code, Cursor, Codex\)\.$/);
});

test('fix round 1: ideas cap at 6 in all, 2 per program', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ ...tiny, id: `p${i}`, title: `P${i}`, ideas: ['a', 'b', 'c'] }));
  const text = presentFirstMessage(msg({ cards: many }));
  assert.match(text, new RegExp(`Ideas I can build:\\n- P0: a\\n- P0: b\\n- P1: a\\n- P1: b\\n- P2: a\\n- P2: b\\n\\nPick one and I'll start\\.$`));
});

test('bonusProgramIds lists every shown program with a builder bonus first, then (Ruling H8) the other curated ones; opted-out and sponsored ones excluded', () => {
  const extra = Array.from({ length: 6 }, (_, i) => ({ ...arc, id: `x${i}`, max_award_usd: 10_000 + i, submission_proof: null }));
  // Six programs plus Arc and Base (lowest prize): the top 5 shown come first; the offer can name
  // one off screen, so the rest are read too (one grouped read). Sponsored programs never.
  // submission_proof: null on the extras shows the read no longer depends on it (Ruling 7 (plan)).
  assert.deepEqual(bonusProgramIds({ cards: [arc, base, ...extra, sponsored], repos: null }), ['x5', 'x4', 'x3', 'x2', 'x1', 'arc-microgrants', 'base-builder-grants', 'x0']);
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
  // Open: still shown, after the open money, and still offered first. The campaign offer (never
  // earning the bonus) stays the last line even though a bonus program (Arc) is on screen.
  const open = presentFirstMessage(msg({ campaigns: [campaign], cards: [arc], repos: repos(v('arc-microgrants', 'likely', 'ok')) }));
  assert.match(open, /^EarnKit matches you to \$500 in prizes you qualify for\.[\s\S]*\| Win \| Prize \| Ends \| You \|/);
  // Ruling H8: an EarnKit campaign has no builder bonus, so no bonus line.
  assert.match(open, /\n\nWant me to build your entry for the \$100\?$/);
  assert.doesNotMatch(open, /Builder bonus/);
});

test('golden: an entered builder, a fit that needs a step, other programs (at most 5), sponsored last, the fastest offer', () => {
  const text = presentFirstMessage(msg({
    campaigns: [{ ...campaign, you: '#3, in the top 5' }],
    cards: [arc, base, monad, circle, colosseum, tiny, sponsored],
    repos: repos(v('arc-microgrants', 'after_step', 'needs a live link', 'minutes'), v('sponsor-abc', 'likely', 'looks eligible')),
  }));
  assert.equal(text, [
    'EarnKit matches you to $500 in prizes you qualify for.',
    '| Program | Prize | Difficulty | Ends | Your repo |\n|---|---|---|---|---|\n| Arc Microgrants | 500 USDC × 20 grants |  | Oct 14, 11:59 PM ET | tipjar, needs a live link |',
    '| Win | Prize | Ends | You |\n|---|---|---|---|\n| EarnKit Campaign #1: Base apps with real users | $100 each to top 5 (in MINI) | Oct 18, 14 days left | #3, in the top 5 |',
    "Also open:\n\n| Program | Prize | Difficulty | Ends |\n|---|---|---|---|\n| Base Builder Grant Program | up to $5,000 |  | rolling |\n| Tiny Bounty | 50 USDC |  | Oct 9 |\n| Crypto World's Fair Hackathon | Tempo $100K, Base $25K tracks |  | Oct 12, 11:59 PM PT |\n| Monad Metropolis Hackathon | $250K+ prize pool |  | Oct 13, 11:59 PM ET |\n| Circle Developer Grants | milestone-based USDC grants |  | rolling |",
    'Sponsored (set by sponsors; EarnKit didn\'t write or check them):\n\n| Campaign | Details |\n|---|---|\n| "Build on Acme" | by "Acme" · Sponsored · unverified · 1,000 USDC pool in escrow · closes Oct 20 |',
    `${NO_POOL_YET}\n\nWant me to start on Arc Microgrants with tipjar?`,
  ].join('\n\n'));
  noEmoji(text);
});

test('other programs are capped at 5 rows, with one line for the rest', () => {
  const more = Array.from({ length: 7 }, (_, i) => ({ ...tiny, id: `t${i}`, title: `Bounty ${i}` }));
  const text = presentFirstMessage(msg({ cards: more }));
  assert.equal((text.match(/^\| Bounty /gm) ?? []).length, 5);
  assert.match(text, /\n\n2 more open: ask me for the full list\.\n\n/);
  // v2.9 F21: every program counts toward the figure, shown or not (7 x 50 USDC).
  assert.match(text, /^\$350 in prizes open right now\.\n\n/);
});

test('Ruling F5: among the fits, Easy first, then the top prize; one needing forms says so', () => {
  const text = presentFirstMessage(msg({
    campaigns: [{ ...campaign, you: '#3, in the top 5' }],
    cards: [base, arc],
    repos: repos(v('base-builder-grants', 'likely', 'looks eligible', 'none'), v('arc-microgrants', 'after_step', 'needs a live link', 'minutes')),
  }));
  assert.match(text, new RegExp(`${NO_POOL_RE}\n\nWant me to start on Base Builder Grant Program with tipjar\\? It needs a short Loom from you\\.$`));
  // An Easy fit beats a larger prize that isn't Easy.
  const easyFirst = presentFirstMessage(msg({
    cards: [base, { ...arc, difficulty: { level: 'Easy', estimate: false, rated: true, basis: 'x' } }],
    repos: repos(v('base-builder-grants', 'likely', ''), v('arc-microgrants', 'likely', '')),
  }));
  assert.match(easyFirst, new RegExp(`${NO_POOL_RE}\n\nWant me to start on Arc Microgrants with tipjar\\?$`));
  const answers = presentFirstMessage(msg({
    cards: [{ ...arc, builder_fields: 3 }], repos: repos(v('arc-microgrants', 'likely', 'looks eligible')),
  }));
  assert.match(answers, new RegExp(`${NO_POOL_RE}\n\nWant me to start on Arc Microgrants with tipjar\\? It needs 3 answers only you can give\\.$`));
});

test('one offer: keep going beats the campaign; a sponsor campaign is never offered or in the repo table', () => {
  const resume = presentFirstMessage(msg({ campaigns: [campaign], cards: [arc], workingOn: ['arc-microgrants'] }));
  assert.match(resume, new RegExp(`${NO_POOL_RE}\n\nWant me to keep going on Arc Microgrants\\?$`));
  const sponsorOnly = presentFirstMessage(msg({ cards: [sponsored], repos: repos(v('sponsor-abc', 'likely', 'looks eligible')) }));
  assert.doesNotMatch(sponsorOnly, /Your repos/);
  assert.match(sponsorOnly, /None of your 1 repo fits an open program yet\./);
  // Sponsored cards never earn the bonus and never show on screen, so there's nothing to close with
  // (fix round 1: no program on screen, no token line either).
  assert.ok(sponsorOnly.endsWith("Pick one and I'll start."), sponsorOnly);
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
  assert.equal(endsOf(arc), 'Oct 14, 11:59 PM ET');
  assert.equal(endsOf(base), 'rolling');
  assert.equal(endsOf({ ...arc, summary: '500 USDC' }), 'Oct 15, 3:59 AM UTC');
});

test('programUpdates: sponsored ones counted, closing soon by name, nothing on a first check; new curated programs are alert news only', () => {
  const cards: Card[] = [
    { ...arc, is_new: true },
    { ...tiny, closes_in_days: 1 },
    { ...sponsored, is_new: true },
  ];
  assert.deepEqual(programUpdates(cards, false), ['1 new sponsored campaign', 'Tiny Bounty closes in 1 day']);
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
  // No cards are on screen, so no program earns the bonus here: the campaign offer closes alone.
  assert.match(text, /Want me to build your entry for the \$200\?$/);
});

test('I3 offers: no repos known closes on the build offer; repos known with no fit offers the top quick program', () => {
  // Final review M9: no repo and no GitHub, with an open campaign already entered: the no-repo
  // close ("Pick one"), never "qualify".
  const noRepos = presentFirstMessage(msg({ campaigns: [{ ...campaign, you: '#3, in the top 5' }], cards: [base, arc, tiny] }));
  assert.ok(noRepos.endsWith(`Pick one and I'll start.`), noRepos);
  assert.doesNotMatch(noRepos, /qualify/);
  // A GitHub user with no repos found yet (not the no-repo state) is still asked to check them.
  const githubOnly = presentFirstMessage(msg({ campaigns: [{ ...campaign, you: '#3, in the top 5' }], cards: [base, arc, tiny], githubGiven: true }));
  assert.match(githubOnly, /\n\nWant me to check which of your repos already qualify\?$/);
  assert.doesNotMatch(githubOnly, /Builder bonus/);
  const noFit = presentFirstMessage(msg({ cards: [base, arc, tiny], repos: repos(v('arc-microgrants', 'no', 'not on Arc')) }));
  // Base pays more but needs a Loom and 10 personal answers: Arc is the top program without forms.
  // Ruling 28: the repo was ruled out, so the offer is to build something new, never "start on".
  assert.match(noFit, new RegExp(`\\n\\n${NO_POOL_RE}\n\nWant me to build something new for Arc Microgrants \\(500 USDC × 20 grants\\)\\?$`));
  assert.doesNotMatch(noFit, /start on/);
  // Ruling 19: a repo error is the no-repo state, so even with no ideas it closes on the build offer.
  const errNoIdeas = presentFirstMessage(msg({ cards: [arc], repos: { error: 'GitHub said no' }, githubGiven: true }));
  assert.ok(errNoIdeas.endsWith(`Pick one and I'll start.`), errNoIdeas);
  assert.doesNotMatch(errNoIdeas, /qualify/);
  // An open campaign without an entry stays the top choice (the campaign offer stays last).
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
  assert.match(text, new RegExp(`\\n\\n${NO_POOL_RE}\n\nWant me to build something new for Base Builder Grant Program \\(up to \\$5,000\\)\\? It needs a short Loom from you\\.$`));
  assert.doesNotMatch(text, /Pick one/);
  const answers = presentFirstMessage(msg({
    cards: [{ ...arc, builder_fields: 3 }], repos: repos(v('arc-microgrants', 'no', 'not on Arc')),
  }));
  assert.match(answers, new RegExp(`${NO_POOL_RE}\n\nWant me to build something new for Arc Microgrants \\(500 USDC × 20 grants\\)\\? It needs 3 answers only you can give\\.$`));
});

test('I7: closing-soon and new non-campaign programs stay in the body; they never start the reply as an alert', () => {
  const cards: Card[] = [{ ...arc, is_new: true }, { ...tiny, closes_in_days: 1 }, { ...sponsored, is_new: true }];
  const updates = programUpdates(cards, false);
  const quiet = presentFirstMessage(msg({ cards, updates }));
  assert.doesNotMatch(quiet, /Since you last checked/);
  assert.doesNotMatch(quiet, /^Updates/);
  // fix round 1: with no repo and no ideas on these cards, the offer is now "Pick one and I'll
  // start." (finding 1) rather than "Want me to check…"; this test only cares that Updates sits
  // above whatever the offer is.
  assert.match(quiet, new RegExp(`\\n\\nUpdates: 1 new sponsored campaign; Tiny Bounty closes in 1 day\\.\\n\\nPick one and I'll start\\.$`));
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

test('I2: a program whose round already froze shows no bonus to win (NO_CELL)', () => {
  assert.equal(bonusCell({ ...arc, bonus_pool_wei: null, bonus_closed: true }), NO_CELL);
  assert.equal(bonusCell({ ...arc, bonus_pool_wei: null, bonus_closed: false }), 'new pool');
});

test('Ruling 25: a repo whose coin is entered in another program keeps its own program\'s pool', () => {
  const fits = {
    checked: 1,
    fits: [{
      repo: 'tipjar',
      repo_url: 'https://github.com/alice/tipjar',
      verdicts: [v('arc-microgrants', 'likely', 'looks eligible'), v('colosseum-worlds-fair', 'likely', 'looks eligible')],
      product: GOOD,
    }],
  };
  const text = presentFirstMessage(msg({
    // Ruling 7 (plan): the bonus no longer depends on submission_proof, so these cards drop it.
    cards: [{ ...arc, submission_proof: null, bonus_pool_wei: WEI('0.42'), bonus_tokens: 1 }, { ...colosseum, submission_proof: null }],
    repos: fits,
    repoCoins: new Map([['github.com/alice/tipjar', { program_id: 'arc-microgrants', title: 'Arc Microgrants' }]]),
  }));
  // Arc: its own program, so the repo cell stays plain.
  assert.match(text, /\| Arc Microgrants \| 500 USDC × 20 grants \|  \| Oct 14, 11:59 PM ET \| tipjar \|/);
  // Colosseum: a new token there would conflict, but v2.8.1 §C13 says so once, in Also qualifies, never in the row.
  assert.match(text, /\| Crypto World's Fair Hackathon \| [^|]+ \|  \| [^|]+ \| tipjar \|/);
  assert.doesNotMatch(text, /no builder bonus/);
  noEmoji(text);
});

test('v2.8.1 §C13: a repo whose token is entered elsewhere: no "(no builder bonus: …)" note in its repo cell', () => {
  const t = presentFirstMessage(msg({
    cards: [arc],
    repos: fit('tipjar', 'arc-microgrants', 'https://github.com/a/tipjar'),
    repoCoins: new Map([['github.com/a/tipjar', { program_id: 'base-builder-grants', title: 'Base Builder Grant Program' }]]),
  }));
  assert.match(t, /\| Arc Microgrants \| [^|]+ \|  \| [^|]+ \| tipjar \|/);
  assert.doesNotMatch(t, /no builder bonus|40%/);
});

test('final review M4, Ruling H8: an offer whose row has no builder bonus gets no bonus line (never another program\'s pool)', () => {
  const t = presentFirstMessage(msg({
    cards: [pool(arc, 0.42), pool(base, 0.18)],
    repos: fit('tipjar', 'arc-microgrants', 'https://github.com/a/tipjar'),
    repoCoins: new Map([['github.com/a/tipjar', { program_id: 'base-builder-grants', title: 'Base Builder Grant Program' }]]),
  }));
  // The offered program's pool (0.42) can't be earned with this repo; Base's 0.18 is not offered.
  assert.ok(t.endsWith('\n\nWant me to start on Arc Microgrants with tipjar?'), t);
  assert.doesNotMatch(t, /Builder bonus/);
  // Nothing else with a bonus on screen: no bonus line at all.
  const only = presentFirstMessage(msg({
    cards: [pool(arc, 0.42)],
    repos: fit('tipjar', 'arc-microgrants', 'https://github.com/a/tipjar'),
    repoCoins: new Map([['github.com/a/tipjar', { program_id: 'base-builder-grants', title: 'Base Builder Grant Program' }]]),
  }));
  assert.ok(only.endsWith('Want me to start on Arc Microgrants with tipjar?'), only);
  assert.doesNotMatch(only, /Builder bonus/);
});

test('Ruling 12 (plan): the Difficulty cell is the label only', () => {
  assert.equal(difficultyCell({ difficulty: { level: 'Hard', estimate: true, rated: false, basis: 'x' } }), 'Hard (estimate)');
  assert.equal(difficultyCell({ difficulty: null }), NO_CELL);
});

test('Ruling 11 (plan): "top 10" is the payout split length', () => {
  assert.equal(BONUS_TOP, BONUS_SPLIT_BPS.length);
});

test('7.1 v2.10 item 1, Ruling H8: bonusLine: ETH whenever the pool holds value (rolled over too); first only when empty; frozen null', () => {
  const FIRST = 'Builder bonus: no tokens yet, so yours would be first';
  assert.equal(bonusLine({ wei: 0n, tokens: 0 }), FIRST);
  assert.equal(bonusLine(undefined), FIRST);
  assert.equal(bonusLine({ wei: 18n * 10n ** 16n, tokens: 3 }), 'Builder bonus: 0.18 ETH so far');
  assert.equal(bonusLine({ wei: 10n ** 15n, tokens: 1 }), 'Builder bonus: under 0.01 ETH so far');
  // H8: rolled-over ETH with no token launched in this round still shows the amount.
  assert.equal(bonusLine({ wei: 18n * 10n ** 16n, tokens: 0 }), 'Builder bonus: 0.18 ETH so far');
  assert.equal(bonusLine({ wei: 10n ** 15n, tokens: 0 }), 'Builder bonus: under 0.01 ETH so far');
  // H9: an empty pool with tokens in the round: never "no tokens yet".
  assert.equal(bonusLine({ wei: 0n, tokens: 3 }), 'Builder bonus: 3 tokens in, fees coming');
  assert.equal(bonusLine({ wei: 0n, tokens: 1 }), 'Builder bonus: 1 token in, fees coming');
  assert.equal(bonusLine(null), null);
});

test('Ruling H8: the first reply\'s bonus line is the offered program\'s pool, never a sum across programs', () => {
  // Base is offered (the top prize among the fits): its 0.60 ETH, not 0.60 + Arc's 0.42.
  const both = presentFirstMessage(msg({ cards: [pool(base, 0.6), pool(arc, 0.42)], repos: repos(v('base-builder-grants', 'likely', ''), v('arc-microgrants', 'likely', '')) }));
  assert.ok(both.endsWith('Builder bonus: 0.60 ETH so far\n\nWant me to start on Base Builder Grant Program with tipjar? It needs a short Loom from you.'), both);
  assert.doesNotMatch(both, /1\.02|0\.42/);
  // Arc offered (Base not matched): Arc's pool, rolled-over ETH with no token in the round included.
  const arcOnly = presentFirstMessage(msg({ cards: [{ ...arc, bonus_pool_wei: WEI('0.18'), bonus_tokens: 0 }, pool(base, 0.6)], repos: fit('tipjar', 'arc-microgrants') }));
  assert.ok(arcOnly.endsWith('Builder bonus: 0.18 ETH so far\n\nWant me to start on Arc Microgrants with tipjar?'), arcOnly);
  // An empty pool with a token in the round (H9), then one with none ("first").
  const fresh = presentFirstMessage(msg({ cards: [{ ...arc, bonus_pool_wei: null, bonus_tokens: 2 }], repos: fit('tipjar', 'arc-microgrants') }));
  assert.ok(fresh.endsWith('Builder bonus: 2 tokens in, fees coming\n\nWant me to start on Arc Microgrants with tipjar?'), fresh);
  const empty = presentFirstMessage(msg({ cards: [arc, pool(base, 0.6)], repos: fit('tipjar', 'arc-microgrants') }));
  assert.ok(empty.endsWith('Builder bonus: no tokens yet, so yours would be first\n\nWant me to start on Arc Microgrants with tipjar?'), empty);
  const tiny = presentFirstMessage(msg({ cards: [{ ...arc, bonus_pool_wei: 10n ** 15n, bonus_tokens: 1 }], repos: fit('tipjar', 'arc-microgrants') }));
  assert.ok(tiny.endsWith('Builder bonus: under 0.01 ETH so far\n\nWant me to start on Arc Microgrants with tipjar?'), tiny);
  // The no-repo offer and "keep going" name a program too; "Pick one" names none.
  assert.ok(presentFirstMessage(msg({ cards: [{ ...arc, needs_repo: false, bonus_pool_wei: WEI('0.3') }] })).endsWith('Builder bonus: 0.30 ETH so far\n\nWant me to start on Arc Microgrants?'));
  assert.ok(presentFirstMessage(msg({ cards: [pool(arc, 0.3)], workingOn: ['arc-microgrants'] })).endsWith('Builder bonus: 0.30 ETH so far\n\nWant me to keep going on Arc Microgrants?'));
  assert.doesNotMatch(presentFirstMessage(msg({ cards: [pool(arc, 0.42), pool(base, 0.18)] })), /Builder bonus/);
});

test('v2.10 item 1: no bonus for the offered program, no bonus line; a campaign offer stays last', () => {
  const off = presentFirstMessage(msg({ cards: [{ ...arc, builder_bonus: false }, { ...base, bonus_closed: true }], repos: fit('tipjar', 'arc-microgrants') }));
  assert.doesNotMatch(off, /builder bonus|token/i);
  assert.ok(off.endsWith('Want me to start on Arc Microgrants with tipjar?'), off);
  const camp = presentFirstMessage(msg({ cards: [pool(arc, 0.6)], campaigns: [openCampaign] }));
  assert.equal(camp.split('\n\n').at(-1), 'Want me to build your entry for the $100?');
  assert.doesNotMatch(camp, /Builder bonus/);
  const keep = presentFirstMessage(msg({ campaigns: [openCampaign], cards: [pool(arc, 0.6)], workingOn: [openCampaign.id] }));
  assert.equal(keep.split('\n\n').at(-1), 'Want me to keep going on EarnKit Campaign #1: Base apps with real users?');
  assert.doesNotMatch(keep, /Builder bonus/);
});

// ---- v2.8 Ruling 24 (plan): one money figure; Ruling 25 (plan): the token line.
// v2.9 F21: the figure is the top prize per program (max_award_usd), never the pool.
const pooled = (id: string, title: string, pool_usd: number, pool_plus = false, max_award_usd: number | null = null): Card => ({
  id, title, summary: 's', tag: null, each_time: [], ends_at: null, builder_fields: 0, pool_usd, pool_plus, max_award_usd,
});
const big = pooled('big', 'Big Hackathon', 840000, true, 30000);
const small = pooled('small', 'Small Grants', 10000, false, 5000);
const nopool: Card = { id: 'nopool', title: 'No Pool Bounty', summary: 's', tag: null, each_time: [], ends_at: null, builder_fields: 0 };

test('v2.9 F21: no repo: the site figure "$35K in prizes open right now." (top prizes, never pools)', () => {
  const text = presentFirstMessage(msg({ cards: [big, small] }));
  assert.ok(text.split('\n\n')[0].startsWith('$35K in prizes open right now.'), text);
  assert.doesNotMatch(text, /top prizes/);
  assert.doesNotMatch(text, /I can build an entry for you/);
});

test('v2.9 F21: with repos: the matched programs\' top prizes, or the fit line without one', () => {
  const one = presentFirstMessage(msg({ cards: [big, small], repos: fit('tipjar', 'small') }));
  assert.equal(one.split('\n\n')[0], 'EarnKit matches you to $5K in prizes you qualify for.');
  assert.doesNotMatch(one, /top prizes/);
  const none = presentFirstMessage(msg({ cards: [big, nopool], repos: fit('tipjar', 'nopool') }));
  assert.equal(none.split('\n\n')[0], 'Your repos fit these open programs:');
});

test('7.2 v2.10 items 1, 5: the first reply never pitches the token; at most one bonus line', () => {
  const BONUS = /^Builder bonus: (no tokens yet, so yours would be first|\d+ tokens? in, fees coming|(under 0\.01|\d+\.\d\d) ETH so far)$/m;
  const replies = [
    presentFirstMessage(msg({ cards: [{ ...big, bonus_pool_wei: WEI('0.4'), bonus_tokens: 2 }, { ...small, bonus_pool_wei: WEI('0.2'), bonus_tokens: 1 }] })),
    presentFirstMessage(msg({ cards: [big, small] })),
    presentFirstMessage(msg({ cards: [base, arc], repos: fit('tipjar', 'arc-microgrants', 'https://github.com/alice/tipjar') })),
    presentFirstMessage(msg({ cards: [pool(arc, 0.6)], campaigns: [openCampaign] })),
    presentFirstMessage(msg({ cards: [{ ...small, builder_bonus: false, token_policy: 'off' }] })),
  ];
  for (const t of replies) {
    assert.doesNotMatch(t, /Every entry gets a token|launches \$|40%|yes \/ skip|earnkit\.com\/bonus/, t);
    assert.ok((t.match(/Builder bonus:/g)?.length ?? 0) <= 1, t);
    if (t.includes('Builder bonus:')) assert.match(t, BONUS);
  }
  assert.ok(replies[0].endsWith("\n\nPick one and I'll start."), replies[0]);
  assert.ok(replies[2].endsWith('Builder bonus: no tokens yet, so yours would be first\n\nWant me to start on Arc Microgrants with tipjar?'), replies[2]);
  assert.ok(replies[4].endsWith("Pick one and I'll start."), replies[4]);
  assert.doesNotMatch(replies[4], /token/);
});

// ---- v2.8 Task 6 fix round 1: Ruling C4 ----

test('v2.8 Ruling C4: with the committed curated programs, Easy ones sort first and Arc stays in the no-repo table', async () => {
  const cards = await committedCards();
  const { layout } = await import('./present');
  assert.ok(cards.length >= 7, `${cards.length} curated files`);
  const { shown } = layout({ cards, repos: null });
  const ids = shown.map((c) => c.id);
  assert.ok(ids.includes('arc-microgrants'), ids.join(', '));
  const easy = cards.filter((c) => c.difficulty?.level === 'Easy').map((c) => c.id);
  // v2.9 A6: Base is no longer Easy. v2.10 item 10: nor is Avalanche Team1 Mini Grants (Arc is).
  assert.ok(easy.length >= 1);
  assert.ok(!easy.includes('base-builder-grants'));
  assert.ok(!easy.includes('avalanche-team1-mini-grants'));
  // Every Easy program comes before every other one, then by prize.
  assert.deepEqual(ids.slice(0, easy.length).sort(), [...easy].sort());
  const easyShown = shown.slice(0, easy.length).map((c) => c.max_award_usd ?? 0);
  assert.deepEqual(easyShown, [...easyShown].sort((a, b) => b - a));
});

test('Ruling C23: the agent table reads "up to $1M investment" for an investment program, never a bare prize', () => {
  const speedrun: Card = {
    id: 'a16z-speedrun', title: 'a16z speedrun SR008', summary: 'up to $1M · priority window Oct 12 to Nov 1',
    tag: 'long shot', each_time: [], ends_at: null, max_award_usd: 1_000_000, builder_fields: 1, investment: true, any_chain: true,
  };
  const text = presentFirstMessage(msg({ cards: [arc, speedrun] }));
  assert.match(text, /\| a16z speedrun SR008 \| up to \$1M investment \|/);
  assert.doesNotMatch(text, /\| up to \$1M \|/);
});

// ---- v2.8.1 §B: first message and discovery ----

const easy = { level: 'Easy', estimate: false, rated: true, basis: 'x' } as const;
const hard = { level: 'Hard', estimate: false, rated: true, basis: 'x' } as const;
const speedrunCard: Card = {
  id: 'a16z-speedrun', title: 'a16z speedrun SR008', summary: 'up to $1M', tag: 'long shot', each_time: [], ends_at: null,
  max_award_usd: 1_000_000, builder_fields: 1, investment: true, any_chain: true, difficulty: hard, needs_repo: false,
};
const avax: Card = {
  id: 'avalanche-team1-mini-grants', title: 'Avalanche Team1 Mini Grants', summary: 'up to $10,000', tag: null,
  each_time: ['a summary, milestones and why you deserve a grant'], ends_at: null, max_award_usd: 10_000, builder_fields: 5,
  difficulty: easy, needs_repo: false,
};
const easyBase: Card = { ...base, difficulty: easy, needs_repo: true };
const easyArc: Card = { ...arc, difficulty: easy, needs_repo: true };
const withNew = (program_id: string): Verdict => ({ ...v(program_id, 'after_step', 'only new work since Sep 14 counts', 'days'), missing: ['new_work'] });

test('v2.8.1 §B7: an investment program never leads; the offer is the Easy program with the most money', () => {
  const text = presentFirstMessage(msg({
    cards: [speedrunCard, easyBase, easyArc],
    repos: repos(
      v('a16z-speedrun', 'likely', 'looks eligible'),
      v('arc-microgrants', 'likely', 'looks eligible'),
      v('base-builder-grants', 'after_step', 'needs a live link', 'minutes'),
    ),
  }));
  // Speedrun is in the table, never the offer; Base ($5,000, Easy) beats Arc ($500, Easy).
  assert.match(text, /\| a16z speedrun SR008 \| up to \$1M investment \|/);
  assert.match(text, /Want me to start on Base Builder Grant Program with tipjar\? It needs a short Loom from you\./);
  assert.doesNotMatch(text, /start on a16z/);
  // A repo whose only fit is speedrun: build something new for the top Easy program instead.
  const only = presentFirstMessage(msg({ cards: [speedrunCard, avax, easyArc], repos: repos(v('a16z-speedrun', 'likely', 'looks eligible')) }));
  assert.match(only, /Want me to build something new for Avalanche Team1 Mini Grants \(up to \$10,000\)\? It needs a summary, milestones and why you deserve a grant from you\./);
  assert.doesNotMatch(only, /(start on|new for) a16z/);
  // Ruling F5: a repo that fits only a Hard program starts on it, even with an Easy program open.
  const colo: Card = { ...colosseum, difficulty: hard };
  const hardFit = repos(withNew('colosseum-worlds-fair'));
  const hardOnly = presentFirstMessage(msg({ cards: [colo, avax], repos: hardFit }));
  assert.match(hardOnly, /Want me to start on Crypto World's Fair Hackathon with tipjar\?/);
  assert.doesNotMatch(hardOnly, /build something new/);
  // Chat-only agents: same pick, named before the chat-only sentence.
  const chat = presentFirstMessage(msg({ cards: [speedrunCard, easyArc], repos: repos(v('a16z-speedrun', 'likely', ''), v('arc-microgrants', 'likely', '')), agentCanBuild: false }));
  assert.match(chat, /Want me to start on Arc Microgrants with tipjar\? I can't build or deploy from here/);
});

test('v2.8.1 §B8: no repo: rows that need one say so; the offer is a program they can enter as they are', () => {
  const cards = [speedrunCard, easyBase, easyArc, avax];
  const text = presentFirstMessage(msg({ cards }));
  assert.match(text, /\| Base Builder Grant Program \(needs a repo\) \|/);
  assert.match(text, /\| Arc Microgrants \(needs a repo\) \|/);
  assert.match(text, /\| Avalanche Team1 Mini Grants \| up to \$10,000 \|/);
  assert.match(text, /\| a16z speedrun SR008 \| up to \$1M investment \|/);
  assert.match(text, /Want me to start on Avalanche Team1 Mini Grants\? It needs a summary, milestones and why you deserve a grant from you\./);
  const chat = presentFirstMessage(msg({ cards, agentCanBuild: false }));
  assert.match(chat, /\| Arc Microgrants \(needs a repo\) \|/);
  assert.match(chat, /Want me to start on Avalanche Team1 Mini Grants\? I can't build or deploy from here, but I can plan it/);
  // With a repo, no row says "needs a repo".
  assert.doesNotMatch(presentFirstMessage(msg({ cards, repos: repos(v('arc-microgrants', 'likely', '')) })), /needs a repo/);
  // Nothing they can enter as they are (only investment or repo programs): the v2.6 close.
  assert.match(presentFirstMessage(msg({ cards: [speedrunCard, easyArc] })), /Pick one and I'll start\./);
});

test('v2.8.1 §B9: a returning builder sees "Your entries" first; entered programs are marked and never offered', () => {
  const entries = [
    { program_id: 'base-builder-grants', title: 'Base Builder Grant Program', name: 'tipjar', submitted: true },
    { program_id: 'arc-microgrants', title: 'Arc Microgrants', name: 'tipjar', submitted: false },
  ];
  const text = presentFirstMessage(msg({
    cards: [easyBase, easyArc, avax, speedrunCard],
    repos: repos(v('base-builder-grants', 'likely', ''), v('arc-microgrants', 'likely', ''), v('a16z-speedrun', 'likely', '')),
    entries,
  }));
  assert.ok(
    text.startsWith('Your entries: Base Builder Grant Program (tipjar, submitted); Arc Microgrants (tipjar, not submitted yet).\n\n'),
    text,
  );
  assert.match(text, /\| Base Builder Grant Program \(entered\) \|/);
  // Entered rows go last; the offer is never an entered program (nor speedrun). Arc, confirmed but
  // not submitted yet, is not entered: finishing it is the offer.
  assert.match(text, /\| Arc Microgrants \| 500 USDC/);
  assert.match(text, /\| Base Builder Grant Program \(entered\) \|[^\n]*\n\n/);
  assert.doesNotMatch(text, /start on (Base|a16z)/);
  assert.match(text, /Want me to start on Arc Microgrants with tipjar\?/);
  const allIn = presentFirstMessage(msg({
    cards: [easyBase, easyArc, avax, speedrunCard],
    repos: repos(v('base-builder-grants', 'likely', ''), v('arc-microgrants', 'likely', ''), v('a16z-speedrun', 'likely', '')),
    entries: entries.map((e) => ({ ...e, submitted: true })),
  }));
  assert.match(allIn, /\| Arc Microgrants \(entered\) \|/);
  assert.match(allIn, /Want me to build something new for Avalanche Team1 Mini Grants/);
  // News still opens the reply (the daily check needs it first); the recap comes right after.
  const news = presentFirstMessage(msg({ alerts: ['you won $500'], cards: [easyBase], entries }));
  assert.match(news, /^Since you last checked: you won \$500\.\n\nYour entries: /);
  // "keep going" is never offered on a program already entered.
  const resume = presentFirstMessage(msg({ cards: [easyBase, avax], workingOn: ['base-builder-grants'], entries: entries.slice(0, 1) }));
  assert.doesNotMatch(resume, /keep going on Base/);
  // At most 3 named, then a count.
  const many = Array.from({ length: 5 }, (_, i) => ({ program_id: `p${i}`, title: `P${i}`, name: 'x', submitted: true }));
  assert.equal(entriesLine({ entries: many, cards: [] }), 'Your entries: P0 (x, submitted); P1 (x, submitted); P2 (x, submitted); 2 more.');
  assert.equal(entriesLine({ entries: [], cards: [] }), null);
  noEmoji(text);
  assert.doesNotMatch(text, /—|coin|Clanker/);
});

test('v2.8.1 §B10: "$X you qualify for" leaves out new-work-only programs for an existing repo, and investments', () => {
  const colo: Card = { ...colosseum, pool_usd: 30000, difficulty: null };
  const text = presentFirstMessage(msg({
    cards: [easyArc, colo, { ...speedrunCard, pool_usd: 1_000_000 }],
    repos: repos(v('arc-microgrants', 'likely', ''), withNew('colosseum-worlds-fair'), v('a16z-speedrun', 'likely', '')),
  }));
  assert.match(text, /^EarnKit matches you to \$500 in prizes you qualify for\./);
  // Only rows like that: the plain fit line, never "qualify".
  const none = presentFirstMessage(msg({ cards: [colo], repos: repos(withNew('colosseum-worlds-fair')) }));
  assert.match(none, /^Your repos fit these open programs:/);
});

test('v2.8.1 §B: with the committed programs, the four first messages', async () => {
  const cards = await committedCards();
  const noRepo = presentFirstMessage(msg({ cards }));
  assert.match(noRepo, /Arc Microgrants \(needs a repo\)/);
  // v2.10 Ruling H1 (c1): the no-repo pick is the lowest difficulty without "needs a live product".
  assert.match(noRepo, /Want me to start on Avalanche Team1 Mini Grants\?/);
  assert.doesNotMatch(noRepo, /start on Circle/);
  const oneRepo = presentFirstMessage(msg({
    cards,
    repos: repos(v('base-builder-grants', 'likely', ''), v('a16z-speedrun', 'likely', ''), withNew('colosseum-worlds-fair')),
  }));
  assert.match(oneRepo, /Want me to start on Base Builder Grant Program with tipjar\?/);
  const ethOnly = presentFirstMessage(msg({ cards, repos: repos(v('a16z-speedrun', 'after_step', 'needs a live link', 'minutes')) }));
  assert.match(ethOnly, /\| a16z speedrun SR008 \|/);
  assert.doesNotMatch(ethOnly, /(start on|new for) a16z/);
  // v2.10 item 10: Avalanche is Medium now, so the easiest program to build for is Arc.
  assert.match(ethOnly, /Want me to build something new for Arc Microgrants/);
  assert.match(ethOnly, /\| Avalanche Team1 Mini Grants \| up to \$10,000 \| Medium \(estimate\) \|/);
  for (const t of [noRepo, oneRepo, ethOnly]) {
    noEmoji(t);
    assert.doesNotMatch(t, /—|Clanker|\bcoin\b/);
  }
});

test('3.7 not interested: in no table, never the offer, not in Also open; applied: out of tables and offer, in "Your entries"', () => {
  const cards = [easyBase, easyArc, avax];
  const notInterested = presentFirstMessage(msg({
    cards,
    repos: repos(v('arc-microgrants', 'likely', ''), v('base-builder-grants', 'likely', '')),
    hidden: { notInterested: new Set(['arc-microgrants']), applied: new Set() },
  }));
  assert.doesNotMatch(notInterested, /Arc Microgrants/);
  assert.match(notInterested, /Want me to start on Base Builder Grant Program with tipjar\?/);
  // Not matched either: never in "Also open".
  const noRepo = presentFirstMessage(msg({ cards, hidden: { notInterested: new Set(['arc-microgrants']), applied: new Set() } }));
  assert.doesNotMatch(noRepo, /Arc Microgrants/);

  const applied = presentFirstMessage(msg({
    cards,
    repos: repos(v('arc-microgrants', 'likely', ''), v('base-builder-grants', 'likely', '')),
    hidden: { notInterested: new Set(), applied: new Set(['base-builder-grants']) },
    entries: [{ program_id: 'arc-microgrants', title: 'Arc Microgrants', name: 'tipjar', submitted: false }],
  }));
  assert.ok(
    applied.startsWith('Your entries: Arc Microgrants (tipjar, not submitted yet); Base Builder Grant Program: applied outside EarnKit.\n\n'),
    applied,
  );
  assert.doesNotMatch(applied.split('\n\n').slice(1).join('\n\n'), /Base Builder Grant Program/);
  assert.match(applied, /Want me to start on Arc Microgrants with tipjar\?/);
  // Applied alone still opens with the recap.
  const only = presentFirstMessage(msg({ cards, hidden: { notInterested: new Set(), applied: new Set(['base-builder-grants']) } }));
  assert.match(only, /^Your entries: Base Builder Grant Program: applied outside EarnKit\./);
  noEmoji(applied);
  assert.doesNotMatch(applied, /—|coin|Clanker|vault/);
});

test('final review M1: the no-repo headline is the site figure over every open program, whatever the builder hid', () => {
  const cards = [base, arc, tiny];
  const all = presentFirstMessage(msg({ cards }));
  const hid = presentFirstMessage(msg({ cards, hidden: { notInterested: new Set(['base-builder-grants', 'arc-microgrants']), applied: new Set() } }));
  const headline = (t: string) => t.split('\n\n').find((l) => l.endsWith('in prizes open right now.'));
  assert.equal(headline(hid), headline(all));
  assert.equal(headline(hid), `${moneyText(openMoneyUsd(cards))} in prizes open right now.`);
  assert.doesNotMatch(hid, /Base Builder Grant Program|Arc Microgrants/);
});

test('4.7 a Base row missing real users reads Hard and sorts after an Easy Arc row; the offer picks Arc', () => {
  const baseCard: Card = { ...base, difficulty: { level: 'Medium', estimate: true, rated: false, basis: 'winners not published' } };
  const arcCard: Card = { ...arc, difficulty: easy };
  const baseRow: Verdict = { ...v('base-builder-grants', 'after_step', 'needs a live product with real users', 'weeks'), missing: ['live_url', 'real_users'] };
  const text = presentFirstMessage(msg({
    cards: [baseCard, arcCard],
    repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [baseRow, v('arc-microgrants', 'likely', '')], live_verified: false }] },
  }));
  const lines = text.split('\n');
  const baseLine = lines.find((l) => l.startsWith('| Base Builder Grant Program'))!;
  const arcLine = lines.find((l) => l.startsWith('| Arc Microgrants'))!;
  assert.match(baseLine, /\| Hard \|/);
  assert.match(arcLine, /\| Easy \|/);
  assert.ok(lines.indexOf(arcLine) < lines.indexOf(baseLine), text);
  assert.match(text, /Want me to start on Arc Microgrants with tipjar\?/);
  // With a verified link (or a users claim) the Base row reads Medium; the program estimate shows only when it decides.
  const verified = presentFirstMessage(msg({
    cards: [baseCard],
    repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [{ ...baseRow, missing: ['real_users'] }], live_verified: true }] },
  }));
  assert.match(verified, /\| Base Builder Grant Program \| [^|]+ \| Medium \(estimate\) \|/);
  // "Also open" keeps the program level.
  const also = presentFirstMessage(msg({ cards: [baseCard, arcCard], repos: fit('tipjar', 'arc-microgrants') }));
  assert.match(also, /\| Base Builder Grant Program \| [^|]+ \| Medium \(estimate\) \|/);
});

// ---- v2.9 E20: "Builders using EarnKit won $X", once, right after the headline; absent at 0.
test('10.11 the first reply: the won line once, right after its headline; absent (never "$0") without announced wins', () => {
  const WON = 'Builders using EarnKit won $12,500';
  const matched = msg({ cards: [base, arc], repos: repos(v('base-builder-grants', 'likely', ''), v('arc-microgrants', 'likely', '')) });
  const withWon = presentFirstMessage({ ...matched, wonUsd: 12_500 });
  assert.equal(withWon.split('\n\n')[0], `EarnKit matches you to $5.5K in prizes you qualify for. ${WON}.`);
  assert.equal(withWon.split(WON).length, 2, 'once');
  const noRepo = presentFirstMessage(msg({ cards: [{ ...arc, ideas: ['x'] }], wonUsd: 12_500 }));
  assert.equal(noRepo.split('\n\n')[0], `$500 in prizes open right now. ${WON}.`);
  // A headline that is a heading (no money sentence): the line comes first, alone.
  const heading = presentFirstMessage(msg({ cards: [circle], repos: repos(v('circle-developer-grants', 'likely', '')), wonUsd: 12_500 }));
  assert.deepEqual(heading.split('\n\n').slice(0, 2), [`${WON}.`, 'Your repos fit these open programs:']);
  // After news, never before it (the daily check reads the start).
  const news = presentFirstMessage({ ...matched, alerts: ['you won $500'], wonUsd: 12_500 });
  assert.ok(news.startsWith('Since you last checked: you won $500.\n\nEarnKit matches you to'));
  assert.equal(news.split(WON).length, 2);
  for (const zero of [0, undefined])
    for (const m of [matched, msg({ cards: [{ ...arc, ideas: ['x'] }] })]) {
      const t = presentFirstMessage({ ...m, wonUsd: zero });
      assert.doesNotMatch(t, /Builders using EarnKit/);
      assert.doesNotMatch(t, /won \$0/);
    }
});

// ---- v2.10 Ruling H1 (c1): the no-repo pick ----

test('H1 c1: the no-repo pick is the lowest difficulty, never "needs a live product", then the top prize; none fits: no line', () => {
  const medium = { level: 'Medium', estimate: true, rated: false, basis: 'x' } as const;
  const circle: Card = {
    id: 'circle-developer-grants', title: 'Circle Developer Grants', summary: 'up to $100,000', tag: 'needs a live product',
    each_time: [], ends_at: null, max_award_usd: 100_000, builder_fields: 1, difficulty: easy, needs_repo: false,
  };
  const avaMedium: Card = { ...avax, difficulty: medium };
  const bigHard: Card = { ...avax, id: 'big-hard', title: 'Big Hard', max_award_usd: 50_000, difficulty: hard };
  const smallMedium: Card = { ...avax, id: 'small-medium', title: 'Small Medium', max_award_usd: 2_000, difficulty: medium };
  // Circle (needs a live product, even rated Easy here) is never named; Medium beats a bigger Hard prize.
  assert.equal(enterableWithoutRepo([circle, bigHard, avaMedium, smallMedium])?.id, 'avalanche-team1-mini-grants');
  // Same level: the top prize.
  assert.equal(enterableWithoutRepo([circle, smallMedium, avaMedium], 'avalanche-team1-mini-grants')?.id, 'small-medium');
  // Nothing fits (only a live-product program, an investment, or programs needing a repo): no pick.
  assert.equal(enterableWithoutRepo([circle, speedrunCard, easyArc]), undefined);
  // The no-repo first reply never offers Circle, and with nothing to pick it never names a program.
  const noRepo = presentFirstMessage(msg({ cards: [circle, bigHard, avaMedium] }));
  assert.match(noRepo, /Want me to start on Avalanche Team1 Mini Grants\?/);
  assert.doesNotMatch(noRepo, /start on Circle/);
  assert.doesNotMatch(presentFirstMessage(msg({ cards: [circle, easyArc] })), /Want me to start on/);
});

// ---- v2.10 item 6: odds rank the rows; low odds never count, never "fit", never get the token offer ----

const easy500: Card = { ...arc, difficulty: { level: 'Easy', estimate: false, rated: true, basis: 'x' } };
const medium500: Card = {
  ...arc, id: 'base-500', title: 'Base 500', summary: '$500 each', tag: null,
  difficulty: { level: 'Medium', estimate: false, rated: true, basis: 'x' }, max_award_usd: 500,
};
const STARTER = { score: 6, tier: 'product' as const, missing: [], traction: 0, odds: 'low' as const, low_reason: 'no users yet' };
const LIVE = { score: 6, tier: 'product' as const, missing: [], traction: 8, odds: 'good' as const, low_reason: null };

test('3.8 a starter tip jar (Easy row, traction 0) never outranks a live product with users (Medium row, traction 8)', () => {
  const m = msg({
    cards: [easy500, medium500],
    repos: {
      checked: 2,
      fits: [
        { repo: 'tipjar', repo_url: 'https://github.com/alice/tipjar', verdicts: [v('arc-microgrants', 'likely', '')], product: STARTER },
        { repo: 'payapp', repo_url: 'https://github.com/alice/payapp', verdicts: [v('base-500', 'likely', '')], product: LIVE },
      ],
    },
  });
  const rows = layout(m).rows;
  assert.deepEqual(rows.map((r) => [r.repo, r.odds, r.traction]), [['payapp', 'good', 8], ['tipjar', 'low', 0]]);
  const text = presentFirstMessage(m);
  assert.ok(text.indexOf('| Base 500 |') < text.indexOf('| Arc Microgrants |'), text);
  assert.ok(text.includes(`| tipjar, ${lowOddsCell('no users yet')} |`), text);
  assert.ok(text.includes('| tipjar, low odds: no users yet |'));
  // Pre-flight P12: when both repos fit one program, the program's row is the live product's.
  const one = msg({
    cards: [easy500],
    repos: {
      checked: 2,
      fits: [
        { repo: 'tipjar', repo_url: null, verdicts: [v('arc-microgrants', 'likely', '')], product: STARTER },
        { repo: 'payapp', repo_url: null, verdicts: [v('arc-microgrants', 'after_step', 'needs a live link', 'minutes')], product: LIVE },
      ],
    },
  });
  assert.equal(layout(one).rows[0].repo, 'payapp');
});

test('3.9 low-odds rows never count in "$X you qualify for" and never make a "fit" headline', () => {
  const url = 'https://github.com/alice/tipjar';
  const both = msg({
    cards: [easy500, medium500],
    repos: {
      checked: 2,
      fits: [
        { repo: 'tipjar', repo_url: url, verdicts: [v('arc-microgrants', 'likely', '', 'hours')], product: STARTER },
        { repo: 'payapp', repo_url: null, verdicts: [v('base-500', 'likely', '')], product: LIVE },
      ],
    },
  });
  // Only the live product's $500 counts, not the starter's $500.
  assert.ok(presentFirstMessage(both).includes(`EarnKit matches you to ${moneyText(500)} in prizes you qualify for.`), presentFirstMessage(both));
  const lowOnly = msg({
    cards: [easy500],
    repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: url, verdicts: [v('arc-microgrants', 'likely', '', 'hours')], product: STARTER }] },
  });
  const text = presentFirstMessage(lowOnly);
  // Pre-flight P14: the spec's "never called a fit" wins over the plan's headline.
  assert.ok(text.includes(`${LOW_ODDS_HEADING}\n\n`), text);
  assert.doesNotMatch(text, /qualify for|fit these/);
});

test('4.5 a private repo matched from the local copy gets one line; a repo EarnKit can\'t see gets the describe line, with the App\'s link only when on', () => {
  const repos = (link?: string | null) => ({
    ...fit('TipJar', arc.id),
    checked: 3,
    fromLocal: [{ name: 'TipJar', full_name: 'alice/tipjar' }],
    unseen: [
      { name: 'tipjar2', full_name: 'alice/tipjar2', ...(link !== undefined && { link }) },
      { name: 'other', full_name: 'alice/other' },
    ],
  });
  const off = presentFirstMessage(msg({ cards: [arc, base], repos: repos() }));
  const local = 'TipJar is private, so I matched it from your local copy.';
  assert.equal(off.split(local).length - 1, 1, 'once');
  assert.ok(off.includes("I can't see tipjar2 (private?). Describe it."));
  assert.doesNotMatch(off, /alice\/other|can't see other/, 'one can\'t-see line, the first');
  // Before the matched table (v2.9 layout; T8 moves them before the lead).
  assert.ok(off.indexOf(local) < off.indexOf('| Program'), off);
  noEmoji(off);
  assert.doesNotMatch(off, /\u2014/, 'no em dash');
  const on = presentFirstMessage(msg({ cards: [arc, base], repos: repos('https://earnkit.com/github/verify?n=abc') }));
  assert.ok(on.includes("I can't see tipjar2 (private?). Describe it, or allow read access: https://earnkit.com/github/verify?n=abc"));
  // Nothing private: no such lines.
  assert.doesNotMatch(presentFirstMessage(msg({ cards: [arc], repos: fit('TipJar', arc.id) })), /private|can't see/);
});

test('final fix I2 (ledger c1): a private repo matched from the local copy carries the App link on its own line, once, with no extra question', () => {
  const link = 'https://earnkit.com/github/verify?n=abc';
  const repos = {
    ...fit('TipJar', arc.id),
    checked: 2,
    fromLocal: [{ name: 'TipJar', full_name: 'alice/tipjar', link }, { name: 'Other', full_name: 'alice/other' }],
  };
  const t = presentFirstMessage(short({ cards: [arcOnArc, base], repos }));
  const lines = t.split('\n');
  assert.equal(lines[0], `TipJar is private, so I matched it from your local copy. For a fuller match, allow read access: ${link}`);
  assert.equal(lines[1], 'Other is private, so I matched it from your local copy.');
  assert.equal(t.split(link).length - 1, 1, 'one link');
  assert.equal((t.match(/\?/g) ?? []).length - (link.match(/\?/g) ?? []).length, 1, 'one question: the lead');
  noEmoji(t);
  assert.doesNotMatch(t, /\u2014/, 'no em dash');
});

test('v2.10 item 15 (R12, Pre-flight P19): the deadline line comes right after news and "Your entries"', () => {
  const line = "Arc Microgrants closes in 2 days; your entry isn't submitted.";
  const t = presentFirstMessage(msg({
    alerts: ['you won $100'],
    cards: [arc, base],
    entries: [{ program_id: 'arc-microgrants', title: 'Arc Microgrants', name: 'tipjar', submitted: false }],
    deadline: line,
  }));
  const parts = t.split('\n\n');
  assert.equal(parts[0], 'Since you last checked: you won $100.');
  assert.match(parts[1], /^Your entries: Arc Microgrants \(tipjar, not submitted yet\)\.$/);
  assert.equal(parts[2], line);
  assert.equal(t.split(line).length, 2);
  assert.doesNotMatch(presentFirstMessage(msg({ cards: [arc], deadline: null })), /closes in/);
});

// ---- v2.10 item 2: one lead line per first reply; the tables behind "show more" ----

const arcOnArc: Card = { ...arc, chains: ['arc'] };

test('8.1 v2.10 item 2: a good-odds Arc row is the whole reply, one line and one question; "by" is the program\'s own close day (P1)', () => {
  const t = presentFirstMessage(short({ cards: [arcOnArc, base], repos: fit('TipJar', arc.id) }));
  // ends_at is Oct 15 03:59 UTC; the program closes Oct 14, 11:59 PM ET (Pre-flight P1).
  assert.equal(t, 'Your TipJar can win 500 USDC on Arc by Oct 14. Want me to finish it?');
  assert.equal(t.split('?').length, 2, 'one question mark');
  assert.ok(!t.includes('|') && !t.includes('\n'), 'no table, one line');
  // Any chain: no "on"; rolling: no "by"; the per-winner amount only (P7).
  const any = presentFirstMessage(short({ cards: [{ ...arcOnArc, any_chain: true }], repos: fit('TipJar', arc.id) }));
  assert.equal(any, 'Your TipJar can win 500 USDC by Oct 14. Want me to finish it?');
  const baseOnBase: Card = { ...base, chains: ['base'], tag: null, each_time: [], builder_fields: 0 };
  assert.equal(
    presentFirstMessage(short({ cards: [baseOnBase], repos: fit('payapp', base.id) })),
    'Your payapp can win up to $5,000 on Base. Want me to finish it?',
  );
  // Without a close in the summary, ends_at's day.
  assert.equal(
    leadLine({ ...layout(msg({ cards: [{ ...arcOnArc, summary: '500 USDC' }], repos: fit('TipJar', arc.id) })).rows[0] }, { cards: [arcOnArc], repos: null, now: NOW }),
    'Your TipJar can win 500 USDC on Arc by Oct 15. Want me to finish it?',
  );
  noEmoji(t);
});

test('8.2 v2.10 item 2 (R12): a returning builder: news, entries, the deadline line, the private lines, then the lead, one line each', () => {
  const line = "Base Builder Grant Program closes in 2 days; your entry isn't submitted.";
  const t = presentFirstMessage(short({
    alerts: ['you won $100'],
    cards: [arcOnArc, base],
    entries: [{ program_id: base.id, title: base.title, name: 'payapp', submitted: false }],
    deadline: line,
    repos: { ...fit('TipJar', arc.id), checked: 2, fromLocal: [{ name: 'TipJar', full_name: 'alice/tipjar' }] },
  }));
  assert.deepEqual(t.split('\n'), [
    'Since you last checked: you won $100.',
    'Your entries: Base Builder Grant Program (payapp, not submitted yet).',
    line,
    'TipJar is private, so I matched it from your local copy.',
    'Your TipJar can win 500 USDC on Arc by Oct 14. Want me to finish it?',
  ]);
  // A submitted entry's program never leads again.
  const done = presentFirstMessage(short({
    cards: [arcOnArc],
    entries: [{ program_id: arc.id, title: arc.title, name: 'TipJar', submitted: true }],
    repos: fit('TipJar', arc.id),
  }));
  assert.ok(done.endsWith(`No repo fits yet. ${moneyText(openMoneyUsd([arcOnArc], NOW))} is open; want the 3 easiest?`), done);
});

test('8.3 v2.10 item 2: no good-odds row, no repo, an investment row and a low-odds row: never a lead', () => {
  const cards = [arcOnArc, base, monad];
  const fig = moneyText(openMoneyUsd(cards, NOW))!;
  // Repos, none fits.
  assert.equal(
    presentFirstMessage(short({ cards, repos: { checked: 2, fits: [] } })),
    `No repo fits yet. ${fig} is open; want the 3 easiest?`,
  );
  // No repo reported.
  assert.equal(presentFirstMessage(short({ cards })), `${fig} is open. ${MORE_QUESTION}`);
  assert.equal(MORE_QUESTION, 'Want the 3 easiest?');
  // A low-odds row only.
  const low = { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [v(arc.id, 'likely', '')], product: STARTER }] };
  assert.equal(presentFirstMessage(short({ cards, repos: low })), `No repo fits yet. ${fig} is open; want the 3 easiest?`);
  // An investment row only, even with good odds.
  const speedrun: Card = { ...arcOnArc, id: 'a16z', title: 'a16z speedrun', summary: 'up to $1M · rolling', investment: true, max_award_usd: 1_000_000 };
  const inv = presentFirstMessage(short({ cards: [speedrun, base], repos: fit('payapp', 'a16z') }));
  assert.ok(inv.startsWith('No repo fits yet.'), inv);
  // A low-odds row above never displaces the good-odds one.
  const mixed = {
    checked: 2,
    fits: [
      { repo: 'starter', repo_url: null, verdicts: [v(medium500.id, 'likely', '')], product: STARTER },
      { repo: 'TipJar', repo_url: null, verdicts: [v(arc.id, 'likely', '')], product: GOOD },
    ],
  };
  assert.match(presentFirstMessage(short({ cards: [arcOnArc, medium500], repos: mixed })), /^Your TipJar can win/);
  // A matching error: its line, then the no-repo lead.
  assert.equal(
    presentFirstMessage(short({ cards, repos: { error: 'GitHub is busy' } })),
    `Couldn't read your repos: GitHub is busy\n${fig} is open. ${MORE_QUESTION}`,
  );
  // Pre-flight P20: nothing open keeps today's line.
  assert.match(presentFirstMessage(short({ cards: [] })), /^Nothing is open right now\./);
});

test('8.4 v2.10 item 2: "show more" renders the v2.9 tables, low-odds rows labelled, the close and the bonus line once', () => {
  const m = {
    cards: [pool(arcOnArc, 0.18), medium500],
    repos: {
      checked: 2,
      fits: [
        { repo: 'starter', repo_url: null, verdicts: [v(medium500.id, 'likely', '')], product: STARTER },
        { repo: 'TipJar', repo_url: null, verdicts: [v(arc.id, 'likely', '')], product: GOOD },
      ],
    },
  };
  const more = presentFirstMessage(msg(m));
  assert.ok(more.includes('| Program | Prize | Difficulty | Ends | Your repo |'), more);
  assert.ok(more.includes(`| starter, ${lowOddsCell('no users yet')} |`), more);
  assert.equal(more.split('Builder bonus:').length, 2, 'the bonus line once');
  assert.match(more, /Want me to start on Arc Microgrants with TipJar\?$/);
  // The short reply has none of it; more is the default off.
  const brief = presentFirstMessage({ ...msg(m), more: undefined });
  assert.ok(!brief.includes('|') && !brief.includes('Builder bonus'), brief);
});

test('Ruling H10 (I3): holdQuestion: the short reply drops the lead line, "show more" drops the closing offer; nothing else changes', () => {
  const m = { cards: [arcOnArc, base], repos: fit('TipJar', arc.id), alerts: ['you won $100'] };
  assert.equal(presentFirstMessage(short({ ...m, holdQuestion: true })), 'Since you last checked: you won $100.');
  assert.equal(presentFirstMessage(short({ cards: [arcOnArc], holdQuestion: true })), '');
  const full = presentFirstMessage(msg(m));
  const held = presentFirstMessage(msg({ ...m, holdQuestion: true }));
  assert.match(full, /\n\nWant me to start on Arc Microgrants with TipJar\?$/);
  assert.equal(held, full.replace(/\n\nWant me to start on Arc Microgrants with TipJar\?$/, ''));
  assert.doesNotMatch(held, /\?/);
});
