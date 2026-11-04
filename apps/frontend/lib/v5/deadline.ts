/**
 * A program's close in words: the close day in the program's own time zone (`tz`, else the
 * summary's "11:59 PM PT" suffix, else UTC), and the time left for an agent ("in 20 hours",
 * "in 16 days"). Pure.
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

/** "Nov 1": a date's day in a zone. */
const dayIn = (d: Date, zone: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric' }).format(d);

/**
 * "Nov 1": the program's close day, ends_at in programZone. Null for a rolling program (no
 * ends_at, or the summary says rolling).
 */
export function closeDay(c: { summary: string; tz?: string | null; ends_at?: Date | string | null }): string | null {
  if (!c.ends_at || c.summary.split(' · ').slice(1).includes('rolling')) return null;
  return dayIn(new Date(c.ends_at), programZone(c));
}

const HOUR_MS = 3_600_000;

/**
 * The time left on an open program, from the clock: "in under an hour", "in {n} hours" (whole
 * hours, rounded down) under 48 hours, else "in {n} days" (whole days, rounded down); null once
 * passed. The same in every zone.
 */
export function timeLeftWords(endsAt: string, now: Date): string | null {
  const left = Date.parse(endsAt) - now.getTime();
  if (!(left > 0)) return null;
  if (left < HOUR_MS) return 'in under an hour';
  if (left < 48 * HOUR_MS) {
    const n = Math.floor(left / HOUR_MS);
    return `in ${n} ${n === 1 ? 'hour' : 'hours'}`;
  }
  return `in ${Math.floor(left / (24 * HOUR_MS))} days`;
}
