/**
 * Screen jobs: a reviewer's applicant list queued for the worker (pitches compared at creation and
 * dropped), the results with public rows only, the program's outcomes (into a matching builder's ledger
 * when they had applied) and the counts across programs. Results live 30 days.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../v5/db';
import { isKnownChain } from '../v5/chains';
import { record } from '../v5/ledger';
import { repoKey } from '../v5/repo-facts';
import { type Applicant, identicalPitches } from './applicants';
import type { Row } from './evidence';
import { parseRecord } from './record';
import { type Flag, type Thresholds, type Tier, TIERS } from './tiers';

export const ScreenApplicant = z
  .object({
    ref: z.string().trim().min(1).max(60).describe("The program's own id for the applicant"),
    name: z.string().trim().max(120).optional(),
    repo_url: z.string().trim().max(300).optional(),
    live_url: z.string().trim().max(300).optional(),
    contracts: z.array(z.object({ chain: z.string().trim().max(40), address: z.string().trim().max(80) }).strip()).max(10).optional(),
    pitch: z.string().max(4000).optional().describe('Compared for identical pitches only; never stored'),
    applied_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strip();
export type ScreenApplicant = z.infer<typeof ScreenApplicant>;

export const PUBLIC_BASES: ReadonlySet<Row['basis']> = new Set(['github', 'explorer', 'site', 'earnkit']);
export type Outcome = { ref: string; outcome: 'won' | 'rejected' | 'shortlisted'; amount_usd?: number };
export type XpCounts = { applications_90d: number; outcomes: { won: number; rejected: number } };
export type ScreenResults = {
  job_id: string;
  program_id: string;
  total: number;
  done: number;
  finished: boolean;
  totals: Record<Tier | 'pending', number>;
  applicants: { ref: string; name: string; tier: Tier | null; flags: Flag[]; because: string[]; line: string | null; rows?: Row[] }[];
};
export type JobStatus = { id: string; program_id: string; total: number; done: number; finished: boolean; expired: boolean };

const DAY = 86_400_000;
const KEEP_DAYS = 30;
const XP_DAYS = 90;
const CACHE_DAYS = 7;
/** Not read yet: queued, or taken by a worker that has not written it. */
export const UNREAD = ['queued', 'reading'];

/** A github.com repo link as https://github.com/owner/name (a bare "github.com/..." too), else null. Pure. */
function repoOf(raw: string | undefined): { url: string | null; key: string | null } {
  if (!raw) return { url: null, key: null };
  const key = repoKey(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  return key ? { url: `https://github.com/${key}`, key } : { url: null, key: null };
}
/** Known chains and 40-hex addresses only, lowercased. Pure. */
const contractsOf = (cs: ScreenApplicant['contracts']) =>
  (cs ?? [])
    .map((c) => ({ chain: c.chain.toLowerCase(), address: c.address.toLowerCase() }))
    .filter((c) => isKnownChain(c.chain) && /^0x[0-9a-f]{40}$/.test(c.address));

/** Queues the list. Refs are made unique ("r-1 (2)"); the pitch is used here for the identical count and dropped. */
export async function createJob(o: {
  programId: string;
  builderId: number;
  installationId: number;
  applicants: ScreenApplicant[];
  thresholds?: Partial<Thresholds>;
  now: Date;
}): Promise<{ id: string; total: number; cached: number }> {
  const id = randomBytes(12).toString('base64url');
  const refs = new Set<string>();
  const list = o.applicants.map((a) => {
    let ref = a.ref;
    for (let k = 2; refs.has(ref); k++) ref = `${a.ref} (${k})`;
    refs.add(ref);
    const repo = repoOf(a.repo_url);
    return {
      ref, name: a.name || ref, repo_url: repo.url, repo_key: repo.key, live_url: a.live_url || null,
      contracts: contractsOf(a.contracts), applied_at: a.applied_at ?? null, pitch: a.pitch ?? null,
    };
  });
  const pitches = identicalPitches(list.map((a): Applicant => ({ ...a, problems: [] })));
  const since = new Date(o.now.getTime() - CACHE_DAYS * DAY);
  const keys = list.flatMap((a) => [...(a.repo_key ? [`repo:${a.repo_key}`] : []), ...a.contracts.map((c) => `contract:${c.chain}:${c.address}`)]);
  const hot = new Set(
    keys.length ? (await sql()<{ key: string }[]>`SELECT key FROM evidence_cache WHERE key = ANY(${keys}) AND read_at > ${since}`).map((r) => r.key) : [],
  );
  const cached = list.filter((a) => (a.repo_key && hot.has(`repo:${a.repo_key}`)) || a.contracts.some((c) => hot.has(`contract:${c.chain}:${c.address}`))).length;
  const expires = new Date(o.now.getTime() + KEEP_DAYS * DAY);
  await sql().begin(async (tx) => {
    await tx`INSERT INTO screen_jobs (id, program_id, builder_id, installation_id, created_at, thresholds, total, expires_at)
      VALUES (${id}, ${o.programId}, ${o.builderId}, ${o.installationId}, ${o.now}, ${o.thresholds ? tx.json(o.thresholds) : null}, ${list.length}, ${expires})`;
    for (const a of list) {
      await tx`INSERT INTO screen_applicants (job_id, ref, name, repo_key, repo_url, live_url, contracts, applied_at, identical_pitch)
        VALUES (${id}, ${a.ref}, ${a.name}, ${a.repo_key}, ${a.repo_url}, ${a.live_url}, ${tx.json(a.contracts)}, ${a.applied_at}, ${pitches.get(a.ref) ?? 0})`;
    }
  });
  return { id, total: list.length, cached };
}

/** The job's progress, when it is this builder's; `expired` past its 30 days. */
export async function jobStatus(id: string, builderId: number, now: Date = new Date()): Promise<JobStatus | null> {
  const [j] = await sql()<{ id: string; program_id: string; total: number; done: number; finished_at: Date | null; expires_at: Date }[]>`
    SELECT id, program_id, total, done, finished_at, expires_at FROM screen_jobs WHERE id = ${id} AND builder_id = ${builderId}`;
  if (!j) return null;
  return { id: j.id, program_id: j.program_id, total: j.total, done: j.done, finished: j.finished_at !== null, expired: j.expires_at <= now };
}

type ApplicantRow = { ref: string; name: string; status: string; tier: string | null; flags: Flag[] | null; because: string[] | null; line: string | null; rows: Row[] | null };
const ORDER: (Tier | null)[] = ['used', 'live', 'building', 'unverified', 'flagged', null];

/** The results, sorted by tier (used first, flagged then unread last); null when not this builder's or expired. */
export async function jobResults(id: string, builderId: number, now: Date = new Date()): Promise<ScreenResults | null> {
  const s = await jobStatus(id, builderId, now);
  if (!s || s.expired) return null;
  const rows = await sql()<ApplicantRow[]>`
    SELECT ref, name, status, tier, flags, because, line, rows FROM screen_applicants WHERE job_id = ${id} ORDER BY ref`;
  const totals = Object.fromEntries([...TIERS, 'pending'].map((t) => [t, 0])) as ScreenResults['totals'];
  const tierOf = (r: ApplicantRow): Tier | null => ((TIERS as readonly string[]).includes(r.tier ?? '') ? (r.tier as Tier) : null);
  for (const r of rows) {
    if (UNREAD.includes(r.status)) totals.pending++;
    else if (tierOf(r)) totals[tierOf(r)!]++;
  }
  const applicants = rows
    .map((r) => {
      const read = !UNREAD.includes(r.status);
      return {
        ref: r.ref, name: r.name, tier: tierOf(r), flags: r.flags ?? [], because: r.because ?? [],
        line: read ? r.line ?? 'no tier: the read failed, worth a retry.' : null,
        ...(read && { rows: (r.rows ?? []).filter((x) => PUBLIC_BASES.has(x.basis)) }),
      };
    })
    .sort((a, b) => ORDER.indexOf(a.tier) - ORDER.indexOf(b.tier));
  return { job_id: s.id, program_id: s.program_id, total: s.total, done: s.done, finished: s.finished, totals, applicants };
}

/** Deletes jobs created over 90 days ago with their applicants and outcomes (past the counts' window); the jobs deleted. */
export async function sweepScreens(now: Date): Promise<number> {
  const before = new Date(now.getTime() - XP_DAYS * DAY);
  return sql().begin(async (tx) => {
    const ids = (await tx<{ id: string }[]>`DELETE FROM screen_jobs WHERE created_at < ${before} RETURNING id`).map((r) => r.id);
    if (ids.length) {
      await tx`DELETE FROM screen_applicants WHERE job_id = ANY(${ids})`;
      await tx`DELETE FROM screen_outcomes WHERE job_id = ANY(${ids})`;
    }
    return ids.length;
  }) as Promise<number>;
}

/** Builders whose record has a project on this repo. */
async function buildersOnRepo(key: string): Promise<number[]> {
  const rows = await sql()<{ id: number; record: unknown }[]>`
    SELECT DISTINCT b.id, b.record FROM builders b,
      jsonb_array_elements(CASE WHEN jsonb_typeof(b.record->'projects') = 'array' THEN b.record->'projects' ELSE '[]'::jsonb END) p
    WHERE strpos(lower(p->>'repo_url'), ${key}) > 0`;
  return rows.filter((r) => parseRecord(r.record, r.id).projects.some((p) => p.repo_url && repoKey(p.repo_url) === key)).map((r) => r.id);
}

/**
 * The program's decisions. Each is kept for the counts across programs; a won or rejected one also goes
 * to the ledger of a builder whose record project is the same repo and who had applied to this program
 * (through ledger.record, so its caps hold; a refusal is skipped). Shortlisted writes no ledger row.
 */
export async function recordOutcomes(jobId: string, builderId: number, outcomes: Outcome[], now: Date): Promise<{ recorded: number; ledgers: number }> {
  const [job] = await sql()<{ program_id: string; installation_id: number }[]>`
    SELECT program_id, installation_id FROM screen_jobs WHERE id = ${jobId} AND builder_id = ${builderId} AND expires_at > ${now}`;
  if (!job) return { recorded: 0, ledgers: 0 };
  let recorded = 0;
  let ledgers = 0;
  for (const o of outcomes) {
    const [a] = await sql()<{ repo_key: string | null }[]>`SELECT repo_key FROM screen_applicants WHERE job_id = ${jobId} AND ref = ${o.ref}`;
    if (!a) continue;
    const amount = o.outcome === 'won' && o.amount_usd != null ? o.amount_usd : null;
    await sql()`INSERT INTO screen_outcomes (job_id, ref, outcome, amount_usd, at) VALUES (${jobId}, ${o.ref}, ${o.outcome}, ${amount}, ${now})
      ON CONFLICT (job_id, ref) DO UPDATE SET outcome = EXCLUDED.outcome, amount_usd = EXCLUDED.amount_usd, at = EXCLUDED.at`;
    recorded++;
    if (o.outcome === 'shortlisted' || !a.repo_key) continue;
    for (const id of await buildersOnRepo(a.repo_key)) {
      const owner = `b:${id}`;
      const [applied] = await sql()`SELECT 1 FROM applications WHERE owner = ${owner} AND program_id = ${job.program_id} AND status = 'applied'`;
      if (!applied) continue;
      const r = await record(owner, job.program_id, o.outcome, { installationId: job.installation_id, amount_usd: amount ?? undefined, now });
      if (r.ok) ledgers++;
    }
  }
  return { recorded, ledgers };
}

/**
 * Screens by other programs in 90 days (distinct jobs) whose read applicant shares the repo or a deployer,
 * and the won and rejected outcomes those programs reported for them. Never from a builder's ledger.
 */
export async function xpCounts(repoKeyOf: string | null, deployers: string[], excludeJobId: string, now: Date): Promise<XpCounts> {
  const deps = [...new Set(deployers.map((d) => d.toLowerCase()))];
  const since = new Date(now.getTime() - XP_DAYS * DAY);
  const [r] = await sql()<{ jobs: number; won: number; rejected: number }[]>`
    WITH hits AS (
      SELECT a.job_id, a.ref FROM screen_applicants a JOIN screen_jobs j ON j.id = a.job_id
      WHERE a.job_id <> ${excludeJobId}
        AND j.program_id IS DISTINCT FROM (SELECT program_id FROM screen_jobs WHERE id = ${excludeJobId})
        AND a.status = 'done' AND a.read_at >= ${since} AND a.read_at <= ${now}
        AND ((${repoKeyOf}::text IS NOT NULL AND a.repo_key = ${repoKeyOf}) OR a.deployers && ${deps}::text[])
    )
    SELECT (SELECT count(DISTINCT job_id) FROM hits)::int AS jobs,
      count(*) FILTER (WHERE o.outcome = 'won')::int AS won,
      count(*) FILTER (WHERE o.outcome = 'rejected')::int AS rejected
    FROM screen_outcomes o JOIN hits h ON h.job_id = o.job_id AND h.ref = o.ref`;
  return { applications_90d: r?.jobs ?? 0, outcomes: { won: r?.won ?? 0, rejected: r?.rejected ?? 0 } };
}
