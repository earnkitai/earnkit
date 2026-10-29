import { sql } from './db';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { norm, shareIntentText, shownProjects } from './page-data';
import { titlesShown } from './ship-titles';
import { summaryConsented, summaryShown } from './week-summary';
import { checkUpdate } from './update-text';
import { isoWeekOf, lastFinishedMonday, mondayOf, streakOf } from './weeks';
import { WEEKLY_HOUR_UTC, hasFacts, type WeekFacts } from './week-facts';
import { awardWeekPoints, type ApproveVia } from './points';
import { RANK_MIN_POOL } from './rank';

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
/**
 * `checked`: the weekly job has written last week's ship-log row (facts.checked). `approved`: the builder already
 * confirmed it (facts.approved, as the connect yes does), so the moment never asks about it again.
 */
export type LastWeek = {
  monday: string; now: WeekStanding; before: WeekStanding | null; titles: string[]; checked: boolean; approved: boolean;
  /** Owner batch fix round: the stored summary, only when the line shows it word for word (a yes binds to it, approveWeek `seen`). */
  summary?: string | null;
  /** The stored summary whatever the line shows (an offer that can't show it is recorded: markOffered). */
  stored?: string | null;
  /** Task 16 fix round 1: the week's row has facts (week-facts.ts hasFacts), so its approval earns points (approveWeek). */
  facts: boolean;
};

/** "+6", "-3", "same". Pure. */
const scoreDelta = (d: number) => (d === 0 ? 'same' : d > 0 ? `+${d}` : `${d}`);
/** A rank number going down is a move up: "up 2", "down 1", "same". Pure. */
const rankDelta = (before: number, now: number) => (before === now ? 'same' : now < before ? `up ${before - now}` : `down ${now - before}`);

/**
 * "Last week you finished at Shipping 72 (+6), #3 (up 2)." (no week before it: "Last week you finished at Shipping
 * 72, #3."), then the week's titles on one line ("Add dark mode · Fix the login loop"), at most 2, then the new
 * week's line (weekly-target.ts weekStartLine), when there is one. v3.1 F3: under RANK_MIN_POOL ranked builders that
 * week, no rank part ("Last week you finished at Shipping 72 (+6)."). Pure.
 */
export const MOMENT_TITLES_MAX = 2;
/** Weekly updates: the builder's optional note under the week's summary (tell update { text }). */
export const NOTE_LINE = 'Send a line about your week and it goes under your update.';
export function momentLines(w: Omit<LastWeek, 'approved' | 'facts' | 'summary'>, weekStart: string | null = null): string[] {
  const { now, before } = w;
  const ranked = now.total >= RANK_MIN_POOL;
  const score = `Shipping ${now.score}${before ? ` (${scoreDelta(now.score - before.score)})` : ''}`;
  const rank = ranked ? `, #${now.rank}${before ? ` (${rankDelta(before.rank, now.rank)})` : ''}` : '';
  const head = `Last week you finished at ${score}${rank}.`;
  const titles = w.titles.slice(0, MOMENT_TITLES_MAX);
  return [head, ...(titles.length > 0 ? [titles.join(' · '), NOTE_LINE] : []), ...(weekStart ? [weekStart] : [])];
}

/** Owner batch fix wave: the summary the weekly moment may quote: no question mark and no link (one of each per reply). Pure. */
export const momentSummary = (s: string | null): string | null => (s && !/[?]|https?:\/\//i.test(s) ? s : null);

/**
 * v4.0 Task 7 (approved copy 5, "Every Monday"): the week's facts the reply and the email both say. `summary`: the
 * week's summary as the moment shows it (momentSummary), else null; `change`: the score against the week before (null:
 * no week before); `streak`: weeks with code in a row up to last week (weekNumber); `usd`, `lastWeekUsd`: what the
 * community sent (community.ts weekCommunityUsd). The token is never named.
 */
export type MondayFacts = { first: string; summary: string | null; score: number; change: number | null; streak: number; usd: number; lastWeekUsd: number };
export const CHEER_LINE = "People really believe in what you're shipping.";
const usdWhole = (usd: number) => `$${Math.round(usd).toLocaleString('en-US')}`;
/**
 * The community cell: none under $1 (counts as $0); whole dollars; `cheer` at $100 or more, or at least double a last
 * week of $1 or more. Pure.
 */
export function communityRow(usd: number, lastWeekUsd: number): { cell: string; cheer: boolean } | null {
  if (!(usd >= 1)) return null;
  const last = lastWeekUsd >= 1 ? lastWeekUsd : 0;
  return { cell: `${usdWhole(usd)}, already in your wallet`, cheer: usd >= 100 || (last > 0 && usd >= 2 * last) };
}
/** The table's rows: "Shipping score" ("82, up 4"), "Streak" ("5 weeks", none at 0), "From your community" (communityRow). Pure. */
export function mondayRows(f: Pick<MondayFacts, 'score' | 'change' | 'streak' | 'usd' | 'lastWeekUsd'>): [string, string][] {
  const move = f.change === null || f.change === 0 ? '' : f.change > 0 ? `, up ${f.change}` : `, down ${-f.change}`;
  const rows: [string, string][] = [['Shipping score', `${f.score}${move}`]];
  if (f.streak > 0) rows.push(['Streak', `${f.streak} ${f.streak === 1 ? 'week' : 'weeks'}`]);
  const c = communityRow(f.usd, f.lastWeekUsd);
  if (c) rows.push(['From your community', c.cell]);
  return rows;
}
/**
 * "Your week is ready, Maya. You shipped the new meal planner. Nice work." A summary led by "Shipped" reads "You
 * shipped ..."; any other summary is said as it is (the words the builder approves); none: "You shipped this week.". Pure.
 */
export function mondayOpener(first: string, summary: string | null): string {
  const s = summary?.trim().replace(/[.!]+$/, '') ?? '';
  const shipped = s.match(/^shipped\s+(.+)$/i)?.[1];
  const middle = !s ? 'You shipped this week.' : shipped ? `You shipped ${shipped}.` : `${s}.`;
  return `Your week is ready, ${first}. ${middle} Nice work.`;
}
/** The email's week: the opener, then the rows as plain "Label: value" lines, then the cheer when it holds. Pure. */
export function mondayLines(f: MondayFacts): string[] {
  return [
    mondayOpener(f.first, f.summary), '',
    ...mondayRows(f).map(([label, value]) => `${label}: ${value}`),
    ...(communityRow(f.usd, f.lastWeekUsd)?.cheer ? [CHEER_LINE] : []),
  ];
}

/**
 * Fix round 1: the moment shows once last week's ship log can be in it: the weekly job wrote its row (facts.checked),
 * or this week's Monday WEEKLY_HOUR_UTC (the job's hour) has passed. Before that, no moment and the week stays
 * unclaimed. Pure.
 */
export function momentReady(checked: boolean, now: Date): boolean {
  return checked || now.getTime() >= Date.parse(`${mondayOf(now)}T${String(WEEKLY_HOUR_UTC).padStart(2, '0')}:00:00Z`);
}

/** Fix round 1: a title holding a link or a host name ("acme.com") is never shown in the moment. Pure. */
const LINKISH = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|(?:^|[^\p{L}\p{N}@._-])(?:[\p{L}\p{N}-]+\.)+(?:com|net|org|io|dev|app|ai|xyz|co|me|sh|gg|so|fun|site|link|info|tech|cloud|page|ly|to|tv|us|uk|de|eth)\b/iu;
export const titleHasLink = (t: string) => LINKISH.test(t);

/** The post's text: "My week on EarnKit: Shipping 72 · #3 of 40 builders"; "My week on EarnKit: Shipping 72" under RANK_MIN_POOL (v3.1 F3). Pure. */
export const shareText = (w: WeekStanding) =>
  w.total < RANK_MIN_POOL
    ? `My week on EarnKit: Shipping ${w.score}`
    : `My week on EarnKit: Shipping ${w.score} · #${w.rank.toLocaleString('en-US')} of ${w.total.toLocaleString('en-US')} builders`;
/** The X intent link with that text and the profile URL (page-data shareIntentText). Pure. */
export const shareLink = (handle: string, w: WeekStanding) => shareIntentText(handle, shareText(w));
export const SHARE_NOTE =
  "show_to_builder gives the week and its one-tap post link and asks one question. Show it exactly as given. Never rewrite it. " +
  "A yes or no to the question: call tell with move_up: { kind, project_key, answer } (as given here). If the builder sends a line about their week, call tell with update: { text } in their own words. Never post for the builder. Don't show this note.";
/**
 * Task 16 step 7: the week's number in "Week 4 done.": weeks with code in a row up to last week (`monday`), the
 * streak's rule (weeks.ts streakOf); 0 when last week had no code ("Last week done."). Pure.
 */
export const weekNumber = (commitWeeks: string[], monday: string) =>
  commitWeeks.includes(isoWeekOf(new Date(`${monday}T12:00:00Z`))) ? streakOf(commitWeeks, new Date(`${monday}T12:00:00Z`)) : 0;
/**
 * Task 16 step 7: where last week left the builder beside their rank: 'still' (the same rank as the week before),
 * 'now' (moved, or no week before), null under RANK_MIN_POOL ranked builders ("on EarnKit"). Pure.
 */
export const momentPlace = (w: Pick<LastWeek, 'now' | 'before'>): 'still' | 'now' | null =>
  w.now.total < RANK_MIN_POOL ? null : w.before && w.before.rank === w.now.rank ? 'still' : 'now';
export const APPROVED_LINE = 'Thanks. Last week is on your page.';

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
 * log's line as the builder is asked to approve it (weekLineRule `asking`: a private repo's summary too, never its
 * titles unless titles are on, never text naming it). Null without a ranked day last week (the moment is skipped). Throws on a database error.
 */
export async function lastWeekOf(builderId: number, key: string, now: Date): Promise<LastWeek | null> {
  const monday = lastFinishedMonday(now);
  const cur = await weekStanding(builderId, monday);
  if (!cur) return null;
  const before = await weekStanding(builderId, new Date(Date.parse(`${monday}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10));
  const db = sql();
  const [u] = await db<{ titles: string[]; summary: string | null; checked: boolean; facts: WeekFacts | null }[]>`
    SELECT titles, summary, facts, facts ? 'checked' AS checked FROM project_updates WHERE builder_id = ${builderId} AND lower(project_key) = lower(${key}) AND week = ${monday} AND NOT hidden`;
  let titles: string[] = [];
  let approved = false;
  let summary: string | null = null;
  if (u) {
    const rules = await weekRules(builderId, key, { asking: true });
    const line = u.titles.length > 0 || u.summary ? rules.line(u) : null;
    if (line) titles = [line];
    // Owner batch fix round: the summary a yes binds to only when the line shows it word for word.
    if (line !== null && line === u.summary) summary = u.summary;
    // Owner batch fix round: a private repo's summary changed since the yes is asked about again.
    approved = rules.current(u);
  }
  return { monday, now: cur, before, titles, checked: u?.checked ?? false, approved, summary, stored: u?.summary ?? null, facts: hasFacts(u?.facts ?? {}) };
}

/** A ship-log row as the week rules read it. */
type LogRow = { titles: string[]; summary: string | null; facts?: WeekFacts | null };

/**
 * The rules for a week of `key`'s ship log, read once (the rules returned are pure). Throws on a database error.
 * - `line`: the one line a reply may carry: its summary as the profile would show it (ship-titles.ts titlesShown: a
 *   private repo's titles only with titles on, never one naming it; week-summary.ts summaryShown: a private repo's
 *   summary only when the builder approved that exact text, summaryConsented), checked again as when stored
 *   (update-text.ts checkUpdate) and never holding a link. `asking`: a line in a question to the builder alone about
 *   approving the week (the weekly moment, the connect offer, the weekly email), so the builder sees the summary they
 *   approve before it shows anywhere (owner batch 2026-10-23). Null: nothing to show.
 * - `current`: nothing left to ask: approved, and for a private repo with titles off whose row has a summary, approved
 *   with that very summary, or that summary was already offered once without being shown (facts.offered_summary,
 *   markOffered: never re-offered forever). A rewritten or re-read one asks again, once.
 */
export async function weekRules(builderId: number, key: string, o: { asking?: boolean } = {}): Promise<{ line: (u: LogRow) => string | null; current: (u: LogRow) => boolean }> {
  const db = sql();
  const [p] = await db<{ titles_on: boolean }[]>`SELECT ship_titles_at IS NOT NULL AS titles_on FROM builder_profiles WHERE builder_id = ${builderId}`;
  const shown = ((await shownProjects([builderId])).get(builderId) ?? []).find((r) => norm(r.key) === norm(key));
  const rule = { hiddenRepo: shown?.hiddenRepo ?? true, titlesOn: p?.titles_on ?? false, repoKey: key };
  const links = await (await import('./updates')).ownLinks(builderId);
  const safe = (t: string) => {
    const c = checkUpdate(t, links);
    return c.ok && !titleHasLink(c.text) ? c.text : null;
  };
  const line = (u: LogRow) => {
    // Weekly updates: the week's summary stands in for the titles; written from the titles a reply may carry
    // when the stored one names a host.
    const r = { ...rule, consented: o.asking === true || summaryConsented(u.facts, u.summary) };
    const shownTitles = titlesShown(u.titles, r).flatMap((t) => safe(t) ?? []);
    const summary = summaryShown(u.summary && safe(u.summary), shownTitles, r);
    return (summary && safe(summary)) || null;
  };
  const current = (u: LogRow) =>
    u.facts?.approved === true &&
    (!(rule.hiddenRepo && !rule.titlesOn) || !u.summary || summaryConsented(u.facts, u.summary) || u.facts.offered_summary === u.summary);
  return { line, current };
}
/**
 * Owner batch fix wave (6): an offer for week `monday` that could not show its stored summary `summary` (the line was not
 * it word for word) is recorded (facts.offered_summary), so that text counts as offered, not approved, and is not asked
 * about again (weekRules `current`). Never throws.
 */
export async function markOffered(builderId: number, key: string, monday: string, summary: string): Promise<void> {
  await sql()`UPDATE project_updates SET facts = facts || jsonb_build_object('offered_summary', ${summary}::text)
    WHERE builder_id = ${builderId} AND lower(project_key) = lower(${key}) AND week = ${monday} AND summary = ${summary}`
    .catch((err: unknown) => console.error('[moment] offered', err instanceof Error ? err.name : 'error'));
}
/** weekRules' `line` alone. */
export async function weekLineRule(builderId: number, key: string, o: { asking?: boolean } = {}): Promise<(u: LogRow) => string | null> {
  return (await weekRules(builderId, key, o)).line;
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
 * approved_via 'share', approved_summary: the summary it approved). The builder's existing row is matched case-insensitively; with none, one is made (it shows
 * nowhere: no facts, text or titles). The weekly job's later upsert merges its facts in, keeping these. False when
 * another builder holds the week.
 */
export async function approveWeek(
  builderId: number, key: string, monday: string, now: Date, via: ApproveVia = 'share', seen?: string | null,
): Promise<boolean> {
  const facts = sql().json({ approved: true, approved_at: now.toISOString(), approved_via: via });
  // Owner batch fix round: the yes binds only to the summary the builder was shown (`seen`, kept with the offer;
  // approved_summary, summaryConsented). No `seen` (an older offer, a page that showed none) binds to nothing, never
  // to the text stored now. A second yes keeps the first approved_at and approved_via and binds to the new text.
  const bound = seen ?? null;
  const [had] = await sql()<{ facts: WeekFacts }[]>`
    UPDATE project_updates SET facts = ${facts}::jsonb || facts || jsonb_build_object('approved', true, 'approved_summary', ${bound}::text)
    WHERE builder_id = ${builderId} AND lower(project_key) = lower(${key}) AND week = ${monday} RETURNING facts`;
  if (had) return award(builderId, monday, via, now, had.facts);
  const [r] = await sql()<{ facts: WeekFacts }[]>`
    INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${builderId}, ${key}, ${monday}, ${facts})
    ON CONFLICT (project_key, week) DO UPDATE SET facts = EXCLUDED.facts || project_updates.facts
      || jsonb_build_object('approved', true, 'approved_summary', ${bound}::text)
    WHERE project_updates.builder_id = EXCLUDED.builder_id RETURNING facts`;
  return r ? award(builderId, monday, via, now, r.facts) : false;
}
/** v3 Stage 1: an approval that stood earns the week's points, once, when the week has facts. Never throws. */
async function award(builderId: number, monday: string, via: ApproveVia, now: Date, facts: WeekFacts): Promise<true> {
  if (hasFacts(facts ?? {})) await awardWeekPoints(builderId, monday, via, now).catch((err: unknown) => console.error('[points] award', err instanceof Error ? err.name : 'error'));
  return true;
}

/**
 * Fix round 1: the open share offer (standing_seen.share_open = { key, week, shown_week }), kept apart from the stored
 * ask so other replies that week don't close it. Written when the moment is shown.
 */
export type ShareOpen = { key: string; week: string; shown_week: string; /** The stored summary shown with the offer. */ summary?: string | null };
export async function openShare(builderId: number, o: ShareOpen): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('share_open', ${sql().json(o as never)}::jsonb)
    WHERE builder_id = ${builderId}`.catch((err: unknown) => console.error('[moment] open share', err instanceof Error ? err.name : 'error'));
}
/**
 * The yes or no to the share offer: taken once (one UPDATE removing it, returning what it held), only while `now` is in
 * the week it was shown and for its project. A yes approves that week (approveWeek). Null: nothing open to answer.
 * Final fix M1: with no project_key (an agent that dropped it) the one open offer is the one answered.
 */
export async function answerShare(builderId: number, projectKey: string | null | undefined, answer: 'yes' | 'no', now: Date): Promise<boolean | null> {
  const [r] = await sql()<{ o: ShareOpen }[]>`
    UPDATE builder_profiles p SET standing_seen = p.standing_seen - 'share_open'
    FROM (SELECT standing_seen->'share_open' AS o FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE) old
    WHERE p.builder_id = ${builderId} AND old.o->>'shown_week' = ${isoWeekOf(now)}
      AND (${!projectKey}::boolean OR lower(old.o->>'key') = lower(${projectKey ?? ''}))
    RETURNING old.o AS o`;
  if (!r) return null;
  if (answer === 'no') return false;
  return approveWeek(builderId, r.o.key, r.o.week, now, 'share', r.o.summary ?? null);
}
