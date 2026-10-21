import type { ProfileData } from './bench-data';

/**
 * v3.1 site Task 7 (fix rounds 1 and 2): the page's one streak. The stored grid and streak (weeks.ts streakOf) leave
 * an unlit current week out, so this week's checked commits (site-data.ts thisWeekCommits) light the grid's last week
 * (this week) and add it to the streak. Quiet (no project, or not Bench-confirmed): every week off, 0 weeks.
 * profileSite applies it before Highlights and BenchProfileView before the Streak card, so they always agree. Pure.
 */
export function withThisWeek(d: Pick<ProfileData, 'grid' | 'streak' | 'project'>, thisWeek: number): { grid: ProfileData['grid']; streak: number } {
  if (!d.project?.confirmed) return { grid: d.grid.map((g) => ({ ...g, on: false })), streak: 0 };
  const last = d.grid.at(-1);
  if (thisWeek > 0 && last && !last.on) return { grid: [...d.grid.slice(0, -1), { ...last, on: true }], streak: d.streak + 1 };
  return { grid: d.grid, streak: d.streak };
}
