import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COIN_FOOTNOTE,
  TOKEN_FOOTNOTE,
  boardLink,
  coinRow,
  confirmTable,
  enteredTable,
  enteredText,
  keyTable,
  noCoinYet,
  REPO_HELD,
  roundEndLabel,
  summaryCloses,
  tokenFootnote,
  tokenRow,
  walletLine,
} from './entry-text';
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

test('v2.5 Task 8 (v2.6 §3): confirmTable passes hasBonus through to the coin row', () => {
  const text = confirmTable({
    project: 'Tip Jar', programTitle: 'Arc Microgrants', campaign: null,
    prize: '500 USDC × 20 grants', endsAt: null, payoutWallet: null,
    token: { symbol: 'TIP', hasBonus: true },
  });
  assert.match(text, /\| Coin \| Your entry gets a coin, \$TIP: .*skip: no coin, no builder bonus \|/);
  // No wallet known: the wallet line is the ask.
  assert.ok(text.endsWith(`\n\nWhich wallet should get your coin's fees and any bonus?\n\n${COIN_FOOTNOTE}`), text);
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
    "| Entry | Tip Jar for Crypto World's Fair Hackathon |\n|---|---|\n| Prize | $30,000 |\n| Coin | no builder bonus: this repo's coin is entered in Arc Microgrants |",
    'no new coin, so no wallet line and no fee footnote',
  );
  assert.doesNotMatch(text, /vault|\p{Extended_Pictographic}/u);
});

const W = '0xab12000000000000000000000000000000ef0123';
test('v2.6 §3, Ruling 22: the coin row and the wallet line (the wallet in full, once)', () => {
  assert.equal(
    coinRow({ symbol: 'TIPJAR', hasBonus: true }),
    'Your entry gets a coin, $TIPJAR: you earn 40% of its trading fees, and it enters the builder bonus · skip: no coin, no builder bonus',
  );
  assert.equal(coinRow({ symbol: 'TIPJAR', hasBonus: false }), 'Your entry gets a coin, $TIPJAR: you earn 40% of its trading fees · skip: no coin');
  assert.equal(coinRow({ symbol: null, hasBonus: true }), 'Your entry gets a coin (pick a name and ticker): you earn 40% of its trading fees, and it enters the builder bonus · skip: no coin, no builder bonus');
  assert.equal(coinRow({ symbol: 'X', hasBonus: true, coinIn: 'Arc Microgrants' }), "no builder bonus: this repo's coin is entered in Arc Microgrants");
  assert.equal(walletLine({ wallet: W, remembered: true, hasBonus: true }), `Wallet for fees and any bonus: ${W} (used last time) — or tell me another.`);
  assert.equal(walletLine({ wallet: W, remembered: false, hasBonus: false }), `Wallet for fees: ${W} — or tell me another.`);
  assert.equal(walletLine({ wallet: null, remembered: false, hasBonus: true }), "Which wallet should get your coin's fees and any bonus?");
  assert.equal(
    COIN_FOOTNOTE,
    `Fees in WETH, after Clanker's 20% cut; tokens.fun pays gas. Terms: ${TOKEN_TERMS.agreement} · Risks: ${TOKEN_TERMS.risks}`,
  );
  for (const line of [coinRow({ symbol: 'TIPJAR', hasBonus: true }), walletLine({ wallet: W, remembered: true, hasBonus: true }), COIN_FOOTNOTE])
    assert.doesNotMatch(line, /vault|\p{Extended_Pictographic}/u);
});

test('v2.6 §3, Ruling 22: confirmTable outside campaigns: Coin row, the full wallet once, the short footnote', () => {
  const t = confirmTable({ project: 'TipJar', programTitle: 'Arc Microgrants', campaign: null, prize: '500 USDC', endsAt: null, payoutWallet: null,
    token: { symbol: 'TIPJAR', wallet: W, hasBonus: true, remembered: true } });
  assert.equal(
    t,
    [
      '| Entry | TipJar for Arc Microgrants |',
      '|---|---|',
      '| Prize | 500 USDC |',
      '| Coin | Your entry gets a coin, $TIPJAR: you earn 40% of its trading fees, and it enters the builder bonus · skip: no coin, no builder bonus |',
      '',
      `Wallet for fees and any bonus: ${W} (used last time) — or tell me another.`,
      '',
      COIN_FOOTNOTE,
    ].join('\n'),
  );
  assert.equal(t.split(W).length, 2, 'the wallet appears once');
  assert.equal(t.split('40%').length, 2, '40% appears once');
  // Campaign tables keep v2.4's Token row and footnote, and no wallet line.
  const c = confirmTable({ project: 'TipJar', programTitle: 'EarnKit Campaign #1', campaign, prize: '', endsAt: ENDS, payoutWallet: null,
    token: { symbol: 'TIPJAR', wallet: W, remembered: true } });
  assert.match(c, /\| Token \| /);
  assert.ok(c.endsWith(tokenFootnote(W)));
  assert.doesNotMatch(c, /\| Coin \||Wallet for fees/);
});

test('v2.6 §3, Ruling 22: the after-submission reply never names a tool', () => {
  // Ruling 29: Arc's round ends 2026-10-15T03:59Z, which is Oct 14, 11:59 PM ET: "Oct 14".
  const bonus = { cell: '0.18 ETH so far', ends: 'Oct 14', board: 'earnkit.com/bonus/arc-microgrants-2026-09-16' };
  assert.equal(
    enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'launched', url: 'https://tokens.fun/coin/0xabc' }, bonus }),
    'Entered in Arc Microgrants. Your coin: tokens.fun/coin/0xabc · you earn 40% of its fees.\n' +
      'Builder bonus: 0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/arc-microgrants-2026-09-16',
  );
  assert.equal(enteredText({ programTitle: 'Base Builder Grant Program', coin: { status: 'skipped' }, bonus: null }), 'Entered in Base Builder Grant Program.');
  // No wallet: one line, the date once.
  assert.equal(
    enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'no_wallet' }, bonus }),
    'Entered in Arc Microgrants. Reply with a wallet to get your coin and join the builder bonus (0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/arc-microgrants-2026-09-16).',
  );
  assert.equal(enteredText({ programTitle: 'Base Builder Grant Program', coin: { status: 'no_wallet' }, bonus: null }), 'Entered in Base Builder Grant Program. Reply with a wallet to get your coin.');
  assert.equal(
    enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'pending' }, bonus }),
    'Entered in Arc Microgrants. Your coin is launching.\nBuilder bonus: 0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/arc-microgrants-2026-09-16',
  );
  assert.equal(enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'other' }, bonus: null }), "Entered in Arc Microgrants. Your coin isn't launched yet.");
  for (const status of ['launched', 'pending', 'no_wallet', 'skipped', 'other'] as const)
    assert.doesNotMatch(
      enteredText({ programTitle: 'P', coin: status === 'launched' ? { status, url: 'https://tokens.fun/coin/0x1' } : { status }, bonus }),
      /launch_token|record_submission|creator_wallet|payout_wallet/,
    );
  // The agent's note (never shown to the builder) names the tool and the date.
  assert.equal(noCoinYet('Oct 14'), 'No coin yet: no wallet was given. When the builder replies with a wallet, call launch_token with the wallet as creator_wallet by Oct 14.');
  assert.equal(noCoinYet(null), 'No coin yet: no wallet was given. When the builder replies with a wallet, call launch_token with the wallet as creator_wallet.');
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

test('fix round 1 (I3): an entry that does not count yet is told plainly what joins the builder bonus', () => {
  const base = { cell: '0.18 ETH so far', ends: 'Oct 14', board: 'earnkit.com/bonus/arc-microgrants-2026-09-16' };
  const coin = { status: 'launched' as const, url: 'https://tokens.fun/coin/0xabc' };
  assert.equal(
    enteredText({ programTitle: 'Base Batches', coin, bonus: { ...base, join: { kind: 'confirm', site: 'base.org' } } }),
    'Entered in Base Batches. Your coin: tokens.fun/coin/0xabc · you earn 40% of its fees.\n' +
      "Tell me once you've submitted on base.org to join the builder bonus (0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/arc-microgrants-2026-09-16).",
  );
  assert.equal(
    enteredText({ programTitle: 'Arc Microgrants', coin, bonus: { ...base, join: { kind: 'page', site: 'dorahacks.io' } } }),
    'Entered in Arc Microgrants. Your coin: tokens.fun/coin/0xabc · you earn 40% of its fees.\n' +
      'Add your repo link to your dorahacks.io entry page to join the builder bonus (0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/arc-microgrants-2026-09-16).',
  );
  // N2: an entry without a repo is asked for its live site link, never a repo link.
  assert.equal(
    enteredText({ programTitle: 'Arc Microgrants', coin, bonus: { ...base, join: { kind: 'page', site: 'dorahacks.io', missing: 'live site' } } }),
    'Entered in Arc Microgrants. Your coin: tokens.fun/coin/0xabc · you earn 40% of its fees.\n' +
      'Add your live site link to your dorahacks.io entry page to join the builder bonus (0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/arc-microgrants-2026-09-16).',
  );
  // Ruling 24: a public entry page, no entry link given yet.
  assert.equal(
    enteredText({ programTitle: 'Arc Microgrants', coin, bonus: { ...base, join: { kind: 'link', site: 'dorahacks.io' } } }),
    'Entered in Arc Microgrants. Your coin: tokens.fun/coin/0xabc · you earn 40% of its fees.\n' +
      'Send me your dorahacks.io entry link to join the builder bonus (0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/arc-microgrants-2026-09-16).',
  );
  // Counting (join null): the current line.
  assert.match(enteredText({ programTitle: 'A', coin, bonus: { ...base, join: null } }), /\nBuilder bonus: 0\.18 ETH so far · ends Oct 14 · /);
  for (const kind of ['confirm', 'page', 'link'] as const)
    assert.doesNotMatch(
      enteredText({ programTitle: 'A', coin, bonus: { ...base, join: { kind, site: 'x.io' } } }),
      /builder_submitted|record_submission|launch_token|external_submission_url|vault/,
    );
});

test('Ruling 29 (final I2): the round end is the first message\'s day, the real local deadline', async () => {
  const { endsOf } = await import('./present');
  // Arc: closes Oct 14, 11:59 PM ET = 2026-10-15T03:59Z. The first message says "Oct 14"; so does every reply.
  const arc = { summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET', ends_at: new Date('2026-10-15T03:59:00Z') };
  const card = { id: 'arc', title: 'Arc', tag: null, each_time: [], ...arc };
  assert.equal(endsOf(card), 'Oct 14');
  assert.equal(roundEndLabel(arc, arc.ends_at), endsOf(card));
  // Monad and Colosseum: the same, never the next UTC day.
  const monad = { summary: '$250K+ prize pool · closes Oct 13, 11:59 PM ET', ends_at: new Date('2026-10-14T03:59:00Z') };
  assert.equal(roundEndLabel(monad, monad.ends_at), 'Oct 13');
  const colosseum = { summary: '$840K+ in prizes · closes Oct 12, 11:59 PM PT', ends_at: new Date('2026-10-13T06:59:00Z') };
  assert.equal(roundEndLabel(colosseum, colosseum.ends_at), 'Oct 12');
  // No "closes" in the summary: the deadline's UTC day, as endsOf shows it.
  const plain = { summary: 'up to $5,000', ends_at: new Date('2026-10-15T03:59:00Z') };
  assert.equal(roundEndLabel(plain, plain.ends_at), endsOf({ ...card, ...plain }));
  // A rolling program's month ends Nov 1 00:00 UTC (exclusive): its last day.
  assert.equal(roundEndLabel({ summary: 'up to $5,000 · rolling', ends_at: null }, new Date('2026-11-01T00:00:00Z')), 'Oct 31');
  assert.equal(summaryCloses('up to $5,000 · rolling'), null);
  // The reply and the agent note carry that same day.
  const label = roundEndLabel(arc, arc.ends_at);
  const reply = enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'no_wallet' }, bonus: { cell: 'new pool', ends: label, board: 'b' } });
  assert.match(reply, /ends Oct 14 /);
  assert.match(noCoinYet(label), /by Oct 14\.$/);
});

test('final M1: an entry whose repo another entry holds here gets one plain line, no bonus or wallet ask', () => {
  for (const status of ['launched', 'pending', 'no_wallet', 'skipped', 'other'] as const) {
    const text = enteredText({
      programTitle: 'Arc Microgrants',
      coin: status === 'launched' ? { status, url: 'https://tokens.fun/coin/0x1' } : { status },
      bonus: null,
      repoHeld: true,
    });
    assert.equal(text, `Entered in Arc Microgrants. ${REPO_HELD}`);
    assert.doesNotMatch(text, /Reply with a wallet|Builder bonus:|launch_token|creator_wallet/);
  }
});

test('final M4: a coin not launched yet joins the builder bonus once it is; never an unconditional bonus line', () => {
  const bonus = { cell: '0.18 ETH so far', ends: 'Oct 14', board: 'earnkit.com/bonus/arc' };
  const other = { status: 'other' as const };
  assert.equal(
    enteredText({ programTitle: 'Arc Microgrants', coin: other, bonus }),
    "Entered in Arc Microgrants. Your coin isn't launched yet; it joins the builder bonus once it is (0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/arc).",
  );
  assert.equal(
    enteredText({ programTitle: 'Base Batches', coin: other, bonus: { ...bonus, join: { kind: 'confirm', site: 'base.org' } } }),
    "Entered in Base Batches. Your coin isn't launched yet.\nTell me once you've submitted on base.org to join the builder bonus when your coin launches (0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/arc).",
  );
  assert.doesNotMatch(enteredText({ programTitle: 'A', coin: other, bonus }), /\nBuilder bonus:|No coin yet/);
});
