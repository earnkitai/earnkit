/**
 * A program's close in words: the close day in the program's own time zone (`tz`, else the
 * summary's "11:59 PM PT" suffix, else UTC), the one date formatter (`dayWords`) and the one closes wording
 * (`closesWords`: "closes in under an hour", "closes today", "closes tomorrow", "closes in 3 days", "closes Nov 20").
 * Pure.
 */

/** The summary suffixes read as a zone, and the IANA zone each names. */
const SUFFIX_ZONES: Record<string, string> = {
  ET: 'America/New_York',
  PT: 'America/Los_Angeles',
  CT: 'America/Chicago',
  UTC: 'UTC',
  GMT: 'UTC',
};

/** The program's IANA zone: `tz` when set, else the summary's zone suffix (ET, PT, CT, UTC, GMT), else UTC. */
export function programZone(c: { summary: string; tz?: string | null }): string {
  if (c.tz) return c.tz;
  for (const part of c.summary.split(' · ').slice(1)) {
    const m = /\b(ET|PT|CT|UTC|GMT)$/.exec(part.trim());
    if (m) return SUFFIX_ZONES[m[1]];
  }
  return 'UTC';
}

/** A date's month, day and year in a zone. Pure. */
function partsIn(d: Date, zone: string): { month: string; day: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' }).formatToParts(d);
  const part = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return { month: part('month'), day: Number(part('day')), year: Number(part('year')) };
}

/**
 * The one date formatter in builder text (L23-11, v6.1.16): "Nov 6" inside the current year (in `tz`), "Nov 6, 2025"
 * in any other; the month always capitalised. Since, closes, deadline moved, results due, /me dates. Pure.
 */
export function dayWords(d: Date, now: Date, tz = 'UTC'): string {
  const a = partsIn(d, tz);
  const year = a.year === partsIn(now, tz).year ? '' : `, ${a.year}`;
  return `${a.month} ${a.day}${year}`;
}

/**
 * "Nov 1": the program's close day, ends_at in programZone, with the year when it is not `now`'s (dayWords). Null for a
 * rolling program (no ends_at, or the summary says rolling).
 */
export function closeDay(c: { summary: string; tz?: string | null; ends_at?: Date | string | null }, now: Date = new Date()): string | null {
  if (!c.ends_at || c.summary.split(' · ').slice(1).includes('rolling')) return null;
  return dayWords(new Date(c.ends_at), now, programZone(c));
}

const HOUR_MS = 3_600_000;

/** Whole calendar days from `now` to `d` in a zone (0 the same day). Pure. */
function daysApart(d: Date, now: Date, zone: string): number {
  const utc = (x: Date) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(x);
    const n = (t: string) => Number(p.find((y) => y.type === t)?.value);
    return Date.UTC(n('year'), n('month') - 1, n('day'));
  };
  return Math.round((utc(d) - utc(now)) / (24 * HOUR_MS));
}

/**
 * The one closes wording (L23-9, L21-24, v6.1.16), for replies, tiles, guides and the guide meta: "closes in under an
 * hour" under an hour left; "closes today" on the same day in `tz`; "closes tomorrow"; "closes in {n} days" within 14
 * calendar days; else "closes {dayWords}"; "closed" once passed. A line that starts with it capitalises it. Pure.
 */
export function closesWords(endsAt: string, now: Date, tz: string): string {
  const end = new Date(endsAt);
  const left = end.getTime() - now.getTime();
  if (!(left > 0)) return 'closed';
  if (left < HOUR_MS) return 'closes in under an hour';
  const days = daysApart(end, now, tz);
  if (days <= 0) return 'closes today';
  if (days === 1) return 'closes tomorrow';
  if (days <= 14) return `closes in ${days} days`;
  return `closes ${dayWords(end, now, tz)}`;
}

/** closesWords with its first letter capitalised, for a line that starts with it ("Closes today"). Pure. */
export const closesLead = (endsAt: string, now: Date, tz: string): string => {
  const w = closesWords(endsAt, now, tz);
  return `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
};
