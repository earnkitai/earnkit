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
