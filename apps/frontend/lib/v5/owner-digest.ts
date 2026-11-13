/**
 * The owner's one email a day: programs closed by their deadline, programs opened by their start date, links that
 * failed, source pages that changed, and the day's changes to live programs, each with a revert link when one can be
 * made. Nothing happened, nothing sent; mail not set up (RESEND_API_KEY unset), 'mail off'. The idempotency key is the
 * UTC day and the body's hash (v6.1.16 Task 16): the same body is sent once a day, a changed one again. v6.1.17 Task 3:
 * first, a gap of over GAP_HOURS since the last daily run that finished (L30-14); and the programs the walk could not
 * read, each `{id}: {fix}` (L30-18, L35-18). v6.1.18 Task 5 (L18-5): the previous UTC day's sends, by agents, drafted here, from outside (v6.1.19 L42-7: one line).
 * v6.1.18 (L39-5): a submission page that answers but says it is closed. v6.1.19 (lane 44): built only by a run that
 * finished its link check (cron.ts), from the stored rows: the unreadable list too (L44-20); opens with a failed check's
 * day (L44-10); closed forms in their own block with their age, one round closed named once (L44-6, L44-7, L44-8);
 * failing links with their age and `(not listed)` once off the builders' list (L44-8); sends on days no digest went
 * out carried in (L44-9); wins and rejections since the last digest (L44-11); the gap only over 26 hours, in true hours
 * (L44-12); a program at its start with no form under `Programs to fix` by title (L44-13); per-program sends by title
 * (L44-18). Never names a builder.
 */
import { createHash } from 'node:crypto';
import { sql } from './db';
import { BESIDE_NOTE } from './ledger';
import { ownerMail, type Mailer } from './mail';
import { ProgramFile } from './program-file';
import { movedByDate, UNREADABLE_FIX, type Unreadable } from './health';
import { listListedPrograms } from './programs';
import { findProgramsDir, revertPlan } from './programs-api';
import { revertExpiry, revertUrl } from './programs-pending';
import { sendCounts, sendRows } from './stats';

export type DigestChange = { id: string; title: string; fields: string[]; revertUrl: string | null; revertNote?: string };
export type DigestHealth = {
  closed: { id: string; title: string }[];
  /** v6.1.16 Task 16 (L30-1): upcoming programs the daily run opened at their start date. */
  opened?: { id: string; title: string }[];
  /** v6.1.19 (L44-8): `days` the whole days since the link first failed (0: today); `unlisted` off the builders' list. */
  failing: { id: string; title: string; url: string; days?: number; unlisted?: boolean }[];
  /**
   * v6.1.19 (L44-6, L44-7, L44-8, L44-19): pages that say they are closed (active programs only): `on` the form or the
   * source page; `round` only a round or region is closed (named on the day it was first seen); `days` since it first said so.
   */
  formsClosed?: { id: string; title: string; url: string; on: 'form' | 'source'; round?: boolean; days: number; unlisted?: boolean }[];
  changed: { id: string; title: string; url: string }[];
  /** v6.1.17 Task 3 (L30-18, L35-18): programs whose saved entry does not read, with the owner's fix. */
  unreadable?: Unreadable[];
  /** v6.1.19 (L44-13): programs that read fine but need the owner (an upcoming one at its start with no form). */
  toFix?: { id: string; title: string; fix: string }[];
  /** v6.1.17 Task 3 (L30-14): the last daily run before this one, when it finished over GAP_HOURS before now. */
  gap?: { hours: number; last: Date };
  /** v6.1.19 (L44-10): a run's link check failed on `day` (a UTC date) with no digest that day; the digest covers `days`. */
  checkFailed?: { day: string; days: number };
};

/** v6.1.19 (L44-11): wins (their money as given, per currency; empty when none was said) and rejections since the last digest. */
export type DigestResults = { won: { title: string; amounts: { currency: string; amount: number }[] }[]; rejected: string[] };

/**
 * v6.1.18 Task 5 (L18-5, L36-3): the previous UTC day's sends (`sent`: by agents, drafted here and sent by builders, from
 * outside), every dated send before the digest's day, and each program with sends that day.
 */
export type DigestApplications = {
  sent: number; agent: number; drafted: number; reported: number; total: number;
  byProgram: { id: string; title: string; sent: number }[];
  /** v6.1.19 (L44-9): sends on the days since the last digest that no digest reported (a UTC date and its count). */
  missed?: { day: string; sent: number }[];
};

/** v6.1.17 Task 3 (L30-14): a gap over this many hours since the last daily run is named in the digest. */
export const GAP_HOURS = 26;
const HOUR = 3_600_000;

/**
 * The gap since `last` in whole hours, rounded to the nearest (v6.1.19 L44-12: the true hours), when that is over
 * GAP_HOURS, else null. Pure.
 */
export function runGap(last: Date | null, now: Date): { hours: number; last: Date } | null {
  if (!last) return null;
  const hours = Math.round((now.getTime() - last.getTime()) / HOUR);
  return hours > GAP_HOURS ? { hours, last } : null;
}

const DAY_MS = 86_400_000;
/** A UTC date (`2026-11-12`, or a time) as the owner reads it: `Nov 12`. Pure. */
export const shortDay = (d: string | Date): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(typeof d === 'string' ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d);
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
/** v6.1.19 (L44-8): an age in whole days: `since today`, `1 day`, `4 days`. Pure. */
const age = (days: number) => (days <= 0 ? 'since today' : days === 1 ? '1 day' : `${days} days`);
/** Money as given: `$5,000` for US dollars, else `2,000 EUR`; never converted. Pure. */
const money = (m: { currency: string; amount: number }) => {
  const n = m.amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return m.currency === 'USD' ? `$${n}` : `${n} ${m.currency}`;
};

const FIELD_WORDS: Record<string, string> = {
  ends_at: 'deadline',
  max_award_usd: 'amount',
  status: 'status',
  submission_url: 'submission link',
  form: 'form',
  submission_requirements: 'requirements',
};

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The email body, or null when the lists are all empty. Pure. */
export function dailyOwnerText(day: string, changes: DigestChange[], health: DigestHealth, apps?: DigestApplications, results?: DigestResults): string | null {
  const blocks: string[] = [];
  // L44-10 (v6.1.19): first, a day whose check failed and that no digest covered.
  if (health.checkFailed) {
    blocks.push(`The link check failed on ${shortDay(health.checkFailed.day)}; this digest covers ${countWord(health.checkFailed.days)} days.`);
  }
  if (health.gap) {
    const at = health.gap.last.toISOString().slice(0, 16).replace('T', ' ');
    blocks.push(`No daily run finished for ${health.gap.hours} hours before this one; the last was ${at} UTC.`);
  }
  // L18-5 (v6.1.18 Task 5): the previous UTC day's sends, most sent program first; a day with none adds nothing.
  // L42-7, L42-10 (v6.1.19): one line, the day first; `total` is every dated send through the end of yesterday.
  // L44-9: sends on days no digest reported are carried in; L44-18: each program by its title.
  const missed = (apps?.missed ?? []).filter((m) => m.sent > 0);
  if (apps && (apps.sent > 0 || missed.length > 0)) {
    const programs = [...apps.byProgram].sort((a, b) => b.sent - a.sent || a.id.localeCompare(b.id));
    const carried = missed.length > 0 ? ` (and ${missed.map((m) => `${m.sent} on ${shortDay(m.day)}`).join(', ')}, missed)` : '';
    blocks.push([
      apps.sent > 0
        ? `${apps.sent} sent yesterday: ${apps.agent} by agents, ${apps.drafted} drafted here, ${apps.reported} from outside${carried}. ${apps.total} to date.`
        : `0 sent yesterday${carried}. ${apps.total} to date.`,
      ...programs.map((p) => `- ${oneLine(p.title)}: ${p.sent} sent`),
    ].join('\n'));
  }
  // L44-11: the results since the last digest, never who.
  if (results && (results.won.length > 0 || results.rejected.length > 0)) {
    const parts = [
      ...results.won.map((w) => (w.amounts.length > 0 ? `${w.amounts.map(money).join(' and ')} won at ${oneLine(w.title)}` : `won at ${oneLine(w.title)}`)),
      ...results.rejected.map((t) => `${oneLine(t)} said no`),
    ];
    blocks.push(`Results: ${parts.join('; ')}.`);
  }
  if (health.unreadable?.length) {
    blocks.push(['Programs the run could not read', ...health.unreadable.map((u) => `- ${u.id}: ${oneLine(u.fix)}`)].join('\n'));
  }
  if (health.toFix?.length) {
    blocks.push(['Programs to fix', ...health.toFix.map((u) => `- ${oneLine(u.title)}: ${oneLine(u.fix)}`)].join('\n'));
  }
  if (health.closed.length > 0) {
    blocks.push(['Closed because the deadline passed', ...health.closed.map((p) => `- ${oneLine(p.title)} (${p.id})`)].join('\n'));
  }
  if (health.opened?.length) {
    blocks.push(['Opened because the start date came', ...health.opened.map((p) => `- ${oneLine(p.title)} (${p.id})`)].join('\n'));
  }
  const named = (p: { title: string; unlisted?: boolean }) => `${oneLine(p.title)}${p.unlisted ? ' (not listed)' : ''}`;
  if (health.failing.length > 0) {
    blocks.push(['Links that did not load', ...health.failing.map((p) =>
      p.days === undefined ? `- ${named(p)}: ${p.url}` : `- ${named(p)}: down ${age(p.days)} (${p.url})`)].join('\n'));
  }
  if (health.formsClosed?.length) {
    blocks.push(['Forms that say they are closed', ...health.formsClosed.map((p) => {
      const what = p.on === 'form' ? 'the form' : 'the page';
      return p.round ? `- ${named(p)}: ${what} says one round is closed (${p.url}); check it.` : `- ${named(p)}: ${what} says it is closed, ${age(p.days)} (${p.url})`;
    })].join('\n'));
  }
  if (health.changed.length > 0) {
    blocks.push(['Pages that changed', ...health.changed.map((p) => `- ${oneLine(p.title)}: ${p.url}`)].join('\n'));
  }
  if (changes.length > 0) {
    const lines = changes.map((c) => {
      const words = c.fields.map((f) => FIELD_WORDS[f] ?? f).join(', ');
      return `- ${oneLine(c.title)}: ${words}${c.revertUrl ? `\n  Revert: ${c.revertUrl}` : c.revertNote ? ` ${c.revertNote}` : ''}`;
    });
    blocks.push(['Changes to live programs', ...lines].join('\n'));
  }
  return blocks.length === 0 ? null : [`EarnKit programs: ${day}`, ...blocks].join('\n\n') + '\n';
}

type TitleRow = { id: string; file: unknown };
const titleOf = (r: TitleRow) => ProgramFile.safeParse(r.file).data?.title ?? r.id;

type Link = { url: string | null; note?: string };

/** A revert link for the program's latest applied write; otherwise why there is none. */
async function revertLinkFor(id: string, now: Date, failures: Set<string>): Promise<Link> {
  const db = sql();
  try {
    const [w] = await db<{ id: string }[]>`
      SELECT id FROM program_writes WHERE program_id = ${id}
        AND ((action = 'upsert' AND result IN ('created', 'updated')) OR (action = 'close' AND result = 'closed'))
      ORDER BY id DESC LIMIT 1`;
    if (!w) return { url: null, note: '(not revertable)' };
    const plan = await revertPlan(db, w.id, findProgramsDir(), false);
    return plan.kind === 'ok' ? { url: revertUrl(w.id, revertExpiry(now)) } : { url: null, note: '(not revertable)' };
  } catch (err) {
    failures.add(err instanceof Error ? err.name.replace(/[^\w]/g, '').slice(0, 40) : 'unknown');
    return { url: null, note: '(no revert link)' };
  }
}

/**
 * L18-5 (v6.1.18 Task 5, fix round 1): the sends of the UTC day before `dayStart` (by `sendTime`, stats.ts), and
 * every send before `dayStart`, so the block never changes within the digest's day (a same-day rerun builds the same body).
 * v6.1.19 (L42-1, L42-2): a result on an older send is not a send that day; an undated send (outside EarnKit) counts in
 * neither number.
 */
async function digestApplications(dayStart: Date, lastDay: string | null): Promise<DigestApplications> {
  const db = sql();
  const from = new Date(dayStart.getTime() - 86_400_000);
  // L44-9 (v6.1.19): the days from the last digest's day up to yesterday went unreported (that digest covered the day
  // before it); at most MISSED_DAYS back.
  const missedFrom = lastDay ? new Date(Math.max(Date.parse(`${lastDay}T00:00:00Z`), dayStart.getTime() - MISSED_DAYS * DAY_MS)) : null;
  const missed = missedFrom && missedFrom < from
    ? await db<{ day: string; sent: string }[]>`
      WITH s AS (${sendRows(db)})
      SELECT to_char(sent_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) AS sent FROM s
      WHERE sent_time >= ${missedFrom} AND sent_time < ${from} GROUP BY 1 ORDER BY 1`
    : [];
  const [t] = await db<{ all: string; agent: string; drafted: string; reported: string; total: string }[]>`
    WITH s AS (${sendRows(db)}), d AS (SELECT * FROM s WHERE sent_time >= ${from} AND sent_time < ${dayStart})
    SELECT ${sendCounts(db)}, (SELECT count(*) FROM s WHERE sent_time < ${dayStart}) AS total FROM d`;
  const rows = await db<{ id: string; title: string | null; sent: string }[]>`
    WITH s AS (${sendRows(db)})
    SELECT program_id AS id, max(title) AS title, count(*) AS sent FROM s WHERE sent_time >= ${from} AND sent_time < ${dayStart} GROUP BY program_id`;
  return {
    sent: Number(t.all), agent: Number(t.agent), drafted: Number(t.drafted), reported: Number(t.reported), total: Number(t.total),
    byProgram: rows.map((r) => ({ id: r.id, title: r.title ?? r.id, sent: Number(r.sent) })),
    missed: missed.map((m) => ({ day: m.day, sent: Number(m.sent) })),
  };
}

/** v6.1.19 (L44-9): sends on unreported days are carried in from at most this many days back. */
export const MISSED_DAYS = 14;

/**
 * v6.1.19 (L44-11): the wins and rejections recorded in (`since`, `now`], from the history (a further payment adds its
 * money to its program's win), by program title, never by who. Final fix round (I1): only results that stand: a row kept
 * beside a win (BESIDE_NOTE) is never counted, a rejection is dropped while its application is still won, and one win
 * per application (its newest, which a correction replaced an older amount with) is counted, plus its further payments.
 */
async function digestResults(since: Date, now: Date): Promise<DigestResults> {
  const db = sql();
  const rows = await db<{ status: string; title: string; currency: string | null; amount: string | null }[]>`
    WITH r AS (
      SELECT h.*, row_number() OVER (PARTITION BY h.owner, h.program_id, COALESCE(h.project_id, ''), h.status, (h.payment_key IS NULL) ORDER BY h.at DESC, h.id DESC) AS n
      FROM application_history h
      WHERE h.status IN ('won', 'rejected') AND h.at > ${since} AND h.at <= ${now} AND h.note IS DISTINCT FROM ${BESIDE_NOTE})
    SELECT h.status, COALESCE(p.file->>'title', (SELECT a.title FROM applications a WHERE a.owner = h.owner AND a.program_id = h.program_id AND a.title IS NOT NULL LIMIT 1), h.program_id) AS title,
           h.currency, sum(h.amount) AS amount
    FROM r h LEFT JOIN programs p ON p.id = h.program_id
    WHERE (h.status = 'won' AND (h.payment_key IS NOT NULL OR h.n = 1))
      OR (h.status = 'rejected' AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.owner = h.owner AND a.program_id = h.program_id
        AND COALESCE(a.project_id, '') = COALESCE(h.project_id, '') AND a.status = 'won'))
    GROUP BY 1, 2, 3 ORDER BY 2, 3`;
  const won = new Map<string, { currency: string; amount: number }[]>();
  const rejected = new Set<string>();
  for (const r of rows) {
    if (r.status === 'rejected') {
      rejected.add(r.title);
      continue;
    }
    const list = won.get(r.title) ?? [];
    if (r.currency && r.amount !== null) list.push({ currency: r.currency, amount: Number(r.amount) });
    won.set(r.title, list);
  }
  return { won: [...won].map(([title, amounts]) => ({ title, amounts })), rejected: [...rejected] };
}

/**
 * v6.1.19 (L44-20, L44-13): from the stored programs, not the run: listed rows whose saved entry no longer reads (by id)
 * and upcoming ones at their start with no form (by title, to fix). Pure over the rows.
 */
function needsOwner(rows: TitleRow[], now: Date): { unreadable: Unreadable[]; toFix: { id: string; title: string; fix: string }[] } {
  const unreadable: Unreadable[] = [];
  const toFix: { id: string; title: string; fix: string }[] = [];
  for (const r of rows) {
    const f = ProgramFile.safeParse(r.file);
    if (!f.success) unreadable.push({ id: r.id, fix: UNREADABLE_FIX.parse });
    else if (f.data.status === 'upcoming') {
      const move = movedByDate(f.data, now);
      if (move && 'blocked' in move) toFix.push({ id: r.id, title: f.data.title, fix: UNREADABLE_FIX.noForm });
    }
  }
  return { unreadable, toFix };
}

/** The digest's idempotency key: the UTC day and the first 16 hex of the body's sha256. Pure. */
export const digestKey = (day: string, body: string) => `owner-digest:${day}:${createHash('sha256').update(body).digest('hex').slice(0, 16)}`;

/**
 * Gathers the UTC day's events, mails the digest if there is one: 'sent', 'none' (nothing to say, or this body was
 * already sent today), or 'mail off' (RESEND_API_KEY unset, checked first, nothing read or sent).
 */
export async function sendOwnerDigest(now: Date, mailer?: Mailer): Promise<'sent' | 'none' | 'mail off'> {
  if (!process.env.RESEND_API_KEY?.trim()) return 'mail off';
  const day = now.toISOString().slice(0, 10);
  const dayStart = new Date(`${day}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const db = sql();
  // Changes since the last digest of an earlier day (a re-send the same day keeps its window); 24 h with none.
  const [last] = await db<{ day: string; sent_at: Date }[]>`SELECT day, sent_at FROM owner_digests WHERE day < ${day} ORDER BY day DESC LIMIT 1`;
  const since = last?.sent_at ?? new Date(now.getTime() - 86_400_000);
  // Fix round 2: one round closed is new when it began after the last digest of an earlier day was sent (any time with
  // none), so a round that began on a day no digest covered is still named once.
  const roundFrom = last?.sent_at ?? new Date(0);

  const closedRows = await db<TitleRow[]>`
    SELECT DISTINCT p.id, p.file FROM program_changes c JOIN programs p ON p.id = c.program_id
    WHERE c.at > ${since} AND c.at <= ${now} AND c.fields = ARRAY['status']::text[]
      AND p.status = 'closed' AND p.ends_at IS NOT NULL AND p.ends_at <= c.at ORDER BY p.id`;
  // Final fix (M1): a form that says it is closed is news for an active program only; an upcoming one's form is closed
  // until it opens (Base Builder Grants between rounds), so it is never listed every day.
  // v6.1.19 (L44-7): one round closed is news on the day it was first seen only.
  const healthRows = await db<(TitleRow & {
    status: string; source_ok: boolean; submit_ok: boolean; submit_closed: boolean; closed_round: boolean; closed_on: 'form' | 'source' | null;
    closed_since: Date | null; first_failed_at: Date | null; changed_day: boolean;
  })[]>`
    SELECT p.id, p.file, p.status, h.source_ok, h.submit_ok, h.submit_closed, h.closed_round, h.closed_on, h.closed_since, h.first_failed_at,
           (h.changed_at >= ${dayStart} AND h.changed_at < ${dayEnd}) AS changed_day
    FROM program_health h JOIN programs p ON p.id = h.program_id
    WHERE p.status IN ('active', 'upcoming') AND h.checked_at >= ${dayStart} AND h.checked_at < ${dayEnd}
      AND (NOT h.source_ok OR NOT h.submit_ok OR (h.submit_closed AND p.status = 'active')
        OR (h.closed_round AND p.status = 'active' AND h.closed_since > ${roundFrom}) OR h.changed_at >= ${dayStart})
    ORDER BY p.id`;
  const openedRows = await db<TitleRow[]>`
    SELECT DISTINCT p.id, p.file FROM program_changes c JOIN programs p ON p.id = c.program_id
    WHERE c.at > ${since} AND c.at <= ${now} AND c.fields = ARRAY['status']::text[]
      AND p.status = 'active' AND (p.file->>'starts_at') IS NOT NULL AND (p.file->>'starts_at')::timestamptz <= c.at ORDER BY p.id`;
  const opened = new Set(openedRows.map((r) => r.id));
  const changeRows = await db<(TitleRow & { fields: string[] })[]>`
    SELECT p.id, p.file, c.fields FROM program_changes c JOIN programs p ON p.id = c.program_id
    WHERE c.at > ${since} AND c.at <= ${now} AND p.status IN ('active', 'upcoming') ORDER BY c.id`;

  const health: DigestHealth = {
    closed: closedRows.map((r) => ({ id: r.id, title: titleOf(r) })),
    opened: openedRows.map((r) => ({ id: r.id, title: titleOf(r) })),
    failing: [], formsClosed: [], changed: [],
    ...needsOwner(await db<TitleRow[]>`SELECT id, file FROM programs WHERE status IN ('active', 'upcoming') ORDER BY id`, now),
  };
  // The gap belongs to the UTC day (fix round 1, M2): from the last run before today's start to today's first run (or
  // this one, when it is the first), so a second run the same day builds the same body and is not sent again. This run
  // stores its own time only after the digest (cron.ts).
  const [state] = await db<{ last_run_at: Date | null; prev_run_at: Date | null; day_first_at: Date | null; last_check_failed_at: Date | null }[]>`
    SELECT last_run_at, prev_run_at, day_first_at, last_check_failed_at FROM cron_state WHERE id`;
  const today = state?.last_run_at != null && state.last_run_at >= dayStart;
  const gap = today ? runGap(state.prev_run_at, state.day_first_at ?? now) : runGap(state?.last_run_at ?? null, now);
  if (gap) health.gap = gap;
  // L44-10 (v6.1.19): a failed check on an earlier day that no digest covered, after the last digest sent.
  const failedAt = state?.last_check_failed_at ?? null;
  if (failedAt) {
    const failedDay = failedAt.toISOString().slice(0, 10);
    const [covered] = await db`SELECT 1 FROM owner_digests WHERE day = ${failedDay}`;
    if (failedDay < day && !covered && (!last || failedAt > last.sent_at)) {
      const from = last ? last.day : failedDay;
      const days = Math.round((dayStart.getTime() - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + (last ? 0 : 1);
      health.checkFailed = { day: failedDay, days };
    }
  }
  // L44-8: each failing or closed line's age, and whether builders still see the program.
  const listed = healthRows.length > 0 ? new Set((await listListedPrograms(now)).map((r) => r.id)) : new Set<string>();
  // Fix round 1 (I2): an age counts UTC calendar days from each day's start, as `fail_days` does, never elapsed 24 hours.
  const daysSince = (at: Date | null) => (at ? Math.max(0, Math.round((dayStart.getTime() - Date.parse(`${at.toISOString().slice(0, 10)}T00:00:00Z`)) / DAY_MS)) : 0);
  for (const r of healthRows) {
    const f = ProgramFile.safeParse(r.file).data;
    if (!f) continue;
    const base = { id: r.id, title: f.title, ...(!listed.has(r.id) && { unlisted: true }) };
    if (!r.source_ok) health.failing.push({ ...base, url: f.source_url, days: daysSince(r.first_failed_at) });
    if (!r.submit_ok) health.failing.push({ ...base, url: f.submission_url, days: daysSince(r.first_failed_at) });
    // Fix round 1 (I1), round 2: one round closed only in the first digest after it began, whatever else lists the program; (M1) a
    // closed state kept over an unread run is listed only while the link it names loads.
    const roundToday = r.closed_round && r.closed_since !== null && r.closed_since > roundFrom;
    const loads = r.closed_on === 'form' ? r.submit_ok : r.source_ok;
    if (r.status === 'active' && r.closed_on && loads && (r.submit_closed || roundToday)) {
      health.formsClosed!.push({
        ...base, url: r.closed_on === 'form' ? f.submission_url : f.source_url, on: r.closed_on, days: daysSince(r.closed_since),
        ...(roundToday && { round: true }),
      });
    }
    if (r.changed_day) health.changed.push({ id: r.id, title: f.title, url: f.source_url });
  }
  const links = new Map<string, Link>();
  const failures = new Set<string>();
  const changes: DigestChange[] = [];
  for (const r of changeRows) {
    // The opening is its own block; its status-only change row is not listed again.
    if (opened.has(r.id) && r.fields.length === 1 && r.fields[0] === 'status') continue;
    if (!links.has(r.id)) links.set(r.id, await revertLinkFor(r.id, now, failures));
    const l = links.get(r.id)!;
    changes.push({ id: r.id, title: titleOf(r), fields: r.fields, revertUrl: l.url, ...(l.note && { revertNote: l.note }) });
  }
  if (failures.size > 0) console.error(`[owner-digest] revert links failed: ${[...failures].join(', ')}`);

  const apps = await digestApplications(dayStart, last?.day ?? null);
  const text = dailyOwnerText(day, changes, health, apps, await digestResults(since, now));
  if (text === null) return 'none';
  const key = digestKey(day, text);
  const hash = key.slice(key.lastIndexOf(':') + 1);
  const [sent] = await db<{ body_hash: string | null }[]>`SELECT body_hash FROM owner_digests WHERE day = ${day}`;
  if (sent?.body_hash === hash) return 'none';
  if (!(await ownerMail(`EarnKit programs: ${day}`, text, key, mailer))) return 'mail off';
  await db`INSERT INTO owner_digests (day, sent_at, body_hash) VALUES (${day}, ${now}, ${hash})
    ON CONFLICT (day) DO UPDATE SET sent_at = EXCLUDED.sent_at, body_hash = EXCLUDED.body_hash`;
  return 'sent';
}
