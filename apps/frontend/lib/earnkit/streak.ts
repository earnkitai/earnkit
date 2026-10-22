import { sql } from './db';
import { benchConfirmedSql } from './main-project';
import { weekCounts } from './person-score';
import { streakWeeks } from './site-streak';
import { shipReading, type WeekFacts } from './week-facts';
import { isoWeekOf } from './weeks';

/** A streak and its lit weeks for a builder whose one project the Bench counts as confirmed now. */
export type Streak = { weeks: Set<string>; streak: number };

const WEEK_MS = 7 * 86_400_000;

/**
 * v3.1 streak fix: the one place a streak is read (see site-streak.ts). For each builder in `ids` whose one project is
 * Bench-confirmed now: the rescored commit weeks, the shown weeks EarnKit checked commits for, and this week's commits on
 * the live repo reading (the profile's rule, so a leaderboard row never trails the page). A builder with no confirmed
 * project is absent from the map (a streak of 0, nothing lit). Reads are batched: three queries however many ids.
 */
export async function streaksFor(ids: number[], now: Date): Promise<Map<number, Streak>> {
  const out = new Map<number, Streak>();
  if (ids.length === 0) return out;
  const db = sql();
  const week = isoWeekOf(now);
  const rows = await db<{ builder_id: number; commit_weeks: string[]; n: string | null; created_at: unknown; pushes_checked: unknown }[]>`
    SELECT f.builder_id, b.commit_weeks, r.n, r.created_at, r.pushes_checked
    FROM builder_profiles f
    JOIN builder_projects b ON b.builder_id = f.builder_id AND lower(b.project_key) = lower(f.main_project_key) AND ${benchConfirmedSql(db)}
    LEFT JOIN LATERAL (
      SELECT x.signals->'commit_counts'->>${week}::text AS n, x.signals->'created_at' AS created_at, x.signals->'pushes_checked' AS pushes_checked
      FROM builder_sources s JOIN LATERAL ${shipReading(db)} x ON true
      WHERE s.builder_id = f.builder_id AND s.kind = 'repo' AND s.state = 'verified' AND lower(s.project_key) = lower(b.project_key)
      ORDER BY (lower(s.ref) = lower(b.project_key)) DESC, s.id LIMIT 1) r ON true
    WHERE f.builder_id = ANY(${ids}::int[])`;
  const since = new Date(now.getTime() - 54 * WEEK_MS).toISOString().slice(0, 10);
  const updates = await db<{ builder_id: number; week: string; facts: WeekFacts }[]>`
    SELECT u.builder_id, u.week::text AS week, u.facts FROM project_updates u
    JOIN builder_profiles f ON f.builder_id = u.builder_id AND lower(u.project_key) = lower(f.main_project_key)
    WHERE u.builder_id = ANY(${ids}::int[]) AND NOT u.hidden AND u.week >= ${since}::date AND u.facts ? 'shipped_code'`;
  for (const r of rows) {
    const count = Math.floor(Number(r.n ?? 0));
    out.set(
      r.builder_id,
      streakWeeks(
        {
          commitWeeks: r.commit_weeks,
          updates: updates.filter((u) => u.builder_id === r.builder_id),
          // The anti-backdating floor (person-score.ts weekCounts), as the ship log's own count.
          thisWeekCommits: count > 0 && weekCounts(r, week, now) ? count : 0,
        },
        now,
      ),
    );
  }
  return out;
}

/** One builder's streak (0 unless their one project is Bench-confirmed). */
export async function streakOfBuilder(id: number, now: Date): Promise<number> {
  return (await streaksFor([id], now)).get(id)?.streak ?? 0;
}
