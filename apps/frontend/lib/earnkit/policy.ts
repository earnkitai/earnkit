import { BONUS_SPLIT_BPS } from './bonus-payout';
import { WEIGHTS } from './traction';

/**
 * The facts the public policy (/terms#policy, v2.5 §4, v2.9 F22) states. The ranking weights and payout split
 * are imported from the code that applies them (traction.ts WEIGHTS, bonus-payout.ts
 * BONUS_SPLIT_BPS). The fee split is NOT: tokens.fun applies it (its EarnKit reward recipients,
 * branch earnkit-fee-split), so FEE_SPLIT_BPS here is a copy that must be changed with it.
 */

/** A coin's fee split after Clanker's 20%, bps. A copy of tokens.fun's EarnKit reward recipients. */
export const FEE_SPLIT_BPS = { project: 4000, buyback: 1000, bonus: 2000, earnkit: 3000 } as const;

/**
 * v2.9 D16, D17 (Ruling 17): the MINI fallback fee recipient and the payout wallet's gas floor. They
 * live in a leaf module because bonus-ledger.ts reads them, and this file imports bonus-payout.ts and
 * traction.ts, which import bonus-ledger.ts (an import cycle).
 */
export { GAS_WALLET_MIN_WEI_DEFAULT, MINI_FEE_RECIPIENT } from './policy-constants';

/** Clanker's own cut of trading fees, before the split. */
export const CLANKER_CUT_PCT = 20;

/** EarnKit's Safe on Base: its fee share and every builder bonus fee after a round ends. */
export const SAFE_ADDRESS = '0xc8A889577446153e28D42254B75238Ae31EC7D57';

export const CONTACT_EMAIL = 'j@earnkit.com';

const pct = (bps: number) => `${bps / 100}%`;

export const FEE_ROWS: [string, string][] = [
  ['Your project', pct(FEE_SPLIT_BPS.project)],
  ['MINI buyback', pct(FEE_SPLIT_BPS.buyback)],
  ['Builder bonus', pct(FEE_SPLIT_BPS.bonus)],
  ['EarnKit', pct(FEE_SPLIT_BPS.earnkit)],
];

/**
 * v2.9 F24: the one plain MINI line, right after the fee split wherever it is shown (FEE_SPLIT_BPS.buyback
 * is the 10%; the split itself is unchanged).
 */
export const MINI_LINE = "10% buys MINI, EarnKit's token";

/** The traction signals and their weights (traction.ts WEIGHTS). Trading volume is never one. */
export const SIGNAL_ROWS: [string, number][] = [
  ['Real onchain users of your contracts', WEIGHTS.users],
  ['Live product that loads (daily checks)', WEIGHTS.live],
  ['Shipping: commit days and contributors', WEIGHTS.shipping],
  ['New repo interest: stars and forks from real accounts, capped', WEIGHTS.interest],
  ['Token holders, capped', WEIGHTS.holders],
];

/** The round pool's split by place (bonus-payout.ts BONUS_SPLIT_BPS). */
export const PLACE_ROWS: [string, string][] = BONUS_SPLIT_BPS.map((bps, i) => [
  `${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'}`,
  pct(bps),
]);

/**
 * v2.11 T12 (spec 9): /terms "What EarnKit records". Every line is checked against what the code
 * writes: builder_events (events.ts and its callers in deploy.ts, hosting.ts, projects.ts and
 * outcomes.ts), and the tables the agent's calls fill. Change it with them. Only the login and the
 * wallet can be removed (scripts/events-redact.mts); the trigger keeps every other column.
 */
export const RECORDS_TITLE = 'What EarnKit records';
export const RECORDS_ANCHOR = 'what-earnkit-records';
export const RECORDS_HREF = `/terms#${RECORDS_ANCHOR}`;
/** What the agent sends that EarnKit keeps (installations, projects, answer_bank, token_offers, hosted_sites, digest_subscriptions). */
export const RECORDS_SENT_LEAD = 'To match you and track your entries, EarnKit keeps what your agent sends:';
export const RECORDS_SENT = [
  'Your GitHub username, your repos and what you say about them.',
  'The programs you work on, your entries and your application answers.',
  "Your token's name, ticker and image.",
  'The wallets you give, the sites you host, and your email if you ask for updates.',
];
/** What EarnKit reads itself (github_verifications, github_users, github_repo_facts, bonus_commits, scoring, usage checks). */
export const RECORDS_READ_LEAD = 'It also keeps what it reads from public GitHub and chains:';
export const RECORDS_READ = [
  'Your GitHub account age and public repo count.',
  'Repo facts and commit authors.',
  'Contract activity.',
];
/** rate_windows keys (rate-limit.ts clientIp); old windows are deleted as new ones start. */
export const RECORDS_IP = 'For up to 3 days it keeps your IP address, to limit abuse.';
export const RECORDS_HISTORY = 'EarnKit also keeps a history of each step you ship, with its public proof:';
export const RECORD_STEPS = [
  'A contract deploy: its transaction and address.',
  'A hosted site: its live link.',
  'An entry: its EarnKit entry page.',
  'A submission: the link you gave, if any.',
  "A program result: the program's results page, or your own answer.",
  "A usage check: your contract's recent use, checked 30 and 90 days after its deploy.",
];
export const RECORDS_WITH = [
  'Each step notes the repo, the program and the wallet you gave.',
  'It notes your GitHub login only if EarnKit checked it: by GitHub sign-in, the EarnKit GitHub App, or the earnkit.txt line in your repo.',
];
export const RECORDS_WHY = 'EarnKit keeps it to show your builder history. Onchain proofs are public anyway.';
/** Owner decision (T12 fix round 1, I3). */
export const RECORDS_RETENTION =
  'EarnKit keeps this history for as long as EarnKit runs, unless you ask to remove your login and wallet.';
/** Exactly what scripts/events-redact.mts does (I2): the email renders as a mailto link between the two. */
export const RECORDS_REMOVAL_LEAD = 'To remove your GitHub login and wallet from your step history, email';
export const RECORDS_REMOVAL_AFTER = [
  'The steps, repos and proofs stay, and a repo name or hosted link can still show your login.',
  'Email to ask about removing them from your other EarnKit records.',
];
