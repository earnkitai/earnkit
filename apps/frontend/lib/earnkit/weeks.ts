/**
 * v2.13: ISO weeks (Monday to Sunday, UTC). A week's key is '2026-W42'; a row's `week` column is its
 * Monday ('2026-10-12'). The streak counts back from this week, or from last week while this one
 * has nothing yet (a Monday never breaks a streak). Pure and import-free (pages use it).
 */
const DAY = 86_400_000;
const WEEK = /^(\d{4})-W(\d{2})$/;
const MONDAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Same rule as source-readers.ts isoWeek (weeks.test.ts 1.3 keeps them equal). */
export function isoWeekOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
const mondayTime = (d: Date) => {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
};
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
export const mondayOf = (d: Date): string => ymd(mondayTime(d));
export function mondayOfWeek(week: string): string | null {
  const m = WEEK.exec(week);
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const t = mondayTime(new Date(jan4)) + (Number(m[2]) - 1) * 7 * DAY;
  return isoWeekOf(new Date(t)) === week ? ymd(t) : null;
}
export function weekOfMonday(monday: string): string | null {
  if (!MONDAY.test(monday)) return null;
  const t = Date.parse(`${monday}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).getUTCDay() !== 1) return null;
  return isoWeekOf(new Date(t));
}
export const lastFinishedMonday = (now: Date): string => ymd(mondayTime(now) - 7 * DAY);
export const weekLabel = (monday: string): string => {
  const t = new Date(`${monday}T00:00:00Z`);
  return `Week of ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
};
/** The 52 week keys ending with this week, oldest first. */
export function last52(now: Date): string[] {
  const end = mondayTime(now);
  return Array.from({ length: 52 }, (_, i) => isoWeekOf(new Date(end - (51 - i) * 7 * DAY)));
}
export function streakOf(weeks: Iterable<string>, now: Date): number {
  const have = new Set([...weeks].filter((w) => WEEK.test(w)));
  let t = mondayTime(now);
  if (!have.has(isoWeekOf(new Date(t)))) t -= 7 * DAY;
  let n = 0;
  while (have.has(isoWeekOf(new Date(t)))) {
    n++;
    t -= 7 * DAY;
  }
  return n;
}
export function weeksShipping(weeks: Iterable<string>, now: Date): number {
  const window = new Set(last52(now));
  return new Set([...weeks].filter((w) => window.has(w))).size;
}
