import './fixtures/no-network-checks';
import {
  EMAIL_NOTE, EMAIL_OFF, EMAIL_ON, EMAIL_QUESTION, EMAIL_SHARED_NOTE, EMAIL_SIGN_IN, EMAIL_UNAVAILABLE, UNSUB_BAD, UNSUB_CONFIRM, UNSUB_DONE, WHICH_EMAIL,
  digestBody, emailQuestionFor,
} from './digest';
import { HOST_FULL, HOST_LINES, HOST_REVIEW, STORAGE_NOTE, UPLOAD_NOTE, hostSignInLine, liveLine, withBadge } from './hosting';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NO_SKIP, alertLines, sinceLine, type AlertFacts, type NewProgram } from './alerts';
import { WALLET_INVALID, type CampaignConfig } from './campaigns';
import {
  confirmTable,
  enteredTable,
  enteredText,
  noCoinYet,
  notReadyTokenNote,
  tokenRow,
} from './entry-text';
import { FILL_LINES, HELD_LINE, MORE_USERS_LINE, SCORE_NOTES, SCORE_SHARED, SITE_LINE, SITE_TXT_LINE, WORKING_LINE, nextAction, programLine, scoreLines, youLine } from './score-tool';
import { computeScore } from './score';
import { calibration } from './score-calibration';
import { CONSENT_LINE, HIDDEN_LINE, NO_PROFILE_LINE, SHARED_PROFILE_NOTE, SHOWN_LINE, X_NOT_LISTED_NOTE, X_SET_LINE, X_TAKEN_NOTE } from './profiles';
import { OWNERSHIP_FOR_TOKEN, SCORE_DESCRIPTION, SERVER_INSTRUCTIONS, TELL_DESCRIPTION, TELL_DESCRIPTION_SCORE, TOOL_DESCRIPTIONS, serverInstructions, toolDescriptions, unexpectedErrorText } from './mcp';
import { bonusLine, presentFirstMessage, skippedLine, submitStepLine, type Card, type FirstMessage } from './present';
import { SKIP_REASONS } from './match-projects';
import { BUILD_ENTRY_NOTE, BUILD_NO_LIVE_NOTE, BUILD_HOLD_NOTE, BUILD_OWNER_NOTE, BUILD_WALLET_NOTE, BUILD_PENDING_NOTE, pagesLiveLine, BUILD_DEPLOYS_OFF_NOTE, BUILD_NOT_READY, BUILD_PAGES_NOTE, BUILD_UPLOAD_NOTE, buildChainNote, buildOwnerNote, buildProofNote, BUILD_NOT_STARTED, BUILD_SHARED_NOTE, KIT_NOTE, WALLET_NEEDED_NOTE, buildRefused, twistNote, BUILD_NOTE, PLAN_NOTE, ASK_OUTCOME_NOTE, COACH_NOTES, NOTED_FOR_NOW, OUTCOME_SAVED_NOTE, CANT_PUSH_SIGN_IN_NOTE, PICKUP_TEXT, SIGN_IN_CODE_NOTE, SIGN_IN_NOTE, SIGN_IN_OR_NOTE, HOST_SIGN_IN_NOTE, TELL_SAVED_NOTE, TELL_SHARED_NOTE, NO_TOKEN_FOR_NOW, CONFIRM_SHARED_NOTE, PROJECT_REOFFER_NOTE, SUBMITTED_AGAIN_NOTE, SUBMITTED_SHARED_NOTE, SCORE_STEP_NOTE, BUILD_ENTRY_NO_TOKEN_NOTE, handlers } from './tools';
import { outcomeQuestion } from './outcomes';
import { DEFAULT_GUIDANCE, PLAIN_FIX, PLAIN_LENGTH_FIX, PLAIN_NOTE, coachIntro, draftTable, fixesLine, preSubmitCheck, questionsFor, walletAsk } from './coach';
import { alsoText } from './also-qualifies';
import type { SubmissionRequirement } from './program-file';
import { SIGN_IN_FIRST, WALLET_CHANGED, ownerProblem, tokenGate, tokenLineFor, type GateDeps, type GateInput } from './token-gate';
import {
  CANT_PUSH,
  NEEDS_REPO,
  NO_TOKEN_HERE,
  NO_WALLET_HINT,
  READY_TO_SUBMIT,
  TOKEN_ERROR_CONFIRM,
  walletQuestion,
  confirmLine,
  confirmOffer,
  proofLineWaiting,
  signInLine,
} from './confirm';
import { CONFIRM_WARNING, VERIFY_PAGE, codeLine, confirmPage } from './github-verify';
import { AGENT_FILL_STEPS, continuesLine, kitReplyNote, submitKit, type KitProgram } from './submit-kit';
import {
  confirmToken,
  decideToken,
  launchToken,
  NEEDS_SYMBOL_AGENT,
  NO_WALLET_AGENT,
  SKIPPED_ENTRY,
  TECHNICAL_TERMS,
  notReadyAgentNote,
  AGENT_LIMITED,
  STILL_CHECKING,
  STILL_CHECKING_LAUNCH,
  WALLET_LIMITED,
  type FlowProject,
  type TokenFlowDeps,
} from './token-launch';
import {
  LAUNCHING,
  LAUNCHING_AGENT,
  LAUNCH_STUCK,
  launchStuckAgent,
  LINKS_CHANGED,
  NOT_LAUNCHED_YET,
  STATE_CHANGED,
  LaunchError,
  repoHasTokenNote,
  TOKENS_UNAVAILABLE,
  walletLimitNote,
  type TokenOutcome,
} from './tokens';
import { RateLimitError } from './rate-limit';
import { openRows, type OpenEntry } from './bonus-board';
import { STATS_LABELS, moneyText, openMoneyUsd, statsFrom, wonLine } from './stats';
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
import { NEEDS_USERS, NO_USERS_YET, BELOW_FLOOR_NOTE, INVESTMENT_NOTE, SIGNAL_WORDS, UNCHECKED_NOTE, matchRepo, productScore, type ProgramFacts, type RepoFacts, type Verdict } from './match';
import { CHAINS } from './chains';
import { LIVE_FAILED_LINE, PLACEHOLDER_LINE, contractMissingLine, contractUncheckedLine } from './placeholder';
import PolicySection from '../../app/terms/sections/PolicySection';
import TermsPage from '../../app/terms/page';
import { ENDED_PAGE, TAKEN_DOWN_PAGE } from '../../../../infra/host-worker/src/route';
import { MINI_LINE } from './policy';
import SponsorTermsSection from '../../app/terms/sections/SponsorTermsSection';
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
import { landingFrom, statsLine } from './landing';
import { bonusPillLabel } from '../../app/components/ui/BonusPill';
import { eachLine, poolLine } from './pool';
import { STARTERS } from './starters';
import { BUILD_CHAT_ONLY, buildCheck, buildKit, buildingLine, contextLine, freshLeadLine, freshPick, twistQuestion } from './fresh-build';
import { TESTED_STARTERS, fileCards, withFreshBuild } from './fixtures/fresh-build';

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
/** v2.10 item 6: a scored product with good odds (fits without a product read as low odds). */
const GOOD_ODDS = { score: 6, tier: 'product' as const, missing: [], traction: 8, odds: 'good' as const, low_reason: null };
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
  // v2.10 item 2: the v2.9 tables are behind "show more"; the short replies are swept below too.
  more: true,
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
  newPrograms: [],
  fitRepos: [],
  skip: NO_SKIP,
  outcomeWins: [],
  entries: [],
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
  msg({ cards: [{ ...base, pool_usd: 10000 }], repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [v('base-builder-grants', 'likely', 'looks eligible')], product: GOOD_ODDS }] } }),
);
const withAlerts = presentFirstMessage(msg({ alerts: alertLinesMoved, cards: [arc] }));
const noneOfYourReposFit = presentFirstMessage(
  msg({ cards: [base], repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [v('base-builder-grants', 'no', 'not on Base')] }] } }),
);
/** v2.10 item 2: the short first replies (one lead line): a fit, no fit, no repo. */
const shortReplies: [string, string][] = [
  ['presentFirstMessage short: a fit', presentFirstMessage(msg({ more: false, cards: [{ ...base, chains: ['base'] }], repos: { checked: 1, fits: [{ repo: 'tipjar', repo_url: null, verdicts: [v('base-builder-grants', 'likely', '')], product: GOOD_ODDS }] } }))],
  ['presentFirstMessage short: no fit', presentFirstMessage(msg({ more: false, cards: [base], repos: { checked: 1, fits: [] } }))],
  ['presentFirstMessage short: no repo', presentFirstMessage(msg({ more: false, cards: [arc] }))],
];

// ---- tokenRow, enteredText, noCoinYet: every branch.
const tokenRows = [tokenRow('TIPJAR', true), tokenRow('TIPJAR', false, null, 'Tip Jar'), tokenRow('TIPJAR', true, 'Arc Microgrants')];
const round = { line: bonusLine({ wei: 18n * 10n ** 16n, tokens: 3 })! };
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
// line actually appear; and the campaign enteredTable.
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

// ---- The policy (I2), /terms#policy since v2.9 F22, and the sponsor terms: rendered to text the
// same way public-pages.test.ts verifies it. The risk disclosure (Tokenfi Inc.'s legal text for
// tokens.fun and Minidev) is not EarnKit builder copy and is not scanned.
const policyHtml = renderToStaticMarkup(React.createElement(PolicySection)) + renderToStaticMarkup(React.createElement(SponsorTermsSection));
const policyText = policyHtml
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
    verified: async () => null,
  shared: async () => false,
    // v2.10 item 7b: no App reads.
    appToken: async () => null,
    appLink: async () => null,
    repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
    owner: async () => ({ status: 'ok', text: 'token: 0000000000000000' }),
    latest: async () => null,
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
    verified: async () => null,
  shared: async () => false,
    // v2.10 item 7b: no App reads.
    appToken: async () => null,
    appLink: async () => null,
    repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
    owner: async () => ({ status: 'ok', text: 'token: 0000000000000000' }),
    latest: async () => null,
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
  ['statsLine', statsLine({ open_money_usd: 0, open_money_text: null, open_pools_usd: 0, open_pools_plus: false, programs_open: 5, bonus_programs_open: 4, coins_launched: 3, fees_to_safe_eth: 0, bonus_paid_eth: 0.42, bonus_pools_eth: 1, installs: 312, labelled_entries: 0, entries_won: 0, builders_won_usd: 0 })!],
  ['bonusPillLabel', bonusPillLabel()],
  ['bonusPillLabel amount', bonusPillLabel('0.42 ETH')],
  ['bonusPillLabel tiny', bonusPillLabel('<0.01 ETH')],
  ['poolLine prizes', poolLine(250000, { plus: true, usdc: false }, 'Monad Metropolis Hackathon')],
  ['poolLine grants', poolLine(200000, { plus: false, usdc: false }, 'Circle Developer Grants')],
  ['poolLine USDC', poolLine(10000, { plus: false, usdc: true }, 'Arc Microgrants')],
  ['moneyText', `${moneyText(1_170_500)} open right now`],
  ['bonusLine (pooled)', bonusLine({ wei: 6n * 10n ** 17n, tokens: 2 })!],
  ['bonusLine (first)', bonusLine({ wei: 0n, tokens: 0 })!],
  ['bonusLine (tiny)', bonusLine({ wei: 10n ** 15n, tokens: 1 })!],
  ['presentFirstMessage (pooled)', presentFirstMessage(msg({ cards: [{ ...bonusCard(6n * 10n ** 17n), bonus_tokens: 2 }] }))],
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
const offerBase = { hasBonus: true, coinIn: null, canPush: true, wallet: OFFER_WALLET };
const confirmTexts: [string, string][] = [
  ['confirmOffer: a wallet', confirmOffer(offerBase)],
  ['confirmOffer: no wallet', confirmOffer({ ...offerBase, wallet: null })],
  ['confirmOffer: no bonus', confirmOffer({ ...offerBase, hasBonus: false })],
  ['confirmOffer: no bonus, no wallet', confirmOffer({ ...offerBase, hasBonus: false, wallet: null })],
  ['confirmOffer: again', confirmOffer({ ...offerBase, proposal: { name: 'TipJar', symbol: 'TIP' }, again: true })],
  ['confirmOffer: token elsewhere', confirmOffer({ ...offerBase, coinIn: 'Arc Microgrants' })],
  ["confirmOffer: can't push", confirmOffer({ ...offerBase, canPush: false })],
  ['confirmOffer: tokens off', confirmOffer({ ...offerBase, tokensOff: true })],
  ['NO_WALLET_HINT', NO_WALLET_HINT],
  ['CANT_PUSH', CANT_PUSH],
  ['READY_TO_SUBMIT', READY_TO_SUBMIT],
  ['NEEDS_REPO', NEEDS_REPO],
  ['NO_TOKEN_HERE', NO_TOKEN_HERE],
  ['walletQuestion', walletQuestion(OFFER_WALLET, true)],
  ['walletQuestion: no bonus', walletQuestion(OFFER_WALLET, false)],
  ['TOKEN_ERROR_CONFIRM', TOKEN_ERROR_CONFIRM],
  // v2.8.1 §A: the launch's builder lines.
  ['confirmOffer: with the proposal', confirmOffer({ ...offerBase, proposal: { name: 'TipJar', symbol: 'TIP' } })],
  ['confirmLine: no bonus', confirmLine({ proposal: { name: 'TipJar', symbol: 'TIP' }, hasBonus: false, wallet: null, walletKnown: false })],
  ['proofLineWaiting', proofLineWaiting('main')],
  ['proofLineWaiting: no branch', proofLineWaiting(null)],
  ['NOT_LAUNCHED_YET', NOT_LAUNCHED_YET],
  ['LAUNCHING', LAUNCHING],
  ['LAUNCH_STUCK', LAUNCH_STUCK],
  ['STILL_CHECKING', STILL_CHECKING],
  ['STILL_CHECKING_LAUNCH', STILL_CHECKING_LAUNCH],
  ['WALLET_LIMITED', WALLET_LIMITED],
  ['AGENT_LIMITED', AGENT_LIMITED],
  ['walletLimitNote', walletLimitNote(new Date('2026-10-08T14:20:00Z'))],
  ['walletLimitNote: no time', walletLimitNote(null)],
  // v2.8.1 §C: the wallet in the coach round, the speedrun kit's next step, the plain error.
  ['walletAsk', walletAsk(true)],
  ['walletAsk: no bonus', walletAsk(false)],
  [
    'coachIntro: the wallet joined to contact',
    coachIntro('Base Builder Grants', questionsFor({
      reqs: [{ key: 'email', label: 'Email', kind: 'contact', type: 'email', required: true, from: 'builder' }],
      answers: {},
      first: true,
      wallet: { hasBonus: true },
    }))!,
  ],
  [
    'continuesLine',
    continuesLine({ investment: true, organizer: 'a16z (Andreessen Horowitz)', submission_requirements: [{ key: 'email', label: 'Email', type: 'email', required: true, from: 'builder' }] })!,
  ],
  ['unexpectedErrorText', unexpectedErrorText('1a2b3c4d')],
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
  ['prefilled_link (verified email, C19)', kitProgram('Base Builder Grants', 'https://forms.gle/abc', { form: { url: 'https://docs.google.com/forms/d/e/1FAIpQ/viewform', fields: { project_name: 'entry.1', repo_url: 'entry.2' }, sign_in: 'email_only', read_at: '2026-10-07' } }), false],
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
  ...kitPrograms.map(([mode, p, browser]): [string, string] => [`kitReplyNote ${mode}`, kitReplyNote(submitKit(p, kitAnswers, { browser }), p)]),
];

test('Task 10: every kit mode has its own builder text, ending with the proof ask', () => {
  const modes = kitPrograms.map(([, p, browser]) => submitKit(p, kitAnswers, { browser }).mode);
  assert.deepEqual(modes, ['prefilled_link', 'prefilled_link', 'agent_fills', 'copy_paste', 'copy_paste', 'api']);
  for (const [label, text] of kitTexts) assert.match(text, /After you submit, (paste your entry link here|send me the confirmation screenshot or email)\.$/, label);
});

/**
 * Review Minor 4 (Task 10): the one documented exception to the "coin" rule. A program form's own
 * choice option, quoted verbatim in a kit (Base's track "Payments / Stable coins"), is the form's
 * words, not EarnKit's. Only exact options from the committed program files are exempt.
 */
const FORM_OPTIONS: string[] = readdirSync(join(import.meta.dirname, '../../../../programs'))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs', f), 'utf8')).submission_requirements as SubmissionRequirement[]))
  .flatMap((r) => r.options ?? []);
const withoutFormOptions = (text: string) => FORM_OPTIONS.reduce((t, o) => (o ? t.split(o).join(' ') : t), text);
const baseFile = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/base-builder-grants.json'), 'utf8'));
const baseNoForm: KitProgram = { title: baseFile.title, submission_url: baseFile.submission_url, submission_requirements: baseFile.submission_requirements };
const baseTrackKit = submitKit(baseNoForm, { track: 'Payments / Stable coins' }, { browser: false }).show_to_builder;
kitTexts.push(['submitKit copy_paste, Base track option (form words)', baseTrackKit]);

test('Minor 4: a form option is exempt from the "coin" rule only verbatim', () => {
  assert.ok(FORM_OPTIONS.includes('Payments / Stable coins'));
  assert.deepEqual(coinWords(baseTrackKit), ['coins'], 'the option does reach the builder verbatim');
  assert.deepEqual(coinWords(withoutFormOptions(baseTrackKit)), []);
  assert.deepEqual(coinWords(withoutFormOptions('Your coins are ready')), ['coins'], 'EarnKit text is never exempt');
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

// v2.8 Task 11: "Also qualifies", after record_submission.
const alsoQualifiesTexts: [string, string][] = [
  [
    'alsoText: two rows',
    alsoText([
      { id: 'base-builder-grants', title: 'Base Builder Grant Program', prize: 'up to $5,000', ends: 'rolling', left: 1 },
      { id: 'avalanche-team1-mini-grants', title: 'Avalanche Team1 Mini Grants', prize: 'up to $10,000', ends: 'rolling', left: 0 },
    ])!,
  ],
  [
    'alsoText: one row',
    alsoText([{ id: 'base-builder-grants', title: 'Base Builder Grant Program', prize: 'up to $5,000', ends: 'rolling', left: 1 }])!,
  ],
];

// v2.8 Task 12, Part G and Ruling 10 (plan): the outcome question and the new alert lines.
/** v2.9 A7: an open Easy program as new program alerts read it. */
const newAlertProgram = (id: string, title: string, prize: string, chains: NewProgram['chains'], opened: string): NewProgram => ({
  id, title, prize, chains, any_chain: false, opened_at: new Date(opened), ends_at: null, max_award_usd: 10_000, investment: false,
  min_product_score: 0, tag: null, existing_work: 'allowed', starts_at: null,
  difficulty: { level: 'Easy', estimate: false, rated: true, basis: '' }, past_rounds: [], match_floor: null, match_precision: null,
});
const outcomeAlertFacts: AlertFacts = {
  newCampaigns: [], standings: [], prizes: [], fees: null, bonusWins: [], bonusStandings: [], entries: [],
  newPrograms: [
    newAlertProgram('a', 'Avalanche Team1 Mini Grants', 'up to $10,000', ['avalanche'], '2026-10-09T00:00:00Z'),
    newAlertProgram('b', 'Arc Microgrants', '500 USDC × 20 grants', ['arc'], '2026-10-09T01:00:00Z'),
  ],
  fitRepos: [
    {
      key: 'alice/tipjar', name: 'tipjar', url: 'https://github.com/alice/tipjar', homepage: 'https://tipjar.xyz', created_at: '2026-01-01T00:00:00Z',
      // v2.10 Pre-flight P13: deployed chains (a chain only mentioned never alerts).
      chains: { avalanche: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' }, arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' } },
      product: { score: 6, tier: 'product', missing: [] }, live_verified: true, said: null,
    },
  ],
  skip: NO_SKIP,
  outcomeWins: [
    { id: 1, project_id: 1, name: 'TipJar', program_title: 'Arc Microgrants', prize_usd: 500, captured_at: new Date('2026-10-23T00:00:00Z') },
    { id: 2, project_id: 2, name: 'NanoCrawl', program_title: 'Arc Microgrants', prize_usd: null, captured_at: new Date('2026-10-22T00:00:00Z') },
  ],
};
const outcomeAlertLines = alertLines(
  { checkedAt: new Date('2026-10-08T00:00:00Z'), state: { top: {}, newPrograms: [] }, feeAlertedUsd: null },
  outcomeAlertFacts,
  [],
  new Date('2026-10-09T12:00:00Z'),
).lines;
const outcomeTexts: [string, string][] = [
  ['outcomeQuestion', outcomeQuestion('TipJar', 'Arc Microgrants')],
  ['sinceLine(outcome and new program lines)', sinceLine(outcomeAlertLines)!],
  ...outcomeAlertLines.map((l, i): [string, string] => [`outcome alert line[${i}]`, l]),
];

test('v2.8 Task 12: the outcome and new program alert lines render as expected', () => {
  assert.deepEqual(outcomeAlertLines, [
    'you won $500 in Arc Microgrants with TipJar',
    'NanoCrawl won in Arc Microgrants',
    'new: Arc Microgrants (500 USDC × 20 grants)',
    'new: Avalanche Team1 Mini Grants (up to $10,000)',
  ]);
});

/** v2.9 A3: "Your entries" with a program the builder applied to outside EarnKit. */
const appliedOutsideText = presentFirstMessage({
  more: true, // v2.10 item 2: the v2.9 tables are behind "show more"
  alerts: [], campaigns: [], repos: null, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: new Date('2026-10-08T12:00:00Z'),
  cards: [{ id: 'base-builder-grants', title: 'Base Builder Grant Program', summary: 'up to $5,000', tag: null, each_time: [], ends_at: null }],
  hidden: { notInterested: new Set(), applied: new Set(['base-builder-grants']) },
});

// v2.9 B9: the sign-in line, the browser pages and the pickup's sign-in words.
const signInTexts: [string, string][] = [
  ['signInLine', signInLine('TipJar', 'TIP', 'https://earnkit.com/github/verify?n=x')],
  ['signInLine (no ticker)', signInLine('TipJar', null, 'https://earnkit.com/github/verify?n=x')],
  ...Object.entries(VERIFY_PAGE).map(([k, v]): [string, string] => [`VERIFY_PAGE.${k}`, v]),
  ['CONFIRM_WARNING', CONFIRM_WARNING],
  ['codeLine', codeLine('ABCDEFGHJK')],
  ['confirmPage', confirmPage({ repo_key: 'alice/tipjar', purpose: 'entry', symbol: 'TIP', wallet: null }, 'n', 'c').replace(/<[^>]+>/g, ' ')],
  ['PICKUP_TEXT.signIn', PICKUP_TEXT.signIn],
  ['SIGN_IN_FIRST', SIGN_IN_FIRST],
  ['WALLET_CHANGED + link', `${WALLET_CHANGED} Sign in again: https://earnkit.com/github/verify?n=x`],
];

// v2.10 item 4: confirm's line for a skip of an entry's token (the v2.9 offer path is gone).
const tokenOfferTexts: [string, string][] = [['NO_TOKEN_FOR_NOW', NO_TOKEN_FOR_NOW]];

// v2.9 Task 12 (Part 1 copy sweep): every new builder string Part 1 ships. The link and contract
// check lines (T1); the matched row notes as matchRepo writes them (T2 product signals, T3 claims,
// T4 the floor and investments); and a first reply carrying those rows and the token offer (T6).
const v29Program = (id: string, extra: Partial<ProgramFacts> = {}): ProgramFacts => ({
  id, title: id, chains: ['arc'], any_chain: false, existing_work: 'allowed', tag: null, starts_at: null, investment: false, min_product_score: 0, ...extra,
});
const v29Programs = [
  v29Program('arc-microgrants'),
  v29Program('base-builder-grants', { tag: 'needs a live product' }),
  v29Program('a16z-speedrun', { investment: true, any_chain: true, min_product_score: 5 }),
  v29Program('floor', { match_floor: 6 }),
];
const v29Facts = (o: Partial<RepoFacts>): RepoFacts => ({
  name: 'tipjar', url: 'https://github.com/alice/tipjar', homepage: 'https://tipjar.xyz', created_at: '2026-01-01T00:00:00Z',
  chains: { arc: { mainnet: true, testnet: false, evidence: 'the builder said mainnet' } }, commits_in_window: {}, ...o,
});
const v29Product = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
const v29ProjectTier = productScore({ active: true, young: true, original: true, readme: false, deployed: false, owned: true });
const v29Verdicts = [
  matchRepo(v29Facts({ product: v29Product, live_verified: false, claims: ['mainnet', 'live', 'users'] }), v29Programs),
  matchRepo(v29Facts({ product: v29Product, live_verified: true, claims: ['users'] }), v29Programs),
  // v2.10.1 B3: the investment note needs measured users (a16z is products only).
  matchRepo(v29Facts({ product: v29Product, live_verified: true, tx_count: 120 }), v29Programs),
  matchRepo(v29Facts({ product: v29ProjectTier, live_verified: false }), v29Programs),
  matchRepo(v29Facts({ product: { ...v29ProjectTier, missing: [], unchecked: ['deployed'] }, live_verified: false }), v29Programs),
].flat();
const v29Notes = [...new Set(v29Verdicts.map((x) => x.note).filter((n): n is string => Boolean(n)))];
const v29FirstReply = presentFirstMessage(
  msg({
    cards: [arc, base],
    repos: { checked: 4, fits: [{ repo: 'tipjar', repo_url: 'https://github.com/alice/tipjar', verdicts: v29Verdicts.filter((x) => ['arc-microgrants', 'base-builder-grants'].includes(x.program_id)).slice(0, 2), product: GOOD_ODDS }] },
  }),
);
const v29Part1Texts: [string, string][] = [
  ['PLACEHOLDER_LINE', PLACEHOLDER_LINE],
  ['LIVE_FAILED_LINE', LIVE_FAILED_LINE],
  ...CHAINS.map((c): [string, string] => [`contractMissingLine(${c})`, contractMissingLine(c)]),
  ...CHAINS.map((c): [string, string] => [`contractUncheckedLine(${c})`, contractUncheckedLine(c)]),
  ...Object.entries(SIGNAL_WORDS).map(([k, w]): [string, string] => [`SIGNAL_WORDS.${k}`, w]),
  ['UNCHECKED_NOTE', UNCHECKED_NOTE],
  ['INVESTMENT_NOTE', INVESTMENT_NOTE],
  ['BELOW_FLOOR_NOTE', BELOW_FLOOR_NOTE],
  // v2.10.1 B1-B4: the submit step, the products-only note, its low-odds reason and every "Not matched" reason.
  ['NEEDS_USERS', NEEDS_USERS],
  ['NO_USERS_YET', NO_USERS_YET],
  ['submitStepLine', submitStepLine({ entry: { program_id: 'arc-microgrants', title: 'Arc Microgrants', name: 'tipjar', submitted: false }, card: { ...arc, submit_site: 'DoraHacks' } })],
  ['skippedLine', skippedLine({ checked: 3, fits: [], skipped: Object.values(SKIP_REASONS).map((reason, i) => ({ name: `repo${i}`, reason })) })!],
  ...v29Notes.map((n, i): [string, string] => [`matchRepo note[${i}]`, n]),
  ['presentFirstMessage: v2.9 rows', v29FirstReply],
];

test('v2.9 Task 12: the Part 1 copy sweep sees the claim, floor, investment and check notes', () => {
  for (const n of ['confirm: mainnet and live link', 'confirm: mainnet and users', INVESTMENT_NOTE, BELOW_FLOOR_NOTE, UNCHECKED_NOTE, SIGNAL_WORDS.deployed])
    assert.ok(v29Notes.includes(n), `${n} in ${JSON.stringify(v29Notes)}`);
  assert.match(v29FirstReply, /\| tipjar, confirm: mainnet and live link \|/);
  // v2.10 item 5: no token offer in the first reply.
  assert.doesNotMatch(v29FirstReply, /launches \$|40%|\bskip\b/);
});

/** v2.11 T7: the context line and the fresh lead (builds and chat-only; dated, tomorrow and rolling). */
function freshTexts(): [string, string][] {
  const now = new Date('2026-10-10T12:00:00Z');
  const tomorrow = new Date('2026-10-13T05:00:00Z');
  const cards = withFreshBuild(fileCards(), ['arc-microgrants']);
  const opts = { hidden: new Set<string>(), entered: new Set<string>(), deployOn: () => true, hostOn: true, starters: TESTED_STARTERS };
  const pick = freshPick(cards, now, opts)!;
  const rolling = { ...pick, card: { ...pick.card, ends_at: null, summary: 'up to $5,000 · rolling' } };
  return [
    ['contextLine', contextLine(cards, now)!],
    ...[true, false].flatMap((b): [string, string][] => [
      [`freshLeadLine dated ${b}`, freshLeadLine(pick, now, b)],
      [`freshLeadLine tomorrow ${b}`, freshLeadLine(pick, tomorrow, b)],
      [`freshLeadLine rolling ${b}`, freshLeadLine(rolling, now, b)],
    ]),
  ];
}

test('v2.11 T7 (review I1): the fresh lead, the context line and their notes name no tool or product', () => {
  const texts: [string, string][] = [...freshTexts(), ['BUILD_NOTE', BUILD_NOTE], ['PLAN_NOTE', PLAN_NOTE]];
  assert.equal(texts.length, 9);
  for (const [label, text] of texts) assert.doesNotMatch(text, /Claude Code|\bClaude\b|Cursor|Codex|Grok|ChatGPT/, label);
});

/** v2.11 T8: one buildCheck fix per rule (agent notes). */
function buildFixTexts(): [string, string][] {
  const s = STARTERS['arc-tipjar'];
  const ok = { twist: 'tips for my podcast listeners', name: 'PodTips', description: 'Podcast listeners tip the show.', feature: 'Each tip can carry a question for the podcast.', for_whom: 'for your podcast listeners' };
  const cases: Partial<typeof ok & { wallet: string }>[] = [
    { name: 'Po' }, { name: 'Arc kit' }, { name: 'Tipster' }, { description: 'Send a tip in USDC on Arc.' }, { feature: 'Podcast fans leave notes. The host reads them.' },
    { feature: 'Every tip can carry a short note.' }, { twist: 'a tip jar for users' }, { for_whom: 'your listeners' }, { wallet: '0x12' },
    { wallet: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' }, { description: 'Podcast tips 0x12ab34cd56ef7890a1b2c3d4e5f6a7b8c9d09f3e' },
  ];
  return cases.map((c, i): [string, string] => [`buildCheck fix ${i}`, buildCheck({ ...ok, ...c }, s)!]);
}

// v2.12 T8: a full score reply (score, change, what moved, the next step, a program line).
const scoreLinesSample = scoreLines({
  score: 41, percentile: 78, change: 6, moved: 'Users +6, staying power -1.', held: false, slug: 'lee',
  next: nextAction({ parts: computeScore([{ key: 'k', title: 'k', users: 40, money_usd: 0, outcomes: [], first_outcome_at: null, last_used_at: null, commit_weeks: [] }], calibration(), new Date('2026-10-12T12:00:00Z')).parts, missing: null, hasPackage: false, hasSite: false }),
  program: programLine({ title: 'Arc Microgrants', prize: '500 USDC' }),
});
const builderFacing: [string, string][] = [
  ...v29Part1Texts,
  // v2.11 T5 (5.3): a starter's "what" is builder copy (the fresh lead line).
  ...Object.values(STARTERS).map((s): [string, string] => [`STARTERS.${s.id}.what`, s.what]),
  // v2.11 T7: the no-repo lead's context line and its lead, each variant.
  ...freshTexts(),
  // v2.11 T8: the twist question (with and without the wallet ask), the building line, the shared reply.
  ['twistQuestion(true)', twistQuestion(true)],
  ['twistQuestion(false)', twistQuestion(false)],
  ['buildingLine', buildingLine('PodTips', STARTERS['arc-tipjar'].what, 'for your podcast listeners')],
  ['BUILD_CHAT_ONLY', BUILD_CHAT_ONLY],
  // v2.11 T10: the live line for a GitHub Pages site (the EarnKit-hosted one is v2.9's liveLine).
  ['pagesLiveLine', pagesLiveLine('PodTips', 'https://jenil04.github.io/podtips/')],
  ['applied outside EarnKit', appliedOutsideText],
  ...tokenOfferTexts,
  ['NO_TOKEN_FOR_NOW', NO_TOKEN_FOR_NOW],
  ...signInTexts,
  ['NOTED_FOR_NOW', NOTED_FOR_NOW],
  ...coachTexts,
  ...outcomeTexts,
  ...alsoQualifiesTexts,
  ...campaignPageTexts,
  ...confirmTexts,
  ...kitTexts,
  ...tokenRows.map((s, i): [string, string] => [`tokenRow[${i}]`, s]),
  ...enteredTexts.map((s, i): [string, string] => [`enteredText[${i}]`, s]),
  ...confirmTables.map((s, i): [string, string] => [`confirmTable[${i}]`, s]),
  ...enteredTables.map((s, i): [string, string] => [`enteredTable[${i}]`, s]),
  ['C7 notReadyTokenNote', notReadyTokenNote(['a live link on Arc mainnet', 'a short description'])],
  ['v2.8 Ruling 3 SKIPPED_ENTRY', SKIPPED_ENTRY],
  ['presentFirstMessage: no repo, no GitHub', noRepoNoGithub],
  ['presentFirstMessage: GitHub user, 0 repos', githubZeroRepos],
  ['presentFirstMessage: with repos', withRepos],
  ['presentFirstMessage: with alerts', withAlerts],
  ['presentFirstMessage: none of your repos fit', noneOfYourReposFit],
  ...shortReplies,
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
  // v2.9 Task 8: hosting.
  ['liveLine', liveLine('TipJar', 'tipjar-alice')],
  ['HOST_FULL', HOST_FULL],
  ['HOST_REVIEW', HOST_REVIEW],
  ...Object.entries(HOST_LINES).map(([k, v]): [string, string] => [`HOST_LINES.${k}`, v]),
  ['hostSignInLine', hostSignInLine('TipJar', 'https://earnkit.com/github/verify?n=x')],
  ['withBadge', withBadge('', 'alice', 'tipjar-alice').replace(/<[^>]+>/g, '')],
  // v2.9 Task 10: the weekly email and the won line.
  ['EMAIL_QUESTION', EMAIL_QUESTION],
  ['emailQuestionFor', emailQuestionFor('a@b.co')],
  ['WHICH_EMAIL', WHICH_EMAIL],
  ['EMAIL_ON', EMAIL_ON],
  ['EMAIL_OFF', EMAIL_OFF],
  ['EMAIL_UNAVAILABLE', EMAIL_UNAVAILABLE],
  ['EMAIL_SIGN_IN', EMAIL_SIGN_IN],
  ['UNSUB_CONFIRM', UNSUB_CONFIRM],
  ['UNSUB_DONE', UNSUB_DONE],
  ['UNSUB_BAD', UNSUB_BAD],
  ['wonLine', wonLine(12_500)!],
  ['home page (won line)', homeText({ ...homeFixture, won_line: wonLine(12_500) })],
  ...(() => {
    const b = digestBody({
      newPrograms: [{ title: 'Avalanche Mini Grant', repo: 'TipJar', prize_usd: 10_000, ends_at: new Date('2026-11-02T00:00:00Z') }],
      wins: [{ name: 'PayLink', program: 'Arc Microgrants', prize_usd: 500 }],
      deadlines: [{ program: 'Arc Microgrants', what: 'decision', at: new Date('2026-10-20T00:00:00Z') }],
    })!;
    return [['digest subject', b.subject], ['digest text', b.text]] as [string, string][];
  })(),
  // v2.9 T12, Part 2: what a hosted site's visitors see when it ended or was taken down (the
  // Worker's pages), the MINI line, the footer's company line and the /terms page above its footer.
  ['Worker ENDED_PAGE', ENDED_PAGE.replace(/<[^>]+>/g, ' ')],
  ['Worker TAKEN_DOWN_PAGE', TAKEN_DOWN_PAGE.replace(/<[^>]+>/g, ' ')],
  ['MINI_LINE', MINI_LINE],
  ['footer company line', 'EarnKit is a product of Tokenfi Inc.'],
  ['/terms (above the footer)', pageText(React.createElement(TermsPage))],
  // v2.12 T8: the score tool's builder lines.
  ['SCORE_SHARED', SCORE_SHARED],
  ['MORE_USERS_LINE', MORE_USERS_LINE],
  ['WORKING_LINE', WORKING_LINE],
  ['HELD_LINE', HELD_LINE],
  ['SITE_LINE', SITE_LINE],
  ['SITE_TXT_LINE', SITE_TXT_LINE],
  ...Object.entries(FILL_LINES).flatMap(([k, v]): [string, string][] => [[`FILL_LINES.${k}.ask`, v.ask], [`FILL_LINES.${k}.say`, v.say]]),
  ['scoreLines', scoreLinesSample],
  // v2.12 T9: find's second line with a score (the fill step is FILL_LINES above).
  ['youLine', youLine({ score: 41, percentile: 78, slug: 'lee' })],
  ['youLine hidden', youLine({ score: 41, percentile: 78, slug: 'lee', hidden: true })],
];

// noCoinYet is the AGENT's note (never shown to the builder as written; see entry-text.ts), so it
// may name launch_token — same bucket as OWNERSHIP_FOR_TOKEN, SERVER_INSTRUCTIONS and the tool descriptions.
const agentFacing: [string, string][] = [
  ['BUILD_NOTE', BUILD_NOTE],
  // v2.11 T8: the build path's notes and every build fix.
  ['twistNote(true)', twistNote(true)],
  ['twistNote(false)', twistNote(false)],
  ['BUILD_SHARED_NOTE', BUILD_SHARED_NOTE],
  ['BUILD_NOT_STARTED', BUILD_NOT_STARTED],
  ['buildRefused', buildRefused('arc-microgrants')],
  ['WALLET_NEEDED_NOTE', WALLET_NEEDED_NOTE],
  ['KIT_NOTE', KIT_NOTE],
  ...buildFixTexts(),
  // v2.11 T9: the deploy-and-host call's notes.
  ['BUILD_NOT_READY', BUILD_NOT_READY],
  ['BUILD_DEPLOYS_OFF_NOTE', BUILD_DEPLOYS_OFF_NOTE],
  ['buildOwnerNote', buildOwnerNote('constructor_args[0]', '0x12ab34cd56ef7890a1b2c3d4e5f6a7b8c9d09f3e')],
  ['buildChainNote', buildChainNote('arc')],
  ['buildProofNote(line)', buildProofNote('token: 0123456789abcdef')],
  ['buildProofNote(null)', buildProofNote(null)],
  ['BUILD_UPLOAD_NOTE', BUILD_UPLOAD_NOTE],
  ['BUILD_PAGES_NOTE', BUILD_PAGES_NOTE],
  // v2.11 T10: the held deployed line, the fresh-push refusal, the joined reply and the build wallet rule.
  ['BUILD_HOLD_NOTE', BUILD_HOLD_NOTE],
  ['BUILD_OWNER_NOTE', BUILD_OWNER_NOTE],
  ['BUILD_ENTRY_NOTE', BUILD_ENTRY_NOTE],
  ['BUILD_WALLET_NOTE', BUILD_WALLET_NOTE],
  ['BUILD_PENDING_NOTE', BUILD_PENDING_NOTE],
  ['BUILD_NO_LIVE_NOTE', BUILD_NO_LIVE_NOTE],
  ...buildKit(STARTERS['arc-tipjar'], 'token: 0123456789abcdef', {
    twist: 'tips for my podcast listeners',
    name: 'PodTips',
    description: 'Podcast listeners tip the show in USDC on Arc.',
    feature: 'Each tip can carry a question for the podcast.',
    for_whom: 'for your podcast listeners',
    wallet: '0x12ab34cd56ef7890a1b2c3d4e5f6a7b8c9d09f3e',
  }).order.map((t, i): [string, string] => [`buildKit.order[${i}]`, t]),
  ['PLAN_NOTE', PLAN_NOTE],
  ['LAUNCHING_AGENT', LAUNCHING_AGENT],
  ['launchStuckAgent', launchStuckAgent('No answer from tokens.fun.')],
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
  // v2.10 item 11: the plain-words fixes and note are the agent's only.
  ['PLAIN_NOTE', PLAIN_NOTE],
  ['PLAIN_FIX', PLAIN_FIX('One-sentence description')],
  ['PLAIN_LENGTH_FIX', PLAIN_LENGTH_FIX('One-sentence description', 80, 'characters')],
  ...gatherDecideTokenAgentNotes(),
  ...kitAgentTexts,
  ['ASK_OUTCOME_NOTE', ASK_OUTCOME_NOTE],
  ['OUTCOME_SAVED_NOTE', OUTCOME_SAVED_NOTE],
  ['TELL_SAVED_NOTE', TELL_SAVED_NOTE],
  ['TELL_SHARED_NOTE', TELL_SHARED_NOTE],
  // v2.10 item 4 (Task 9 fix rounds): the confirm and tell notes for shared clients, re-offers and a dropped submitted mark.
  ['CONFIRM_SHARED_NOTE', CONFIRM_SHARED_NOTE],
  ['PROJECT_REOFFER_NOTE', PROJECT_REOFFER_NOTE],
  ['SUBMITTED_AGAIN_NOTE', SUBMITTED_AGAIN_NOTE],
  ['SUBMITTED_SHARED_NOTE', SUBMITTED_SHARED_NOTE],
  ['SIGN_IN_NOTE', SIGN_IN_NOTE],
  ['SIGN_IN_OR_NOTE', SIGN_IN_OR_NOTE],
  ['SIGN_IN_CODE_NOTE', SIGN_IN_CODE_NOTE],
  ['CANT_PUSH_SIGN_IN_NOTE', CANT_PUSH_SIGN_IN_NOTE],
  ['TELL_DESCRIPTION', TELL_DESCRIPTION],
  // v2.12 T7: the tell description with the profile fields, the consent line and the refused X handle note.
  ['TELL_DESCRIPTION_SCORE', TELL_DESCRIPTION_SCORE],
  ['CONSENT_LINE', CONSENT_LINE('lee')],
  ['X_NOT_LISTED_NOTE', X_NOT_LISTED_NOTE],
  ['X_TAKEN_NOTE', X_TAKEN_NOTE],
  ['SHARED_PROFILE_NOTE', SHARED_PROFILE_NOTE],
  ['HIDDEN_LINE', HIDDEN_LINE],
  ['SHOWN_LINE', SHOWN_LINE('lee')],
  ['NO_PROFILE_LINE', NO_PROFILE_LINE],
  ['X_SET_LINE', X_SET_LINE('lee')],
  // v2.12 T8: the score tool's description and agent notes.
  ['SCORE_DESCRIPTION', SCORE_DESCRIPTION],
  ...Object.entries(SCORE_NOTES).map(([k, v]): [string, string] => [`SCORE_NOTES.${k}`, v]),
  // v2.12 T9: find's score_step note.
  ['SCORE_STEP_NOTE', SCORE_STEP_NOTE],
  ['BUILD_ENTRY_NO_TOKEN_NOTE', BUILD_ENTRY_NO_TOKEN_NOTE],
  ['STORAGE_NOTE', STORAGE_NOTE],
  ['UPLOAD_NOTE', UPLOAD_NOTE],
  ['HOST_SIGN_IN_NOTE', HOST_SIGN_IN_NOTE],
  ['EMAIL_NOTE', EMAIL_NOTE],
  ['EMAIL_SHARED_NOTE', EMAIL_SHARED_NOTE],
  // v2.7 fix round 1 (Minor 6): llms.txt is what agents read about EarnKit.
  ['llms.txt', readFileSync(join(import.meta.dirname, '../../public/llms.txt'), 'utf8')],
];

// Tool names, derived from the handlers themselves (I2), not a hard-coded list. v2.10 item 4: the
// v2.9 names (now aliases) and sponsor_campaign anywhere; the 4 new names are plain words ("find",
// "confirm"), so only in a call shape ("call confirm", "find with", "prepare(", "the tell tool").
const TOOL_NAMES = [...Object.keys(handlers), 'sponsor_campaign'];
const NEW_NAMES = '(find|prepare|confirm|tell|score)';
const oldToolRe = new RegExp(`\\b(${TOOL_NAMES.join('|')})\\b`);
const toolNameRe = new RegExp(
  `${oldToolRe.source}|\\bcall(s|ing)? ${NEW_NAMES}\\b|\\b${NEW_NAMES}( with\\b|\\()|\\bthe ${NEW_NAMES} tool\\b`,
  'i',
);
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
  // Minor 4 (Task 10): a program form's own option, quoted verbatim in a kit, is exempt.
  for (const [label, text] of all) assert.deepEqual(coinWords(label.startsWith('submitKit') ? withoutFormOptions(text) : text), [], label);
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

test('9.8 v2.6 §3 copy review: builder-facing text never names a tool: an old name or sponsor_campaign anywhere, a new one in a call shape', async () => {
  const gateReasons = await gatherGateReasons();
  for (const [label, text] of [...builderFacing, ...gateReasons]) assert.doesNotMatch(text, toolNameRe, label);
  // The call shapes the check catches, and plain words it lets through.
  for (const bad of ['call confirm again', 'find with more: true', 'prepare(', 'the tell tool', 'record_submission', 'sponsor_campaign'])
    assert.match(bad, toolNameRe, bad);
  for (const fine of ['Confirm your wallet.', 'Tell me when you submitted.', "I'll find the 3 easiest.", 'Want me to prepare it?'])
    assert.doesNotMatch(fine, toolNameRe, fine);
});

test('9.8 v2.10 item 4: no agent note or description names an old tool (they are aliases until ALIASES_UNTIL)', async () => {
  const notes = [...agentFacing, ...(await gatherGateAgentNotes())];
  assert.ok(notes.length > 40, `${notes.length} agent texts`);
  const oldOnly = new RegExp(`\\b(${Object.keys(handlers).join('|')})\\b`);
  for (const [label, text] of notes) assert.doesNotMatch(text, oldOnly, label);
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
        latest: async () => null,
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
  assert.match(byLabel.get('launch note: no wallet')!.agent_note ?? '', /call confirm with project_id, yes: true and that wallet\./);
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
        latest: async () => null,
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
  assert.match(byLabel.get('confirm note: gate: proof line missing')!.agent_note ?? '', /earnkit\.txt.*Then call confirm again with yes: true\./);
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

test('v2.9 Task 12: never an em dash in builder-facing text', async () => {
  for (const [label, text] of [...builderFacing, ...(await gatherGateReasons())]) assert.doesNotMatch(text, /\u2014/, label);
});

test('v2.9 A3: the applied line reads "applied outside EarnKit"', () => {
  assert.match(appliedOutsideText, /^Your entries: Base Builder Grant Program: applied outside EarnKit\./);
});

test('v2.9 B9: the sign-in copy: money first, short, no em dashes, the spec line verbatim', () => {
  assert.equal(signInLine('TipJar', 'TIP', 'https://earnkit.com/github/verify?n=x'), 'One click to prove TipJar is yours, then $TIP launches: https://earnkit.com/github/verify?n=x');
  for (const [label, text] of signInTexts) {
    assert.doesNotMatch(text, /—/, label);
    assert.doesNotMatch(text, toolNameRe, label);
  }
});

test('6.9 v2.9 B11, 7.13 v2.10 item 5: "skip" appears in builder text only as "skip the token"', () => {
  const withSkip = builderFacing.filter(([, text]) => /\bskip\b/i.test(text));
  assert.ok(withSkip.some(([label]) => label.startsWith('confirmOffer')), 'the scan sees the confirm line');
  for (const [label, text] of withSkip)
    for (const m of text.matchAll(/\bskip\b.{0,10}/gi)) assert.match(m[0], /^skip the token/i, `${label}: ${text}`);
});

test('7.13 v2.10 items 1, 5: no WETH, gas or terms link in builder strings; the token pitched with "40%" only in the confirm line', () => {
  // Agent replies (the public pages keep their WETH and terms wording).
  const replies: [string, string][] = [
    ...confirmTexts,
    ...kitTexts,
    ...coachTexts,
    ...outcomeTexts,
    ...signInTexts,
    ...alsoQualifiesTexts,
    ...tokenOfferTexts,
    ...v29Part1Texts,
    ...tokenRows.map((t, i): [string, string] => [`tokenRow[${i}]`, t]),
    ...enteredTexts.map((t, i): [string, string] => [`enteredText[${i}]`, t]),
    ...confirmTables.map((t, i): [string, string] => [`confirmTable[${i}]`, t]),
    ...[noRepoNoGithub, githubZeroRepos, withRepos, withAlerts, noneOfYourReposFit].map((t, i): [string, string] => [`presentFirstMessage[${i}]`, t]),
    ...alertLinesMoved.map((t, i): [string, string] => [`alert[${i}]`, t]),
  ];
  assert.ok(replies.length > 40, `${replies.length} replies`);
  for (const [label, text] of replies) {
    assert.doesNotMatch(text, /\bWETH\b|\bgas\b|token-creator-agreement|risk-disclosure/, `${label}: ${text}`);
    assert.ok((text.match(/Builder bonus:/g)?.length ?? 0) <= 1, `${label}: ${text}`);
    if (/40%/.test(text)) assert.match(label, /^(confirmOffer|confirmLine|tokenRow|confirmTable)/, `${label}: ${text}`);
  }
  // The modules' own string literals (present, confirm, entry-text, also-qualifies, guide).
  for (const f of ['present.ts', 'confirm.ts', 'entry-text.ts', 'also-qualifies.ts', 'guide.ts']) {
    const src = readFileSync(join(import.meta.dirname, f), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
      .join('\n');
    const literals = src.match(/'[^'\n]*'|`[^`]*`|"[^"\n]*"/g) ?? [];
    for (const lit of literals) {
      assert.doesNotMatch(lit, /\bWETH\b|\bgas\b|token-creator-agreement|risk-disclosure/, `${f}: ${lit}`);
      // Prose only (a one-word literal like 'skip' is the decision value, not builder text).
      if (/\bskip\b/i.test(lit) && /\s/.test(lit)) assert.match(lit, /skip the token/, `${f}: ${lit}`);
    }
  }
});

test('11.3 (F21): one money figure on the landing, /programs, the no-repo first reply and /api/stats; no hard-coded total', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const sponsored: Card = { ...base, id: 'sponsor-x', title: 'Sponsor X', sponsored: true, max_award_usd: 90000 };
  const campaign: Card = { ...base, id: 'earnkit-campaign-1-base', title: 'EarnKit Campaign #1', earnkit_campaign: true, max_award_usd: 100 };
  const cards: Card[] = [{ ...arc, pool_usd: 10000 }, { ...base, pool_usd: 2_000_000 }, sponsored, campaign];
  const fig = moneyText(openMoneyUsd(cards, now));
  assert.equal(fig, '$5.5K');
  const zero = { open_money_usd: 0, open_money_text: null, open_pools_usd: 0, open_pools_plus: false, programs_open: 0, bonus_programs_open: 0, coins_launched: 0, fees_to_safe_eth: 0, bonus_paid_eth: 0, bonus_pools_eth: 0, installs: 0, labelled_entries: 0, entries_won: 0, builders_won_usd: 0 };
  const landing = landingFrom(cards, new Map(), zero, now);
  assert.equal(landing.open_text, fig);
  assert.ok(pageText(React.createElement(ProgramCards, { tiles: landing.tiles, heading: 'h1', figure: landing.open_text })).includes(`${fig} open right now`));
  assert.ok(presentFirstMessage(msg({ cards, now })).startsWith(`${fig} in prizes open right now.`));
  const rows = cards.map((c) => ({
    max_award_usd: c.max_award_usd ?? null, status: 'active', campaign: c.earnkit_campaign ? {} : null,
    source: c.sponsored ? 'sponsor' : 'file', starts_at: null, ends_at: c.ends_at?.toISOString() ?? null,
  }));
  const stats = statsFrom({
    open_rows: rows, pool_rows: null, programs_open: 0, bonus_programs_open: 0, coins_launched: 0, bonus_deposits_wei: null,
    bonus_to_safe_wei: null, bonus_paid_wei: null, bonus_pools_wei: null, installs: 0, labelled_entries: 0, entries_won: 0, builders_won_usd: null,
  }, now);
  assert.equal(stats.open_money_text, fig);
  // Never a hard-coded total in builder text.
  for (const [name, text] of builderFacing)
    for (const b of ['$1.3M', '1,170,500', '1170500']) assert.ok(!text.includes(b), `${name}: ${b}`);
});

test('final fix I3: the Pages note publishes site_dir as the root of a gh-pages branch and turns Pages on with the documented API shape; never "a folder on the default branch"', () => {
  assert.doesNotMatch(BUILD_PAGES_NOTE, /folder on the default branch/i);
  assert.match(BUILD_PAGES_NOTE, /to the root of a gh-pages branch/);
  assert.ok(BUILD_PAGES_NOTE.includes('`git subtree push --prefix <host.site_dir> origin gh-pages`'));
  // GitHub REST "Create a GitHub Pages site": POST /repos/{owner}/{repo}/pages, source.branch, source.path ('/' or '/docs').
  assert.ok(BUILD_PAGES_NOTE.includes("`gh api -X POST repos/<owner>/<repo>/pages -f 'source[branch]=gh-pages' -f 'source[path]=/'`"));
  assert.ok(BUILD_PAGES_NOTE.includes('https://<owner>.github.io/<repo>/'));
  for (const note of [BUILD_PAGES_NOTE, BUILD_HOLD_NOTE]) assert.match(note, /15 minutes/, 'final fix I2: the fallback');
});
