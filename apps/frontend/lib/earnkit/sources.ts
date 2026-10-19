import { ScoreDeadline } from './campaigns';
import { afterCommit, inTx, sql, type Db } from './db';
import { profileCodesIn } from './discovery-clues';
import { noteEvent } from './events';
import { REPOS_MAX, readAppRepos, readGithubRepos, type PersonRepo } from './person-github';
import { countingDeps, flushReadUsage } from './read-usage';
import { NPM_BULK_MAX, isBudgetStop, isoWeek, readCoin, readContract, readNpm, readNpmBulk, readPypi, readRepo, readSite, type PackageSignals, type PrSignals, type ReaderDeps } from './source-readers';

/** spec 6: at most this many sources are read a run (oldest first). */
export const READS_PER_RUN = 200;

/** v2.12 spec 2: a person's sources and their daily readings. Only the server verifies (owner rule 1). */
export type Proof = 'github_signin' | 'proof_line' | 'repo_owner' | 'deployer' | 'deploy_wallet' | 'earnkit_txt' | 'dns_txt' | 'repo_link' | 'proof_branch' | 'github_app';

const repoKeyOf = (url: string | null) => url?.replace(/^https:\/\/github\.com\//, '').toLowerCase() ?? null;
export const packageOwned = (p: PackageSignals, verifiedRepos: ReadonlySet<string>) => {
  const k = repoKeyOf(p.repo_url);
  return k !== null && verifiedRepos.has(k);
};

/** The earnkit.txt `profile:` line names this person and origin (one parser: discovery-clues.ts profileCodesIn). */
export const siteOwnedByText = (text: string, code: string | null) => code !== null && profileCodesIn(text).includes(code.toLowerCase());

/**
 * What the server knows about a proposed contract. `deployer` and `created_at` are read onchain
 * (the creation transaction's sender and time; null is unreadable). `repo` is the verified repo whose
 * deploy file names the contract: the deployer that file names (ContractClue.deployer) and the repo's
 * GitHub created_at. `contractTaken`: another person already has this contract verified;
 * `deployerTaken`: another person's verified contract has this deployer (contractConflicts).
 */
export type ContractFacts = {
  deployer: string | null;
  created_at?: string | null;
  earnkitDeployed: boolean;
  repo?: { deployer: string | null; created_at: string | null } | null;
  contractTaken?: boolean;
  deployerTaken?: boolean;
};

/** Why a contract is refused, as its reject_reason. */
export const CONTRACT_REFUSALS = {
  taken: 'contract_claimed_by_another_person',
  unproven: 'ownership_unproven',
  deployerUnreadable: 'deployer_unreadable',
  deployerMismatch: 'deployer_not_the_repo_deployer',
  createdUnreadable: 'creation_time_unreadable',
  beforeRepo: 'deployed_before_repo_created',
  deployerTaken: 'deployer_claimed_by_another_person',
} as const;

/**
 * spec 2, fail strict: EarnKit deployed it for them, or their proven wallet created it, or (repo_link)
 * a verified repo's deploy file names it AND the onchain deployer is the one that file names AND it
 * was created after the repo AND its deployer backs no one else's contract. A contract another person
 * already has is always refused. Anyone can commit a broadcast file naming a famous contract; these
 * checks are what stop that.
 */
export function contractOwnership(c: ContractFacts, provenWallets: ReadonlySet<string>): { proof: Proof } | { reject: string } {
  const R = CONTRACT_REFUSALS;
  if (c.contractTaken) return { reject: R.taken };
  if (c.earnkitDeployed) return { proof: 'deployer' };
  const deployer = c.deployer?.toLowerCase() ?? null;
  if (deployer && provenWallets.has(deployer)) return { proof: 'deploy_wallet' };
  if (!c.repo) return { reject: R.unproven };
  if (!deployer) return { reject: R.deployerUnreadable };
  if (c.repo.deployer?.toLowerCase() !== deployer) return { reject: R.deployerMismatch };
  const made = Date.parse(c.created_at ?? '');
  const repoMade = Date.parse(c.repo.created_at ?? '');
  if (Number.isNaN(made) || Number.isNaN(repoMade)) return { reject: R.createdUnreadable };
  if (!(made > repoMade)) return { reject: R.beforeRepo };
  if (c.deployerTaken) return { reject: R.deployerTaken };
  return { proof: 'repo_link' };
}

export function contractOwned(c: ContractFacts, provenWallets: ReadonlySet<string>): Proof | null {
  const r = contractOwnership(c, provenWallets);
  return 'proof' in r ? r.proof : null;
}

/** Whether another person already has this contract, or a contract by this deployer, verified. */
export async function contractConflicts(builderId: number, ref: string, deployer: string | null, db: Db = sql()): Promise<{ contractTaken: boolean; deployerTaken: boolean }> {
  const [row] = await db<{ contract_taken: boolean; deployer_taken: boolean }[]>`
    SELECT
      EXISTS (SELECT 1 FROM builder_sources WHERE kind = 'contract' AND state = 'verified' AND builder_id <> ${builderId} AND lower(ref) = ${ref.toLowerCase()}) AS contract_taken,
      EXISTS (SELECT 1 FROM builder_sources WHERE kind = 'contract' AND state = 'verified' AND builder_id <> ${builderId} AND ${deployer?.toLowerCase() ?? null}::text IS NOT NULL AND deployer = ${deployer?.toLowerCase() ?? null}) AS deployer_taken`;
  return { contractTaken: row.contract_taken, deployerTaken: row.deployer_taken };
}

export async function proposeSource(s: { builder_id: number; kind: string; ref: string; project_key: string; proposed_by: 'agent' | 'server' }): Promise<number | null> {
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources ${sql()(s)} ON CONFLICT (builder_id, kind, ref) DO NOTHING RETURNING id`;
  if (!row) return null;
  const id = Number(row.id);
  await noteEvent('source_proposed', () => ({ type: 'source_proposed', dedupe_key: `source_proposed:${id}`, installation_id: s.builder_id, detail: { source_id: id, kind: s.kind, by: s.proposed_by } }));
  return id;
}

/**
 * `deployer` (a contract's onchain deployer) is kept so another person's repo_link by it is refused.
 * Only a proposed source is verified: a rejected or revoked one stays rejected.
 */
export async function verifySource(id: number, proof: Proof, deployer: string | null = null, db: Db = sql()): Promise<void> {
  const [row] = await db<{ builder_id: number; kind: string }[]>`
    UPDATE builder_sources SET state = 'verified', proof = ${proof}, verified_at = now(), reject_reason = NULL,
      deployer = COALESCE(${deployer?.toLowerCase() ?? null}::text, deployer)
    -- v2.13.2 fix 1: a stale source (an org repo's expired proof branch) comes back only through the
    -- App (v2.14: the re-proof is the read-only GitHub App), never through any discovery clue.
    WHERE id = ${id} AND state = 'proposed' AND (reject_reason IS DISTINCT FROM 'stale' OR ${proof}::text = 'github_app') RETURNING builder_id, kind`;
  if (row) await afterCommit(db, () => noteEvent('source_verified', () => ({ type: 'source_verified', dedupe_key: `source_verified:${id}`, installation_id: row.builder_id, detail: { source_id: id, kind: row.kind, proof } })));
}

/**
 * v2.12 T8: a site a repo only links (proof repo_link, shown but never scored) whose earnkit.txt now
 * names the person: its proof becomes earnkit_txt, so its readings count as use (siteShowsUse).
 */
export async function proveLinkedSite(id: number): Promise<void> {
  const [row] = await sql()<{ builder_id: number }[]>`
    UPDATE builder_sources SET proof = 'earnkit_txt', verified_at = now()
    WHERE id = ${id} AND kind = 'site' AND state = 'verified' AND proof = 'repo_link' RETURNING builder_id`;
  if (row) await noteEvent('source_verified', () => ({ type: 'source_verified', dedupe_key: `source_verified:${id}:earnkit_txt`, installation_id: row.builder_id, detail: { source_id: id, kind: 'site', proof: 'earnkit_txt' } }));
}

/** Refuses a proposed source, or revokes a verified one (it stops being read and scored). */
export async function rejectSource(id: number, reason: string, db: Db = sql()): Promise<void> {
  const [row] = await db<{ builder_id: number }[]>`
    UPDATE builder_sources SET state = 'rejected', reject_reason = ${reason} WHERE id = ${id} AND state <> 'rejected' RETURNING builder_id`;
  if (row) await afterCommit(db, () => noteEvent('source_rejected', () => ({ type: 'source_rejected', dedupe_key: `source_rejected:${id}:${reason}`, installation_id: row.builder_id, detail: { source_id: id, reason } })));
}

/**
 * v2.12.1 (Honesty rule): what the agent reported is shown with its numbers, marked not yet
 * confirmed, and never scored. So an agent-proposed repo, site or package is read too, for display
 * only (the score reads verified sources alone); a proposed contract or coin never is.
 */
export const READ_FOR_DISPLAY = ['repo', 'site', 'package_npm', 'package_pypi'] as const;

/**
 * Verified sources not yet read on `day`, never read first, then the oldest read; `only` limits it to
 * these people. v2.12.1: a source of a project the person no longer tracks (builder_projects.tracked
 * false, the 25-project cap) is not read; agent-proposed repos, sites and packages are read for
 * display (READ_FOR_DISPLAY), after every verified one, and only for a tracked project or one the
 * agent's latest report names; contracts and coins only on the chains EarnKit reads (base, arc).
 */
export async function dueSources(day: string, limit: number, only?: number[]): Promise<{ id: number; builder_id: number; kind: string; ref: string; last_read_day: string | null }[]> {
  const rows = await sql()<{ id: number; builder_id: number; kind: string; ref: string; last_read_day: string | null }[]>`
    SELECT b.id::int AS id, b.builder_id, b.kind, b.ref, b.last_read_day::text FROM builder_sources b
    WHERE (b.state = 'verified' OR (b.state = 'proposed' AND b.proposed_by = 'agent' AND b.kind IN ${sql()(READ_FOR_DISPLAY)}
        -- fix round 1: only a project the person tracks, or one their agent's latest report names
        AND (EXISTS (SELECT 1 FROM builder_projects p WHERE p.builder_id = b.builder_id AND p.project_key = b.project_key AND p.tracked)
          OR b.project_key IN (
            SELECT COALESCE(x->>'repo', x->>'live_url', x->>'package', x->'contracts'->>0)
            FROM builder_profiles f CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(f.identity->'projects') = 'array' THEN f.identity->'projects' ELSE '[]'::jsonb END) x
            WHERE f.builder_id = b.builder_id))))
      AND (b.kind NOT IN ('contract', 'coin') OR b.ref ~ '^(base|arc):')
      AND (b.last_read_day IS NULL OR b.last_read_day < ${day}::date)
      AND NOT EXISTS (SELECT 1 FROM builder_projects p WHERE p.builder_id = b.builder_id AND p.project_key = b.project_key AND NOT p.tracked)
      ${only ? sql()`AND b.builder_id IN ${sql()(only.length ? only : [-1])}` : sql()``}
    ORDER BY (b.state <> 'verified'), b.last_read_day NULLS FIRST, b.id LIMIT ${limit}`;
  return [...rows];
}

/** The source's latest successful reading, or null (readRepo reuses its account ages). */
export async function previousSignals(id: number): Promise<unknown> {
  const [row] = await sql()<{ signals: unknown }[]>`
    SELECT signals FROM source_readings WHERE source_id = ${id} AND ok ORDER BY day DESC LIMIT 1`;
  return row?.signals ?? null;
}

export async function writeReading(id: number, builderId: number, day: string, r: { ok: true; signals: unknown } | { ok: false; error: string }): Promise<boolean> {
  const db = sql();
  const written = await db.begin(async (tx) => {
    // Only a verified source is read, or (v2.12.1, for display, never scored) an agent-proposed repo,
    // site or package; a rejected or revoked one, or a proposed contract or coin, never gets a reading.
    const [src] = await tx<{ state: string; kind: string; proposed_by: string }[]>`
      SELECT state, kind, proposed_by FROM builder_sources WHERE id = ${id} FOR UPDATE`;
    const display = src?.state === 'proposed' && src.proposed_by === 'agent' && (READ_FOR_DISPLAY as readonly string[]).includes(src.kind);
    if (src?.state !== 'verified' && !display) return false;
    const rows = await tx`
      INSERT INTO source_readings (source_id, day, signals, ok, error)
      VALUES (${id}, ${day}, ${tx.json((r.ok ? r.signals : {}) as never)}, ${r.ok}, ${r.ok ? null : r.error.slice(0, 200)})
      ON CONFLICT (source_id, day) DO NOTHING RETURNING id`;
    await tx`UPDATE builder_sources SET last_read_day = ${day} WHERE id = ${id}`;
    return rows.length === 1;
  });
  if (written) await noteEvent('reading_taken', () => ({ type: 'reading_taken', dedupe_key: `reading:${id}:${day}`, installation_id: builderId, detail: { source_id: id, ok: r.ok } }));
  return written;
}

/**
 * A proposed contract's verdict, decided and written in one transaction: transaction-scoped advisory
 * locks on the contract and on its onchain deployer serialize every claim on either, so two people
 * claiming one contract (or two contracts of one deployer) at once can never both be verified.
 * `facts` is everything but the conflicts, which are read under the locks. Verified keeps the
 * deployer (contractConflicts); refused is the CONTRACT_REFUSALS reason.
 */
export async function claimContract(
  id: number,
  builderId: number,
  ref: string,
  facts: Omit<ContractFacts, 'contractTaken' | 'deployerTaken'>,
  provenWallets: ReadonlySet<string>,
  db?: Db,
): Promise<{ proof: Proof } | { reject: string }> {
  const deployer = facts.deployer?.toLowerCase() ?? null;
  const { result, changed } = await inTx(db, async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`v212:contract:${ref.toLowerCase()}`}))`;
    if (deployer) await tx`SELECT pg_advisory_xact_lock(hashtext(${`v212:deployer:${deployer}`}))`;
    const conflicts = await contractConflicts(builderId, ref, deployer, tx);
    const result = contractOwnership({ ...facts, deployer, ...conflicts }, provenWallets);
    const rows =
      'proof' in result
        ? await tx`
            UPDATE builder_sources SET state = 'verified', proof = ${result.proof}, verified_at = now(), reject_reason = NULL,
              deployer = COALESCE(${deployer}::text, deployer)
            WHERE id = ${id} AND builder_id = ${builderId} AND state = 'proposed' RETURNING id`
        : await tx`
            UPDATE builder_sources SET state = 'rejected', reject_reason = ${result.reject}
            WHERE id = ${id} AND builder_id = ${builderId} AND state = 'proposed' RETURNING id`;
    return { result, changed: rows.length > 0 };
  });
  if (changed && 'proof' in result)
    await afterCommit(db, () => noteEvent('source_verified', () => ({ type: 'source_verified', dedupe_key: `source_verified:${id}`, installation_id: builderId, detail: { source_id: id, kind: 'contract', proof: result.proof } })));
  if (changed && 'reject' in result)
    await afterCommit(db, () => noteEvent('source_rejected', () => ({ type: 'source_rejected', dedupe_key: `source_rejected:${id}:${result.reject}`, installation_id: builderId, detail: { source_id: id, reason: result.reject } })));
  return result;
}

const DAY_MS = 86_400_000;
type Due = { id: number; builder_id: number; kind: string; ref: string; last_read_day: string | null };

/** A merged_pr ref's target repo and number ('https://github.com/<owner>/<repo>/pull/<n>'), or null. Pure. */
export function prRef(ref: string): { target: string; number: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/(?!\.\.?\/)[A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})$/.exec(ref);
  return m ? { target: m[1].toLowerCase(), number: m[2] } : null;
}

/**
 * A merged PR re-read: the target's stars today (one GitHub read); merged_at from the previous
 * reading, or (first read) the PR itself. The author is the person's proven login.
 */
async function readPr(s: Due, d: ReaderDeps): Promise<PrSignals> {
  const p = prRef(s.ref);
  if (!p) throw new Error('not a PR url');
  const meta = await d.gh<{ stargazers_count?: unknown }>(`/repos/${p.target}`);
  const stars = typeof meta?.stargazers_count === 'number' && Number.isFinite(meta.stargazers_count) ? Math.max(0, meta.stargazers_count) : 0;
  const prev = (await previousSignals(s.id)) as Partial<PrSignals> | null;
  const valid = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x));
  let merged_at = valid(prev?.merged_at) ? prev.merged_at : null;
  if (!merged_at) {
    const pull = await d.gh<{ merged_at?: unknown }>(`/repos/${p.target}/pulls/${p.number}`);
    merged_at = valid(pull?.merged_at) ? pull.merged_at : null;
  }
  const [who] = await sql()<{ login: string | null }[]>`SELECT lower(github_login) AS login FROM builder_profiles WHERE builder_id = ${s.builder_id}`;
  return { target: p.target, target_stars: stars, merged_at, author: who?.login ?? '', url: s.ref };
}

/** One source's signals today, by kind (source-readers.ts). */
async function readOne(s: Due, now: Date, d: ReaderDeps): Promise<unknown> {
  switch (s.kind) {
    case 'repo':
      return readRepo(s.ref, d, await previousSignals(s.id));
    case 'site':
      return readSite(s.ref, d);
    case 'package_npm':
      return readNpm(s.ref, d);
    case 'package_pypi':
      return readPypi(s.ref, d);
    case 'contract': {
      // From the start of the last read day (its later calls are read again; buildInputs counts
      // each call once), else the last 365 days.
      const since = s.last_read_day ? new Date(`${s.last_read_day}T00:00:00Z`) : new Date(now.getTime() - 365 * DAY_MS);
      return readContract(s.ref, since, d);
    }
    case 'merged_pr':
      return readPr(s, d);
    case 'coin': {
      // Like a contract: from the start of the last read day, else the last 365 days. The person's
      // own proven wallets are never their coin's traders.
      const since = s.last_read_day ? new Date(`${s.last_read_day}T00:00:00Z`) : new Date(now.getTime() - 365 * DAY_MS);
      const wallets = await sql()<{ wallet: string }[]>`SELECT wallet FROM person_wallets WHERE builder_id = ${s.builder_id}`;
      return readCoin(s.ref, since, d, new Set(wallets.map((w) => `wallet:${w.wallet}`)));
    }
    default:
      throw new Error('unknown source kind');
  }
}

const REPO_REF = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/(?!\.\.?$)[a-z0-9._-]{1,100}$/i;
/** An unscoped npm name (npm's bulk downloads read takes only these; scoped ones keep readNpm). */
const bulkNpm = (s: Due) => s.kind === 'package_npm' && !s.ref.startsWith('@');

const WEEK = /^\d{4}-W\d{2}$/;
/** The ISO weeks before which a new reading adds nothing once the source has a previous one (this week and last). */
const recentFloor = (now: Date) => isoWeek(new Date(now.getTime() - 7 * DAY_MS));
/**
 * A previous VERIFIED repo reading's weeks (fix round 2, anti-backdating rule 3's baseline): one that carries its
 * commit weeks and whose push check did not fail (fix round 3: `pushes_checked: false` is no baseline).
 */
const prevWeeks = (prev: unknown): Set<string> | null => {
  const p = prev as { commit_weeks?: unknown; pushes_checked?: unknown } | null;
  if (!Array.isArray(p?.commit_weeks) || p.pushes_checked === false) return null;
  return new Set(p.commit_weeks.filter((w): w is string => typeof w === 'string' && WEEK.test(w)));
};
/** Fix round 3: the reading still needs GitHub's push check (no verified reading before it). */
export const needsPushCheck = (prev: unknown): boolean => prevWeeks(prev) === null;

/**
 * v2.13: a reading's commit counts merged with the previous reading's: the larger per week, last 52 weeks
 * only. Scoring and clarity, fix round 2 (anti-backdating rule 3): once the source has a previous good
 * reading, a new reading may add only this week and last week; an older week keeps its stored count (a
 * week the previous reading did not have never appears). Pure.
 */
export function withPastCounts(counts: Record<string, number>, prev: unknown, now: Date): Record<string, number> {
  const old = (prev as { commit_counts?: unknown } | null)?.commit_counts;
  const had = prevWeeks(prev);
  const floor = isoWeek(new Date(now.getTime() - 52 * 7 * DAY_MS));
  const recent = recentFloor(now);
  const oldCounts = old && typeof old === 'object' && !Array.isArray(old) ? (old as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  const add = (w: string, n: unknown) => {
    if (!WEEK.test(w) || w < floor || typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return;
    out[w] = Math.max(out[w] ?? 0, Math.floor(n));
  };
  for (const [w, n] of Object.entries(counts)) {
    // An older week: its stored count stands (a new or larger past count is never taken).
    if (had && w < recent) {
      if (!(w in oldCounts) && had.has(w)) add(w, n);
      continue;
    }
    add(w, n);
  }
  for (const [w, n] of Object.entries(oldCounts)) add(w, n);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The new reading's commit weeks joined with the previous good reading's (the query sees only the
 * newest 100 commits, and the score reads only the latest reading), the last 52 weeks only. Fix round 2
 * (rule 3): once the source has a previous good reading, only this week and last week can be new. Pure.
 */
export function withPastWeeks(weeks: string[], prev: unknown, now: Date): string[] {
  const had = prevWeeks(prev);
  const floor = isoWeek(new Date(now.getTime() - 52 * 7 * DAY_MS));
  const recent = recentFloor(now);
  const fresh = weeks.filter((w) => WEEK.test(w) && (!had || w >= recent || had.has(w)));
  return [...new Set([...fresh, ...(had ?? [])])].filter((w) => w >= floor).sort();
}

/** The activity types that land commits on a branch. */
const LANDED = new Set(['push', 'force_push', 'branch_creation', 'pr_merge', 'merge_queue_merge']);
/** The ISO week after `week` ('2026-W42' -> '2026-W43'). Pure. */
const nextWeek = (week: string): string | null => {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS + (Number(m[2]) - 1) * 7 * DAY_MS;
  return isoWeek(new Date(monday + 7 * DAY_MS));
};
/**
 * `pushes`: the landings on the newest page; `covered`: that page listed everything. Else `seen`: the page's oldest
 * event, and `asc`: the oldest page (its landings, whether it was full, its newest event; null: not read).
 */
type Pushes = {
  pushes: string[]; covered: boolean; seen?: string | null;
  asc?: { pushes: string[]; full: boolean; newest: string | null } | null;
};
/**
 * Fix rounds 2 to 5 (rule 4): the weeks GitHub's push record backs: a commit week counts when a landing (on
 * either page) is in that week or the following one. When the newest page did not list everything, an unbacked
 * week counts only inside the real gap between two full pages: strictly after the oldest page's newest event
 * and strictly before the newest page's oldest event (fix round 5: no week is admitted by the floor alone).
 * Null when the record can't judge (no record, no landing listed, or the oldest page not read). Pure.
 */
export function pushedWeeks(weeks: string[], record: Pushes | null): string[] | null {
  if (!record || (!record.covered && !record.asc)) return null;
  const times = [...record.pushes, ...(record.asc?.pushes ?? [])].map((t) => Date.parse(t)).filter(Number.isFinite);
  if (times.length === 0) return null;
  const landed = new Set(times.map((t) => isoWeek(new Date(t))));
  const backed = (w: string) => landed.has(w) || landed.has(nextWeek(w) ?? '');
  const week = (t: string | null | undefined) => (Number.isFinite(Date.parse(t ?? '')) ? isoWeek(new Date(Date.parse(t!))) : null);
  const after = record.asc?.full ? week(record.asc.newest) : null;
  const before = week(record.seen);
  return weeks.filter((w) => backed(w) || (!record.covered && after !== null && before !== null && w > after && w < before));
}

type Row = { timestamp?: unknown; activity_type?: unknown };
const landings = (rows: Row[]) =>
  rows.flatMap((r) => (typeof r?.timestamp === 'string' && typeof r.activity_type === 'string' && LANDED.has(r.activity_type) ? [r.timestamp] : []));
/** The oldest or newest event time on a page (any type), as ISO; null when none. */
const edge = (rows: Row[], pick: (...n: number[]) => number) => {
  const t = rows.map((r) => (typeof r?.timestamp === 'string' ? Date.parse(r.timestamp) : NaN)).filter(Number.isFinite);
  return t.length ? new Date(pick(...t)).toISOString() : null;
};
/**
 * Fix rounds 2 to 5 (rule 4): the push times of `key` from GET /repos/{key}/activity (the endpoint takes one
 * activity_type a call, so the landing types are kept here), through `get` (the App's installation client when
 * installed, else EarnKit's reader). One page of the newest 100; when it is full, one more call (direction=asc)
 * for the oldest 100. Null on any failure of the first call.
 */
export async function readPushes(key: string, get: <T>(path: string) => Promise<T | null>): Promise<Pushes | null> {
  try {
    const rows = await get<Row[]>(`/repos/${key}/activity?per_page=100`);
    if (!Array.isArray(rows)) return null;
    const pushes = landings(rows);
    if (rows.length < 100) return { pushes, covered: true };
    const asc = await get<Row[]>(`/repos/${key}/activity?direction=asc&per_page=100`).catch(() => null);
    return {
      pushes, covered: false, seen: edge(rows, Math.min),
      asc: Array.isArray(asc) ? { pushes: landings(asc), full: asc.length >= 100, newest: edge(asc, Math.max) } : null,
    };
  } catch {
    return null;
  }
}

const weekList = (x: unknown) => (Array.isArray(x) ? x.filter((w): w is string => typeof w === 'string' && WEEK.test(w)) : []);
const countMap = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, number>) : {});
/**
 * Fix rounds 2 to 5: a repo reading's commit weeks and counts as stored, with its push check.
 * - After a verified reading: only this week and last week can be new (rule 3); `pushes_checked: true`.
 * - Otherwise (the first reading, or the previous one unverified) the weeks as read, joined with the unverified
 *   previous ones, are judged by GitHub's push record (rule 4): backed weeks only, `pushes_checked: true`.
 * - No judgment (the call failed, listed nothing, or was cut or skipped by the deadline): `pushes_checked: false`;
 *   the score then counts only its last 4 weeks (never zero) until a later read verifies it. Pure.
 */
export function storedCommits(
  r: { commit_weeks: string[]; commit_counts?: Record<string, number> }, prev: unknown, now: Date, pushes: Pushes | null,
): { commit_weeks: string[]; commit_counts: Record<string, number>; pushes_checked: boolean } {
  if (!needsPushCheck(prev))
    return { commit_weeks: withPastWeeks(r.commit_weeks, prev, now), commit_counts: withPastCounts(r.commit_counts ?? {}, prev, now), pushes_checked: true };
  const p = prev as { commit_weeks?: unknown; commit_counts?: unknown } | null;
  const raw = withPastWeeks([...r.commit_weeks, ...weekList(p?.commit_weeks)], null, now);
  const rawCounts = withPastCounts({ ...countMap(p?.commit_counts), ...(r.commit_counts ?? {}) }, null, now);
  const backed = pushedWeeks(raw, pushes);
  if (!backed) return { commit_weeks: raw, commit_counts: rawCounts, pushes_checked: false };
  const keep = new Set(backed);
  return { commit_weeks: backed, commit_counts: Object.fromEntries(Object.entries(rawCounts).filter(([w]) => keep.has(w))), pushes_checked: true };
}

/**
 * Fix round 2 (rule 4): the push times of a source's repo for its first reading, through the App's installation
 * client when the person installed it on the repo, else EarnKit's reader (public repos). Null on any failure.
 */
export async function firstPushes(s: { builder_id: number; ref: string }, d: ReaderDeps): Promise<Pushes | null> {
  const key = s.ref.toLowerCase().replace(/^(https?:\/\/)?(www\.)?github\.com\//, '');
  try {
    const app = d.ghFetch ? await (await import('./repo-proof')).appClient(s.builder_id, key, d.ghFetch) : null;
    const get = app ?? (async <T,>(path: string): Promise<T | null> => d.gh<T>(path).catch(() => null));
    return await readPushes(key, get);
  } catch {
    return null;
  }
}

/**
 * Fix rounds 2 and 3: the newest good reading of a source's repo, daily or live (rule 3's "previous reading").
 * A rename or a new ref of the same repo is the same repo: any of the builder's repo sources with the same
 * GitHub repo id, else readings with the same owner and created_at (`r`, the new reading) count too.
 */
export async function previousRepoSignals(id: number, r?: { owner?: unknown; created_at?: unknown }): Promise<unknown> {
  const owner = typeof r?.owner === 'string' ? r.owner.toLowerCase() : null;
  const created = typeof r?.created_at === 'string' ? r.created_at : null;
  const [row] = await sql()<{ signals: unknown }[]>`
    WITH me AS (SELECT builder_id, gh_repo_id FROM builder_sources WHERE id = ${id}),
    srcs AS (
      SELECT b.id FROM builder_sources b, me WHERE b.builder_id = me.builder_id AND b.kind = 'repo'
        AND (b.id = ${id} OR (me.gh_repo_id IS NOT NULL AND b.gh_repo_id = me.gh_repo_id)))
    SELECT signals FROM (
      (SELECT signals, day::timestamptz + interval '1 day' AS at FROM source_readings WHERE source_id IN (SELECT id FROM srcs) AND ok ORDER BY day DESC LIMIT 1)
      UNION ALL (SELECT signals, read_at AS at FROM source_live WHERE source_id IN (SELECT id FROM srcs) AND ok)
      UNION ALL (SELECT x.signals, x.day::timestamptz + interval '1 day' FROM source_readings x JOIN builder_sources b ON b.id = x.source_id, me
        WHERE ${created}::text IS NOT NULL AND b.builder_id = me.builder_id AND b.kind = 'repo' AND x.ok
          AND x.signals->>'created_at' = ${created} AND lower(x.signals->>'owner') = ${owner} ORDER BY x.day DESC LIMIT 1)
      UNION ALL (SELECT x.signals, x.read_at FROM source_live x JOIN builder_sources b ON b.id = x.source_id, me
        WHERE ${created}::text IS NOT NULL AND b.builder_id = me.builder_id AND b.kind = 'repo' AND x.ok
          AND x.signals->>'created_at' = ${created} AND lower(x.signals->>'owner') = ${owner})
    ) x ORDER BY at DESC LIMIT 1`;
  return row?.signals ?? null;
}

/**
 * spec 6, step 2: at most READS_PER_RUN reads, while `deadline` allows. First the proposed packages
 * (verified on their first read when their metadata names a verified repo of the person, else
 * rejected `repo_mismatch`; an unreadable one is tried again the next day), then the verified
 * sources due today, never read first, then the oldest. v2.12.1 "Scale": a person's repos under
 * their login are read by one GraphQL query (person-github.ts; others by name, REPOS_MAX a call), unscoped
 * npm packages in bulk (NPM_BULK_MAX a call), coins by their transfers. A read that throws is one
 * failed reading for the day (its error class only; spec "skip, don't chase": never retried that
 * day, the last good number stays); a spent GitHub budget or the deadline writes nothing, so the
 * source stays due. Every outside read is counted per provider into read_usage.
 */
export async function readSources(now: Date, o: { deadline: number; reader: ReaderDeps; only?: number[] }): Promise<{ read: number; failed: number }> {
  const day = now.toISOString().slice(0, 10);
  const { deps, counts, stop } = countingDeps(o.reader);
  try {
    return await readAll(now, day, { ...o, reader: deps });
  } finally {
    stop();
    await flushReadUsage(day, counts);
  }
}

async function readAll(now: Date, day: string, o: { deadline: number; reader: ReaderDeps; only?: number[] }): Promise<{ read: number; failed: number }> {
  const only = o.only ? sql()`AND builder_id IN ${sql()(o.only.length ? o.only : [-1])}` : sql()``;
  const pending = await sql()<Due[]>`
    SELECT id::int AS id, builder_id, kind, ref, last_read_day::text FROM builder_sources
    WHERE state = 'proposed' AND kind IN ('package_npm', 'package_pypi')
      AND (last_read_day IS NULL OR last_read_day < ${day}::date) ${only}
    ORDER BY id LIMIT ${READS_PER_RUN}`;
  let read = 0;
  let failed = 0;
  for (const s of pending) {
    if (Date.now() >= o.deadline) return { read, failed };
    try {
      const signals = (await readOne(s, now, o.reader)) as PackageSignals;
      const repos = await sql()<{ ref: string }[]>`
        SELECT lower(ref) AS ref FROM builder_sources WHERE builder_id = ${s.builder_id} AND kind = 'repo' AND state = 'verified'`;
      if (!packageOwned(signals, new Set(repos.map((r) => r.ref)))) {
        await rejectSource(s.id, 'repo_mismatch');
        continue;
      }
      await verifySource(s.id, 'repo_link');
      if (await writeReading(s.id, s.builder_id, day, { ok: true, signals })) read++;
    } catch (err) {
      if (err instanceof ScoreDeadline) return { read, failed };
      if (isBudgetStop(err)) continue;
      // Not a reading (it isn't verified): tried again tomorrow.
      await sql()`UPDATE builder_sources SET last_read_day = ${day} WHERE id = ${s.id} AND state = 'proposed'`;
      failed++;
    }
  }
  const due = await dueSources(day, Math.max(0, READS_PER_RUN - pending.length), o.only);
  /** Sources given a reading (ok or failed) in this run. */
  const settled = new Set<number>();
  /** Sources whose read hit a spent GitHub budget: no reading, they stay due. */
  const stalled = new Set<number>();
  const ok = async (s: Due, signals: unknown) => {
    settled.add(s.id);
    if (await writeReading(s.id, s.builder_id, day, { ok: true, signals })) read++;
  };
  const fail = async (s: Due, error: string) => {
    settled.add(s.id);
    if (await writeReading(s.id, s.builder_id, day, { ok: false, error })) failed++;
  };
  /** Runs one read for `group`; false when the deadline cut it (stop the run). */
  const attempt = async (group: Due[], run: () => Promise<void>): Promise<boolean> => {
    try {
      await run();
    } catch (err) {
      // A read cut by the deadline is not a failed read: no reading, the source stays due.
      if (err instanceof ScoreDeadline) return false;
      if (isBudgetStop(err)) {
        for (const s of group) stalled.add(s.id);
        return true;
      }
      const error = err instanceof Error ? err.name : 'Error';
      for (const s of group) await fail(s, error);
    }
    return true;
  };

  /** A repo's reading written (not found: failed unless stalled or settled). Returns false when the deadline cut it. */
  /** v2.13.3 (5): `viaApp`: read with the App's token, its contributors already read with it. */
  const writeRepo = async (s: Due, r: PersonRepo | undefined, viaApp = false): Promise<boolean> => {
    if (settled.has(s.id)) return true;
    if (!r) {
      // Unread because the budget ran out is not unknown to GitHub: no reading, it stays due.
      if (!stalled.has(s.id)) await fail(s, 'not_found');
      return true;
    }
    return attempt([s], async () => {
      const contributors =
        r.owner_type === 'Organization' && !viaApp
          ? (await o.reader.gh<{ login?: unknown }[]>(`/repos/${r.key}/contributors?per_page=100`))
              .flatMap((c) => (typeof c?.login === 'string' ? [{ id: `gh:${c.login.toLowerCase()}`, at: now.toISOString() }] : []))
          : r.contributors;
      const prev = await previousRepoSignals(s.id, r);
      // Fix rounds 2 and 3 (rule 4): until a reading is verified, read GitHub's push times (the App's client when installed).
      const pushes = needsPushCheck(prev) ? await firstPushes(s, o.reader) : null;
      await ok(s, { ...r, contributors, ...storedCommits(r, prev, now, pushes) });
    });
  };

  // Repos: every due repo by name, REPOS_MAX a call across builders (v2.13 R2, "Cost": no person
  // query). An organization's repo also reads its contributors (one REST call), for the
  // top-contributor rule. A repo GitHub does not know is a failed `not_found`.
  const repos = due.filter((s) => s.kind === 'repo');
  for (const s of repos) if (!REPO_REF.test(s.ref)) await fail(s, 'not_a_repo');
  const named = repos.filter((s) => REPO_REF.test(s.ref));
  // v2.14 A10: a repo proven by the read-only App is read with its installation's token first (a per-call token,
  // never kept); EarnKit's shared token reads by name only what isn't installed.
  const viaAppIds = new Set(
    (await sql()<{ id: number }[]>`SELECT id::int AS id FROM builder_sources WHERE id IN ${sql()(named.length ? named.map((s) => s.id) : [-1])} AND proof = 'github_app' AND state = 'verified'`).map((r) => r.id),
  );
  const viaApp = new Map<number, PersonRepo>();
  for (const s of named.filter((x) => viaAppIds.has(x.id))) {
    if (Date.now() >= o.deadline) return { read, failed };
    const go = await attempt([s], async () => {
      for (const [id, r] of await readAppRepos([s], o.reader)) viaApp.set(id, r);
    });
    if (!go) return { read, failed };
  }
  const byName = named.filter((s) => !viaAppIds.has(s.id));
  const found = new Map<string, PersonRepo>();
  for (let i = 0; i < byName.length; i += REPOS_MAX) {
    if (Date.now() >= o.deadline) return { read, failed };
    const batch = byName.slice(i, i + REPOS_MAX);
    const refs = [...new Set(batch.map((s) => s.ref.toLowerCase()))];
    const go = await attempt(batch, async () => {
      for (const [k, r] of await readGithubRepos(refs, o.reader)) found.set(k, r);
    });
    if (!go) return { read, failed };
  }
  // v2.13.3 (5): what EarnKit's token couldn't read (private, or an org's it can't see), through the
  // read-only App when that source's person installed it on the repo (a per-call token, never kept).
  const unread = byName.filter((s) => !found.has(s.ref.toLowerCase()) && !settled.has(s.id) && !stalled.has(s.id));
  for (const s of unread) {
    if (Date.now() >= o.deadline) return { read, failed };
    const go = await attempt([s], async () => {
      for (const [id, r] of await readAppRepos([s], o.reader)) viaApp.set(id, r);
    });
    if (!go) return { read, failed };
  }
  for (const s of named) {
    const app = viaAppIds.has(s.id) || !found.has(s.ref.toLowerCase()) ? viaApp.get(s.id) : undefined;
    if (!(await writeRepo(s, app ?? found.get(s.ref.toLowerCase()), app !== undefined))) return { read, failed };
  }

  // Unscoped npm packages, NPM_BULK_MAX names a call (one failing call fails only its own names).
  const npm = due.filter(bulkNpm);
  const names = [...new Set(npm.map((s) => s.ref))];
  for (let i = 0; i < names.length; i += NPM_BULK_MAX) {
    if (Date.now() >= o.deadline) return { read, failed };
    const batch = new Set(names.slice(i, i + NPM_BULK_MAX));
    const group = npm.filter((s) => batch.has(s.ref));
    const go = await attempt(group, async () => {
      const weekly = await readNpmBulk([...batch], o.reader);
      for (const s of group) {
        const n = weekly.get(s.ref);
        // The repo link was checked when the package was verified.
        if (typeof n === 'number') await ok(s, { weekly: n, repo_url: null } satisfies PackageSignals);
        else await fail(s, 'no_data');
      }
    });
    if (!go) return { read, failed };
  }

  // Everything else, one source at a time.
  for (const s of due.filter((s) => s.kind !== 'repo' && !bulkNpm(s))) {
    if (Date.now() >= o.deadline) break;
    if (!(await attempt([s], async () => ok(s, await readOne(s, now, o.reader))))) break;
  }
  return { read, failed };
}
