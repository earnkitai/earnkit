import { sql } from './db';
import { gridWeeks, liveSite } from './bench-data';
import { rankLines } from './bench-rank';
import { benchConfirmedSql } from './main-project';
import { norm, shownProjects } from './page-data';
import { scoreLine } from './rank';
import { pageUrl } from './reserved-routes';
import { scoreWhy, storedShipping } from './score-v2';
import { streakOf } from './weeks';
import type { WeekFacts } from './week-facts';

/**
 * v3 Stage 2 (spec 5.3 Route 1): the builder's ship log facts at the top of a drafted application, as the page shows
 * them (bench-data.ts profileData's reads, without the log itself): the Shipping score and its rank, why, the streak,
 * the live site and the page. Only the builder's own facts, never another builder's.
 */
export type ShipLogFacts = { score: number | null; rank: string | null; why: string | null; streak: number; live: string | null; page: string };

/** prepare's agent_note suffix when the block is shown. */
export const SHIP_LOG_NOTE = ' Use the ship log facts in the description and traction answers.';

/**
 * The facts for `builderId`, or null without a claimed page (no handle). The score, rank and why only with a rank
 * line (as profileData); the streak only while the one project is confirmed (read off the same grid weeks the page
 * shows); the live site never a GitHub page. Throws on a database error.
 */
export async function shipLogFacts(builderId: number, now: Date): Promise<ShipLogFacts | null> {
  const db = sql();
  const [p] = await db<{ handle: string | null; main: string | null }[]>`
    SELECT x_handle AS handle, main_project_key AS main FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.handle) return null;
  const lines = await rankLines(builderId);
  const [live] = await db<{ parts: unknown }[]>`SELECT parts FROM builder_live WHERE builder_id = ${builderId}`;
  const scored = lines.bench !== null && Boolean(live);
  const facts: ShipLogFacts = {
    score: scored ? (storedShipping(live!.parts)?.points ?? null) : null,
    rank: scored ? lines.bench : null,
    why: scored ? scoreWhy(live!.parts, now) : null,
    streak: 0,
    live: null,
    page: pageUrl(p.handle),
  };
  if (!p.main) return facts;
  const [b] = await db<{ commit_weeks: string[]; confirmed: boolean }[]>`
    SELECT b.commit_weeks, ${benchConfirmedSql(db)} AS confirmed FROM builder_projects b
    WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(${p.main})`;
  const shown = ((await shownProjects([builderId])).get(builderId) ?? []).find((r) => norm(r.key) === norm(p.main!));
  if (!b || !shown) return facts;
  facts.live = liveSite(shown.link);
  if (b.confirmed) {
    const rows = await db<{ week: string; facts: WeekFacts }[]>`
      SELECT week::text AS week, facts FROM project_updates
      WHERE builder_id = ${builderId} AND lower(project_key) = lower(${p.main}) AND NOT hidden ORDER BY week DESC LIMIT 60`;
    facts.streak = streakOf(gridWeeks(b.commit_weeks, rows), now);
  }
  return facts;
}

/**
 * The block's lines: "From your ship log:", the score line ("Shipping 72 · #3 of 40 builders this week"), the why
 * sentence, "3 weeks in a row" (2 or more), "Live: <site>", "Page: earnkit.com/<handle>". Statements only. Pure.
 */
export function shipLogBlock(f: ShipLogFacts): string[] {
  return [
    'From your ship log:',
    f.score !== null ? scoreLine(f.score, f.rank) : null,
    f.why,
    f.streak >= 2 ? `${f.streak} weeks in a row` : null,
    f.live ? `Live: ${f.live}` : null,
    `Page: ${f.page}`,
  ].filter((x): x is string => Boolean(x));
}
