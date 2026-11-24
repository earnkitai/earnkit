/**
 * The owner's programs write API (Growth's writer): POST /api/programs/write upserts or closes an API program (or
 * records a tracked handle), GET /api/programs/writes is its audit log, GET /api/programs/digest the owner's daily
 * digest (owner-digest.ts), POST /api/programs/revert undoes one write. All under the programs bearer token. Audited.
 *
 * v3.8 E6 (decision 21): no person approves a program. In the automated lane (`automatedLane`: `auto_live` on, for
 * everyone or, through main's flag preview, in an owner/test caller's own request; or the writer sent the check's
 * fields) an upsert goes live at once when the official-page check passes (official-page.ts: the quotes on the page, organizer status, information only) and is
 * refused when it fails. Otherwise a create, a change to submission_url, chains, form or pool_source_url
 * (unless every link checks out, programs-pending.ts), or a change to submit, sign_in or min_tier is held as a
 * pending row that nothing applies: no email, no approve link.
 */
import { readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { revalidatePath } from 'next/cache';
import type postgres from 'postgres';
import { z } from 'zod';
import { apiTextProblems, apiUrlProblems, notWritableFields } from './api-text';
import { sql, type Db } from './db';
import { bearerMatches, json, readBody } from './http';
import { flagOn } from './flags';
import {
  FOUND_BY_MAX,
  QUOTE_MAX,
  handleKey,
  labelled,
  linksOffPage,
  officialPageOf,
  organizerStatus,
  pageLinks,
  pageText,
  quoteProblems,
  readOfficialPage,
  type PageReader,
} from './official-page';
import { programProblems } from './program-checks';
import { ProgramFile, categoryOf, type Program } from './program-file';
import { dateStatus, isOpenAt, upsertProgram } from './programs';
import { PENDING_DAYS, linkAnchors, officialUrlProblem, pendingReason, uncheckedLink } from './programs-pending';
import { findProgramsDir } from './programs-dir';
import { revalidateCatalog } from './programs-read';
import { ownerDigest } from './owner-digest';
import { RateLimitError, enforce } from './rate-limit';
import { BUILDER_OWN_NOTE } from './ledger';
import { SENT, sendCounts, sendRows, sendTime, throughEarnkit } from './stats';
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

const DAY_MS = 86_400_000;
/** UTC+14 is the earliest zone: a bot's "today" there is never refused as the future. */
const EARLIEST_ZONE_MS = 14 * 3_600_000;
const OFF_VALUES = new Set(['off', '0', 'false']);
const BUSY = 'EarnKit is busy. Try again in a minute.';
/** A bot wall or a sign-in still means the page exists. */
const BOT_WALL_STATUSES = [401, 403, 429];

/** The token is set (at least 32 characters, read trimmed: L42-3, v6.1.19) and EARNKIT_PROGRAMS_API isn't off. */
export function programsApiOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.EARNKIT_PROGRAMS_TOKEN?.trim();
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
  if (p.status === 'active' && dateStatus(p, now) === 'closed')
    problems.push('ends_at: has passed; an active program needs a future ends_at or null');
  problems.push(...apiUrlProblems(p));
  const official = officialUrlProblem(p.official_url);
  if (official && !problems.some((x) => x.startsWith('official_url:'))) problems.push(official);
  problems.push(...apiTextProblems(p));
  return problems;
}

export { findProgramsDir } from './programs-dir';

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
  /** Reads the official page (and an evidence page) for the auto_live check. Default safeProbePage, 5 s, 64 KB. */
  readPage?: PageReader;
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
type Deps = Required<Omit<WriteDeps, 'limit'>>;

const fullDeps = (deps: WriteDeps): Deps => ({
  readPage: deps.readPage ?? readOfficialPage,
  probe: deps.probe ?? ((u: string) => safeProbe(u, { timeoutMs: FETCH_TIMEOUT_MS })),
  now: deps.now ?? new Date(),
  programsDir: deps.programsDir === undefined ? findProgramsDir() : deps.programsDir,
  onChange: deps.onChange ?? programsChanged,
});

type Result = 'created' | 'updated' | 'unchanged' | 'closed';

const Quote = z.string().trim().min(1).max(QUOTE_MAX);
const FoundBy = z.string().trim().min(1).max(FOUND_BY_MAX);
/** An X handle: 1 to 15 letters, digits or underscores, an optional @. */
const Handle = z.string().trim().regex(/^@?[A-Za-z0-9_]{1,15}$/, 'an X handle');
const Domain = z.string().trim().toLowerCase().regex(/^(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, 'a domain name');

const Envelope = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upsert'),
    program: z.record(z.string(), z.unknown()),
    /** v3.8 E6: the official page's words for the amount and the deadline, copied exactly (required with auto_live). */
    amount_quote: Quote.optional(),
    deadline_quote: Quote.optional(),
    /** v3.8 E6: the search and the source that found this program (required with auto_live), stored on the write row. */
    found_by_query: FoundBy.optional(),
    found_by_source: FoundBy.optional(),
    /** v3.8 E6: the tracked X handle whose post named the program, and a page the API may read to tie the domain to the organizer. */
    handle: Handle.optional(),
    evidence_url: z.string().trim().url().max(2048).startsWith('https://').optional(),
  }).strict(),
  z.object({ action: z.literal('close'), id: z.string(), reason: z.string().trim().min(1).max(CLOSE_REASON_MAX) }).strict(),
  /** v3.8 E6: Growth records a tracked handle and the domain in its own X profile. */
  z.object({ action: z.literal('handle'), handle: Handle, profile_domain: Domain }).strict(),
]);
type UpsertEnvelope = Extract<z.infer<typeof Envelope>, { action: 'upsert' }>;

/** v3.8 E6r: the upsert fields only the automated lane reads; sending any of them asks for that lane. */
const CHECK_FIELDS = ['amount_quote', 'deadline_quote', 'found_by_query', 'found_by_source', 'handle', 'evidence_url'] as const;

/**
 * v3.8 E6r: whether an upsert takes the automated lane (the official-page check): `auto_live` on (for everyone, or in an
 * owner/test caller's request through the flag preview), or the writer sent any of the check's fields (Growth's
 * writer). Else the held lane.
 */
const automatedLane = (e: UpsertEnvelope): boolean => flagOn('auto_live') || CHECK_FIELDS.some((k) => e[k] !== undefined);
type FoundBy = { found_by_query?: string | null; found_by_source?: string | null };

const refused = (status: number, problems: string[]) => json({ ok: false, problems }, status);
const safeId = (id: unknown): string | null => (typeof id === 'string' && API_ID.test(id) ? id : null);
/** The record as stored and compared (undefined keys dropped). */
const asJson = (p: Program) => JSON.parse(JSON.stringify(p)) as postgres.JSONValue;

async function audit(db: Db, row: { program_id: string | null; action: string; result: string; reason?: string | null; body?: Program } & FoundBy) {
  await db`INSERT INTO program_writes (program_id, action, result, reason, body, found_by_query, found_by_source)
    VALUES (${row.program_id}, ${row.action}, ${row.result}, ${row.reason ?? null}, ${row.body ? db.json(asJson(row.body)) : null},
      ${row.found_by_query ?? null}, ${row.found_by_source ?? null})`;
}

/** A refused write, kept for the owner (the reason, never the body). Never throws. */
async function auditRefusal(action: string, id: unknown, result: string, problems: string[], found: FoundBy = {}) {
  const program_id = safeId(id);
  console.log(`[programs-api] ${action} ${program_id ?? '-'} ${result}`);
  await audit(sql(), { program_id, action, result, reason: problems.join('; ').slice(0, 1_000), ...found }).catch((err: unknown) =>
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
  if (at !== deps.now && p.status === 'active' && dateStatus(p, deps.now) === 'closed')
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
  | { kind: 'pending'; reason: string };

/** Fields whose change is held like a form change while auto_live is off: they decide who may submit and who qualifies. */
const GATE_FIELDS = ['submit', 'sign_in', 'min_tier'] as const;

/** The first gate field whose value differs between the live record and the write, or null. Pure. */
function changedGate(old: Partial<Program>, p: Program): string | null {
  const was = { submit: old.submit ?? 'either', sign_in: old.sign_in ?? 'none', min_tier: old.min_tier ?? null };
  const now = { submit: p.submit, sign_in: p.sign_in, min_tier: p.min_tier ?? null };
  return GATE_FIELDS.find((f) => was[f] !== now[f]) ?? null;
}

/** An auto_live write that passed the official-page check: the record as it goes live and why it carries its labels. */
type Checked = { live: Program; reason: string | null };

/**
 * The write transaction. The program row is locked and its source read again (a sync can't be overwritten). A write
 * that passed the official-page check (`checked`, auto_live on) is applied as labelled. Otherwise (auto_live off) a
 * write that creates the program or changes submission_url, chains, form or pool_source_url, and any of whose builder
 * links (submission_url, form.url, pool_source_url) doesn't check out, or that changes submit, sign_in or min_tier, is
 * held as a pending program_writes row that nothing applies (an identical pending body within PENDING_DAYS is reused).
 */
async function applyUpsert(p: Program, deps: Deps, checked: Checked | null, found: FoundBy): Promise<Applied> {
  return sql().begin(async (tx): Promise<Applied> => {
    const [row] = await tx<{ source: string; file: Partial<Program> | null }[]>`
      SELECT source, file FROM programs WHERE id = ${p.id} FOR UPDATE`;
    if (row && row.source !== 'api') throw new Curated();
    if (checked) {
      const result = await upsertProgram(checked.live, 'api', deps.now, tx);
      await audit(tx, { program_id: p.id, action: 'upsert', result, reason: checked.reason, body: result === 'unchanged' ? undefined : checked.live, ...found });
      return { kind: 'applied', result };
    }
    const old = row?.file ?? null;
    const needsCheck =
      !old ||
      old.submission_url !== p.submission_url ||
      !sameSet(old.chains ?? [], p.chains) ||
      !isDeepStrictEqual(old.form ?? null, (asJson(p) as { form?: unknown }).form ?? null) ||
      (old.pool_source_url ?? null) !== (p.pool_source_url ?? null);
    const unchecked = needsCheck ? uncheckedLink(p, await linkAnchors(tx, p, deps.now)) : null;
    const gate = old ? changedGate(old, p) : null;
    if (unchecked || gate) {
      // Two identical writes at once still make one pending row.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`program-pending:${p.id}`}))`;
      const reason = unchecked ? pendingReason(unchecked.url, p.official_url, unchecked.field) : `${gate} changed, which decides who can enter`;
      const [same] = await tx<{ id: string }[]>`
        SELECT id FROM program_writes
        WHERE program_id = ${p.id} AND result = 'pending' AND body = ${tx.json(asJson(p))}
          AND at > ${new Date(deps.now.getTime() - PENDING_DAYS * DAY_MS)}
        ORDER BY id DESC LIMIT 1`;
      if (!same) await audit(tx, { program_id: p.id, action: 'upsert', result: 'pending', reason, body: p, ...found });
      return { kind: 'pending', reason };
    }
    const result = await upsertProgram(p, 'api', deps.now, tx);
    await audit(tx, { program_id: p.id, action: 'upsert', result, body: result === 'unchanged' ? undefined : p, ...found });
    return { kind: 'applied', result };
  });
}

/** Listed to builders now: open, or upcoming. */
const live = (p: Program, now: Date) => p.status === 'upcoming' || isOpenAt(p, now);

/**
 * v3.8 E6: the official-page check for an auto_live write. Refusal problems when the quotes, found-by fields or page
 * fail (nothing goes live, nobody is mailed); else the record as it goes live, labelled new organizer and information
 * only as the check found. The page's text is only searched, never stored or returned.
 */
async function officialCheck(p: Program, e: UpsertEnvelope, deps: Deps): Promise<{ problems: string[] } | Checked> {
  const missing = (['amount_quote', 'deadline_quote', 'found_by_query', 'found_by_source'] as const)
    .filter((k) => e[k] === undefined)
    .map((k) => `${k}: required; ${k.endsWith('quote') ? "copy the official page's words exactly" : 'say which search and source found this program'}`);
  if (missing.length > 0) return { problems: missing };
  const url = officialPageOf(p);
  let html: string;
  try {
    html = await deps.readPage(url);
  } catch (err) {
    return { problems: [`official page: ${url} doesn't load (${(err instanceof Error ? err.message : 'unknown error').slice(0, 160)})`] };
  }
  const quotes = quoteProblems(p, { amount_quote: e.amount_quote!, deadline_quote: e.deadline_quote! }, pageText(html));
  if (quotes.length > 0) return { problems: quotes };
  const off = linksOffPage(p, url, pageLinks(html, url));
  const org = await organizerStatus(sql(), p, { handle: e.handle ?? null, evidenceUrl: e.evidence_url ?? null, read: deps.readPage });
  const reasons = [
    ...(org.status === 'new' ? [`new organizer: ${org.why}`] : []),
    ...(off.length > 0 ? [`information only: ${off.join(', ')} not on the official page`] : []),
  ];
  return { live: labelled(p, { newOrganizer: org.status === 'new', infoOnly: off.length > 0 }), reason: reasons.length > 0 ? reasons.join('; ') : null };
}

async function upsertAction(e: UpsertEnvelope, deps: Deps, automated: boolean): Promise<Response> {
  const raw = e.program;
  const found: FoundBy = automated ? { found_by_query: e.found_by_query ?? null, found_by_source: e.found_by_source ?? null } : {};
  const forbidden = notWritableFields(raw);
  const parsed = ProgramFile.safeParse(raw);
  if (forbidden.length > 0 || !parsed.success) {
    const problems = [...forbidden, ...(parsed.success ? [] : programProblems(raw as Program, deps.now))];
    await auditRefusal('upsert', raw.id, 'refused', problems, found);
    return refused(400, problems);
  }
  const p = parsed.data;
  const refusal = await writeRefusal(p, deps);
  if (refusal) {
    await auditRefusal('upsert', p.id, refusal.result, refusal.problems, found);
    return refused(refusal.status, refusal.problems);
  }
  let checked: Checked | null = null;
  if (automated) {
    const c = await officialCheck(p, e, deps);
    if ('problems' in c) {
      await auditRefusal('upsert', p.id, 'refused', c.problems, found);
      return refused(400, c.problems);
    }
    checked = c;
  }
  let out: Applied;
  try {
    out = await applyUpsert(p, deps, checked, found);
  } catch (err) {
    if (!(err instanceof Curated)) throw err;
    await auditRefusal('upsert', p.id, 'curated', [curatedLine(p.id)], found);
    return refused(409, [curatedLine(p.id)]);
  }
  if (out.kind === 'pending') {
    console.log(`[programs-api] upsert ${p.id} pending`);
    return json({ ok: true, id: p.id, result: 'pending', category: categoryOf(p), live: false, reason: out.reason }, 202);
  }
  const result = out.result;
  console.log(`[programs-api] upsert ${p.id} ${result}`);
  if (result !== 'unchanged') deps.onChange(p.id);
  const labels = checked ? { organizer: checked.live.new_organizer ? 'new' : 'confirmed', info_only: checked.live.info_only === true } : {};
  return json({ ok: true, id: p.id, result, category: categoryOf(p), live: live(p, deps.now), ...labels });
}

/** v3.8 E6: records (or moves) a tracked X handle and the domain in its own profile. Audited. */
async function handleAction(handle: string, domain: string): Promise<Response> {
  const key = handleKey(handle);
  await sql().begin(async (tx) => {
    await tx`INSERT INTO tracked_handles (handle, profile_domain) VALUES (${key}, ${domain})
      ON CONFLICT (handle) DO UPDATE SET profile_domain = EXCLUDED.profile_domain, at = now()`;
    await audit(tx, { program_id: null, action: 'handle', result: 'recorded', reason: `@${key} ${domain}` });
  });
  console.log(`[programs-api] handle @${key} recorded`);
  return json({ ok: true, handle: key, profile_domain: domain, result: 'recorded' });
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
    if (e.action === 'handle') return await handleAction(e.handle, e.profile_domain);
    if (e.action === 'close') return await closeAction(e.id, e.reason, full);
    return await upsertAction(e, full, automatedLane(e));
  } catch (err) {
    console.error(`[programs-api] write failed: ${errTag(err)}`);
    return json({ ok: false, error: BUSY }, 503, { 'Retry-After': '30' });
  }
}

/**
 * GET /api/programs/writes: the last WRITES_MAX program_writes rows, newest first, never a body;
 * and `pending`, the writes held in the last PENDING_DAYS (auto_live off; nothing applies them), with title and links.
 */
export async function writesGet(request: Request, now = new Date()): Promise<Response> {
  const denied = authFailure(request);
  if (denied) return denied;
  try {
    const writes = await sql()<{ at: Date; program_id: string | null; action: string; result: string; reason: string | null; found_by_query: string | null; found_by_source: string | null }[]>`
      SELECT at, program_id, action, result, reason, found_by_query, found_by_source FROM program_writes ORDER BY id DESC LIMIT ${WRITES_MAX}`;
    const held = await sql()<{ at: Date; program_id: string | null; reason: string | null; title: unknown; submission_url: unknown; source_url: unknown }[]>`
      SELECT at, program_id, reason, body->'title' AS title, body->'submission_url' AS submission_url, body->'source_url' AS source_url
      FROM program_writes WHERE result = 'pending' AND at > ${new Date(now.getTime() - PENDING_DAYS * DAY_MS)}
      ORDER BY id DESC LIMIT ${WRITES_MAX}`;
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    const pending = held.map((w) => ({
      at: w.at,
      program_id: w.program_id,
      reason: w.reason,
      title: text(w.title),
      submission_url: text(w.submission_url),
      source_url: text(w.source_url),
    }));
    return json({ ok: true, writes, pending });
  } catch (err) {
    console.error(`[programs-api] writes failed: ${errTag(err)}`);
    return json({ ok: false, error: BUSY }, 503, { 'Retry-After': '30' });
  }
}

// ---- applications (v6.1.18 Task 5, L18-5) ----

/** The owner's list of sends: at most this many rows a call (default APPLICATIONS_DEFAULT). */
export const APPLICATIONS_MAX = 500;
export const APPLICATIONS_DEFAULT = 100;
const SINCE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * v6.1.19 Task 1 (L42-4, L42-8): `since` as a time, or null. `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM[:SS[.fff]]` with an
 * optional `Z` or `±HH:MM`; no zone is UTC (never the server's zone). The date and clock must exist: `2026-02-30` and
 * `T24:00` are null, not rolled over. Pure.
 */
export function parseSince(text: string): Date | null {
  const m = SINCE.exec(text);
  if (!m) return null;
  const [y, mo, d, hh, mm, ss] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0', m[6] ?? '0'].map(Number);
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  // Years 0000 to 0099 fail the round-trip on purpose (Date.UTC reads them as 1900 to 1999): never a real since.
  const t = Date.UTC(y, mo - 1, d, hh, mm, ss, ms);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d
    || back.getUTCHours() !== hh || back.getUTCMinutes() !== mm || back.getUTCSeconds() !== ss) return null;
  const zone = m[8];
  if (!zone || zone === 'Z') return back;
  const [zh, zm] = zone.slice(1).split(':').map(Number);
  if (zh > 14 || zm > 59) return null;
  const offset = (zh * 60 + zm) * 60_000 * (zone[0] === '-' ? -1 : 1);
  return new Date(t - offset);
}

/**
 * GET /api/programs/applications?since=<ISO>&limit=<1..500>, owner only (authFailure): every send (applied or any
 * result), newest first by its send time (`sendTime`; v6.1.19 L42-2: a send with none, made outside EarnKit, is listed
 * last and its `sent_at` is null). `since` (parseSince, UTC when no zone) filters the rows only: a dated row by its send
 * time, an undated one by its `at` (a bad one is 400 `since: an ISO date`); `limit` defaults to 100, a number over 500 is read as 500, and 0, a negative or a non-number is
 * 400 `limit: 1 to 500`. `totals` and `by_program` are always all time: `agent`, `drafted` (a builder sent an EarnKit
 * draft), `reported` (EarnKit had no part), `auto` (standing approval); see `sendCounts` in stats.ts. A row names the
 * builder by GitHub login (a `b:` owner, or the linked builder of an `i:` owner's installation) and the agent by its
 * client name (L42-6: the installation that recorded the send, not a result's; final fix round M1: none for a builder's
 * send with no sending installation kept), and says `through_earnkit` (L36-3) and
 * `reported` (L42-2); never an email, a sign-in code, the owner key or an installation id.
 */
export async function applicationsGet(request: Request): Promise<Response> {
  const denied = authFailure(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const sinceText = params.get('since')?.trim() ?? null;
  let since: Date | null = null;
  if (sinceText !== null) {
    since = parseSince(sinceText);
    if (!since) return json({ ok: false, error: 'since: an ISO date' }, 400);
  }
  const limitText = params.get('limit')?.trim() ?? null;
  let limit = APPLICATIONS_DEFAULT;
  if (limitText !== null) {
    if (!/^\d{1,9}$/.test(limitText) || Number(limitText) < 1) return json({ ok: false, error: `limit: 1 to ${APPLICATIONS_MAX}` }, 400);
    limit = Math.min(Number(limitText), APPLICATIONS_MAX);
  }
  try {
    const db = sql();
    const [t] = await db<{ all: string; agent: string; drafted: string; reported: string; auto: string }[]>`
      WITH s AS (${sendRows(db)}) SELECT ${sendCounts(db)} FROM s`;
    const byProgram = await db<{ program_id: string; title: string | null; sent: string }[]>`
      WITH s AS (${sendRows(db)})
      SELECT program_id, max(title) AS title, count(*) AS sent FROM s GROUP BY program_id ORDER BY count(*) DESC, program_id`;
    const rows = await db<{
      application_id: string | null; program_id: string; title: string | null; status: string; submitted_by: string | null; auto_applied: boolean;
      sent_at: Date | null; at: Date; builder: string | null; agent: string | null; fields_used: string[] | null; amount_usd: string | null; through: boolean;
    }[]>`
      SELECT a.application_id, a.program_id, a.title, a.status, a.submitted_by, a.auto_applied, ${sendTime(db)} AS sent_at, a.at,
             b.login AS builder, s.client_name AS agent, a.fields_used, a.amount_usd, ${throughEarnkit(db)} AS through
      FROM applications a
      LEFT JOIN installations i ON i.id = a.installation_id
      LEFT JOIN installations s ON s.id = CASE WHEN a.sent_by_installation_id IS NULL AND EXISTS (SELECT 1 FROM application_history h
        WHERE h.owner = a.owner AND h.program_id = a.program_id AND COALESCE(h.project_id, '') = COALESCE(a.project_id, '')
          AND h.status = 'applied' AND h.note = ${BUILDER_OWN_NOTE}) THEN NULL ELSE COALESCE(a.sent_by_installation_id, a.installation_id) END
      LEFT JOIN builders b ON b.id::text = CASE WHEN a.owner LIKE 'b:%' THEN substring(a.owner from 3) ELSE i.builder_id::text END
      WHERE a.status = ANY(${SENT})
        ${since ? db`AND (${sendTime(db)} >= ${since} OR (${sendTime(db)} IS NULL AND a.at >= ${since}))` : db``}
      ORDER BY ${sendTime(db)} DESC NULLS LAST, a.at DESC, a.application_id DESC LIMIT ${limit}`;
    const by = (v: string | null) => (v === 'agent' || v === 'builder' ? v : null);
    return json({
      ok: true,
      totals: {
        all: Number(t.all), agent: Number(t.agent), drafted: Number(t.drafted), reported: Number(t.reported), auto: Number(t.auto),
        by_program: byProgram.map((p) => ({ program_id: p.program_id, title: p.title ?? p.program_id, sent: Number(p.sent) })),
      },
      rows: rows.map((r) => ({
        application_id: r.application_id,
        program_id: r.program_id,
        title: r.title ?? r.program_id,
        status: r.status,
        // L42-9 (v6.1.19): an unmarked send is the agent's (L29-23); the stored null stays.
        submitted_by: by(r.submitted_by ?? 'agent'),
        auto_applied: r.auto_applied,
        sent_at: r.sent_at?.toISOString() ?? null,
        at: r.at.toISOString(),
        builder: r.builder,
        agent: r.agent,
        fields_used: r.fields_used?.length ?? 0,
        amount_usd: r.amount_usd === null ? null : Number(r.amount_usd),
        through_earnkit: r.through,
        // L42-2 (v6.1.19): a builder's send EarnKit had no part in, as the totals' `reported` counts it.
        reported: r.submitted_by === 'builder' && !r.through,
      })),
    });
  } catch (err) {
    console.error(`[programs-api] applications failed: ${errTag(err)}`);
    return json({ ok: false, error: BUSY }, 503, { 'Retry-After': '30' });
  }
}

// ---- revert ----

/** What POST /api/programs/revert answers when it cannot revert, by state: plain words for the owner's agent. */
export const NOT_REVERTABLE = {
  missing: 'No applied write has that id.',
  done: 'That write was already reverted.',
  superseded: 'A later change replaced that write, so it can no longer be reverted. Revert the later one.',
  curated: 'EarnKit curates this program now, so the API change is gone already.',
  no_earlier: "EarnKit has no earlier copy of this program, so it can't revert that write.",
} as const;
type NotRevertable = keyof typeof NOT_REVERTABLE;

/** The writes a revert can undo: applied upserts (a bot's or an approval's) and closes. */
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

const WRITE_ID = /^[1-9][0-9]{0,15}$/;

/**
 * POST /api/programs/revert `{ "write_id": "<id>" }`, programs bearer (v3.8 E7: no signed link, no confirm page): undoes
 * that applied write once (`revertWrite`). 200 `{ ok, id, result: 'reverted' | 'closed' }`; 409 with the reason when it
 * cannot (`NOT_REVERTABLE`); 400 for a bad body.
 */
export async function revertPost(request: Request, deps: RevertDeps = {}): Promise<Response> {
  const denied = authFailure(request);
  if (denied) return denied;
  const text = await readBody(request, 1024, () => json({ ok: false, error: 'the body came too slowly' }, 408));
  if (text instanceof Response) return text;
  let writeId: unknown;
  try {
    writeId = (JSON.parse(text ?? '') as { write_id?: unknown } | null)?.write_id;
  } catch {
    writeId = undefined;
  }
  if (typeof writeId === 'number') writeId = String(writeId);
  if (typeof writeId !== 'string' || !WRITE_ID.test(writeId)) return json({ ok: false, error: 'write_id: the id of an applied write (from the digest)' }, 400);
  try {
    const out = await revertWrite(writeId, deps);
    if (out.kind === 'no') return json({ ok: false, error: NOT_REVERTABLE[out.state], state: out.state }, out.state === 'missing' ? 404 : 409);
    return json({ ok: true, id: out.id, result: out.closed ? 'closed' : 'reverted' });
  } catch (err) {
    console.error(`[programs-api] revert failed: ${errTag(err)}`);
    return json({ ok: false, error: BUSY }, 503, { 'Retry-After': '30' });
  }
}

/**
 * GET /api/programs/digest, programs bearer (v3.8 E7, plan 23.2 owner read): the day's digest as plain data plus one
 * line per item (`lines`, the digest text split by line). Reads only; the daily run records the day.
 */
export async function digestGet(request: Request, now = new Date()): Promise<Response> {
  const denied = authFailure(request);
  if (denied) return denied;
  try {
    const d = await ownerDigest(now);
    return json({
      ok: true,
      day: d.day,
      lines: d.text === null ? [] : d.text.trim().split('\n').slice(1).filter((l) => l.trim() !== ''),
      changes: d.changes.map((c) => ({ program_id: c.id, title: c.title, fields: c.fields, write_id: c.writeId, ...(c.revertNote ? { note: c.revertNote } : {}) })),
      health: d.health,
      applications: d.applications,
      results: d.results,
      recorded: d.recorded,
    });
  } catch (err) {
    console.error(`[programs-api] digest failed: ${errTag(err)}`);
    return json({ ok: false, error: BUSY }, 503, { 'Retry-After': '30' });
  }
}
