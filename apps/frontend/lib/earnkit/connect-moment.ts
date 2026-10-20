import { sql } from './db';
import { weekLabel } from './weeks';
import { BACKFILL_WEEKS, backfillMondays, factChips, hasFacts, type WeekFacts } from './week-facts';
import { approveWeek, weekLineRule } from './weekly-moment';
import { CONNECT_ASK } from './bench-reply';
export { CONNECT_ASK };

/**
 * v3 Stage 1 (spec 5.1): approve on connect. When the read-only App connects a repo, backfillOnConnect writes its
 * last BACKFILL_WEEKS finished weeks. The first ranked reply after that shows those weeks (only the builder's own
 * data, never another builder's name) and asks one question; one yes approves them all (approved_via 'connect',
 * CONNECT_POINTS each), which activates the builder without waiting for the Monday moment. Shown once a person:
 * standing_seen.connect_open (the open offer, its once-guard) and standing_seen.connect_done (answered, or nothing
 * to confirm).
 */
export type ConnectWeek = { monday: string; line: string };
export type ConnectOpen = { key: string; weeks: string[] };

export const CONNECT_HEAD = (n: number) => `Your last ${n} ${n === 1 ? 'week' : 'weeks'}:`;
export const CONNECT_DONE = (url: string) => `Done. Your page is live: ${url}`;
export const CONNECT_NOTE = "A yes or no to the last line: call tell with move_up: { kind: 'connect', project_key, answer }. Don't show this note.";

/** Most weeks one connect offer lists. */
export const CONNECT_WEEKS_MAX = 12;

/**
 * The weeks of `key` still to confirm, newest first, at most CONNECT_WEEKS_MAX: every row with facts, not hidden, not
 * approved (v3 final review: not only the backfill's Mondays, so an older stored week is offered too). Each line is
 * "Week of Oct 5: <summary>" (the summary as the weekly moment shows it, weekly-moment.ts weekLineRule: a private
 * repo's only with titles on), else the week's chips. Throws on a database error.
 */
export async function connectWeeks(builderId: number, key: string): Promise<ConnectWeek[]> {
  const rows = await sql()<{ monday: string; facts: WeekFacts; titles: string[]; summary: string | null }[]>`
    SELECT week::text AS monday, facts, titles, summary FROM project_updates
    WHERE builder_id = ${builderId} AND lower(project_key) = lower(${key}) AND NOT hidden
      AND COALESCE((facts->>'approved')::boolean, false) = false
    ORDER BY week DESC`;
  const open = rows.filter((r) => hasFacts(r.facts ?? {})).slice(0, CONNECT_WEEKS_MAX);
  if (open.length === 0) return [];
  const line = await weekLineRule(builderId, key);
  return open.map((r) => ({
    monday: r.monday,
    line: `${weekLabel(r.monday)}: ${((r.titles.length > 0 || r.summary) ? line(r) : null) ?? factChips(r.facts).join(' · ')}`,
  }));
}

/**
 * v3 final review: the backfill of `key` is complete, so an empty connectWeeks read means nothing will ever arrive to
 * confirm: each of the newest BACKFILL_WEEKS finished Mondays has a checked row (or another builder holds the week).
 * Throws on a database error.
 */
export async function backfillComplete(builderId: number, key: string, now: Date): Promise<boolean> {
  const [r] = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM unnest(${backfillMondays(now)}::date[]) m(week)
    WHERE EXISTS (SELECT 1 FROM project_updates u WHERE lower(u.project_key) = lower(${key}) AND u.week = m.week
      AND (u.builder_id <> ${builderId} OR u.facts ? 'checked'))`;
  return (r?.n ?? 0) >= BACKFILL_WEEKS;
}

/** Nothing open and nothing answered yet: this person's first ranked reply may show the connect weeks. Never throws (false). */
export async function connectDue(builderId: number): Promise<boolean> {
  const [r] = await sql()<{ due: boolean }[]>`
    SELECT NOT (COALESCE(standing_seen, '{}'::jsonb) ?| array['connect_open', 'connect_done']) AS due FROM builder_profiles WHERE builder_id = ${builderId}`.catch(
    (err: unknown) => {
      console.error('[connect] due', err instanceof Error ? err.name : 'error');
      return [];
    },
  );
  return r?.due === true;
}

/** The offer is shown: standing_seen.connect_open = { key, weeks }. Never throws. */
export async function openConnect(builderId: number, o: ConnectOpen): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_open', ${sql().json(o as never)}::jsonb)
    WHERE builder_id = ${builderId}`.catch((err: unknown) => console.error('[connect] open', err instanceof Error ? err.name : 'error'));
}

/** Nothing to confirm (or answered): standing_seen.connect_done = now, so it is never asked. Never throws. */
export async function closeConnect(builderId: number, now: Date): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) - 'connect_open') || jsonb_build_object('connect_done', ${now.toISOString()}::text)
    WHERE builder_id = ${builderId}`.catch((err: unknown) => console.error('[connect] done', err instanceof Error ? err.name : 'error'));
}

/**
 * The yes or no to the connect offer: taken once (one UPDATE removing connect_open and writing connect_done, returning
 * what it held), for its project (with no project_key, the one open offer). A yes approves each week (approveWeek, via
 * 'connect'). v3 final review: a week whose approval failed (a database error) is not lost: the offer reopens with
 * those weeks (connect_open, connect_done removed), so the next yes retries them. A week another builder holds
 * (approveWeek false) is final. Null: nothing open to answer. `approved`: the weeks that stood (0 for a no);
 * `pending`: the weeks left open for a retry.
 */
export async function answerConnect(
  builderId: number, projectKey: string | null | undefined, answer: 'yes' | 'no', now: Date,
): Promise<{ approved: number; pending: number } | null> {
  const [r] = await sql()<{ o: ConnectOpen }[]>`
    UPDATE builder_profiles p SET standing_seen = (p.standing_seen - 'connect_open') || jsonb_build_object('connect_done', ${now.toISOString()}::text)
    FROM (SELECT standing_seen->'connect_open' AS o FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE) old
    WHERE p.builder_id = ${builderId} AND old.o IS NOT NULL
      AND (${!projectKey}::boolean OR lower(old.o->>'key') = lower(${projectKey ?? ''}))
    RETURNING old.o AS o`;
  if (!r) return null;
  if (answer === 'no') return { approved: 0, pending: 0 };
  let approved = 0;
  const failed: string[] = [];
  for (const monday of r.o.weeks ?? []) {
    try {
      if (await approveWeek(builderId, r.o.key, monday, now, 'connect')) approved++;
    } catch (err) {
      console.error('[connect] approve', err instanceof Error ? err.name : 'error');
      failed.push(monday);
    }
  }
  if (failed.length > 0) {
    const reopen: ConnectOpen = { key: r.o.key, weeks: failed };
    await sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'connect_done') || jsonb_build_object('connect_open', ${sql().json(reopen as never)}::jsonb)
      WHERE builder_id = ${builderId}`.catch((err: unknown) => console.error('[connect] reopen', err instanceof Error ? err.name : 'error'));
  }
  return { approved, pending: failed.length };
}
