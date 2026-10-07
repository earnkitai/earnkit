import { normalizeRepoUrl, usd } from './campaigns';
import { endsOf, prizeOf, repoCoinNote } from './entry-text';
import { shortDate } from './dates';
import { EFFORT_ORDER, type Chain, type Effort, type Verdict } from './match';
import { difficultyLabel, type Difficulty } from './guide';
import { openFigure } from './pool';

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
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows in "Also open" (spec §1). */
const MAX_OTHERS = 5;
/** Ideas under "Ideas I can build"/"Ideas for these programs" in all (v2.6 §1). */
const MAX_IDEAS = 6;

/**
 * The per-winner sum: each program's top per-winner prize, once per program; programs without a
 * stated per-winner amount count 0. v2.8 Ruling 24 (plan): only /api/stats' open_money_usd uses it
 * now; the first message uses openFigure. Pure.
 */
export function openMoneyUsd(matched: Pick<Card, 'id' | 'max_award_usd'>[]): number {
  const seen = new Map(matched.map((c) => [c.id, c.max_award_usd ?? 0]));
  return [...seen.values()].reduce((a, b) => a + b, 0);
}

/** "0.42" from wei, two decimals, rounded down. Exported for alerts.ts (the bonus win amount). */
export const eth = (wei: bigint) => {
  const cents = wei / 10n ** 16n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
};

/** v2.8 Ruling 16 (plan): an empty table cell (no bonus, no difficulty). Never an em dash. */
export const NO_CELL = '';

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

/** v2.8 Ruling 25 (plan): the first message's token line, before the bonus total. */
export const TOKEN_LINE =
  'Every entry gets a token: you earn 40% of its trading fees, and its fees fund the builder bonus.';
/** The token line when no program on screen has a builder bonus. */
export const TOKEN_LINE_NO_BONUS = 'Every entry gets a token: you earn 40% of its trading fees.';

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
 * this program's builder bonus (one coin per repo); Ruling 13 (plan): the note now shows in the
 * row's repo cell instead of a bonus column. Null otherwise. Pure.
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
export type YourRepos =
  | {
      checked: number;
      /** repo_url is null for private/local repos the agent reported. */
      fits: { repo: string; repo_url: string | null; verdicts: Verdict[] }[];
    }
  | { error: string };

/** Ruling 11 (plan): "You could" only with no repo known and no GitHub user given or remembered. Pure. */
export const youCould = (repos: YourRepos | null, githubGiven: boolean) => repos === null && !githubGiven;

/**
 * Program news for the body (never "Since you last checked", I7): new curated ones by name, new
 * sponsored ones counted (re-audit H4), curated ones closing within 3 days. None on a first check.
 * Pure.
 */
export function programUpdates(cards: Card[], firstCheck: boolean): string[] {
  if (firstCheck) return [];
  const named = cards.filter((c) => !c.sponsored);
  const sponsoredNew = cards.filter((c) => c.sponsored && c.is_new).length;
  return [
    ...named.filter((c) => c.is_new).map((c) => `new: ${c.title}`),
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

type Fit = { card: Card; repo: string; repo_url: string | null; v: Verdict };

/**
 * What the first message shows: the programs the builder's repos fit (each curated program once,
 * under the repo that fits it best, by prize per winner), and the other curated programs shown
 * (at most 5) plus how many more. Shared with list_programs, so the bonus pools are read once and
 * only for programs on screen. Pure; exported for tests.
 */
export function layout(m: Pick<FirstMessage, 'cards' | 'repos'>) {
  const byId = new Map(m.cards.map((c) => [c.id, c]));
  const curated = (id: string) => byId.has(id) && !byId.get(id)!.sponsored;
  const fits = m.repos && 'fits' in m.repos ? m.repos.fits : [];
  const matched = new Map<string, Fit>();
  for (const f of fits)
    for (const v of [...f.verdicts].sort((a, b) => quickness(a) - quickness(b)))
      if (v.status !== 'no' && curated(v.program_id) && !matched.has(v.program_id))
        matched.set(v.program_id, { card: byId.get(v.program_id)!, repo: f.repo, repo_url: f.repo_url, v });
  // v2.8 Ruling C4: Easy programs first, then by prize.
  const rows = [...matched.values()].sort((a, b) => byEaseThenPrize(a.card, b.card));
  const rest = m.cards.filter((c) => !c.sponsored && !matched.has(c.id)).sort(byEaseThenPrize);
  const shown = rest.slice(0, MAX_OTHERS);
  return { byId, rows, shown, more: rest.length - shown.length };
}

/** Programs on screen whose entries can earn the builder bonus: the ones whose pool is read. Pure. */
export const bonusProgramIds = (m: Pick<FirstMessage, 'cards' | 'repos'>) => {
  const { rows, shown } = layout(m);
  return [...rows.map((r) => r.card), ...shown].filter((c) => c.builder_bonus !== false).map((c) => c.id);
};

/**
 * v2.8 Ruling 24 (plan): the no-repo headline, "$1.3M+ in prizes open right now." with the site's
 * figure (openFigure over every open curated program), else "These programs are open right now.".
 * Pure.
 */
const openHeadline = (fig: string | null) =>
  fig ? `${fig} in prizes open right now.` : 'These programs are open right now.';

/** The first message: see the type and the module comment for the order. Pure; exported for tests. */
export function presentFirstMessage(m: FirstMessage): string {
  const sections: string[] = [];
  if (m.alerts.length) sections.push(`Since you last checked: ${m.alerts.join('; ')}.`);
  // Only open EarnKit campaigns get a table (Campaign #1 is closed: none).
  const campaigns = m.campaigns.filter((r) => r.open).sort(byCampaignPrize);
  if (campaigns.length === 0 && m.cards.length === 0) {
    const results = m.campaigns.some((r) => r.you === 'in review');
    return [
      ...sections,
      `Nothing is open right now. ${results ? 'Want me to tell you when the results are in?' : TELL_WHEN_OPENS}`,
    ].join('\n\n');
  }

  const { byId, rows, shown, more } = layout(m);
  if (m.repos && 'error' in m.repos) sections.push(`Couldn't read your repos: ${m.repos.error}`);
  else if (m.repos && !noRepo(m.repos) && rows.length === 0)
    sections.push(
      `None of your ${m.repos.checked} repo${m.repos.checked === 1 ? '' : 's'} fits an open program yet.`,
    );
  else if (rows.length > 0) {
    // v2.8 Ruling 24 (plan): the matched programs' pools, the same figure the site uses.
    const fig = openFigure(rows.map((r) => r.card));
    sections.push(
      `${fig ? `EarnKit matches you to ${fig} in prizes you qualify for.` : 'Your repos fit these open programs:'}\n\n` +
        table(
          ['Program', 'Prize', 'Difficulty', 'Ends', 'Your repo'],
          rows.map(({ card, repo, repo_url, v }) => {
            const base = v.status === 'likely' || !v.note ? repo : `${repo}, ${v.note}`;
            const elsewhere = repoCoinElsewhere(m, card, repo_url);
            return [
              card.title,
              prizeOf(card),
              difficultyCell(card),
              endsOf(card),
              elsewhere ? `${base} (${elsewhere})` : base,
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
          ? openHeadline(openFigure(m.cards.filter((c) => !c.sponsored && !c.earnkit_campaign)))
          : above
            ? 'Also open:'
            : 'Open money right now:'
      }\n\n` +
        table(
          ['Program', couldWin ? 'You could win' : 'Prize', 'Difficulty', 'Ends'],
          shown.map((c) => [c.title, prizeOf(c), difficultyCell(c), endsOf(c)]),
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
  const close = offer(m, byId, rows, ideas.length > 0);
  const apart = close.campaign || !!close.noBonusId;
  const bonus = bonusClose([...rows.map((r) => r.card), ...shown].filter((c) => c.id !== close.noBonusId), apart);
  if (!bonus) sections.push(close.text);
  else if (apart) sections.push(bonus, close.text);
  else sections.push(`${close.text} ${bonus}`);
  return sections.join('\n\n');
}

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
): Offer {
  if (!m.agentCanBuild) return { text: CHAT_ONLY, campaign: false };
  const titleOf = (id: string): Offer | undefined => {
    const c = byId.get(id);
    if (c) return c.sponsored ? undefined : { text: c.title, campaign: false };
    const camp = m.campaigns.find((r) => r.id === id && r.open);
    return camp ? { text: camp.title, campaign: true } : undefined;
  };
  // M4: the program offered, when its matched row says the repo's token is entered elsewhere.
  const noBonus = (r: Fit | undefined) =>
    r && repoCoinElsewhere(m, r.card, r.repo_url) ? { noBonusId: r.card.id } : {};
  const resumeId = m.workingOn.find((id) => titleOf(id));
  const resume = resumeId && titleOf(resumeId);
  if (resume)
    return {
      text: `Want me to keep going on ${resume.text}?`,
      campaign: resume.campaign,
      ...noBonus(rows.find((r) => r.card.id === resumeId)),
    };
  const campaign = [...m.campaigns].sort(byCampaignPrize).find((r) => r.open && r.you === null);
  if (campaign) return { text: `Want me to build your entry for the ${usd(campaign.prize_usd_each)}?`, campaign: true };
  const byHour = [...rows].sort(
    (a, b) => prizePerHour(b.card, b.v) - prizePerHour(a.card, a.v) || quickness(a.v) - quickness(b.v),
  );
  const fastest = byHour.find((r) => !needsForms(r.card));
  if (fastest)
    return { text: `Want me to start on ${fastest.card.title} with ${fastest.repo}?`, campaign: false, ...noBonus(fastest) };
  const forms = byHour[0];
  if (forms)
    return {
      text: `Want me to start on ${forms.card.title} with ${forms.repo}?${needsText(forms.card)}`,
      campaign: false,
      ...noBonus(forms),
    };
  if (ideasShown) return { text: "Pick one and I'll start.", campaign: false };
  const curated = m.cards.filter((c) => !c.sponsored);
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
  const top = [...curated].sort((a, b) => Number(needsForms(a)) - Number(needsForms(b)) || byPrize(a, b))[0];
  if (top)
    return {
      text: `Want me to build something new for ${top.title} (${prizeOf(top)})?${needsForms(top) ? needsText(top) : ''}`,
      campaign: false,
    };
  // Only sponsor campaigns open: never offered by name.
  if (m.cards.length > 0) return { text: "Pick one and I'll start.", campaign: false };
  if (m.campaigns.some((r) => r.you === 'in review'))
    return { text: 'Nothing else is open right now. Want me to tell you when the results are in?', campaign: false };
  return { text: `Nothing else is open right now. ${TELL_WHEN_OPENS}`, campaign: false };
}
