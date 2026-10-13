import { ScoreDeadline } from './campaigns';
import { sql, type Db } from './db';
import { profileCodesIn } from './discovery-clues';
import { noteEvent } from './events';
import { REPOS_MAX, readGithubRepos, readPersonGithub, type PersonRepo } from './person-github';
import { countingDeps, flushReadUsage } from './read-usage';
import { NPM_BULK_MAX, isBudgetStop, isoWeek, readCoin, readContract, readNpm, readNpmBulk, readPypi, readRepo, readSite, type PackageSignals, type PrSignals, type ReaderDeps, type RepoSignals } from './source-readers';

/** spec 6: at most this many sources are read a run (oldest first). */
export const READS_PER_RUN = 200;

/** v2.12 spec 2: a person's sources and their daily readings. Only the server verifies (owner rule 1). */
export type Proof = 'github_signin' | 'proof_line' | 'repo_owner' | 'deployer' | 'deploy_wallet' | 'earnkit_txt' | 'dns_txt' | 'repo_link';

/** Their own non-fork, non-template, never-derived repo; someone else's only when it is an organization's and they are its top contributor. */
export const repoOwned = (s: RepoSignals, login: string, topContributor: boolean, everDerived: boolean) =>
  !s.fork && !s.template && !everDerived && (s.owner === login.toLowerCase() || (topContributor && s.owner_type === 'Organization'));

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
export async function verifySource(id: number, proof: Proof, deployer: string | null = null): Promise<void> {
  const [row] = await sql()<{ builder_id: number; kind: string }[]>`
    UPDATE builder_sources SET state = 'verified', proof = ${proof}, verified_at = now(), reject_reason = NULL,
      deployer = COALESCE(${deployer?.toLowerCase() ?? null}::text, deployer)
    WHERE id = ${id} AND state = 'proposed' RETURNING builder_id, kind`;
  if (row) await noteEvent('source_verified', () => ({ type: 'source_verified', dedupe_key: `source_verified:${id}`, installation_id: row.builder_id, detail: { source_id: id, kind: row.kind, proof } }));
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
export async function rejectSource(id: number, reason: string): Promise<void> {
  const [row] = await sql()<{ builder_id: number }[]>`
    UPDATE builder_sources SET state = 'rejected', reject_reason = ${reason} WHERE id = ${id} AND state <> 'rejected' RETURNING builder_id`;
  if (row) await noteEvent('source_rejected', () => ({ type: 'source_rejected', dedupe_key: `source_rejected:${id}:${reason}`, installation_id: row.builder_id, detail: { source_id: id, reason } }));
}

/**
 * Verified sources not yet read on `day`, never read first, then the oldest read; `only` limits it to
 * these people. v2.12.1: a source of a project the person no longer tracks (builder_projects.tracked
 * false, the 25-project cap) is not read.
 */
export async function dueSources(day: string, limit: number, only?: number[]): Promise<{ id: number; builder_id: number; kind: string; ref: string; last_read_day: string | null }[]> {
  const rows = await sql()<{ id: number; builder_id: number; kind: string; ref: string; last_read_day: string | null }[]>`
    SELECT b.id::int AS id, b.builder_id, b.kind, b.ref, b.last_read_day::text FROM builder_sources b
    WHERE b.state = 'verified' AND (b.last_read_day IS NULL OR b.last_read_day < ${day}::date)
      AND NOT EXISTS (SELECT 1 FROM builder_projects p WHERE p.builder_id = b.builder_id AND p.project_key = b.project_key AND NOT p.tracked)
      ${only ? sql()`AND b.builder_id IN ${sql()(only.length ? only : [-1])}` : sql()``}
    ORDER BY b.last_read_day NULLS FIRST, b.id LIMIT ${limit}`;
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
    // Only a verified source is read (a proposed, rejected or revoked one never gets a reading).
    const [src] = await tx<{ state: string }[]>`SELECT state FROM builder_sources WHERE id = ${id} FOR UPDATE`;
    if (src?.state !== 'verified') return false;
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
): Promise<{ proof: Proof } | { reject: string }> {
  const deployer = facts.deployer?.toLowerCase() ?? null;
  const { result, changed } = await sql().begin(async (tx) => {
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
    await noteEvent('source_verified', () => ({ type: 'source_verified', dedupe_key: `source_verified:${id}`, installation_id: builderId, detail: { source_id: id, kind: 'contract', proof: result.proof } }));
  if (changed && 'reject' in result)
    await noteEvent('source_rejected', () => ({ type: 'source_rejected', dedupe_key: `source_rejected:${id}:${result.reject}`, installation_id: builderId, detail: { source_id: id, reason: result.reject } }));
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

const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
const ownerOf = (ref: string) => ref.toLowerCase().split('/')[0];
/** An unscoped npm name (npm's bulk downloads read takes only these; scoped ones keep readNpm). */
const bulkNpm = (s: Due) => s.kind === 'package_npm' && !s.ref.startsWith('@');

/** The login a person's own repos are read under: the proven login, else the reported one, else none. */
async function personLogin(builderId: number): Promise<string | null> {
  const [row] = await sql()<{ login: string | null; reported: string | null }[]>`
    SELECT lower(github_login) AS login, lower(reported_github) AS reported FROM builder_profiles WHERE builder_id = ${builderId}`;
  return [row?.login, row?.reported].find((l): l is string => typeof l === 'string' && LOGIN.test(l)) ?? null;
}

const WEEK = /^\d{4}-W\d{2}$/;
/**
 * The new reading's commit weeks joined with the previous good reading's (the query sees only the
 * newest 100 commits, and the score reads only the latest reading), the last 52 weeks only. Pure.
 */
export function withPastWeeks(weeks: string[], prev: unknown, now: Date): string[] {
  const old = (prev as { commit_weeks?: unknown } | null)?.commit_weeks;
  const floor = isoWeek(new Date(now.getTime() - 52 * 7 * DAY_MS));
  const all = [...weeks, ...(Array.isArray(old) ? old.filter((w): w is string => typeof w === 'string' && WEEK.test(w)) : [])];
  return [...new Set(all)].filter((w) => w >= floor).sort();
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
      if (isBudgetStop(err)) return true;
      const error = err instanceof Error ? err.name : 'Error';
      for (const s of group) await fail(s, error);
    }
    return true;
  };

  // Repos, per person: one GraphQL query for those under the person's login (newest 100 pushed),
  // then the rest by name, REPOS_MAX a call (one outside the newest 100, an organization's, or all of
  // them when the person has no login). An organization's repo also reads its contributors (one
  // REST call), for the top-contributor rule. A repo GitHub does not know is a failed `not_found`.
  const people = new Map<number, Due[]>();
  for (const s of due) if (s.kind === 'repo') people.set(s.builder_id, [...(people.get(s.builder_id) ?? []), s]);
  for (const [builderId, repos] of people) {
    if (Date.now() >= o.deadline) return { read, failed };
    const login = await personLogin(builderId);
    const found = new Map<string, PersonRepo>();
    const mine = login ? repos.filter((s) => ownerOf(s.ref) === login) : [];
    if (mine.length > 0) {
      const go = await attempt(mine, async () => {
        const person = await readPersonGithub(login!, o.reader);
        for (const [k, r] of person?.repos ?? []) found.set(k, r);
      });
      if (!go) return { read, failed };
    }
    // A repo the person query failed on already has its failed reading (settled).
    const rest = repos.filter((s) => !found.has(s.ref.toLowerCase()) && !settled.has(s.id));
    for (let i = 0; i < rest.length; i += REPOS_MAX) {
      const batch = rest.slice(i, i + REPOS_MAX);
      const go = await attempt(batch, async () => {
        for (const [k, r] of await readGithubRepos(batch.map((s) => s.ref), o.reader)) found.set(k, r);
      });
      if (!go) return { read, failed };
    }
    for (const s of repos) {
      if (settled.has(s.id)) continue;
      const r = found.get(s.ref.toLowerCase());
      if (!r) {
        await fail(s, 'not_found');
        continue;
      }
      const go = await attempt([s], async () => {
        const contributors =
          r.owner_type === 'Organization'
            ? (await o.reader.gh<{ login?: unknown }[]>(`/repos/${r.key}/contributors?per_page=100`))
                .flatMap((c) => (typeof c?.login === 'string' ? [{ id: `gh:${c.login.toLowerCase()}`, at: now.toISOString() }] : []))
            : r.contributors;
        await ok(s, { ...r, contributors, commit_weeks: withPastWeeks(r.commit_weeks, await previousSignals(s.id), now) });
      });
      if (!go) return { read, failed };
    }
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
