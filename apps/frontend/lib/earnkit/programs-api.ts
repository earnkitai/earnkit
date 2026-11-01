import { existsSync, readdirSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type postgres from 'postgres';
import { z } from 'zod';
import { sql } from './db';
import { bearerMatches, json } from './http';
import { programProblems, schemaProblems } from './program-checks';
import { ProgramFile, categoryOf, isOptimismUrl } from './program-file';
import { ApiRowTakenError, upsertProgram } from './programs';
import { apiTextProblems, apiUrlProblem, notWritableFields } from './api-program-text';
import { apiSubmitHostAllowed, normalHost, sourceSiteName } from './submit-hosts';
import { RateLimitError, enforce } from './rate-limit';
import { FETCH_TIMEOUT_MS, HttpStatusError, safeProbe } from './safe-fetch';
import { readCapped } from './secrets';

/**
 * v4.9 Task 2: POST /api/programs/write, the owner's Grok Bot's write API (plan R1-R6). Every write goes live at once
 * when it passes the checks, in this order, stopping at the first failing group:
 *   1. the feature is on (404), the token is right (401), the rate limit (429), the body is at most 256 KB (413) and
 *      parses as JSON (400);
 *   2. the envelope and ProgramFile parse, and only allowlisted fields are present (fix round 2; R4) (400);
 *   3. programProblems (the same checks as `pnpm programs:check`) is empty (400);
 *   4. the API-only rules (apiRuleProblems) hold (400): no shared-host rule on program pages (fix round 0; real
 *      programs submit on Google Forms, DoraHacks and Questbook);
 *   5. the id isn't curated: no programs/<id>.json, and no existing row whose source isn't 'api' (R3, 409);
 *   6. source_url and submission_url load (safeProbe, 5 s) (400).
 * Then upsertProgram(parsed, 'api') and a program_writes row. Only parsed data is written, never the raw body.
 * Logs carry the action, a well-formed id and the result only: never the token or a body.
 */

/** The largest body the API reads (the MCP route's cap pattern, at 256 KB). */
export const PROGRAMS_BODY_MAX = 256 * 1024;
/**
 * Fix round 2 (controller): the API writes only the allowlisted fields (api-program-text.ts API_FIELDS and
 * API_REQUIREMENT_FIELDS); every other field (proof fields, logo, campaign, starters, guidance, judging, form, ...) is
 * the owner's, by file.
 */
export { API_FIELDS, API_REQUIREMENT_FIELDS } from './api-program-text';
export const API_ID = /^[a-z0-9-]{3,64}$/;
/** verified_at may be at most this many days old. */
export const VERIFIED_MAX_AGE_DAYS = 7;
export const CLOSE_REASON_MAX = 200;
/** The 409 line (R3). */
export const curatedLine = (id: string) => `${id} is curated by EarnKit; send a new id or ask the owner`;

const DAY_MS = 86_400_000;
/** UTC+14 is the earliest zone: a bot's "today" there is never refused as the future. */
const EARLIEST_ZONE_MS = 14 * 3_600_000;

/** Fix 1 (review F4): the off switch, trimmed and case-insensitive. */
const OFF_VALUES = new Set(['off', '0', 'false']);

/** The token is set (R6: at least 32 characters) and the off switch isn't thrown. */
export function programsApiOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.EARNKIT_PROGRAMS_TOKEN;
  return Boolean(token && token.length >= 32) && !OFF_VALUES.has((env.EARNKIT_PROGRAMS_API ?? '').trim().toLowerCase());
}

/** Fix 1 (review F5): what a failure log may say: the error's name and postgres code, never its message. */
const errTag = (err: unknown) => {
  const e = err as { name?: unknown; code?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name.replace(/[^\w]/g, '').slice(0, 40) : 'unknown';
  const code = typeof e?.code === 'string' ? e.code.replace(/[^\w]/g, '').slice(0, 10) : null;
  return code ? `${name} ${code}` : name;
};


/** The URL's raw hostname (lowercase, brackets kept), or null. */
const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** Check group 4: the rules only API programs follow (a file is owner-reviewed). Pure. */
export function apiRuleProblems(p: ProgramFile, now: Date): string[] {
  const problems: string[] = [];
  if (!API_ID.test(p.id)) problems.push('id: 3 to 64 lowercase letters, digits or dashes');
  const day = Date.parse(`${p.verified_at}T00:00:00Z`);
  const todayUtc = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  if (day > now.getTime() + EARLIEST_ZONE_MS) problems.push('verified_at: is in the future');
  else if (day < todayUtc - VERIFIED_MAX_AGE_DAYS * DAY_MS)
    problems.push(`verified_at: more than ${VERIFIED_MAX_AGE_DAYS} days ago; check the source again`);
  if (p.status === 'active' && p.ends_at !== null && Date.parse(p.ends_at) <= now.getTime())
    problems.push('ends_at: has passed; an active program needs a future ends_at or null');
  // Fix round 2: the only URL fields an API program has (pool_source_url is optional).
  const urlKeys = ['source_url', 'submission_url', ...(p.pool_source_url !== undefined ? (['pool_source_url'] as const) : [])] as const;
  for (const key of urlKeys) {
    const url = p[key]!;
    const host = hostOf(url);
    // Fix round 4 (N1): printable ASCII, normalized, no fragment or userinfo, no hidden characters.
    const urlProblem = apiUrlProblem(key, url);
    if (urlProblem) problems.push(urlProblem);
    else if (!url.startsWith('https://') || host === null) problems.push(`${key}: must be https`);
    // Security review: a trailing dot or an IP literal never names a program's own site (and dodges host checks).
    else if (host.endsWith('.')) problems.push(`${key}: no trailing dot in the host name`);
    else if (isIP(host.replace(/^\[(.*)\]$/, '$1'))) problems.push(`${key}: use the program's domain name, not an IP address`);
    else if (isOptimismUrl(url)) problems.push(`${key}: Optimism programs are not listed`);
  }
  // Fix 1 (security review), fix round 2: builders go only to the program's own site (on a shared domain, its exact
  // host) or a known submit platform; pool_source_url follows the same rule.
  const source = hostOf(p.source_url);
  if (source !== null && problems.every((x) => !x.startsWith('source_url'))) {
    for (const key of urlKeys.filter((k) => k !== 'source_url')) {
      if (problems.some((x) => x.startsWith(key))) continue;
      const u = new URL(p[key]!);
      if (!apiSubmitHostAllowed(u.hostname, source, u.pathname))
        problems.push(`${key}: ${normalHost(u.hostname)} is neither on ${sourceSiteName(source)} (the source's domain) nor a known submit platform`);
    }
  }
  // Fix 1 (review F2): builder- and agent-facing text carries no links, markdown links or HTML.
  problems.push(...apiTextProblems(p));
  return problems;
}

/** Where programs/*.json are at run time (`next start` runs in apps/frontend), or null. */
export function findProgramsDir(cwd = process.cwd()): string | null {
  for (const dir of [join(cwd, '..', '..', 'programs'), join(cwd, 'programs')]) if (existsSync(dir)) return dir;
  return null;
}

/** The ids of the curated program files: programs/<id>.json. */
export function curatedIds(dir: string | null): Set<string> {
  if (!dir) return new Set();
  try {
    return new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)));
  } catch {
    return new Set();
  }
}

/** Fix round 0 (controller): a bot wall or a sign-in still means the page exists. */
export const BOT_WALL_STATUSES = [401, 403, 429];

/**
 * A link that must load: safeProbe (public addresses only, a 2xx that isn't an error page), 5 s. A 401, 403 or 429
 * answer passes (the page is there behind a wall); a 404, 410, 5xx or network error still fails.
 */
export async function probeLink(url: string, probe: (url: string) => Promise<void> = (u) => safeProbe(u, { timeoutMs: FETCH_TIMEOUT_MS })): Promise<void> {
  try {
    await probe(url);
  } catch (err) {
    if (err instanceof HttpStatusError && BOT_WALL_STATUSES.includes(err.status)) return;
    throw err;
  }
}

export type WriteDeps = {
  now?: Date;
  /** Resolves when the URL loads; throws (any error) when it doesn't. Default safeProbe. */
  checkLink?: (url: string) => Promise<void>;
  /** The programs/ directory; default findProgramsDir(). null: none on disk (the row check still guards). */
  programsDir?: string | null;
  /** Counts one authenticated call; throws a RateLimitError when over the limit. Default LIMITS.programsWrite. */
  limit?: () => Promise<unknown>;
  /** Tests only: runs inside the write transaction right after the row is read (a sync racing the write). */
  afterRead?: () => Promise<void>;
};

type Result = 'created' | 'updated' | 'unchanged' | 'closed';

const Envelope = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upsert'), program: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('close'), id: z.string(), reason: z.string().trim().min(1).max(CLOSE_REASON_MAX) }).strict(),
]);

const refused = (status: number, problems: string[]) => json({ ok: false, problems }, status);

/** An id fit for a log line or an audit row: only a well-formed one. */
const safeId = (id: unknown): string | null => (typeof id === 'string' && API_ID.test(id) ? id : null);

async function audit(
  db: postgres.Sql | postgres.TransactionSql,
  row: { program_id: string | null; action: string; result: string; reason?: string | null; body?: unknown },
) {
  await db`INSERT INTO program_writes (program_id, action, result, reason, body)
    VALUES (${row.program_id}, ${row.action}, ${row.result}, ${row.reason ?? null}, ${row.body === undefined || row.body === null ? null : db.json(row.body as postgres.JSONValue)})`;
}

/** A refused write, kept for the owner (the reason, never the body). Never throws. */
async function auditRefusal(action: string, id: unknown, result: string, problems: string[]) {
  const program_id = safeId(id);
  console.log(`[programs-api] ${action} ${program_id ?? '-'} ${result}`);
  await audit(sql(), { program_id, action, result, reason: problems.join('; ').slice(0, 1_000) }).catch((err: unknown) =>
    console.error(`[programs-api] audit write failed: ${errTag(err)}`),
  );
}

/** The program row and its tracks, for the deep-equal "unchanged" check. */
async function snapshot(tx: postgres.TransactionSql, id: string): Promise<unknown> {
  const [row] = await tx<{ row: unknown; tracks: unknown }[]>`
    SELECT to_jsonb(p) - 'created_at' AS row,
      (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM tracks t WHERE t.program_id = p.id) AS tracks
    FROM programs p WHERE p.id = ${id}`;
  return row ?? null;
}

class Unchanged extends Error {}
class Curated extends Error {}

const live = (p: Pick<ProgramFile, 'status' | 'ends_at'>, now: Date) =>
  p.status === 'upcoming' || (p.status === 'active' && (p.ends_at === null || Date.parse(p.ends_at) > now.getTime()));

async function upsertAction(raw: Record<string, unknown>, deps: Required<Omit<WriteDeps, 'limit'>>): Promise<Response> {
  const { now } = deps;
  // Group 2: the field allowlist and the schema.
  const forbidden = notWritableFields(raw);
  const parsed = ProgramFile.safeParse(raw);
  if (forbidden.length > 0 || !parsed.success) {
    const problems = [...forbidden, ...(parsed.success ? [] : schemaProblems(parsed.error))];
    await auditRefusal('upsert', raw.id, 'refused', problems);
    return refused(400, problems);
  }
  const p = parsed.data;
  // Group 3: programs:check's rules. No logo reaches here (not writable), so nothing reads a caller-chosen path.
  const checks = programProblems(p, { publicDir: join(process.cwd(), 'public') });
  if (checks.length > 0) {
    await auditRefusal('upsert', p.id, 'refused', checks);
    return refused(400, checks);
  }
  // Group 4.
  const rules = apiRuleProblems(p, now);
  if (rules.length > 0) {
    await auditRefusal('upsert', p.id, 'refused', rules);
    return refused(400, rules);
  }
  // Group 5 (R3): a programs/ file, or a row another writer made.
  const [existing] = await sql()<{ source: string }[]>`SELECT source FROM programs WHERE id = ${p.id}`;
  if (curatedIds(deps.programsDir).has(p.id) || (existing && existing.source !== 'api')) {
    await auditRefusal('upsert', p.id, 'curated', [curatedLine(p.id)]);
    return refused(409, [curatedLine(p.id)]);
  }
  // Group 6: both links load (one probe when they're the same URL).
  const linkProblems: string[] = [];
  const urls = p.source_url === p.submission_url ? (['source_url'] as const) : (['source_url', 'submission_url'] as const);
  for (const key of urls) {
    try {
      await deps.checkLink(p[key]);
    } catch (err) {
      linkProblems.push(`${key}: doesn't load (${(err instanceof Error ? err.message : 'unknown error').slice(0, 160)})`);
    }
  }
  if (linkProblems.length > 0) {
    await auditRefusal('upsert', p.id, 'refused', linkProblems);
    return refused(400, linkProblems);
  }

  // Fix round 2: stored exactly as checked ("€10K" survives); MCP output carries the API_CONTENT envelope.
  const clean = p;
  let result: Result;
  try {
    result = await sql().begin(async (tx) => {
      // The row is locked and its source read again, so a sync between the check and the write can't be overwritten.
      const [row] = await tx<{ source: string }[]>`SELECT source FROM programs WHERE id = ${p.id} FOR UPDATE`;
      if (row && row.source !== 'api') throw new Curated();
      const before = row ? await snapshot(tx, p.id) : null;
      await deps.afterRead();
      // Fix 1 (F1): upsertProgram updates only an api row (ApiRowTakenError otherwise), and reports a fresh insert, so
      // a row another writer inserted after the read above is never overwritten, and two creates aren't both "created".
      const { inserted } = await upsertProgram(clean, 'api', tx);
      if (before !== null && isDeepStrictEqual(before, await snapshot(tx, p.id))) throw new Unchanged();
      const r: Result = inserted ? 'created' : 'updated';
      await audit(tx, { program_id: p.id, action: 'upsert', result: r, body: clean });
      return r;
    });
  } catch (err) {
    if (err instanceof Curated || err instanceof ApiRowTakenError) {
      await auditRefusal('upsert', p.id, 'curated', [curatedLine(p.id)]);
      return refused(409, [curatedLine(p.id)]);
    }
    if (!(err instanceof Unchanged)) throw err;
    // The write was rolled back (nothing changed); the audit row is still kept.
    result = 'unchanged';
    await audit(sql(), { program_id: p.id, action: 'upsert', result });
  }
  console.log(`[programs-api] upsert ${p.id} ${result}`);
  return json({ ok: true, id: p.id, result, category: categoryOf(p), live: live(p, now) });
}

async function closeAction(id: string, reason: string, deps: Required<Omit<WriteDeps, 'limit'>>): Promise<Response> {
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
    if (result === 'closed') await tx`UPDATE programs SET status = 'closed' WHERE id = ${id}`;
    await audit(tx, { program_id: id, action: 'close', result, reason });
    return { status: 200 as const, result, row };
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
  // Every upsert since v4.9 Task 1 writes the category, and only api rows reach here.
  return json({ ok: true, id, result: out.result, category: out.row.category, live: false });
}

let warnedNoDir = false;

/** POST /api/programs/write. */
export async function programsWritePost(request: Request, deps: WriteDeps = {}): Promise<Response> {
  // Group 1. Unset token or the off switch: the route doesn't exist (R6).
  if (!programsApiOn()) return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  // Constant time: both sides are hashed to 32 bytes before timingSafeEqual (http.ts secretMatches).
  if (!bearerMatches(request.headers.get('authorization'), process.env.EARNKIT_PROGRAMS_TOKEN))
    return json({ ok: false, error: 'unauthorized' }, 401);
  try {
    // A fixed hour window (the repo's limiter), not a rolling one: up to 240 can land across a boundary (controller: fine).
    await (deps.limit ?? (() => enforce('programsWrite', 'owner', 'Too many program writes this hour.')))();
  } catch (err) {
    if (err instanceof RateLimitError) return json({ ok: false, error: err.message }, 429, { 'Retry-After': String(err.retryAfter) });
    console.error(`[programs-api] rate limit check failed: ${errTag(err)}`);
    return json({ ok: false, error: 'EarnKit is busy. Try again in a minute.' }, 503, { 'Retry-After': '30' });
  }
  const text = await readCapped(request, PROGRAMS_BODY_MAX).catch(() => null);
  if (text === null) return json({ ok: false, error: `body over ${PROGRAMS_BODY_MAX / 1024} KB` }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refused(400, ['body: not JSON']);
  }

  const programsDir = deps.programsDir === undefined ? findProgramsDir() : deps.programsDir;
  if (programsDir === null && !warnedNoDir) {
    warnedNoDir = true;
    console.warn('[programs-api] programs/ not found; the row check alone guards curated ids');
  }
  const full = {
    now: deps.now ?? new Date(),
    checkLink: deps.checkLink ?? ((u: string) => probeLink(u)),
    programsDir,
    afterRead: deps.afterRead ?? (async () => {}),
  };
  try {
    const envelope = Envelope.safeParse(body);
    if (!envelope.success) {
      const problems = schemaProblems(envelope.error);
      await auditRefusal((body as { action?: unknown } | null)?.action === 'close' ? 'close' : 'upsert', null, 'refused', problems);
      return refused(400, problems);
    }
    const e = envelope.data;
    return e.action === 'upsert' ? await upsertAction(e.program, full) : await closeAction(e.id, e.reason, full);
  } catch (err) {
    console.error(`[programs-api] write failed: ${errTag(err)}`);
    return json({ ok: false, error: 'EarnKit is busy. Try again in a minute.' }, 503, { 'Retry-After': '30' });
  }
}

/**
 * Controller ruling 2 (Task 1 review F1): `programs:sync` is about to write a file over `id`. When that row was made by
 * the API, it records the takeover in program_writes and returns true (the script prints the loud line). Files win (R3).
 */
export async function noteFileTakeover(id: string, db: postgres.Sql = sql()): Promise<boolean> {
  const [row] = await db<{ source: string }[]>`SELECT source FROM programs WHERE id = ${id}`;
  if (row?.source !== 'api') return false;
  await audit(db, { program_id: id, action: 'takeover', result: 'file', reason: `programs/${id}.json took over an api program` });
  return true;
}

