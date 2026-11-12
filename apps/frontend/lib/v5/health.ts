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
 * lists it with the failing links, and it is never stale. v6.1.19 (lane 44): the closed read covers the usual wordings,
 * on visible text only and without the program's own sentences, and reads the source page too (`closedRead`, L44-1,
 * L44-7, L44-19); a link redirected to another host is judged and read on the page it lands on, from its probe's
 * Location (L44-4, L44-15); a form whose landing could not be read is counted in `form_unread` (L44-16).
 */
import { createHash } from 'node:crypto';
import { sql } from './db';
import { ProgramFile, type Program } from './program-file';
import { dateStatus, upsertProgram } from './programs';
import { landingPage, probeLink, SafeFetchError, visibleText, type Landing, type ProbeResult, type Resolver, type Transport } from './safe-fetch';

/** One link's check (default: probeLink over the real resolver and transport). */
export type LinkCheck = (url: string, timeoutMs: number) => Promise<ProbeResult>;
export type Health = {
  source_ok: boolean; submit_ok: boolean; body_hash: string | null; body_text: string | null; changed: boolean;
  /** L39-5 (v6.1.18): the page the submission link lands on says it is closed; read directly, or after a redirect
   *  elsewhere by its own guarded read (`landingPage`, fix round 1). v6.1.19 (L44-19): or the source page says it, when it
   *  is another link (`closed_on` says which). Never changes `submit_ok`. */
  submit_closed: boolean;
  /** v6.1.19 (L44-7): only a round or a region is closed and the page says something is open (`closedRead`). */
  closed_round: boolean;
  /** Which page said it: the form or the source page; null when neither. */
  closed_on: 'form' | 'source' | null;
  /** v6.1.19 (L44-16): the form redirects elsewhere and its landing could not be read (refused or unfinished). */
  form_unread: boolean;
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
  /** v6.1.18 fix round 1 (L39-5), v6.1.19 (L44-4): reads the page a link redirected elsewhere lands on, from the
   *  probe's Location and its `hops` (tests); else landingPage with `resolve` and `transport`, or none when only `link`
   *  is injected. */
  landing?: (url: string, timeoutMs: number, hops: number) => Promise<Landing | null>;
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

/**
 * L39-5 (v6.1.18), v6.1.19 (L44-1): the phrases a closed page says, in any case: `applications are (now) closed`, `this
 * form is closed`, `submissions are closed`, `registration is closed`, `the call for proposals is closed`, `applications
 * closed`, `applications for Cohort 6 have closed`, `not accepting submissions`, `no longer accepting`, `the application
 * period has ended`, `closed for submissions`, `is now closed`.
 */
const CLOSED_FORM = new RegExp([
  String.raw`\b(applications?|submissions?|registrations?|entries|nominations|this form|the form|the call\b[^.]{0,40}?)\s+(are|is|have|has)\s+(now\s+)?(been\s+)?closed\b`,
  String.raw`\bapplications closed\b`,
  String.raw`\bapplications for\b[^.]{0,60}?\b(have|has)\s+(now\s+)?(been\s+)?closed\b`,
  String.raw`\bnot accepting (responses|submissions|applications|entries)\b`,
  String.raw`\bno longer accepting\b`,
  String.raw`\bapplication period has ended\b`,
  String.raw`\bclosed for submissions\b`,
  String.raw`\bis now closed\b`,
].join('|'), 'i');
/** v6.1.19 (L44-7): a closed sentence that names a round or a region closes only part of the program. */
const PART = /\b(round|cohort|batch|season|wave|phase|edition|intake|cycle)\b|\boutside\b|\bregions?\b|\bcountr(y|ies)\b|\b(eu|eea|uk)\b/i;
/** v6.1.19 (L44-7): the page says something is open. */
const OPEN_NOW = /\b(is|are) (now )?open\b|\bnow open\b|\bapply now\b/i;

/** Whether a page's text says it takes no more entries (L39-5, L44-1). Pure. */
export const formSaysClosed = (text: string): boolean => CLOSED_FORM.test(text.replace(/\s+/g, ' '));

/** The page's own words, lowercased with whitespace folded, cut into sentences. Pure. */
const sentencesOf = (text: string): string[] => text.replace(/\s+/g, ' ').trim().toLowerCase().split(/(?<=[.!?])\s+/).filter(Boolean);

/**
 * v6.1.19 (L44-1, L44-7): what a page says about taking entries: `closed`, `round` (every closed sentence names a round
 * or a region and the page also says something is open), or null. Read on visible text only (hidden elements dropped),
 * with the program's own sentences (`own`: its description and rules) taken out first, so the catalog's words never
 * count. Pure.
 */
export function closedRead(html: string, own: string[] = []): 'closed' | 'round' | null {
  let text = visibleText(html, { dropHidden: true }).text.replace(/\s+/g, ' ').toLowerCase();
  for (const line of own) for (const s of sentencesOf(line)) if (s.length >= 12) text = text.split(s).join(' ');
  const hits = sentencesOf(text).filter((s) => CLOSED_FORM.test(s));
  if (hits.length === 0) return null;
  return hits.every((s) => PART.test(s)) && OPEN_NOW.test(text) ? 'round' : 'closed';
}

/** True when fewer than 80% of the words (deduplicated) are shared, out of the larger page's words. Pure. */
export function pageChanged(prev: string, next: string): boolean {
  const a = new Set(prev.split(' ').filter(Boolean));
  const b = new Set(next.split(' ').filter(Boolean));
  let shared = 0;
  for (const w of b) if (a.has(w)) shared++;
  return shared < SAME_WORDS * Math.max(a.size, b.size);
}

/**
 * The page a redirected link lands on (v6.1.19 L44-4, L44-15): read from the Location its probe saw, bounded to one
 * link's time. undefined when there is no reader (only `link` injected); null when the landing could not be read.
 */
async function landed(url: string, hops: number, deps: HealthDeps): Promise<Landing | null | undefined> {
  const ms = deps.probeMs ?? PROBE_MS;
  const read = deps.landing ?? (deps.link ? null : (u: string, t: number, h: number) => landingPage(u, { resolve: deps.resolve, transport: deps.transport, timeoutMs: t, hops: h }));
  if (!read) return undefined;
  try {
    return await bounded(read(url, ms, hops), ms);
  } catch {
    return null;
  }
}

/** One link as the walk judges it: up or down, the HTML it shows (null when none was read), and a landing not read. */
type Read = { ok: boolean; html: string | null; unread: boolean };

/**
 * A link's answer, judged on its landing page when it redirects to another host (v6.1.19 L44-4): a landing that is a
 * 4xx, 5xx, an error page or a name that does not resolve is down, as a direct link is; a landing the guarded read
 * refuses or cannot finish leaves the link up, unread (L44-16).
 */
async function judged(r: ProbeResult, url: string, deps: HealthDeps): Promise<Read> {
  if (!r.ok) return { ok: false, html: null, unread: false };
  if (!r.redirect) return { ok: true, html: r.page || null, unread: false };
  const land = await landed(r.location ?? url, r.location ? (r.hops ?? 1) : 0, deps);
  if (land === undefined) return { ok: true, html: null, unread: false };
  if (land === null) return { ok: true, html: null, unread: true };
  return land.ok ? { ok: true, html: land.page || null, unread: false } : { ok: false, html: null, unread: false };
}

/**
 * Probes the source and submission links, one GET each (one for both when they are the same link); the source's page is
 * that GET's. v6.1.19 (L44-4, L44-15): a link that redirects to another host is judged and read on the page it lands on,
 * from the probe's Location, so no hop is fetched twice. The closed read (L44-1, L44-7, L44-19): the form's page first,
 * then the source page when it is another link; a form that says it is closed outranks a source page that does, and
 * either outranks one round closed.
 */
export async function probeProgram(p: Program | { file: Program }, deps: HealthDeps): Promise<Health> {
  const file = 'file' in p ? p.file : p;
  const same = file.source_url === file.submission_url;
  const [source, submit] = await Promise.all([check(file.source_url, deps), same ? null : check(file.submission_url, deps)]);
  const [src, sub] = await Promise.all([
    judged(source, file.source_url, deps),
    submit ? judged(submit, file.submission_url, deps) : null,
  ]);
  const form = sub ?? src;
  const body_text = src.html !== null ? textOf(src.html) : null;
  const own = [file.description, ...file.rules];
  const onForm = form.html !== null ? closedRead(form.html, own) : null;
  const onPage = sub && src.html !== null ? closedRead(src.html, own) : null;
  const closed = onForm === 'closed' ? { kind: 'closed', on: 'form' } as const
    : onPage === 'closed' ? { kind: 'closed', on: 'source' } as const
    : onForm === 'round' ? { kind: 'round', on: 'form' } as const
    : onPage === 'round' ? { kind: 'round', on: 'source' } as const : null;
  const prev = deps.prevText ?? null;
  const redirects = [...new Set([source, submit ?? source].flatMap((r) => (r.ok && r.redirect ? [r.redirect] : [])))];
  return {
    source_ok: src.ok, submit_ok: form.ok, body_text, redirects,
    submit_closed: closed?.kind === 'closed', closed_round: closed?.kind === 'round', closed_on: closed?.on ?? null,
    form_unread: form.unread,
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
  /** v6.1.19 (L44-16): programs whose form redirects to a page the guarded read could not read. */
  form_unread: string[];
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
  const out: HealthRun = { checked: 0, stale: [], changed: [], closed: [], opened: [], unreadable: [], failed: [], form_unread: [] };
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
        // L44-16: a form whose landing page the guarded read refused or could not finish is named in the log and counted.
        if (h.form_unread) {
          console.log(`[health] ${r.id} form not read past its redirect`);
          out.form_unread.push(r.id);
        }
        const failed = !h.source_ok || !h.submit_ok;
        const prevDays = r.fail_days ?? 0;
        // fail_days stays a count of UTC dates for the owner's eye; staleness reads first_failed_at (L30-9).
        const failDays = !failed ? 0 : r.checked_at && sameDay(r.checked_at, now) && r.was_failing ? prevDays : prevDays + 1;
        // A failing check keeps the stored start of the failures (or starts it now); a clean one clears it.
        const [w] = await db<{ first_failed_at: Date | null }[]>`
          INSERT INTO program_health (program_id, checked_at, source_ok, submit_ok, body_hash, body_text, changed_at, fail_days, first_failed_at, submit_closed, closed_round, closed_on, closed_since)
          VALUES (${r.id}, ${now}, ${h.source_ok}, ${h.submit_ok}, ${h.body_hash}, ${h.body_text}, ${h.changed ? now : null}, ${failDays}, ${failed ? now : null}, ${h.submit_closed},
            ${h.closed_round}, ${h.closed_on}, ${h.submit_closed || h.closed_round ? now : null})
          ON CONFLICT (program_id) DO UPDATE SET
            checked_at = EXCLUDED.checked_at, source_ok = EXCLUDED.source_ok, submit_ok = EXCLUDED.submit_ok, submit_closed = EXCLUDED.submit_closed,
            closed_round = EXCLUDED.closed_round, closed_on = EXCLUDED.closed_on,
            closed_since = CASE WHEN program_health.submit_closed = EXCLUDED.submit_closed AND program_health.closed_round = EXCLUDED.closed_round
              AND program_health.closed_on IS NOT DISTINCT FROM EXCLUDED.closed_on THEN COALESCE(program_health.closed_since, EXCLUDED.closed_since) ELSE EXCLUDED.closed_since END,
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
  for (const k of ['stale', 'changed', 'closed', 'opened', 'form_unread'] as const) out[k].sort();
  out.unreadable.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
