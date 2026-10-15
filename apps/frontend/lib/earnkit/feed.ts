import { sql } from './db';
import { hit } from './rate-limit';
import { listedRanked } from './person-score';
import { avatarUrl, displayName } from './page-data';
import { factChips, hasFacts, WEEKLY_HOUR_UTC, type WeekFacts } from './week-facts';
import { lastFinishedMonday, weekLabel } from './weeks';

/** v2.13 spec "The feed (R7)": progress points, the daily rank, the feed's weeks and the carousel. */
export const FEED_WEEK_MAX = 20;
export const FEED_OLDER_WEEKS = 3;
export const CAROUSEL_MAX = 12;
const DAY = 86_400_000;
const log2 = (x: number) => Math.log(x) / Math.LN2;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The progress points of one week's facts (a start is not progress). Pure. */
export function pointsOf(f: WeekFacts): number {
  let p = 0;
  if (f.went_live) p += 40;
  if ((f.won?.length ?? 0) > 0) p += 40;
  if (f.users_up && f.users_up.n > 0) p += Math.min(30, 6 * log2(1 + f.users_up.n));
  if (f.earned && f.earned.usd > 0) p += Math.min(20, 5 * log2(1 + f.earned.usd / 10));
  if (f.shipped_code && f.shipped_code.n > 0) p += 10;
  if (f.streak && f.streak.w > 0) p += Math.min(10, f.streak.w);
  return Math.round(p);
}

/** The rank step: points for the last `weeks` Mondays' rows (0 for a row with no facts). */
export async function rankFeed(now: Date, o: { weeks?: number } = {}): Promise<{ rows: number }> {
  const from = ymd(new Date(`${lastFinishedMonday(now)}T00:00:00Z`).getTime() - 7 * DAY * ((o.weeks ?? 5) - 1));
  const rows = await sql()<{ id: number; facts: WeekFacts }[]>`SELECT id::int AS id, facts FROM project_updates WHERE week >= ${from}`;
  for (const r of rows) {
    const p = hasFacts(r.facts) ? pointsOf(r.facts) : 0;
    await sql()`UPDATE project_updates SET points = ${p} WHERE id = ${r.id} AND points <> ${p}`;
  }
  return { rows: rows.length };
}

/**
 * Once a UTC day (spec "Cost"), F11: only from WEEKLY_HOUR_UTC, so on a Monday it runs after the
 * weekly facts step and ranks the finished week the same day. The rate window marks the day (no new table).
 */
export async function feedRankStep(now: Date): Promise<{ step: 'skipped' } | { rows: number }> {
  if (now.getUTCHours() < WEEKLY_HOUR_UTC) return { step: 'skipped' };
  if (!(await hit(`feedRank:${ymd(now.getTime())}`, 1, 86_400, now)).allowed) return { step: 'skipped' };
  return rankFeed(now);
}

export type FeedCard = { id: number; handle: string; name: string; avatar: string | null; project: string; week: string; text: string | null; chips: string[]; pinned: boolean };
type Row = { id: number; week: string; text: string | null; facts: WeekFacts; pinned: boolean; handle: string; x_name: string | null; avatar: string | null; project: string };

/** Visible updates with points, of listed people's confirmed one project, in [since, until). */
async function feedRows(since: string, until: string, only?: number[]): Promise<Row[]> {
  const db = sql();
  return db<Row[]>`
    SELECT * FROM (
      SELECT u.id::int AS id, u.week::text AS week, u.text, u.facts, u.pinned, p.x_handle AS handle, p.x_name, p.x_avatar_url AS avatar, b.name AS project,
        row_number() OVER (PARTITION BY u.week ORDER BY u.pinned DESC, u.points DESC, l.score DESC, u.id) AS n
      FROM project_updates u
      JOIN ${listedRanked(db, only)} l ON l.builder_id = u.builder_id
      JOIN builder_profiles p ON p.builder_id = u.builder_id AND lower(p.main_project_key) = lower(u.project_key)
      JOIN builder_projects b ON b.builder_id = u.builder_id AND lower(b.project_key) = lower(u.project_key) AND b.confirmed
      WHERE u.week >= ${since} AND u.week < ${until} AND NOT u.hidden AND NOT u.feed_hidden AND u.points > 0
    ) x WHERE x.n <= ${FEED_WEEK_MAX} ORDER BY x.week DESC, x.n`;
}
const toCard = (r: Row): FeedCard => ({
  id: r.id, handle: r.handle, name: displayName(r.x_name, r.handle), avatar: avatarUrl(r.avatar), project: r.project, week: r.week,
  text: r.text, chips: factChips(r.facts), pinned: r.pinned,
});

/** The last finished week and FEED_OLDER_WEEKS before it, newest first, at most FEED_WEEK_MAX cards each. */
export async function feedWeeks(now: Date, o: { only?: number[] } = {}): Promise<{ monday: string; label: string; cards: FeedCard[] }[]> {
  const last = new Date(`${lastFinishedMonday(now)}T00:00:00Z`).getTime();
  const rows = await feedRows(ymd(last - FEED_OLDER_WEEKS * 7 * DAY), ymd(last + 7 * DAY), o.only);
  const out = new Map<string, FeedCard[]>();
  for (const r of rows) out.set(r.week, [...(out.get(r.week) ?? []), toCard(r)]);
  return [...out].map(([monday, cards]) => ({ monday, label: weekLabel(monday), cards }));
}

/** The landing carousel: the feed's first CAROUSEL_MAX cards. */
export async function carouselCards(now: Date, o: { only?: number[] } = {}): Promise<FeedCard[]> {
  return (await feedWeeks(now, o)).flatMap((w) => w.cards).slice(0, CAROUSEL_MAX);
}

/** The owner's pin or hide of one update. False when there is no such update. */
export async function setFeedFlag(id: number, what: 'pin' | 'hide', on: boolean): Promise<boolean> {
  const rows = what === 'pin'
    ? await sql()`UPDATE project_updates SET pinned = ${on} WHERE id = ${id} RETURNING 1`
    : await sql()`UPDATE project_updates SET feed_hidden = ${on} WHERE id = ${id} RETURNING 1`;
  return rows.length > 0;
}
