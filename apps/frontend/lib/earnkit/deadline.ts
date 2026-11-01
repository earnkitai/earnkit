/**
 * v4.7 T1: one source for a program's close day. The day is ends_at read in the program's own time zone (the file's
 * `tz`, else the summary's "11:59 PM PT" suffix, else UTC), so the site and every reply say the same day ("Nov 1" for
 * a16z's 2026-11-02T07:59:59Z, never the UTC "Nov 2"). The summary is free text: where it disagrees, ends_at wins.
 */

/** The summary suffixes EarnKit reads as a zone, and the IANA zone each names. */
const SUFFIX_ZONES: Record<string, string> = {
  ET: 'America/New_York',
  PT: 'America/Los_Angeles',
  CT: 'America/Chicago',
  UTC: 'UTC',
  GMT: 'UTC',
};

/** The short name a reply shows for a zone ("PT"), or null for one without a known short name. */
const ZONE_ABBR: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Los_Angeles': 'PT',
  'America/Chicago': 'CT',
  UTC: 'UTC',
};

/** Whether `tz` is an IANA zone Intl knows ("America/Los_Angeles"). Pure. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The program's IANA zone: `tz` when set, else the summary's zone suffix (ET, PT, CT, UTC, GMT), else UTC. Pure. */
export function programZone(c: { summary: string; tz?: string | null }): string {
  if (c.tz) return c.tz;
  for (const part of c.summary.split(' · ').slice(1)) {
    const m = /\b(ET|PT|CT|UTC|GMT)$/.exec(part.trim());
    if (m) return SUFFIX_ZONES[m[1]];
  }
  return 'UTC';
}

/** The zone's short name for builder text ("PT"), or null when EarnKit has none for it. Pure. */
export const zoneAbbr = (zone: string): string | null => ZONE_ABBR[zone] ?? null;

/** A date's calendar parts in a zone. Pure. */
export function zoneParts(d: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)!.value;
  return { day: `${get('month')} ${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')), second: Number(get('second')) };
}

/**
 * "Nov 1": the program's close day, ends_at in programZone. Null for a rolling program or one without ends_at (the
 * landing cache hands ends_at back as a string, so both forms are read). Pure.
 */
export function closeDay(c: { summary: string; tz?: string | null; ends_at?: Date | string | null }): string | null {
  if (!c.ends_at || c.summary.split(' · ').slice(1).includes('rolling')) return null;
  return zoneParts(new Date(c.ends_at), programZone(c)).day;
}

const HOUR_MS = 3_600_000;
/**
 * v4.8.1 Task 2 (R2): the time left as a person says it, from the clock, never the calendar: "in under an hour" under 1
 * hour, "in {n} hours" (whole hours, rounded down; "in 1 hour") under 48 hours, else null (48 hours or more, or already
 * passed). The same in every zone. Pure.
 */
export function hoursLeft(endsAt: string, now: Date): string | null {
  const left = Date.parse(endsAt) - now.getTime();
  // Fix round 1 (F5): a close already passed has no time left to say.
  if (!(left > 0)) return null;
  if (left < HOUR_MS) return 'in under an hour';
  if (left >= 2 * 24 * HOUR_MS) return null;
  const n = Math.floor(left / HOUR_MS);
  return `in ${n} ${n === 1 ? 'hour' : 'hours'}`;
}

/** "11:59 PM". Pure. */
const clock = (hour: number, minute: number) => `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;

/**
 * When a dated program's submissions close, in the program's own zone (deadline.ts zoneParts, closeDay's rule): its day
 * ("Nov 1", never "today" or "tomorrow"), its time and the zone's short name, "Nov 5, 11:59 PM PT"; under 48 hours, the
 * time left too, "Nov 1, 11:59 PM PT (in 20 hours)" (v4.8.1 Task 2, R2). A zone with no short name (deadline.ts
 * zoneAbbr) says the day only ("Nov 6", "Nov 1 (in 20 hours)"), so the time is never read in the wrong zone. Pure.
 */
export function submitBy(endsAt: string, zone: string, now: Date, abbr: string | null): string {
  const end = zoneParts(new Date(endsAt), zone);
  const left = hoursLeft(endsAt, now);
  return `${abbr ? `${end.day}, ${clock(end.hour, end.minute)} ${abbr}` : end.day}${left ? ` (${left})` : ''}`;
}

/**
 * v4.8.1 final fix (R-3): a card's close for an email, which is read hours after it is sent: absolute, in the
 * program's zone, with the hours left as of sending under 48 hours ("Nov 1, 11:59 PM PT (in 20 hours)"). Null for a
 * rolling program or one without ends_at. Pure.
 */
export function cardSubmitBy(c: { summary: string; tz?: string | null; ends_at?: Date | string | null }, now: Date): string | null {
  if (!closeDay(c)) return null;
  const zone = programZone(c);
  return submitBy(new Date(c.ends_at!).toISOString(), zone, now, zoneAbbr(zone));
}
