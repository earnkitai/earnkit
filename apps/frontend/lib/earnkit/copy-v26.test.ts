import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { alertLines, sinceLine, type AlertFacts } from './alerts';
import { WALLET_INVALID, type CampaignConfig } from './campaigns';
import {
  COIN_FOOTNOTE,
  confirmTable,
  coinRow,
  enteredTable,
  enteredText,
  noCoinYet,
  walletLine,
} from './entry-text';
import { OWNERSHIP_FOR_TOKEN, TOOL_DESCRIPTIONS } from './mcp';
import { presentFirstMessage, type Card, type FirstMessage } from './present';
import { tools } from './tools';
import { ownerProblem, tokenGate, tokenLineFor, type GateDeps, type GateInput } from './token-gate';
import { launchToken, TECHNICAL_TERMS, type FlowProject, type TokenFlowDeps } from './token-launch';
import { LINKS_CHANGED, STATE_CHANGED, LaunchError, repoHasTokenNote, TOKENS_UNAVAILABLE, type TokenOutcome } from './tokens';
import { RateLimitError } from './rate-limit';
import type { FetchResult } from './ownership';
import type { Verdict } from './match';
import PolicyPage from '../../app/policy/page';

(globalThis as { React?: typeof React }).React = React;
process.env.EARNKIT_AUTH_SECRET ??= 'copy-review-test-secret';

/**
 * v2.6 §3 copy review (fix round 1, I2): every builder-facing template this task touched or could
 * have broken, scanned for the house style (global-constraints.md): no emojis, never "vault", no
 * tool names in builder text, no implied affiliation, and — new in this round — never a literal
 * instruction for the builder to add/edit/push a file themselves (the live contradiction I2
 * found in token-gate.ts's gate_failed reasons). Agent-only text (OWNERSHIP_FOR_TOKEN,
 * TOOL_DESCRIPTIONS, noCoinYet) is checked for emojis/vault/affiliation too, but is allowed to
 * name tools and files — that's who it's for.
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

// ---- The v2.6 §3 alert lines: the builder-bonus win (with/without a wallet), coin fees, and the
// builder-bonus top-10 move/drop lines, all with their leaderboard links.
const BONUS_WALLET = '0xab1200000000000000000000000000000000ef01';
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
      wallet: BONUS_WALLET,
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
// I2's size guard: a producer regressing to no lines must fail loudly, not leave every check
// vacuously passing on an empty scan.
test('v2.6 §3 copy review: the alert fixtures actually produce lines (not a vacuous scan)', () => {
  assert.equal(alertLinesMoved.length, 4);
  assert.equal(alertLinesDropped.length, 4);
});

// ---- Three presentFirstMessage shapes (Ruling 11 (plan)): no repo/no GitHub, GitHub user with 0
// repos, and with repos. Only the first gets "You could". Plus the alerts-in-the-reply case (I2)
// and the "None of your N repos fits" case (I2), both missed by the first round.
const noRepoNoGithub = presentFirstMessage(msg({ cards: [arc] }));
const githubZeroRepos = presentFirstMessage(msg({ cards: [arc], repos: { checked: 0, fits: [] }, githubGiven: true }));
const withRepos = presentFirstMessage(
  msg({ cards: [base], repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [v('base-builder-grants', 'likely', 'looks eligible')] }] } }),
);
const withAlerts = presentFirstMessage(msg({ alerts: alertLinesMoved, cards: [arc] }));
const noneOfYourReposFit = presentFirstMessage(
  msg({ cards: [base], repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [v('base-builder-grants', 'no', 'not on Base')] }] } }),
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
  walletLine({ wallet: BONUS_WALLET, remembered: true, hasBonus: true }),
  walletLine({ wallet: BONUS_WALLET, remembered: false, hasBonus: false }),
  walletLine({ wallet: null, remembered: false, hasBonus: true }),
  walletLine({ wallet: null, remembered: false, hasBonus: false }),
];
const round = { cell: '0.18 ETH so far', ends: 'Oct 14', board: 'earnkit.com/bonus/arc-microgrants-2026-10-01' };
const enteredTexts = [
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'launched', url: 'https://tokens.fun/coin/0xabc' }, bonus: round }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'no_wallet' }, bonus: round }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'no_wallet' }, bonus: null }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'pending' }, bonus: null }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'skipped' }, bonus: null }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'other' }, bonus: null }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'other' }, bonus: round }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'other' }, bonus: { ...round, join: { kind: 'confirm', site: 'dorahacks.io' } } }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'no_wallet' }, bonus: null, repoHeld: true }),
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
const noCoinYets = [noCoinYet('Oct 14'), noCoinYet(null)];

// ---- The prepare_submission confirm screen (I2): confirmTable, where the coin row and wallet
// line actually appear, plus COIN_FOOTNOTE on its own; and the campaign enteredTable.
const campaign: CampaignConfig = {
  kind: 'earnkit',
  prize: { token: '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07', symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5,
  amount_each: '84800000',
  prize_usd_total: 500,
  metric: 'unique_wallets',
  min_score: 10,
};
const ENDS = new Date('2026-10-18T23:59:00Z');
const confirmTables = [
  // Non-campaign, with a remembered wallet.
  confirmTable({
    project: 'Tip Jar', programTitle: 'Arc Microgrants', campaign: null, prize: '500 USDC × 20 grants', endsAt: null,
    payoutWallet: null, token: { symbol: 'TIPJAR', wallet: BONUS_WALLET, hasBonus: true, remembered: true },
  }),
  // Non-campaign, with a given (not remembered) wallet.
  confirmTable({
    project: 'Tip Jar', programTitle: 'Arc Microgrants', campaign: null, prize: '500 USDC × 20 grants', endsAt: null,
    payoutWallet: null, token: { symbol: 'TIPJAR', wallet: BONUS_WALLET, hasBonus: true },
  }),
  // Non-campaign, no wallet yet.
  confirmTable({
    project: 'Tip Jar', programTitle: 'Arc Microgrants', campaign: null, prize: '500 USDC × 20 grants', endsAt: null,
    payoutWallet: null, token: { symbol: null, hasBonus: true },
  }),
  // Non-campaign, Ruling 25 (repo's coin already entered elsewhere).
  confirmTable({
    project: 'Tip Jar', programTitle: 'Arc Microgrants', campaign: null, prize: '500 USDC × 20 grants', endsAt: null,
    payoutWallet: null, token: { symbol: 'TIPJAR', hasBonus: true, coinIn: 'Base Builder Grant Program' },
  }),
  // One EarnKit campaign (v2.4's Token row, not the v2.6 Coin row).
  confirmTable({
    project: 'Tip Jar', programTitle: 'EarnKit Campaign #1', campaign, prize: '', endsAt: ENDS,
    payoutWallet: '0xAbCdEf0123456789abcdef0123456789ABCDEf01', token: { symbol: 'TIP' },
  }),
];
const enteredTables = [
  enteredTable({
    project: 'Tip Jar', programTitle: 'EarnKit Campaign #1', standing: 'not scored yet (scores update daily)',
    leaderboard: 'https://earnkit.com/campaigns/earnkit-campaign-1-base', campaign, endsAt: ENDS,
    payoutWallet: '0xabcdef0123456789abcdef0123456789abcdef01',
  }),
];

// ---- The policy page (I2): rendered to text the same way public-pages.test.ts verifies it.
// Cut at the shared Footer (its own copyright boilerplate, unrelated to and unchanged by v2.6):
// this scan is for the policy copy, not every page's site-wide footer.
const policyHtml = renderToStaticMarkup(React.createElement(PolicyPage));
const policyText = policyHtml
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .split('Where agents earn.')[0];

// ---- Gate reasons (T3, I2): every branch of tokenGate's GateResult, which flows straight into
// record_submission/launch_token's `token.note` (plain builder words; agent_note is for the agent). This is where
// the live contradiction lived: a reason that told the builder to add/push earnkit.txt, against
// "never ask the builder to edit files". gatherGateReasons runs them all with stub deps (no
// network, no DB).
async function gatherGateReasons(): Promise<[string, string][]> {
  const REPO = 'https://github.com/acme/kit';
  const input: GateInput = { policy: 'encouraged', repoUrl: REPO, wallet: '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3', symbol: 'KIT', installationId: 1 };
  const okDeps: Required<GateDeps> = {
    repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
    owner: async () => ({ status: 'ok', text: 'token: 0000000000000000' }),
    screen: async () => {},
  };
  const cases: [string, Partial<GateInput>, Partial<GateDeps>][] = [
    ['policy off', { policy: 'off' }, {}],
    ['no repo url', { repoUrl: null }, {}],
    ['not a GitHub link', { repoUrl: 'https://gitlab.com/a/b' }, {}],
    ['repo not public', {}, { repo: async () => { throw new Error('GitHub: /repos/acme/kit not found (or private)'); } }],
    ['GitHub down (repo read)', {}, { repo: async () => { throw new Error('GitHub request failed (502)'); } }],
    ['no commits', {}, { repo: async () => ({ fork: false, hasCommits: false, aheadOfParent: null }) }],
    ['fork with no new commits', {}, { repo: async () => ({ fork: true, hasCommits: true, aheadOfParent: 0 }) }],
    ['earnkit.txt missing', {}, { owner: async () => ({ status: 'missing' }) }],
    ['earnkit.txt lacks the line', {}, { owner: async () => ({ status: 'ok', text: 'payout_wallet: 0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3' }) }],
    ['GitHub down (earnkit.txt read)', {}, { owner: async () => ({ status: 'error', message: "GitHub didn't answer" }) }],
    ['sanctioned wallet', {}, { screen: async () => { throw new Error("This wallet can't receive token fees on EarnKit."); } }],
  ];
  const out: [string, string][] = [];
  for (const [label, i, d] of cases) {
    const r = await tokenGate({ ...input, ...i }, { ...okDeps, ...d });
    if (!r.ok) out.push([`gate reason: ${label}`, r.reason]);
  }
  // Also directly: the "file exists but the line is for a different ticker" branch (same as
  // "earnkit.txt lacks the line" but through a file that parses, to exercise ownerProblem's other arm).
  const mismatched = ownerProblem(
    'github.com/acme/kit',
    { status: 'ok', text: 'token: 1111111111111111' } as FetchResult,
    '0000000000000000',
    null,
  );
  if (mismatched) out.push(['gate reason: earnkit.txt has a different code', mismatched.reason]);
  return out;
}

const builderFacing: [string, string][] = [
  ...coinRows.map((s, i): [string, string] => [`coinRow[${i}]`, s]),
  ...walletLines.map((s, i): [string, string] => [`walletLine[${i}]`, s]),
  ...enteredTexts.map((s, i): [string, string] => [`enteredText[${i}]`, s]),
  ...confirmTables.map((s, i): [string, string] => [`confirmTable[${i}]`, s]),
  ...enteredTables.map((s, i): [string, string] => [`enteredTable[${i}]`, s]),
  ['COIN_FOOTNOTE', COIN_FOOTNOTE],
  ['presentFirstMessage: no repo, no GitHub', noRepoNoGithub],
  ['presentFirstMessage: GitHub user, 0 repos', githubZeroRepos],
  ['presentFirstMessage: with repos', withRepos],
  ['presentFirstMessage: with alerts', withAlerts],
  ['presentFirstMessage: none of your repos fit', noneOfYourReposFit],
  ['sinceLine(alertLinesMoved)', sinceLine(alertLinesMoved)!],
  ['sinceLine(alertLinesDropped)', sinceLine(alertLinesDropped)!],
  ...alertLinesMoved.map((s, i): [string, string] => [`alertLines moved[${i}]`, s]),
  ...alertLinesDropped.map((s, i): [string, string] => [`alertLines dropped[${i}]`, s]),
  ['WALLET_INVALID', WALLET_INVALID],
  ['policy page', policyText],
];

// noCoinYet is the AGENT's note (never shown to the builder as written; see entry-text.ts), so it
// may name launch_token — same bucket as OWNERSHIP_FOR_TOKEN and the tool descriptions.
const agentFacing: [string, string][] = [
  ['OWNERSHIP_FOR_TOKEN', OWNERSHIP_FOR_TOKEN],
  ...Object.entries(TOOL_DESCRIPTIONS).map(([name, d]): [string, string] => [`TOOL_DESCRIPTIONS.${name}`, d]),
  ...noCoinYets.map((s, i): [string, string] => [`noCoinYet[${i}]`, s]),
];

// Tool names, derived from the registered tools themselves (I2), not a hard-coded list.
const TOOL_NAMES = Object.keys(tools);
const toolNameRe = new RegExp(`\\b(${TOOL_NAMES.join('|')})\\b`);
const editFileRe = /\b(add|edit|create) (a |the )?file\b|\bpush it\b/i;

test('v2.6 §3 copy review: no emojis anywhere', async () => {
  const all = [...builderFacing, ...agentFacing, ...(await gatherGateReasons())];
  for (const [label, text] of all) assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, label);
});

test('v2.6 §3 copy review: never "vault"', async () => {
  const all = [...builderFacing, ...agentFacing, ...(await gatherGateReasons())];
  for (const [label, text] of all) assert.doesNotMatch(text, /vault/i, label);
});

test('v2.6 §3 copy review: builder-facing text never names a tool (derived from the registered tools)', async () => {
  const gateReasons = await gatherGateReasons();
  for (const [label, text] of [...builderFacing, ...gateReasons]) assert.doesNotMatch(text, toolNameRe, label);
});

test('v2.6 §3 copy review (I2): the builder-facing gate reasons never ask the builder to add/edit/push a file themselves', async () => {
  const gateReasons = await gatherGateReasons();
  assert.ok(gateReasons.length >= 8, `expected several gate-reason branches, got ${gateReasons.length}`);
  for (const [label, text] of [...builderFacing, ...gateReasons]) assert.doesNotMatch(text, editFileRe, label);
});

test('v2.6 §3 copy review (I2): every scanned string is non-empty (never a vacuous pass)', async () => {
  const all = [...builderFacing, ...agentFacing, ...(await gatherGateReasons())];
  assert.ok(all.length > 30, `expected a wide scan, got ${all.length} strings`);
  for (const [label, text] of all) assert.ok(text.trim().length > 0, label);
});

test('v2.6 §3 copy review: "You could" shows only with no repo and no GitHub user', () => {
  assert.match(noRepoNoGithub, /You could/);
  assert.doesNotMatch(githubZeroRepos, /You could/i);
  assert.doesNotMatch(withRepos, /You could/i);
  // withAlerts reuses the same no-repo shape as noRepoNoGithub (only alerts differ), so it is not
  // part of this exclusivity check; it is in the scan above for its own (alert) copy.
});

test('v2.6 §3 copy review: the with-repo hook keeps "qualify"', () => {
  assert.match(withRepos, /you qualify for/);
});

// ---- Ruling 31: every launch_token note is plain builder text. launchToken runs over an in-memory
// store through every branch it can end in; `note` must never name a tool, field or file (the
// agent's instructions live in agent_note).
async function gatherLaunchNotes(): Promise<[string, TokenOutcome][]> {
  const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
  const REPO = 'https://github.com/acme/kit';
  const run = async (
    label: string,
    p: Partial<FlowProject> = {},
    input: Record<string, unknown> = {},
    extra: Partial<TokenFlowDeps> = {},
    gate: Partial<GateDeps> = {},
    repoToken: string | null = null,
  ): Promise<[string, TokenOutcome]> => {
    const project: FlowProject = {
      id: 7, name: 'Chain Kits', repo_url: REPO, live_url: 'https://kit.acme.dev', payout_wallet: null,
      creator_wallet: null, token_url: null, token_name: 'Chain Kits', token_symbol: 'CHAIN', installation_id: 1,
      token_policy: 'encouraged', ...p,
    };
    const deps: TokenFlowDeps = {
      available: () => true,
      limit: async () => {},
      check: async () => true,
      gate: {
        repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
        owner: async () => ({ status: 'ok', text: tokenLineFor(1, REPO)! }),
        screen: async () => {},
        ...gate,
      },
      deploy: async (a) => ({ status: 'launched', name: a.name, symbol: a.symbol, tokens_fun: 'https://tokens.fun/coin/0xT' }),
      store: {
        load: async () => project,
        setStatus: async () => {},
        repoToken: async () => repoToken,
        updateLinks: async () => {},
        saveCreatorWallet: async () => {},
      },
      ...extra,
    };
    const out = await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: W, ...input } as never, 1, deps);
    return [`launch note: ${label}`, out];
  };
  const deployed = (o: TokenOutcome) => ({ deploy: async () => o });
  return Promise.all([
    run('launched'),
    run('launched on another chain, bonus program', { has_bonus: true }, { chain: 'robinhood' }),
    run('no wallet', {}, { creator_wallet: undefined }),
    run('policy off', { token_policy: 'off' }),
    run('existing token', { token_url: 'https://tokens.fun/coin/0x1' }),
    run('launch pending', { token_url: 'pending' }),
    run('refused ticker', {}, { symbol: 'USDC' }),
    run('bad ticker shape', {}, { symbol: 'K-1' }),
    run('brand name', {}, { name: 'Coinbase Kit' }),
    run('no proposal', { token_name: null, token_symbol: null, name: '' }),
    run('campaign repo change', { payout_wallet: W }, { repo_url: 'https://github.com/acme/other' }),
    run('recorded repo change', {}, { repo_url: 'https://github.com/acme/other' }),
    run('bad live link', {}, { live_url: 'ftp://x.dev' }),
    run('bad repo link', { repo_url: null }, { repo_url: 'http://github.com/acme/kit' }),
    run('bad X handle', {}, { builder_x: 'not a handle!' }),
    run('bad image', {}, { image_data: 'data:text/plain;base64,aGk=' }),
    run('repo has a token', {}, {}, {}, {}, 'https://tokens.fun/coin/0x2'),
    run('repo launch pending', {}, {}, {}, {}, 'pending'),
    run('gate: proof line missing', {}, {}, {}, { owner: async () => ({ status: 'missing' }) }),
    run('gate: proof line unreadable', {}, {}, {}, { owner: async () => ({ status: 'error', message: 'GitHub said 502' }) }),
    run('gate: no commits', {}, {}, {}, { repo: async () => ({ fork: false, hasCommits: false, aheadOfParent: null }) }),
    run('gate: no repo', { repo_url: null }),
    run('daily limit', {}, {}, { limit: async () => { throw new RateLimitError('This agent has launched 3 tokens today, the daily limit.', 60); } }),
    run('launches off', {}, {}, { available: () => false }),
    run('deploy: not this agent', {}, {}, { deploy: async () => { throw new LaunchError('No project 7 recorded by you. Call record_submission first.'); } }),
    run('deploy: links changed', {}, {}, deployed({ status: 'failed', note: LINKS_CHANGED })),
    run('deploy: state changed', {}, {}, deployed({ status: 'failed', note: STATE_CHANGED })),
    run('deploy: repo claimed meanwhile', {}, {}, deployed({ status: 'failed', note: repoHasTokenNote('pending') })),
    run('deploy: unavailable', {}, {}, deployed({ status: 'skipped', note: TOKENS_UNAVAILABLE })),
  ]);
}

test('Ruling 31: every launch_token note is plain builder text; technical detail only in agent_note', async () => {
  const notes = await gatherLaunchNotes();
  assert.ok(notes.length >= 25, `expected a wide scan, got ${notes.length}`);
  const fieldPrefix = /^(name|symbol|token|creator_wallet|repo_url|live_url|image_data|builder_x):/;
  for (const [label, out] of notes) {
    const note = out.note ?? '';
    if (out.status !== 'launched') assert.ok(note.trim().length > 0, `${label}: has a note`);
    assert.doesNotMatch(note, TECHNICAL_TERMS, label);
    assert.doesNotMatch(note, toolNameRe, label);
    assert.doesNotMatch(note, fieldPrefix, label);
    assert.doesNotMatch(note, editFileRe, label);
    assert.doesNotMatch(note, /\p{Extended_Pictographic}|vault/iu, label);
  }
  // The instructions are not lost: the no-wallet and proof-line cases carry them for the agent.
  const byLabel = new Map(notes);
  assert.match(byLabel.get('launch note: no wallet')!.agent_note ?? '', /launch_token with creator_wallet/);
  assert.match(byLabel.get('launch note: gate: proof line missing')!.agent_note ?? '', /earnkit\.txt/);
  assert.match(byLabel.get('launch note: recorded repo change')!.agent_note ?? '', /^repo_url:/);
});
