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

export type DigestChange = { id: string; title: string; fields: string[]; revertUrl: string | null };
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
      return `- ${oneLine(c.title)}: ${words}${c.revertUrl ? `\n  Revert: ${c.revertUrl}` : ''}`;
    });
    blocks.push(['Changes to live programs', ...lines].join('\n'));
  }
  return blocks.length === 0 ? null : [`EarnKit programs: ${day}`, ...blocks].join('\n\n') + '\n';
}

type TitleRow = { id: string; file: unknown };
const titleOf = (r: TitleRow) => ProgramFile.safeParse(r.file).data?.title ?? r.id;

/** A revert link for the program's latest applied write, when that write can still be reverted. */
async function revertLinkFor(id: string, now: Date): Promise<string | null> {
  const db = sql();
  try {
    const [w] = await db<{ id: string }[]>`
      SELECT id FROM program_writes WHERE program_id = ${id}
        AND ((action = 'upsert' AND result IN ('created', 'updated')) OR (action = 'close' AND result = 'closed'))
      ORDER BY id DESC LIMIT 1`;
    if (!w) return null;
    const plan = await revertPlan(db, w.id, findProgramsDir(), false);
    return plan.kind === 'ok' ? revertUrl(w.id, revertExpiry(now)) : null;
  } catch {
    return null;
  }
}

/** Gathers the UTC day's events, mails the digest if there is one. */
export async function sendOwnerDigest(now: Date, mailer?: Mailer): Promise<'sent' | 'none'> {
  const day = now.toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00Z`);
  const to = new Date(from.getTime() + 86_400_000);
  const db = sql();

  const closedRows = await db<TitleRow[]>`
    SELECT DISTINCT p.id, p.file FROM program_changes c JOIN programs p ON p.id = c.program_id
    WHERE c.at >= ${from} AND c.at < ${to} AND c.fields = ARRAY['status']::text[]
      AND p.status = 'closed' AND p.ends_at IS NOT NULL AND p.ends_at <= c.at ORDER BY p.id`;
  const healthRows = await db<(TitleRow & { source_ok: boolean; submit_ok: boolean; changed_day: boolean })[]>`
    SELECT p.id, p.file, h.source_ok, h.submit_ok, (h.changed_at >= ${from} AND h.changed_at < ${to}) AS changed_day
    FROM program_health h JOIN programs p ON p.id = h.program_id
    WHERE p.status IN ('active', 'upcoming') AND h.checked_at >= ${from} AND h.checked_at < ${to}
      AND (NOT h.source_ok OR NOT h.submit_ok OR h.changed_at >= ${from})
    ORDER BY p.id`;
  const changeRows = await db<(TitleRow & { fields: string[] })[]>`
    SELECT p.id, p.file, c.fields FROM program_changes c JOIN programs p ON p.id = c.program_id
    WHERE c.at >= ${from} AND c.at < ${to} AND p.status IN ('active', 'upcoming') ORDER BY c.id`;

  const health: DigestHealth = { closed: closedRows.map((r) => ({ id: r.id, title: titleOf(r) })), failing: [], changed: [] };
  for (const r of healthRows) {
    const f = ProgramFile.safeParse(r.file).data;
    if (!f) continue;
    if (!r.source_ok) health.failing.push({ id: r.id, title: f.title, url: f.source_url });
    if (!r.submit_ok) health.failing.push({ id: r.id, title: f.title, url: f.submission_url });
    if (r.changed_day) health.changed.push({ id: r.id, title: f.title, url: f.source_url });
  }
  const links = new Map<string, string | null>();
  const changes: DigestChange[] = [];
  for (const r of changeRows) {
    if (!links.has(r.id)) links.set(r.id, await revertLinkFor(r.id, now));
    changes.push({ id: r.id, title: titleOf(r), fields: r.fields, revertUrl: links.get(r.id) ?? null });
  }

  const text = dailyOwnerText(day, changes, health);
  if (text === null) return 'none';
  await ownerMail(`EarnKit programs: ${day}`, text, `owner-digest:${day}`, mailer);
  return 'sent';
}
