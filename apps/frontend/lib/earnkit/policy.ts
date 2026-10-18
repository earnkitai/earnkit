/**
 * The facts the public policy (/terms#policy, v2.5 §4, v2.9 F22) states. The fee split is NOT applied here: tokens.fun applies it (its EarnKit reward recipients,
 * branch earnkit-fee-split), so FEE_SPLIT_BPS here is a copy that must be changed with it.
 */

/** A coin's fee split after Clanker's 20%, bps. A copy of tokens.fun's EarnKit reward recipients. */
export const FEE_SPLIT_BPS = { project: 4000, buyback: 1000, bonus: 2000, earnkit: 3000 } as const;
/** v2.13: coins launched from then on (tokens.fun's split change): no builder bonus slot, its share to EarnKit's Safe. */
export const FEE_SPLIT_BPS_V213 = { project: 4000, buyback: 1000, earnkit: 5000 } as const;

/**
 * v2.9 D16, D17 (Ruling 17): the MINI fallback fee recipient and the payout wallet's gas floor. They
 * live in a leaf module because bonus-ledger.ts reads them.
 */
export { GAS_WALLET_MIN_WEI_DEFAULT, MINI_FEE_RECIPIENT } from './policy-constants';

/** Clanker's own cut of trading fees, before the split. */
export const CLANKER_CUT_PCT = 20;

/** EarnKit's Safe on Base: its fee share and every builder bonus fee after a round ends. */
export const SAFE_ADDRESS = '0xc8A889577446153e28D42254B75238Ae31EC7D57';

export const CONTACT_EMAIL = 'j@earnkit.com';

const pct = (bps: number) => `${bps / 100}%`;

/** The terms' fee table: v2.13's three rows (no builder bonus). */
export function feeTable(): [string, string][] {
  return [
    ['Your project', pct(FEE_SPLIT_BPS_V213.project)],
    ['MINI buyback', pct(FEE_SPLIT_BPS_V213.buyback)],
    ['EarnKit', pct(FEE_SPLIT_BPS_V213.earnkit)],
  ];
}

/** v2.13: the line after the fee table (coins keep the split they launched with). */
export const SPLIT_KEPT_V213 = 'Coins launched before this change keep the split they launched with.';

/**
 * v2.9 F24: the one plain MINI line, right after the fee split wherever it is shown (FEE_SPLIT_BPS.buyback
 * is the 10%; the split itself is unchanged).
 */
export const MINI_LINE = "10% buys MINI, EarnKit's token";

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
  // v2.11 T9: the built event (its repo link as proof, the twist in detail).
  'A build: its repo and your one-line idea for it.',
  'A contract deploy: its transaction and address.',
  'A hosted site: its live link.',
  'An entry: its EarnKit entry page.',
  'A submission: the link you gave, if any.',
  "A program result: the program's results page, or your own answer.",
  "A usage check: your contract's use, checked 30 and 90 days after its deploy.",
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

/**
 * v2.12 spec 8, v2.12.1 T12: /terms#builder-profiles, in plain words (app/terms/page.tsx). Each point matches the code: the page is public only after the X
 * claim (claim.ts bindX; profiles.ts resolveHandle); it shows the X name and picture, projects,
 * people and money when measured, programs entered and won (page-data.ts); the readers read only
 * cheap public data and EarnKit's own records and never add anything to a site (person-github.ts,
 * source-readers.ts, S9: no earnkit.txt); only confirmed proofs count (confirmed.ts); a second agent
 * joins one page only with a yes (identity.ts pending joins); hide is tell's profile: 'hide', and a
 * hidden person is in no one's rank (person-score.ts listedRanked, T11); X is read at each sign-in
 * (a rename is picked up then, plan S4) and EarnKit keeps the X user id, handle, name and picture
 * (x-oauth.ts, claim.ts bindX). The page shows the rank and the score ring only when the rank reads
 * well (page-data.ts pageHead).
 */
export const PROFILES_TITLE = 'Builder profiles';
export const PROFILES_ANCHOR = 'builder-profiles';
export const PROFILES_POINTS: readonly string[] = [
  'Your EarnKit page is public only after you claim it with X. Before that, what EarnKit finds shows only in your own agent.',
  'It shows your X name and picture, what you shipped, how many people use it, money it earned when EarnKit can see it, programs you entered or won, and your rank and score once something you shipped is confirmed.',
  'EarnKit reads only public data it can check cheaply: GitHub, live sites, package downloads, public transactions and what you did through EarnKit. It never adds anything to your site.',
  'Only what EarnKit confirms counts toward your rank. What your agent told EarnKit but EarnKit could not confirm is shown, marked not yet confirmed, and counts for nothing.',
  'When another agent signs in with your X or GitHub account, your agents ask you before the two share one page.',
  'To hide your page, tell your agent "hide my page". A hidden page is not shown or listed, and it does not count toward anyone\'s rank.',
  'EarnKit never posts for you. Your X account is read each time you sign in with it, to confirm it is yours and pick up a new handle, name or picture; EarnKit keeps your X user id, handle, name and picture.',
  'This data may transfer to a successor in a merger or acquisition. To have it removed, email the address on this page.',
];
