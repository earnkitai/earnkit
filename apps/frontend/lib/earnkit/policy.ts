/**
 * The facts the public policy (/terms#policy, v2.5 §4, v2.9 F22) states. The fee split is NOT applied here: tokens.fun applies it (its EarnKit reward recipients,
 * branch earnkit-fee-split), so FEE_SPLIT_BPS here is a copy that must be changed with it.
 */

/** A coin's fee split after Clanker's 20%, bps. A copy of tokens.fun's EarnKit reward recipients. */
export const FEE_SPLIT_BPS = { project: 4000, buyback: 1000, bonus: 2000, earnkit: 3000 } as const;
/** v2.13: coins launched from then on (tokens.fun's split change): no builder bonus slot, its share to EarnKit's Safe. */
export const FEE_SPLIT_BPS_V213 = { project: 4000, buyback: 1000, earnkit: 5000 } as const;
/** v4 (2026-10-28): builder tokens: the builder 40, EarnKit's Safe 60; MINI's 10% ended. */
export const FEE_SPLIT_BPS_V4 = { builder: 4000, earnkit: 6000 } as const;

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

/** The terms' fee table (v4): the builder and EarnKit. */
export function feeTable(): [string, string][] {
  return [
    ['You', pct(FEE_SPLIT_BPS_V4.builder)],
    ['EarnKit', pct(FEE_SPLIT_BPS_V4.earnkit)],
  ];
}

/** The line after the fee table (a token keeps the split it launched with). */
export const SPLIT_KEPT_V213 = 'Tokens launched before this change keep the split they launched with.';

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
  'It notes your GitHub login only if EarnKit checked it with the read-only EarnKit GitHub App, or by a GitHub sign-in from before the App.',
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
 * v2.12 spec 8, v2.14 final fix: /terms#builder-profiles, in plain words (app/terms/page.tsx). Each point matches the
 * code: the page is made when the builder signs in with X at install (x-install.ts, identity.ts attachToX) and is public
 * from then on (profiles.ts resolveHandle); before that, what EarnKit finds shows only in the agent. Every agent signed
 * in with the same X attaches to that page with no question and nothing merged (ledger ruling: no merge). The read-only
 * GitHub App is the only proof (repo-proof.ts proveByApp); App-proven repos, private ones too, are read with per-call
 * installation tokens never stored (repo-proof.ts appClient, readAppRepos); other reads are cheap public data (source-
 * readers.ts) and nothing is ever added to a site. Commit and PR titles are stored each Monday (week-facts.ts); a private
 * repo shows facts only until titles are on, and turning them off hides stored titles without deleting them (ship-
 * titles.ts titlesShown). Originality (originality.ts) embeds the README and description locally and stores only the hash,
 * the vector and the nearest keys. Only confirmed proofs count (confirmed.ts). Hide is tell's profile: 'hide'. X is read at each
 * sign-in and EarnKit keeps the X user id, handle, name and picture (x-install.ts bindXIn).
 */
export const PROFILES_TITLE = 'Builder profiles';
export const PROFILES_ANCHOR = 'builder-profiles';
export const PROFILES_POINTS: readonly string[] = [
  'Your EarnKit page is made when you sign in with X, as you install EarnKit or from the one-time link your agent gives you. It is public from then on. Until you sign in, what EarnKit finds shows only in your own agent.',
  'Every agent you sign in with the same X account uses that same page. It is added with no question, and nothing from another page is merged in.',
  'It shows your X name and picture, your project, your Shipping score, rank and Originality once the project is confirmed, the weeks you shipped code, your ship log, and programs you entered or won.',
  'A repo counts when you install the read-only EarnKit GitHub App on it. That is the only proof for new repos. A repo EarnKit confirmed before the App still counts on the leaderboard, but needs the App before a deploy or hosting.',
  'EarnKit reads the repos you install the App on, private ones too, with short-lived tokens from GitHub. It never stores those tokens. It also reads public data it can check cheaply: GitHub, live sites, package downloads, public transactions and what you did through EarnKit. It never adds anything to your site.',
  'Each week you ship code, EarnKit stores up to three commit and pull request titles from your project on the leaderboard, if you installed the App on it. A private repo shows facts only, and its titles are read only after you turn titles on. If you turn titles off, stored titles stay stored but are hidden.',
  'Originality compares your project\'s readme and description with other projects on EarnKit and with well-known ideas. EarnKit keeps only a fingerprint of that text, never the text, and never shows you another builder\'s project.',
  'Only what EarnKit confirms counts toward your rank. What your agent told EarnKit but EarnKit could not confirm is shown, marked not yet confirmed, and counts for nothing.',
  'To hide your page, tell your agent "hide my page". A hidden page is not shown or listed, and it does not count toward anyone\'s rank.',
  'EarnKit never posts for you. Your X account is read each time you sign in with it, to confirm it is yours and pick up a new handle, name or picture. EarnKit keeps your X user id, handle, name and picture.',
  'This data may transfer to a successor in a merger or acquisition. To have it removed, email the address on this page.',
];

