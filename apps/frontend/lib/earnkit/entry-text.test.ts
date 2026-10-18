import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardLink,
  confirmTable,
  enteredTable,
  enteredText,
  notReadyTokenNote,
  keyTable,
  NO_COIN_YET,
  notReadyLine,
  todoOf,
  summaryCloses,
  tokenRow,
} from './entry-text';
import type { CampaignConfig } from './campaigns';

const campaign: CampaignConfig = {
  kind: 'earnkit',
  prize: { token: '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07', symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5, amount_each: '84800000', prize_usd_total: 500, metric: 'unique_wallets', min_score: 10,
};
const ENDS = new Date('2026-10-18T23:59:00Z');

test('confirmTable: the spec block, prize first, one token row (v2.10 item 5: no footnote)', () => {
  const text = confirmTable({
    project: 'Tip Jar',
    programTitle: 'EarnKit Campaign #1',
    campaign,
    prize: '',
    endsAt: ENDS,
    payoutWallet: '0xAbCdEf0123456789abcdef0123456789ABCDEf01',
    token: { symbol: 'TIP' },
  });
  assert.equal(
    text,
    [
      '| Entry | Tip Jar for EarnKit Campaign #1 |',
      '|---|---|',
      '| Prize | $100 in MINI if top 5 with 10+ users, paid to 0xAbCdEf0123456789abcdef0123456789ABCDEf01 by Oct 21 |',
      '| Token | Launches $TIP: 40% of its fees to you · or skip the token |',
    ].join('\n'),
  );
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(text, /WETH|gas|tokens\.fun|Terms|Risks/);
});

test('I8: a remembered payout wallet is asked about in full under the table, never put in the Prize row', () => {
  const W = '0xAbCdEf0123456789abcdef0123456789ABCDEf01';
  const text = confirmTable({
    project: 'Tip Jar', programTitle: 'EarnKit Campaign #1', campaign, prize: '', endsAt: ENDS,
    payoutWallet: null, askWallet: W, token: null,
  });
  assert.equal(text, [
    '| Entry | Tip Jar for EarnKit Campaign #1 |',
    '|---|---|',
    '| Prize | $100 in MINI if top 5 with 10+ users, paid to your wallet by Oct 21 |',
    '',
    `Pay prizes to ${W}? It is the wallet from your last entry.`,
  ].join('\n'));
});

test('confirmTable: no token row and no footnote without a token; other programs show their prize', () => {
  const text = confirmTable({
    project: 'Tip Jar', programTitle: 'Arc Microgrants', campaign: null,
    prize: '500 USDC × 20 grants', endsAt: null, payoutWallet: null, token: null,
  });
  assert.equal(text, '| Entry | Tip Jar for Arc Microgrants |\n|---|---|\n| Prize | 500 USDC × 20 grants |');
});

test('enteredTable: standing, leaderboard, payout date', () => {
  assert.equal(
    enteredTable({
      project: 'Tip Jar', programTitle: 'EarnKit Campaign #1', standing: 'not scored yet (scores update daily)',
      leaderboard: 'https://earnkit.com/campaigns/earnkit-campaign-1-base', campaign, endsAt: ENDS,
      payoutWallet: '0xabcdef0123456789abcdef0123456789abcdef01',
    }),
    [
      '| Entered | Tip Jar in EarnKit Campaign #1 |',
      '|---|---|',
      '| Rank | not scored yet (scores update daily) |',
      '| Leaderboard | https://earnkit.com/campaigns/earnkit-campaign-1-base |',
      '| Payout | $100 in MINI to 0xabcd…ef01 by Oct 21, if top 5 with 10+ users |',
    ].join('\n'),
  );
});

test('keyTable escapes "|" so a cell never breaks the table', () => {
  assert.equal(keyTable([['Entry', 'A | B']]), '| Entry | A \\| B |\n|---|---|');
});

test('v2.10 item 5: the campaign token row uses the confirm line\'s words; "skip" only as "skip the token"', () => {
  assert.equal(tokenRow('TIP'), 'Launches $TIP: 40% of its fees to you · or skip the token');
  assert.doesNotMatch(tokenRow('TIP'), /\p{Extended_Pictographic}|builder bonus/u);
});

test('v2.8 Part C: outside campaigns confirmTable has no token row, wallet line or footnote (the offer replaces them)', () => {
  const text = confirmTable({
    project: 'Tip Jar', programTitle: 'Arc Microgrants', campaign: null,
    prize: '500 USDC × 20 grants', endsAt: null, payoutWallet: null,
    token: { symbol: 'TIP' },
  });
  assert.equal(text, '| Entry | Tip Jar for Arc Microgrants |\n|---|---|\n| Prize | 500 USDC × 20 grants |');
});

const W = '0xab12000000000000000000000000000000ef0123';
test('v2.8 Part C: confirmTable outside campaigns is the entry and prize only; campaigns keep the Token row', () => {
  const t = confirmTable({ project: 'TipJar', programTitle: 'Arc Microgrants', campaign: null, prize: '500 USDC', endsAt: null, payoutWallet: null,
    token: { symbol: 'TIPJAR', wallet: W, remembered: true } });
  assert.equal(t, ['| Entry | TipJar for Arc Microgrants |', '|---|---|', '| Prize | 500 USDC |'].join('\n'));
  assert.doesNotMatch(t, /Token|Wallet|Fees in WETH/);
  // Campaign tables keep v2.4's Token row, and no wallet line or footnote (v2.10 item 5).
  const c = confirmTable({ project: 'TipJar', programTitle: 'EarnKit Campaign #1', campaign, prize: '', endsAt: ENDS, payoutWallet: null,
    token: { symbol: 'TIPJAR', wallet: W, remembered: true } });
  assert.match(c, /\| Token \| /);
  assert.ok(c.endsWith('| Token | Launches $TIPJAR: 40% of its fees to you · or skip the token |'), c);
  assert.doesNotMatch(c, /WETH|gas|Terms/);
  assert.doesNotMatch(c, /Your entry gets|Wallet for fees/);
});

test('v2.6 §3, Ruling 22: the after-submission reply never names a tool', () => {
  assert.equal(
    enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'launched', url: 'https://tokens.fun/coin/0xabc' } }),
    'Entered in Arc Microgrants. Your token: tokens.fun/coin/0xabc.',
  );
  assert.equal(enteredText({ programTitle: 'Base Builder Grant Program', coin: { status: 'skipped' } }), 'Entered in Base Builder Grant Program.');
  assert.equal(enteredText({ programTitle: 'Base Builder Grant Program', coin: { status: 'no_wallet' } }), 'Entered in Base Builder Grant Program. Reply with a wallet to get your token.');
  assert.equal(enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'pending' } }), 'Entered in Arc Microgrants. Your token is launching.');
  assert.equal(enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'other' } }), "Entered in Arc Microgrants. Your token isn't launched yet.");
  for (const status of ['launched', 'pending', 'no_wallet', 'skipped', 'other'] as const)
    assert.doesNotMatch(
      enteredText({ programTitle: 'P', coin: status === 'launched' ? { status, url: 'https://tokens.fun/coin/0x1' } : { status } }),
      /launch_token|record_submission|creator_wallet|payout_wallet|bonus/,
    );
  // The agent's note (never shown to the builder) names the tool.
  assert.equal(NO_COIN_YET, 'No token yet: no wallet was given. When the builder replies with a wallet, call confirm with project_id, yes: true and the wallet.');
});
test('C7: a token waiting on missing items says what the entry still needs, in plain words', () => {
  const coin = { status: 'other' as const, needs: 'a live link on Arc mainnet' };
  assert.equal(
    enteredText({ programTitle: 'Arc Microgrants', coin }),
    "Entered in Arc Microgrants. Your token isn't launched yet: the entry still needs a live link on Arc mainnet.",
  );
  assert.equal(notReadyTokenNote(['a', 'b', 'c', 'd']), 'Not launched: the entry still needs a; b; c; and 1 more.');
});

test('Ruling 12 (plan): boardLink is the slug link, no scheme', () => {
  const prev = process.env.EARNKIT_URL;
  delete process.env.EARNKIT_URL;
  try {
    assert.equal(boardLink('arc-microgrants:2026-09-16'), 'earnkit.com/bonus/arc-microgrants-2026-09-16');
    assert.equal(boardLink('base-builder-grants:2026-10'), 'earnkit.com/bonus/base-builder-grants-2026-10');
  } finally {
    if (prev !== undefined) process.env.EARNKIT_URL = prev;
  }
});

test('Ruling 29 (final I2), v2.8.1 §C15: a deadline reads in the program\'s own time zone', async () => {
  const { endsOf } = await import('./present');
  // Arc: closes Oct 14, 11:59 PM ET = 2026-10-15T03:59Z. The first message says "Oct 14, 11:59 PM ET"; so does every reply.
  const arc = { summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET', ends_at: new Date('2026-10-15T03:59:00Z') };
  const card = { id: 'arc', title: 'Arc', tag: null, each_time: [], ...arc };
  assert.equal(endsOf(card), 'Oct 14, 11:59 PM ET');
  // Monad and Colosseum: the same, never the next UTC day.
  assert.equal(endsOf({ ...card, summary: '$250K+ prize pool · closes Oct 13, 11:59 PM ET', ends_at: new Date('2026-10-14T03:59:00Z') }), 'Oct 13, 11:59 PM ET');
  assert.equal(endsOf({ ...card, summary: '$840K+ in prizes · closes Oct 12, 11:59 PM PT', ends_at: new Date('2026-10-13T06:59:00Z') }), 'Oct 12, 11:59 PM PT');
  // No "closes" in the summary: the deadline in UTC, as endsOf shows it.
  const plain = { summary: 'up to $5,000', ends_at: new Date('2026-10-15T03:59:00Z') };
  assert.equal(endsOf({ ...card, ...plain }), 'Oct 15, 3:59 AM UTC');
  assert.equal(endsOf({ ...card, summary: 'x', ends_at: new Date('2026-10-15T15:00:00Z') }), 'Oct 15, 3:00 PM UTC');
  assert.equal(endsOf({ ...card, summary: 'x', ends_at: new Date('2026-11-01T00:00:00Z') }), 'Oct 31');
  // A summary with a day only (an EarnKit campaign) stays a day.
  assert.equal(summaryCloses('$100 each to top 5 (in MINI) · closes Oct 14'), 'Oct 14');
  assert.equal(summaryCloses('up to $5,000 · rolling'), null);
});

test('v2.7 §3: not ready leads with what is missing; no token, wallet or footnote', () => {
  const t = confirmTable({ project: 'TipJar', programTitle: 'Arc Microgrants', campaign: null, prize: '500 USDC × 20 grants',
    endsAt: null, payoutWallet: null, missing: ['Live deployment on Arc mainnet', 'Public builder profile'],
    token: { symbol: 'TIPJAR', wallet: '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3' } });
  assert.ok(t.startsWith('Before you submit: Live deployment on Arc mainnet; Public builder profile.\n\n'));
  assert.doesNotMatch(t, /Token|Wallet|Fees in WETH|0x1581/);
  assert.match(t, /\| Prize \| 500 USDC × 20 grants \|/);
  assert.equal(notReadyLine(['A']), 'Before you submit: A.');
  // Ready (missing: []): the entry and prize; v2.8 Part C, the confirmation offer follows (tools.ts).
  const ready = confirmTable({ project: 'TipJar', programTitle: 'Arc Microgrants', campaign: null, prize: '500 USDC × 20 grants',
    endsAt: null, payoutWallet: null, missing: [],
    token: { symbol: 'TIPJAR', wallet: '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3' } });
  assert.match(ready, /^\| Entry \| TipJar for Arc Microgrants \|/);
  assert.ok(ready.endsWith('| Prize | 500 USDC × 20 grants |'), ready);
});

test('Ruling 15 (plan): a campaign not ready still asks about the remembered payout wallet', () => {
  const W2 = '0xAbCdEf0123456789abcdef0123456789ABCDEf01';
  const t = confirmTable({ project: 'Tip Jar', programTitle: 'EarnKit Campaign #1', campaign, prize: '', endsAt: ENDS,
    payoutWallet: null, askWallet: W2, missing: ['Payout wallet'], token: { symbol: 'TIP' } });
  assert.ok(t.startsWith('Before you submit: Payout wallet.\n\n| Entry |'), t);
  assert.ok(t.endsWith(`Pay prizes to ${W2}? It is the wallet from your last entry.`), t);
  assert.doesNotMatch(t, /\| Token \||Fees in WETH|Token:/);
});

test('C5: the not-ready line uses short to-dos: the program\'s todo, else the label normalized; at most 3, then "and N more"', () => {
  assert.equal(todoOf({ label: 'Live deployment on Arc mainnet', todo: 'a live link on Arc mainnet' }), 'a live link on Arc mainnet');
  assert.equal(notReadyLine([todoOf({ label: 'Live deployment on Arc mainnet', todo: 'a live link on Arc mainnet' })]), 'Before you submit: a live link on Arc mainnet.');
  // Fallbacks: articles where obvious; questions keep their words, never "?."; names keep capitals.
  assert.equal(todoOf({ label: 'Public repo' }), 'a public repo');
  assert.equal(todoOf({ label: 'Live link' }), 'a live link');
  assert.equal(todoOf({ label: 'Payout wallet' }), 'your payout wallet');
  assert.equal(todoOf({ label: 'Email' }), 'your email');
  assert.equal(todoOf({ label: 'Product roadmap' }), 'a product roadmap');
  assert.equal(todoOf({ label: 'Proposed grant milestones' }), 'proposed grant milestones');
  assert.equal(todoOf({ label: "What's your Base Builder Code?" }), "what's your Base Builder Code");
  assert.equal(todoOf({ label: 'Which credits would be most useful for you as you build? (e.g. Privy, AWS, etc.)' }), 'which credits would be most useful for you as you build');
  assert.equal(todoOf({ label: 'GitHub repo' }), 'a GitHub repo');
  assert.equal(todoOf({ label: 'Telegram username' }), 'your Telegram username');
  assert.equal(todoOf({ label: 'Your Circle and Arc integrations' }), 'your Circle and Arc integrations');
  // Given but invalid (fix round 1, Minor 7).
  assert.equal(todoOf({ label: 'Live link' }, true), 'a live link (check it)');
  assert.equal(notReadyLine(['a', 'b', 'c']), 'Before you submit: a; b; c.');
  assert.equal(notReadyLine(['a', 'b', 'c', 'd', 'e']), 'Before you submit: a; b; c; and 2 more.');
});

test('fix round 1 (Minor 3): the row shows the proposed name unless it is the ticker', () => {
  assert.equal(tokenRow('TIP', 'Tip Jar'), 'Launches Tip Jar ($TIP): 40% of its fees to you · or skip the token');
  assert.equal(tokenRow('TIPJAR', 'Tip Jar'), 'Launches $TIPJAR: 40% of its fees to you · or skip the token');
  assert.doesNotMatch(tokenRow('TIP'), /clanker|protocol cut|WETH|gas/i);
});
