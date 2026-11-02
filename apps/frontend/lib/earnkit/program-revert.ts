import { createHmac, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { sql } from './db';
import type { Mailer } from './digest';
import { siteUrl } from './entry-text';
import { ownerMail, ownerMailEnabled } from './owner-mail';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { programsChanged } from './programs-cache';
import { curatedIds, findProgramsDir } from './programs-api';

/**
 * v4.10.2 Task 4 (R7, owner answer 3 "Live, with 1-click revert"): the API's applied writes to live programs go live,
 * and the owner gets one digest email a UTC day at most (from the existing cron, cron.ts) listing each change since
 * the last digest (the first digest: the last 24 hours) that touched a create, the reward, an amount, the deadline,
 * a link or the status, or closed it (fix round 1: the close action too), with a revert link each. Nothing is sent when nothing changed. Pending writes are not listed
 * (they have their own approve email, program-pending.ts).
 *
 * The revert link is signed like the approve link, with its own prefix so neither token is ever the other:
 * `<write id>.<expires>.<base64url HMAC-SHA256(EARNKIT_AUTH_SECRET, "program-revert:v1:<write id>:<expires>")>`, valid
 * for REVERT_TTL_DAYS from the digest. GET shows a confirm page (program-revert-page.ts); only its POST reverts.
 *
 * A revert re-applies the program's state before the write (the previous applied body in program_writes, closed when
 * a close came in between; a reverted close re-opens), or closes the program when the write created it. Only the
 * program's latest listable write can be reverted: a later listable change, close, revert or file takeover makes it
 * superseded; later edits the digest doesn't list (fix round 1: a title or copy fix) are undone with it. The revert is a program_writes
 * row (action 'revert', result 'reverted' or 'closed', reason "reverted write <id>", the applied body), written under
 * the write's and the program's row locks, so a replay finds it and does nothing.
 */

export const REVERT_TTL_DAYS = 7;
const TTL_SECONDS = REVERT_TTL_DAYS * 86_400;
const DAY_MS = 86_400_000;
export const REVERT_DIGEST_SUBJECT = "EarnKit: today's program changes";
/** The owner_alerts row: state `<UTC day>|<last write id listed>`. */
const DIGEST_KIND = 'program-revert-digest';
/** At most this many writes a digest; the rest go in the next one. */
export const DIGEST_MAX = 50;

const macOf = (writeId: string, expires: number, secret: string) =>
  createHmac('sha256', secret).update(`program-revert:v1:${writeId}:${expires}`).digest('base64url');

/** When a revert link made at `at` stops working (unix seconds). Pure. */
export const revertExpiry = (at: Date) => Math.floor(at.getTime() / 1000) + TTL_SECONDS;

/** The revert token for an applied write. Throws without the secret. Pure. */
export function revertToken(writeId: string | number, expires: number, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): string {
  if (!secret) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return `${writeId}.${expires}.${macOf(String(writeId), expires, secret)}`;
}

/** The revert link (always EarnKit's own origin). Throws without the secret. */
export const revertUrl = (writeId: string | number, expires: number) =>
  `${siteUrl()}/api/programs/revert?t=${encodeURIComponent(revertToken(writeId, expires))}`;

const TOKEN = /^([1-9][0-9]{0,15})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;
export type RevertTarget = { writeId: string; expires: number };

/** The write a revert token names, or null (malformed, changed, an approve token, no secret). Timing-safe. Pure. */
export function revertTarget(token: unknown, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): RevertTarget | null {
  if (!secret || typeof token !== 'string' || token.length > 120) return null;
  const m = token.match(TOKEN);
  if (!m) return null;
  const expires = Number(m[2]);
  if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(Number(m[1]))) return null;
  const want = Buffer.from(macOf(m[1]!, expires, secret));
  const got = Buffer.from(m[3]!);
  return want.length === got.length && timingSafeEqual(want, got) ? { writeId: m[1]!, expires } : null;
}

export const revertExpired = (t: RevertTarget, now: Date) => now.getTime() / 1000 > t.expires;

// ---- the change line ----

type Body = Pick<ProgramFile, 'id' | 'title' | 'status' | 'ends_at' | 'starts_at' | 'reward' | 'submission_url' | 'source_url'> &
  Partial<Pick<ProgramFile, 'max_award_usd' | 'min_award_usd' | 'pool_usd'>>;

const day = (iso: string | null | undefined, rolling: string) => {
  if (!iso) return rolling;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const usd = (n: number | undefined) => (n === undefined ? 'none' : `$${n.toLocaleString('en-US')}`);

/** The fields a digest reports, in order: label and how a value reads. */
const FIELDS: { key: keyof Body; label: string; show: (b: Body) => string }[] = [
  { key: 'reward', label: 'reward', show: (b) => `"${b.reward}"` },
  { key: 'max_award_usd', label: 'max award', show: (b) => usd(b.max_award_usd) },
  { key: 'min_award_usd', label: 'min award', show: (b) => usd(b.min_award_usd) },
  { key: 'pool_usd', label: 'pool', show: (b) => usd(b.pool_usd) },
  { key: 'ends_at', label: 'deadline', show: (b) => day(b.ends_at, 'rolling') },
  { key: 'starts_at', label: 'start', show: (b) => day(b.starts_at, 'none') },
  { key: 'submission_url', label: 'submission link', show: (b) => b.submission_url },
  { key: 'source_url', label: 'source page', show: (b) => b.source_url },
  { key: 'status', label: 'status', show: (b) => b.status },
];

/** Whether a program is live as of `at` (listed to builders). Pure. */
const liveAt = (b: Pick<Body, 'status' | 'ends_at'>, at: Date) =>
  b.status === 'upcoming' || (b.status === 'active' && (b.ends_at === null || Date.parse(b.ends_at) > at.getTime()));

/**
 * Fix round 1 (review minor 4): bot text in the owner's plain-text mail is one line: control characters, line and
 * paragraph separators and runs of whitespace become one space, so a scraped value can't fake a link line. Pure.
 */
export const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, ' ').trim();

/**
 * One plain line for a write: "New program: <title> (<id>), deadline Nov 30" for a create, "Closed: <title> (<id>)"
 * for a write that closes it, "<title>: deadline Nov 30 to Dec 15; reward ..." for an update, or null when none of
 * the reported fields changed. Always one line (oneLine). Pure.
 */
export function changeLine(before: Body | null, after: Body): string | null {
  const title = oneLine(after.title);
  if (before === null) return oneLine(`New program: ${title} (${after.id}), deadline ${day(after.ends_at, 'rolling')}`);
  if (after.status === 'closed' && before.status !== 'closed') return oneLine(`Closed: ${title} (${after.id})`);
  const parts = FIELDS.filter((f) => (before[f.key] ?? null) !== (after[f.key] ?? null)).map(
    (f) => `${f.label} ${f.show(before)} to ${f.show(after)}`,
  );
  return parts.length === 0 ? null : oneLine(`${title}: ${parts.join('; ')}`);
}

// ---- history ----

type Db = postgres.Sql | postgres.TransactionSql;
type WriteRow = { id: string; at: Date; program_id: string; action: string; result: string; body: unknown };

/** The writes a digest can list and a revert link can undo: the API's applied upserts and closes. */
const changeSql = (db: Db) =>
  db`((action = 'upsert' AND result IN ('created', 'updated')) OR (action = 'close' AND result = 'closed'))`;

/**
 * The program's state just before write `writeId`: the last applied body before it (an upsert or a revert), closed
 * when a close came after that body; null when there is none (the write created it).
 */
async function stateBefore(db: Db, programId: string, writeId: string): Promise<ProgramFile | null> {
  const [prev] = await db<{ id: string; body: unknown }[]>`
    SELECT id, body FROM program_writes
    WHERE program_id = ${programId} AND id < ${writeId} AND body IS NOT NULL
      AND ((action = 'upsert' AND result IN ('created', 'updated')) OR action = 'revert')
    ORDER BY id DESC LIMIT 1`;
  if (!prev) return null;
  const parsed = ProgramFile.safeParse(prev.body);
  if (!parsed.success) return null;
  const [closed] = await db`
    SELECT 1 FROM program_writes
    WHERE program_id = ${programId} AND id > ${prev.id} AND id < ${writeId} AND action = 'close' AND result = 'closed' LIMIT 1`;
  return closed ? { ...parsed.data, status: 'closed' } : parsed.data;
}

/** What a listable write did: its line, the state before it (null: it created the program) and its kind. */
type Listed = { line: string; before: ProgramFile | null; kind: 'created' | 'closed' | 'updated'; title: string };

/**
 * Whether write `w` is one the digest lists, and what it did: a create, a close (the close action, or an upsert to
 * closed) or an update to a reported field, of a program live before or after it. null otherwise.
 */
async function listed(db: Db, w: WriteRow): Promise<Listed | null> {
  const at = new Date(w.at);
  if (w.action === 'close') {
    const before = await stateBefore(db, w.program_id, w.id);
    if (!before || !liveAt(before, at)) return null;
    return { line: changeLine(before, { ...before, status: 'closed' })!, before, kind: 'closed', title: before.title };
  }
  const parsed = ProgramFile.safeParse(w.body);
  if (!parsed.success) return null;
  const after = parsed.data;
  const created = w.result === 'created';
  const before = created ? null : await stateBefore(db, w.program_id, w.id);
  if (!created && before === null) return null;
  if (!liveAt(after, at) && !(before && liveAt(before, at))) return null;
  const line = changeLine(before, after);
  if (line === null) return null;
  return { line, before, kind: created ? 'created' : after.status === 'closed' && before?.status !== 'closed' ? 'closed' : 'updated', title: after.title };
}

/**
 * Fix round 1 (review I2): what makes `writeId` no longer revertable: a later revert or file takeover ('other'), or a
 * later listable change ('listed', which has its own link). A later edit the digest doesn't list (a title or copy
 * fix) does not: reverting `writeId` undoes it too. null: still revertable.
 */
async function supersededBy(db: Db, programId: string, writeId: string): Promise<'listed' | 'other' | null> {
  const later = await db<WriteRow[]>`
    SELECT id, at, program_id, action, result, body FROM program_writes
    WHERE program_id = ${programId} AND id > ${writeId}
      AND (${changeSql(db)} OR action IN ('revert', 'takeover'))
    ORDER BY id`;
  for (const w of later) {
    if (w.action === 'revert' || w.action === 'takeover') return 'other';
    if (w.action === 'close' || (await listed(db, w))) return 'listed';
  }
  return null;
}

/** The later unlisted edits a revert of `writeId` also undoes (only called when it isn't superseded). */
const laterEdits = async (db: Db, programId: string, writeId: string) =>
  (await db`SELECT 1 FROM program_writes WHERE program_id = ${programId} AND id > ${writeId} AND action = 'upsert' AND result IN ('created', 'updated')`)
    .length;

const revertedBy = async (db: Db, programId: string, writeId: string) =>
  (await db`SELECT 1 FROM program_writes WHERE program_id = ${programId} AND action = 'revert' AND reason = ${`reverted write ${writeId}`} LIMIT 1`)
    .length > 0;

// ---- the digest ----

export type DigestOutcome = { step: 'off' | 'quiet' | 'sent_today' } | { step: 'sent'; changes: number };

type Change = { writeId: string; line: string; kind: Listed['kind']; superseded: 'listed' | 'other' | null };

/** Fix round 1 (review I1): rows read a page at a time, at most this many a run. */
const PAGE_ROWS = 100;
export const DIGEST_SCAN_MAX = 1000;

const LINK_LABEL: Record<Listed['kind'], string> = { created: 'Revert (closes it)', closed: 'Revert (re-opens it)', updated: 'Revert' };

/** The digest's text. Every line is plain text, one line each (oneLine). Pure. */
export function digestText(changes: Change[], links: Map<string, string> | null, more: boolean): string {
  const out = [
    `The Grok Bot made ${changes.length === 1 ? 'one change' : `${changes.length} changes`} to live programs since the last digest. Each change is live now.`,
    links
      ? `Revert any one from its link (a confirm page; each link works for ${REVERT_TTL_DAYS} days). A revert also undoes the bot's later edits to that program that aren't listed here.`
      : 'EARNKIT_AUTH_SECRET is not set, so there are no revert links.',
  ];
  for (const c of changes) {
    out.push('', c.line);
    if (c.superseded === 'listed') out.push('A later change replaced it; revert the later one.');
    else if (c.superseded === 'other') out.push('A later change replaced it.');
    else if (links) out.push(`${LINK_LABEL[c.kind]}: ${links.get(c.writeId)}`);
  }
  if (more) out.push('', 'More changes came in; the next digest lists them.');
  return out.join('\n');
}

/**
 * The cron's digest step: at most once a UTC day (owner_alerts 'program-revert-digest', claimed atomically before the
 * send), only when an applied API write since the last digest changed a live program. Off without RESEND_API_KEY
 * (nothing is claimed). Fix round 1: it reads pages of writes until DIGEST_MAX changes or DIGEST_SCAN_MAX rows, and
 * the cursor always moves past the rows read (a quiet scan moves it without using up the day). A failed send gives
 * the day and the cursor back (the next run tries again) and throws.
 */
export async function revertDigest(now: Date, mailer?: Mailer): Promise<DigestOutcome> {
  if (!ownerMailEnabled()) return { step: 'off' };
  const today = now.toISOString().slice(0, 10);
  const [prev] = await sql()<{ state: string | null }[]>`SELECT state FROM owner_alerts WHERE kind = ${DIGEST_KIND}`;
  const [prevDay = '', prevId] = (prev?.state ?? '').split('|');
  if (prevDay === today) return { step: 'sent_today' };
  const lastId = prevId && /^\d+$/.test(prevId) ? prevId : null;
  const since = new Date(now.getTime() - (lastId ? REVERT_TTL_DAYS : 1) * DAY_MS);
  const changes: Change[] = [];
  let cursor = lastId;
  let read = 0;
  let more = false;
  while (changes.length < DIGEST_MAX) {
    if (read >= DIGEST_SCAN_MAX) {
      more = true;
      break;
    }
    const rows = await sql()<WriteRow[]>`
      SELECT id, at, program_id, action, result, body FROM program_writes
      WHERE ${changeSql(sql())} AND program_id IS NOT NULL AND at > ${since} ${cursor ? sql()`AND id > ${cursor}` : sql()``}
      ORDER BY id LIMIT ${Math.min(PAGE_ROWS, DIGEST_SCAN_MAX - read)}`;
    if (rows.length === 0) break;
    for (const w of rows) {
      read++;
      cursor = w.id;
      const l = await listed(sql(), w);
      if (l) changes.push({ writeId: w.id, line: l.line, kind: l.kind, superseded: await supersededBy(sql(), w.program_id, w.id) });
      if (changes.length >= DIGEST_MAX) {
        more = true;
        break;
      }
    }
  }
  if (changes.length === 0) {
    // Move the cursor past the rows read; the day stays open (only a sent digest uses it up).
    if (cursor && cursor !== lastId)
      await sql()`
        INSERT INTO owner_alerts (kind, state, at) VALUES (${DIGEST_KIND}, ${`${prevDay}|${cursor}`}, ${now})
        ON CONFLICT (kind) DO UPDATE SET state = EXCLUDED.state
          WHERE owner_alerts.state IS NOT DISTINCT FROM ${prev?.state ?? null}`;
    return { step: 'quiet' };
  }
  const state = `${today}|${cursor}`;
  const [claimed] = await sql()<{ kind: string }[]>`
    INSERT INTO owner_alerts (kind, state, at) VALUES (${DIGEST_KIND}, ${state}, ${now})
    ON CONFLICT (kind) DO UPDATE SET state = EXCLUDED.state, at = EXCLUDED.at
      WHERE split_part(COALESCE(owner_alerts.state, ''), '|', 1) <> ${today}
    RETURNING kind`;
  if (!claimed) return { step: 'sent_today' };
  const exp = revertExpiry(now);
  const links = process.env.EARNKIT_AUTH_SECRET ? new Map(changes.map((c) => [c.writeId, revertUrl(c.writeId, exp)])) : null;
  try {
    await ownerMail(REVERT_DIGEST_SUBJECT, digestText(changes, links, more), `${DIGEST_KIND}:${today}`, mailer);
  } catch (err) {
    await sql()`UPDATE owner_alerts SET state = ${prev?.state ?? null} WHERE kind = ${DIGEST_KIND} AND state = ${state}`;
    throw err;
  }
  return { step: 'sent', changes: changes.length };
}

// ---- the revert ----

/** Why a write can't be reverted (the page says it in one line). */
export type NotRevertable = 'missing' | 'done' | 'superseded' | 'curated' | 'no_earlier';
export type RevertPlan =
  | { kind: 'ok'; id: string; title: string; line: string | null; does: 'close' | 'reopen' | 'restore'; laterEdits: number }
  | { kind: 'no'; state: NotRevertable };

/** What reverting `writeId` would do, read under the caller's locks (or none, for the confirm page). */
async function plan(db: Db, writeId: string, programsDir: string | null, lock: boolean): Promise<RevertPlan & { restore?: ProgramFile }> {
  const [w] = lock
    ? await db<WriteRow[]>`SELECT id, at, program_id, action, result, body FROM program_writes WHERE id = ${writeId} FOR UPDATE`
    : await db<WriteRow[]>`SELECT id, at, program_id, action, result, body FROM program_writes WHERE id = ${writeId}`;
  const isChange = w && w.program_id && ((w.action === 'upsert' && ['created', 'updated'].includes(w.result)) || (w.action === 'close' && w.result === 'closed'));
  if (!w || !isChange) return { kind: 'no', state: 'missing' };
  if (w.action === 'upsert' && !ProgramFile.safeParse(w.body).success) return { kind: 'no', state: 'missing' };
  const id = w.program_id;
  const [row] = lock
    ? await db<{ source: string }[]>`SELECT source FROM programs WHERE id = ${id} FOR UPDATE`
    : await db<{ source: string }[]>`SELECT source FROM programs WHERE id = ${id}`;
  if (!row) return { kind: 'no', state: 'missing' };
  if (row.source !== 'api' || curatedIds(programsDir).has(id)) return { kind: 'no', state: 'curated' };
  if (await revertedBy(db, id, writeId)) return { kind: 'no', state: 'done' };
  if (await supersededBy(db, id, writeId)) return { kind: 'no', state: 'superseded' };
  const later = await laterEdits(db, id, writeId);
  if (w.action === 'upsert' && w.result === 'created') {
    const body = ProgramFile.parse(w.body);
    return { kind: 'ok', id, title: body.title, line: changeLine(null, body), does: 'close', laterEdits: later, restore: body };
  }
  const before = await stateBefore(db, id, writeId);
  if (before === null) return { kind: 'no', state: 'no_earlier' };
  const l = await listed(db, w);
  const reopens = before.status !== 'closed' && (w.action === 'close' || l?.kind === 'closed');
  return { kind: 'ok', id, title: before.title, line: l?.line ?? null, does: reopens ? 'reopen' : 'restore', laterEdits: later, restore: before };
}

/** The confirm page's read: what a revert would do, changing nothing. */
export const revertPreview = async (writeId: string, programsDir: string | null = findProgramsDir()): Promise<RevertPlan> => {
  const { restore: _restore, ...p } = await plan(sql(), writeId, programsDir, false);
  return p as RevertPlan;
};

export type RevertDeps = { now?: Date; programsDir?: string | null; onChange?: (id: string) => void };
export type RevertOutcome = { kind: 'reverted'; id: string; title: string; closed: boolean } | { kind: 'no'; state: NotRevertable };

/**
 * The owner reverts applied write `writeId` (the revert link's POST, after its token checked out). Single use. It
 * restores the state before the write (re-opening a closed program), or closes a program the write created; the
 * bot's later unlisted edits to the program go with it.
 */
export async function revertWrite(writeId: string, deps: RevertDeps = {}): Promise<RevertOutcome> {
  const programsDir = deps.programsDir === undefined ? findProgramsDir() : deps.programsDir;
  const out = await sql().begin(async (tx): Promise<RevertOutcome> => {
    const p = await plan(tx, writeId, programsDir, true);
    if (p.kind === 'no') return p;
    let applied: ProgramFile;
    if (p.does === 'close') {
      // The program as the bot last left it, closed (its later unlisted edits included, so a re-open by the bot is plain).
      const [cur] = await tx<{ body: unknown }[]>`
        SELECT body FROM program_writes WHERE program_id = ${p.id} AND body IS NOT NULL
          AND ((action = 'upsert' AND result IN ('created', 'updated')) OR action = 'revert')
        ORDER BY id DESC LIMIT 1`;
      const last = ProgramFile.safeParse(cur?.body);
      applied = { ...(last.success ? last.data : p.restore!), status: 'closed' };
      await tx`UPDATE programs SET status = 'closed' WHERE id = ${p.id}`;
    } else {
      applied = p.restore!;
      await upsertProgram(applied, 'api', tx);
    }
    await tx`INSERT INTO program_writes (program_id, action, result, reason, body)
      VALUES (${p.id}, 'revert', ${p.does === 'close' ? 'closed' : 'reverted'}, ${`reverted write ${writeId}`}, ${tx.json(applied as unknown as postgres.JSONValue)})`;
    return { kind: 'reverted', id: p.id, title: p.title, closed: p.does === 'close' };
  });
  if (out.kind === 'reverted') {
    console.log(`[program-revert] ${out.id} ${out.closed ? 'closed' : 'reverted'}`);
    (deps.onChange ?? programsChanged)(out.id);
  }
  return out;
}
