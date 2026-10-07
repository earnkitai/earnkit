import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  notReadyTokenNote,
  walletLine,
} from './entry-text';
import { OWNERSHIP_FOR_TOKEN, SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS, serverInstructions, toolDescriptions } from './mcp';
import { bonusClose, presentFirstMessage, type Card, type FirstMessage } from './present';
import { COACH_NOTES, tools } from './tools';
import { DEFAULT_GUIDANCE, coachIntro, draftTable, fixesLine, preSubmitCheck, questionsFor } from './coach';
import type { SubmissionRequirement } from './program-file';
import { ownerProblem, tokenGate, tokenLineFor, type GateDeps, type GateInput } from './token-gate';
import {
  CANT_PUSH,
  NEEDS_REPO,
  NO_TOKEN_HERE,
  NO_WALLET_HINT,
  READY_TO_SUBMIT,
  SKIP_LINE,
  TOKEN_ERROR_CONFIRM,
  bonusCountsIn,
  walletQuestion,
  confirmOffer,
  offerWalletLine,
} from './confirm';
import { AGENT_FILL_STEPS, kitAgentNote, submitKit, type KitProgram } from './submit-kit';
import {
  confirmToken,
  decideToken,
  launchToken,
  NEEDS_SYMBOL_AGENT,
  NO_WALLET_AGENT,
  SKIPPED_ENTRY,
  TECHNICAL_TERMS,
  notReadyAgentNote,
  type FlowProject,
  type TokenFlowDeps,
} from './token-launch';
import { LINKS_CHANGED, STATE_CHANGED, LaunchError, repoHasTokenNote, TOKENS_UNAVAILABLE, type TokenOutcome } from './tokens';
import { RateLimitError } from './rate-limit';
import { openRows, type OpenEntry } from './bonus-board';
import { STATS_LABELS } from './stats';
import {
  CAPPED_READ_SUFFIX,
  ENTRIES_HEADING,
  LEADERBOARD_HEADING,
  NO_ENTRIES_TEXT,
  NO_MINIMUM_TEXT,
  OFF_PLAN_HEADING,
  PRIZE_WALLET_PREFIX,
  PRIZE_WALLET_UNSET,
  REVIEW_FOOTNOTE,
  REVIEW_HEADING_PAID,
  REVIEW_HEADING_PAYING,
  REVIEW_HEADING_REVIEW,
  campaignEyebrow,
  closesText,
  earnkitCampaignBlurb,
  fundsHoldsSuffix,
  offPlanLine,
  removedLine,
  reviewUntilText,
  sponsorDisclosureParts,
} from './campaign-page-text';
import type { FetchResult } from './ownership';
import type { Verdict } from './match';
import PolicyPage from '../../app/policy/page';
import BoardView from '../../app/bonus/[round]/BoardView';
import type { Board } from './bonus-board';
import HomeView from '../../app/HomeView';
import GuideView, { Unavailable } from '../../app/programs/[id]/GuideView';
import ProgramCards from '../../app/components/sections/ProgramCards';
import { closedGuide, emptyGuide, fullGuide, predecessorGuide } from './fixtures/guide';
import { homeFixture } from './fixtures/landing';
import Header from '../../app/components/common/Header';
import AddToAgent from '../../app/components/sections/AddToAgent';
import { HERO_EYEBROW, HERO_SUBTITLE, HERO_TITLE } from '../../app/components/sections/Hero';
import { HOW_TITLE, STEPS } from '../../app/components/sections/HowItWorks';
import { statsLine } from './landing';
import { bonusPillLabel } from '../../app/components/ui/BonusPill';
import { eachLine, poolLine, poolTotalText } from './pool';

/**
 * v2.7 §4, Ruling 19 (plan): "coin" as a word in human-facing text, ignoring identifiers and URLs.
 */
export function coinWords(text: string): string[] {
  const stripped = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)+\/\S*/g, ' ') // host paths: tokens.fun/coin/0x…, earnkit.com/…
    .replace(/\b\w*_\w*\b/g, ' ') // snake_case: coin_address, coins_launched
    .replace(/\b[a-z]+[A-Z]\w*\b/g, ' '); // camelCase: coinRow
  return stripped.match(/\bcoins?\b/gi) ?? [];
}

test('coinWords: identifiers, URLs and stablecoin are exempt', () => {
  assert.deepEqual(coinWords('Your coin: tokens.fun/coin/0xabc'), ['coin']);
  assert.deepEqual(coinWords('coin_address coinRow https://tokens.fun/coin/0x1 Stablecoin payments Coinbase'), []);
  assert.deepEqual(coinWords('Coins launched'), ['Coins']);
});

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
  // v2.8 Ruling 24 (plan): the hook uses the matched programs' pools.
  msg({ cards: [{ ...base, pool_usd: 10000 }], repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [v('base-builder-grants', 'likely', 'looks eligible')] }] } }),
);
const withAlerts = presentFirstMessage(msg({ alerts: alertLinesMoved, cards: [arc] }));
const noneOfYourReposFit = presentFirstMessage(
  msg({ cards: [base], repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [v('base-builder-grants', 'no', 'not on Base')] }] } }),
);

// ---- coinRow, walletLine, enteredText, noCoinYet: every branch.
const coinRows = [
  coinRow({ symbol: 'TIPJAR', hasBonus: true }),
  coinRow({ symbol: 'GOX', hasBonus: true }),
  coinRow({ symbol: 'TIPJAR', hasBonus: false }),
  coinRow({ symbol: 'ENTRY', hasBonus: false }),
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
  // C7: a token waiting on missing items.
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'other', needs: 'a live link on Arc mainnet' }, bonus: null }),
  enteredText({ programTitle: 'Arc Microgrants', coin: { status: 'other', needs: 'a live link on Arc mainnet' }, bonus: round }),
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
    payoutWallet: null, token: { symbol: 'TIPJAR', hasBonus: true },
  }),
  // v2.7 Ruling 15 (plan): not ready; what's missing leads, no token row or wallet.
  confirmTable({
    project: 'Tip Jar', programTitle: 'Arc Microgrants', campaign: null, prize: '500 USDC × 20 grants', endsAt: null,
    payoutWallet: null, missing: ['Live deployment on Arc mainnet'], token: { symbol: 'TIPJAR', wallet: BONUS_WALLET, hasBonus: true },
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
  .split('<footer')[0]
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

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

// ---- v2.7 §4 fix round 1 (Important #1): every agent_note string, scanned separately from the
// builder-facing reasons above — agent_note legitimately names tools and files (it's for the
// coding agent, never shown to the builder as written), so it must never enter the "never names a
// tool" / "never asks to edit a file" checks, only the coin/Clanker/emoji/vault/affiliation ones.
async function gatherGateAgentNotes(): Promise<[string, string][]> {
  const REPO = 'https://github.com/acme/kit';
  const input: GateInput = { policy: 'encouraged', repoUrl: REPO, wallet: '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3', symbol: 'KIT', installationId: 1 };
  const okDeps: Required<GateDeps> = {
    repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
    owner: async () => ({ status: 'ok', text: 'token: 0000000000000000' }),
    screen: async () => {},
  };
  const cases: [string, Partial<GateInput>, Partial<GateDeps>][] = [
    ['earnkit.txt missing', {}, { owner: async () => ({ status: 'missing' }) }],
    ['earnkit.txt lacks the line', {}, { owner: async () => ({ status: 'ok', text: 'payout_wallet: 0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3' }) }],
    ['GitHub down (earnkit.txt read)', {}, { owner: async () => ({ status: 'error', message: "GitHub didn't answer" }) }],
  ];
  const out: [string, string][] = [];
  for (const [label, i, d] of cases) {
    const r = await tokenGate({ ...input, ...i }, { ...okDeps, ...d });
    if (!r.ok && r.agent_note) out.push([`gate agent_note: ${label}`, r.agent_note]);
  }
  const mismatched = ownerProblem(
    'github.com/acme/kit',
    { status: 'ok', text: 'token: 1111111111111111' } as FetchResult,
    '0000000000000000',
    null,
  );
  if (mismatched?.agent_note) out.push(['gate agent_note: earnkit.txt has a different code', mismatched.agent_note]);
  return out;
}

// ---- v2.7 §4 fix round 1 (Important #1): decideToken's agent_note branches, plus the two named
// constants (NO_WALLET_AGENT, NEEDS_SYMBOL_AGENT) directly, since those are also exported for reuse.
function gatherDecideTokenAgentNotes(): [string, string][] {
  const base = {
    policy: 'encouraged' as const,
    choice: undefined as 'skip' | { name?: string; symbol?: string } | undefined,
    confirmed: true,
    existingTokenUrl: null as string | null,
    proposal: { name: 'Chain Kits', symbol: 'CKIT' } as { name?: string | null; symbol?: string | null } | null,
    wallet: '0xW' as string | null,
  };
  const cases: [string, Partial<typeof base> & { needsSymbol?: boolean }][] = [
    ['skip', { choice: 'skip' }],
    ['not confirmed', { confirmed: false }],
    ['needs symbol', { needsSymbol: true, choice: {} }],
    ['bad ticker edit', { choice: { symbol: 'USDC' } }],
    ['CLANKER ticker edit', { choice: { symbol: 'CLANKER' } }],
    ['bad name edit', { choice: { name: 'Coinbase Kit' } }],
    ['no proposal, no edits', { proposal: null, choice: undefined }],
    ['no wallet', { wallet: null }],
  ];
  const out: [string, string][] = [];
  for (const [label, overrides] of cases) {
    const d = decideToken({ ...base, ...overrides });
    if ('agent_note' in d && d.agent_note) out.push([`decideToken agent_note: ${label}`, d.agent_note]);
  }
  return out;
}

// ---- v2.7 T6/T7 carry: bonus-board rows (with a no-token entry) and the two /bonus/<round> board
// renders (open and paid), the same fixtures public-pages.test.ts verifies.
const openEntryBase = (id: number, o: Partial<OpenEntry> = {}): OpenEntry => ({
  id, name: `P${id}`, repo_url: `https://github.com/a/p${id}`, live_url: null, coin: true, proof: true, pattern: true,
  complete: true, skipped: false, eligible: true, test: false, rank: null, score: null, submitted_at: new Date('2026-10-01T00:00:00Z'), ...o,
});
const openEntryRows = openRows([
  openEntryBase(1),
  openEntryBase(2, { coin: false, eligible: false }),
  // v2.8 Rulings 2-3 (plan): an incomplete entry, and one entered with "skip".
  openEntryBase(3, { complete: false, eligible: false }),
  openEntryBase(4, { skipped: true, eligible: false }),
]);

const boardFixture = (o: Partial<Board> = {}): Board => ({
  round: 'base-builder-grants:2026-10',
  title: 'Base Builder Grants',
  state: 'open',
  ends_at: new Date('2026-11-01T00:00:00Z'),
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
// Cut at the shared Footer, same as the policy page above: this scan is for the board's own
// copy, not every page's site-wide footer (its "©" is Extended_Pictographic, not an emoji we add).
const boardText = (b: Board) =>
  renderToStaticMarkup(React.createElement(BoardView, { board: b }))
    .split('<footer')[0]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const openBoardText = boardText(boardFixture());
const paidBoardText = boardText(boardFixture({ state: 'paid', review_until: null }));

// ---- v2.7 §1: the homepage, with its live parts and without them (a failed read). Cut at the
// shared Footer like the pages above (its "©" is Extended_Pictographic, not an emoji we add).
const pageText = (el: React.ReactElement) =>
  renderToStaticMarkup(el)
    .split('<footer')[0]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const homeText = (landing: typeof homeFixture | null) => pageText(React.createElement(HomeView, { landing }));
// v2.7 §2: the guide page (full, predecessor round, empty, closed), its unavailable panel and the
// /programs cards.
const guideTexts: [string, string][] = [
  ['guide page (predecessor)', pageText(React.createElement(GuideView, { page: predecessorGuide }))],
  ['guide page (full)', pageText(React.createElement(GuideView, { page: fullGuide }))],
  ['guide page (empty)', pageText(React.createElement(GuideView, { page: emptyGuide }))],
  ['guide page (closed)', pageText(React.createElement(GuideView, { page: closedGuide }))],
  ['guide page (unavailable)', pageText(React.createElement(Unavailable, { text: 'This guide is unavailable right now. Try again in a few minutes.' }))],
  ['/programs', pageText(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1' }))],
  ['/programs (unavailable)', pageText(React.createElement(Unavailable, { text: 'Programs are unavailable right now.' }))],
];

// ---- v2.7.1: the simpler landing and the builder bonus, front and center: every new string.
const bonusCard = (wei: bigint | null): Card => ({
  id: 'p', title: 'P', summary: 's', tag: null, each_time: [], builder_bonus: true, bonus_pool_wei: wei,
});
const v271Texts: [string, string][] = [
  ['header', pageText(React.createElement(Header))],
  ['install modal', pageText(React.createElement(AddToAgent, { onClose: () => {} }))],
  ['/programs (figure)', pageText(React.createElement(ProgramCards, { tiles: homeFixture.tiles, heading: 'h1', figure: homeFixture.open_text }))],
  ['home page (no stats)', homeText({ ...homeFixture, stats_line: null })],
  ['eachLine range', eachLine({ title: 'Circle Developer Grants', reward: 'from $5,000 to $100,000', max_award_usd: 100000, min_award_usd: 5000 })!],
  ['eachLine USDC', eachLine({ title: 'Arc Microgrants', reward: '500 USDC per microgrant', max_award_usd: 500, min_award_usd: null })!],
  ['eachLine grant', eachLine({ title: 'Base Builder Grant Program', reward: 'Up to $5,000 in grants', max_award_usd: 5000, min_award_usd: null })!],
  ['eachLine winner', eachLine({ title: 'Hackathon', reward: '$30,000 grand prize', max_award_usd: 30000, min_award_usd: null })!],
  ['statsLine', statsLine({ open_money_usd: 0, open_pools_usd: 0, open_pools_plus: false, programs_open: 5, bonus_programs_open: 4, coins_launched: 3, fees_to_safe_eth: 0, bonus_paid_eth: 0.42, bonus_pools_eth: 1, installs: 312 })!],
  ['bonusPillLabel', bonusPillLabel()],
  ['bonusPillLabel amount', bonusPillLabel('0.42 ETH')],
  ['bonusPillLabel tiny', bonusPillLabel('<0.01 ETH')],
  ['poolLine prizes', poolLine(250000, { plus: true, usdc: false }, 'Monad Metropolis Hackathon')],
  ['poolLine grants', poolLine(200000, { plus: false, usdc: false }, 'Circle Developer Grants')],
  ['poolLine USDC', poolLine(10000, { plus: false, usdc: true }, 'Arc Microgrants')],
  ['poolTotalText', `${poolTotalText([{ pool_usd: 1_300_000, plus: true }])} open right now`],
  ['bonusClose (pooled)', bonusClose([bonusCard(6n * 10n ** 17n)])!],
  ['bonusClose (empty)', bonusClose([bonusCard(null)])!],
  ['bonusClose (others)', bonusClose([bonusCard(6n * 10n ** 17n)], true)!],
  ['bonusClose (no bonus)', bonusClose([{ ...bonusCard(null), builder_bonus: false }])!],
];

// ---- v2.7 §4 fix round 1 (Important #2): app/campaigns/[slug]/page.tsx's own human-facing text,
// via the pure helpers it renders through (campaign-page-text.ts) — a sponsor campaign and a
// non-sponsor (EarnKit) campaign, since the page's copy differs by kind.
const sponsorDisclosureVerified = sponsorDisclosureParts('Acme Co', { verified: true, host: 'acme.com' }, 'most real users');
const sponsorDisclosureUnverified = sponsorDisclosureParts('Acme Co', { verified: false, host: null }, 'most real users');
const campaignPageTexts: [string, string][] = [
  ['campaign page: eyebrow (sponsor)', campaignEyebrow(true, 'Acme Co · builder campaign')],
  ['campaign page: eyebrow (earnkit)', campaignEyebrow(false, '')],
  ['campaign page: closes', closesText(false, 'Oct 21')],
  ['campaign page: closed', closesText(true, 'Oct 21')],
  ['campaign page: sponsor disclosure prefix (verified)', sponsorDisclosureVerified.prefix],
  ['campaign page: sponsor disclosure suffix (verified)', sponsorDisclosureVerified.suffix],
  ['campaign page: sponsor disclosure prefix (unverified)', sponsorDisclosureUnverified.prefix],
  ['campaign page: sponsor disclosure suffix (unverified)', sponsorDisclosureUnverified.suffix],
  ['campaign page: earnkit blurb', earnkitCampaignBlurb('$100', 5, 'Oct 21', 10)],
  ['campaign page: prize wallet prefix', PRIZE_WALLET_PREFIX],
  ['campaign page: prize wallet unset', PRIZE_WALLET_UNSET],
  ['campaign page: funds holds suffix', fundsHoldsSuffix('1234.5', 'MINI')],
  ['campaign page: leaderboard heading', LEADERBOARD_HEADING],
  ['campaign page: entries heading', ENTRIES_HEADING],
  ['campaign page: no entries', NO_ENTRIES_TEXT],
  ['campaign page: off-plan heading', OFF_PLAN_HEADING],
  ['campaign page: off-plan line', offPlanLine('0xabc', '10', 'MINI')],
  ['campaign page: review heading (review)', REVIEW_HEADING_REVIEW],
  ['campaign page: review heading (paid)', REVIEW_HEADING_PAID],
  ['campaign page: review heading (paying)', REVIEW_HEADING_PAYING],
  ['campaign page: review until', reviewUntilText('Oct 20')],
  ['campaign page: no minimum', NO_MINIMUM_TEXT],
  ['campaign page: review footnote', REVIEW_FOOTNOTE],
  ['campaign page: capped read suffix', CAPPED_READ_SUFFIX],
  ['campaign page: removed line', removedLine('Tipjar', 'wash trading')],
];

// v2.8 Task 8: every confirmation offer variant, and the kit's builder text.
const OFFER_WALLET = '0xAb12000000000000000000000000000000000123';
const offerBase = { hasBonus: true, coinIn: null, canPush: true, wallet: OFFER_WALLET, remembered: true };
const confirmTexts: [string, string][] = [
  ['confirmOffer: remembered wallet', confirmOffer(offerBase)],
  ['confirmOffer: given wallet', confirmOffer({ ...offerBase, remembered: false })],
  ['confirmOffer: no wallet', confirmOffer({ ...offerBase, wallet: null, remembered: false })],
  ['confirmOffer: no bonus', confirmOffer({ ...offerBase, hasBonus: false })],
  ['confirmOffer: no bonus, no wallet', confirmOffer({ ...offerBase, hasBonus: false, wallet: null, remembered: false })],
  ['confirmOffer: token elsewhere', confirmOffer({ ...offerBase, coinIn: 'Arc Microgrants' })],
  ["confirmOffer: can't push", confirmOffer({ ...offerBase, canPush: false })],
  ['confirmOffer: tokens off', confirmOffer({ ...offerBase, tokensOff: true })],
  ['offerWalletLine: remembered', offerWalletLine({ wallet: OFFER_WALLET, remembered: true, hasBonus: true })],
  ['NO_WALLET_HINT', NO_WALLET_HINT],
  ['CANT_PUSH', CANT_PUSH],
  ['SKIP_LINE', SKIP_LINE],
  ['READY_TO_SUBMIT', READY_TO_SUBMIT],
  ['NEEDS_REPO', NEEDS_REPO],
  ['NO_TOKEN_HERE', NO_TOKEN_HERE],
  ['bonusCountsIn', bonusCountsIn('Arc Microgrants')],
  ['walletQuestion', walletQuestion(OFFER_WALLET, true)],
  ['walletQuestion: no bonus', walletQuestion(OFFER_WALLET, false)],
  ['TOKEN_ERROR_CONFIRM', TOKEN_ERROR_CONFIRM],
  [
    'submitKit: missing answers (C9)',
    submitKit(
      { title: 'Arc Microgrants', submission_url: 'https://dorahacks.io/x', submission_requirements: [
        { key: 'repo_url', label: 'Public repo', type: 'url', required: true, from: 'project' },
        { key: 'x_handle', label: 'X handle', type: 'text', required: true, from: 'builder' },
      ] },
      { repo_url: 'https://github.com/alice/tipjar' },
      { browser: false },
    ).show_to_builder,
  ],
  [
    'submitKit: copy_paste (entry link)',
    submitKit(
      {
        title: 'Arc Microgrants',
        submission_url: 'https://dorahacks.io/hackathon/arc-microgrants',
        submission_requirements: [
          { key: 'repo_url', label: 'Public repo', type: 'url', required: true, from: 'project' },
          { key: 'description', label: 'Short description', type: 'text', required: true, from: 'project' },
        ],
      },
      { repo_url: 'https://github.com/alice/tipjar', description: 'Tips for creators' },
      { browser: false },
    ).show_to_builder,
  ],
  [
    'submitKit: copy_paste (confirmation)',
    submitKit(
      { title: 'Base Builder Grants', submission_url: 'https://forms.gle/abc', submission_requirements: [{ key: 'email', label: 'Email', type: 'email', required: true, from: 'builder' }] },
      { email: 'a@b.co' },
      { browser: false },
    ).show_to_builder,
  ],
];

// v2.8 Task 10: the kit's builder text in every mode, and the agent's notes and steps.
const kitReqs: SubmissionRequirement[] = [
  { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project' },
  { key: 'repo_url', label: 'Public repo', type: 'url', required: true, from: 'project' },
  { key: 'description', label: 'Short description', type: 'text', required: true, from: 'project' },
  { key: 'logo', label: 'Logo', type: 'file', required: false, from: 'builder' },
];
const kitAnswers = { project_name: 'Tip Jar', repo_url: 'https://github.com/alice/tipjar', description: 'Tips for creators', logo: 'logo.png' };
const kitProgram = (title: string, submission_url: string, extra: Partial<KitProgram> = {}): KitProgram => ({ title, submission_url, submission_requirements: kitReqs, ...extra });
const kitPrograms: [string, KitProgram, boolean][] = [
  ['prefilled_link', kitProgram('Base Builder Grants', 'https://forms.gle/abc', { form: { url: 'https://docs.google.com/forms/d/e/1FAIpQ/viewform', fields: { project_name: 'entry.1', repo_url: 'entry.2' }, sign_in: false, read_at: '2026-10-07' } }), false],
  ['agent_fills', kitProgram('Colosseum', 'https://colosseum.com/arena'), true],
  ['copy_paste (DoraHacks)', kitProgram('Arc Microgrants', 'https://dorahacks.io/hackathon/arc-microgrants'), true],
  ['copy_paste (no browser)', kitProgram('Monad Metropolis', 'https://hackathon.monad.xyz/'), false],
  ['api', kitProgram('Superteam Bounty', 'https://superteam.fun/earn/listing/x', { submit_api: true }), false],
];
const kitTexts: [string, string][] = kitPrograms.flatMap(([mode, p, browser]): [string, string][] => [
  [`submitKit ${mode}`, submitKit(p, kitAnswers, { browser }).show_to_builder],
  [`submitKit ${mode}, missing`, submitKit(p, { project_name: 'Tip Jar' }, { browser }).show_to_builder],
]);
const kitAgentTexts: [string, string][] = [
  ...AGENT_FILL_STEPS.map((s, i): [string, string] => [`AGENT_FILL_STEPS[${i}]`, s]),
  ...kitPrograms.map(([mode, p, browser]): [string, string] => [`kitAgentNote ${mode}`, kitAgentNote(submitKit(p, kitAnswers, { browser }), p)]),
];

test('Task 10: every kit mode has its own builder text, ending with the proof ask', () => {
  const modes = kitPrograms.map(([, p, browser]) => submitKit(p, kitAnswers, { browser }).mode);
  assert.deepEqual(modes, ['prefilled_link', 'agent_fills', 'copy_paste', 'copy_paste', 'api']);
  for (const [label, text] of kitTexts) assert.match(text, /After you submit, (paste your entry link here|send me the confirmation screenshot or email)\.$/, label);
});

// v2.8 Task 9: the coach's builder text (questions, the draft table, the fixes) from real inputs.
const coachReq = (key: string, kind: SubmissionRequirement['kind'], label: string, o: Partial<SubmissionRequirement> = {}): SubmissionRequirement => ({
  key, label, kind, type: 'text', required: true, from: 'builder', ...o,
});
const coachReqs: SubmissionRequirement[] = [
  coachReq('live', 'links', 'Live deployment on Arc mainnet', { type: 'url', from: 'project' }),
  coachReq('desc', 'solution', 'Short description of what your project does and what it uses Arc for', { from: 'project' }),
  coachReq('traction', 'traction', 'Traction'),
  coachReq('why', 'why_you', 'Why you'),
  coachReq('funds', 'use_of_funds', 'Use of the grant'),
  coachReq('ms', 'milestones', 'Milestones'),
  coachReq('team', 'team', 'Team'),
  coachReq('problem', 'problem', 'Problem'),
  coachReq('full_name', 'contact', 'Full name'),
  coachReq('email', 'contact', 'Email', { type: 'email' }),
  coachReq('x_handle', 'contact', 'X (Twitter) handle'),
];
const coachTexts: [string, string][] = [
  ['coachIntro: 3 questions', coachIntro('Arc Microgrants', questionsFor({ reqs: coachReqs, answers: {}, first: true, project: 'TipJar' }))!],
  ['coachIntro: 1 question', coachIntro('Arc Microgrants', questionsFor({ reqs: coachReqs, answers: {}, first: false, project: 'TipJar' }))!],
  [
    'coachIntro: saved contact details',
    coachIntro('Base Builder Grants', questionsFor({ reqs: coachReqs.slice(8), answers: {}, first: false, suggested: { email: 'a@b.co', x_handle: '@alice' } }))!,
  ],
  ...coachReqs.flatMap((r): [string, string][] =>
    questionsFor({ reqs: [r], answers: {}, first: true }).map((q) => [`question: ${r.kind}`, q.text]),
  ),
  ...Object.entries(DEFAULT_GUIDANCE).flatMap(([k, g]) => g.questions.map((q, i): [string, string] => [`DEFAULT_GUIDANCE.${k}.questions[${i}]`, q])),
  ['draftTable', draftTable(coachReqs, { live: 'https://tipjar.example', desc: 'Tips for creators, paid in USDC on Arc, with one tap and no sign up', traction: 'Loved' })],
  [
    'fixesLine',
    fixesLine(
      preSubmitCheck({
        reqs: coachReqs,
        answers: { desc: 'x '.repeat(70), traction: 'Lots of users love it', why: 'Because', funds: 'More features' },
        judging: null,
      }),
    )!,
  ],
  [
    'fixesLine: link and criterion',
    fixesLine(
      preSubmitCheck({
        reqs: coachReqs.slice(1, 2),
        answers: { desc: 'Tips for 120 creators' },
        judging: {
          criteria: [{ text: 'Technical credibility', fix: { kind: 'solution', needs: 'link', add: 'link the contract on the Arc explorer' } }],
          source_url: 'https://e.example',
        },
      }),
    )!,
  ],
];

const builderFacing: [string, string][] = [
  ...coachTexts,
  ...campaignPageTexts,
  ...confirmTexts,
  ...kitTexts,
  ...coinRows.map((s, i): [string, string] => [`coinRow[${i}]`, s]),
  ...walletLines.map((s, i): [string, string] => [`walletLine[${i}]`, s]),
  ...enteredTexts.map((s, i): [string, string] => [`enteredText[${i}]`, s]),
  ...confirmTables.map((s, i): [string, string] => [`confirmTable[${i}]`, s]),
  ...enteredTables.map((s, i): [string, string] => [`enteredTable[${i}]`, s]),
  ['COIN_FOOTNOTE', COIN_FOOTNOTE],
  ['C7 notReadyTokenNote', notReadyTokenNote(['a live link on Arc mainnet', 'a short description'])],
  ['v2.8 Ruling 3 SKIPPED_ENTRY', SKIPPED_ENTRY],
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
  ...openEntryRows.map((r, i): [string, string] => [`openRows[${i}].note`, r.note]),
  ['/bonus/<round> open', openBoardText],
  ['/bonus/<round> paid', paidBoardText],
  ['home page (live)', homeText(homeFixture)],
  ['home page (read failed)', homeText(null)],
  ...guideTexts,
  ...v271Texts,
  // v2.8 Task 2: the hero and How you earn.
  ['HERO_EYEBROW', HERO_EYEBROW],
  ['HERO_TITLE', HERO_TITLE],
  ['HERO_SUBTITLE', HERO_SUBTITLE],
  ['HOW_TITLE', HOW_TITLE],
  ...STEPS.flatMap((s, i): [string, string][] => [[`STEPS[${i}].title`, s.title], [`STEPS[${i}].body`, s.body]]),
  ...Object.entries(STATS_LABELS).map(([k, v]): [string, string] => [`STATS_LABELS.${k}`, v]),
];

// noCoinYet is the AGENT's note (never shown to the builder as written; see entry-text.ts), so it
// may name launch_token — same bucket as OWNERSHIP_FOR_TOKEN, SERVER_INSTRUCTIONS and the tool descriptions.
const agentFacing: [string, string][] = [
  ['SERVER_INSTRUCTIONS', SERVER_INSTRUCTIONS],
  ['serverInstructions(false)', serverInstructions(false)],
  ['OWNERSHIP_FOR_TOKEN', OWNERSHIP_FOR_TOKEN],
  ...Object.entries(TOOL_DESCRIPTIONS).map(([name, d]): [string, string] => [`TOOL_DESCRIPTIONS.${name}`, d]),
  // v2.8 Ruling 23 (plan): the descriptions while no EarnKit campaign is open.
  ...Object.entries(toolDescriptions(false)).map(([name, d]): [string, string] => [`toolDescriptions(false).${name}`, d]),
  ...noCoinYets.map((s, i): [string, string] => [`noCoinYet[${i}]`, s]),
  // v2.7 §4 fix round 1 (Important #1): every agent_note string, directly and harvested.
  ['NO_WALLET_AGENT', NO_WALLET_AGENT],
  ['NEEDS_SYMBOL_AGENT', NEEDS_SYMBOL_AGENT],
  ['C7 notReadyAgentNote', notReadyAgentNote(['live_deployment_url'])],
  // v2.8 Task 9: the coach's guidance and notes are the agent's.
  ...Object.entries(DEFAULT_GUIDANCE).flatMap(([k, g]): [string, string][] => [[`DEFAULT_GUIDANCE.${k}.judges`, g.judges], [`DEFAULT_GUIDANCE.${k}.pattern`, g.pattern]]),
  ...Object.entries(COACH_NOTES).map(([k, v]): [string, string] => [`COACH_NOTES.${k}`, v]),
  ...gatherDecideTokenAgentNotes(),
  ...kitAgentTexts,
  // v2.7 fix round 1 (Minor 6): llms.txt is what agents read about EarnKit.
  ['llms.txt', readFileSync(join(import.meta.dirname, '../../public/llms.txt'), 'utf8')],
];

// Tool names, derived from the registered tools themselves (I2), not a hard-coded list.
const TOOL_NAMES = Object.keys(tools);
const toolNameRe = new RegExp(`\\b(${TOOL_NAMES.join('|')})\\b`);
const editFileRe = /\b(add|edit|create) (a |the )?file\b|\bpush it\b/i;

test('v2.6 §3 copy review: no emojis anywhere', async () => {
  const all = [...builderFacing, ...agentFacing, ...(await gatherGateReasons()), ...(await gatherGateAgentNotes())];
  for (const [label, text] of all) assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, label);
});

test('v2.6 §3 copy review: never "vault"', async () => {
  const all = [...builderFacing, ...agentFacing, ...(await gatherGateReasons()), ...(await gatherGateAgentNotes())];
  for (const [label, text] of all) assert.doesNotMatch(text, /vault/i, label);
});

test('v2.7 fix round 1 (Important #1): no implied affiliation, except the carved-out negated disclaimer', async () => {
  // TOOL_DESCRIPTIONS.sponsor_campaign is agent-only (M4) and legitimately explains EarnKit's own
  // affiliation-word verification rule for sponsors ("a title that reads as by or official to
  // one"); it never claims an affiliation itself, so it is out of this specific check.
  // SERVER_INSTRUCTIONS is agent-only too, and says EarnKit's listed facts are "checked against
  // official sources" — EarnKit's own verification, not a claim that EarnKit is official to anyone.
  const all = [...builderFacing, ...agentFacing, ...(await gatherGateReasons()), ...(await gatherGateAgentNotes())].filter(
    ([label]) => !label.endsWith('.sponsor_campaign') && label !== 'SERVER_INSTRUCTIONS' && label !== 'serverInstructions(false)',
  );
  // Only the negated disclaimer ("isn't affiliated with or endorsed by", Ruling 14 (plan)) is
  // allowed, on the policy page and the /bonus board pages that carry the same sentence; the
  // carve-out is the exact phrase, so it can't mask a real affiliation claim anywhere else (the
  // first message, entry tables, tool descriptions, gate reasons).
  const carveOut = /isn't affiliated with or endorsed by/gi;
  for (const [label, text] of all) {
    const stripped = text.replace(carveOut, '');
    assert.doesNotMatch(stripped, /\b(partner|official|endorsed by|sponsored by)\b/i, label);
  }
});

test('v2.7 §4: "coin" never appears in human-facing text', async () => {
  const all = [...builderFacing, ...agentFacing, ...(await gatherGateReasons()), ...(await gatherGateAgentNotes())];
  for (const [label, text] of all) assert.deepEqual(coinWords(text), [], label);
});

test('v2.7 §3: never "Clanker" in builder or agent text, or on /policy', async () => {
  const all = [...builderFacing, ...agentFacing, ...(await gatherGateReasons()), ...(await gatherGateAgentNotes())];
  for (const [label, text] of all) assert.doesNotMatch(text, /clanker/i, label);
});

test('v2.7 §3: never "affiliated" in the first message', () => {
  for (const [label, text] of [
    ['presentFirstMessage: no repo, no GitHub', noRepoNoGithub],
    ['presentFirstMessage: GitHub user, 0 repos', githubZeroRepos],
    ['presentFirstMessage: with repos', withRepos],
  ] as [string, string][])
    assert.doesNotMatch(text, /affiliat/i, label);
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
  const all = [...builderFacing, ...agentFacing, ...(await gatherGateReasons()), ...(await gatherGateAgentNotes())];
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
        markComplete: async () => {},
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

// ---- v2.8 Task 8: confirm_entry's token notes. A fixable note is what the builder sees with no
// kit, so it must be plain words and say "go" (the confirmation), never "launch the token"; the agent
// note names confirm_entry, never launch_token.
async function gatherConfirmNotes(): Promise<[string, TokenOutcome][]> {
  const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
  const REPO = 'https://github.com/acme/kit';
  const run = async (
    label: string,
    o: { wallet?: string | null; token?: { name?: string; symbol?: string } } = {},
    extra: Partial<TokenFlowDeps> = {},
    gate: Partial<GateDeps> = {},
    repoToken: string | null = null,
  ): Promise<[string, TokenOutcome]> => {
    const project: FlowProject = {
      id: 8, name: 'Chain Kits', repo_url: REPO, live_url: null, payout_wallet: null, creator_wallet: null, token_url: null,
      token_name: null, token_symbol: null, installation_id: 1, token_policy: 'encouraged', confirm_choice: 'go',
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
        markComplete: async () => {},
      },
      ...extra,
    };
    const out = await confirmToken({ projectId: 8, installationId: 1, wallet: o.wallet === undefined ? W : o.wallet, token: o.token }, deps);
    return [`confirm note: ${label}`, out];
  };
  return Promise.all([
    run('launched'),
    run('no wallet', { wallet: null }),
    run('taken ticker', { token: { symbol: 'TAKEN' } }, { check: async (s: string) => s !== 'TAKEN' }),
    run('refused ticker', { token: { symbol: 'USDC' } }),
    run('bad ticker shape', { token: { symbol: 'K-1' } }),
    run('brand name', { token: { name: 'Coinbase Kit' } }),
    run('gate: proof line missing', {}, {}, { owner: async () => ({ status: 'missing' }) }),
    run('gate: proof line unreadable', {}, {}, { owner: async () => ({ status: 'error', message: 'GitHub said 502' }) }),
    run('gate: repo read failed', {}, {}, { repo: async () => { throw new Error('GitHub said 502'); } }),
    run('gate: private repo', {}, {}, { repo: async () => { throw new Error('not found'); } }),
    run('gate: no commits', {}, {}, { repo: async () => ({ fork: false, hasCommits: false, aheadOfParent: null }) }),
    run('gate: wallet screen', {}, {}, { screen: async () => { throw new Error("This wallet can't receive token fees on EarnKit."); } }),
    run('repo has a token', {}, {}, {}, 'https://tokens.fun/coin/0x2'),
    run('daily limit', {}, { limit: async () => { throw new RateLimitError('This agent has launched 3 tokens today, the daily limit.', 60); } }),
    run('deploy refused', {}, { deploy: async () => ({ status: 'failed', note: 'tokens.fun refused the launch.' }) }),
  ]);
}

test('v2.8 Task 8: confirm notes are plain builder words; fixable ones say "go" and point the agent at confirm_entry', async () => {
  const notes = await gatherConfirmNotes();
  const byLabel = new Map(notes);
  for (const [label, out] of notes) {
    const note = out.note ?? '';
    if (out.status !== 'launched') assert.ok(note.trim().length > 0, `${label}: has a note`);
    assert.doesNotMatch(note, TECHNICAL_TERMS, label);
    assert.doesNotMatch(note, toolNameRe, label);
    assert.doesNotMatch(note, editFileRe, label);
    assert.doesNotMatch(note, /\p{Extended_Pictographic}|vault|clanker|—/iu, label);
    assert.deepEqual(coinWords(note), [], label);
    assert.deepEqual(coinWords(out.agent_note ?? ''), [], label);
    if (out.fixable) {
      assert.doesNotMatch(note, /launch the token/, label);
      assert.doesNotMatch(out.agent_note ?? '', /launch_token/, label);
    }
  }
  const fixable = (l: string) => byLabel.get(`confirm note: ${l}`)!.fixable === true;
  for (const l of ['no wallet', 'taken ticker', 'refused ticker', 'bad ticker shape', 'brand name', 'gate: proof line missing', 'gate: proof line unreadable', 'gate: repo read failed', 'gate: wallet screen'])
    assert.ok(fixable(l), l);
  for (const l of ['launched', 'gate: private repo', 'gate: no commits', 'repo has a token', 'daily limit', 'deploy refused'])
    assert.ok(!fixable(l), l);
  assert.equal(byLabel.get('confirm note: gate: proof line missing')!.note, 'I need to add a short proof line to your repo first, then say go.');
  assert.match(byLabel.get('confirm note: gate: proof line missing')!.agent_note ?? '', /earnkit\.txt.*Then call confirm_entry again\./);
});

test('v2.8 Task 9: the coach screens are short: at most 3 numbered questions and one bullet, 25 words each, at most 3 fixes', () => {
  const intro = coachTexts.find(([l]) => l === 'coachIntro: 3 questions')![1];
  // 3 numbered questions, then at most one folded bullet (C17).
  assert.ok(intro.split('\n').length <= 5);
  assert.equal(intro.split('\n').filter((l) => /^\d\. /.test(l)).length, 3);
  for (const [label, text] of coachTexts.filter(([l]) => l.startsWith('coachIntro')))
    for (const line of text.split('\n').slice(1)) assert.ok(line.split(/\s+/).length - 1 <= 25, `${label}: ${line}`);
  assert.ok(intro.split('\n')[1].startsWith('1. Who has used TipJar so far?'));
  const fixes = coachTexts.find(([l]) => l === 'fixesLine')![1];
  assert.equal(fixes.split('\n').length, 4);
  // C14: every shown fix reads "<Field>: <the exact thing to add>."
  for (const [label, text] of coachTexts.filter(([l]) => l.startsWith('fixesLine')))
    for (const line of text.split('\n').slice(1)) assert.match(line, /^\d\. [^:\n]{1,41}: [a-z][^\n]*\.$/, label);
  for (const [label, text] of coachTexts) assert.doesNotMatch(text, /\u2014/, label);
});
