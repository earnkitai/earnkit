import { sql } from './db';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { norm, shareIntentText, shownProjects } from './page-data';
import { titlesShown } from './ship-titles';
import { checkUpdate } from './update-text';
import { rankLine, scoreLine } from './rank';
import { isoWeekOf, lastFinishedMonday } from './weeks';

/**
 * Launch ready L6: one weekly moment. Only the builder's own data: their Shipping, rank and checked titles (never
 * another builder's name or handle, which is text they control). The first find or score of a new ISO week (per installation) leads with last
 * week's Shipping and rank, and one line of last week's ship log, then offers a free share link (an X intent URL:
 * no X API, no new scopes) in place of the usual next step. A yes marks last week approved
 * (project_updates.facts.approved), which /api/stats counts (L9).
 */
const DAY_MS = 86_400_000;
/** A week's standing as the daily history (builder_scores) left it: its last ranked day. */
export type WeekStanding = { score: number; rank: number; total: number };
export type LastWeek = { monday: string; now: WeekStanding; before: WeekStanding | null; titles: string[] };

/** "+6", "-3", "same". Pure. */
const scoreDelta = (d: number) => (d === 0 ? 'same' : d > 0 ? `+${d}` : `${d}`);
/** A rank number going down is a move up: "up 2", "down 1", "same". Pure. */
const rankDelta = (before: number, now: number) => (before === now ? 'same' : now < before ? `up ${before - now}` : `down ${now - before}`);

/**
 * "Last week: Shipping 72 (+6), #3 (up 2)." (no week before it: "Last week: Shipping 72, #3."), then the week's
 * titles on one line ("Add dark mode · Fix the login loop"), at most 2. Pure.
 */
export const MOMENT_TITLES_MAX = 2;
export function momentLines(w: LastWeek): string[] {
  const { now, before } = w;
  const head = before
    ? `Last week: Shipping ${now.score} (${scoreDelta(now.score - before.score)}), #${now.rank} (${rankDelta(before.rank, now.rank)}).`
    : `Last week: Shipping ${now.score}, #${now.rank}.`;
  const titles = w.titles.slice(0, MOMENT_TITLES_MAX);
  return titles.length > 0 ? [head, titles.join(' · ')] : [head];
}

/** The post's text: "Shipped this week on EarnKit: Shipping 72 · #3 of 40 builders this week" (rank.ts's own lines). Pure. */
export const shareText = (w: WeekStanding) => `Shipped this week on EarnKit: ${scoreLine(w.score, rankLine({ ranked: true, rank: w.rank, total: w.total }))}`;
/** The X intent link with that text and the profile URL (page-data shareIntentText). Pure. */
export const shareLink = (handle: string, w: WeekStanding) => shareIntentText(handle, shareText(w));
export const SHARE_NOTE =
  "show_to_builder ends with a share link for X and one question. A yes or no to it: call tell with move_up: { kind, project_key, answer } (as given here). Never post for the builder. Don't show this note.";
export const APPROVED_LINE = 'Thanks. Last week is confirmed.';

/**
 * The week of `monday` as the daily history left it: the builder's last ranked, unheld Shipping row that week, and
 * their rank that day among the other ranked, unheld rows of the same day whose page is listed now (claimed, not
 * hidden): 1 + those scoring higher. Null when the builder has no such row.
 */
async function weekStanding(builderId: number, monday: string): Promise<WeekStanding | null> {
  const db = sql();
  const [r] = await db<WeekStanding[]>`
    WITH mine AS (
      SELECT day, score FROM builder_scores
      WHERE builder_id = ${builderId} AND day >= ${monday}::date AND day < ${monday}::date + 7
        AND calibration = ${LIVE_CALIBRATION_V2} AND ranked AND NOT held
      ORDER BY day DESC LIMIT 1
    ), others AS (
      SELECT s.score FROM builder_scores s JOIN builder_profiles p USING (builder_id), mine
      WHERE s.day = mine.day AND s.builder_id <> ${builderId} AND s.calibration = ${LIVE_CALIBRATION_V2} AND s.ranked AND NOT s.held
        AND p.x_user_id IS NOT NULL AND p.x_handle IS NOT NULL AND NOT p.hidden
    )
    SELECT mine.score::int AS score,
      (1 + (SELECT count(*) FROM others WHERE others.score > mine.score))::int AS rank,
      (1 + (SELECT count(*) FROM others))::int AS total
    FROM mine`;
  return r ?? null;
}

/**
 * Last finished week for the one project `key`: its standing, the week before's (for the deltas), and the ship
 * log's titles as the profile would show them (ship-titles.ts titlesShown: a private repo's only with titles on,
 * never one naming it). Null without a ranked day last week (the moment is skipped). Throws on a database error.
 */
export async function lastWeekOf(builderId: number, key: string, now: Date): Promise<LastWeek | null> {
  const monday = lastFinishedMonday(now);
  const cur = await weekStanding(builderId, monday);
  if (!cur) return null;
  const before = await weekStanding(builderId, new Date(Date.parse(`${monday}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10));
  const db = sql();
  const [u] = await db<{ titles: string[] }[]>`
    SELECT titles FROM project_updates WHERE builder_id = ${builderId} AND lower(project_key) = lower(${key}) AND week = ${monday} AND NOT hidden`;
  let titles: string[] = [];
  if (u && u.titles.length > 0) {
    const [p] = await db<{ titles_on: boolean }[]>`SELECT ship_titles_at IS NOT NULL AS titles_on FROM builder_profiles WHERE builder_id = ${builderId}`;
    const shown = ((await shownProjects([builderId])).get(builderId) ?? []).find((r) => norm(r.key) === norm(key));
    // The titles are the builder's own commit text: checked again here as when stored (update-text.ts checkUpdate),
    // so a reply never carries one the filter refuses.
    const own = titlesShown(u.titles, { hiddenRepo: shown?.hiddenRepo ?? true, titlesOn: p?.titles_on ?? false, repoKey: key });
    if (own.length > 0) {
      const links = await (await import('./updates')).ownLinks(builderId);
      titles = own.flatMap((t) => {
        const c = checkUpdate(t, links);
        return c.ok ? [c.text] : [];
      });
    }
  }
  return { monday, now: cur, before, titles };
}

/** A cheap first look: this installation hasn't been shown `now`'s week yet (so last week is worth reading). Never throws. */
export async function momentDue(own: number, now: Date): Promise<boolean> {
  const [r] = await sql()<{ due: boolean }[]>`
    SELECT moment_week IS DISTINCT FROM ${isoWeekOf(now)} AS due FROM installations WHERE id = ${own}`.catch((err: unknown) => {
    console.error('[moment] due', err instanceof Error ? err.name : 'error');
    return [];
  });
  return r?.due === true;
}

/**
 * Whether this installation sees this week's moment now: claims `now`'s ISO week once (installations.moment_week,
 * one UPDATE ... RETURNING, so two replies at once show it once). Called only when the moment will be shown.
 * Never throws (a failed write is no moment).
 */
export async function takeMoment(own: number, now: Date): Promise<boolean> {
  const week = isoWeekOf(now);
  const r = await sql()`
    UPDATE installations SET moment_week = ${week} WHERE id = ${own} AND moment_week IS DISTINCT FROM ${week} RETURNING 1`.catch((err: unknown) => {
    console.error('[moment] take', err instanceof Error ? err.name : 'error');
    return [];
  });
  return r.length > 0;
}

/**
 * The yes to the moment's question: last week's ship-log row of `key` approved (facts.approved, approved_at,
 * approved_via 'share'), made when the week has no row yet (such a row shows nowhere: no facts, text or titles).
 * The weekly job's later upsert merges its facts in, keeping these. False when another builder holds the week.
 */
export async function approveWeek(builderId: number, key: string, monday: string, now: Date): Promise<boolean> {
  const facts = { approved: true, approved_at: now.toISOString(), approved_via: 'share' };
  const r = await sql()`
    INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${builderId}, ${key}, ${monday}, ${sql().json(facts)})
    ON CONFLICT (project_key, week) DO UPDATE SET facts = project_updates.facts || EXCLUDED.facts
    WHERE project_updates.builder_id = EXCLUDED.builder_id RETURNING 1`;
  return r.length > 0;
}
