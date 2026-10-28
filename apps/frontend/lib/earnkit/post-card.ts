import { backersOfCoin } from './backers';
import { avatarUrl, displayName } from './page-data';
import { benchCardFacts, streakWords } from './bench-data';
import { sql } from './db';
import { CODE_PATTERN, draftByCode, type DraftRow, type PostMoment } from './post-drafts';
import { isMilestone } from './post-writer';
import { builderToken } from './builder-token';
import { rankSplit } from './rank';
import { streaksFor } from './streak';
import { isoWeekOf, mondayOf } from './weeks';

/**
 * v3.1 one-tap posts, Task 5 (design 4): the card of one post. X caches a card per URL, so the post's page link carries
 * ?m=<code> and its og:image is card.png?m=<code>; each post keeps its own card.
 *
 * The moment's facts are frozen when the post is drafted (freezeCard: the week, its summary, the streak, the commits
 * that week, the Shipping number and the rank phrase only from RANK_MIN_POOL, the 12 weeks of code); the token pill and
 * its holders are read live (v4.0 Task 9: the builder's launched token, builder_tokens) and the count only from
 * BACKERS_SHOWN_FROM holders. Never a
 * price: X keeps the image for days and a stale price is a false number. Never a self-report: an accepted, funded or won
 * card needs the proof link the moment was verified with, else the page's own card is drawn.
 *
 * Three layouts, by moment: `number` (a weekly, went live, the builder's news: "Week 6" or "Live" very large, the summary
 * under it), `milestone` (a weekly on 4, 8, 12, 26 or 52 weeks: the streak number alone, larger still) and `text` (a win,
 * an acceptance, funding or the coin: the program or the project as the headline).
 */
export const BACKERS_SHOWN_FROM = 5;
/** The weeks of code the card draws as squares, ending at the moment's week. */
export const GRID_WEEKS = 12;

/** The facts frozen with the draft (post_drafts.card), beside the moment's own (post-moments.ts candidate cards). */
export type FrozenFacts = {
  /** The project's shown name (never a private repo's or a confirming one's). */
  project: string | null;
  streak: number;
  /** Shipping, only while the page shows a score line. */
  score: number | null;
  /** "#3 of 40 builders" or "Top 4% of builders": only from RANK_MIN_POOL ranked builders (rank.ts shownRankLine). */
  rank: string | null;
  /** Code in each of the GRID_WEEKS weeks up to the moment's week, oldest first. */
  grid: boolean[];
};

/** The ISO weeks of the GRID_WEEKS Mondays ending at `monday`, oldest first. Pure. */
export function cardWeeks(monday: string): string[] {
  const end = Date.parse(`${monday}T12:00:00Z`);
  return Array.from({ length: GRID_WEEKS }, (_, i) => isoWeekOf(new Date(end - (GRID_WEEKS - 1 - i) * 7 * 86_400_000)));
}

/** The facts to freeze for a post drafted `now` about the week of `monday` (null: this week). Reads; throws on a database error. */
export async function freezeCard(builderId: number, monday: string | null, now: Date): Promise<FrozenFacts> {
  const f = await benchCardFacts(builderId, { money: false, now });
  const lit = await streaksFor([builderId], now);
  const weeks = lit.get(builderId)?.weeks ?? new Set<string>();
  // The card's own rule (card-response.tsx benchCard): the rank phrase is the score line's words after "Shipping N".
  const words = f?.bench ? f.bench.replace(/^Shipping \d+(?: · |$)/, '') : '';
  return {
    project: f?.project ?? null,
    streak: f?.streak ?? 0,
    score: f?.bench && f.score !== null ? f.score : null,
    rank: words || null,
    grid: cardWeeks(monday ?? mondayOf(now)).map((w) => weeks.has(w)),
  };
}

export type CardStat = { value: string; label: string };
export type PostCardView = {
  layout: 'number' | 'milestone' | 'text';
  /** The small line above the headline (the project, "Won", "Accepted into"). */
  kicker: string | null;
  /** The headline, in Kaftan Serif. */
  big: string;
  /** Under the headline: the week's summary, the weeks it took, the award. */
  sub: string | null;
  stats: CardStat[];
  /** The 12 weeks of code (number and milestone layouts), else null. */
  grid: boolean[] | null;
  /** v4.0 Task 9: the live pill's words, "$SYMBOL · N holders" (holders from BACKERS_SHOWN_FROM) or "$SYMBOL", else null. */
  backing: string | null;
};
/** What the card reads live: the builder's launched token (builder_tokens) with its holders. */
export type LiveFacts = { backing: { symbol: string; holders: number } | null };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bools = (v: unknown) => (Array.isArray(v) && v.length === GRID_WEEKS && v.every((b) => typeof b === 'boolean') ? (v as boolean[]) : null);
/** 1,234. Pure. */
const n = (x: number) => Math.round(x).toLocaleString('en-US');
const VERIFIED: readonly PostMoment[] = ['won', 'accepted', 'funded'];
const KICKER: Partial<Record<PostMoment, string>> = { won: 'Won', accepted: 'Accepted into', funded: 'Funded by' };

/**
 * The card of a draft (its frozen facts and the live Backing), or null when this moment has no card of its own (an
 * accepted, funded or won draft without its proof link; a moment with too little frozen to draw), so the page's own card
 * is drawn. Pure.
 */
export function postCardView(d: Pick<DraftRow, 'moment' | 'card' | 'proof_url'>, live: LiveFacts): PostCardView | null {
  const c = d.card ?? {};
  const project = str(c.project);
  const streak = num(c.streak) ?? 0;
  const score = num(c.score);
  const rank = str(c.rank);
  const stats: CardStat[] = [];
  const add = (value: number | null | undefined, label: string) => {
    if (value !== null && value !== undefined && value > 0) stats.push({ value: n(value), label });
  };
  add(streak, streak === 1 ? 'week in a row' : 'weeks in a row');
  if (d.moment === 'weekly') add(num(c.commits), num(c.commits) === 1 ? 'commit that week' : 'commits that week');
  add(score, 'Shipping');
  if (rank) {
    const r = rankSplit(rank);
    stats.push({ value: r.lead, label: r.rest ?? '' });
  }
  // The pill carries the holders, so no stat repeats them.
  const holders = live.backing && live.backing.holders >= BACKERS_SHOWN_FROM ? live.backing.holders : null;
  const backing = live.backing ? (holders !== null ? `$${live.backing.symbol} · ${n(holders)} holders` : `$${live.backing.symbol}`) : null;
  const grid = bools(c.grid);
  const summary = str(c.summary);
  // "Week 6" already says the weeks in a row.
  const noStreak = stats.filter((s) => !s.label.endsWith(' in a row'));
  switch (d.moment) {
    case 'weekly': {
      const week = num(c.week) ?? 0;
      if (week <= 0) return null;
      if (isMilestone(week))
        return { layout: 'milestone', kicker: project, big: n(week), sub: summary, stats: noStreak, grid, backing };
      return { layout: 'number', kicker: project, big: `Week ${n(week)}`, sub: summary, stats: noStreak, grid, backing };
    }
    case 'news': {
      // The builder's note is the post; the card shows the week and its summary, never the note again.
      const week = num(c.week) ?? streak;
      if (week <= 0 && !project) return null;
      return { layout: 'number', kicker: week > 0 ? project : null, big: week > 0 ? `Week ${n(week)}` : project!, sub: summary, stats: week > 0 ? noStreak : stats, grid, backing };
    }
    case 'went_live': {
      const weeks = num(c.weeks) ?? 0;
      return { layout: 'number', kicker: project, big: 'Live', sub: weeks >= 2 ? `${n(weeks)} weeks from first commit` : null, stats, grid, backing };
    }
    case 'coin_intro':
      if (!project) return null;
      return { layout: 'text', kicker: 'Shipping', big: project, sub: streakWords(streak), stats, grid: null, backing };
    default: {
      if (!VERIFIED.includes(d.moment)) return null;
      // Owner ruling 3: never on the card without the proof the moment was verified with.
      const program = str(c.program);
      if (!d.proof_url || !program) return null;
      const award = str(c.award);
      return { layout: 'text', kicker: KICKER[d.moment]!, big: program, sub: [project, award].filter(Boolean).join(' · ') || null, stats, grid: null, backing };
    }
  }
}

export type PostCardFacts = { view: PostCardView; handle: string; name: string; avatar: string | null };
/**
 * The card for `code` on this person's page: their draft (expired or not: X keeps the image), its view and the live
 * Backing. Null for a malformed code, another person's, or a moment with no card of its own (the page's card is drawn).
 * Reads; throws on a database error.
 */
export async function postCardFacts(builderId: number, code: string): Promise<PostCardFacts | null> {
  if (!CODE_PATTERN.test(code)) return null;
  const d = await draftByCode(code);
  if (!d || d.builder_id !== builderId) return null;
  const [p] = await sql()<{ x_handle: string | null; x_name: string | null; x_avatar_url: string | null; github_login: string | null }[]>`
    SELECT x_handle, x_name, x_avatar_url, github_login FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.x_handle) return null;
  const t = await builderToken(builderId);
  const live: LiveFacts = {
    backing: t?.status === 'launched' && t.coin_address && t.symbol ? { symbol: t.symbol, holders: await backersOfCoin(t.coin_address) } : null,
  };
  const view = postCardView(d, live);
  return view ? { view, handle: p.x_handle, name: displayName(p.x_name, p.x_handle), avatar: avatarUrl(p.x_avatar_url, p.github_login) } : null;
}
