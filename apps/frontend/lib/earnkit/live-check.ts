import { sql } from './db';
import { placeholderLink } from './placeholder';
import { safeProbePage, visibleText } from './safe-fetch';

/**
 * v2.13.4 (spec 4, ruling R3): a live link the agent passed (identity.project.live_url, or local_repos'
 * live_url) counts as live once it loads: a 2xx HTML page (safe-fetch's rules: public addresses only,
 * one same-site redirect, the first 64 KB, never an error page) that is not a parked or placeholder
 * page. It is used for wording and program fit only (no "once it's live", no go-live ask); it never
 * changes the score, so naming any site can't lift a rank (Shipped still needs a confirmed site
 * source). The answer is kept a day (a failure an hour) in builder_profiles.standing_seen.live_check.
 */
export const LIVE_OK_TTL_MS = 86_400_000;
export const LIVE_FAIL_TTL_MS = 3_600_000;
/** A check started this recently is still running (another reply started it): not live yet, no second probe. */
const PENDING_MS = 30_000;
/** The page reader (tests set their own; test-guard refuses the network anyway). */
export const liveDefaults = { probe: (url: string): Promise<string> => safeProbePage(url) };

const PARKED: RegExp[] = [
  /\bdomain (?:name )?(?:is|may be) for sale\b/i, /\bbuy this domain\b/i, /\bthis domain (?:is|has been) (?:parked|registered)\b/i,
  /\bparked (?:free|domain|page)\b/i, /\bcoming soon\b/i, /\bunder construction\b/i, /\bwelcome to nginx\b/i,
  /\bapache2? (?:ubuntu )?default page\b/i, /^it works!?$/i, /\bindex of \//i, /\bdefault web site page\b/i,
  /\bsite (?:is )?not (?:yet )?(?:configured|published)\b/i,
];
/** A parked, placeholder or default server page (only short pages are judged, as errorPageText). Pure. */
export function parkedPage(html: string): boolean {
  const { title, text } = visibleText(html);
  if (text.length >= 5_000) return false;
  return PARKED.some((re) => re.test(title) || re.test(text));
}

/**
 * EarnKit's own site is a placeholder for everyone else (placeholder.ts), but it is the real product of
 * EarnKit's own repos (the owner's own test: earnkitai/earnkit, live at earnkit.com). Pure.
 */
const ownSite = (url: string, repoKey: string | null) =>
  /^https:\/\/(www\.)?earnkit\.com(\/|$)/i.test(url) && /^earnkitai\//i.test(repoKey ?? '');

export type LiveSite = { ok: boolean; title: string | null };
type Kept = LiveSite & { url: string; at: string; pending?: boolean };

/** One check, no cache: placeholder hosts and parked pages are not live; any read failure is not live. */
export async function checkLive(url: string, repoKey: string | null): Promise<LiveSite> {
  if (!/^https:\/\//i.test(url) || (placeholderLink(url) && !ownSite(url, repoKey))) return { ok: false, title: null };
  try {
    const page = await liveDefaults.probe(url);
    if (!page || parkedPage(page)) return { ok: false, title: null };
    return { ok: true, title: visibleText(page).title.slice(0, 120) || null };
  } catch {
    return { ok: false, title: null };
  }
}

/**
 * The person's live link checked (kept a day, a failure an hour), or null while a check is running. The
 * probe may outlast the reply (callers wait with settleWithin); its answer is kept for the next one.
 */
export async function liveSite(builderId: number, url: string, now: Date, repoKey: string | null): Promise<LiveSite | null> {
  const [row] = await sql()<{ c: Kept | null }[]>`SELECT standing_seen->'live_check' AS c FROM builder_profiles WHERE builder_id = ${builderId}`;
  const c = row?.c;
  if (c && typeof c === 'object' && c.url === url && typeof c.at === 'string') {
    const age = now.getTime() - Date.parse(c.at);
    if (c.pending && age < PENDING_MS) return null;
    if (!c.pending && age < (c.ok ? LIVE_OK_TTL_MS : LIVE_FAIL_TTL_MS)) return { ok: c.ok === true, title: typeof c.title === 'string' ? c.title : null };
  }
  const keep = (k: Kept) =>
    sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('live_check', ${sql().json(k as never)}::jsonb)
      WHERE builder_id = ${builderId}`;
  await keep({ url, ok: false, title: null, at: now.toISOString(), pending: true });
  const r = await checkLive(url, repoKey);
  await keep({ url, ...r, at: new Date().toISOString() });
  return r;
}
