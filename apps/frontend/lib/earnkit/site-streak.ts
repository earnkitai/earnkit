import type { WeekFacts } from './week-facts';
import { isoWeekOf, streakOf, weekOfMonday } from './weeks';

/**
 * The one streak definition (v3.1 streak fix): consecutive ISO weeks with real code (commits) ending this week, or last
 * week while this one has none yet (weeks.ts streakOf). Its weeks are the grid's weeks: the rescored commit weeks
 * (builder_projects.commit_weeks, never a deploy or a site), every shown week whose row EarnKit checked commits for
 * (facts.shipped_code), and this week when the live reading already counts commits (rescore and the weekly job lag
 * it). streak.ts streaksFor reads these inputs for any number of builders and is the only caller of streakWeeks; every
 * surface (leaderboard, profile, card, replies, JSON, ship log) takes its number from there, never from
 * builder_projects.streak (a rescore-time cache). Pure.
 */
export function gridWeeks(commitWeeks: string[], rows: { week: string; facts: WeekFacts }[]): Set<string> {
  const weeks = new Set(commitWeeks);
  for (const r of rows) {
    const w = (r.facts?.shipped_code?.n ?? 0) > 0 ? weekOfMonday(r.week) : null;
    if (w) weeks.add(w);
  }
  return weeks;
}

/** The grid's lit weeks and the streak over them, for a Bench-confirmed project. `thisWeekCommits` is the live reading's count for this week. Pure. */
export function streakWeeks(
  i: { commitWeeks: string[]; updates: { week: string; facts: WeekFacts }[]; thisWeekCommits: number },
  now: Date,
): { weeks: Set<string>; streak: number } {
  const weeks = gridWeeks(i.commitWeeks, i.updates);
  if (i.thisWeekCommits > 0) weeks.add(isoWeekOf(now));
  return { weeks, streak: streakOf(weeks, now) };
}
