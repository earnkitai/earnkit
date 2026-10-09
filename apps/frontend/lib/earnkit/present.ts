import { normalizeRepoUrl, usd } from './campaigns';
import { NO_CELL } from './no-cell';
import { endsOf, prizeOf, repoCoinNote, shortWallet } from './entry-text';
import { shortDate } from './dates';
import { EFFORT_ORDER, type Chain, type Effort, type Product, type RepoFacts, type Verdict } from './match';
import { NEEDS_LIVE_PRODUCT, difficultyLabel, levelRank, rowDifficulty, type Difficulty, type Level } from './guide';
import { moneyText, openMoneyUsd, wonLine } from './pool';

/** v2.7: moved to entry-text.ts (shared with guide.ts); re-exported for existing callers. */
export { endsOf } from './entry-text';

/**
 * The builder-facing text for list_programs (v2.5 §1): money first, markdown tables, no emojis.
 * Built on the server because many MCP clients never show the model the server instructions; a
 * ready-made result gets shown as written. Order, always: "Since you last checked", "EarnKit
 * matches you to $X in prizes" with what the builder's repos fit, open EarnKit campaigns (none
 * while Campaign #1 is closed), other open programs (at most 5), ideas when the builder has no
 * repo, sponsor campaigns (never first), program updates, then one offer closed by the builder
 * bonus (v2.7 §3).
 */
export type Card = {
  id: string;
  title: string;
  summary: string;
  tag: string | null;
  each_time: string[];
  ends_at?: Date | null;
  /** Opened since the builder's last check. */
  is_new?: boolean;
  /** Whole days until the deadline, when it's 3 or fewer. */
  closes_in_days?: number | null;
  /** The known per-winner award in USD (programs.ts perWinnerUsd); unknown sorts last. */
  max_award_usd?: number | null;
  /** The organizer's reward text (programs.ts programCard). */
  reward?: string;
  /** v2.7.1 review: the smallest award when the source states a range, or null. */
  min_award_usd?: number | null;
  /** v2.7.1 (programs.ts poolFacts): the source-stated total pool in USD, or null. */
  pool_usd?: number | null;
  /** v2.7.1: the reward text says "+" after the pool ("$250,000+"). */
  pool_plus?: boolean;
  /** v2.7.1: the card's big line ("$840K in prizes", "10,000 USDC pool"), or null without a pool. */
  pool_line?: string | null;
  /**
   * A sponsor campaign (verified or not): its own section after curated programs, never in a
   * repo's table, the closing offer or by name in the alerts (re-audit H4, M6).
   */
  sponsored?: boolean;
  /** Required answers only the builder can give (personal info, forms). */
  builder_fields?: number;
  /**
   * v2.8.1 §B8 (programs.ts needsRepo): entering needs a repo or a live product. A no-repo builder
   * sees "needs a repo" on it; only `false` (known) makes it a no-repo builder's offer.
   */
  needs_repo?: boolean;
  /** v2.8 Ruling 13 (plan): the program fits any chain (its tile reads "Any chain"). */
  any_chain?: boolean;
  /** v2.8 Ruling C5: the award is an investment ("up to $1M investment"). */
  investment?: boolean;
  /** Up to 3 curated build ideas (program file `ideas`), shown when the builder has no repo. */
  ideas?: string[];
  /** Set when entries are public pages EarnKit can check: how the submission is checked, never whether it has a bonus (Ruling 7 (plan)). */
  submission_proof?: object | null;
  /** Ruling 7 (plan): false only when the program file opts out (`builder_bonus: false`); every other active, non-campaign program has a bonus. */
  builder_bonus?: boolean;
  /** The open round's builder bonus pool so far (bonus-rounds.ts roundPoolsWei), or null when none. */
  bonus_pool_wei?: bigint | null;
  /** The program's current round exists but isn't open any more (it froze): no bonus to win (I2). */
  bonus_closed?: boolean;
  /** v2.7 §2 (guide.ts difficultyOf): the program's difficulty; null for any campaign. */
  difficulty?: Difficulty | null;
  /** An EarnKit campaign (programs.ts programCard): its own table, never a program card. */
  earnkit_campaign?: boolean;
  /** v2.7 Ruling 23 (plan): the logo file's path under public/ ("programs/<id>.svg"), or null. */
  logo?: string | null;
  /** The program's chains (program file `chains`). */
  chains?: Chain[];
  /** Whether entries get a token (program file `token_policy`); 'off' means none. */
  token_policy?: 'encouraged' | 'allowed' | 'off';
};

/** One EarnKit campaign row (leaderboard.ts campaignRow). */
export type CampaignRow = {
  id: string;
  title: string;
  /** "$100 each to top 5 (in MINI)". */
  prize: string;
  prize_usd_each: number;
  ends_at: Date;
  entries: number;
  /**
   * The score of the last payable pick (winners.ts pickWinners: min score, vetoes, one prize per
   * wallet and agent) when all prizes are taken, else null.
   */
  cutoff: number | null;
  /** Entries with a score; 0 before the first scoring. */
  scored: number;
  winners: number;
  /** Users an entry needs to win anything. */
  min_score: number;
  /** The builder's standing (winners.ts standingText), or null without an entry. */
  you: string | null;
  open: boolean;
};

export type FirstMessage = {
  /**
   * "Since you last checked" items, money first (alerts.ts): only wins and prizes, rank changes,
   * new EarnKit campaigns and token fees of $100 or more (Ruling 35, I7). The daily check messages
   * the builder only when the reply starts with them.
   */
  alerts: string[];
  /** Program news (programUpdates: closing soon, new non-campaign programs): in the body, never an alert. */
  updates?: string[];
  campaigns: CampaignRow[];
  /** Open programs that aren't EarnKit campaigns (curated and sponsored). */
  cards: Card[];
  repos: YourRepos | null;
  /** Ruling 11 (plan): a GitHub user or repo list was given now, or remembered from an earlier call. */
  githubGiven?: boolean;
  workingOn: string[];
  agentCanBuild: boolean;
  /** "Your campaign entries" for sponsor campaigns (campaigns.ts presentYourEntries), or null. */
  sponsorEntries: string | null;
  now: Date;
  /**
   * Ruling 25: the program each of the builder's repos already has its coin entered in, by
   * normalized repo (tokens.ts repoCoinPrograms). One coin per repo: another program's row for
   * that repo shows no builder bonus.
   */
  repoCoins?: Map<string, { program_id: string; title: string }>;
  /**
   * v2.8.1 §B9 (projects.ts openEntries): the builder's entries in open programs, newest first. They
   * open the message ("Your entries"), mark their programs "entered", and are never offered again.
   */
  entries?: { program_id: string; title: string; name: string; submitted: boolean }[];
  /**
   * v2.9 A3 (builder-memory.ts hiddenPrograms): programs the builder is not interested in, or applied
   * to outside EarnKit this round. Never in a table or the offer; applied ones are listed in "Your
   * entries" as "applied outside EarnKit".
   */
  hidden?: { notInterested: Set<string>; applied: Set<string> };
  /**
   * v2.9 B10 (tokenOffer): the token offer for the best owned, product-tier fit. When set it closes
   * the reply alone: no other offer and no token line (the offer says "40%" for this entry flow).
   */
  tokenOffer?: string;
  /**
   * v2.9 E20 (stats.ts builders_won_usd): the announced prizes EarnKit builders won. Above 0, "Builders
   * using EarnKit won $X." follows the headline once; 0 or unset, no line (never "$0").
   */
  wonUsd?: number;
};

/** v2.9 E20: a money headline the won line joins as its next sentence. */
const MONEY_HEADLINE = /in prizes (you qualify for|open right now)\.$/;

/**
 * v2.9 E20: the won line, once, right after the reply's headline: joined to the money headline
 * ("$1.1M+ in prizes open right now. Builders using EarnKit won $12,500."), else its own paragraph
 * where the body starts (after any news and "Your entries"). Pure.
 */
function withWonLine(sections: string[], bodyStart: number, wonUsd: number | undefined): string[] {
  const won = wonLine(wonUsd ?? 0);
  if (!won) return sections;
  const out = [...sections];
  const [head, ...rest] = (out[bodyStart] ?? '').split('\n\n');
  if (MONEY_HEADLINE.test(head)) out[bodyStart] = [`${head} ${won}.`, ...rest].join('\n\n');
  else out.splice(bodyStart, 0, `${won}.`);
  return out;
}

/** v2.9 A3: a program the builder applied to outside EarnKit, in "Your entries". */
export const APPLIED_OUTSIDE = 'applied outside EarnKit';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows in "Also open" (spec §1). */
const MAX_OTHERS = 5;
/** Ideas under "Ideas I can build"/"Ideas for these programs" in all (v2.6 §1). */
const MAX_IDEAS = 6;

/** "0.42" from wei, two decimals, rounded down. Exported for alerts.ts (the bonus win amount). */
export const eth = (wei: bigint) => {
  const cents = wei / 10n ** 16n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
};

/** v2.8 Ruling 16 (plan): an empty table cell (no bonus, no difficulty). Never an em dash. */
export { NO_CELL };

/**
 * The builder bonus cell: the open round's pool in ETH (WETH); "new pool" while the round has
 * nothing yet; NO_CELL when the program opted out of the builder bonus (Ruling 7 (plan)), or when
 * the program's round has already frozen (I2). Pure; exported for tests.
 */
export function bonusCell(c: Pick<Card, 'builder_bonus' | 'bonus_pool_wei' | 'bonus_closed'>) {
  if (c.builder_bonus === false || c.bonus_closed) return NO_CELL;
  const wei = c.bonus_pool_wei ?? 0n;
  if (wei <= 0n) return 'new pool';
  return wei < 10n ** 16n ? 'under 0.01 ETH so far' : `${eth(wei)} ETH so far`;
}

/** The Difficulty cell (v2.7 §3, Ruling 12 (plan)): the label only, or NO_CELL with none. Pure. */
export function difficultyCell(c: Pick<Card, 'difficulty'>): string {
  return c.difficulty ? difficultyLabel(c.difficulty) : NO_CELL;
}

/**
 * Places paid per builder bonus round: mirrors bonus-payout.ts BONUS_PLACES (= BONUS_SPLIT_BPS
 * .length), kept local so present.ts stays pure (bonus-payout.ts pulls in db and viem); pinned to
 * it by a test.
 */
export const BONUS_TOP = 10;

/**
 * v2.8 Ruling 25 (plan): the first message's token line, before the bonus total. v2.8.1 §F19: no
 * "40%" here; the figure is said once per entry, in the confirmation's Yes line (confirm.ts yesLine).
 */
export const TOKEN_LINE = 'Every entry gets a token that pays you, and its fees fund the builder bonus.';
/** The token line when no program on screen has a builder bonus. */
export const TOKEN_LINE_NO_BONUS = 'Every entry gets a token that pays you.';

/**
 * v2.7 §3, Ruling 11 (plan); v2.8 Ruling 25 (plan): the token and builder bonus sentence that
 * closes the message: TOKEN_LINE, plus " 0.60 ETH so far." from the pools already read for the
 * programs on screen (dropped while every pool is empty); TOKEN_LINE_NO_BONUS when no program on
 * screen has a bonus, or null when no program on screen gives its entries a token
 * (`token_policy: 'off'`, or nothing on screen). `others` is the paragraph form before a campaign
 * offer (or an offer that can't earn the bonus), which keeps its v2.7 wording ("on the other open
 * programs"), or null without a bonus. Pure.
 */
export function bonusClose(onScreen: Card[], others = false): string | null {
  const live = onScreen.filter((c) => bonusCell(c) !== NO_CELL);
  if (live.length === 0)
    return others || !onScreen.some((c) => c.token_policy !== 'off') ? null : TOKEN_LINE_NO_BONUS;
  const wei = live.reduce((a, c) => a + (c.bonus_pool_wei ?? 0n), 0n);
  const head = others
    ? `Plus the builder bonus on the other open programs: the top ${BONUS_TOP} on each also get paid in ETH.`
    : TOKEN_LINE;
  if (wei <= 0n) return head;
  return `${head} ${wei < 10n ** 16n ? 'Under 0.01' : eth(wei)} ETH so far.`;
}

/**
 * Ruling 25: a matched row whose repo already has its coin entered in another program can't earn
 * this program's builder bonus (one coin per repo). v2.8.1 §C13: no longer shown in the row; it
 * only moves the closing bonus sentence apart from the offer (final review M4). Null otherwise. Pure.
 */
function repoCoinElsewhere(m: Pick<FirstMessage, 'repoCoins'>, card: Card, repoUrl: string | null) {
  if (card.builder_bonus === false || !repoUrl || !m.repoCoins) return null;
  const coin = m.repoCoins.get(normalizeRepoUrl(repoUrl));
  return coin && coin.program_id !== card.id ? repoCoinNote(coin.title) : null;
}

/** Ideas per program in the ideas list (fix round 1, ruling 3). */
const IDEAS_PER_PROGRAM = 2;

/**
 * One line per idea, in table order, its program title on every line: "- Arc Microgrants: <idea>".
 * At most 2 ideas per program and 6 ideas in all (v2.6 §1).
 */
function ideaLines(cards: Card[]) {
  const lines: string[] = [];
  let left = MAX_IDEAS;
  for (const c of cards) {
    const ideas = (c.ideas ?? []).slice(0, Math.min(IDEAS_PER_PROGRAM, left));
    for (const idea of ideas) lines.push(`- ${c.title}: ${idea}`);
    left -= ideas.length;
    if (left === 0) break;
  }
  return lines;
}

/** Days until a deadline if it's within 3 days, else null. */
export function closesInDays(endsAt: Date | null, now = new Date()) {
  if (!endsAt) return null;
  const days = Math.floor((endsAt.getTime() - now.getTime()) / DAY_MS);
  return days <= 3 ? Math.max(days, 0) : null;
}

const soon = (days: number) =>
  days === 0 ? 'closes today' : `closes in ${days} day${days === 1 ? '' : 's'}`;

/** The builder's repos checked against open programs (only verdicts that can earn), or why not. */
export type RepoFit = {
  repo: string;
  /** null for private/local repos the agent reported. */
  repo_url: string | null;
  /** v2.8 Ruling 10 (plan): the repo's mainnet chains; absent in older fixtures. */
  chains?: Chain[];
  verdicts: Verdict[];
  /** v2.9 A1, A2 (match-projects.ts matchProjects): the repo key, its score, the checked link, its facts. */
  key?: string;
  product?: Product;
  live_verified?: boolean;
  facts?: RepoFacts;
};
export type YourRepos =
  | {
      /** Every repo found, dropped ones included (Pre-flight P12). */
      checked: number;
      /** v2.9 A1: the repos scored (at most SCORE_LIMIT). */
      scored?: number;
      fits: RepoFit[];
    }
  | { error: string };

/** Ruling 11 (plan): "You could" only with no repo known and no GitHub user given or remembered. Pure. */
export const youCould = (repos: YourRepos | null, githubGiven: boolean) => repos === null && !githubGiven;

/**
 * Program news for the body (never "Since you last checked", I7): new sponsored ones counted
 * (re-audit H4), curated ones closing within 3 days. None on a first check. v2.8 Task 12 review
 * finding 3: new curated programs are the alerts' news only (newProgramLines, Ruling 10: fit or
 * Easy, at most 3), so a program is never announced twice in one reply. Pure.
 */
export function programUpdates(cards: Card[], firstCheck: boolean): string[] {
  if (firstCheck) return [];
  const named = cards.filter((c) => !c.sponsored);
  const sponsoredNew = cards.filter((c) => c.sponsored && c.is_new).length;
  return [
    ...(sponsoredNew > 0
      ? [`${sponsoredNew} new sponsored campaign${sponsoredNew === 1 ? '' : 's'}`]
      : []),
    ...named
      .filter((c) => c.closes_in_days != null)
      .map((c) => `${c.title} ${soon(c.closes_in_days!)}`),
  ];
}

/** A markdown table; "|" is escaped and line breaks folded so a cell can't break it. Pure; exported for tests. */
export function table(head: string[], rows: string[][]) {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

/**
 * Whole UTC calendar days from now to the end: "ends today" only on the last day. Exported for the
 * landing page's cards (landing.ts), so the page and the first message count days the same way.
 */
export const daysLeftText = (endsAt: Date, now: Date) => {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((day(endsAt) - day(now)) / DAY_MS);
  return days <= 0 ? 'ends today' : `${days} day${days === 1 ? '' : 's'} left`;
};

/** A campaign's "You" cell without an entry: "12 entered, #5 has 14 users". Pure; exported for tests. */
export function fieldText(r: CampaignRow) {
  if (r.entries === 0) return 'no entries yet';
  if (r.scored === 0) return `${r.entries} entered, not scored yet`;
  return r.cutoff === null
    ? `${r.entries} entered, top ${r.winners} not full (${r.min_score} users to qualify)`
    : `${r.entries} entered, #${r.winners} has ${r.cutoff} users`;
}

/** Hours of builder effort per verdict effort, for "fastest" (v2.4 §6). */
const EFFORT_HOURS: Record<Effort, number> = { none: 0.5, minutes: 0.5, hours: 4, days: 24, weeks: 120 };

/** Programs needing videos or forms (each-time items, or more than 2 answers only the builder can give) never go first. Pure. */
export const needsForms = (c: Card) => c.each_time.length > 0 || (c.builder_fields ?? 0) > 2;

/** Known prize per hour of builder effort. Pure; exported for tests. */
export const prizePerHour = (c: Card, v: Verdict) => (c.max_award_usd ?? 0) / EFFORT_HOURS[v.effort];

const quickness = (v: Verdict) => (v.status === 'likely' ? 0 : 10) + EFFORT_ORDER.indexOf(v.effort);

/**
 * Larger known per-winner prize first (unknown last), then the earlier deadline (rolling last).
 * Exported for the landing page (landing.ts), which sorts its cards the same way.
 */
export const byPrize = (a: Pick<Card, 'max_award_usd' | 'ends_at'>, b: Pick<Card, 'max_award_usd' | 'ends_at'>) =>
  (b.max_award_usd ?? -1) - (a.max_award_usd ?? -1) ||
  (a.ends_at?.getTime() ?? 8.64e15) - (b.ends_at?.getTime() ?? 8.64e15);

/**
 * v2.8 Ruling C4: Easy programs first (the lazy builder wants the easiest money), for the agent's
 * tables only; the landing carousel keeps byPool. Pure.
 */
export const byEase = (a: Pick<Card, 'difficulty'>, b: Pick<Card, 'difficulty'>) =>
  Number(b.difficulty?.level === 'Easy') - Number(a.difficulty?.level === 'Easy');

/** v2.8 Ruling C4: Easy first, then byPrize. Pure. */
export const byEaseThenPrize = (a: Pick<Card, 'difficulty' | 'max_award_usd' | 'ends_at'>, b: Pick<Card, 'difficulty' | 'max_award_usd' | 'ends_at'>) =>
  byEase(a, b) || byPrize(a, b);

/** EarnKit campaigns: the larger prize per winner first, then the earlier end (controller ruling 12). */
const byCampaignPrize = (a: CampaignRow, b: CampaignRow) =>
  b.prize_usd_each - a.prize_usd_each || a.ends_at.getTime() - b.ends_at.getTime();

/** " It needs a short Loom from you." for a program with forms (needsForms). */
const needsText = (c: Card) =>
  c.each_time[0]
    ? ` It needs ${c.each_time[0]} from you.`
    : ` It needs ${c.builder_fields} answers only you can give.`;

const TELL_WHEN_OPENS = 'Want me to tell you when something opens?';

const CHAT_ONLY =
  "I can't build or deploy from here, but I can plan it and write every answer for you to submit. To have it done for you, add EarnKit to a coding agent (Claude Code, Cursor, Codex).";

/** No repo to match: none reported, or none found under the builder's GitHub user. */
const noRepo = (r: YourRepos | null) => r === null || ('checked' in r && r.checked === 0);

/**
 * Ruling 11 (plan): a matching error gets the same no-repo treatment as 0 repos found — "$X is
 * open right now." with ideas, just never "You could" (youCould stays false for an error). Pure.
 */
const noMatch = (r: YourRepos | null) => noRepo(r) || (r !== null && 'error' in r);

/** v2.9 A4: a matched row's difficulty (guide.ts rowDifficulty), or null when the program has none. */
type RowLevel = { level: Level; estimate: boolean } | null;
/** `key`, `product_score`: the repo's key and score (match-loop.ts recordShown), when matching gave them. */
export type Fit = { card: Card; repo: string; repo_url: string | null; v: Verdict; row: RowLevel; key: string | null; product_score: number | null };

/**
 * v2.9 A4: a matched row's difficulty, from its program level (difficultyOf) and the
 * repo's fit (the verdict, the checked link, a users claim). Null when the card has no difficulty. Pure.
 */
export function rowLevel(card: Pick<Card, 'difficulty'>, fit: Pick<RepoFit, 'live_verified' | 'facts'>, v: Verdict): RowLevel {
  if (!card.difficulty) return null;
  return rowDifficulty({ difficulty: card.difficulty }, v, {
    liveVerified: fit.live_verified === true,
    hasUsersClaim: fit.facts?.claims?.includes('users') ?? false,
  });
}

/** v2.9 A4: a matched row's Difficulty cell: the row's level, else NO_CELL. Pure. */
const rowCell = (card: Card, row: RowLevel) =>
  row && card.difficulty ? difficultyLabel({ ...card.difficulty, level: row.level, estimate: row.estimate }) : NO_CELL;

/** v2.9 A4: Easy rows first; a row without a level sorts with Medium. Pure. */
const byRowLevel = (a: Pick<Fit, 'row'>, b: Pick<Fit, 'row'>) => levelRank(a.row?.level ?? 'Medium') - levelRank(b.row?.level ?? 'Medium');

/**
 * v2.8.1 §B9: the programs the builder already entered (submitted). One confirmed but not submitted
 * yet stays offerable ("keep going"), so the builder finishes it. Pure. Not the same rule as
 * projects.ts enteredProgramIds (Ruling 29, "Also qualifies"), which counts any row, submitted or not.
 */
const enteredIds = (m: Pick<FirstMessage, 'entries'>) =>
  new Set((m.entries ?? []).filter((e) => e.submitted).map((e) => e.program_id));

/** "Your entries" shows at most this many, then "N more". */
const MAX_ENTRIES = 3;

/**
 * v2.8.1 §B9: the returning builder's short recap, or null with no entry in an open program:
 * "Your entries: Base Builder Grant Program (tipjar, submitted); Arc Microgrants (tipjar, not
 * submitted yet)." Pure; exported for tests.
 */
export function entriesLine(m: Pick<FirstMessage, 'entries' | 'cards' | 'hidden'>): string | null {
  const titles = new Map(m.cards.map((c) => [c.id, c.title]));
  // v2.9 A3: programs applied to outside EarnKit (open ones, so they have a title) come after the entries.
  const applied = [...(m.hidden?.applied ?? [])].filter((id) => titles.has(id));
  const lines = [
    ...(m.entries ?? []).map((e) => `${titles.get(e.program_id) ?? e.title} (${e.name}, ${e.submitted ? 'submitted' : 'not submitted yet'})`),
    ...applied.map((id) => `${titles.get(id)}: ${APPLIED_OUTSIDE}`),
  ];
  if (lines.length === 0) return null;
  const more = lines.length - MAX_ENTRIES;
  return `Your entries: ${lines.slice(0, MAX_ENTRIES).join('; ')}${more > 0 ? `; ${more} more` : ''}.`;
}

/**
 * v2.8.1 §B8, §B9: a table's Program cell: "(entered)" once the builder has an entry in it, else
 * "(needs a repo)" for a no-repo builder when entering needs one. Pure.
 */
const programCell = (c: Card, entered: Set<string>, noRepoYet: boolean) =>
  entered.has(c.id) ? `${c.title} (entered)` : noRepoYet && c.needs_repo ? `${c.title} (needs a repo)` : c.title;

/**
 * v2.8.1 §B10: a matched row that counts toward "$X in prizes you qualify for": never an
 * investment, and never a program that counts only new work when the repo is existing work (its
 * verdict still needs new work). Pure.
 */
const qualifies = (r: Fit) => !r.card.investment && !r.v.missing.includes('new_work');

/**
 * What the first message shows: the programs the builder's repos fit (each curated program once,
 * under the repo that fits it best, by prize per winner), and the other curated programs shown
 * (at most 5) plus how many more. Shared with list_programs, so the bonus pools are read once and
 * only for programs on screen. Pure; exported for tests.
 */
export function layout(m: Pick<FirstMessage, 'cards' | 'repos' | 'entries'>, done = enteredIds(m)) {
  const byId = new Map(m.cards.map((c) => [c.id, c]));
  // v2.8.1 §B9: programs already entered go after the rest.
  const enteredLast = (a: Pick<Card, 'id'>, b: Pick<Card, 'id'>) => Number(done.has(a.id)) - Number(done.has(b.id));
  const curated = (id: string) => byId.has(id) && !byId.get(id)!.sponsored;
  const fits = m.repos && 'fits' in m.repos ? m.repos.fits : [];
  const matched = new Map<string, Fit>();
  for (const f of fits)
    for (const v of [...f.verdicts].sort((a, b) => quickness(a) - quickness(b)))
      if (v.status !== 'no' && curated(v.program_id) && !matched.has(v.program_id))
        matched.set(v.program_id, {
          card: byId.get(v.program_id)!,
          repo: f.repo,
          repo_url: f.repo_url,
          v,
          row: rowLevel(byId.get(v.program_id)!, f, v),
          key: f.key ?? null,
          product_score: f.product?.score ?? null,
        });
  // v2.9 A4: by the row's difficulty (Easy first), then prize, then the quicker fit.
  const rows = [...matched.values()].sort((a, b) => enteredLast(a.card, b.card) || byRowLevel(a, b) || byPrize(a.card, b.card) || quickness(a.v) - quickness(b.v));
  const rest = m.cards
    .filter((c) => !c.sponsored && !matched.has(c.id))
    .sort((a, b) => enteredLast(a, b) || byEaseThenPrize(a, b));
  const shown = rest.slice(0, MAX_OTHERS);
  return { byId, rows, shown, more: rest.length - shown.length };
}

/** Programs on screen whose entries can earn the builder bonus: the ones whose pool is read. Pure. */
export const bonusProgramIds = (m: Pick<FirstMessage, 'cards' | 'repos'>) => {
  const { rows, shown } = layout(m);
  return [...rows.map((r) => r.card), ...shown].filter((c) => c.builder_bonus !== false).map((c) => c.id);
};

/**
 * v2.9 F21: the no-repo headline, "$1.1M+ in prizes open right now." with the site's figure
 * (moneyText(openMoneyUsd) over every open curated program), else "These programs are open right now.".
 * Pure.
 */
const openHeadline = (fig: string | null) =>
  fig ? `${fig} in prizes open right now.` : 'These programs are open right now.';

/** The first message: see the type and the module comment for the order. Pure; exported for tests. */
export function presentFirstMessage(given: FirstMessage): string {
  const sections: string[] = [];
  if (given.alerts.length) sections.push(`Since you last checked: ${given.alerts.join('; ')}.`);
  // v2.8.1 §B9: the returning builder's entries come first, right after any news (the daily check
  // messages the builder only when the reply starts with news).
  const recap = entriesLine(given);
  if (recap) sections.push(recap);
  const bodyStart = sections.length;
  const done = () => withWonLine(sections, bodyStart, given.wonUsd).join('\n\n');
  // v2.9 A3: a program the builder is not interested in, or applied to outside EarnKit, leaves
  // every table and the offer.
  const hidden = new Set([...(given.hidden?.notInterested ?? []), ...(given.hidden?.applied ?? [])]);
  const m: FirstMessage = hidden.size ? { ...given, cards: given.cards.filter((c) => !hidden.has(c.id)) } : given;
  // Only open EarnKit campaigns get a table (Campaign #1 is closed: none).
  const campaigns = m.campaigns.filter((r) => r.open).sort(byCampaignPrize);
  if (campaigns.length === 0 && m.cards.length === 0) {
    const results = m.campaigns.some((r) => r.you === 'in review');
    sections.push(`Nothing is open right now. ${results ? 'Want me to tell you when the results are in?' : TELL_WHEN_OPENS}`);
    return done();
  }

  const entered = enteredIds(m);
  const { byId, rows, shown, more } = layout(m, entered);
  if (m.repos && 'error' in m.repos) sections.push(`Couldn't read your repos: ${m.repos.error}`);
  else if (m.repos && !noRepo(m.repos) && rows.length === 0)
    sections.push(
      `None of your ${m.repos.checked} repo${m.repos.checked === 1 ? '' : 's'} fits an open program yet.`,
    );
  else if (rows.length > 0) {
    // v2.9 F21: the same function as the site's figure, over the rows the builder qualifies for
    // now (v2.8.1 §B10).
    const fig = moneyText(openMoneyUsd(rows.filter(qualifies).map((r) => r.card), m.now));
    sections.push(
      `${fig ? `EarnKit matches you to ${fig} in prizes you qualify for.` : 'Your repos fit these open programs:'}\n\n` +
        table(
          ['Program', 'Prize', 'Difficulty', 'Ends', 'Your repo'],
          rows.map(({ card, repo, v, row }) => {
            // v2.8.1 §C13: no "(no builder bonus: …)" per row; the bonus note is said once, in Also qualifies.
            return [
              programCell(card, entered, false),
              prizeOf(card),
              rowCell(card, row),
              endsOf(card),
              v.status === 'likely' || !v.note ? repo : `${repo}, ${v.note}`,
            ];
          }),
        ),
    );
  }

  if (campaigns.length > 0)
    sections.push(
      table(
        ['Win', 'Prize', 'Ends', 'You'],
        campaigns.map((r) => [
          r.title,
          r.prize,
          `${shortDate(r.ends_at)}, ${daysLeftText(r.ends_at, m.now)}`,
          r.you ?? fieldText(r),
        ]),
      ),
    );

  if (shown.length > 0) {
    // The no-repo, nothing-else-shown state gets the money-first headline (v2.6 §1); every other
    // case keeps the v2.5 headings.
    const zeroState = noMatch(m.repos) && rows.length === 0 && campaigns.length === 0;
    const above = campaigns.length > 0 || rows.length > 0;
    const couldWin = zeroState && youCould(m.repos, m.githubGiven ?? false);
    sections.push(
      `${
        zeroState
          ? openHeadline(moneyText(openMoneyUsd(given.cards, m.now)))
          : above
            ? 'Also open:'
            : 'Open money right now:'
      }\n\n` +
        table(
          ['Program', couldWin ? 'You could win' : 'Prize', 'Difficulty', 'Ends'],
          shown.map((c) => [programCell(c, entered, noMatch(m.repos)), prizeOf(c), difficultyCell(c), endsOf(c)]),
        ) +
        (more > 0 ? `\n\n${more} more open: ask me for the full list.` : ''),
    );
  }

  // No repo to match: curated ideas for the programs shown (never generated at request time).
  const ideas = noMatch(m.repos) ? ideaLines(shown) : [];
  if (ideas.length > 0)
    sections.push(`${m.agentCanBuild ? 'Ideas I can build:' : 'Ideas for these programs:'}\n${ideas.join('\n')}`);
  const sponsored = m.cards.filter((c) => c.sponsored);
  if (sponsored.length > 0)
    sections.push(
      "Sponsored (set by sponsors; EarnKit didn't write or check them):\n\n" +
        table(['Campaign', 'Details'], sponsored.map((c) => [c.title, c.summary])),
    );
  if (m.sponsorEntries) sections.push(m.sponsorEntries);
  // After the tables, so the reply never starts with it: news, not an alert (I7).
  if (m.updates?.length) sections.push(`Updates: ${m.updates.join('; ')}.`);

  // v2.7 §3, Ruling 10 (plan): the builder bonus closes the message, joined to the offer; a
  // campaign offer (which never earns the bonus itself) gets the sentence as its own paragraph
  // first instead, so the campaign offer stays the last line.
  // Final review M4: an offer whose row says "no builder bonus" (Ruling 25: the repo's token is
  // entered elsewhere) takes the campaign form too, and that program's pool isn't counted as "other".
  // v2.9 B10: the token offer, when there is one, is the reply's one closing offer.
  if (m.tokenOffer) {
    sections.push(m.tokenOffer);
    return done();
  }
  const close = offer(m, byId, rows, ideas.length > 0, entered);
  const apart = close.campaign || !!close.noBonusId;
  const bonus = bonusClose([...rows.map((r) => r.card), ...shown].filter((c) => c.id !== close.noBonusId), apart);
  if (!bonus) sections.push(close.text);
  else if (apart) sections.push(bonus, close.text);
  else sections.push(`${close.text} ${bonus}`);
  return done();
}

/** v2.9 B10: what the first reply's token offer names. */
export type TokenOfferFacts = {
  project: string;
  program: string;
  prize_usd: number;
  /** Ruling G15 (M2): the row is one step away (after_step), not likely: "is one step from", never "fits". */
  oneStep?: boolean;
  proposal: { name: string; symbol: string };
  hasBonus: boolean;
  walletKnown: boolean;
  /** Ruling G13 (I1): the remembered wallet (non-shared clients only), named short so "yes" launches to the wallet shown. */
  wallet?: string | null;
  /** The wallet came from memory (default), not with this answer: "(used last time)". */
  remembered?: boolean;
  /** Ruling G14: the first reply showed this offer already: no earnings sentence ("40%" said once). */
  again?: boolean;
};

/** Ruling G13 (I1): the answer part of a token offer: the wallet shown with "yes / skip", else asked for. Pure. */
const offerAnswer = (t: Pick<TokenOfferFacts, 'walletKnown' | 'wallet' | 'remembered'>) =>
  t.walletKnown
    ? `${t.wallet ? `Wallet: ${shortWallet(t.wallet.toLowerCase())}${t.remembered === false ? '' : ' (used last time)'}. ` : ''}yes / skip`
    : 'Say yes with your wallet address, or skip.';

/**
 * Ruling G13 (I2): the offer again when the agent asked for another name or ticker: names the token
 * that launches on "yes", without the earnings figure (said once already). Pure.
 */
export function tokenOfferAgain(t: Pick<TokenOfferFacts, 'proposal' | 'walletKnown' | 'wallet' | 'remembered'>, taken: string | null = null): string {
  return `${taken ? `$${taken} is taken. ` : ''}Launch $${t.proposal.symbol} (${t.proposal.name}) on Base now? ${offerAnswer(t)}`;
}

/**
 * v2.9 B10: the first reply's closing offer when an owned, product-tier fit exists: "TipJar fits Arc
 * Microgrants: $500. Launch $TIP (TipJar) on Base now? You earn 40% of its trading fees, plus a shot
 * at the builder bonus. yes / skip". The wallet is asked in the same line only when none is known. Pure.
 */
export function tokenOffer(t: TokenOfferFacts): string {
  const head = `${t.project} ${t.oneStep ? 'is one step from' : 'fits'} ${t.program}: $${t.prize_usd.toLocaleString('en-US')}.`;
  const ask = `Launch $${t.proposal.symbol} (${t.proposal.name}) on Base now?`;
  const why = `You earn 40% of its trading fees${t.hasBonus ? ', plus a shot at the builder bonus' : ''}.`;
  return t.again ? `${head} ${ask} ${offerAnswer(t)}` : `${head} ${ask} ${why} ${offerAnswer(t)}`;
}

/** v2.9 B10 (Ruling 12): efforts quick enough for the token offer (hours or less). */
const QUICK_EFFORTS = new Set<Effort>(['none', 'minutes', 'hours']);

/**
 * v2.9 B10 (Ruling 12): the matched row the first reply's token offer is for, a likely row first,
 * then table order: its
 * repo is a public repo the builder owns, at product tier; the verdict is likely or after one step,
 * with effort of hours or less; the program is offerable (curated, not an investment, no entry yet,
 * not hidden), gives tokens, has a known prize; the repo has no token yet and is not in `blocked`
 * (normalized repo keys declined twice). Launch availability is the caller's. Pure.
 */
export function tokenOfferFit(given: FirstMessage, blocked: Set<string> = new Set()): Fit | undefined {
  const hidden = new Set([...(given.hidden?.notInterested ?? []), ...(given.hidden?.applied ?? [])]);
  const m = hidden.size ? { ...given, cards: given.cards.filter((c) => !hidden.has(c.id)) } : given;
  const anyEntry = new Set((m.entries ?? []).map((e) => e.program_id));
  const fits = m.repos && 'fits' in m.repos ? m.repos.fits : [];
  const product = (url: string) => fits.find((f) => f.repo_url === url)?.product;
  const ok = (r: Fit) => {
    if (!r.repo_url) return false;
    const p = product(r.repo_url);
    const key = normalizeRepoUrl(r.repo_url);
    return (
      p?.tier === 'product' &&
      !p.missing.includes('owned') &&
      r.v.status !== 'no' &&
      QUICK_EFFORTS.has(r.v.effort) &&
      !r.card.sponsored &&
      !r.card.investment &&
      !r.card.earnkit_campaign &&
      r.card.token_policy !== 'off' &&
      (r.card.max_award_usd ?? 0) > 0 &&
      !anyEntry.has(r.card.id) &&
      !m.repoCoins?.has(key) &&
      !blocked.has(key)
    );
  };
  // Review M2: a likely row is offered before one a step away; table order otherwise.
  const rows = layout(m).rows.filter(ok);
  return rows.find((r) => r.v.status === 'likely') ?? rows[0];
}

const isEasy = (c: Card) => c.difficulty?.level === 'Easy';

/** Ruling 28: "build something new" for a program, saying what only the builder can give. Pure. */
const buildNew = (c: Card): Offer => ({
  text: `Want me to build something new for ${c.title} (${prizeOf(c)})?${needsForms(c) ? needsText(c) : ''}`,
  campaign: false,
});

/** v2.8.1 §B7, Ruling F5; v2.9 A4: the fit to offer: the easiest row first, then the top prize, then the quicker fit. Pure. */
const bestFit = (rows: Fit[]): Fit | undefined =>
  [...rows].sort((a, b) => byRowLevel(a, b) || byPrize(a.card, b.card) || quickness(a.v) - quickness(b.v))[0];

/** v2.8.1 §B7: the program to offer without a fit: the Easy one with the most money, else programs needing forms last. Pure. */
const bestCard = (cards: Card[]): Card | undefined =>
  [...cards].sort((a, b) => Number(isEasy(b)) - Number(isEasy(a)) || (isEasy(a) ? 0 : Number(needsForms(a)) - Number(needsForms(b))) || byPrize(a, b))[0];

/**
 * v2.10 Ruling H1 (c1): the program a builder with no repo can enter as they are: known not to need a
 * repo and never "needs a live product" (a builder without a repo has no product with users yet);
 * the lowest difficulty first (unknown reads Medium), then the top prize. None: undefined. Pure.
 */
const noRepoPick = (cards: Card[]): Card | undefined =>
  [...cards.filter((c) => c.needs_repo === false && c.tag !== NEEDS_LIVE_PRODUCT)].sort(
    (a, b) => levelRank(a.difficulty?.level ?? 'Medium') - levelRank(b.difficulty?.level ?? 'Medium') || byPrize(a, b),
  )[0];

/**
 * v2.8.1 T7 (journey test, audit J1): the program a builder with no repo can enter as they are
 * (never a sponsor campaign, an EarnKit campaign or an investment), as the no-repo offer picks it
 * (`noRepoPick`). Used when such a builder picks a program that needs a repo anyway.
 */
export const enterableWithoutRepo = (cards: (Card & { earnkit_campaign?: unknown })[], exceptId?: string): Card | undefined =>
  noRepoPick(cards.filter((c) => c.id !== exceptId && !c.sponsored && !c.earnkit_campaign && !c.investment));

/**
 * One closing offer (offer's text), and whether it's an EarnKit campaign entry (Ruling 10 (plan)).
 * `noBonusId` (final review M4): the offered program, when its row carries Ruling 25's "no builder
 * bonus" note, so the entry offered can't earn the bonus.
 */
type Offer = { text: string; campaign: boolean; noBonusId?: string };

/**
 * One closing offer, never a menu and never a sponsor campaign (fix round 1, I3). In order: keep
 * going on what they're preparing; build an entry for an open EarnKit campaign; the quickest fit
 * without forms; a fit that needs forms, saying what only they can give; with no repo known (and
 * no open campaign), "Pick one and I'll start." (task 2 fix round 1, Ruling 11) whether or not
 * ideas were shown; with repos known and no fit, build something new for the top program (without
 * forms first, Ruling 28); with a GitHub user or repo list given/remembered but no repo known,
 * check them; else wait for results or news.
 */
function offer(
  m: FirstMessage,
  byId: Map<string, Card>,
  rows: Fit[],
  ideasShown: boolean,
  entered: Set<string>,
): Offer {
  // v2.8.1 §B7, §B9: never an investment (it shows only in the table), never a program entered.
  const offerable = (c: Card) => !c.sponsored && !c.investment && !entered.has(c.id);
  // M4: the program offered, when its matched row says the repo's token is entered elsewhere.
  const noBonus = (r: Fit | undefined) =>
    r && repoCoinElsewhere(m, r.card, r.repo_url) ? { noBonusId: r.card.id } : {};
  // v2.8.1 §B7, Ruling F5: a fit for the builder's repo always comes first (Easy first, then the
  // top prize); building something new is offered only when no repo fits.
  const pick = bestFit(rows.filter((r) => offerable(r.card)));
  // v2.8.1 §B8: with no repo, the program the builder can enter as they are (known not to need one).
  // v2.10 Ruling H1 (c1): the same pick as the "No repo yet?" line (noRepoPick).
  const asTheyAre = noMatch(m.repos) ? noRepoPick(m.cards.filter(offerable)) : undefined;
  if (!m.agentCanBuild) {
    const named = pick ? `${pick.card.title} with ${pick.repo}` : asTheyAre?.title;
    return { text: named ? `Want me to start on ${named}? ${CHAT_ONLY}` : CHAT_ONLY, campaign: false, ...noBonus(pick) };
  }
  const titleOf = (id: string): Offer | undefined => {
    const c = byId.get(id);
    if (c) return c.sponsored ? undefined : { text: c.title, campaign: false };
    const camp = m.campaigns.find((r) => r.id === id && r.open);
    return camp ? { text: camp.title, campaign: true } : undefined;
  };
  const resumeId = m.workingOn.find((id) => !entered.has(id) && titleOf(id));
  const resume = resumeId && titleOf(resumeId);
  if (resume)
    return {
      text: `Want me to keep going on ${resume.text}?`,
      campaign: resume.campaign,
      ...noBonus(rows.find((r) => r.card.id === resumeId)),
    };
  const campaign = [...m.campaigns].sort(byCampaignPrize).find((r) => r.open && r.you === null);
  if (campaign) return { text: `Want me to build your entry for the ${usd(campaign.prize_usd_each)}?`, campaign: true };
  if (pick)
    return {
      text: `Want me to start on ${pick.card.title} with ${pick.repo}?${needsForms(pick.card) ? needsText(pick.card) : ''}`,
      campaign: false,
      ...noBonus(pick),
    };
  if (asTheyAre)
    return { text: `Want me to start on ${asTheyAre.title}?${needsForms(asTheyAre) ? needsText(asTheyAre) : ''}`, campaign: false };
  if (ideasShown) return { text: "Pick one and I'll start.", campaign: false };
  const curated = m.cards.filter((c) => !c.sponsored);
  const fresh = curated.filter(offerable);
  // Ruling 11 (fix round 1): "You could" already offered a table of programs to pick from (no
  // ideas doesn't mean no choice); never fall back to "check your repos" when there's nothing to
  // check (repos === null) and no open campaign took priority above.
  // Ruling 19: a matching error is the no-repo state too, so its build offer closes the same way.
  const buildOffer = youCould(m.repos, m.githubGiven ?? false) || (m.repos !== null && 'error' in m.repos);
  // Final review M9: the no-repo close never says "qualify", even with an open campaign (one the
  // builder hasn't entered took the campaign offer above).
  if (buildOffer && curated.length > 0) return { text: "Pick one and I'll start.", campaign: false };
  const anyOpen = curated.length > 0 || m.campaigns.some((r) => r.open);
  if (anyOpen && !buildOffer && (!m.repos || 'error' in m.repos))
    return { text: 'Want me to check which of your repos already qualify?', campaign: false };
  // Repos known and none fits (Ruling 28): never "start on" a program their repo was ruled out of.
  const top = bestCard(fresh);
  if (top) return buildNew(top);
  // Only sponsor campaigns open: never offered by name.
  if (m.cards.length > 0) return { text: "Pick one and I'll start.", campaign: false };
  if (m.campaigns.some((r) => r.you === 'in review'))
    return { text: 'Nothing else is open right now. Want me to tell you when the results are in?', campaign: false };
  return { text: `Nothing else is open right now. ${TELL_WHEN_OPENS}`, campaign: false };
}
