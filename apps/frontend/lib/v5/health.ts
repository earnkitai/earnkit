/**
 * The daily freshness walk: probes each listed program's source and submission links (PROBE_PARALLEL at once, PROBE_MS
 * each), counts failing days (two in a row marks it stale), and moves a program's status by its dates: an upcoming one
 * opens at starts_at, an active or upcoming one closes at ends_at (v6.1.16 Task 16, L30-1). A source page sharing under
 * 80% of its words with the stored text counts as changed: listed in the owner's digest, never stale. A redirect to
 * another host is alive and logged (L30-2). One program's failure never stops the walk; it is returned in `failed`.
 */
import { createHash } from 'node:crypto';
import { sql } from './db';
import { ProgramFile, type Program } from './program-file';
import { upsertProgram } from './programs';
import { probeLink, SafeFetchError, visibleText, type ProbeResult, type Resolver, type Transport } from './safe-fetch';

/** One link's check (default: probeLink over the real resolver and transport). */
export type LinkCheck = (url: string, timeoutMs: number) => Promise<ProbeResult>;
export type Health = {
  source_ok: boolean; submit_ok: boolean; body_hash: string | null; body_text: string | null; changed: boolean;
  /** The other hosts the links redirected to (never requested). */
  redirects: string[];
};
export type HealthDeps = {
  /** Replaces the link check (tests); else probeLink with `resolve` and `transport`. */
  link?: LinkCheck;
  resolve?: Resolver;
  transport?: Transport;
  now: Date;
  /** The stored page text, when there is one. */
  prevText?: string | null;
  /** Per link (default PROBE_MS). */
  probeMs?: number;
};
export type Failed = { id: string | null; step: string; error: ErrorCode };

/** v6.1.16 Task 16: 8 s per link, 10 programs at once. */
export const PROBE_MS = 8_000;
export const PROBE_PARALLEL = 10;
const FAIL_DAYS_STALE = 2;
/** A page whose words are less than this share of the stored ones counts as changed. */
const SAME_WORDS = 0.8;
const MAX_TEXT = 65_536;

/** The run's error codes (controller ruling, v6.1.16 Task 16): the JSON and the Actions log carry only these. */
/**
 * `catalog`: a program that cannot open or close because its file lacks what the schema needs; `parse`: a stored row
 * whose file no longer parses.
 */
export type ErrorCode = 'db' | 'fetch' | 'timeout' | 'budget' | 'catalog' | 'parse' | 'error';

/** The full error for the server log only: its name and a short message, a URL's query cut, no stack. Pure. */
export function errorWords(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';
  const name = err.name.replace(/[^\w]/g, '').slice(0, 40) || 'Error';
  const msg = err.message.replace(/https?:\/\/\S+/g, (u) => u.replace(/[?#].*$/, '')).replace(/\s+/g, ' ').trim().slice(0, 120);
  return msg ? `${name}: ${msg}` : name;
}

/** An error's code by its class, never its message (which can hold a connection string or an address). Pure. */
export function errorCode(err: unknown): ErrorCode {
  if (!(err instanceof Error)) return 'error';
  const code = String((err as { code?: unknown }).code ?? '');
  if (err.name === 'PostgresError' || /^CONNECT(ION)?_/.test(code)) return 'db';
  if (err.name === 'TimeoutError' || err.name === 'AbortError' || /^(timeout|no answer within)/.test(err.message)) return 'timeout';
  if (err instanceof SafeFetchError || err.name === 'MailError' || (err instanceof TypeError && err.message === 'fetch failed')) return 'fetch';
  return 'error';
}

const bounded = <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
};

/** One link, bounded to `ms` whatever the check does; a check that throws or hangs is dead. */
async function check(url: string, deps: HealthDeps): Promise<ProbeResult> {
  const ms = deps.probeMs ?? PROBE_MS;
  const link: LinkCheck = deps.link ?? ((u, t) => probeLink(u, { resolve: deps.resolve, transport: deps.transport, timeoutMs: t }));
  try {
    return await bounded(link(url, ms), ms);
  } catch (err) {
    return { ok: false, why: err instanceof Error && err.message === 'timeout' ? 'timeout' : 'refused' };
  }
}

/** The page's visible text, lowercased and whitespace-collapsed, up to 64 KB; null when empty. */
const textOf = (html: string): string | null => {
  const text = visibleText(html).text.replace(/\s+/g, ' ').trim().toLowerCase();
  return text ? text.slice(0, MAX_TEXT) : null;
};
const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

/** True when fewer than 80% of the words (deduplicated) are shared, out of the larger page's words. Pure. */
export function pageChanged(prev: string, next: string): boolean {
  const a = new Set(prev.split(' ').filter(Boolean));
  const b = new Set(next.split(' ').filter(Boolean));
  let shared = 0;
  for (const w of b) if (a.has(w)) shared++;
  return shared < SAME_WORDS * Math.max(a.size, b.size);
}

/** Probes the source and submission links, one GET each (one for both when they are the same link); the source's page is that GET's. */
export async function probeProgram(p: Program | { file: Program }, deps: HealthDeps): Promise<Health> {
  const file = 'file' in p ? p.file : p;
  const same = file.source_url === file.submission_url;
  const [source, submit] = await Promise.all([check(file.source_url, deps), same ? null : check(file.submission_url, deps)]);
  const sub = submit ?? source;
  const body_text = source.ok && source.page ? textOf(source.page) : null;
  const prev = deps.prevText ?? null;
  const redirects = [...new Set([source, sub].flatMap((r) => (r.ok && r.redirect ? [r.redirect] : [])))];
  return {
    source_ok: source.ok, submit_ok: sub.ok, body_text, redirects,
    body_hash: body_text === null ? null : hashOf(body_text),
    changed: body_text !== null && prev !== null && pageChanged(prev, body_text),
  };
}

type Walked = {
  id: string;
  file: unknown;
  source: 'file' | 'api';
  stale_since: Date | null;
  checked_at: Date | null;
  body_text: string | null;
  fail_days: number | null;
  was_failing: boolean | null;
};

const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/**
 * The status a program's dates call for at `now` (L30-1), or null when it stays: an active or upcoming program whose
 * ends_at passed closes; an upcoming one whose starts_at came opens. Pure.
 */
export function dateStatus(file: Pick<Program, 'status' | 'starts_at' | 'ends_at'>, now: Date): 'active' | 'closed' | null {
  const t = now.getTime();
  if (file.status === 'closed') return null;
  if (file.ends_at !== null && Date.parse(file.ends_at) <= t) return 'closed';
  if (file.status === 'upcoming' && file.starts_at !== null && Date.parse(file.starts_at) <= t) return 'active';
  return null;
}

/**
 * The file as its dates call for it at `now` (L30-1), shared by the daily run and the deploy's sync (fix round 1, I1),
 * so a deploy never writes a program back against its dates: `moved` (an upcoming program's opens_note dropped),
 * `blocked` (an upcoming program at its start with no submission requirements: it stays until its file has them), or
 * null when it stays. Pure.
 */
export function movedByDate(file: Program, now: Date): { to: 'active' | 'closed'; file: Program } | { blocked: true } | null {
  const to = dateStatus(file, now);
  if (!to) return null;
  if (to === 'active' && file.submission_requirements.length === 0) return { blocked: true };
  const { opens_note: _note, ...rest } = file;
  return { to, file: { ...rest, status: to } as Program };
}

export type HealthRun = { checked: number; stale: string[]; changed: string[]; closed: string[]; opened: string[]; failed: Failed[] };

/**
 * Walks the listed (active and upcoming) programs, oldest check first, at most `limit`, PROBE_PARALLEL at once. Once a
 * probe could not finish before `deadline` (epoch ms, read on `clock`) no new probe starts, but every row's dates are still applied. Each program's
 * probe and health write is one try and its status move another, so a refused write never blocks its close; each
 * failure is in `failed` with the program's id.
 */
export async function runHealth(
  now: Date,
  deps: Omit<HealthDeps, 'prevText' | 'now'> & { limit?: number; deadline?: number; clock?: () => number; parallel?: number } = {},
): Promise<HealthRun> {
  const { limit = 200, deadline, clock = Date.now, parallel = PROBE_PARALLEL, ...probeDeps } = deps;
  const db = sql();
  const rows = await db<Walked[]>`
    SELECT p.id, p.file, p.source, p.stale_since, h.checked_at, h.body_text, h.fail_days,
           (NOT h.source_ok OR NOT h.submit_ok) AS was_failing
    FROM programs p LEFT JOIN program_health h ON h.program_id = p.id
    WHERE p.status IN ('active', 'upcoming')
    ORDER BY h.checked_at ASC NULLS FIRST, p.id
    LIMIT ${limit}`;
  const out: HealthRun = { checked: 0, stale: [], changed: [], closed: [], opened: [], failed: [] };
  // The full reason goes to the server log only; the run's answer carries the code.
  const fail = (id: string, err: unknown, code?: ErrorCode) => {
    console.error(`[health] ${id} failed: ${typeof err === 'string' ? err : errorWords(err)}`);
    out.failed.push({ id, step: 'health', error: code ?? errorCode(err) });
  };

  const walk = async (r: Walked): Promise<void> => {
    const parsed = ProgramFile.safeParse(r.file);
    if (!parsed.success) return fail(r.id, 'the program file does not parse', 'parse');
    const file = parsed.data;
    // A probe starts only when it can finish before the deadline.
    if (deadline === undefined || clock() + (probeDeps.probeMs ?? PROBE_MS) <= deadline) {
      try {
        const h = await probeProgram(file, { ...probeDeps, now, prevText: r.body_text });
        for (const host of h.redirects) console.log(`[health] ${r.id} redirects to ${host}`);
        const failed = !h.source_ok || !h.submit_ok;
        const prevDays = r.fail_days ?? 0;
        const failDays = !failed ? 0 : r.checked_at && sameDay(r.checked_at, now) && r.was_failing ? prevDays : prevDays + 1;
        await db`
          INSERT INTO program_health (program_id, checked_at, source_ok, submit_ok, body_hash, body_text, changed_at, fail_days)
          VALUES (${r.id}, ${now}, ${h.source_ok}, ${h.submit_ok}, ${h.body_hash}, ${h.body_text}, ${h.changed ? now : null}, ${failDays})
          ON CONFLICT (program_id) DO UPDATE SET
            checked_at = EXCLUDED.checked_at, source_ok = EXCLUDED.source_ok, submit_ok = EXCLUDED.submit_ok,
            body_hash = COALESCE(EXCLUDED.body_hash, program_health.body_hash),
            body_text = COALESCE(EXCLUDED.body_text, program_health.body_text),
            changed_at = CASE WHEN ${h.changed} THEN EXCLUDED.changed_at ELSE program_health.changed_at END,
            fail_days = EXCLUDED.fail_days`;
        if (h.changed) out.changed.push(r.id);
        if (failDays >= FAIL_DAYS_STALE) {
          out.stale.push(r.id);
          await db`UPDATE programs SET stale_since = ${now} WHERE id = ${r.id} AND stale_since IS NULL`;
        } else if (!failed && r.stale_since) {
          await db`UPDATE programs SET stale_since = NULL WHERE id = ${r.id}`;
        }
        out.checked += 1;
      } catch (err) {
        fail(r.id, err);
      }
    }
    const move = movedByDate(file, now);
    if (!move) return;
    // L30-1: an upcoming program opens only with its requirements in the file; until then it stays and the owner hears.
    if ('blocked' in move) return fail(r.id, 'opens today but has no submission requirements', 'catalog');
    try {
      await upsertProgram(move.file, r.source, now);
      (move.to === 'closed' ? out.closed : out.opened).push(r.id);
    } catch (err) {
      // The schema refusing the moved file is the catalog's to fix.
      fail(r.id, err, err instanceof Error && err.name === 'ZodError' ? 'catalog' : undefined);
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < rows.length) await walk(rows[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, rows.length)) }, worker));
  for (const k of ['stale', 'changed', 'closed', 'opened'] as const) out[k].sort();
  return out;
}
