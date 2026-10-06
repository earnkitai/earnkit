import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertLines, type AlertFacts } from './alerts';
import { coinRow, enteredText, noCoinYet, walletLine } from './entry-text';
import { OWNERSHIP_FOR_TOKEN, TOOL_DESCRIPTIONS } from './mcp';
import { presentFirstMessage, type Card, type FirstMessage } from './present';
import type { Verdict } from './match';

/**
 * v2.6 §3 copy review: every builder-facing template this task touched, scanned for the house
 * style (global-constraints.md): no emojis, never "vault", no tool names in builder text, no
 * implied affiliation. Agent-only text (OWNERSHIP_FOR_TOKEN, TOOL_DESCRIPTIONS) is checked for
 * emojis/vault/affiliation too, but is allowed to name tools and files — that's who it's for.
 */

const arc: Card = {
  id: 'arc-microgrants',
  title: 'Arc Microgrants',
  summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET',
  tag: null,
  each_time: [],
  ends_at: new Date('2026-10-15T03:59:00Z'),
  max_award_usd: 500,
  builder_fields: 1,
  ideas: ['Arc idea'],
};
const base: Card = {
  id: 'base-builder-grants',
  title: 'Base Builder Grant Program',
  summary: 'up to $5,000 · rolling',
  tag: 'needs a live product',
  each_time: ['a short Loom', 'usage numbers'],
  ends_at: null,
  max_award_usd: 5000,
  builder_fields: 10,
};
const v = (program_id: string, status: Verdict['status'], note: string, effort: Verdict['effort'] = 'none'): Verdict => ({
  program_id,
  program: program_id,
  status,
  missing: [],
  effort,
  note,
});
const msg = (m: Partial<FirstMessage>): FirstMessage => ({
  alerts: [],
  campaigns: [],
  cards: [],
  repos: null,
  workingOn: [],
  agentCanBuild: true,
  sponsorEntries: null,
  now: new Date('2026-10-04T12:00:00Z'),
  ...m,
});

// ---- Three presentFirstMessage shapes (Ruling 11 (plan)): no repo/no GitHub, GitHub user with 0
// repos, and with repos. Only the first gets "You could".
const noRepoNoGithub = presentFirstMessage(msg({ cards: [arc] }));
const githubZeroRepos = presentFirstMessage(msg({ cards: [arc], repos: { checked: 0, fits: [] }, githubGiven: true }));
const withRepos = presentFirstMessage(
  msg({ cards: [base], repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [v('base-builder-grants', 'likely', 'looks eligible')] }] } }),
);

// ---- coinRow, walletLine, enteredText, noCoinYet: every branch.
const coinRows = [
  coinRow({ symbol: 'TIPJAR', hasBonus: true }),
  coinRow({ symbol: null, hasBonus: true }),
  coinRow({ symbol: 'TIPJAR', hasBonus: false }),
  coinRow({ symbol: null, hasBonus: false }),
  coinRow({ symbol: 'TIPJAR', hasBonus: true, coinIn: 'Arc Microgrants' }),
];
const walletLines = [
  walletLine({ wallet: '0xAB12000000000000000000000000000000ef01', remembered: true, hasBonus: true }),
  walletLine({ wallet: '0xAB12000000000000000000000000000000ef01', remembered: false, hasBonus: false }),
  walletLine({ wallet: null, remembered: false, hasBonus: true }),
  walletLine({ wallet: null, remembered: false, hasBonus: false }),
];
const round = { cell: '0.18 ETH so far', lastDay: new Date('2026-10-15T03:59:00.000Z'), board: 'earnkit.com/bonus/arc-microgrants-2026-10-01' };
const enteredTexts = [
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'launched', url: 'https://tokens.fun/coin/0xabc' }, bonus: round }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'no_wallet' }, bonus: round }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'no_wallet' }, bonus: null }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'pending' }, bonus: null }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'skipped' }, bonus: null }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'other' }, bonus: null }),
  enteredText({
    programTitle: 'Arc Microgrants',
    coin: { status: 'launched', url: 'https://tokens.fun/coin/0xabc' },
    bonus: { ...round, join: { kind: 'confirm', site: 'dorahacks.io' } },
  }),
  enteredText({
    programTitle: 'Arc Microgrants',
    coin: { status: 'launched', url: 'https://tokens.fun/coin/0xabc' },
    bonus: { ...round, join: { kind: 'page', site: 'dorahacks.io', missing: 'live site' } },
  }),
  enteredText({
    programTitle: 'Arc Microgrants',
    coin: { status: 'launched', url: 'https://tokens.fun/coin/0xabc' },
    bonus: { ...round, join: { kind: 'link', site: 'dorahacks.io' } },
  }),
];
const noCoinYets = [noCoinYet(new Date('2026-10-15T03:59:00.000Z')), noCoinYet(null)];

// ---- The v2.6 §3 alert lines: bonus paid (as WETH, with/without a wallet), fees to claim, and
// the builder-bonus top-10 move/drop lines, all with their leaderboard links.
const alertFacts: AlertFacts = {
  newCampaigns: [],
  standings: [],
  prizes: [],
  fees: { usd: 138, tokens: [{ url: 'https://tokens.fun/coin/0xabc', symbol: 'TIP' }] },
  bonusWins: [
    {
      id: 1,
      project_id: 7,
      name: 'TipJar',
      program_title: 'Arc Microgrants',
      amount_wei: 12n * 10n ** 16n,
      tx_hash: '0x' + 'a'.repeat(64),
      paid_at: new Date('2026-10-20T00:00:00Z'),
      wallet: '0xAB12000000000000000000000000000000ef01',
      round_key: 'arc-microgrants:2026-09-16',
    },
    {
      id: 2,
      project_id: 8,
      name: 'NoWallet',
      program_title: 'Base Builder Grant Program',
      amount_wei: 5n * 10n ** 16n,
      tx_hash: '0x' + 'b'.repeat(64),
      paid_at: new Date('2026-10-20T00:00:00Z'),
      wallet: null,
      round_key: 'base-builder-grants:2026-10',
    },
  ],
  bonusStandings: [
    { project_id: 7, program_title: 'Arc Microgrants', inTop: true, round_key: 'arc-microgrants:2026-09-16' },
  ],
};
const movedPrev = { checkedAt: new Date('2026-10-01T00:00:00Z'), state: { top: {}, bonusTop: { '7': false } }, feeAlertedUsd: 0 };
const droppedPrev = { checkedAt: new Date('2026-10-01T00:00:00Z'), state: { top: {}, bonusTop: { '7': true } }, feeAlertedUsd: 0 };
const alertLinesMoved = alertLines(movedPrev, alertFacts).lines;
const alertLinesDropped = alertLines(droppedPrev, { ...alertFacts, bonusStandings: [{ ...alertFacts.bonusStandings[0], inTop: false }] }).lines;

const builderFacing: [string, string][] = [
  ...coinRows.map((s, i): [string, string] => [`coinRow[${i}]`, s]),
  ...walletLines.map((s, i): [string, string] => [`walletLine[${i}]`, s]),
  ...enteredTexts.map((s, i): [string, string] => [`enteredText[${i}]`, s]),
  ['presentFirstMessage: no repo, no GitHub', noRepoNoGithub],
  ['presentFirstMessage: GitHub user, 0 repos', githubZeroRepos],
  ['presentFirstMessage: with repos', withRepos],
  ...alertLinesMoved.map((s, i): [string, string] => [`alertLines moved[${i}]`, s]),
  ...alertLinesDropped.map((s, i): [string, string] => [`alertLines dropped[${i}]`, s]),
];

// noCoinYet is the AGENT's note (never shown to the builder as written; see entry-text.ts), so it
// may name launch_token — same bucket as OWNERSHIP_FOR_TOKEN and the tool descriptions.
const agentFacing: [string, string][] = [
  ['OWNERSHIP_FOR_TOKEN', OWNERSHIP_FOR_TOKEN],
  ...Object.entries(TOOL_DESCRIPTIONS).map(([name, d]): [string, string] => [`TOOL_DESCRIPTIONS.${name}`, d]),
  ...noCoinYets.map((s, i): [string, string] => [`noCoinYet[${i}]`, s]),
];

const all = [...builderFacing, ...agentFacing];

test('v2.6 §3 copy review: no emojis anywhere', () => {
  for (const [label, text] of all) assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, label);
});

test('v2.6 §3 copy review: never "vault"', () => {
  for (const [label, text] of all) assert.doesNotMatch(text, /vault/i, label);
});

test('v2.6 §3 copy review: no implied affiliation, except the carved-out BONUS_NOTE phrase', () => {
  const carveOut = /isn't affiliated with or endorsed by/gi;
  for (const [label, text] of all) {
    const stripped = text.replace(carveOut, '');
    assert.doesNotMatch(stripped, /\b(partner|official|endorsed by|sponsored by)\b/i, label);
  }
});

test('v2.6 §3 copy review: builder-facing text never names a tool', () => {
  const toolNames = /\b(list_programs|get_program|prepare_submission|record_submission|launch_token|sponsor_campaign)\b/;
  for (const [label, text] of builderFacing) assert.doesNotMatch(text, toolNames, label);
});

test('v2.6 §3 copy review: "You could" shows only with no repo and no GitHub user', () => {
  assert.match(noRepoNoGithub, /You could/);
  assert.doesNotMatch(githubZeroRepos, /You could/i);
  assert.doesNotMatch(withRepos, /You could/i);
});

test('v2.6 §3 copy review: the with-repo hook keeps "qualify"', () => {
  assert.match(withRepos, /you qualify for/);
});
