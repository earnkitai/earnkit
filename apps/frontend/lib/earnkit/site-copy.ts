/**
 * v3.1 site copy and pure formatters (site Tasks 1 and 2). Every string a v3.1 page shows that is not data
 * lives here, exact as the owner approved it. Pure: the only imports are weeks.ts and the SITE tokens (the
 * logo tile colours are tokens, so no component holds a raw hex).
 */
import { mondayOf } from './weeks';
import { SITE } from './site-theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;

/** The score's band: good 70 and up, mid 40 to 69, low under 40. */
export function scoreBand(score: number): 'good' | 'mid' | 'low' {
  return score >= 70 ? 'good' : score >= 40 ? 'mid' : 'low';
}

/** One decimal at most, no trailing ".0": 1.25 is "1.3", 5 is "5". */
const trim = (n: number): string => String(Math.round(n * 10) / 10);

/** "$750", "$5K", "$105K", "$1M", "$1.3M". */
export function compactUsd(usd: number): string {
  return `$${compactNumber(usd)}`;
}

/** "999", "1K", "1.2K", "12K", "1.2M". */
export function compactCount(n: number): string {
  return compactNumber(n);
}

function compactNumber(n: number): string {
  if (n < 1000) return String(Math.round(n));
  // 999,950 and up would print "1000K": it is a million.
  if (n < 999_950) return `${trim(n / 1000)}K`;
  return `${trim(n / 1_000_000)}M`;
}

export const monthDay = (d: Date): string => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
export const monthYear = (d: Date): string => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** "just now", "5m ago", "2h ago", "yesterday", "3 days ago", then "on Oct 1" (UTC). */
export function agoWords(at: Date, now: Date): string {
  const ms = now.getTime() - at.getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 2 * DAY) return 'yesterday';
  if (ms < 14 * DAY) return `${Math.floor(ms / DAY)} days ago`;
  return `on ${monthDay(at)}`;
}

/**
 * The first word of the X name that has a letter (v4.0 final review 8: the reply side's rule, bench-reply.ts firstName,
 * so an emoji display name never shows); the handle when there is none or the name is the `@handle` placeholder.
 */
export function firstName(name: string, handle: string): string {
  return name.trim().split(/\s+/).find((w) => /\p{L}/u.test(w) && !w.startsWith('@')) || handle;
}

/** The metal of a "Top N%" standing pill: gold up to 5, silver up to 10, bronze up to 25. */
export function standingTier(pct: number): 'gold' | 'silver' | 'bronze' | null {
  return pct <= 5 ? 'gold' : pct <= 10 ? 'silver' : pct <= 25 ? 'bronze' : null;
}

const LOGO_COLORS = [SITE.logoOrange, SITE.logoViolet, SITE.logoGreen, SITE.logoBlue, SITE.logoPink, SITE.logoCyan, SITE.logoAmber];
/** A project's monogram tile colour: one of seven, by a stable hash of its name. */
export function logoColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return LOGO_COLORS[h % LOGO_COLORS.length];
}

/**
 * The landing hero chip, "$105K in grants open now"; null at 0. v4.7 T1 (one money figure): the caller passes /api/stats'
 * open_money_usd (stats.ts statsFrom: openMoneyUsd over every open curated program), so the banner, the stats and the
 * replies say one number (was the first Base cards only, "in Base grants").
 */
export function heroChipText(usd: number): string | null {
  return usd > 0 ? `${compactUsd(usd)} in grants open now` : null;
}

/** A program that is a prize or a hackathon by kind: in person, or its reward text says prize(s). Never an investment. Pool size is not the test (a grant can have a pool). */
export const isPrizeProgram = (c: { investment?: boolean; in_person?: boolean; reward?: string }): boolean =>
  !c.investment && (c.in_person === true || /\bprizes?\b/i.test(c.reward ?? ''));

export function programKind(c: { investment?: boolean; in_person?: boolean; reward?: string }): string {
  return c.investment ? 'investment' : isPrizeProgram(c) ? 'hackathon' : /\bUSDC\b/.test(c.reward ?? '') ? 'grant, in USDC' : 'grant';
}

export const streakNote = (streak: number, on12: number): string => (streak === 1 ? 'Week 2 starts Monday' : `Code in ${on12} of 12 weeks`);
export const weekLine = (n: number): string => (n <= 0 ? 'Ship by Sunday' : `This week: ${n.toLocaleString('en-US')} ${n === 1 ? 'commit' : 'commits'}`);

/** "Next update posts Monday, Oct 26": the Monday after the week `now` is in (UTC). */
export function nextUpdateLine(now: Date): string {
  const next = new Date(Date.parse(`${mondayOf(now)}T00:00:00Z`) + 7 * DAY);
  return `Next update posts Monday, ${monthDay(next)}`;
}

export const HERO_TITLE = 'Get funded for shipping.';
export const HERO_SUB = 'Ship. Get ranked. Get funded. All from your agent.';
export const CTA_INSTALL = 'Add EarnKit to your agent';
export const NAV_INSTALL = 'Add to your agent';
export const STEPS_TITLE = 'From commit to capital';
export const STEPS = [
  { title: 'Connect', text: 'Add EarnKit to your agent. Connect your GitHub.' },
  { title: 'Ship', text: 'We score how steadily you ship, every day.' },
  { title: 'Get funded', text: 'We find grants you fit. Your agent writes the application.' },
] as const;
export const ACTIVITY_TITLE = 'Activity';
export const ACTIVITY_MORE = 'See the leaderboard';
export const ACTIVITY_INVITE_TITLE = 'Your week goes here.';
export const ACTIVITY_INVITE_TEXT = 'Add EarnKit and your first update posts on Monday.';
export const EARN_TITLE = 'Earning opportunities';
/** A program card's deadline when it has none (clarity batch: was "Rolling"). */
export const ROLLING = 'Rolling, apply anytime';
/**
 * The money a program card shows (Opportunities): the per-winner max compacted ("$5K", the tile's `big`), else the
 * tile's prize text ("$840K in prizes"). GET /api/programs' `money` is the same text. Pure.
 */
export const tileMoney = (t: { big: string | null; prize: string }): string => t.big ?? t.prize;
/** v4.9 Task 3 fix 1 (ruling): the small line on an API program's card and guide page (written by the research bot). */
export const RESEARCH_LABEL = "Found by EarnKit's research.";
export const EARN_FOOT = 'Your agent finds the fit and drafts the application.';
export const FOOT_CTA = 'Your next week starts now.';
export const ART_CREDIT = 'Art: C.W. Eckersberg, 1815 · G.P. Panini, c. 1734';
export const FOOT_GET_PAGE = 'Get your page';
/** v3.1 GTM W1: the visitor card at the bottom of every profile (the same install sheet as the header). */
export const PROFILE_CTA_TITLE = 'Get your own page';
export const PROFILE_CTA_TEXT = 'Find grants you fit and get ranked for what you ship. Free.';
export const SCORE_TITLE = 'Shipping score';
/** The small caption under a bare Shipping score number (Activity cards, feed rows, leaderboard rows). */
export const SCORE_UNIT = 'Shipping';
/** A streak beside a name (leaderboard rows and podium): "5-week streak". The profile's Streak card keeps "5 weeks" under its title. */
export const streakRun = (n: number): string => `${n}-week streak`;
export const scoreNote = (first: string): string => `How often ${first} ships, out of 100, over 12 weeks.`;
/** Clarity batch: where the profile's score comes from, and the link to how it's scored (/docs#score). */
export const SCORE_SOURCE = 'From GitHub commits, not self-reported.';
export const SCORE_HOW = "How it's scored";
export const SCORE_HOW_HREF = '/docs#score';
export const SCORE_PENDING = 'Shows once the project is on the leaderboard.';
export const STREAK_TITLE = 'Streak';
export const PROFILE_ACTIVITY = 'Activity';
export const shippedAgo = (w: string): string => `Shipped ${w}`;
export const HIGHLIGHTS_TITLE = 'Highlights';
/** v4.0 Task 9 (owner-approved Token card): the builder's own token, traded on Uniswap. */
export const backOn = (first: string): string => `${first}'s token on Base`;
export const backLabel = (_first: string): string => 'Trade';
export const keepsLine = (first: string): string => `${first} keeps 40% of fees`;
export const feesBy = (first: string): string => `earned by ${first}`;
export const BACKERS = 'holders';
export const leaderboardLine = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'builder' : 'builders'}, ranked by how often they ship`;
/** Clarity batch: after the leaderboard's count line, so a grant lead sees the score is read, not claimed. */
export const BENCH_VERIFIED = 'From GitHub commits, read daily. Not self-reported.';
/** v2.13.1 O5 N16: the leaderboard with nobody ranked yet (moved here from the landing's old BenchTop; Task 8 keeps the wording). */
export const BENCH_TOP_EMPTY = 'Nobody on the leaderboard yet. Add EarnKit to your agent and be first.';
/** Few builders (under RANK_MIN_POOL ranked): the count line drops its number and "ranked" (a list of 1 to 9 is not a ranking yet). */
export const BENCH_EARLY = 'Scored by how often they ship, out of 100';
/** Few builders: one quiet line at the foot of the list, beside the install CTA (the install sheet). */
export const BENCH_INVITE = 'Be the next builder here.';
/** A filter with no rows: what is missing, in plain words (the "Show everyone" pill sits beside it). */
export const BENCH_EMPTY_BASE = 'No builder on Base yet.';
export const FILTERS = { all: 'All', base: 'Base' } as const;
/** Above the feed's pager when a week has more builders than the feed shows (FEED_WEEK_MAX cards a week). */
export const feedShowingLine = (shown: number, all: number): string => `Showing the top ${shown.toLocaleString('en-US')} of ${all.toLocaleString('en-US')} builders`;
export const FEED_STATS = { builders: 'Builders shipped', commits: 'Commits', live: 'Went live', applications: 'Applications sent' } as const;
export const NOT_FOUND_BIG = '404';
export const NOT_FOUND_TEXT = 'Nothing shipped here.';
export const NOT_FOUND_HOME = 'Back home';
export const NOT_FOUND_TITLE = 'Not found | EarnKit';
/** The one 404 title: not-found.tsx exports it as `metadata`, and each route that calls notFound() returns it from generateMetadata. */
export const NOT_FOUND_METADATA = { title: NOT_FOUND_TITLE, robots: { index: false } };
