import { sql } from './db';
import { DEADLINE_DAYS } from './alerts';
import { COIN_PROGRAM } from './policy-constants';
import { shortLink } from './post-reply';
import { USED_STALE_DAYS } from './site-data';
import { streaksFor } from './streak';
import { isoWeekOf, mondayOf } from './weeks';

/**
 * v4.0 Task 8 (approved copy 6, "Nudges"): at most one nudge a week, in a friendly mentor voice. nudgeFor picks the
 * first due of: accepted or funded, a users milestone, a program closing within DEADLINE_DAYS with a draft ready,
 * nothing shipped by Friday. The week is claimed in standing_seen.nudge_week (the ISO week's Monday) in one guarded
 * UPDATE, so two replies at once show it once. bench-find.ts calls it only for a ranked reply that shows it (never
 * during setup, the setup-done reply, the Monday block or a post offer; those wait, unclaimed).
 */

export const acceptedNudge = (program: string, link: string) => `You got into ${program}. Huge, well earned. Want to share it? ${link}`;
export const milestoneNudge = (project: string, n: number, program: string | null) =>
  `${project} just passed ${n.toLocaleString('en-US')} users. That's real traction${program ? `, and it makes your ${program} application a lot stronger.` : '.'}`;
export const closingNudge = (program: string, day: string) => `Heads up, ${program} closes ${day}. Your draft is ready. Want to send it?`;
export const fridayNudge = (streak: number) => `Quiet week? No stress. Ship anything small by Sunday and your ${streak}-week streak stays alive.`;

/** The users milestones (app_usage users: people in the last 30 days), each said once ever. */
export const NUDGE_MILESTONES = [10, 100, 1000] as const;
/** The Friday line needs at least this streak. */
export const FRIDAY_STREAK_MIN = 2;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type NudgeKind = 'outcome' | 'milestone' | 'closing' | 'friday';
export type NudgeIn = {
  /** The project's name as the reply names it (else the main project's stored name). */
  project?: string | null;
  /** The Best fit's title (the milestone line names it; none: the line ends at "That's real traction."). */
  best?: string | null;
};
type NudgePick = { kind: NudgeKind; line: string | null; keep: Record<string, unknown> };
type NudgeSeen = { nudge_week?: string; nudge_users?: number; nudge_outcomes?: Record<string, string> };

/** "today" when `end` is on `now`'s UTC day, else its UTC weekday ("Friday"). Pure. */
export const closesOn = (end: Date, now: Date) =>
  end.toISOString().slice(0, 10) === now.toISOString().slice(0, 10) ? 'today' : WEEKDAYS[end.getUTCDay()];
/** The highest milestone `users` reached above both `before` (the count before this week) and the last one said. Pure. */
export function milestoneCrossed(users: number, before: number, said: number): number | null {
  const floor = Math.max(before, said);
  return [...NUDGE_MILESTONES].reverse().find((n) => users >= n && n > floor) ?? null;
}
/** Friday, Saturday or Sunday (UTC). Pure. */
export const lateWeek = (now: Date) => [5, 6, 0].includes(now.getUTCDay());

/**
 * Accepted or funded (a verified outcome post, post-reply.ts outcomePost): not shared yet (never tapped), still live,
 * said once a program. A congratulation already shown this week (its draft made this week, in the tell's reply) is not
 * repeated: it is the week's nudge (claimed, no line).
 */
async function outcomePick(id: number, now: Date, monday: string, seen: NudgeSeen): Promise<NudgePick | null> {
  const rows = await sql()<{ code: string; program_id: string; title: string; created_at: Date; tapped: boolean }[]>`
    SELECT d.code, substr(d.moment_key, length(d.moment) + 2) AS program_id, g.title, d.created_at, d.first_tap_at IS NOT NULL AS tapped
    FROM post_drafts d JOIN programs g ON g.id = substr(d.moment_key, length(d.moment) + 2)
    WHERE d.builder_id = ${id} AND d.moment IN ('accepted', 'funded') AND d.proof_url IS NOT NULL
      AND d.created_at <= ${now} AND d.expires_at > ${now}
    ORDER BY d.created_at DESC`;
  const told = seen.nudge_outcomes ?? {};
  const thisWeek = rows.find((r) => r.created_at.getTime() >= Date.parse(`${monday}T00:00:00Z`));
  if (thisWeek) return { kind: 'outcome', line: null, keep: { nudge_outcomes: { ...told, [thisWeek.program_id]: now.toISOString() } } };
  const r = rows.find((x) => !x.tapped && !told[x.program_id]);
  if (!r) return null;
  const [p] = await sql()<{ handle: string | null }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`;
  if (!p?.handle) return null;
  return { kind: 'outcome', line: acceptedNudge(r.title, shortLink(p.handle, r.code)), keep: { nudge_outcomes: { ...told, [r.program_id]: now.toISOString() } } };
}

/** A users milestone crossed this week (the newest fresh app_usage day against the last day before this week's Monday). */
async function milestonePick(id: number, now: Date, monday: string, seen: NudgeSeen, o: NudgeIn): Promise<NudgePick | null> {
  const today = now.toISOString().slice(0, 10);
  const [u] = await sql()<{ users: number | null; before: number | null }[]>`
    SELECT
      (SELECT max(users) FROM (SELECT DISTINCT ON (source) users FROM app_usage
        WHERE builder_id = ${id} AND day <= ${today}::date AND day >= ${today}::date - ${USED_STALE_DAYS}::int ORDER BY source, day DESC) x)::int AS users,
      (SELECT max(users) FROM (SELECT DISTINCT ON (source) users FROM app_usage
        WHERE builder_id = ${id} AND day < ${monday}::date ORDER BY source, day DESC) y)::int AS before`;
  const n = milestoneCrossed(u?.users ?? 0, u?.before ?? 0, seen.nudge_users ?? 0);
  if (n === null) return null;
  const project = o.project ?? (await mainName(id));
  if (!project) return null;
  return { kind: 'milestone', line: milestoneNudge(project, n, o.best ?? null), keep: { nudge_users: n } };
}
async function mainName(id: number): Promise<string | null> {
  const [r] = await sql()<{ name: string }[]>`
    SELECT b.name FROM builder_projects b JOIN builder_profiles f ON f.builder_id = b.builder_id AND lower(b.project_key) = lower(f.main_project_key)
    WHERE b.builder_id = ${id}`;
  return r?.name ?? null;
}

/**
 * A program closing within DEADLINE_DAYS with the builder's draft ready: an entry (a confirmed projects row) not
 * submitted yet (projects.ts openEntries' rule), the program still open, not one the builder said they applied to.
 */
async function closingPick(id: number, now: Date): Promise<NudgePick | null> {
  const [e] = await sql()<{ title: string; ends_at: Date }[]>`
    SELECT pr.title, pr.ends_at FROM projects p JOIN programs pr ON pr.id = p.program_id JOIN installations i ON i.id = p.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${id} AND pr.status = 'active' AND pr.campaign IS NULL AND p.program_id <> ${COIN_PROGRAM}
      AND p.confirmed_at IS NOT NULL AND p.submission_confirmed_at IS NULL AND p.submission_proof_ok_at IS NULL
      AND pr.ends_at > ${now} AND pr.ends_at <= ${new Date(now.getTime() + DEADLINE_DAYS * DAY_MS)}
      AND NOT EXISTS (SELECT 1 FROM builder_program_status s WHERE s.installation_id = p.installation_id AND s.program_id = p.program_id AND s.status = 'applied')
    ORDER BY pr.ends_at LIMIT 1`;
  return e ? { kind: 'closing', line: closingNudge(e.title, closesOn(e.ends_at, now)), keep: {} } : null;
}

/** Nothing shipped this ISO week by Friday (Friday to Sunday UTC), with a streak of FRIDAY_STREAK_MIN or more. */
async function fridayPick(id: number, now: Date): Promise<NudgePick | null> {
  if (!lateWeek(now)) return null;
  const s = (await streaksFor([id], now)).get(id);
  if (!s || s.weeks.has(isoWeekOf(now)) || s.streak < FRIDAY_STREAK_MIN) return null;
  return { kind: 'friday', line: fridayNudge(s.streak), keep: {} };
}

/**
 * This week's nudge, claimed (standing_seen.nudge_week = the week's Monday, with what the pick remembers), or null:
 * one was shown (or counted) this week already, none is due, or a read failed (logged). Never throws.
 */
export async function takeNudge(builderId: number, now: Date, o: NudgeIn = {}): Promise<{ kind: NudgeKind; line: string } | null> {
  try {
    const monday = mondayOf(now);
    const [p] = await sql()<{ seen: NudgeSeen | null }[]>`SELECT standing_seen AS seen FROM builder_profiles WHERE builder_id = ${builderId}`;
    if (!p) return null;
    const seen = p.seen ?? {};
    if (seen.nudge_week === monday) return null;
    const pick = (await outcomePick(builderId, now, monday, seen)) ?? (await milestonePick(builderId, now, monday, seen, o))
      ?? (await closingPick(builderId, now)) ?? (await fridayPick(builderId, now));
    if (!pick) return null;
    const keep = { ...pick.keep, nudge_week: monday };
    const [taken] = await sql()`
      UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || ${sql().json(keep as never)}::jsonb
      WHERE builder_id = ${builderId} AND COALESCE(standing_seen->>'nudge_week', '') <> ${monday} RETURNING 1`;
    return taken && pick.line ? { kind: pick.kind, line: pick.line } : null;
  } catch (err) {
    console.error('[nudge]', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/** v4.0 Task 8: this week's one nudge line (takeNudge), or null. Never throws. */
export async function nudgeFor(builderId: number, now: Date, o: NudgeIn = {}): Promise<string | null> {
  return (await takeNudge(builderId, now, o))?.line ?? null;
}
