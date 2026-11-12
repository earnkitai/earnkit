/**
 * The owner's one email a day: programs closed by their deadline, programs opened by their start date, links that
 * failed, source pages that changed, and the day's changes to live programs, each with a revert link when one can be
 * made. Nothing happened, nothing sent; mail not set up (RESEND_API_KEY unset), 'mail off'. The idempotency key is the
 * UTC day and the body's hash (v6.1.16 Task 16): the same body is sent once a day, a changed one again. v6.1.17 Task 3:
 * first, a gap of over GAP_HOURS since the last daily run that finished (L30-14); and the programs the walk could not
 * read, each `{id}: {fix}` (L30-18, L35-18). v6.1.18 Task 5 (L18-5): the previous UTC day's sends, by agents, drafted here, reported.
 */
import { createHash } from 'node:crypto';
import { sql } from './db';
import { ownerMail, type Mailer } from './mail';
import { ProgramFile } from './program-file';
import type { Unreadable } from './health';
import { findProgramsDir, revertPlan } from './programs-api';
import { revertExpiry, revertUrl } from './programs-pending';
import { sendCounts, sendRows } from './stats';

export type DigestChange = { id: string; title: string; fields: string[]; revertUrl: string | null; revertNote?: string };
export type DigestHealth = {
  closed: { id: string; title: string }[];
  /** v6.1.16 Task 16 (L30-1): upcoming programs the daily run opened at their start date. */
  opened?: { id: string; title: string }[];
  failing: { id: string; title: string; url: string }[];
  changed: { id: string; title: string; url: string }[];
  /** v6.1.17 Task 3 (L30-18, L35-18): programs the walk could not read, with the owner's fix. */
  unreadable?: Unreadable[];
  /** v6.1.17 Task 3 (L30-14): the last daily run before this one, when it finished over GAP_HOURS before now. */
  gap?: { hours: number; last: Date };
};

/**
 * v6.1.18 Task 5 (L18-5, L36-3): the previous UTC day's sends (`sent`: by agents, drafted here and sent by builders,
 * reported from outside), every send before the digest's day, and each program with sends that day.
 */
export type DigestApplications = {
  sent: number; agent: number; drafted: number; reported: number; total: number;
  byProgram: { id: string; title: string; sent: number }[];
};

/** v6.1.17 Task 3 (L30-14): a gap over this many hours since the last daily run is named in the digest. */
export const GAP_HOURS = 26;
const HOUR = 3_600_000;

/** The gap since `last` when it is over GAP_HOURS (whole hours, rounded down), else null. Pure. */
export function runGap(last: Date | null, now: Date): { hours: number; last: Date } | null {
  if (!last || now.getTime() - last.getTime() <= GAP_HOURS * HOUR) return null;
  return { hours: Math.floor((now.getTime() - last.getTime()) / HOUR), last };
}

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
export function dailyOwnerText(day: string, changes: DigestChange[], health: DigestHealth, apps?: DigestApplications): string | null {
  const blocks: string[] = [];
  if (health.gap) {
    const at = health.gap.last.toISOString().slice(0, 16).replace('T', ' ');
    blocks.push(`No daily run finished for ${health.gap.hours} hours before this one; the last was ${at} UTC.`);
  }
  // L18-5 (v6.1.18 Task 5): the previous UTC day's sends, most sent program first; a day with none adds nothing.
  if (apps && apps.sent > 0) {
    const programs = [...apps.byProgram].sort((a, b) => b.sent - a.sent || a.id.localeCompare(b.id));
    blocks.push([
      `Applications: ${apps.sent} sent (${apps.agent} by agents, ${apps.drafted} drafted here and sent by builders, ${apps.reported} reported from outside); ${apps.total} all time.`,
      ...programs.map((p) => `- ${oneLine(p.title)} (${p.id}): ${p.sent}`),
    ].join('\n'));
  }
  if (health.unreadable?.length) {
    blocks.push(['Programs the run could not read', ...health.unreadable.map((u) => `- ${u.id}: ${oneLine(u.fix)}`)].join('\n'));
  }
  if (health.closed.length > 0) {
    blocks.push(['Closed because the deadline passed', ...health.closed.map((p) => `- ${oneLine(p.title)} (${p.id})`)].join('\n'));
  }
  if (health.opened?.length) {
    blocks.push(['Opened because the start date came', ...health.opened.map((p) => `- ${oneLine(p.title)} (${p.id})`)].join('\n'));
  }
  if (health.failing.length > 0) {
    blocks.push(['Links that did not load', ...health.failing.map((p) => `- ${oneLine(p.title)}: ${p.url}`)].join('\n'));
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
 * L18-5 (v6.1.18 Task 5, fix round 1): the sends of the UTC day before `dayStart` (send time `sent_at`, else `at`), and
 * every send before `dayStart`, so the block never changes within the digest's day (a same-day rerun builds the same body).
 */
async function digestApplications(dayStart: Date): Promise<DigestApplications> {
  const db = sql();
  const from = new Date(dayStart.getTime() - 86_400_000);
  const [t] = await db<{ all: string; agent: string; drafted: string; reported: string; total: string }[]>`
    WITH s AS (${sendRows(db)}), d AS (SELECT * FROM s WHERE sent_time >= ${from} AND sent_time < ${dayStart})
    SELECT ${sendCounts(db)}, (SELECT count(*) FROM s WHERE sent_time < ${dayStart}) AS total FROM d`;
  const rows = await db<{ id: string; title: string | null; sent: string }[]>`
    WITH s AS (${sendRows(db)})
    SELECT program_id AS id, max(title) AS title, count(*) AS sent FROM s WHERE sent_time >= ${from} AND sent_time < ${dayStart} GROUP BY program_id`;
  return {
    sent: Number(t.all), agent: Number(t.agent), drafted: Number(t.drafted), reported: Number(t.reported), total: Number(t.total),
    byProgram: rows.map((r) => ({ id: r.id, title: r.title ?? r.id, sent: Number(r.sent) })),
  };
}

/** The digest's idempotency key: the UTC day and the first 16 hex of the body's sha256. Pure. */
export const digestKey = (day: string, body: string) => `owner-digest:${day}:${createHash('sha256').update(body).digest('hex').slice(0, 16)}`;

/**
 * Gathers the UTC day's events, mails the digest if there is one: 'sent', 'none' (nothing to say, or this body was
 * already sent today), or 'mail off' (RESEND_API_KEY unset, checked first, nothing read or sent).
 */
export async function sendOwnerDigest(now: Date, mailer?: Mailer, run: { unreadable?: Unreadable[] } = {}): Promise<'sent' | 'none' | 'mail off'> {
  if (!process.env.RESEND_API_KEY?.trim()) return 'mail off';
  const day = now.toISOString().slice(0, 10);
  const dayStart = new Date(`${day}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const db = sql();
  // Changes since the last digest of an earlier day (a re-send the same day keeps its window); 24 h with none.
  const [last] = await db<{ sent_at: Date }[]>`SELECT sent_at FROM owner_digests WHERE day < ${day} ORDER BY day DESC LIMIT 1`;
  const since = last?.sent_at ?? new Date(now.getTime() - 86_400_000);

  const closedRows = await db<TitleRow[]>`
    SELECT DISTINCT p.id, p.file FROM program_changes c JOIN programs p ON p.id = c.program_id
    WHERE c.at > ${since} AND c.at <= ${now} AND c.fields = ARRAY['status']::text[]
      AND p.status = 'closed' AND p.ends_at IS NOT NULL AND p.ends_at <= c.at ORDER BY p.id`;
  const healthRows = await db<(TitleRow & { source_ok: boolean; submit_ok: boolean; changed_day: boolean })[]>`
    SELECT p.id, p.file, h.source_ok, h.submit_ok, (h.changed_at >= ${dayStart} AND h.changed_at < ${dayEnd}) AS changed_day
    FROM program_health h JOIN programs p ON p.id = h.program_id
    WHERE p.status IN ('active', 'upcoming') AND h.checked_at >= ${dayStart} AND h.checked_at < ${dayEnd}
      AND (NOT h.source_ok OR NOT h.submit_ok OR h.changed_at >= ${dayStart})
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
    failing: [], changed: [],
    unreadable: run.unreadable ?? [],
  };
  // The gap belongs to the UTC day (fix round 1, M2): from the last run before today's start to today's first run (or
  // this one, when it is the first), so a second run the same day builds the same body and is not sent again. This run
  // stores its own time only after the digest (cron.ts).
  const [state] = await db<{ last_run_at: Date; prev_run_at: Date | null; day_first_at: Date | null }[]>`
    SELECT last_run_at, prev_run_at, day_first_at FROM cron_state WHERE id`;
  const today = state && state.last_run_at >= dayStart;
  const gap = today ? runGap(state.prev_run_at, state.day_first_at ?? now) : runGap(state?.last_run_at ?? null, now);
  if (gap) health.gap = gap;
  for (const r of healthRows) {
    const f = ProgramFile.safeParse(r.file).data;
    if (!f) continue;
    if (!r.source_ok) health.failing.push({ id: r.id, title: f.title, url: f.source_url });
    if (!r.submit_ok) health.failing.push({ id: r.id, title: f.title, url: f.submission_url });
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

  const apps = await digestApplications(dayStart);
  const text = dailyOwnerText(day, changes, health, apps);
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
