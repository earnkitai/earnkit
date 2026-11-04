/**
 * The owner's one email a day: programs closed by their deadline, links that failed, source pages
 * that changed, and the day's changes to live programs, each with a revert link when one can be
 * made. Nothing happened, nothing sent. The idempotency key is the UTC day.
 */
import { sql } from './db';
import { ownerMail, type Mailer } from './mail';
import { ProgramFile } from './program-file';
import { findProgramsDir, revertPlan } from './programs-api';
import { revertExpiry, revertUrl } from './programs-pending';

export type DigestChange = { id: string; title: string; fields: string[]; revertUrl: string | null; revertNote?: string };
export type DigestHealth = {
  closed: { id: string; title: string }[];
  failing: { id: string; title: string; url: string }[];
  changed: { id: string; title: string; url: string }[];
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

/** The email body, or null when the four lists are all empty. Pure. */
export function dailyOwnerText(day: string, changes: DigestChange[], health: DigestHealth): string | null {
  const blocks: string[] = [];
  if (health.closed.length > 0) {
    blocks.push(['Closed because the deadline passed', ...health.closed.map((p) => `- ${oneLine(p.title)} (${p.id})`)].join('\n'));
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

/** Gathers the UTC day's events, mails the digest if there is one. */
export async function sendOwnerDigest(now: Date, mailer?: Mailer): Promise<'sent' | 'none'> {
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
  const changeRows = await db<(TitleRow & { fields: string[] })[]>`
    SELECT p.id, p.file, c.fields FROM program_changes c JOIN programs p ON p.id = c.program_id
    WHERE c.at > ${since} AND c.at <= ${now} AND p.status IN ('active', 'upcoming') ORDER BY c.id`;

  const health: DigestHealth = { closed: closedRows.map((r) => ({ id: r.id, title: titleOf(r) })), failing: [], changed: [] };
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
    if (!links.has(r.id)) links.set(r.id, await revertLinkFor(r.id, now, failures));
    const l = links.get(r.id)!;
    changes.push({ id: r.id, title: titleOf(r), fields: r.fields, revertUrl: l.url, ...(l.note && { revertNote: l.note }) });
  }
  if (failures.size > 0) console.error(`[owner-digest] revert links failed: ${[...failures].join(', ')}`);

  const text = dailyOwnerText(day, changes, health);
  if (text === null) return 'none';
  if (!(await ownerMail(`EarnKit programs: ${day}`, text, `owner-digest:${day}`, mailer))) return 'none';
  await db`INSERT INTO owner_digests (day, sent_at) VALUES (${day}, ${now}) ON CONFLICT (day) DO UPDATE SET sent_at = EXCLUDED.sent_at`;
  return 'sent';
}
