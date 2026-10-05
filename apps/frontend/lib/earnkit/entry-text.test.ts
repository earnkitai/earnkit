import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_FOOTNOTE, confirmTable, enteredTable, keyTable, tokenFootnote, tokenRow } from './entry-text';
import { TOKEN_TERMS } from './tokens';
import type { CampaignConfig } from './campaigns';

const campaign: CampaignConfig = {
  kind: 'earnkit',
  prize: { token: '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07', symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5, amount_each: '84800000', prize_usd_total: 500, metric: 'unique_wallets', min_score: 10,
};
const ENDS = new Date('2026-10-18T23:59:00Z');

test('confirmTable: the spec block, prize first, one token row, terms under the table', () => {
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
      '| Token | $TIP on tokens.fun, you keep 40% of fees (say "no token" to skip) |',
      '',
      TOKEN_FOOTNOTE,
    ].join('\n'),
  );
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
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

test('v2.5 Task 8: the coin row on a program with a builder bonus says so, and never otherwise', () => {
  assert.equal(tokenRow('TIP'), '$TIP on tokens.fun, you keep 40% of fees (say "no token" to skip)');
  assert.equal(tokenRow('TIP', false), '$TIP on tokens.fun, you keep 40% of fees (say "no token" to skip)');
  assert.equal(tokenRow('TIP', true), '$TIP on tokens.fun, you keep 40% of fees · skip: no builder bonus');
  assert.equal(
    tokenRow(null, true),
    'A token on tokens.fun, you keep 40% of fees: pick a name and ticker · skip: no builder bonus',
  );
  assert.equal(
    tokenRow(null, false),
    'A token on tokens.fun, you keep 40% of fees: pick a name and ticker, or say "no token" to skip',
  );
  for (const row of [tokenRow('TIP', true), tokenRow(null, true)])
    assert.doesNotMatch(row, /\p{Extended_Pictographic}/u);
});

test('v2.5 Task 8: confirmTable passes hasBonus through to the token row', () => {
  const text = confirmTable({
    project: 'Tip Jar', programTitle: 'Arc Microgrants', campaign: null,
    prize: '500 USDC × 20 grants', endsAt: null, payoutWallet: null,
    token: { symbol: 'TIP', hasBonus: true },
  });
  assert.match(text, /\| Token \| \$TIP on tokens\.fun, you keep 40% of fees · skip: no builder bonus \|/);
});

test('v2.5 Task 8: the footnote names the fee split for the builder only', () => {
  assert.match(TOKEN_FOOTNOTE, /you keep 40% of trading fees \(after Clanker's 20% protocol cut\)/);
  assert.doesNotMatch(TOKEN_FOOTNOTE, /MINI buyback|builder bonus|EarnKit Safe/);
});

test('Ruling 14: the footnote names the fee wallet when it is known (v2.3 consent)', () => {
  const W = '0xabcdef0123456789abcdef0123456789abcdef01';
  assert.equal(tokenFootnote(null), TOKEN_FOOTNOTE);
  assert.equal(tokenFootnote(W), TOKEN_FOOTNOTE.replace('paid in WETH;', `paid in WETH to ${W};`));
  assert.ok(TOKEN_FOOTNOTE.includes(TOKEN_TERMS.agreement) && TOKEN_FOOTNOTE.includes(TOKEN_TERMS.risks));
  const text = confirmTable({
    project: 'Tip Jar', programTitle: 'EarnKit Campaign #1', campaign, prize: '', endsAt: ENDS,
    payoutWallet: W, token: { symbol: 'TIP', wallet: W },
  });
  assert.ok(text.endsWith(`\n\n${tokenFootnote(W)}`));
});

test('Ruling 25 (I8): the coin row of a repo whose coin is entered in another program says no builder bonus', () => {
  assert.equal(tokenRow('TIP', true, 'Arc Microgrants'), "no builder bonus: this repo's coin is entered in Arc Microgrants");
  // Only where a bonus could be won; v2.3 rows elsewhere are unchanged.
  assert.equal(tokenRow('TIP', false, 'Arc Microgrants'), '$TIP on tokens.fun, you keep 40% of fees (say "no token" to skip)');
  const text = confirmTable({
    project: 'Tip Jar', programTitle: "Crypto World's Fair Hackathon", campaign: null,
    prize: '$30,000', endsAt: null, payoutWallet: null,
    token: { symbol: 'TIP', wallet: '0x1111111111111111111111111111111111111111', hasBonus: true, coinIn: 'Arc Microgrants' },
  });
  assert.equal(
    text,
    "| Entry | Tip Jar for Crypto World's Fair Hackathon |\n|---|---|\n| Prize | $30,000 |\n| Token | no builder bonus: this repo's coin is entered in Arc Microgrants |",
    'no new coin, so no fee footnote',
  );
  assert.doesNotMatch(text, /vault|\p{Extended_Pictographic}/u);
});
