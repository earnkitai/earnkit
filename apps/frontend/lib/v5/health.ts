/**
 * The daily freshness walk: probes each listed program's source and submission links, hashes the
 * source page to spot a rewrite, counts failing days (two in a row marks it stale), and closes an
 * active program whose deadline passed. One probe is bounded to 5 s; a failure never stops the walk.
 */
import { createHash } from 'node:crypto';
import { sql } from './db';
import { ProgramFile, type Program } from './program-file';
import { upsertProgram } from './programs';
import {
  FETCH_TIMEOUT_MS,
  HttpStatusError,
  RedirectError,
  safeProbe,
  safeProbePage,
  visibleText,
  type Probe,
} from './safe-fetch';

export type Health = { source_ok: boolean; submit_ok: boolean; body_hash: string | null; changed: boolean };
export type HealthDeps = {
  probe?: Probe;
  /** The source page's HTML (default: a bounded safe fetch). */
  page?: (url: string) => Promise<string>;
  now: Date;
  /** The stored hash, when there is one. */
  prevHash?: string | null;
};

/** A bot wall or a sign-in still means the page exists. */
const WALLS = [401, 403, 429];
const FAIL_DAYS_STALE = 2;

const bounded = <T>(work: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
};

async function reachable(url: string, probe: Probe): Promise<boolean> {
  try {
    await bounded(probe(url));
    return true;
  } catch (err) {
    return err instanceof RedirectError || (err instanceof HttpStatusError && WALLS.includes(err.status));
  }
}

const hashOf = (html: string): string | null => {
  const text = visibleText(html).text.replace(/\s+/g, ' ').trim();
  return text ? createHash('sha256').update(text).digest('hex') : null;
};

export async function probeProgram(p: Program | { file: Program }, deps: HealthDeps): Promise<Health> {
  const file = 'file' in p ? p.file : p;
  const probe = deps.probe ?? safeProbe;
  const [source_ok, submit_ok] = await Promise.all([reachable(file.source_url, probe), reachable(file.submission_url, probe)]);
  let body_hash: string | null = null;
  if (source_ok) {
    try {
      body_hash = hashOf(await bounded((deps.page ?? safeProbePage)(file.source_url)));
    } catch {
      body_hash = null;
    }
  }
  const prev = deps.prevHash ?? null;
  return { source_ok, submit_ok, body_hash, changed: body_hash !== null && prev !== null && body_hash !== prev };
}

type Walked = {
  id: string;
  file: unknown;
  source: 'file' | 'api';
  stale_since: Date | null;
  checked_at: Date | null;
  body_hash: string | null;
  fail_days: number | null;
  was_failing: boolean | null;
};

const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/** Probes the listed (active and upcoming) programs, oldest check first, at most `limit`. */
export async function runHealth(
  deps: Omit<HealthDeps, 'prevHash'>,
  limit = 200,
): Promise<{ checked: number; stale: string[]; changed: string[]; closed: string[] }> {
  const { now } = deps;
  const db = sql();
  const rows = await db<Walked[]>`
    SELECT p.id, p.file, p.source, p.stale_since, h.checked_at, h.body_hash, h.fail_days,
           (NOT h.source_ok OR NOT h.submit_ok) AS was_failing
    FROM programs p LEFT JOIN program_health h ON h.program_id = p.id
    WHERE p.status IN ('active', 'upcoming')
    ORDER BY h.checked_at ASC NULLS FIRST, p.id
    LIMIT ${limit}`;
  const out = { checked: 0, stale: [] as string[], changed: [] as string[], closed: [] as string[] };
  for (const r of rows) {
    const parsed = ProgramFile.safeParse(r.file);
    if (!parsed.success) continue;
    const file = parsed.data;
    try {
      const h = await probeProgram(file, { ...deps, prevHash: r.body_hash });
      const failed = !h.source_ok || !h.submit_ok;
      const prevDays = r.fail_days ?? 0;
      const failDays = !failed ? 0 : r.checked_at && sameDay(r.checked_at, now) && r.was_failing ? prevDays : prevDays + 1;
      await db`
        INSERT INTO program_health (program_id, checked_at, source_ok, submit_ok, body_hash, changed_at, fail_days)
        VALUES (${r.id}, ${now}, ${h.source_ok}, ${h.submit_ok}, ${h.body_hash}, ${h.changed ? now : null}, ${failDays})
        ON CONFLICT (program_id) DO UPDATE SET
          checked_at = EXCLUDED.checked_at, source_ok = EXCLUDED.source_ok, submit_ok = EXCLUDED.submit_ok,
          body_hash = COALESCE(EXCLUDED.body_hash, program_health.body_hash),
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
      if (file.status === 'active' && file.ends_at !== null && Date.parse(file.ends_at) <= now.getTime()) {
        await upsertProgram({ ...file, status: 'closed' }, r.source, now);
        out.closed.push(r.id);
      }
    } catch (err) {
      // One program's trouble never stops the walk.
      console.error(`[health] ${r.id} failed: ${err instanceof Error ? err.name.replace(/[^\w]/g, '').slice(0, 40) : 'unknown'}`);
    }
  }
  return out;
}
