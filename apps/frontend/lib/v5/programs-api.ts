/**
 * The owner's programs write API (the Grok Bot): POST /api/programs/write upserts or closes an API
 * program, GET /api/programs/writes is its audit log, the approve and revert links apply or undo one
 * write. A create, a change to submission_url, chains, form or pool_source_url (unless every link
 * checks out, programs-pending.ts), or a change to submit, sign_in or min_tier waits for the owner. Audited.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { revalidatePath } from 'next/cache';
import type postgres from 'postgres';
import { z } from 'zod';
import { apiTextProblems, apiUrlProblems, notWritableFields } from './api-text';
import { sql, type Db } from './db';
import { bearerMatches, json, readBody } from './http';
import { ownerMailEnabled, type Mailer } from './mail';
import { programProblems } from './program-checks';
import { ProgramFile, categoryOf, type Program } from './program-file';
import { getProgram, isOpen, upsertProgram } from './programs';
import {
  APPROVE_TTL_DAYS,
  approveExpiry,
  approveTarget,
  confirmPage,
  escapeHtml,
  linkAnchors,
  linkExpired,
  linkLines,
  mailPending,
  officialUrlProblem,
  ownerLine,
  ownerPage,
  pendingReason,
  revertTarget,
  uncheckedLink,
  type LinkTarget,
} from './programs-pending';
import { revalidateCatalog } from './programs-read';
import { RateLimitError, enforce } from './rate-limit';
import { FETCH_TIMEOUT_MS, HttpStatusError, safeProbe, type Probe } from './safe-fetch';

/** The largest body the API reads. */
export const PROGRAMS_BODY_MAX = 256 * 1024;
export const API_ID = /^[a-z0-9-]{3,64}$/;
/** verified_at may be at most this many days old. */
export const VERIFIED_MAX_AGE_DAYS = 7;
export const CLOSE_REASON_MAX = 200;
/** The largest amounts a write may state; a typo can't inflate the site's money line. */
export const API_AWARD_MAX_USD = 5_000_000;
export const API_POOL_MAX_USD = 50_000_000;
export const WRITES_MAX = 100;
export const curatedLine = (id: string): string => `${id} is curated by EarnKit; send a new id or ask the owner`;
/** The mark a pending write's reason carries while its owner email hasn't gone. */
export const MAIL_FAILED = '; owner email not sent yet';

const DAY_MS = 86_400_000;
/** UTC+14 is the earliest zone: a bot's "today" there is never refused as the future. */
const EARLIEST_ZONE_MS = 14 * 3_600_000;
const OFF_VALUES = new Set(['off', '0', 'false']);
const BUSY = 'EarnKit is busy. Try again in a minute.';
/** A bot wall or a sign-in still means the page exists. */
const BOT_WALL_STATUSES = [401, 403, 429];

/** The token is set (at least 32 characters) and EARNKIT_PROGRAMS_API isn't off. */
export function programsApiOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.EARNKIT_PROGRAMS_TOKEN;
  return Boolean(token && token.length >= 32) && !OFF_VALUES.has((env.EARNKIT_PROGRAMS_API ?? '').trim().toLowerCase());
}

/** What a failure log may say: the error's name and postgres code, never its message. */
const errTag = (err: unknown) => {
  const e = err as { name?: unknown; code?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name.replace(/[^\w]/g, '').slice(0, 40) : 'unknown';
  const code = typeof e?.code === 'string' ? e.code.replace(/[^\w]/g, '').slice(0, 10) : null;
  return code ? `${name} ${code}` : name;
};

const notFound = () => new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** The owner routes' gate: 404 while the API is off, 401 for a wrong token, else null. */
export function authFailure(request: Request): Response | null {
  if (!programsApiOn()) return notFound();
  if (!bearerMatches(request.headers.get('authorization'), process.env.EARNKIT_PROGRAMS_TOKEN)) return json({ ok: false, error: 'unauthorized' }, 401);
  return null;
}

/** A program write changed `id` (the API's, the cron's status flip): every catalog surface expires now (`revalidateCatalog`). Outside a Next request it does nothing. */
export function programsChanged(id: string): void {
  // L22-13 (v6.1.16): one expiry for every catalog surface.
  revalidateCatalog();
  try {
    revalidatePath(`/programs/${id}`);
  } catch {
    // No Next request context.
  }
}

/** The rules only API programs follow (a file is owner-reviewed): the id, freshness, amount caps, a live deadline, links, text. Pure. */
export function apiRuleProblems(p: Program, now: Date): string[] {
  const problems: string[] = [];
  if (!API_ID.test(p.id)) problems.push('id: 3 to 64 lowercase letters, digits or dashes');
  const day = Date.parse(`${p.verified_at}T00:00:00Z`);
  const todayUtc = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  if (day > now.getTime() + EARLIEST_ZONE_MS) problems.push('verified_at: is in the future');
  else if (day < todayUtc - VERIFIED_MAX_AGE_DAYS * DAY_MS)
    problems.push(`verified_at: more than ${VERIFIED_MAX_AGE_DAYS} days ago; check the source again`);
  for (const [key, max] of [['max_award_usd', API_AWARD_MAX_USD], ['min_award_usd', API_AWARD_MAX_USD], ['pool_usd', API_POOL_MAX_USD]] as const)
    if (p[key] !== undefined && p[key]! > max)
      problems.push(`${key}: at most ${max.toLocaleString('en-US')} through the API; larger amounts need a curated file`);
  if (p.status === 'active' && p.ends_at !== null && Date.parse(p.ends_at) <= now.getTime())
    problems.push('ends_at: has passed; an active program needs a future ends_at or null');
  problems.push(...apiUrlProblems(p));
  const official = officialUrlProblem(p.official_url);
  if (official && !problems.some((x) => x.startsWith('official_url:'))) problems.push(official);
  problems.push(...apiTextProblems(p));
  return problems;
}

/** Where programs/*.json are at run time (`next start` runs in apps/frontend), or null. */
export function findProgramsDir(cwd = process.cwd()): string | null {
  for (const dir of [join(cwd, '..', '..', 'programs'), join(cwd, 'programs')]) if (existsSync(dir)) return dir;
  return null;
}

/** The ids of the curated program files. */
function curatedIds(dir: string | null): Set<string> {
  if (!dir) return new Set();
  try {
    return new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)));
  } catch {
    return new Set();
  }
}

/** A link that must load (safeProbe, 5 s); a 401, 403 or 429 passes (the page is there behind a wall). */
async function probeLink(url: string, probe: Probe): Promise<void> {
  try {
    await probe(url);
  } catch (err) {
    if (err instanceof HttpStatusError && BOT_WALL_STATUSES.includes(err.status)) return;
    throw err;
  }
}

export type WriteDeps = {
  mailer?: Mailer;
  /** Resolves when the URL loads; throws when it doesn't. Default safeProbe. */
  probe?: Probe;
  now?: Date;
  /** The programs/ directory; default findProgramsDir(). */
  programsDir?: string | null;
  /** Counts one call; throws a RateLimitError when over the limit. Default LIMITS.programsWrite. */
  limit?: () => Promise<unknown>;
  /** After a write changed a program. Default programsChanged. */
  onChange?: (id: string) => void;
};
type Deps = Required<Omit<WriteDeps, 'mailer' | 'limit'>> & Pick<WriteDeps, 'mailer'>;

const fullDeps = (deps: WriteDeps): Deps => ({
  mailer: deps.mailer,
  probe: deps.probe ?? ((u: string) => safeProbe(u, { timeoutMs: FETCH_TIMEOUT_MS })),
  now: deps.now ?? new Date(),
  programsDir: deps.programsDir === undefined ? findProgramsDir() : deps.programsDir,
  onChange: deps.onChange ?? programsChanged,
});

type Result = 'created' | 'updated' | 'unchanged' | 'closed';

const Envelope = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upsert'), program: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('close'), id: z.string(), reason: z.string().trim().min(1).max(CLOSE_REASON_MAX) }).strict(),
]);

const refused = (status: number, problems: string[]) => json({ ok: false, problems }, status);
const safeId = (id: unknown): string | null => (typeof id === 'string' && API_ID.test(id) ? id : null);
/** The record as stored and compared (undefined keys dropped). */
const asJson = (p: Program) => JSON.parse(JSON.stringify(p)) as postgres.JSONValue;

async function audit(db: Db, row: { program_id: string | null; action: string; result: string; reason?: string | null; body?: Program }) {
  await db`INSERT INTO program_writes (program_id, action, result, reason, body)
    VALUES (${row.program_id}, ${row.action}, ${row.result}, ${row.reason ?? null}, ${row.body ? db.json(asJson(row.body)) : null})`;
}

/** A refused write, kept for the owner (the reason, never the body). Never throws. */
async function auditRefusal(action: string, id: unknown, result: string, problems: string[]) {
  const program_id = safeId(id);
  console.log(`[programs-api] ${action} ${program_id ?? '-'} ${result}`);
  await audit(sql(), { program_id, action, result, reason: problems.join('; ').slice(0, 1_000) }).catch((err: unknown) =>
    console.error(`[programs-api] audit write failed: ${errTag(err)}`),
  );
}

type Refusal = { status: 400 | 409; result: 'refused' | 'curated'; problems: string[] };

/**
 * The checks after the parse, or null when the program passes: programs:check's rules, the API
 * rules (verified_at as of `at`, the write's time; ends_at as of now), the curated id, the links load.
 */
async function writeRefusal(p: Program, deps: Deps, at: Date = deps.now): Promise<Refusal | null> {
  const checks = programProblems(p, at);
  if (checks.length > 0) return { status: 400, result: 'refused', problems: checks };
  const rules = apiRuleProblems(p, at);
  if (at !== deps.now && p.status === 'active' && p.ends_at !== null && Date.parse(p.ends_at) <= deps.now.getTime())
    rules.push('ends_at: has passed; an active program needs a future ends_at or null');
  if (rules.length > 0) return { status: 400, result: 'refused', problems: rules };
  const [existing] = await sql()<{ source: string }[]>`SELECT source FROM programs WHERE id = ${p.id}`;
  if (curatedIds(deps.programsDir).has(p.id) || (existing && existing.source !== 'api'))
    return { status: 409, result: 'curated', problems: [curatedLine(p.id)] };
  const linkProblems: string[] = [];
  const urls = p.source_url === p.submission_url ? (['source_url'] as const) : (['source_url', 'submission_url'] as const);
  for (const key of urls) {
    try {
      await probeLink(p[key], deps.probe);
    } catch (err) {
      linkProblems.push(`${key}: doesn't load (${(err instanceof Error ? err.message : 'unknown error').slice(0, 160)})`);
    }
  }
  return linkProblems.length > 0 ? { status: 400, result: 'refused', problems: linkProblems } : null;
}

const sameSet = (a: readonly string[], b: readonly string[]) => isDeepStrictEqual([...new Set(a)].sort(), [...new Set(b)].sort());

class Curated extends Error {}

type Applied =
  | { kind: 'applied'; result: Exclude<Result, 'closed'> }
  | { kind: 'pending'; write: { id: string; at: Date }; fresh: boolean; reason: string }
  | { kind: 'not_pending'; state: string };
/** A bot's write (the link check applies), or the owner's approval of pending write `writeId`. */
type Mode = { kind: 'write' } | { kind: 'approve'; writeId: string };

/** Results that make an older pending write stale (approving it would undo them). */
const NEWER_RESULTS = ['created', 'updated', 'approved', 'closed', 'pending', 'reverted'];

/** Fields whose change is held for the owner like a form change: they decide who may submit and who qualifies. */
const GATE_FIELDS = ['submit', 'sign_in', 'min_tier'] as const;

/** The first gate field whose value differs between the live record and the write, or null. Pure. */
function changedGate(old: Partial<Program>, p: Program): string | null {
  const was = { submit: old.submit ?? 'either', sign_in: old.sign_in ?? 'none', min_tier: old.min_tier ?? null };
  const now = { submit: p.submit, sign_in: p.sign_in, min_tier: p.min_tier ?? null };
  return GATE_FIELDS.find((f) => was[f] !== now[f]) ?? null;
}

/**
 * The write transaction. The program row is locked and its source read again (a sync can't be
 * overwritten). A bot write that creates the program or changes submission_url, chains, form or
 * pool_source_url, and any of whose builder links (submission_url, form.url, pool_source_url)
 * doesn't check out, or that changes submit, sign_in or min_tier, is held as a pending program_writes row instead (an identical
 * pending body within APPROVE_TTL_DAYS is reused, so one email). An approval locks its pending row
 * and flips it to 'approved' in the same transaction (single use).
 */
async function applyUpsert(p: Program, deps: Deps, mode: Mode): Promise<Applied> {
  return sql().begin(async (tx): Promise<Applied> => {
    if (mode.kind === 'approve') {
      const [w] = await tx<{ result: string }[]>`SELECT result FROM program_writes WHERE id = ${mode.writeId} FOR UPDATE`;
      if (w?.result !== 'pending') return { kind: 'not_pending', state: w?.result ?? 'missing' };
      const [newer] = await tx<{ id: string }[]>`
        SELECT id FROM program_writes WHERE program_id = ${p.id} AND id > ${mode.writeId} AND result IN ${tx(NEWER_RESULTS)} LIMIT 1`;
      if (newer) {
        await tx`UPDATE program_writes SET result = 'superseded' WHERE id = ${mode.writeId}`;
        return { kind: 'not_pending', state: 'superseded' };
      }
    }
    const [row] = await tx<{ source: string; file: Partial<Program> | null }[]>`
      SELECT source, file FROM programs WHERE id = ${p.id} FOR UPDATE`;
    if (row && row.source !== 'api') throw new Curated();
    const old = row?.file ?? null;
    const needsCheck =
      !old ||
      old.submission_url !== p.submission_url ||
      !sameSet(old.chains ?? [], p.chains) ||
      !isDeepStrictEqual(old.form ?? null, (asJson(p) as { form?: unknown }).form ?? null) ||
      (old.pool_source_url ?? null) !== (p.pool_source_url ?? null);
    const unchecked = mode.kind === 'write' && needsCheck ? uncheckedLink(p, await linkAnchors(tx, p, deps.now)) : null;
    const gate = mode.kind === 'write' && old ? changedGate(old, p) : null;
    if (unchecked || gate) {
      // Two identical writes at once still make one pending row and one email.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`program-pending:${p.id}`}))`;
      const reason = unchecked ? pendingReason(unchecked.url, p.official_url, unchecked.field) : `${gate} changed, which decides who can enter`;
      const [same] = await tx<{ id: string; at: Date; reason: string | null }[]>`
        SELECT id, at, reason FROM program_writes
        WHERE program_id = ${p.id} AND result = 'pending' AND body = ${tx.json(asJson(p))}
          AND at > ${new Date(deps.now.getTime() - APPROVE_TTL_DAYS * DAY_MS)}
        ORDER BY id DESC LIMIT 1`;
      // A pending write whose owner email failed sends it again (same idempotency key).
      if (same) return { kind: 'pending', write: same, fresh: (same.reason ?? '').endsWith(MAIL_FAILED), reason };
      const [w] = await tx<{ id: string; at: Date }[]>`
        INSERT INTO program_writes (program_id, action, result, reason, body)
        VALUES (${p.id}, 'upsert', 'pending', ${reason}, ${tx.json(asJson(p))})
        RETURNING id, at`;
      return { kind: 'pending', write: w!, fresh: true, reason };
    }
    const result = await upsertProgram(p, 'api', deps.now, tx);
    if (mode.kind === 'approve') {
      await tx`UPDATE program_writes SET result = 'approved' WHERE id = ${mode.writeId}`;
      await audit(tx, { program_id: p.id, action: 'upsert', result, reason: `approved write ${mode.writeId}`, body: p });
    } else await audit(tx, { program_id: p.id, action: 'upsert', result, body: result === 'unchanged' ? undefined : p });
    return { kind: 'applied', result };
  });
}

/** Listed to builders now: open, or upcoming. */
const live = (p: Program, now: Date) => p.status === 'upcoming' || isOpen(p, now);

async function upsertAction(raw: Record<string, unknown>, deps: Deps): Promise<Response> {
  const forbidden = notWritableFields(raw);
  const parsed = ProgramFile.safeParse(raw);
  if (forbidden.length > 0 || !parsed.success) {
    const problems = [...forbidden, ...(parsed.success ? [] : programProblems(raw as Program, deps.now))];
    await auditRefusal('upsert', raw.id, 'refused', problems);
    return refused(400, problems);
  }
  const p = parsed.data;
  const refusal = await writeRefusal(p, deps);
  if (refusal) {
    await auditRefusal('upsert', p.id, refusal.result, refusal.problems);
    return refused(refusal.status, refusal.problems);
  }
  let out: Applied;
  try {
    out = await applyUpsert(p, deps, { kind: 'write' });
  } catch (err) {
    if (!(err instanceof Curated)) throw err;
    await auditRefusal('upsert', p.id, 'curated', [curatedLine(p.id)]);
    return refused(409, [curatedLine(p.id)]);
  }
  if (out.kind === 'pending') {
    console.log(`[programs-api] upsert ${p.id} pending`);
    let emailed = !out.fresh;
    if (out.fresh && ownerMailEnabled()) {
      try {
        await mailPending(out.write, p, out.reason, deps.mailer);
        emailed = true;
        await sql()`UPDATE program_writes SET reason = ${out.reason} WHERE id = ${out.write.id} AND result = 'pending'`;
      } catch (err) {
        // The write stays pending and says so; the same write sent again retries the email.
        console.error(`[programs-api] pending mail failed: ${errTag(err)}`);
        await sql()`UPDATE program_writes SET reason = ${out.reason + MAIL_FAILED} WHERE id = ${out.write.id} AND result = 'pending'`;
      }
    }
    return json({ ok: true, id: p.id, result: 'pending', category: categoryOf(p), live: false, reason: out.reason, owner_emailed: emailed }, 202);
  }
  const result = out.kind === 'applied' ? out.result : 'unchanged';
  console.log(`[programs-api] upsert ${p.id} ${result}`);
  if (result !== 'unchanged') deps.onChange(p.id);
  return json({ ok: true, id: p.id, result, category: categoryOf(p), live: live(p, deps.now) });
}

/**
 * Sets a program's status to closed, in the record and the column, with a program_changes row.
 * A raw update, so a record the schema would refuse once closed (an upcoming program with no
 * requirements) still closes.
 */
async function closeRow(db: Db, id: string, now: Date): Promise<void> {
  await db`UPDATE programs SET status = 'closed', file = jsonb_set(file - 'opens_note', '{status}', '"closed"'), updated_at = ${now} WHERE id = ${id}`;
  await db`INSERT INTO program_changes (program_id, at, fields) VALUES (${id}, ${now}, ${['status']})`;
}

async function closeAction(id: string, reason: string, deps: Deps): Promise<Response> {
  if (!API_ID.test(id)) {
    const problems = ['id: 3 to 64 lowercase letters, digits or dashes'];
    await auditRefusal('close', null, 'refused', problems);
    return refused(400, problems);
  }
  if (curatedIds(deps.programsDir).has(id)) {
    await auditRefusal('close', id, 'curated', [curatedLine(id)]);
    return refused(409, [curatedLine(id)]);
  }
  const out = await sql().begin(async (tx) => {
    const [row] = await tx<{ source: string; status: string; category: string | null }[]>`
      SELECT source, status, category FROM programs WHERE id = ${id} FOR UPDATE`;
    if (!row) return { status: 400 as const };
    if (row.source !== 'api') return { status: 409 as const };
    const result: Result = row.status === 'closed' ? 'unchanged' : 'closed';
    if (result === 'closed') await closeRow(tx, id, deps.now);
    await audit(tx, { program_id: id, action: 'close', result, reason });
    return { status: 200 as const, result, category: row.category };
  });
  if (out.status === 400) {
    const problems = [`id: no program ${id}`];
    await auditRefusal('close', id, 'refused', problems);
    return refused(400, problems);
  }
  if (out.status === 409) {
    await auditRefusal('close', id, 'curated', [curatedLine(id)]);
    return refused(409, [curatedLine(id)]);
  }
  console.log(`[programs-api] close ${id} ${out.result}`);
  if (out.result === 'closed') deps.onChange(id);
  return json({ ok: true, id, result: out.result, category: out.category, live: false });
}

/** POST /api/programs/write. */
export async function writePost(request: Request, deps: WriteDeps = {}): Promise<Response> {
  const denied = authFailure(request);
  if (denied) return denied;
  try {
    await (deps.limit ?? (() => enforce('programsWrite', 'owner', 'Too many program writes this hour.')))();
  } catch (err) {
    if (err instanceof RateLimitError) return json({ ok: false, error: err.message }, 429, { 'Retry-After': String(err.retryAfter) });
    console.error(`[programs-api] rate limit check failed: ${errTag(err)}`);
    return json({ ok: false, error: BUSY }, 503, { 'Retry-After': '30' });
  }
  // Only a slow body is a 408 (v6.1.16 Task 5 fix round 1, I2); a body over the cap stays a 413.
  const text = await readBody(request, PROGRAMS_BODY_MAX, () => json({ ok: false, error: 'the body came too slowly' }, 408));
  if (text instanceof Response) return text;
  if (text === null) return json({ ok: false, error: `body over ${PROGRAMS_BODY_MAX / 1024} KB` }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refused(400, ['body: not JSON']);
  }
  const full = fullDeps(deps);
  try {
    const envelope = Envelope.safeParse(body);
    if (!envelope.success) {
      const problems = envelope.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`);
      await auditRefusal((body as { action?: unknown } | null)?.action === 'close' ? 'close' : 'upsert', null, 'refused', problems);
      return refused(400, problems);
    }
    const e = envelope.data;
    return e.action === 'upsert' ? await upsertAction(e.program, full) : await closeAction(e.id, e.reason, full);
  } catch (err) {
    console.error(`[programs-api] write failed: ${errTag(err)}`);
    return json({ ok: false, error: BUSY }, 503, { 'Retry-After': '30' });
  }
}

/**
 * GET /api/programs/writes: the last WRITES_MAX program_writes rows, newest first, never a body;
 * and `pending`, the writes waiting for approval whose link still works, with title and links.
 */
export async function writesGet(request: Request, now = new Date()): Promise<Response> {
  const denied = authFailure(request);
  if (denied) return denied;
  try {
    const writes = await sql()<{ at: Date; program_id: string | null; action: string; result: string; reason: string | null }[]>`
      SELECT at, program_id, action, result, reason FROM program_writes ORDER BY id DESC LIMIT ${WRITES_MAX}`;
    const held = await sql()<{ at: Date; program_id: string | null; reason: string | null; title: unknown; submission_url: unknown; source_url: unknown }[]>`
      SELECT at, program_id, reason, body->'title' AS title, body->'submission_url' AS submission_url, body->'source_url' AS source_url
      FROM program_writes WHERE result = 'pending' AND at > ${new Date(now.getTime() - APPROVE_TTL_DAYS * DAY_MS)}
      ORDER BY id DESC LIMIT ${WRITES_MAX}`;
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    const pending = held.map((w) => ({
      at: w.at,
      program_id: w.program_id,
      reason: w.reason,
      title: text(w.title),
      submission_url: text(w.submission_url),
      source_url: text(w.source_url),
      expires_at: new Date(approveExpiry(new Date(w.at)) * 1000),
    }));
    return json({ ok: true, writes, pending });
  } catch (err) {
    console.error(`[programs-api] writes failed: ${errTag(err)}`);
    return json({ ok: false, error: BUSY }, 503, { 'Retry-After': '30' });
  }
}

// ---- approve ----

export const APPROVE_TEXT = {
  title: 'Approve this program?',
  note: 'It goes live on EarnKit when you approve. Check the links first.',
  button: 'Approve',
  bad: 'This link is not valid.',
  expired: 'This link has expired. Ask the bot to send the program again.',
  done: 'This write was already handled.',
  superseded: 'A newer write for this program came in, so this one was not applied.',
  approved: 'Approved. The program is live.',
  refused: 'This write no longer passes the checks, so nothing changed:',
  busy: BUSY,
} as const;

const tokenOf = (request: Request) => new URL(request.url).searchParams.get('t') ?? '';

/** The token's write, or the failure page. The signature is checked before any database read. */
function checkLink(target: LinkTarget | null, now: Date, expired: string): { t: LinkTarget } | { fail: Response } {
  if (!target) return { fail: ownerLine(APPROVE_TEXT.bad, 400) };
  if (linkExpired(target, now)) return { fail: ownerLine(expired, 410) };
  return { t: target };
}

type ApproveOutcome =
  | { kind: 'applied'; id: string; result: Exclude<Result, 'closed'> }
  | { kind: 'not_pending'; state: string }
  | { kind: 'refused'; problems: string[] };

/** Applies pending write `writeId`: the write's checks again (verified_at as of the write), then the write transaction. */
async function approveWrite(writeId: string, deps: Deps): Promise<ApproveOutcome> {
  const [w] = await sql()<{ result: string; action: string; at: Date; body: unknown }[]>`
    SELECT result, action, at, body FROM program_writes WHERE id = ${writeId}`;
  if (!w || w.result !== 'pending' || w.action !== 'upsert') return { kind: 'not_pending', state: w?.result ?? 'missing' };
  const parsed = ProgramFile.safeParse(w.body);
  if (!parsed.success) return { kind: 'refused', problems: programProblems(w.body as Program, deps.now) };
  const p = parsed.data;
  const refusal = await writeRefusal(p, deps, new Date(w.at));
  if (refusal) return { kind: 'refused', problems: refusal.problems };
  let out: Applied;
  try {
    out = await applyUpsert(p, deps, { kind: 'approve', writeId });
  } catch (err) {
    if (err instanceof Curated) return { kind: 'refused', problems: [curatedLine(p.id)] };
    throw err;
  }
  if (out.kind === 'not_pending') return out;
  if (out.kind !== 'applied') throw new Error('an approval never holds');
  console.log(`[programs-api] approve ${p.id} ${out.result}`);
  if (out.result !== 'unchanged') deps.onChange(p.id);
  return { kind: 'applied', id: p.id, result: out.result };
}

/** GET /api/programs/approve?t=: the confirm page. It changes nothing (mail scanners open links). */
export async function approveGet(request: Request, now = new Date()): Promise<Response> {
  if (!programsApiOn()) return notFound();
  const token = tokenOf(request);
  const c = checkLink(approveTarget(token), now, APPROVE_TEXT.expired);
  if ('fail' in c) return c.fail;
  try {
    const [w] = await sql()<{ result: string; action: string; body: unknown; reason: string | null }[]>`
      SELECT result, action, body, reason FROM program_writes WHERE id = ${c.t.writeId}`;
    if (!w || w.action !== 'upsert') return ownerLine(APPROVE_TEXT.bad, 400);
    if (w.result !== 'pending') return ownerLine(w.result === 'superseded' ? APPROVE_TEXT.superseded : APPROVE_TEXT.done, 409);
    const parsed = ProgramFile.safeParse(w.body);
    if (!parsed.success) return ownerLine(APPROVE_TEXT.bad, 400);
    const p = parsed.data;
    const current = await getProgram(p.id);
    const lines = [
      `Program: ${p.title} (${p.id})`,
      `Organizer: ${p.organizer}`,
      // The pending body's links, not the live program's.
      ...linkLines(p, w.reason),
      `Source page: ${p.source_url}`,
      `Reward: ${p.summary}`,
      ...(p.form ? [`Form: ${p.form.platform}, ${Object.keys(p.form.fields ?? {}).length} field ids`] : []),
      current ? 'This changes a live program.' : 'This adds a new program.',
      APPROVE_TEXT.note,
    ];
    return confirmPage(APPROVE_TEXT.title, lines, `/api/programs/approve?t=${encodeURIComponent(token)}`, APPROVE_TEXT.button);
  } catch (err) {
    console.error(`[programs-api] approve page failed: ${errTag(err)}`);
    return ownerLine(APPROVE_TEXT.busy, 503);
  }
}

/** POST /api/programs/approve?t=: the approval. Single use: a replay finds the write no longer pending. */
export async function approvePost(request: Request, deps: Omit<WriteDeps, 'mailer' | 'limit'> = {}): Promise<Response> {
  if (!programsApiOn()) return notFound();
  const full = fullDeps(deps);
  const c = checkLink(approveTarget(tokenOf(request)), full.now, APPROVE_TEXT.expired);
  if ('fail' in c) return c.fail;
  try {
    const out = await approveWrite(c.t.writeId, full);
    if (out.kind === 'applied') return ownerLine(APPROVE_TEXT.approved, 200);
    if (out.kind === 'refused')
      return ownerPage([APPROVE_TEXT.refused, ...out.problems.slice(0, 10)].map((l) => `<p>${escapeHtml(l)}</p>`).join(''), 400);
    if (out.state === 'missing') return ownerLine(APPROVE_TEXT.bad, 400);
    return ownerLine(out.state === 'superseded' ? APPROVE_TEXT.superseded : APPROVE_TEXT.done, 409);
  } catch (err) {
    console.error(`[programs-api] approve failed: ${errTag(err)}`);
    return ownerLine(APPROVE_TEXT.busy, 503);
  }
}

// ---- revert ----

export const REVERT_TEXT = {
  title: 'Revert this change?',
  undo: 'The program goes back to how it was before this change.',
  close: 'This change created the program, so reverting closes it.',
  button: 'Revert',
  bad: 'This link is not valid.',
  expired: 'This link has expired. Change the program with the bot instead.',
  done: 'This change was already reverted.',
  superseded: 'A later change replaced this one, so it can no longer be reverted. Revert the later one.',
  curated: 'EarnKit curates this program now, so the bot change is gone already.',
  noEarlier: "EarnKit has no earlier copy of this program, so it can't revert this change.",
  reverted: 'Reverted. The program is back to how it was.',
  closed: 'Reverted. The program is closed.',
  busy: BUSY,
} as const;

type NotRevertable = 'missing' | 'done' | 'superseded' | 'curated' | 'no_earlier';
const NOT_REVERTABLE: Record<NotRevertable, [string, number]> = {
  missing: [REVERT_TEXT.bad, 400],
  done: [REVERT_TEXT.done, 409],
  superseded: [REVERT_TEXT.superseded, 409],
  curated: [REVERT_TEXT.curated, 409],
  no_earlier: [REVERT_TEXT.noEarlier, 409],
};

/** The writes a revert link can undo: applied upserts (a bot's or an approval's) and closes. */
const appliedSql = (db: Db) => db`((action = 'upsert' AND result IN ('created', 'updated')) OR (action = 'close' AND result = 'closed'))`;

/** The program's state just before write `writeId`: the last applied body before it (closed when a close came after it), or null. */
async function stateBefore(db: Db, programId: string, writeId: string): Promise<Program | null> {
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

type RevertDeps = { now?: Date; programsDir?: string | null; onChange?: (id: string) => void };
type RevertOutcome = { kind: 'reverted'; id: string; closed: boolean } | { kind: 'no'; state: NotRevertable };
type RevertPlan = { kind: 'ok'; id: string; title: string; does: 'close' | 'restore'; restore: Program | null } | { kind: 'no'; state: NotRevertable };

/**
 * What reverting `writeId` does, read under row locks when `lock`. Only the program's latest
 * applied write can be reverted: a later applied write, revert or file takeover supersedes it.
 */
export async function revertPlan(db: Db, writeId: string, programsDir: string | null, lock: boolean): Promise<RevertPlan> {
  const forUpdate = lock ? db`FOR UPDATE` : db``;
  const [w] = await db<{ program_id: string | null; action: string; result: string; body: unknown }[]>`
    SELECT program_id, action, result, body FROM program_writes WHERE id = ${writeId} AND ${appliedSql(db)} ${forUpdate}`;
  if (!w?.program_id) return { kind: 'no', state: 'missing' };
  const id = w.program_id;
  const [row] = await db<{ source: string; file: unknown }[]>`SELECT source, file FROM programs WHERE id = ${id} ${forUpdate}`;
  if (!row) return { kind: 'no', state: 'missing' };
  if (row.source !== 'api' || curatedIds(programsDir).has(id)) return { kind: 'no', state: 'curated' };
  const [done] = await db`SELECT 1 FROM program_writes WHERE program_id = ${id} AND action = 'revert' AND reason = ${`reverted write ${writeId}`} LIMIT 1`;
  if (done) return { kind: 'no', state: 'done' };
  const [later] = await db`
    SELECT 1 FROM program_writes WHERE program_id = ${id} AND id > ${writeId} AND (${appliedSql(db)} OR action IN ('revert', 'takeover')) LIMIT 1`;
  if (later) return { kind: 'no', state: 'superseded' };
  const title = ProgramFile.safeParse(row.file).data?.title ?? id;
  if (w.action === 'upsert' && w.result === 'created') return { kind: 'ok', id, title, does: 'close', restore: null };
  const before = await stateBefore(db, id, writeId);
  if (before === null) return { kind: 'no', state: 'no_earlier' };
  return { kind: 'ok', id, title: before.title, does: 'restore', restore: before };
}

/**
 * Reverts applied write `writeId`, once: restores the program as it was before it (re-opening a
 * close), or closes a program the write created. Recorded as a program_writes 'revert' row.
 */
export async function revertWrite(writeId: string, deps: RevertDeps = {}): Promise<RevertOutcome> {
  const now = deps.now ?? new Date();
  const programsDir = deps.programsDir === undefined ? findProgramsDir() : deps.programsDir;
  const out = await sql().begin(async (tx): Promise<RevertOutcome> => {
    const plan = await revertPlan(tx, writeId, programsDir, true);
    if (plan.kind === 'no') return { kind: 'no', state: plan.state };
    if (plan.does === 'close') await closeRow(tx, plan.id, now);
    else await upsertProgram(plan.restore!, 'api', now, tx);
    const [after] = await tx<{ file: unknown }[]>`SELECT file FROM programs WHERE id = ${plan.id}`;
    await tx`INSERT INTO program_writes (program_id, action, result, reason, body)
      VALUES (${plan.id}, 'revert', ${plan.does === 'close' ? 'closed' : 'reverted'}, ${`reverted write ${writeId}`}, ${tx.json(after!.file as postgres.JSONValue)})`;
    return { kind: 'reverted' as const, id: plan.id, closed: plan.does === 'close' };
  });
  if (out.kind === 'reverted') {
    console.log(`[programs-api] revert ${out.id} ${out.closed ? 'closed' : 'reverted'}`);
    (deps.onChange ?? programsChanged)(out.id);
  }
  return out;
}

/**
 * GET /api/programs/revert?t=: the confirm page; it changes nothing. The signed token alone
 * decides, so the link works while the API is off (the owner's way back from a bad write).
 */
export async function revertGet(request: Request, now = new Date(), programsDir?: string | null): Promise<Response> {
  const token = tokenOf(request);
  const c = checkLink(revertTarget(token), now, REVERT_TEXT.expired);
  if ('fail' in c) return c.fail;
  try {
    const plan = await revertPlan(sql(), c.t.writeId, programsDir === undefined ? findProgramsDir() : programsDir, false);
    if (plan.kind === 'no') return ownerLine(...NOT_REVERTABLE[plan.state]);
    return confirmPage(
      REVERT_TEXT.title,
      [`Program: ${plan.title} (${plan.id})`, plan.does === 'close' ? REVERT_TEXT.close : REVERT_TEXT.undo],
      `/api/programs/revert?t=${encodeURIComponent(token)}`,
      REVERT_TEXT.button,
    );
  } catch (err) {
    console.error(`[programs-api] revert page failed: ${errTag(err)}`);
    return ownerLine(REVERT_TEXT.busy, 503);
  }
}

/** POST /api/programs/revert?t=: the revert. Single use: a replay finds the revert row and does nothing. */
export async function revertPost(request: Request, deps: RevertDeps = {}): Promise<Response> {
  const now = deps.now ?? new Date();
  const c = checkLink(revertTarget(tokenOf(request)), now, REVERT_TEXT.expired);
  if ('fail' in c) return c.fail;
  try {
    const out = await revertWrite(c.t.writeId, { ...deps, now });
    if (out.kind === 'no') return ownerLine(...NOT_REVERTABLE[out.state]);
    return ownerLine(out.closed ? REVERT_TEXT.closed : REVERT_TEXT.reverted, 200);
  } catch (err) {
    console.error(`[programs-api] revert failed: ${errTag(err)}`);
    return ownerLine(REVERT_TEXT.busy, 503);
  }
}
