/**
 * The screen queue's worker: reads queued applicants (one job on a trigger, else the oldest first) one at a time on
 * one GitHub budget, as the pilot does (a repo resolved from the site when none was given), places each
 * with the job's thresholds and the counts, and stores the public rows. A failed read is `failed` with a
 * one-line error; the job advances either way and is finished when every applicant is.
 */
import { sql } from '../v5/db';
import { repoKey } from '../v5/repo-facts';
import { resolveRepo, sharedContributors } from './applicants';
import type { Budget } from './code';
import { type Evidence, type EvidenceDeps, flattenRows, readEvidence, retryable, type Row, type Subject } from './evidence';
import { PUBLIC_BASES, UNREAD, xpCounts } from './screen-jobs';
import { reviewerLine } from './tier-words';
import { DEFAULT_THRESHOLDS, place, type Thresholds } from './tiers';

/** The daily cron's share of the queue (v6.1.7 B14: 200; SCREEN_DAILY_MS still bounds the run). The screen promise counts on it. */
export const SCREEN_BATCH = 200;
/** An owner-triggered run: at most this many applicants, within SCREEN_TRIGGER_MS. */
export const SCREEN_TRIGGER_MAX = 300;
export const SCREEN_TRIGGER_MS = 600_000;
/** The daily run's share of time: the workflow's curl allows 540 s for the whole run (probe, sweep, queue, digest). */
export const SCREEN_DAILY_MS = 300_000;
/** A taken applicant not written in this long belongs to a run that died: it is free again. */
const TAKEN_MS = 30 * 60_000;
/** A read worth a retry goes back to the queue; the third such read is final. */
const MAX_ATTEMPTS = 3;
/** Budget stops are not the applicant's fault, so they get a higher cap before the row is given up. */
const MAX_BUDGET_STOPS = 10;

export type WorkDeps = Partial<EvidenceDeps> & { evidence?: (s: Subject, d: EvidenceDeps) => Promise<Evidence> };
type Queued = {
  job_id: string; ref: string; name: string; repo_url: string | null; live_url: string | null;
  contracts: { chain: string; address: string }[]; identical_pitch: number; thresholds: Record<string, unknown> | null;
};

/** The job's thresholds over the defaults: known keys with finite numbers only. Pure. */
function thresholdsOf(given: Record<string, unknown> | null): Thresholds {
  const t: Thresholds = { ...DEFAULT_THRESHOLDS };
  for (const [k, v] of Object.entries(given ?? {})) {
    if (Object.hasOwn(DEFAULT_THRESHOLDS, k) && typeof v === 'number' && Number.isFinite(v)) t[k as keyof Thresholds] = v;
  }
  return t;
}
const loginsOf = (rows: Row[] | null): string[] => {
  const v = rows?.find((r) => r.key === 'team.logins')?.value;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);
/** Every note of a read: the run's and each row's. Pure. */
const notesOf = (e: Evidence): string[] => [...e.notes, ...flattenRows(e).map((r) => r.note ?? '')].filter(Boolean);

/** Reads one applicant: the subject, then again with the repo the site links when none was given. */
async function readOne(a: Queued, read: (s: Subject, d: EvidenceDeps) => Promise<Evidence>, d: EvidenceDeps): Promise<{ e: Evidence; repo: string | null }> {
  const subject: Subject = { ...(a.repo_url && { repo_url: a.repo_url }), ...(a.live_url && { live_url: a.live_url }), contracts: a.contracts };
  let e = await read(subject, d);
  let repo = a.repo_url;
  if (!repo && e.live.github_links.length) {
    repo = resolveRepo({ ref: a.ref, name: a.name, repo_url: null, live_url: a.live_url, contracts: a.contracts, pitch: null, problems: [] }, e.live);
    if (repo) e = await read({ ...subject, repo_url: repo }, d);
  }
  return { e, repo };
}

/** Counts the job's read applicants; finishes it when they are all read. True when this call finished it. */
async function advance(jobId: string, now: Date): Promise<boolean> {
  await sql()`UPDATE screen_jobs SET done = (SELECT count(*) FROM screen_applicants WHERE job_id = ${jobId} AND status <> ALL(${UNREAD})) WHERE id = ${jobId}`;
  const fin = await sql()`UPDATE screen_jobs SET finished_at = ${now} WHERE id = ${jobId} AND finished_at IS NULL AND done >= total RETURNING id`;
  return fin.length > 0;
}

/**
 * Works up to `limit` queued applicants of unexpired jobs, oldest job first, or only `jobId`'s; each is
 * taken ('reading') before it is read, so overlapping runs never read one twice. A GitHub budget stop puts
 * the applicant back and ends the call; a null tier worth a retry is queued again, final at the third.
 * `deadline` (epoch ms) is checked between applicants. Never throws for an applicant's read.
 */
export async function workQueue(o: { now: Date; limit: number; jobId?: string; deadline?: number; deps?: WorkDeps }): Promise<{ read: number; jobs_finished: string[] }> {
  const { evidence: read = readEvidence, ...rest } = o.deps ?? {};
  // One allowance for the call: once it stops, later repos wait (their copies under 7 days stand).
  const budget: Budget = rest.budget ?? { remaining: null, stopped: false };
  const d: EvidenceDeps = { ...rest, budget, now: o.now };
  const only = o.jobId !== undefined ? sql()`AND a.job_id = ${o.jobId}` : sql()``;
  const stale = new Date(o.now.getTime() - TAKEN_MS);
  const free = () => sql()`(a.status = 'queued' OR (a.status = 'reading' AND a.taken_at < ${stale}))`;
  const queued = await sql()<Queued[]>`
    SELECT a.job_id, a.ref, a.name, a.repo_url, a.live_url, a.contracts, a.identical_pitch, j.thresholds
    FROM screen_applicants a JOIN screen_jobs j ON j.id = a.job_id
    WHERE ${free()} AND j.expires_at > ${o.now} ${only}
    ORDER BY j.created_at, a.job_id, a.ref
    LIMIT ${o.limit}`;
  let count = 0;
  const finished: string[] = [];
  for (const a of queued) {
    if (o.deadline !== undefined && Date.now() >= o.deadline) break;
    // Taken atomically: a run that overlaps this one skips what this one holds.
    const taken = await sql()`UPDATE screen_applicants a SET status = 'reading', taken_at = ${o.now}
      WHERE a.job_id = ${a.job_id} AND a.ref = ${a.ref} AND ${free()} RETURNING a.ref`;
    if (!taken.length) continue;
    try {
      const { e, repo } = await readOne(a, read, d);
      const notes = notesOf(e);
      // Only the run's own budget flag, or EarnKit's exact note, means "out of allowance": a note built from a
      // repo's file path never matches by substring. A budget requeue counts as an attempt too, with its own cap.
      if (budget.stopped || (e.partial && notes.some((n) => n === 'not read: budget'))) {
        // Out of GitHub allowance: back in the queue for the next run, and this run stops.
        await sql()`UPDATE screen_applicants SET attempts = attempts + 1, taken_at = NULL,
          status = CASE WHEN attempts + 1 >= ${MAX_BUDGET_STOPS} THEN 'failed' ELSE 'queued' END,
          error = CASE WHEN attempts + 1 >= ${MAX_BUDGET_STOPS} THEN 'read failed: out of allowance on every run' ELSE NULL END,
          read_at = CASE WHEN attempts + 1 >= ${MAX_BUDGET_STOPS} THEN ${o.now}::timestamptz ELSE NULL END,
          line = CASE WHEN attempts + 1 >= ${MAX_BUDGET_STOPS} THEN 'no tier: the read failed.' ELSE NULL END
          WHERE job_id = ${a.job_id} AND ref = ${a.ref} AND status = 'reading'`;
        break;
      }
      const key = repo ? repoKey(repo) : null;
      const deployers = [...new Set(e.onchain.map((c) => c.deployer?.toLowerCase()).filter((x): x is string => !!x))];
      const others = await sql()<{ ref: string; rows: Row[] | null }[]>`
        SELECT ref, rows FROM screen_applicants WHERE job_id = ${a.job_id} AND status = 'done' AND ref <> ${a.ref}`;
      const logins = new Map(others.map((r) => [r.ref, loginsOf(r.rows)]));
      logins.set(a.ref, e.team?.logins ?? []);
      const shared = sharedContributors(logins).get(a.ref) ?? 0;
      const xp = await xpCounts(key, deployers, a.job_id, o.now);
      const p = place(e, { identical_pitch: a.identical_pitch, shared_contributors: shared, xp }, thresholdsOf(a.thresholds), o.now);
      const at = o.now.toISOString();
      const xpRows: Row[] = [
        { key: 'xp.applications_90d', value: xp.applications_90d, basis: 'earnkit', read_at: at, note: 'earlier screens by this program in 90 days' },
        { key: 'xp.outcomes_won', value: xp.outcomes.won, basis: 'earnkit', read_at: at, note: 'reported by this program' },
        { key: 'xp.outcomes_rejected', value: xp.outcomes.rejected, basis: 'earnkit', read_at: at, note: 'reported by this program' },
      ];
      const rows = [...flattenRows(e), ...xpRows].filter((r) => PUBLIC_BASES.has(r.basis));
      if (!p.tier && notes.some(retryable)) {
        const [r] = await sql()<{ status: string }[]>`UPDATE screen_applicants SET attempts = attempts + 1, taken_at = NULL,
          status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
          error = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN ${`read failed ${MAX_ATTEMPTS} times`} ELSE NULL END,
          read_at = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN ${o.now}::timestamptz ELSE NULL END,
          line = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'no tier: the read failed.' ELSE NULL END
          WHERE job_id = ${a.job_id} AND ref = ${a.ref} AND status = 'reading' RETURNING status`;
        if (r?.status !== 'failed') continue;
      } else if (!p.tier) {
        await sql()`UPDATE screen_applicants SET status = 'failed', error = ${oneLine(e.notes[0] ?? 'read was partial')}, line = 'no tier: the read failed.',
          rows = ${sql().json(rows as never)}, read_at = ${o.now} WHERE job_id = ${a.job_id} AND ref = ${a.ref} AND status = 'reading'`;
      } else {
        await sql()`UPDATE screen_applicants SET status = 'done', tier = ${p.tier}, flags = ${sql().json(p.flags)}, because = ${sql().json(p.because)},
          line = ${reviewerLine(p, e)}, rows = ${sql().json(rows as never)}, read_at = ${o.now}, deployers = ${deployers},
          repo_key = ${key}, repo_url = ${repo}, shared_contributors = ${shared}, error = NULL
          WHERE job_id = ${a.job_id} AND ref = ${a.ref} AND status = 'reading'`;
      }
    } catch (err) {
      // Only the error's name: a message can carry a URL or a token's detail.
      const name = err instanceof Error ? err.name.replace(/[^\w]/g, '').slice(0, 40) || 'Error' : 'Error';
      await sql()`UPDATE screen_applicants SET status = 'failed', error = ${name}, read_at = ${o.now}
        WHERE job_id = ${a.job_id} AND ref = ${a.ref} AND status = 'reading'`;
    }
    count++;
    if (await advance(a.job_id, o.now)) finished.push(a.job_id);
  }
  return { read: count, jobs_finished: finished };
}
