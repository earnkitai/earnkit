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
import type postgres from 'postgres';
import { cleanText } from '../v5/controls';
import { CHAIN_REGISTRY, isKnownChain } from '../v5/chains';
import { CONFIRMED, amountsOf, record, resultWords, winCapOf } from '../v5/ledger';
import { amountsOverCap } from '../v5/amount';
import { amountsText, plusAmount, sameAmounts, type Amounts } from '../v5/programs-read';
import { getProgram } from '../v5/programs';
import { canonicalRepoLink, isCodeHost, isShortener, nameKeyOf, sshAsHttps, type Project } from '../v5/project-input';
import { cachedRepoFacts, cachedRepoId, cachedRepoLink, ownsRepo, repoKey } from '../v5/repo-facts';
import { type Applicant, identicalPitches } from './applicants';
import { getBuilder, getRecord } from './builders';
import type { Row } from './evidence';
import { listWords } from './reply-words';
import { currentReviewerLine } from './tier-words';
import { type Flag, type Thresholds, type Tier, TIERS } from './tiers';

/** L45-9 (v6.1.19): how an outcome's ref that is empty after cleaning is named. */
export const EMPTY_REF = '(empty name)';
/** An applicant's ref, as the program gives it and as an outcome names it (screen-tool's outcome ref cap). */
export const REF_MAX = 60;

export const ScreenApplicant = z
  .object({
    // L45-9 (v6.1.19): a ref empty once hidden and control characters are gone is refused, never stored as a placeholder.
    ref: z.string().max(REF_MAX).transform((x) => cleanText(x, REF_MAX)).pipe(z.string().min(1, 'empty after removing hidden characters')).describe("The program's own id for the applicant"),
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
 * is shown as `onchain[i].outside_senders_90d`; L35-23 (v6.1.17): its old key, the alias, is no longer shown. Pure.
 */
const shown = (x: Row): Row[] => {
  const m = FUNDED_KEY.exec(x.key);
  if (m) return [{ ...x, key: `${m[1]}outside_senders_90d` }];
  return [x.basis === 'site' && SITE_TEXT.has(x.key) && typeof x.value === 'string' ? { ...x, note: [SITE_TEXT_NOTE, x.note].filter(Boolean).join('; ') } : x];
};
/** A results row: `read_at` only when it differs from its applicant's (L26-4). */
export type ShownRow = Omit<Row, 'read_at'> & { read_at?: string };
/** L26-4 (v6.1.16 Task 12): the applicant's read time (the latest of its rows), and each row without it unless older. Pure. */
function readOnce(rows: Row[]): { read_at: string | null; rows: ShownRow[] } {
  const read_at = rows.reduce<string | null>((m, r) => (r.read_at && (!m || r.read_at > m) ? r.read_at : m), null);
  return { read_at, rows: rows.map(({ read_at: at, ...r }) => (at && at !== read_at ? { ...r, read_at: at } : r)) };
}
/** `payment` (T8-F1, v6.1.14): a won that is a further payment of a win already posted, with the reviewer's own key. */
export type Outcome = {
  ref: string; outcome: 'won' | 'rejected' | 'shortlisted'; payment?: { key: string };
  /** US dollars (a shortcut for `money` in USD). */
  amount_usd?: number;
  /** L22-6 (v6.1.16): a win's amount as given (`readAmount`), cents and currency kept, never converted. */
  money?: { value: number; currency: string };
};
/** A won outcome's money by currency, or null when none was given. Pure. */
const moneyOf = (o: Outcome): Amounts | null =>
  o.outcome !== 'won' ? null : o.money ? { [o.money.currency]: cents(o.money.value) } : o.amount_usd != null ? { USD: cents(o.amount_usd) } : null;
/** A value rounded to the cent, to be stored (the cap reads the given value first, L22-5). Pure. */
const cents = (v: number): number => Math.round(v * 100) / 100;
/** Applicants per page of a screen's results (L15-3, v6.1.14; 10 from v6.1.16 Task 12, L26-4: a page stays under 20 KB). */
export const PAGE_SIZE = 10;
export type XpCounts = { applications_90d: number; outcomes: { won: number; rejected: number } };
export type ScreenResults = {
  job_id: string;
  program_id: string;
  total: number;
  done: number;
  finished: boolean;
  /** v6.1.16 Task 16: rows of this job the last daily run left when it stopped at its deadline (0: none). */
  last_run_left: number;
  /** L15-3 (v6.1.14): the page these applicants are (1-based, PAGE_SIZE each) and the next one, null on the last. */
  page: number;
  next_page: number | null;
  totals: Record<Tier | 'pending', number>;
  /** `result` and `amount` (L22-12, v6.1.16): the program's outcome posted for the applicant, its money in the one format. */
  /** `read_at` (L26-4, v6.1.16 Task 12): when the applicant was read, once; a row keeps its own only when it was read earlier (a cache). */
  applicants: { ref: string; name: string; tier: Tier | null; flags: Flag[]; because: string[]; line: string | null; result: 'won' | 'rejected' | 'shortlisted' | null; amount: string | null; read_at?: string | null; rows?: ShownRow[] }[];
};
export type JobStatus = { id: string; program_id: string; total: number; done: number; finished: boolean; expired: boolean; last_run_left: number };

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
 * key, so the read names it (`GitLab repo, not read`, `account link, not a repo`) instead of dropping it. L16-13,
 * L16-8 (v6.1.16): a link off a code host is `dropped` (a shortened one `short`), so the queue's note names it. Pure.
 */
function repoOf(raw: string | undefined): { url: string | null; key: string | null; dropped?: 'host' | 'short' } {
  if (!raw?.trim()) return { url: null, key: null };
  const href = sshAsHttps(raw.trim());
  const full = /^[a-z][a-z\d+.-]*:\/\//i.test(href) ? href : `https://${href}`;
  if (isShortener(full)) return { url: null, key: null, dropped: 'short' };
  const key = repoKey(full);
  if (key) return { url: `https://github.com/${key}`, key };
  if (!isCodeHost(full)) return { url: null, key: null, dropped: 'host' };
  return { url: canonicalRepoLink(full) ?? full, key: null };
}

/** An applicant's site as compared and kept: trimmed, null when missing or a shortened link (L16-8, v6.1.16). Pure. */
function siteOf(raw: string | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  const full = /^[a-z][a-z\d+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  return isShortener(full) ? null : t;
}

/** A site as two rows compare it (L16-5, v6.1.16): the parsed link, lower case; null when missing. Pure. */
function siteKey(raw: string | undefined): string | null {
  const t = siteOf(raw);
  if (!t) return null;
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(t) ? t : `https://${t}`).toString().toLowerCase();
  } catch {
    return t.toLowerCase();
  }
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
  siteApart: (groups: string[]) => `Same repo under more than one ref, kept apart as their sites differ: ${groups.join('; ')}.`,
  contracts: (groups: string[]) => `Contracts left out, not read: ${groups.join('; ')}.`,
  /** L17-5 (v6.1.16): applicants a live screen of the program already holds, each with the row holding it; not queued again. */
  already: (refs: string[]) => `Already queued: ${listWords(refs, 10)}.`,
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
 * ref is merged into the first ref the same way when both carry the same EarnKit id or neither does and their sites
 * agree or one is missing (L16-5, v6.1.16), else kept and named. The notes name each. Pure.
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
  const siteApart: string[] = [];
  const repoOfEntry = (a: ScreenApplicant) => repoOf(a.repo_url).url;
  for (const a of byRef) {
    const repo = repoOfEntry(a);
    const i = repo ? out.findIndex((x) => x.ref !== a.ref && repoOfEntry(x) === repo) : -1;
    // One repo is one applicant only when both carry the same EarnKit id (or neither does): a row with another's repo
    // and no id is never folded into the row that has one, so no outcome meant for one reaches the other's ledger.
    const ids = i >= 0 && !a.requeue && (out[i].application_id ?? null) === (a.application_id ?? null);
    // L16-5 (v6.1.16): two sites that differ are two projects on one repo (a fork's deploy, a team's two apps).
    const [s1, s2] = i >= 0 ? [siteKey(out[i].live_url), siteKey(a.live_url)] : [null, null];
    const sites = s1 === null || s2 === null || s1 === s2;
    if (ids && sites) {
      mergedRepo.push(`${a.ref} into ${out[i].ref}`);
      out[i] = fill(out[i], a);
      continue;
    }
    if (i >= 0) (ids ? siteApart : sameRepo).push(listWords([out[i].ref, a.ref], 10));
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
    ...(siteApart.length ? [QUEUE_NOTES.siteApart(siteApart)] : []),
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

/** L24-7 (v6.1.16 Task 11): an applicant with its ref (60), name (80), links (500) and contracts through `cleanText`;
 *  a ref left empty by the cleaning reads "applicant". Pure. */
export function cleanApplicant(a: ScreenApplicant): ScreenApplicant {
  const opt = (s: string | undefined, max: number) => (s === undefined ? undefined : cleanText(s, max));
  return {
    ...a,
    ref: cleanText(a.ref, REF_MAX) || 'applicant',
    ...(a.name !== undefined ? { name: opt(a.name, 80) } : {}),
    ...(a.repo_url !== undefined ? { repo_url: opt(a.repo_url, 500) } : {}),
    ...(a.live_url !== undefined ? { live_url: opt(a.live_url, 500) } : {}),
    ...(a.contracts ? { contracts: a.contracts.map((c) => ({ chain: cleanText(c.chain, 40), address: cleanText(c.address, 80) })) } : {}),
  };
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
  /**
   * v6.1.16 Task 12 N2 (v6.1.17): called in the queue transaction only when there is something new to queue, before
   * the job is written; false refuses the job (`limited`) and undoes whatever it wrote, so a call that queues nothing,
   * or is refused, never counts.
   */
  admit?: (tx: postgres.TransactionSql) => Promise<boolean>;
}): Promise<{ id: string | null; total: number; already: string[]; cached: number; notes: string[]; dropped: string[]; limited?: true }> {
  const id = randomBytes(12).toString('base64url');
  // L24-7 (v6.1.16 Task 11): every applicant-written string is cleaned at queue time, so results and the CSV show the
  // cleaned text: no bidi, zero-width or control character is stored or echoed.
  const cleaned = o.applicants.map(cleanApplicant);
  // Low 18 (v6.1.13): an applicant repeated exactly (same ref and every field) is screened once.
  const seen = new Set<string>();
  const unique = cleaned.filter((a) => {
    const k = canonicalJson(a);
    return !seen.has(k) && Boolean(seen.add(k));
  });
  const merged = mergeApplicants(unique);
  const left = contractsLeftOut(merged.list);
  const notes = [...merged.notes, ...(left.length ? [QUEUE_NOTES.contracts(left)] : [])];
  // L16-13, L16-8 (v6.1.16): links not read, by why, with the refs ("repo_url dropped: not a code host (r-1, r-2)").
  const droppedBy = new Map<string, string[]>();
  const drop = (why: string, ref: string) => droppedBy.set(why, [...(droppedBy.get(why) ?? []), ref]);
  const list = merged.list.map((a) => {
    const ref = a.ref;
    const repo = repoOf(a.repo_url);
    if (repo.dropped) drop(repo.dropped === 'short' ? 'repo_url dropped: a shortened link' : 'repo_url dropped: not a code host', ref);
    const site = siteOf(a.live_url);
    if (a.live_url?.trim() && !site) drop('live_url dropped: a shortened link', ref);
    return {
      ref, name: a.name || ref, repo_url: repo.url, repo_key: repo.key, live_url: site,
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
  const expires = new Date(o.now.getTime() + KEEP_DAYS * DAY);
  const already: string[] = [];
  /** Each applicant held, with the row that holds it, for the reviewer's note. */
  const heldBy: string[] = [];
  const NOT_ADMITTED = Symbol('not admitted');
  const fresh = (await sql().begin(async (tx) => {
    // L17-5 (v6.1.16): one queue decision at a time per program, so parallel calls for one applicant queue it once.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${'screen:' + o.programId}))`;
    // An applicant a row of an unexpired screen of the program still waits to read is not queued again, unless its
    // requeue names that row; a row a requeue names is replaced, so it holds nothing. A row already read does not hold
    // it: the program may screen the applicant again later (L15-11's earlier screens). The hold matches identity only
    // (controller ruling, v6.1.16): the same EarnKit id and the same repo key, each equal or absent on both sides, and
    // at least one of them given, so a copied id with another repo (or none) never blocks the real applicant (L16-3);
    // with neither given, the same ref by the same reviewer with the same site. A ref alone never holds across
    // reviewers. The note names the row that holds it, so a false hold shows.
    // v6.1.16 Task 4 N3 (v6.1.17 Task 3): one set-based query for the whole list, the first holding row per applicant
    // (oldest screen first), instead of one query per applicant.
    const probe = list.map((a, i) => ({
      i, ref: a.ref, application_id: a.application_id, repo_key: a.repo_key, live_url: a.live_url,
      requeue_job_id: a.requeue_job_id ?? '', requeue_ref: a.requeue_ref ?? '',
    }));
    const hits = list.length === 0 ? [] : await tx<{ i: number; job_id: string; ref: string }[]>`
      SELECT DISTINCT ON (a.i) a.i, x.job_id, x.ref
      FROM jsonb_to_recordset(${tx.json(probe)}::jsonb) AS a(i int, ref text, application_id text, repo_key text, live_url text, requeue_job_id text, requeue_ref text)
      JOIN screen_applicants x ON x.status = ANY(${UNREAD})
        AND x.application_id IS NOT DISTINCT FROM a.application_id AND x.repo_key IS NOT DISTINCT FROM a.repo_key
      JOIN screen_jobs j ON j.id = x.job_id AND j.program_id = ${o.programId} AND j.expires_at > ${o.now}
      WHERE ((a.application_id IS NOT NULL OR a.repo_key IS NOT NULL)
          OR (x.ref = a.ref AND j.builder_id = ${o.builderId} AND x.live_url IS NOT DISTINCT FROM a.live_url))
        AND NOT (x.job_id = a.requeue_job_id AND x.ref = a.requeue_ref)
        AND NOT EXISTS (SELECT 1 FROM screen_applicants y JOIN screen_jobs k ON k.id = y.job_id
          WHERE k.program_id = ${o.programId} AND y.requeue_job_id = x.job_id AND y.requeue_ref = x.ref)
      ORDER BY a.i, j.created_at, x.job_id, x.ref`;
    const hitOf = new Map(hits.map((h) => [h.i, h]));
    const keep: typeof list = [];
    list.forEach((a, i) => {
      const hit = hitOf.get(i);
      if (hit) {
        already.push(a.ref);
        heldBy.push(`${a.ref} (row ${hit.ref} of screen ${hit.job_id})`);
      } else keep.push(a);
    });
    if (keep.length === 0) return keep;
    if (o.admit && !(await o.admit(tx))) throw NOT_ADMITTED;
    await tx`INSERT INTO screen_jobs (id, program_id, builder_id, installation_id, created_at, thresholds, total, expires_at)
      VALUES (${id}, ${o.programId}, ${o.builderId}, ${o.installationId}, ${o.now}, ${o.thresholds ? tx.json(o.thresholds) : null}, ${keep.length}, ${expires})`;
    for (const a of keep) {
      await tx`INSERT INTO screen_applicants (job_id, ref, name, repo_key, repo_url, live_url, contracts, applied_at, identical_pitch, application_id, requeue_job_id, requeue_ref)
        VALUES (${id}, ${a.ref}, ${a.name}, ${a.repo_key}, ${a.repo_url}, ${a.live_url}, ${tx.json(a.contracts)}, ${a.applied_at}, ${pitches.get(a.ref) ?? 0}, ${a.application_id},
          ${a.requeue_job_id}, ${a.requeue_ref})`;
    }
    return keep;
  }).catch((err: unknown) => {
    if (err === NOT_ADMITTED) return null;
    throw err;
  })) as typeof list | null;
  if (fresh === null) return { id: null, total: 0, already, notes, dropped: [], cached: 0, limited: true };
  const queued = new Set(fresh.map((a) => a.ref));
  const dropped = [...droppedBy].map(([why, refs]) => `${why} (${listWords(refs, 10)})`);
  return {
    id: fresh.length > 0 ? id : null, total: fresh.length, already, notes: [...notes, ...(heldBy.length ? [QUEUE_NOTES.already(heldBy)] : [])], dropped,
    cached: list.filter((a) => queued.has(a.ref) && ((a.repo_key && hot.has(`repo:${a.repo_key}`)) || a.contracts.some((c) => hot.has(`contract:${c.chain}:${c.address}`)))).length,
  };
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

/**
 * L30-16 (v6.1.17 Task 3): the builder who queued the job (`j`) still reviews its program. The worker reads only such
 * jobs; the daily sweep cuts the rest. SQL condition.
 */
export const queuerReviews = () =>
  sql()`EXISTS (SELECT 1 FROM program_reviewers r WHERE r.program_id = j.program_id AND r.builder_id = j.builder_id)`;

/** A job of a program this builder reviews (L15-12, v6.1.14: the program's, whoever queued it). SQL condition. */
const reviewedBy = (builderId: number) =>
  sql()`EXISTS (SELECT 1 FROM program_reviewers r WHERE r.program_id = screen_jobs.program_id AND r.builder_id = ${builderId})`;

/** The job's progress, when it is a job of a program this builder reviews; `expired` past its KEEP_DAYS. */
export async function jobStatus(id: string, builderId: number, now: Date = new Date()): Promise<JobStatus | null> {
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const [j] = await sql()<{ id: string; program_id: string; total: number; done: number; finished_at: Date | null; expires_at: Date; last_run_left: number; read_today: boolean }[]>`
    SELECT id, program_id, total, done, finished_at, expires_at, last_run_left,
      EXISTS (SELECT 1 FROM screen_applicants a WHERE a.job_id = screen_jobs.id AND a.read_at >= ${dayStart}) AS read_today
    FROM screen_jobs WHERE id = ${id} AND ${reviewedBy(builderId)}`;
  if (!j) return null;
  return {
    id: j.id, program_id: j.program_id, total: j.total, done: j.done, finished: j.finished_at !== null, expired: j.expires_at <= now,
    // v6.1.16 Task 16 N5 (v6.1.17 Task 3): "read today" only when a row was read on this UTC day.
    last_run_left: j.finished_at !== null || !j.read_today ? 0 : j.last_run_left,
  };
}

type ApplicantRow = {
  ref: string; name: string; status: string; tier: string | null; flags: Flag[] | null; because: string[] | null; line: string | null; rows: Row[] | null;
  outcome: 'won' | 'rejected' | 'shortlisted' | null; amount_usd: string | null; amounts: unknown; amount_given: string | null; currency: string | null;
};
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
    SELECT x.ref, x.name, x.status, x.tier, x.flags, x.because, x.line, x.rows, o.outcome, o.amount_usd, o.amounts, o.amount_given, o.currency
    FROM screen_applicants x LEFT JOIN screen_outcomes o ON o.job_id = x.job_id AND o.ref = x.ref WHERE x.job_id = ${id} ORDER BY x.seq`;
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
        // Task 11 fix round 1 (N3): a row queued before v6.1.16 is cleaned when read.
        ref: cleanText(r.ref, REF_MAX) || r.ref, name: r.name === null ? r.name : cleanText(r.name, 80), tier: tierOf(r), flags: (r.flags ?? []).map((f) => (f.rule === 'unfunded' ? { ...f, rule: 'self_funded_users' } : f)),
        because: r.because ?? [],
        line: read ? (r.line != null ? currentReviewerLine(r.line) : 'no tier: the read failed.') : null,
        result: r.outcome ?? null,
        amount: r.outcome === 'won' ? amountsText(keptAmounts({ ...r, outcome: 'won' })) || null : null,
        ...(read && readOnce((r.rows ?? []).filter((x) => PUBLIC_BASES.has(x.basis)).flatMap(shown))),
      };
    })
    .sort((a, b) => ORDER.indexOf(a.tier) - ORDER.indexOf(b.tier));
  return { job_id: s.id, program_id: s.program_id, total: s.total, done: s.done, finished: s.finished, last_run_left: s.last_run_left, page, next_page, totals, applicants };
}

/** L23-13 (v6.1.16): days a swept job's own row is kept as a tombstone, so its id still answers expired. */
export const TOMBSTONE_DAYS = 365;

/**
 * Deletes the applicants and outcomes of jobs created over KEEP_DAYS ago (L15-14, v6.1.14: past their results and
 * decisions, and past the counts' 90 days); the `screen_jobs` row stays as a tombstone until TOMBSTONE_DAYS (L23-13,
 * v6.1.16), so `jobStatus` answers expired and the reply is "That screen has expired; queue the list again.", never
 * "I don't have that screen.". L30-16 (v6.1.17 Task 3): an unfinished job whose queuing builder no longer reviews its
 * program (the program has no reviewer, or the builder was removed or deleted) loses its unread applicants, which the
 * worker skips; it is then finished on what was read, or deleted when nothing of it is left. The jobs whose rows were
 * swept (tombstoned, cut or deleted).
 */
export async function sweepScreens(now: Date): Promise<number> {
  const before = new Date(now.getTime() - Math.max(KEEP_DAYS, XP_DAYS) * DAY);
  const gone = new Date(now.getTime() - TOMBSTONE_DAYS * DAY);
  return sql().begin(async (tx) => {
    const ids = (await tx<{ id: string }[]>`SELECT id FROM screen_jobs WHERE created_at < ${before}`).map((r) => r.id);
    const swept = new Set<string>();
    const orphans = (await tx<{ id: string }[]>`SELECT j.id FROM screen_jobs j WHERE j.finished_at IS NULL AND NOT ${queuerReviews()}`).map((r) => r.id);
    if (orphans.length) {
      await tx`DELETE FROM screen_applicants WHERE job_id = ANY(${orphans}) AND status = ANY(${UNREAD})`;
      for (const r of await tx<{ id: string }[]>`DELETE FROM screen_jobs j WHERE j.id = ANY(${orphans})
          AND NOT EXISTS (SELECT 1 FROM screen_applicants a WHERE a.job_id = j.id) AND NOT EXISTS (SELECT 1 FROM screen_outcomes o WHERE o.job_id = j.id)
          RETURNING j.id`) swept.add(r.id);
      for (const r of await tx<{ id: string }[]>`UPDATE screen_jobs j SET
            total = (SELECT count(*) FROM screen_applicants a WHERE a.job_id = j.id),
            done = (SELECT count(*) FROM screen_applicants a WHERE a.job_id = j.id), last_run_left = 0, finished_at = ${now}
          WHERE j.id = ANY(${orphans}) RETURNING j.id`) swept.add(r.id);
    }
    if (ids.length) {
      for (const r of await tx<{ job_id: string }[]>`DELETE FROM screen_applicants WHERE job_id = ANY(${ids}) RETURNING job_id`) swept.add(r.job_id);
      for (const r of await tx<{ job_id: string }[]>`DELETE FROM screen_outcomes WHERE job_id = ANY(${ids}) RETURNING job_id`) swept.add(r.job_id);
    }
    for (const r of await tx<{ id: string }[]>`DELETE FROM screen_jobs WHERE created_at < ${gone} RETURNING id`) swept.add(r.id);
    return swept.size;
  }) as Promise<number>;
}

/** L13-1, L13-12, L13-13 (v6.1.14): the reviewer's agent hears what each outcome did, never what a builder's ledger holds. */
export const OUTCOME_NOTES = {
  unmatched: (refs: string[]) => `Not matched to an EarnKit application: ${listWords(refs, 10)}.`,
  noAmount: (refs: string[]) => `Passed on as a win, amount not given: ${listWords(refs, 10)}.`,
  replaced: (items: string[]) => `Replaced the outcome recorded before: ${listWords(items, 10)}.`,
  /** L45-2 (v6.1.19): an outcome that is not a win, over a kept win: the win stays. */
  beside: (items: string[]) => `A win is kept; noted beside it, not replacing it: ${listWords(items, 10)}.`,
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
  /** L16-1 (v6.1.16): a further payment over a result that is not a win; nothing is written for it. */
  paymentRefused: (refs: string[]) => `Not recorded, a further payment needs a win first: ${listWords(refs, 10)}.`,
  /** Fix round 1 (C1): a builder's ledger did not take it; the reason stays with the builder (the server log has it). */
  stands: (refs: string[]) => `Not passed on; the builder's record stands: ${listWords(refs, 10)}.`,
  /** L16-16 (v6.1.16): a payment key retry, or the outcome kept already; nothing new. */
  repeats: (refs: string[]) => `Already recorded, nothing new: ${listWords(refs, 10)}.`,
} as const;
/** L15-1 (v6.1.14): the owner-facing line when a reviewer posts on their own application. */
export const OWN_APPLICATION = 'You applied to this one; another reviewer posts its result.';

/** The application with this EarnKit id for the program, any status, and whether it is this builder's own. */
/** An `i:<n>` owner's installation id, or null for any other owner (L26-10, v6.1.16 Task 12: looked up by id, an index). Pure. */
export const installationOwner = (owner: string): number | null => {
  const id = /^i:(\d{1,15})$/.exec(owner) ? Number(owner.slice(2)) : NaN;
  return Number.isSafeInteger(id) ? id : null;
};

/** The builder an `i:<n>` owner's installation is linked to, by its id (L26-10); null when none. */
async function ownerInstallationBuilder(owner: string): Promise<number | null> {
  const id = installationOwner(owner);
  if (id === null) return null;
  return (await sql()<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${id}`)[0]?.builder_id ?? null;
}

async function applicationOf(applicationId: string, programId: string, builderId: number) {
  type App = { owner: string; installation_id: number; status: string; project_id: string | null; repo_key: string | null; repo_id: string | null; off_repo: string | null };
  const [byId] = await sql()<App[]>`
    SELECT a.owner, a.installation_id, a.status, a.project_id, a.repo_key, a.repo_id, a.off_repo FROM applications a WHERE a.application_id = ${applicationId} AND a.program_id = ${programId}`;
  if (!byId) return byId;
  // L28-11 (v6.1.16 Task 14): a result is keyed to the repo's application, the earliest sent row for that repo key and
  // program, so co-founders' ids (rows from before one application per repo) share one result.
  const [first] = byId.repo_key && byId.status !== 'started' && byId.status !== 'skipped'
    ? await sql()<App[]>`SELECT a.owner, a.installation_id, a.status, a.project_id, a.repo_key, a.repo_id, a.off_repo FROM applications a
        WHERE a.program_id = ${programId} AND (a.repo_key = ${byId.repo_key} OR (${byId.repo_id}::bigint IS NOT NULL AND a.repo_id = ${byId.repo_id}::bigint)) AND a.status = ANY(${['applied', 'won', 'rejected', 'no_result']})
        ORDER BY COALESCE(a.sent_at, a.at), a.owner LIMIT 1`
    : [];
  // Controller ruling: redirected only when both owners are shown to share the repo (owner, org member or committer,
  // by the cached read alone), never by the repo key alone.
  const shares = first && first.owner !== byId.owner ? (await tiedOwner(byId.owner, byId.repo_key!)) && (await tiedOwner(first.owner, byId.repo_key!)) : false;
  const app = shares ? first! : byId;
  // The reviewer's own application is refused whether it is the id's row or the row it redirects to.
  const mine = async (owner: string) => owner === `b:${builderId}` || (await ownerInstallationBuilder(owner)) === builderId;
  const own = (await mine(byId.owner)) || (app !== byId && (await mine(app.owner)));
  return { ...app, own };
}

/** L28-11 (controller ruling): whether an owner's GitHub login is tied to the repo by the cached read (no fetch). */
async function tiedOwner(owner: string, repo: string): Promise<boolean> {
  const builder = owner.startsWith('b:') ? Number(owner.slice(2)) : await ownerInstallationBuilder(owner);
  if (builder === null || !Number.isSafeInteger(builder)) return false;
  const login = (await getBuilder(builder))?.login ?? null;
  const facts = (await cachedRepoFacts({ name: '', description: '', repo_url: repo } as Project)) ?? { repo_url: repo };
  return ownsRepo(login, facts, { repoUrl: repo, noFetch: true });
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
  const builder = owner.startsWith('b:') ? Number(owner.slice(2)) : await ownerInstallationBuilder(owner);
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
 * L28-6 (v6.1.16 Task 14): the row's repo is the application's repo renamed or transferred: the GitHub id the
 * application keeps (or the old link's cached read) is the row link's cached read's, or the old link's cached read now
 * answers with the row's link. Cache reads only.
 */
async function renamedTo(app: ProjectSide & { repo_id?: number | null }, row: ProjectSide): Promise<boolean> {
  if (!app.repo || !row.repo || app.repo === row.repo) return false;
  const rowId = await cachedRepoId(row.repo);
  const appId = app.repo_id ?? (await cachedRepoId(app.repo));
  if (rowId !== null && appId !== null) return rowId === appId;
  return (await cachedRepoLink(app.repo)) === row.repo;
}

/** L16-9 (v6.1.16): why an outcome reached no builder's ledger, in the words of the agent note and the show line. */
export const NOT_PASSED = {
  unmatched: 'no EarnKit application',
  otherProject: "the id is another project's",
  noProject: 'the application names no project',
  ambiguous: 'the id is on more than one applicant',
  superseded: 'a later row replaces it',
  own: 'your own application',
  overCap: 'over what the program pays',
  badAmount: 'amount not read',
  older: 'a later result is kept',
  shortlisted: 'shortlisted only',
  notFound: 'not in this screen',
  paymentRefused: 'further payment refused',
  /** Fix round 1 (C1): the builder's ledger refused it; nothing more is said to a program. */
  builderStands: "the builder's record stands",
} as const;
export type NotPassedWhy = (typeof NOT_PASSED)[keyof typeof NOT_PASSED];

/** "won $3,000", "won EUR 2,500" (L16-4: an earlier win in another currency with its amount as given). Pure. */
const keptWords = (b: KeptOutcome): string => (b.outcome === 'shortlisted' ? 'shortlisted' : resultWords(b.outcome, keptAmounts(b)));

type KeptOutcome = { outcome: string; amount_usd: string | null; amounts: unknown; amount_given: string | null; currency: string | null };
/**
 * A kept outcome's money (L22-3, v6.1.16): `amounts`, else the single pair written before v6.1.16 (`amount_given` in
 * `currency`, readable for one release), else its US dollars. Pure.
 */
export function keptAmounts(b: KeptOutcome): Amounts | null {
  if (b.outcome !== 'won') return null;
  if (b.amounts) return amountsOf({ amounts: b.amounts });
  if (b.amount_given !== null && b.currency) return { [b.currency]: Number(b.amount_given) };
  return amountsOf({ amount_usd: b.amount_usd });
}

/** The screen's result word for a further payment's refusal (L16-1): `none` when nothing is kept. Pure. */
const screenStatusWords = (outcome: string | undefined): string => (outcome === undefined ? 'none' : outcome === 'no_result' ? 'no result' : outcome);

/**
 * The program's decisions, on a job of a program this builder reviews (any of its reviewers, L15-12). Each is kept for
 * the program's own counts; a second one for an applicant replaces the first only when newer (L13-12), and the note
 * says which it replaced (L16-4: an earlier win in another currency as given, `EUR 2,500`); a win marked a further
 * payment adds to the first, once per key and never over the program's cap (L15-17, T8-F1, T8-F3), in the screen and
 * the ledger, and only over a kept win (L16-1: else nothing is written and it is named in `paymentRefused` with the
 * screen's kept result); an unmarked win with another amount is a correction. A payment key retry or an outcome
 * identical to the kept one is a repeat (L16-16), never counted in `recorded`, whatever the ledger answers (FR-4: it is
 * still delivered, silently).
 * A won or rejected one also goes to the ledger of the application the applicant row names by its EarnKit id (L13-1),
 * only when that application is for this program: never by repo or site, since a record or an applicant list can name
 * any repo. It is written as that application's own installation, through ledger.record, which mirrors the kept
 * result (L16-1, L16-2: a different won or rejected is a correction there too); a win with no amount is passed on as a
 * win with none (L13-13). An outcome on the reviewer's own application is not written at all (L15-1). FR-3 (final
 * fix): nor one whose row is another project than the application's (the repo when both have one, else the name), so
 * a copied id on a single row reaches no ledger. An id another live row of the same project carries too reaches no
 * ledger (T5-F3; L16-3: rows of another project are never candidates); only a row a later row's requeue names is not
 * live. Shortlisted writes no ledger row. `passed` counts the outcomes a ledger holds; `reasons` names each that did
 * not (`{ref}: {why}`), `notPassed` the recorded ones the screen itself held back (`{ref} ({why})`, L22-11). Fix round 1
 * (C1): what a builder's ledger holds never reaches the reviewer; a ledger refusal is named only in `stands` ("the
 * builder's record stands"), its detail in a `[screen]` server log line.
 */
export async function recordOutcomes(jobId: string, builderId: number, outcomes: Outcome[], now: Date): Promise<{
  recorded: number; notFound: string[]; notes: string[]; own?: string[]; overCap?: string[]; overCapAt?: { ref: string; at: string }[];
  passed: number; reasons: string[]; notPassed: string[]; repeats: string[]; paymentRefused: { ref: string; status: string }[]; stands?: string[];
}> {
  const [job] = await sql()<{ program_id: string; installation_id: number }[]>`
    SELECT program_id, installation_id FROM screen_jobs WHERE id = ${jobId} AND ${reviewedBy(builderId)} AND expires_at > ${now}`;
  if (!job) return { recorded: 0, notFound: [], notes: [], passed: 0, reasons: [], notPassed: [], repeats: [], paymentRefused: [] };
  let recorded = 0;
  let passed = 0;
  // Refs not in this screen, in the order given, once each (v6.1.7 C19).
  const notFound: string[] = [];
  const unmatched: string[] = [];
  const noAmount: string[] = [];
  const older: string[] = [];
  const replaced: string[] = [];
  /** L45-2 (v6.1.19): outcomes noted beside a kept win, never replacing it. */
  const beside: string[] = [];
  const added: string[] = [];
  const ambiguous: string[] = [];
  const superseded: string[] = [];
  const own: string[] = [];
  const overCap: string[] = [];
  /** L22-9 (v6.1.16): each further payment over the cap with the total it would have made, for the owner's line. */
  const overCapAt: { ref: string; at: string }[] = [];
  const otherProject: string[] = [];
  const noProject: string[] = [];
  const repeats: string[] = [];
  const paymentRefused: { ref: string; status: string }[] = [];
  const reasons: string[] = [];
  const notPassed: string[] = [];
  /** Fix round 1 (C1): refs a builder's ledger did not take; the reviewer hears only that the builder's record stands. */
  const stands: string[] = [];
  const once = (list: string[], ref: string) => void (list.includes(ref) || list.push(ref));
  /** L16-9, L22-11: an outcome that reached no ledger; `kept` when the screen recorded it. */
  const miss = (ref: string, why: NotPassedWhy, kept: boolean) => {
    once(reasons, `${ref}: ${why}`);
    if (kept) once(notPassed, `${ref} (${why})`);
  };
  const cap = winCapOf(await getProgram(job.program_id));
  const key = (x: { job_id: string; ref: string }) => `${x.job_id}\n${x.ref}`;
  for (const o of outcomes) {
    const [a] = await sql()<{ application_id: string | null; name: string; repo_url: string | null }[]>`
      SELECT application_id, name, repo_url FROM screen_applicants WHERE job_id = ${jobId} AND ref = ${o.ref}`;
    if (!a) {
      // L45-9 (v6.1.19): a ref empty after cleaning is named as such, never as nothing.
      once(notFound, o.ref || EMPTY_REF);
      miss(o.ref || EMPTY_REF, NOT_PASSED.notFound, false);
      continue;
    }
    const app = a.application_id ? await applicationOf(a.application_id, job.program_id, builderId) : undefined;
    // L15-1 (v6.1.14): never on the reviewer's own application; nothing is written for it, the rest go on.
    if (app?.own) {
      once(own, o.ref);
      miss(o.ref, NOT_PASSED.own, false);
      continue;
    }
    // L22-6 (v6.1.16): the amount as given, cents and currency kept.
    const money = moneyOf(o);
    const given = o.outcome !== 'won' ? null : o.money ? { ...o.money, value: cents(o.money.value) } : o.amount_usd != null ? { value: cents(o.amount_usd), currency: 'USD' } : null;
    const pkey = o.outcome === 'won' && o.payment ? o.payment.key : null;
    type Before = KeptOutcome & { at: Date; payment_keys: string[] };
    // T5-F5 (v6.1.14): the outcome it replaces is read under the row's lock, in the upsert's transaction.
    const w = (await sql().begin(async (tx) => {
      const [b] = await tx<Before[]>`
        SELECT outcome, amount_usd, amounts, amount_given, currency, at, payment_keys FROM screen_outcomes WHERE job_id = ${jobId} AND ref = ${o.ref} FOR UPDATE`;
      // T8-F1: a payment key this outcome already added is a retry: nothing changes.
      if (pkey !== null && b?.payment_keys.includes(pkey)) return { repeat: true as const, at: b.at };
      // L16-1, L16-2 (v6.1.16): a further payment adds only to a kept win; over anything else nothing is written.
      if (pkey !== null && b?.outcome !== 'won') return { refused: screenStatusWords(b?.outcome) };
      // L16-16 (v6.1.16): the outcome kept already, the same in every part: nothing changes.
      const kept = b ? keptAmounts(b) : null;
      if (pkey === null && b && b.outcome === o.outcome && sameAmounts(kept, money)) return { repeat: true as const, at: b.at };
      // L45-2 (v6.1.19): an outcome that is not a win never replaces a kept win: the win stays, this one is noted beside it.
      if (b?.outcome === 'won' && o.outcome !== 'won') return { beside: b };
      // L15-17, T8-F1: a further payment over a win with an amount is kept as the total, within its currency and keeping
      // both across currencies (L22-3, v6.1.16; never a replace); T8-F3, L22-4: over the cap, each currency converted
      // for the check only, nothing is written. Unmarked, another amount replaces the first.
      const sum = pkey !== null && b?.outcome === 'won' && kept !== null && given !== null ? plusAmount(kept, given.value, given.currency) : null;
      if (sum !== null && amountsOverCap(sum, cap)) return { overCap: amountsText(sum) };
      const keys = [...(b?.payment_keys ?? []), ...(pkey !== null ? [pkey] : [])];
      const now$ = sum ?? money;
      // The single pair (amount_given, currency) is still written for a one-currency amount, readable for one release.
      const single = now$ && Object.keys(now$).length === 1 ? Object.entries(now$)[0] : null;
      const k = await tx`INSERT INTO screen_outcomes (job_id, ref, outcome, amount_usd, amounts, at, payment_keys, amount_given, currency)
        VALUES (${jobId}, ${o.ref}, ${o.outcome}, ${now$?.USD ?? null}, ${now$ ? tx.json(now$) : null}, ${now}, ${keys}, ${single?.[1] ?? null}, ${single?.[0] ?? null})
        ON CONFLICT (job_id, ref) DO UPDATE SET outcome = EXCLUDED.outcome, amount_usd = EXCLUDED.amount_usd, amounts = EXCLUDED.amounts, at = EXCLUDED.at,
          payment_keys = EXCLUDED.payment_keys, amount_given = EXCLUDED.amount_given, currency = EXCLUDED.currency
        WHERE EXCLUDED.at >= screen_outcomes.at RETURNING ref`;
      return { before: b, kept: k.length > 0, total: sum };
    })) as { repeat: true; at: Date } | { refused: string } | { overCap: string } | { beside: Before } | { before: Before | undefined; kept: boolean; total: Amounts | null };
    if ('overCap' in w) {
      once(overCap, o.ref);
      overCapAt.push({ ref: o.ref, at: w.overCap });
      miss(o.ref, NOT_PASSED.overCap, false);
      continue;
    }
    if ('refused' in w) {
      if (!paymentRefused.some((x) => x.ref === o.ref)) paymentRefused.push({ ref: o.ref, status: w.refused });
      miss(o.ref, NOT_PASSED.paymentRefused, false);
      continue;
    }
    // FR-4 (final fix): a payment key the screen already kept is a retry. It still goes on to the ledger with the same
    // key (the ledger's own key check makes that a no-op once written), so a ledger write that failed after the screen's
    // commit is delivered on the retry, once. L16-16: it counts as recorded only when the ledger took it.
    const repeat = 'repeat' in w;
    // L45-2 (v6.1.19): beside a kept win; a rejection still goes on to the ledger, which keeps the win and notes it.
    const besideWin = 'beside' in w;
    if (besideWin) once(beside, `${o.ref} (${o.outcome}; kept: ${keptWords(w.beside)})`);
    if (!repeat && !besideWin) {
      const { before, kept, total } = w;
      if (!kept) {
        once(older, o.ref);
        miss(o.ref, NOT_PASSED.older, false);
        continue;
      }
      recorded++;
      if (total !== null) added.push(`${o.ref} (now ${resultWords('won', total)})`);
      else if (before) replaced.push(`${o.ref} (was ${keptWords(before)})`);
    }
    // A repeat whose ledger write changes nothing is named in `repeats`; one the ledger takes counts as recorded.
    const repeated = () => once(repeats, o.ref);
    if (o.outcome === 'shortlisted') {
      if (besideWin) continue;
      if (repeat) repeated();
      else miss(o.ref, NOT_PASSED.shortlisted, true);
      continue;
    }
    const skip = (list: string[], why: NotPassedWhy) => {
      once(list, o.ref);
      if (repeat) repeated();
      else miss(o.ref, why, true);
    };
    // The application the applicant row names, for this program only; a sent one (applied, or with a result the ledger keeps).
    if (!app || app.status === 'started' || app.status === 'skipped') {
      skip(unmatched, NOT_PASSED.unmatched);
      continue;
    }
    // T5-F3 (v6.1.14) and the Task 8 security follow-up: an id given to a program can be copied, so a requeued row is
    // not live; only a reviewer's deliberate requeue (checked when queued) separates a requeue from a copy.
    const rows = await sql()<{ job_id: string; ref: string; name: string; repo_url: string | null; requeue_job_id: string | null; requeue_ref: string | null }[]>`
      SELECT x.job_id, x.ref, x.name, x.repo_url, x.requeue_job_id, x.requeue_ref FROM screen_applicants x JOIN screen_jobs j ON j.id = x.job_id
      WHERE x.application_id = ${a.application_id} AND j.program_id = ${job.program_id}`;
    const named = new Set(rows.filter((x) => x.requeue_job_id && x.requeue_ref).map((x) => key({ job_id: x.requeue_job_id!, ref: x.requeue_ref! })));
    const me = key({ job_id: jobId, ref: o.ref });
    if (named.has(me)) {
      skip(superseded, NOT_PASSED.superseded);
      continue;
    }
    // FR-3 (final fix): the row must be the application's own project, so an id copied onto one row reaches no ledger.
    // L16-3 (v6.1.16): computed before the ambiguity check, so a copy of another project never blocks the real row.
    const appProject = await applicationProject(app.owner, app.project_id);
    if (!appProject) {
      skip(noProject, NOT_PASSED.noProject);
      continue;
    }
    const sideOf = (x: { name: string; repo_url: string | null }): ProjectSide => ({ repo: repoSide(x.repo_url), name: nameSide(x.name) });
    // L28-3 (v6.1.16 Task 14): a send kept off a repo (not the builder's) never takes that repo's result.
    if ((app.off_repo !== null && sideOf(a).repo === app.off_repo) || (!sameProject(sideOf(a), appProject) && !(await renamedTo({ ...appProject, repo_id: app.repo_id === null ? null : Number(app.repo_id) }, sideOf(a))))) {
      skip(otherProject, NOT_PASSED.otherProject);
      continue;
    }
    // An id another live row of the same project carries (any screen, expired too) is ambiguous; two rows of one screen
    // are always two applicants.
    const clash = rows.filter((x) => key(x) !== me && !named.has(key(x)) && sameProject(sideOf(x), appProject));
    if (clash.length > 0) {
      const here = [o.ref, ...clash.filter((x) => x.job_id === jobId).map((x) => x.ref)].sort();
      const group = listWords([...here, ...clash.filter((x) => x.job_id !== jobId).map((x) => `${x.ref} (another screen)`).sort()], 10);
      if (!ambiguous.includes(group)) ambiguous.push(group);
      if (repeat) repeated();
      else miss(o.ref, NOT_PASSED.ambiguous, true);
      continue;
    }
    // Fix round 1 (I1, L17-2): a repeat is judged at the kept outcome's own time, never its arrival, so a resend never
    // overwrites a builder's later correction. L22-3 (v6.1.16): the amount goes as given, in its currency.
    // L28-4 (v6.1.16 Task 14): the application's own row, by its project key.
    const res = await record(app.owner, job.program_id, o.outcome, {
      project_id: app.project_id ?? '', installationId: app.installation_id, now: 'repeat' in w ? w.at : now, fromScreen: true, ...(pkey !== null && { payment: { key: pkey } }),
      ...(o.outcome !== 'won' ? {} : given === null ? { amountNotGiven: true as const } : { amount: given }),
    });
    // Fix round 1 (C1): the reviewer hears only what the screen did. A repeat is a repeat whatever the ledger answers
    // (an FR-4 delivery stays silent), and any ledger refusal is one generic reason, its detail in the server log, so
    // the builder's own corrections, results and totals never reach a program.
    if (repeat) repeated();
    else if (besideWin) {
      if (res.ok) {
        recorded++;
        passed++;
      } else if (res.note === 'Already tracked.') repeated();
    } else if (res.ok || res.note === 'Already tracked.' || res.note === CONFIRMED) {
      passed++;
      if (o.outcome === 'won' && money === null) once(noAmount, o.ref);
    } else {
      console.warn('[screen] ledger refused', JSON.stringify({ job: jobId, ref: o.ref, owner: app.owner, program: job.program_id, note: res.note, current: res.current ?? null }));
      once(stands, o.ref);
      once(reasons, `${o.ref}: ${NOT_PASSED.builderStands}`);
    }
  }
  const notes = [
    ...(replaced.length ? [OUTCOME_NOTES.replaced(replaced)] : []),
    ...(beside.length ? [OUTCOME_NOTES.beside(beside)] : []),
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
    ...(paymentRefused.length ? [OUTCOME_NOTES.paymentRefused(paymentRefused.map((x) => x.ref))] : []),
    ...(stands.length ? [OUTCOME_NOTES.stands(stands)] : []),
    ...(repeats.length ? [OUTCOME_NOTES.repeats(repeats)] : []),
  ];
  return {
    recorded, notFound, notes, ...(own.length > 0 && { own }), ...(overCap.length > 0 && { overCap, overCapAt }),
    passed, reasons, notPassed, repeats, paymentRefused, ...(stands.length > 0 && { stands }),
  };
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
