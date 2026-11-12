/**
 * The daily freshness walk: probes each listed program's source and submission links, 10 programs at once (up to 20
 * links, PROBE_PARALLEL) and PROBE_MS each; a program whose links have failed for STALE_AFTER_MS (20 hours, from
 * `first_failed_at`, v6.1.17 L30-9) is stale; and moves a program's status by its dates: an upcoming one opens at
 * starts_at, an active or upcoming one closes at ends_at (v6.1.16 Task 16, L30-1). A source page sharing under 80% of
 * its words with the stored text counts as changed: listed in the owner's digest, never stale. A redirect to another
 * host is alive and logged (L30-2). One program's failure never stops the walk; it is returned in `failed`. A row whose
 * file no longer parses, or an upcoming program at its start with no form, is `unreadable` (v6.1.17 L30-18, L35-18):
 * counted and named in the owner's digest with its fix, never a failure that turns every run red. v6.1.18 (L39-5): a
 * submission page that answers but says it is closed (`formSaysClosed`) is stored as `submit_closed`; the owner's digest
 * lists it with the failing links, and it is never stale.
 */
import { createHash } from 'node:crypto';
import { sql } from './db';
import { ProgramFile, type Program } from './program-file';
import { dateStatus, upsertProgram } from './programs';
import { landingPage, probeLink, SafeFetchError, visibleText, type ProbeResult, type Resolver, type Transport } from './safe-fetch';

/** One link's check (default: probeLink over the real resolver and transport). */
export type LinkCheck = (url: string, timeoutMs: number) => Promise<ProbeResult>;
export type Health = {
  source_ok: boolean; submit_ok: boolean; body_hash: string | null; body_text: string | null; changed: boolean;
  /** L39-5 (v6.1.18): the page the submission link lands on says it is closed (`formSaysClosed`); read directly, or
   *  after a redirect elsewhere by its own guarded read (`landingPage`, fix round 1). Never changes `submit_ok`. */
  submit_closed: boolean;
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
  /** v6.1.18 fix round 1 (L39-5): reads the page a link finally lands on, for the closed-form check only (tests);
   *  else landingPage with `resolve` and `transport`, or none when only `link` is injected. */
  landing?: (url: string, timeoutMs: number) => Promise<string | null>;
};
export type Failed = { id: string | null; step: string; error: ErrorCode };

/** v6.1.16 Task 16: 8 s per link, 10 programs at once. */
export const PROBE_MS = 8_000;
export const PROBE_PARALLEL = 10;
/** v6.1.17 Task 3 (L30-9): a link failing this long (from its first failure) is stale; two runs a minute apart never are. */
export const STALE_AFTER_MS = 20 * 3_600_000;
/** A page whose words are less than this share of the stored ones counts as changed. */
const SAME_WORDS = 0.8;
const MAX_TEXT = 65_536;

/**
 * The run's error codes (controller ruling, v6.1.16 Task 16): the JSON and the Actions log carry only these. `catalog`:
 * a program whose moved file the schema refuses. v6.1.17 Task 3: `parse` is gone; a stored row that no longer parses,
 * like an upcoming program with no form, is `unreadable`, never a failure.
 */
export type ErrorCode = 'db' | 'fetch' | 'timeout' | 'budget' | 'catalog' | 'error';

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

/** L39-5 (v6.1.18): the phrases a closed submission page says, in any case. */
const CLOSED_FORM = /\bis now closed\b|\bapplications are closed\b|\bno longer accepting\b|\bclosed for submissions\b/i;
/** Whether a submission page's text says it takes no more entries (L39-5). Pure. */
export const formSaysClosed = (text: string): boolean => CLOSED_FORM.test(text.replace(/\s+/g, ' '));

/** True when fewer than 80% of the words (deduplicated) are shared, out of the larger page's words. Pure. */
export function pageChanged(prev: string, next: string): boolean {
  const a = new Set(prev.split(' ').filter(Boolean));
  const b = new Set(next.split(' ').filter(Boolean));
  let shared = 0;
  for (const w of b) if (a.has(w)) shared++;
  return shared < SAME_WORDS * Math.max(a.size, b.size);
}

/** The visible text of the page `url` lands on, bounded to one link's time; null when unread. */
async function landedText(url: string, deps: HealthDeps): Promise<string | null> {
  const ms = deps.probeMs ?? PROBE_MS;
  const read = deps.landing ?? (deps.link ? null : (u: string, t: number) => landingPage(u, { resolve: deps.resolve, transport: deps.transport, timeoutMs: t }));
  if (!read) return null;
  try {
    const page = await bounded(read(url, ms), ms);
    return page ? textOf(page) : null;
  } catch {
    return null;
  }
}

/** Probes the source and submission links, one GET each (one for both when they are the same link); the source's page is that GET's. */
export async function probeProgram(p: Program | { file: Program }, deps: HealthDeps): Promise<Health> {
  const file = 'file' in p ? p.file : p;
  const same = file.source_url === file.submission_url;
  const [source, submit] = await Promise.all([check(file.source_url, deps), same ? null : check(file.submission_url, deps)]);
  const sub = submit ?? source;
  const body_text = source.ok && source.page ? textOf(source.page) : null;
  // L39-5: a form that answers but says it is closed. A redirect to another host is followed by its own read (fix
  // round 1: forms.gle to docs.google.com), never by the link check, so the status and `redirects` stay as they were.
  const submit_text = sub.ok && sub.page ? (sub === source ? body_text : textOf(sub.page))
    : sub.ok && sub.redirect ? await landedText(file.submission_url, deps) : null;
  const prev = deps.prevText ?? null;
  const redirects = [...new Set([source, sub].flatMap((r) => (r.ok && r.redirect ? [r.redirect] : [])))];
  return {
    source_ok: source.ok, submit_ok: sub.ok, body_text, redirects, submit_closed: submit_text !== null && formSaysClosed(submit_text),
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

/** The status a program's dates call for at `now` (L30-1): one rule with `isOpenAt` (programs.ts, Task 9). */
export { dateStatus };

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

/**
 * v6.1.17 Task 3 (L30-18, L35-18): a program the walk could not read, with the owner's fix (the digest's
 * `{id}: {fix}` line): owner text, a sentence, no field or file names.
 */
export type Unreadable = { id: string; fix: string };
export const UNREADABLE_FIX = {
  parse: 'its saved entry no longer reads, so it is not checked; correct the entry.',
  noForm: 'its start date passed but it has no form questions, so it stays upcoming; add them.',
} as const;

export type HealthRun = {
  checked: number; stale: string[]; changed: string[]; closed: string[]; opened: string[]; unreadable: Unreadable[]; failed: Failed[];
};

/**
 * Walks the listed (active and upcoming) programs, oldest check first, at most `limit`, PROBE_PARALLEL at once. Once a
 * probe could not finish before `deadline` (epoch ms, read on `clock`) no new probe starts, but every row's dates are still applied. Each program's
 * probe and health write is one try and its status move another, so a refused write never blocks its close; each
 * failure is in `failed` with the program's id, and each row the owner must fix in `unreadable`.
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
  const out: HealthRun = { checked: 0, stale: [], changed: [], closed: [], opened: [], unreadable: [], failed: [] };
  // The full reason goes to the server log only; the run's answer carries the code.
  const fail = (id: string, err: unknown, code?: ErrorCode) => {
    console.error(`[health] ${id} failed: ${typeof err === 'string' ? err : errorWords(err)}`);
    out.failed.push({ id, step: 'health', error: code ?? errorCode(err) });
  };
  /** The owner's to fix in the file: counted and named in the digest, never in `failed`; the reason in the log too. */
  const unreadable = (id: string, why: string, fix: string) => {
    console.error(`[health] ${id} unreadable: ${why}`);
    out.unreadable.push({ id, fix });
  };

  const walk = async (r: Walked): Promise<void> => {
    const parsed = ProgramFile.safeParse(r.file);
    if (!parsed.success) return unreadable(r.id, 'the program file does not parse', UNREADABLE_FIX.parse);
    const file = parsed.data;
    // A probe starts only when it can finish before the deadline.
    if (deadline === undefined || clock() + (probeDeps.probeMs ?? PROBE_MS) <= deadline) {
      try {
        const h = await probeProgram(file, { ...probeDeps, now, prevText: r.body_text });
        for (const host of h.redirects) console.log(`[health] ${r.id} redirects to ${host}`);
        const failed = !h.source_ok || !h.submit_ok;
        const prevDays = r.fail_days ?? 0;
        // fail_days stays a count of UTC dates for the owner's eye; staleness reads first_failed_at (L30-9).
        const failDays = !failed ? 0 : r.checked_at && sameDay(r.checked_at, now) && r.was_failing ? prevDays : prevDays + 1;
        // A failing check keeps the stored start of the failures (or starts it now); a clean one clears it.
        const [w] = await db<{ first_failed_at: Date | null }[]>`
          INSERT INTO program_health (program_id, checked_at, source_ok, submit_ok, body_hash, body_text, changed_at, fail_days, first_failed_at, submit_closed)
          VALUES (${r.id}, ${now}, ${h.source_ok}, ${h.submit_ok}, ${h.body_hash}, ${h.body_text}, ${h.changed ? now : null}, ${failDays}, ${failed ? now : null}, ${h.submit_closed})
          ON CONFLICT (program_id) DO UPDATE SET
            checked_at = EXCLUDED.checked_at, source_ok = EXCLUDED.source_ok, submit_ok = EXCLUDED.submit_ok, submit_closed = EXCLUDED.submit_closed,
            body_hash = COALESCE(EXCLUDED.body_hash, program_health.body_hash),
            body_text = COALESCE(EXCLUDED.body_text, program_health.body_text),
            changed_at = CASE WHEN ${h.changed} THEN EXCLUDED.changed_at ELSE program_health.changed_at END,
            fail_days = EXCLUDED.fail_days,
            first_failed_at = CASE WHEN ${failed} THEN LEAST(COALESCE(program_health.first_failed_at, EXCLUDED.first_failed_at), EXCLUDED.first_failed_at) END
          RETURNING first_failed_at`;
        if (h.changed) out.changed.push(r.id);
        if (failed && w?.first_failed_at && now.getTime() - w.first_failed_at.getTime() >= STALE_AFTER_MS) {
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
    if ('blocked' in move) return unreadable(r.id, 'opens today but has no submission requirements', UNREADABLE_FIX.noForm);
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
  out.unreadable.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
