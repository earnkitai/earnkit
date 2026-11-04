/**
 * The daily freshness walk: probes each listed program's source and submission links, counts failing
 * days (two in a row marks it stale), and closes an active program whose deadline passed. A source
 * page sharing under 80% of its words with the stored text counts as changed: listed in the owner's
 * digest, never stale. One probe is bounded to 5 s; a failure never stops the walk.
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

export type Health = { source_ok: boolean; submit_ok: boolean; body_hash: string | null; body_text: string | null; changed: boolean };
export type HealthDeps = {
  probe?: Probe;
  /** The source page's HTML (default: a bounded safe fetch). */
  page?: (url: string) => Promise<string>;
  now: Date;
  /** The stored page text, when there is one. */
  prevText?: string | null;
};

/** A bot wall or a sign-in still means the page exists. */
const WALLS = [401, 403, 429];
const FAIL_DAYS_STALE = 2;
/** A page whose words are less than this share of the stored ones counts as changed. */
const SAME_WORDS = 0.8;
const MAX_TEXT = 65_536;

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

export async function probeProgram(p: Program | { file: Program }, deps: HealthDeps): Promise<Health> {
  const file = 'file' in p ? p.file : p;
  const probe = deps.probe ?? safeProbe;
  const [source_ok, submit_ok] = await Promise.all([reachable(file.source_url, probe), reachable(file.submission_url, probe)]);
  let body_text: string | null = null;
  if (source_ok) {
    try {
      body_text = textOf(await bounded((deps.page ?? safeProbePage)(file.source_url)));
    } catch {
      body_text = null;
    }
  }
  const prev = deps.prevText ?? null;
  return {
    source_ok, submit_ok, body_text,
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

/** Probes the listed (active and upcoming) programs, oldest check first, at most `limit`. */
export async function runHealth(
  deps: Omit<HealthDeps, 'prevText'>,
  limit = 200,
): Promise<{ checked: number; stale: string[]; changed: string[]; closed: string[] }> {
  const { now } = deps;
  const db = sql();
  const rows = await db<Walked[]>`
    SELECT p.id, p.file, p.source, p.stale_since, h.checked_at, h.body_text, h.fail_days,
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
      const h = await probeProgram(file, { ...deps, prevText: r.body_text });
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
