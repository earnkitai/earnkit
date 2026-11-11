/**
 * Screen jobs: a reviewer's applicant list queued for the worker (pitches compared at creation and
 * dropped), the results with public rows only, a page at a time, the program's outcomes (into the ledger of the
 * application the applicant row names by its EarnKit id, never by repo) and the counts of the program's own earlier
 * screens. Jobs and outcomes belong to the program (L15-12, L15-18, v6.1.14): any of its reviewers reads and continues
 * them. Results and decisions live KEEP_DAYS (180, L15-14).
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../v5/db';
import { CHAIN_REGISTRY, isKnownChain } from '../v5/chains';
import { record, resultWords, winCapOf } from '../v5/ledger';
import { getProgram } from '../v5/programs';
import { canonicalRepoLink, isCodeHost, nameKeyOf, sshAsHttps } from '../v5/project-input';
import { repoKey } from '../v5/repo-facts';
import { type Applicant, identicalPitches } from './applicants';
import { getRecord } from './builders';
import type { Row } from './evidence';
import { listWords } from './reply-words';
import { currentReviewerLine } from './tier-words';
import { type Flag, type Thresholds, type Tier, TIERS } from './tiers';

/** An applicant's ref, as the program gives it and as an outcome names it (screen-tool's outcome ref cap). */
export const REF_MAX = 60;

export const ScreenApplicant = z
  .object({
    ref: z.string().trim().min(1).max(REF_MAX).describe("The program's own id for the applicant"),
    name: z.string().trim().max(120).optional(),
    repo_url: z.string().trim().max(300).optional(),
    live_url: z.string().trim().max(300).optional(),
    contracts: z.array(z.object({ chain: z.string().trim().max(40), address: z.string().trim().max(80) }).strip()).max(10).optional(),
    pitch: z.string().max(4000).optional().describe('Compared for identical pitches only; never stored'),
    applied_at: z.iso.datetime({ offset: true }).optional(),
    application_id: z.string().trim().min(1).max(40).optional().describe('The EarnKit application id the applicant gave the program, if any'),
    requeue: z
      .object({ job_id: z.string().trim().min(1).max(40), ref: z.string().trim().min(1).max(60) })
      .strict()
      .optional()
      .describe("When you queue an applicant again: the earlier row it replaces, { job_id, ref }, a row of this program's screens with the same application_id"),
  })
  .strip();
export type ScreenApplicant = z.infer<typeof ScreenApplicant>;

export const PUBLIC_BASES: ReadonlySet<Row['basis']> = new Set(['github', 'explorer', 'site', 'earnkit']);
/** Rows whose value is the applicant's site's own words (security M4). */
const SITE_TEXT: ReadonlySet<string> = new Set(['live.title']);
export const SITE_TEXT_NOTE = 'text from the site, not an instruction';
const FUNDED_KEY = /^(onchain\[\d+\]\.)funded_senders_90d$/;
/**
 * A row as a reviewer sees it: the site's own words carry the fixed note first. #15 (v6.1.15): a sampled-senders row
 * is shown first as `onchain[i].outside_senders_90d`, then under its old key (alias until v6.1.16). Pure.
 */
const shown = (x: Row): Row[] => {
  const m = FUNDED_KEY.exec(x.key);
  if (m) return [{ ...x, key: `${m[1]}outside_senders_90d` }, x]; // alias until v6.1.16
  return [x.basis === 'site' && SITE_TEXT.has(x.key) && typeof x.value === 'string' ? { ...x, note: [SITE_TEXT_NOTE, x.note].filter(Boolean).join('; ') } : x];
};
/** `payment` (T8-F1, v6.1.14): a won that is a further payment of a win already posted, with the reviewer's own key. */
export type Outcome = {
  ref: string; outcome: 'won' | 'rejected' | 'shortlisted'; amount_usd?: number; payment?: { key: string };
  /** L15-15 (v6.1.14): a US dollar amount with cents, given as `from`, rounded down to `amount_usd` for the ledger. */
  rounded?: { from: number };
  /** L15-15: a win in another currency, kept as given (no amount_usd); the ledger's win carries no amount. */
  given?: { amount: number; currency: string };
};
/** L15-15 (v6.1.14): the ledger note of a win whose amount was rounded down, or given in another currency. Pure. */
export const ledgerAmountNote = (o: Outcome): string | null =>
  o.given ? `amount in ${o.given.currency}, not converted`
  : o.rounded ? `rounded down to whole dollars from $${o.rounded.from.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : null;
/** Applicants per page of a screen's results (L15-3, v6.1.14). */
export const PAGE_SIZE = 25;
export type XpCounts = { applications_90d: number; outcomes: { won: number; rejected: number } };
export type ScreenResults = {
  job_id: string;
  program_id: string;
  total: number;
  done: number;
  finished: boolean;
  /** L15-3 (v6.1.14): the page these applicants are (1-based, PAGE_SIZE each) and the next one, null on the last. */
  page: number;
  next_page: number | null;
  totals: Record<Tier | 'pending', number>;
  applicants: { ref: string; name: string; tier: Tier | null; flags: Flag[]; because: string[]; line: string | null; rows?: Row[] }[];
};
export type JobStatus = { id: string; program_id: string; total: number; done: number; finished: boolean; expired: boolean };

const DAY = 86_400_000;
/** L15-14 (v6.1.14): a screen's results and the decisions on it are kept this long; grants decide weeks after closing. */
export const KEEP_DAYS = 180;
const XP_DAYS = 90;
const CACHE_DAYS = 7;
/** Not read yet: queued, or taken by a worker that has not written it. */
export const UNREAD = ['queued', 'reading'];

/**
 * The applicant's repo link: a github.com repo as https://github.com/owner/name with its key; L15-5 (v6.1.14): a repo
 * or an account on another code host (CODE_HOSTS: GitLab, Codeberg, Bitbucket) and SSH forms kept as a link with no
 * key, so the read names it (`GitLab repo, not read`, `account link, not a repo`) instead of dropping it. Pure.
 */
function repoOf(raw: string | undefined): { url: string | null; key: string | null } {
  if (!raw) return { url: null, key: null };
  const href = sshAsHttps(raw.trim());
  const full = /^[a-z][a-z\d+.-]*:\/\//i.test(href) ? href : `https://${href}`;
  const key = repoKey(full);
  if (key) return { url: `https://github.com/${key}`, key };
  if (!isCodeHost(full)) return { url: null, key: null };
  return { url: canonicalRepoLink(full) ?? full, key: null };
}
type Contract = NonNullable<ScreenApplicant['contracts']>[number];
/** Known chains and 40-hex addresses only, lowercased. Pure. */
const contractsOf = (cs: ScreenApplicant['contracts']) => (cs ?? []).map(lower).filter((c) => contractWhy(c) === null);
const lower = (c: Contract) => ({ chain: c.chain.toLowerCase(), address: c.address.toLowerCase() });
/** L15-23 (v6.1.14): why a listed contract is not read (`solana`, a chain with no reader; `not a 0x address`), or null. Pure. */
function contractWhy(c: { chain: string; address: string }): string | null {
  // A chain EarnKit has no reader for (unregistered, or not EVM like Solana) is named by its slug.
  if (!isKnownChain(c.chain) || !CHAIN_REGISTRY[c.chain].evm) return c.chain || 'no chain';
  return /^0x[0-9a-f]{40}$/.test(c.address) ? null : 'not a 0x address';
}

/** L15-22, L15-23 (v6.1.14): what the queue did to the list, for the reviewer's agent. */
export const QUEUE_NOTES = {
  mergedRef: (refs: string[]) => `Merged, one ref given more than once: ${listWords(refs, 10)}.`,
  renamedRef: (items: string[]) => `One ref on different applicants, the later ones renamed: ${listWords(items, 10)}.`,
  mergedRepo: (items: string[]) => `Merged, same repo under more than one ref: ${listWords(items, 10)}; post each outcome on the ref kept.`,
  sameRepo: (groups: string[]) => `Same repo under more than one ref, kept apart as their EarnKit ids differ: ${groups.join('; ')}.`,
  contracts: (groups: string[]) => `Contracts left out, not read: ${groups.join('; ')}.`,
} as const;

/** Two entries of one ref are one applicant only when they carry no different EarnKit ids and the later names no requeue. Pure. */
const joinable = (a: ScreenApplicant, b: ScreenApplicant) => !b.requeue && !(a.application_id && b.application_id && a.application_id !== b.application_id);
/** `a` with what it left out taken from `b` (contracts joined, once each). Pure. */
function fill(a: ScreenApplicant, b: ScreenApplicant): ScreenApplicant {
  const out: ScreenApplicant = { ...b, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== '')) } as ScreenApplicant;
  if (a.contracts || b.contracts) {
    const seen = new Set<string>();
    out.contracts = [...(a.contracts ?? []), ...(b.contracts ?? [])].filter((c) => {
      const k = `${c.chain.toLowerCase()}:${c.address.toLowerCase()}`;
      return !seen.has(k) && Boolean(seen.add(k));
    }).slice(0, 10);
  }
  out.ref = a.ref;
  return out;
}

/**
 * L15-22 (v6.1.14): one ref given more than once is one applicant (merged, the first entry's fields kept and gaps filled
 * from the later), unless they carry different EarnKit ids (the later renamed "r-1 (2)"); one repo under more than one
 * ref is merged into the first ref the same way when both carry the same EarnKit id or neither does, else kept and
 * named. The notes name each. Pure.
 */
export function mergeApplicants(list: ScreenApplicant[]): { list: ScreenApplicant[]; notes: string[] } {
  const byRef: ScreenApplicant[] = [];
  const mergedRef: string[] = [];
  for (const a of list) {
    const i = byRef.findIndex((x) => x.ref === a.ref && joinable(x, a));
    if (i >= 0) {
      byRef[i] = fill(byRef[i], a);
      if (!mergedRef.includes(a.ref)) mergedRef.push(a.ref);
    } else byRef.push(a);
  }
  const out: ScreenApplicant[] = [];
  const mergedRepo: string[] = [];
  const sameRepo: string[] = [];
  const repoOfEntry = (a: ScreenApplicant) => repoOf(a.repo_url).url;
  for (const a of byRef) {
    const repo = repoOfEntry(a);
    const i = repo ? out.findIndex((x) => x.ref !== a.ref && repoOfEntry(x) === repo) : -1;
    // One repo is one applicant only when both carry the same EarnKit id (or neither does): a row with another's repo
    // and no id is never folded into the row that has one, so no outcome meant for one reaches the other's ledger.
    if (i >= 0 && !a.requeue && (out[i].application_id ?? null) === (a.application_id ?? null)) {
      mergedRepo.push(`${a.ref} into ${out[i].ref}`);
      out[i] = fill(out[i], a);
      continue;
    }
    if (i >= 0) sameRepo.push(listWords([out[i].ref, a.ref], 10));
    out.push(a);
  }
  // Refs still repeated (different EarnKit ids) are renamed, "r-1 (2)", and named.
  const refs = new Set<string>();
  const renamed: string[] = [];
  const named = out.map((a) => {
    let ref = a.ref;
    // FR-5 (final fix): the base is cut so the renamed ref still fits the 60-character cap an outcome's ref has.
    for (let k = 2; refs.has(ref); k++) ref = `${a.ref.slice(0, REF_MAX - ` (${k})`.length)} (${k})`;
    refs.add(ref);
    if (ref !== a.ref) renamed.push(`${a.ref} as ${ref}`);
    return ref === a.ref ? a : { ...a, ref };
  });
  const notes = [
    ...(mergedRef.length ? [QUEUE_NOTES.mergedRef(mergedRef)] : []),
    ...(renamed.length ? [QUEUE_NOTES.renamedRef(renamed)] : []),
    ...(mergedRepo.length ? [QUEUE_NOTES.mergedRepo(mergedRepo)] : []),
    ...(sameRepo.length ? [QUEUE_NOTES.sameRepo(sameRepo)] : []),
  ];
  return { list: named, notes };
}

/** L15-23 (v6.1.14): the contracts left out at queue, by why, with the refs: "solana (r-3, r-4); not a 0x address (r-5)". Pure. */
function contractsLeftOut(list: ScreenApplicant[]): string[] {
  const by = new Map<string, string[]>();
  for (const a of list) {
    for (const c of a.contracts ?? []) {
      const why = contractWhy(lower(c));
      if (!why) continue;
      const refs = by.get(why) ?? [];
      if (!refs.includes(a.ref)) refs.push(a.ref);
      by.set(why, refs);
    }
  }
  return [...by].map(([why, refs]) => `${why} (${listWords(refs, 10)})`);
}

/** JSON with every object's keys sorted, so one applicant sent with its keys in another order is the same (fix round 1, M5). Pure. */
const canonicalJson = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonicalJson).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(v) ?? 'null';

/**
 * Queues the list. Duplicates are merged or named (L15-22) and refs made unique; the pitch is used here for the
 * identical count and dropped. `notes`, for the reviewer's agent, say what was merged, renamed or left out (L15-23).
 */
export async function createJob(o: {
  programId: string;
  builderId: number;
  installationId: number;
  applicants: ScreenApplicant[];
  thresholds?: Partial<Thresholds>;
  now: Date;
}): Promise<{ id: string; total: number; cached: number; notes: string[] }> {
  const id = randomBytes(12).toString('base64url');
  // Low 18 (v6.1.13): an applicant repeated exactly (same ref and every field) is screened once.
  const seen = new Set<string>();
  const unique = o.applicants.filter((a) => {
    const k = canonicalJson(a);
    return !seen.has(k) && Boolean(seen.add(k));
  });
  const merged = mergeApplicants(unique);
  const left = contractsLeftOut(merged.list);
  const notes = [...merged.notes, ...(left.length ? [QUEUE_NOTES.contracts(left)] : [])];
  const list = merged.list.map((a) => {
    const ref = a.ref;
    const repo = repoOf(a.repo_url);
    return {
      ref, name: a.name || ref, repo_url: repo.url, repo_key: repo.key, live_url: a.live_url || null,
      contracts: contractsOf(a.contracts), applied_at: a.applied_at ?? null, pitch: a.pitch ?? null, application_id: a.application_id ?? null,
      requeue_job_id: a.requeue?.job_id ?? null, requeue_ref: a.requeue?.ref ?? null,
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
      await tx`INSERT INTO screen_applicants (job_id, ref, name, repo_key, repo_url, live_url, contracts, applied_at, identical_pitch, application_id, requeue_job_id, requeue_ref)
        VALUES (${id}, ${a.ref}, ${a.name}, ${a.repo_key}, ${a.repo_url}, ${a.live_url}, ${tx.json(a.contracts)}, ${a.applied_at}, ${pitches.get(a.ref) ?? 0}, ${a.application_id},
          ${a.requeue_job_id}, ${a.requeue_ref})`;
    }
  });
  return { id, total: list.length, cached, notes };
}

/**
 * Task 8 security follow-up (v6.1.14): the refs whose `requeue` names no row of a screen of this program carrying the
 * same application id (a missing row, another id, or none on the requeued row). The list is refused when any is.
 */
export async function badRequeues(programId: string, applicants: ScreenApplicant[]): Promise<string[]> {
  const bad: string[] = [];
  for (const a of applicants) {
    if (!a.requeue) continue;
    const [hit] = a.application_id
      ? await sql()`SELECT 1 FROM screen_applicants x JOIN screen_jobs j ON j.id = x.job_id
          WHERE x.job_id = ${a.requeue.job_id} AND x.ref = ${a.requeue.ref} AND j.program_id = ${programId} AND x.application_id = ${a.application_id}`
      : [];
    if (!hit && !bad.includes(a.ref)) bad.push(a.ref);
  }
  return bad;
}

/** A job of a program this builder reviews (L15-12, v6.1.14: the program's, whoever queued it). SQL condition. */
const reviewedBy = (builderId: number) =>
  sql()`EXISTS (SELECT 1 FROM program_reviewers r WHERE r.program_id = screen_jobs.program_id AND r.builder_id = ${builderId})`;

/** The job's progress, when it is a job of a program this builder reviews; `expired` past its KEEP_DAYS. */
export async function jobStatus(id: string, builderId: number, now: Date = new Date()): Promise<JobStatus | null> {
  const [j] = await sql()<{ id: string; program_id: string; total: number; done: number; finished_at: Date | null; expires_at: Date }[]>`
    SELECT id, program_id, total, done, finished_at, expires_at FROM screen_jobs WHERE id = ${id} AND ${reviewedBy(builderId)}`;
  if (!j) return null;
  return { id: j.id, program_id: j.program_id, total: j.total, done: j.done, finished: j.finished_at !== null, expired: j.expires_at <= now };
}

type ApplicantRow = { ref: string; name: string; status: string; tier: string | null; flags: Flag[] | null; because: string[] | null; line: string | null; rows: Row[] | null };
const ORDER: (Tier | null)[] = ['used', 'live', 'building', 'unverified', 'flagged', null];

/**
 * The results, one page of PAGE_SIZE applicants (L15-3, v6.1.14; the totals count them all). Pages follow the order the
 * rows were queued in, pending rows in place, so a read landing between two pages never moves a row to another page
 * (T8-F2); inside a page they are sorted by tier (used first, flagged then unread last). Null when not a job of a
 * program this builder reviews, or expired.
 */
export async function jobResults(id: string, builderId: number, now: Date = new Date(), page = 1): Promise<ScreenResults | null> {
  const s = await jobStatus(id, builderId, now);
  if (!s || s.expired) return null;
  const rows = await sql()<ApplicantRow[]>`
    SELECT ref, name, status, tier, flags, because, line, rows FROM screen_applicants WHERE job_id = ${id} ORDER BY seq`;
  const totals = Object.fromEntries([...TIERS, 'pending'].map((t) => [t, 0])) as ScreenResults['totals'];
  const tierOf = (r: ApplicantRow): Tier | null => ((TIERS as readonly string[]).includes(r.tier ?? '') ? (r.tier as Tier) : null);
  for (const r of rows) {
    if (UNREAD.includes(r.status)) totals.pending++;
    else if (tierOf(r)) totals[tierOf(r)!]++;
  }
  const start = (page - 1) * PAGE_SIZE;
  const next_page = start + PAGE_SIZE < rows.length ? page + 1 : null;
  const applicants = rows
    .slice(start, start + PAGE_SIZE)
    .map((r) => {
      const read = !UNREAD.includes(r.status);
      return {
        // M2 (v6.1.15 fix round 1): a row read before v6.1.15 carries the rule `unfunded`; it reads as today's id. alias until v6.1.16
        ref: r.ref, name: r.name, tier: tierOf(r), flags: (r.flags ?? []).map((f) => (f.rule === 'unfunded' ? { ...f, rule: 'self_funded_users' } : f)),
        because: r.because ?? [],
        line: read ? (r.line != null ? currentReviewerLine(r.line) : 'no tier: the read failed.') : null,
        ...(read && { rows: (r.rows ?? []).filter((x) => PUBLIC_BASES.has(x.basis)).flatMap(shown) }),
      };
    })
    .sort((a, b) => ORDER.indexOf(a.tier) - ORDER.indexOf(b.tier));
  return { job_id: s.id, program_id: s.program_id, total: s.total, done: s.done, finished: s.finished, page, next_page, totals, applicants };
}

/**
 * Deletes jobs created over KEEP_DAYS ago (L15-14, v6.1.14: past their results and decisions, and past the counts'
 * 90 days) with their applicants and outcomes; the jobs deleted.
 */
export async function sweepScreens(now: Date): Promise<number> {
  const before = new Date(now.getTime() - Math.max(KEEP_DAYS, XP_DAYS) * DAY);
  return sql().begin(async (tx) => {
    const ids = (await tx<{ id: string }[]>`DELETE FROM screen_jobs WHERE created_at < ${before} RETURNING id`).map((r) => r.id);
    if (ids.length) {
      await tx`DELETE FROM screen_applicants WHERE job_id = ANY(${ids})`;
      await tx`DELETE FROM screen_outcomes WHERE job_id = ANY(${ids})`;
    }
    return ids.length;
  }) as Promise<number>;
}

/** L13-1, L13-12, L13-13 (v6.1.14): the reviewer's agent hears what each outcome did, never what a builder's ledger holds. */
export const OUTCOME_NOTES = {
  unmatched: (refs: string[]) => `Not matched to an EarnKit application: ${listWords(refs, 10)}.`,
  noAmount: (refs: string[]) => `Passed on as a win, amount not given: ${listWords(refs, 10)}.`,
  replaced: (items: string[]) => `Replaced the outcome recorded before: ${listWords(items, 10)}.`,
  /** L15-17, T8-F1 (v6.1.14): a further payment (marked) on an applicant's win; the item names the total. */
  added: (items: string[]) => `Added to the win recorded before: ${listWords(items, 10)}.`,
  older: (refs: string[]) => `Not recorded, a later outcome is already kept: ${listWords(refs, 10)}.`,
  /** T8-F3 (v6.1.14): a further payment whose total is over what the program pays; nothing is written for it. */
  overCap: (refs: string[]) => `Not recorded, the total would be over what this program pays: ${listWords(refs, 10)}.`,
  /** L15-1 (v6.1.14): the reviewer's own application; nothing is written for it. */
  own: (refs: string[]) => `Not recorded, the reviewer's own application: ${listWords(refs, 10)}.`,
  /** Task 8 security follow-up: an earlier row a later row's requeue names; it reaches no ledger. */
  superseded: (refs: string[]) => `Not passed on, a requeued row in a later screen carries its EarnKit id now: ${listWords(refs, 10)}.`,
  /** FR-3 (v6.1.14 final fix): the id is for an application of another project (repo, else name); nothing is written. */
  otherProject: (refs: string[]) => `Not passed on, the EarnKit id belongs to another project: ${listWords(refs, 10)}.`,
  /** FR-3: the application names no project, so the row cannot be matched to it; nothing is written. */
  noProject: (refs: string[]) => `Not passed on, the EarnKit application names no project to match: ${listWords(refs, 10)}.`,
  /** T5-F3 (v6.1.14): one id on more than one applicant of the program; each group names every row carrying it. */
  ambiguous: (groups: string[]) => `Not passed on, one EarnKit id on more than one applicant: ${groups.join('; ')}.`,
} as const;
/** L15-1 (v6.1.14): the owner-facing line when a reviewer posts on their own application. */
export const OWN_APPLICATION = 'You applied to this one; another reviewer posts its result.';

/** The application with this EarnKit id for the program, any status, and whether it is this builder's own. */
async function applicationOf(applicationId: string, programId: string, builderId: number) {
  const [app] = await sql()<{ owner: string; installation_id: number; status: string; own: boolean; project_id: string | null }[]>`
    SELECT a.owner, a.installation_id, a.status, a.project_id,
      (a.owner = ${`b:${builderId}`} OR EXISTS (SELECT 1 FROM installations i WHERE a.owner = 'i:' || i.id AND i.builder_id = ${builderId})) AS own
    FROM applications a WHERE a.application_id = ${applicationId} AND a.program_id = ${programId}`;
  return app;
}

type ProjectSide = { repo: string | null; name: string | null };
/** The canonical repo key of a link (SSH forms read as https), or null. Pure. */
const repoSide = (v: string | null | undefined): string | null => (v ? canonicalRepoLink(sshAsHttps(v.trim())) : null);
/** The folded name of a project, as nameKeyOf folds it, or null. Pure. */
const nameSide = (v: string | null | undefined): string | null => nameKeyOf({ name: v ?? '' }).slice(5) || null;

/**
 * FR-3 (v6.1.14 final fix): the project an application is for, from its project_id: a repo key, a `name:` key, or
 * the id of a project in its builder's record (that project's repo and name). Null when none is known.
 */
async function applicationProject(owner: string, projectId: string | null): Promise<ProjectSide | null> {
  if (!projectId) return null;
  if (projectId.startsWith('name:')) return { repo: null, name: projectId.slice(5) || null };
  const repo = repoSide(projectId);
  if (repo) return { repo, name: null };
  const builder = owner.startsWith('b:')
    ? Number(owner.slice(2))
    : ((await sql()<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE 'i:' || id = ${owner}`)[0]?.builder_id ?? null);
  if (builder === null || !Number.isSafeInteger(builder)) return null;
  const p = (await getRecord(builder)).projects.find((x) => x.id === projectId);
  if (!p) return null;
  const side = { repo: repoSide(p.repo_url), name: nameSide(p.name) };
  return side.repo || side.name ? side : null;
}
/**
 * Whether the screen row and the application are one project. An application with a repo needs a row with that same
 * repo (security follow-up: a name is public, so a row with none or another repo is another project); only an
 * application with no repo falls back to the folded name. Pure.
 */
const sameProject = (row: ProjectSide, app: ProjectSide): boolean =>
  app.repo ? row.repo === app.repo : row.name !== null && app.name !== null && row.name === app.name;

/**
 * The program's decisions, on a job of a program this builder reviews (any of its reviewers, L15-12). Each is kept for
 * the program's own counts; a second one for an applicant replaces the first only when newer (L13-12), and the note
 * says which it replaced; a win marked a further payment adds to the first, once per key and never over the program's
 * cap (L15-17, T8-F1, T8-F3), in the screen and the ledger; an unmarked win with another amount is a correction.
 * A won or rejected one also goes to the ledger of the application the applicant row names by its EarnKit id (L13-1),
 * only when that application is for this program: never by repo or site, since a record or an applicant list can name
 * any repo. It is written as that application's own installation, through ledger.record so its caps and its one result
 * per program hold; a win with no amount is passed on as a win with none (L13-13). An outcome on the reviewer's own
 * application is not written at all (L15-1). FR-3 (final fix): nor one whose row is another project than the application's
(the repo when both have one, else the name), so a copied id on a single row reaches no ledger. An id another live row of the program carries too reaches no ledger
 * (T5-F3); only a row a later row's requeue names is not live. Shortlisted writes no ledger row. `notes` are for the
 * reviewer's agent: what the screen did, never whether a ledger took it; `own`, when any, the refs of the reviewer's own.
 */
export async function recordOutcomes(jobId: string, builderId: number, outcomes: Outcome[], now: Date): Promise<{ recorded: number; notFound: string[]; notes: string[]; own?: string[]; overCap?: string[] }> {
  const [job] = await sql()<{ program_id: string; installation_id: number }[]>`
    SELECT program_id, installation_id FROM screen_jobs WHERE id = ${jobId} AND ${reviewedBy(builderId)} AND expires_at > ${now}`;
  if (!job) return { recorded: 0, notFound: [], notes: [] };
  let recorded = 0;
  // Refs not in this screen, in the order given, once each (v6.1.7 C19).
  const notFound: string[] = [];
  const unmatched: string[] = [];
  const noAmount: string[] = [];
  const older: string[] = [];
  const replaced: string[] = [];
  const added: string[] = [];
  const ambiguous: string[] = [];
  const superseded: string[] = [];
  const own: string[] = [];
  const overCap: string[] = [];
  const otherProject: string[] = [];
  const noProject: string[] = [];
  const cap = winCapOf(await getProgram(job.program_id));
  const once = (list: string[], ref: string) => void (list.includes(ref) || list.push(ref));
  const key = (x: { job_id: string; ref: string }) => `${x.job_id}\n${x.ref}`;
  for (const o of outcomes) {
    const [a] = await sql()<{ application_id: string | null; name: string; repo_url: string | null }[]>`
      SELECT application_id, name, repo_url FROM screen_applicants WHERE job_id = ${jobId} AND ref = ${o.ref}`;
    if (!a) {
      once(notFound, o.ref);
      continue;
    }
    const app = a.application_id ? await applicationOf(a.application_id, job.program_id, builderId) : undefined;
    // L15-1 (v6.1.14): never on the reviewer's own application; nothing is written for it, the rest go on.
    if (app?.own) {
      once(own, o.ref);
      continue;
    }
    const amount = o.outcome === 'won' && o.amount_usd != null ? o.amount_usd : null;
    const pkey = o.outcome === 'won' && o.payment ? o.payment.key : null;
    type Before = { outcome: string; amount_usd: string | null; at: Date; payment_keys: string[] };
    // T5-F5 (v6.1.14): the outcome it replaces is read under the row's lock, in the upsert's transaction.
    const w = (await sql().begin(async (tx) => {
      const [b] = await tx<Before[]>`
        SELECT outcome, amount_usd, at, payment_keys FROM screen_outcomes WHERE job_id = ${jobId} AND ref = ${o.ref} FOR UPDATE`;
      // T8-F1: a payment key this outcome already added is a retry: nothing changes.
      if (pkey !== null && b?.payment_keys.includes(pkey)) return { repeat: true as const };
      // L15-17, T8-F1: a further payment over a win with an amount is kept as the total; T8-F3: over the cap, as the
      // ledger refuses it, nothing is written. Unmarked, another amount replaces the first.
      const sum = pkey !== null && b && b.outcome === 'won' && b.amount_usd !== null && amount !== null ? Number(b.amount_usd) + amount : null;
      if (sum !== null && sum > cap) return { overCap: true as const };
      const keys = [...(b?.payment_keys ?? []), ...(pkey !== null ? [pkey] : [])];
      // L15-15 (v6.1.14): the amount as the owner gave it (cents, another currency) is kept beside the whole dollars.
      const givenAmount = o.outcome !== 'won' ? null : o.given ? o.given.amount : o.rounded ? o.rounded.from : amount;
      const currency = o.outcome !== 'won' || givenAmount === null ? null : o.given ? o.given.currency : 'USD';
      const k = await tx`INSERT INTO screen_outcomes (job_id, ref, outcome, amount_usd, at, payment_keys, amount_given, currency)
        VALUES (${jobId}, ${o.ref}, ${o.outcome}, ${sum ?? amount}, ${now}, ${keys}, ${givenAmount}, ${currency})
        ON CONFLICT (job_id, ref) DO UPDATE SET outcome = EXCLUDED.outcome, amount_usd = EXCLUDED.amount_usd, at = EXCLUDED.at, payment_keys = EXCLUDED.payment_keys,
          amount_given = EXCLUDED.amount_given, currency = EXCLUDED.currency
        WHERE EXCLUDED.at >= screen_outcomes.at RETURNING ref`;
      return { before: b, kept: k.length > 0, total: sum };
    })) as { repeat: true } | { overCap: true } | { before: Before | undefined; kept: boolean; total: number | null };
    if ('overCap' in w) {
      once(overCap, o.ref);
      continue;
    }
    // FR-4 (final fix): a payment key the screen already kept is a retry. It still goes on to the ledger with the same
    // key (the ledger's own key check makes that a no-op once written), so a ledger write that failed after the screen's
    // commit is delivered on the retry, once.
    if ('repeat' in w) recorded++;
    else {
      const { before, kept, total } = w;
      if (!kept) {
        once(older, o.ref);
        continue;
      }
      recorded++;
      const same = before && before.outcome === o.outcome && (before.amount_usd === null ? null : Number(before.amount_usd)) === amount;
      if (total !== null) added.push(`${o.ref} (now ${resultWords('won', String(total))})`);
      else if (before && !same) replaced.push(`${o.ref} (was ${before.outcome === 'shortlisted' ? 'shortlisted' : resultWords(before.outcome, before.amount_usd)})`);
    }
    if (o.outcome === 'shortlisted') continue;
    // T5-F3 (v6.1.14) and the Task 8 security follow-up: an id given to a program can be copied, with the applicant's
    // repo, site and contracts, so an id another live row of the program carries (any screen, expired too) is
    // ambiguous and reaches no ledger. A row is not live only when a later row's requeue names it exactly (checked when
    // queued: a row of this program with the same id), so only a reviewer's deliberate requeue separates a requeue from
    // a copy. Two rows of one screen are always two applicants.
    if (a.application_id) {
      const rows = await sql()<{ job_id: string; ref: string; requeue_job_id: string | null; requeue_ref: string | null }[]>`
        SELECT x.job_id, x.ref, x.requeue_job_id, x.requeue_ref FROM screen_applicants x JOIN screen_jobs j ON j.id = x.job_id
        WHERE x.application_id = ${a.application_id} AND j.program_id = ${job.program_id}`;
      const named = new Set(rows.filter((x) => x.requeue_job_id && x.requeue_ref).map((x) => key({ job_id: x.requeue_job_id!, ref: x.requeue_ref! })));
      const me = key({ job_id: jobId, ref: o.ref });
      if (named.has(me)) {
        once(superseded, o.ref);
        continue;
      }
      const clash = rows.filter((x) => key(x) !== me && !named.has(key(x)));
      if (clash.length > 0) {
        const here = [o.ref, ...clash.filter((x) => x.job_id === jobId).map((x) => x.ref)].sort();
        const group = listWords([...here, ...clash.filter((x) => x.job_id !== jobId).map((x) => `${x.ref} (another screen)`).sort()], 10);
        if (!ambiguous.includes(group)) ambiguous.push(group);
        continue;
      }
    }
    // The application the applicant row names, for this program only; a sent one (applied, or with a result the ledger keeps).
    if (!app || app.status === 'started' || app.status === 'skipped') {
      once(unmatched, o.ref);
      continue;
    }
    // FR-3 (final fix): the row must be the application's own project, so an id copied onto one row reaches no ledger.
    const appProject = await applicationProject(app.owner, app.project_id);
    if (!appProject) {
      once(noProject, o.ref);
      continue;
    }
    if (!sameProject({ repo: repoSide(a.repo_url), name: nameSide(a.name) }, appProject)) {
      once(otherProject, o.ref);
      continue;
    }
    if (o.outcome === 'won' && amount === null && !o.given) once(noAmount, o.ref);
    const ledgerNote = ledgerAmountNote(o);
    await record(app.owner, job.program_id, o.outcome, {
      installationId: app.installation_id, now, fromScreen: true, ...(pkey !== null && { payment: { key: `s:${pkey}` } }), ...(amount === null ? (o.outcome === 'won' ? { amountNotGiven: true as const } : {}) : { amount_usd: amount }),
      ...(ledgerNote && { note: ledgerNote }),
    });
  }
  const notes = [
    ...(replaced.length ? [OUTCOME_NOTES.replaced(replaced)] : []),
    ...(added.length ? [OUTCOME_NOTES.added(added)] : []),
    ...(older.length ? [OUTCOME_NOTES.older(older)] : []),
    ...(noAmount.length ? [OUTCOME_NOTES.noAmount(noAmount)] : []),
    ...(unmatched.length ? [OUTCOME_NOTES.unmatched(unmatched)] : []),
    ...(ambiguous.length ? [OUTCOME_NOTES.ambiguous(ambiguous)] : []),
    ...(otherProject.length ? [OUTCOME_NOTES.otherProject(otherProject)] : []),
    ...(noProject.length ? [OUTCOME_NOTES.noProject(noProject)] : []),
    ...(superseded.length ? [OUTCOME_NOTES.superseded(superseded)] : []),
    ...(own.length ? [OUTCOME_NOTES.own(own)] : []),
    ...(overCap.length ? [OUTCOME_NOTES.overCap(overCap)] : []),
  ];
  return { recorded, notFound, notes, ...(own.length > 0 && { own }), ...(overCap.length > 0 && { overCap }) };
}

/**
 * Unread applicants queued ahead of this job: those of unexpired jobs created before it (the worker reads the
 * oldest job first; one created at the same moment goes by id, as the worker orders them). For the screen promise.
 */
export async function queuedAhead(jobId: string, now: Date): Promise<number> {
  const [r] = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM screen_applicants a JOIN screen_jobs j ON j.id = a.job_id, screen_jobs me
    WHERE me.id = ${jobId} AND a.status = ANY(${UNREAD}) AND j.expires_at > ${now}
      AND (j.created_at, j.id) < (me.created_at, me.id)`;
  return r?.n ?? 0;
}

/**
 * The program's own earlier screens in 90 days (distinct jobs, other than this one) whose read applicant shares the
 * repo or a deployer, and the won and rejected outcomes the program reported for them. Never another program's screens
 * or outcomes (L15-11, v6.1.14: a program never sees what another program decided), never from a builder's ledger.
 */
export async function xpCounts(repoKeyOf: string | null, deployers: string[], excludeJobId: string, now: Date): Promise<XpCounts> {
  const deps = [...new Set(deployers.map((d) => d.toLowerCase()))];
  const since = new Date(now.getTime() - XP_DAYS * DAY);
  const [r] = await sql()<{ jobs: number; won: number; rejected: number }[]>`
    WITH hits AS (
      SELECT a.job_id, a.ref FROM screen_applicants a JOIN screen_jobs j ON j.id = a.job_id
      WHERE a.job_id <> ${excludeJobId}
        AND j.program_id = (SELECT program_id FROM screen_jobs WHERE id = ${excludeJobId})
        AND a.status = 'done' AND a.read_at >= ${since} AND a.read_at <= ${now}
        AND ((${repoKeyOf}::text IS NOT NULL AND a.repo_key = ${repoKeyOf}) OR a.deployers && ${deps}::text[])
    )
    SELECT (SELECT count(DISTINCT job_id) FROM hits)::int AS jobs,
      count(*) FILTER (WHERE o.outcome = 'won')::int AS won,
      count(*) FILTER (WHERE o.outcome = 'rejected')::int AS rejected
    FROM screen_outcomes o JOIN hits h ON h.job_id = o.job_id AND h.ref = o.ref`;
  return { applications_90d: r?.jobs ?? 0, outcomes: { won: r?.won ?? 0, rejected: r?.rejected ?? 0 } };
}
