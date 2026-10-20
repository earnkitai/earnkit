import { usd } from './campaigns';
import { NO_CELL } from './no-cell';
import { closeDayOf, endsOf, prizeOf } from './entry-text';
import { shortDate } from './dates';
import { CHAIN_NAMES, EFFORT_ORDER, NOT_REAL_YET, hasRealUse, oddsRank, rowOdds, type Chain, type Effort, type Odds, type Product, type RepoFacts, type Verdict } from './match';
import { NEEDS_LIVE_PRODUCT, difficultyLabel, levelRank, rowDifficulty, type Difficulty, type Level } from './guide';
import { moneyText, openMoneyUsd, wonLine } from './pool';
import { CANT_SEE_LINE, PRIVATE_LOCAL_LINE } from './match-projects';
import { contextLine, freshLeadLine, freshPick, type FreshPick } from './fresh-build';
import type { Starter, StarterChain } from './starters';
import { COIN_PROGRAM } from './policy-constants';

/** v2.7: moved to entry-text.ts (shared with guide.ts); re-exported for existing callers. */
export { endsOf } from './entry-text';

/**
 * The builder-facing text for list_programs (v2.5 §1): money first, markdown tables, no emojis.
 * Built on the server because many MCP clients never show the model the server instructions; a
 * ready-made result gets shown as written. Order, always: "Since you last checked", "EarnKit
 * matches you to $X in prizes" with what the builder's repos fit, open EarnKit campaigns (none
 * while Campaign #1 is closed), other open programs (at most 5), ideas when the builder has no
 * repo, sponsor campaigns (never first), program updates, then one offer. v2.10 item 2: that body is "show more" (FirstMessage.more); the
 * default first reply is news, "Your entries", the deadline line, then one lead line (leadLine).
 */
export type Card = {
  id: string;
  /** v3 Stage 2 (programs.ts programCard): `upcoming` is listed (Not open yet), never open. Absent: active. */
  status?: 'active' | 'closed' | 'upcoming';
  /** v3 Stage 2: when and how an upcoming program opens, or null. */
  opens_note?: string | null;
  /** v3 Stage 2: attended in person (the card's "In person" chip). */
  in_person?: boolean;
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
  /** v2.10.1 B1 (programs.ts submitSiteName): where the builder submits ("DoraHacks"), or null. */
  submit_site?: string | null;
  /** v2.11 T5 (programs.ts programCard): the owner-set fresh-build starter (starters.ts), or null. */
  fresh_build?: { starter: string } | null;
  /** v2.11 T7 (programs.ts programCard): winners per round from the program file, or null (the fresh pick's rank). */
  winners_per_round?: number | null;
  /** v2.13 (programs.ts programCard): the program file's pitch for the no-project reply, or null. */
  pitch?: { who: string; for: string } | null;
};

/**
 * v2.11 T7: what the no-repo lead (fresh-build.ts freshPick) needs from outside the pure reply: whether
 * EarnKit deploys to a chain and hosts right now, and whether this client's agent can build (a
 * chat-only or shared client gets the chat-only lead). Absent: no fresh lead (fail closed).
 */
export type FreshOn = {
  deployOn: (c: StarterChain) => boolean;
  hostOn: boolean;
  canBuild: boolean;
  /** The starter registry; starters.ts STARTERS unless a test passes its own. */
  starters?: Record<string, Starter>;
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
   * v2.8.1 §B9 (projects.ts openEntries): the builder's entries in open programs, newest first. They
   * open the message ("Your entries"), mark their programs "entered", and are never offered again.
   */
  entries?: { program_id: string; title: string; name: string; submitted: boolean; id?: number }[];
  /**
   * v2.9 A3 (builder-memory.ts hiddenPrograms): programs the builder is not interested in, or applied
   * to outside EarnKit this round. Never in a table or the offer; applied ones are listed in "Your
   * entries" as "applied outside EarnKit".
   */
  hidden?: { notInterested: Set<string>; applied: Set<string> };
  /**
   * v2.10 item 15 (alerts.ts takeDeadlineLine): "Arc Microgrants closes in 2 days; your entry isn't
   * submitted.", right after "Your entries" (R12), or null. Pre-flight P19: T8 reuses it.
   */
  deadline?: string | null;
  /**
   * v2.10 item 2: "show more". False (the default): the short first reply, news, entries and the
   * deadline line, then one lead line (leadLine). True: today's tables (the v2.9 body).
   */
  more?: boolean;
  /**
   * v2.10 Ruling H10 (I3): one question per reply. A higher question (the pickup, then the outcome
   * question) is asked in this reply, so this message asks none: no lead line (short) and no
   * closing offer (more). The lead waits for a later reply.
   */
  holdQuestion?: boolean;
  /**
   * v2.9 E20 (stats.ts builders_won_usd): the announced prizes EarnKit builders won. Above 0, "Builders
   * using EarnKit won $X." follows the headline once; 0 or unset, no line (never "$0").
   */
  wonUsd?: number;
  /** v2.11 T7: the no-repo lead's switches (FreshOn); absent, the short reply is v2.10's. */
  fresh?: FreshOn;
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

/** v2.8 Ruling 16 (plan): an empty table cell (no difficulty). Never an em dash. */
export { NO_CELL };

/** The Difficulty cell (v2.7 §3, Ruling 12 (plan)): the label only, or NO_CELL with none. Pure. */
export function difficultyCell(c: Pick<Card, 'difficulty'>): string {
  return c.difficulty ? difficultyLabel(c.difficulty) : NO_CELL;
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
      /**
       * v2.10 item 7: named repos GitHub won't show that nobody described; `link` is the read-only
       * App's link (item 7b), set by list_programs only while the App is on.
       */
      unseen?: { name: string; full_name: string; link?: string | null }[];
      /**
       * v2.10 item 7: private repos matched from the agent's local report; `link` (final fix I2) is the
       * App's link, set by list_programs on the first one only, while the App is on and it has no proof.
       */
      fromLocal?: { name: string; full_name: string; link?: string | null }[];
      /** v2.10.1 B4: repos the agent named that got no row, and why (match-projects.ts SKIP_REASONS). */
      skipped?: { name: string; reason: string }[];
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
 * Scoring and clarity R12 (Task 4 fix round 1): the one order of the fits find and score name: the soonest
 * deadline first, rolling programs last, then the bigger known per-winner award, then the id (stable). Pure.
 */
export const byDeadline = (a: Pick<Card, 'id' | 'max_award_usd' | 'ends_at'>, b: Pick<Card, 'id' | 'max_award_usd' | 'ends_at'>) => {
  const at = (c: Pick<Card, 'ends_at'>) => (c.ends_at ? new Date(c.ends_at).getTime() : 8.64e15);
  return at(a) - at(b) || (b.max_award_usd ?? -1) - (a.max_award_usd ?? -1) || a.id.localeCompare(b.id);
};

/**
 * v3 Stage 2 (Base first): the program list's order (landing and /programs tiles, and the one upcoming
 * line): open before upcoming; then Base programs and programs open to any chain; then the sooner
 * deadline (rolling last); then the bigger known per-winner award; then the id (stable). Pure.
 */
export const byRelevance = (
  a: Pick<Card, 'id' | 'status' | 'chains' | 'any_chain' | 'ends_at' | 'max_award_usd'>,
  b: Pick<Card, 'id' | 'status' | 'chains' | 'any_chain' | 'ends_at' | 'max_award_usd'>,
) => {
  const later = (c: typeof a) => Number(c.status === 'upcoming');
  const base = (c: typeof a) => Number(c.any_chain === true || (c.chains ?? []).includes('base'));
  const at = (c: typeof a) => (c.ends_at ? new Date(c.ends_at).getTime() : 8.64e15);
  return later(a) - later(b) || base(b) - base(a) || at(a) - at(b) || (b.max_award_usd ?? -1) - (a.max_award_usd ?? -1) || a.id.localeCompare(b.id);
};

/**
 * v2.8 Ruling C4: Easy programs first (the lazy builder wants the easiest money), for the agent's
 * tables only; the landing and /programs use byRelevance. Pure.
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

/** v2.10 item 6 (Pre-flight P14): the matched table's heading when every row has low odds (never "fit"). */
export const LOW_ODDS_HEADING = 'Programs your repos could reach:';

const CHAT_ONLY =
  "I can't build or deploy from here, but I can plan it and write every answer for you to submit. To have it done for you, add EarnKit to a coding agent (Claude Code, Cursor, Codex).";

/**
 * v2.10 item 7: one line per private repo matched from its local report (final fix I2: the first may
 * carry the App's link), and one for the first named repo EarnKit can't see (with the App's link when
 * it is on); null when there are none. Pure.
 */
export function privateRepoLines(r: YourRepos | null): string | null {
  if (!r || 'error' in r) return null;
  const first = r.unseen?.[0];
  const byName = new Map<string, string | null>();
  for (const l of r.fromLocal ?? []) byName.set(l.name, byName.get(l.name) ?? l.link ?? null);
  const lines = [...byName].map(([name, link]) => PRIVATE_LOCAL_LINE(name, link));
  if (first) lines.push(CANT_SEE_LINE(first.name, first.link ?? null));
  // v2.10.1 B4: no repo the agent named is ever dropped silently: one line for all of them.
  const skipped = skippedLine(r);
  if (skipped) lines.push(skipped);
  return lines.length ? lines.join('\n') : null;
}

/**
 * v2.10.1 B4: "Not matched: earnkit (EarnKit's own repo); notes (no onchain code found)." for every
 * repo the agent named that got no row, or null. Declarative, so the reply keeps its one question. Pure.
 */
export function skippedLine(r: YourRepos | null): string | null {
  if (!r || 'error' in r || !r.skipped?.length) return null;
  return `Not matched: ${r.skipped.map((x) => `${x.name} (${x.reason})`).join('; ')}.`;
}

/** No repo to match: none reported, or none found under the builder's GitHub user. */
const noRepo = (r: YourRepos | null) => r === null || ('checked' in r && r.checked === 0);

/**
 * Ruling 11 (plan): a matching error gets the same no-repo treatment as 0 repos found — "$X is
 * open right now." with ideas, just never "You could" (youCould stays false for an error). Pure.
 */
const noMatch = (r: YourRepos | null) => noRepo(r) || (r !== null && 'error' in r);

/** v2.9 A4: a matched row's difficulty (guide.ts rowDifficulty), or null when the program has none. */
type RowLevel = { level: Level; estimate: boolean } | null;
/**
 * `key`, `product_score`: the repo's key and score (match-loop.ts recordShown), when matching gave them.
 * v2.10 item 6: `odds` and `low_reason` (match.ts rowOdds), and the repo's `traction` (0 when unscored).
 */
export type Fit = {
  card: Card;
  repo: string;
  repo_url: string | null;
  v: Verdict;
  row: RowLevel;
  key: string | null;
  product_score: number | null;
  odds: Odds;
  traction: number;
  low_reason: string | null;
  /** v2.11 8a (S5): the repo has real use (measured, or the builder's users claim): it outranks traction. */
  real_use: boolean;
};

/** v2.10 item 6: a low-odds row's label in its "Your repo" cell. Pure. */
export const lowOddsCell = (reason: string) => `low odds: ${reason}`;

/** v2.10 item 6: good odds first. v2.11 8a (S5): good, then unknown, then low; then real use. Pure. */
const byOdds = (a: Pick<Fit, 'odds' | 'real_use'>, b: Pick<Fit, 'odds' | 'real_use'>) =>
  oddsRank(a.odds) - oddsRank(b.odds) || Number(b.real_use) - Number(a.real_use);
/** v2.10 item 6 (Pre-flight P12): whether `a` is the better row for a program: good odds, then real use (v2.11 S5), then traction. Pure. */
const betterFit = (a: Pick<Fit, 'odds' | 'traction' | 'real_use'>, b: Pick<Fit, 'odds' | 'traction' | 'real_use'>) =>
  (byOdds(a, b) || b.traction - a.traction) < 0;

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
 * v2.8.1 §B9: the programs the builder already entered. v2.10.1 B1: every entry counts, submitted or
 * not: an entry not submitted yet is already confirmed (projects.ts openEntries), so the only step
 * left is the builder's own submission on the program's site (submitStep), never "finish it" or
 * "keep going" again. Pure.
 */
// v2.12.1 T10 (plan S7): a coin entry is never a program entry.
export const enteredIds = (m: Pick<FirstMessage, 'entries'>) => new Set((m.entries ?? []).filter((e) => e.program_id !== COIN_PROGRAM).map((e) => e.program_id));

/**
 * v2.10.1 B1: the entry whose only step left is the builder's submission on the program's site: the
 * first (newest) entry not submitted yet, in a program still shown. Undefined without one. Pure.
 */
export function submitStep(m: Pick<FirstMessage, 'entries' | 'cards'>): { entry: NonNullable<FirstMessage['entries']>[number]; card: Card } | undefined {
  const byId = new Map(m.cards.map((c) => [c.id, c]));
  for (const e of m.entries ?? []) {
    const card = byId.get(e.program_id);
    if (!e.submitted && card && !card.sponsored) return { entry: e, card };
  }
  return undefined;
}

/**
 * v2.10.1 B1: the submit-step lead, one line and one question: "Your tipjar entry for Arc
 * Microgrants is ready. The only step left: submit it on DoraHacks by Oct 14. Did you submit it?".
 * The site is the program's (programs.ts submitSiteName), else "the program's site"; "by" its own
 * close day, dropped for a rolling one. Pure; exported for tests.
 */
export function submitStepLine(s: NonNullable<ReturnType<typeof submitStep>>): string {
  const day = closeDayOf(s.card);
  return (
    `Your ${s.entry.name} entry for ${s.card.title} is ready. ` +
    `The only step left: submit it on ${s.card.submit_site ?? "the program's site"}${day ? ` by ${day}` : ''}. Did you submit it?`
  );
}

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
    ...(m.entries ?? []).filter((e) => e.program_id !== COIN_PROGRAM).map((e) => `${titles.get(e.program_id) ?? e.title} (${e.name}, ${e.submitted ? 'submitted' : 'not submitted yet'})`),
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
export const qualifies = (r: Fit) => r.odds === 'good' && !r.card.investment && !r.v.missing.includes('new_work');

/**
 * What the first message shows: the programs the builder's repos fit (each curated program once,
 * under the repo that fits it best, by prize per winner), and the other curated programs shown
 * (at most 5) plus how many more. Shared with list_programs. Pure; exported for tests.
 */
export function layout(m: Pick<FirstMessage, 'cards' | 'repos' | 'entries'>, done = enteredIds(m)) {
  const byId = new Map(m.cards.map((c) => [c.id, c]));
  // v2.8.1 §B9: programs already entered go after the rest.
  const enteredLast = (a: Pick<Card, 'id'>, b: Pick<Card, 'id'>) => Number(done.has(a.id)) - Number(done.has(b.id));
  const curated = (id: string) => byId.has(id) && !byId.get(id)!.sponsored;
  const fits = m.repos && 'fits' in m.repos ? m.repos.fits : [];
  const matched = new Map<string, Fit>();
  for (const f of fits)
    for (const v of [...f.verdicts].sort((a, b) => quickness(a) - quickness(b))) {
      if (v.status === 'no' || !curated(v.program_id)) continue;
      const odds = rowOdds(f.product, v, f.facts?.chains ?? {});
      const fit: Fit = {
        card: byId.get(v.program_id)!,
        repo: f.repo,
        repo_url: f.repo_url,
        v,
        row: rowLevel(byId.get(v.program_id)!, f, v),
        key: f.key ?? null,
        product_score: f.product?.score ?? null,
        odds: odds.odds,
        traction: f.product?.traction ?? 0,
        low_reason: odds.low_reason,
        real_use: f.facts ? hasRealUse(f.facts) : false,
      };
      // v2.10 item 6 (Pre-flight P12): per program, the repo with good odds, then more traction; else the first.
      const kept = matched.get(v.program_id);
      if (!kept || betterFit(fit, kept)) matched.set(v.program_id, fit);
    }
  // v2.10 item 6: good odds first, then traction (high first); then v2.9 A4: by the row's difficulty
  // (Easy first), then prize, then the quicker fit. v2.11 8a (S5): real use before traction (byOdds).
  const rows = [...matched.values()].sort(
    (a, b) =>
      enteredLast(a.card, b.card) ||
      byOdds(a, b) ||
      b.traction - a.traction ||
      byRowLevel(a, b) ||
      byPrize(a.card, b.card) ||
      quickness(a.v) - quickness(b.v),
  );
  const rest = m.cards
    .filter((c) => !c.sponsored && !matched.has(c.id))
    .sort((a, b) => enteredLast(a, b) || byEaseThenPrize(a, b));
  const shown = rest.slice(0, MAX_OTHERS);
  return { byId, rows, shown, more: rest.length - shown.length };
}

/**
 * v2.10 item 2 (R14): the short first reply's lead row: the top row by the item 6 rank that the
 * builder qualifies for (good odds, never an investment or a low-odds row) and hasn't entered. Pure.
 */
export const leadRow = (m: Pick<FirstMessage, 'cards' | 'repos' | 'entries'>, entered = enteredIds(m)): Fit | undefined =>
  layout(m, entered).rows.find((r) => qualifies(r) && !r.card.sponsored && !entered.has(r.card.id));

/**
 * v2.9 F21: the no-repo headline, "$1.1M+ in prizes open right now." with the site's figure
 * (moneyText(openMoneyUsd) over every open curated program), else "These programs are open right now.".
 * Pure.
 */
const openHeadline = (fig: string | null) =>
  fig ? `${fig} in prizes open right now.` : 'These programs are open right now.';

/** v2.10 item 2: the short first reply's question when no repo leads; a yes is "show more". */
export const MORE_QUESTION = 'Want the 3 easiest?';

/**
 * v2.10 item 2, R14: the short first reply's lead. With a row (the top good-odds row by the item 6
 * rank): "Your TipJar can win 500 USDC on Arc by Oct 14. Want me to finish it?", the prize per
 * winner (Pre-flight P7: prizeOf cut at " × "), "on <chain>" dropped for an any-chain program, "by"
 * the program's own close day (P1), dropped for a rolling one. Without one: "No repo fits yet. $X is
 * open; want the 3 easiest?" when repos were matched, else "$X is open. Want the 3 easiest?". Pure.
 */
export function leadLine(r: Fit | undefined, m: Pick<FirstMessage, 'cards' | 'repos' | 'now'>): string {
  const fig = moneyText(openMoneyUsd(m.cards, m.now)) ?? 'Money';
  if (!r) return noMatch(m.repos) ? `${fig} is open. ${MORE_QUESTION}` : `No repo fits yet. ${fig} is open; want the 3 easiest?`;
  const chain = r.card.any_chain || !r.card.chains?.length ? '' : ` on ${CHAIN_NAMES[r.card.chains[0]]}`;
  const day = closeDayOf(r.card);
  return `Your ${r.repo} can win ${prizeOf(r.card).split(' × ')[0]}${chain}${day ? ` by ${day}` : ''}. Want me to finish it?`;
}

/**
 * v2.10.1 fix round 1 (C1): the repo to ask about users instead of leading. EarnKit can't measure use
 * for a product with no contract of its own (tokens.fun launches through shared contracts), so a
 * product-tier repo with good odds, no measured use, no users claim and no answer yet, whose open
 * program waits only on real users, is asked about once it ranks above the lead's repo (or there is
 * no lead): the builder's answer goes to tell (has_users) and decides. v2.11 8a (S3, S4): so is a
 * repo EarnKit couldn't read (odds unknown), wherever it ranks, unless the lead's repo has real use.
 * v2.10.2 fix round 1 (C1): one pick across all repos (unknown first, then products, a grant before
 * an investment), never a starter (starterRepo); a yes or no is final. Undefined otherwise. Pure.
 */
/** v2.10.2 fix round 2: a starter is never asked about users. Days a repo counts as new. */
export const STARTER_DAYS = 30;
/**
 * v2.10.2 fix round 2 (re-review R1-I1): a starter, told apart by age or origin, never by traction:
 * created within STARTER_DAYS (GitHub's created_at, or the first commit the agent reports), or made
 * from a template or an EarnKit starter (`original` missing: a fork, a template, a starter name). A
 * repo of unknown age and no template mark is not a starter. Free signals only. Pure.
 */
export const starterRepo = (f: Pick<RepoFit, 'product' | 'facts'>, now: Date): boolean => {
  if (f.product?.missing.includes('original')) return true;
  const born = Date.parse(f.facts?.created_at ?? '');
  return Number.isFinite(born) && now.getTime() - born < STARTER_DAYS * 86_400_000;
};

export function usersAsk(
  m: Pick<FirstMessage, 'cards' | 'repos' | 'entries'> & { now?: Date },
  lead: Fit | undefined,
): { repo: string; key: string | null; card: Card } | undefined {
  if (!m.repos || !('fits' in m.repos)) return undefined;
  const byId = new Map(m.cards.map((c) => [c.id, c]));
  const entered = enteredIds(m);
  const fits = m.repos.fits;
  const leadAt = lead ? fits.findIndex((f) => f.repo === lead.repo) : fits.length;
  const above = (i: number) => i < (leadAt < 0 ? fits.length : leadAt);
  const now = m.now ?? new Date();
  const leadFit = leadAt >= 0 && lead ? fits[leadAt] : undefined;
  const starterLead = Boolean(leadFit && !lead?.real_use && starterRepo(leadFit, now));
  // A grant before an investment, then the top prize.
  const byGrant = (a: Card, b: Card) => Number(Boolean(a.investment)) - Number(Boolean(b.investment)) || byPrize(a, b);
  const asks: { group: number; at: number; repo: string; key: string | null; card: Card }[] = [];
  for (const [i, f] of fits.entries()) {
    if (!f.facts || hasRealUse(f.facts) || f.facts.users_said != null) continue;
    // v2.11 8a (S3, S4): a repo EarnKit couldn't read (odds unknown), wherever it ranks, unless the
    // lead's own repo has real use. Fix round 1 (I1): on a row that waits on users, or on one with
    // nothing missing (the yes promotes it everywhere), so it is never stuck unasked.
    const unknown = f.product?.odds === 'unknown' && !lead?.real_use;
    // v2.10.1 C1: a good-odds product ranked above the lead. Fix round 1 (C1), round 2: never a starter
    // (starterRepo: under 30 days old, or a template or EarnKit starter).
    // Round 2: a lead on a starter never outranks a real product's question.
    const product = (above(i) || starterLead) && f.product?.tier === 'product' && f.product.odds === 'good' && !starterRepo(f, now);
    if (!unknown && !product) continue;
    const waits = (v: Verdict) => (v.missing.length === 1 && v.missing[0] === 'real_users') || (unknown && v.missing.length === 0);
    const waiting = f.verdicts
      .filter(waits)
      .map((v) => ({ card: byId.get(v.program_id), users: v.missing.length > 0 }))
      .filter((w): w is { card: Card; users: boolean } => w.card !== undefined && !w.card.sponsored && !entered.has(w.card.id))
      .sort((a, b) => byGrant(a.card, b.card) || Number(b.users) - Number(a.users));
    if (waiting[0]) asks.push({ group: unknown ? 0 : 1, at: i, repo: f.repo, key: f.key ?? null, card: waiting[0].card });
  }
  // Fix round 1 (C1): across every repo: the repos EarnKit couldn't read first, then products; a grant
  // before an investment; then the fits order.
  const [best] = asks.sort((a, b) => a.group - b.group || byGrant(a.card, b.card) || a.at - b.at);
  return best && { repo: best.repo, key: best.key, card: best.card };
}

/**
 * v2.10.1 fix round 1 (C1): "tokens.fun could win up to $5,000 on Base with real users. Does it have
 * real users or revenue? (yes/no)". Money first, one question. Pure; exported for tests.
 */
export function usersAskLine(a: NonNullable<ReturnType<typeof usersAsk>>): string {
  const chain = a.card.any_chain || !a.card.chains?.length ? '' : ` on ${CHAIN_NAMES[a.card.chains[0]]}`;
  // Fix round 1 (M6): a range prize ("$5,000 to $100,000 USDC grants") reads "up to $100,000".
  const prize = prizeOf(a.card).split(' × ')[0];
  const ask = 'Does it have real users or revenue? (yes/no)';
  // Re-review 2 (R2-I1): an investment is never money to win: "could get up to $1M investment from a16z".
  if (a.card.investment) return `${a.repo} could get ${prize} from ${a.card.title} with real users. ${ask}`;
  const money = /^\$[\d,.]+[KM]? to /.test(prize) && a.card.max_award_usd ? `up to ${usd(a.card.max_award_usd)}` : prize;
  return `${a.repo} could win ${money}${chain} with real users. ${ask}`;
}

/**
 * v2.11 spec 1: the no-repo lead the short first reply shows, or undefined. Only when nothing else
 * leads: not "show more", no higher question held, no entry waiting on the builder's submission
 * (submitStep), no good-odds row (leadRow), no users question (usersAsk), no open program the
 * builder's agent is preparing (working_on), and no repo read error or repo EarnKit can't see. Then freshPick over the programs not hidden or entered.
 * Pure; tools.ts reads it for build_offer.
 */
export function freshLead(given: FirstMessage): (FreshPick & { canBuild: boolean }) | undefined {
  const on = given.fresh;
  if (!on || given.more || given.holdQuestion) return undefined;
  // v3 Stage 2: an upcoming program is never in an open table or the offer (tools.ts leaves it out too).
  const hidden = new Set([...(given.hidden?.notInterested ?? []), ...(given.hidden?.applied ?? [])]);
  const m: FirstMessage =
    hidden.size || given.cards.some((c) => c.status === 'upcoming')
      ? { ...given, cards: given.cards.filter((c) => !hidden.has(c.id) && c.status !== 'upcoming') }
      : given;
  // Review M1: a repo read error or a repo EarnKit can't see may still fit; never lead past it.
  if (m.repos && ('error' in m.repos || m.repos.unseen?.length)) return undefined;
  const entered = enteredIds(m);
  if (submitStep(m)) return undefined;
  const lead = leadRow(m, entered);
  if (lead || usersAsk(m, lead)) return undefined;
  const byId = new Set(m.cards.map((c) => c.id));
  if (m.workingOn.some((id) => byId.has(id) && !entered.has(id))) return undefined;
  const pick = freshPick(m.cards, m.now, { hidden, entered, deployOn: on.deployOn, hostOn: on.hostOn, starters: on.starters });
  return pick && { ...pick, canBuild: on.canBuild };
}

/** The first message: see the type and the module comment for the order. Pure; exported for tests. */
export function presentFirstMessage(given: FirstMessage): string {
  const sections: string[] = [];
  if (given.alerts.length) sections.push(`Since you last checked: ${given.alerts.join('; ')}.`);
  // v2.8.1 §B9: the returning builder's entries come first, right after any news (the daily check
  // messages the builder only when the reply starts with news).
  const recap = entriesLine(given);
  if (recap) sections.push(recap);
  // v2.10 item 15 (R12, Pre-flight P19): the deadline line right after "Your entries".
  if (given.deadline) sections.push(given.deadline);
  const bodyStart = sections.length;
  const done = () => withWonLine(sections, bodyStart, given.wonUsd).join('\n\n');
  // v2.9 A3: a program the builder is not interested in, or applied to outside EarnKit, leaves
  // every table and the offer.
  // v3 Stage 2: an upcoming program is never in an open table or the offer (tools.ts leaves it out too).
  const hidden = new Set([...(given.hidden?.notInterested ?? []), ...(given.hidden?.applied ?? [])]);
  const m: FirstMessage =
    hidden.size || given.cards.some((c) => c.status === 'upcoming')
      ? { ...given, cards: given.cards.filter((c) => !hidden.has(c.id) && c.status !== 'upcoming') }
      : given;
  // Only open EarnKit campaigns get a table (Campaign #1 is closed: none).
  const campaigns = m.campaigns.filter((r) => r.open).sort(byCampaignPrize);
  if (campaigns.length === 0 && m.cards.length === 0) {
    const results = m.campaigns.some((r) => r.you === 'in review');
    sections.push(`Nothing is open right now. ${results ? 'Want me to tell you when the results are in?' : TELL_WHEN_OPENS}`);
    return done();
  }

  const entered = enteredIds(m);
  const { byId, rows, shown, more } = layout(m, entered);
  // v2.10 item 7: the private and can't-see lines, before the matched table (or the lead).
  const privateLines = privateRepoLines(m.repos);
  // v2.10 item 2 (R12, R14): news, entries and the deadline line, one line each, then the private
  // lines and the one lead. Everything else is behind "show more". No won line (no headline).
  const step = submitStep(m);
  if (!given.more) {
    const lead = leadRow(m, entered);
    const ask = usersAsk(m, lead);
    // v2.11 spec 1: with nothing else to lead, one context line and one small program to build.
    const fresh = step || lead || ask ? undefined : freshLead(given);
    return [
      ...sections,
      privateLines,
      m.repos && 'error' in m.repos ? `Couldn't read your repos: ${m.repos.error}` : null,
      // v2.10.1 B1: an entry not submitted yet leads: its only step left is the builder's submission.
      // Fix round 1 (C1): then a product EarnKit can't measure, ranked above the lead, is asked about users.
      given.holdQuestion
        ? null
        : step
          ? submitStepLine(step)
          : ask
            ? usersAskLine(ask)
            : fresh
              ? [contextLine(given.cards, m.now), freshLeadLine(fresh, m.now, fresh.canBuild)].filter(Boolean).join('\n')
              : leadLine(lead, { cards: given.cards, repos: m.repos, now: m.now }),
    ]
      .filter((x): x is string => Boolean(x))
      .join('\n');
  }
  if (privateLines) sections.push(privateLines);
  if (m.repos && 'error' in m.repos) sections.push(`Couldn't read your repos: ${m.repos.error}`);
  else if (m.repos && !noRepo(m.repos) && rows.length === 0)
    sections.push(
      `None of your ${m.repos.checked} repo${m.repos.checked === 1 ? '' : 's'} fits an open program yet.`,
    );
  else if (rows.length > 0) {
    // v2.9 F21: the same function as the site's figure, over the rows the builder qualifies for
    // now (v2.8.1 §B10).
    // v2.10 item 6: a low-odds row is never counted, and never called a fit (Pre-flight P14).
    const fig = moneyText(openMoneyUsd(rows.filter(qualifies).map((r) => r.card), m.now));
    const anyGood = rows.some((r) => r.odds === 'good');
    sections.push(
      `${fig ? `EarnKit matches you to ${fig} in prizes you qualify for.` : anyGood ? 'Your repos fit these open programs:' : LOW_ODDS_HEADING}\n\n` +
        table(
          ['Program', 'Prize', 'Difficulty', 'Ends', 'Your repo'],
          rows.map(({ card, repo, v, row, odds, low_reason }) => {
            return [
              programCell(card, entered, false),
              prizeOf(card),
              rowCell(card, row),
              endsOf(card),
              odds === 'low'
                ? `${repo}, ${lowOddsCell(low_reason ?? NOT_REAL_YET)}`
                : // v2.11 8a (S3): an unknown row is never "low odds".
                  odds === 'unknown' && low_reason
                  ? `${repo}, ${low_reason}`
                  : v.status === 'likely' || !v.note ? repo : `${repo}, ${v.note}`,
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

  // The one closing offer.
  const close = offer(m, byId, rows, ideas.length > 0, entered);
  if (!given.holdQuestion) sections.push(close.text);
  return done();
}

const isEasy = (c: Card) => c.difficulty?.level === 'Easy';

/** Ruling 28: "build something new" for a program, saying what only the builder can give. Pure. */
const buildNew = (c: Card): Offer => ({
  text: `Want me to build something new for ${c.title} (${prizeOf(c)})?${needsForms(c) ? needsText(c) : ''}`,
  campaign: false,
});

/** v2.8.1 §B7, Ruling F5; v2.9 A4: the fit to offer: good odds first (v2.10 item 6), then the easiest row, then the top prize, then the quicker fit. Pure. */
const bestFit = (rows: Fit[]): Fit | undefined =>
  // v2.10.2 fix round 1 (M4): never an unknown row (its builder is asked about users instead).
  [...rows.filter((r) => r.odds !== 'unknown')].sort((a, b) => byOdds(a, b) || byRowLevel(a, b) || byPrize(a.card, b.card) || quickness(a.v) - quickness(b.v))[0];

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

/** One closing offer (offer's text), and whether it's an EarnKit campaign entry (Ruling 10 (plan)). */
type Offer = {
  text: string;
  campaign: boolean;
};

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
  // v2.8.1 §B7, Ruling F5: a fit for the builder's repo always comes first (Easy first, then the
  // top prize); building something new is offered only when no repo fits.
  const pick = bestFit(rows.filter((r) => offerable(r.card)));
  // v2.8.1 §B8: with no repo, the program the builder can enter as they are (known not to need one).
  // v2.10 Ruling H1 (c1): the same pick as the "No repo yet?" line (noRepoPick).
  const asTheyAre = noMatch(m.repos) ? noRepoPick(m.cards.filter(offerable)) : undefined;
  // v2.10.1 B1: an entry not submitted yet comes before any new start: submitting it is all that's
  // left.
  const step = submitStep(m);
  if (step) return { text: submitStepLine(step), campaign: false };
  if (!m.agentCanBuild) {
    const named = pick ? `${pick.card.title} with ${pick.repo}` : asTheyAre?.title;
    return { text: named ? `Want me to start on ${named}? ${CHAT_ONLY}` : CHAT_ONLY, campaign: false };
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
    return { text: `Want me to keep going on ${resume.text}?`, campaign: resume.campaign };
  const campaign = [...m.campaigns].sort(byCampaignPrize).find((r) => r.open && r.you === null);
  if (campaign) return { text: `Want me to build your entry for the ${usd(campaign.prize_usd_each)}?`, campaign: true };
  if (pick)
    return { text: `Want me to start on ${pick.card.title} with ${pick.repo}?${needsForms(pick.card) ? needsText(pick.card) : ''}`, campaign: false };
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
