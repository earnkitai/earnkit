import { sql } from './db';
import { weekLabel } from './weeks';
import { backfillMondays, factChips, hasFacts, type WeekFacts } from './week-facts';
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

/**
 * The backfilled weeks of `key` still to confirm, newest first: rows of the last BACKFILL_WEEKS finished Mondays with
 * facts, not hidden, not approved. Each line is "Week of Oct 5: <summary>" (the summary as the weekly moment shows it,
 * weekly-moment.ts weekLineRule: a private repo's only with titles on), else the week's chips. Throws on a database error.
 */
export async function connectWeeks(builderId: number, key: string, now: Date): Promise<ConnectWeek[]> {
  const mondays = backfillMondays(now);
  const rows = await sql()<{ monday: string; facts: WeekFacts; titles: string[]; summary: string | null }[]>`
    SELECT week::text AS monday, facts, titles, summary FROM project_updates
    WHERE builder_id = ${builderId} AND lower(project_key) = lower(${key}) AND week = ANY(${mondays}::date[]) AND NOT hidden
    ORDER BY week DESC`;
  const open = rows.filter((r) => hasFacts(r.facts ?? {}) && !r.facts.approved);
  if (open.length === 0) return [];
  const line = await weekLineRule(builderId, key);
  return open.map((r) => ({
    monday: r.monday,
    line: `${weekLabel(r.monday)}: ${(r.titles.length > 0 || r.summary ? line(r) : null) ?? factChips(r.facts).join(' · ')}`,
  }));
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
 * 'connect'). Null: nothing open to answer. `approved`: the weeks that stood (0 for a no).
 */
export async function answerConnect(builderId: number, projectKey: string | null | undefined, answer: 'yes' | 'no', now: Date): Promise<{ approved: number } | null> {
  const [r] = await sql()<{ o: ConnectOpen }[]>`
    UPDATE builder_profiles p SET standing_seen = (p.standing_seen - 'connect_open') || jsonb_build_object('connect_done', ${now.toISOString()}::text)
    FROM (SELECT standing_seen->'connect_open' AS o FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE) old
    WHERE p.builder_id = ${builderId} AND old.o IS NOT NULL
      AND (${!projectKey}::boolean OR lower(old.o->>'key') = lower(${projectKey ?? ''}))
    RETURNING old.o AS o`;
  if (!r) return null;
  if (answer === 'no') return { approved: 0 };
  let approved = 0;
  for (const monday of r.o.weeks ?? []) if (await approveWeek(builderId, r.o.key, monday, now, 'connect')) approved++;
  return { approved };
}
