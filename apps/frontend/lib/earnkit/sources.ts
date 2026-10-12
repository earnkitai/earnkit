import { sql } from './db';
import { profileCodesIn } from './discovery-clues';
import { noteEvent } from './events';
import type { PackageSignals, RepoSignals } from './source-readers';

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
export async function contractConflicts(builderId: number, ref: string, deployer: string | null): Promise<{ contractTaken: boolean; deployerTaken: boolean }> {
  const [row] = await sql()<{ contract_taken: boolean; deployer_taken: boolean }[]>`
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

/** `deployer` (a contract's onchain deployer) is kept so another person's repo_link by it is refused. */
export async function verifySource(id: number, proof: Proof, deployer: string | null = null): Promise<void> {
  const [row] = await sql()<{ builder_id: number; kind: string }[]>`
    UPDATE builder_sources SET state = 'verified', proof = ${proof}, verified_at = now(), reject_reason = NULL,
      deployer = COALESCE(${deployer?.toLowerCase() ?? null}::text, deployer)
    WHERE id = ${id} AND state <> 'verified' RETURNING builder_id, kind`;
  if (row) await noteEvent('source_verified', () => ({ type: 'source_verified', dedupe_key: `source_verified:${id}`, installation_id: row.builder_id, detail: { source_id: id, kind: row.kind, proof } }));
}

/** Refuses a proposed source, or revokes a verified one (it stops being read and scored). */
export async function rejectSource(id: number, reason: string): Promise<void> {
  const [row] = await sql()<{ builder_id: number }[]>`
    UPDATE builder_sources SET state = 'rejected', reject_reason = ${reason} WHERE id = ${id} AND state <> 'rejected' RETURNING builder_id`;
  if (row) await noteEvent('source_rejected', () => ({ type: 'source_rejected', dedupe_key: `source_rejected:${id}:${reason}`, installation_id: row.builder_id, detail: { source_id: id, reason } }));
}

/** Verified sources not yet read on `day`, never read first, then the oldest read; `only` limits it to these people. */
export async function dueSources(day: string, limit: number, only?: number[]): Promise<{ id: number; builder_id: number; kind: string; ref: string; last_read_day: string | null }[]> {
  const rows = await sql()<{ id: number; builder_id: number; kind: string; ref: string; last_read_day: string | null }[]>`
    SELECT id::int AS id, builder_id, kind, ref, last_read_day::text FROM builder_sources
    WHERE state = 'verified' AND (last_read_day IS NULL OR last_read_day < ${day}::date)
      ${only ? sql()`AND builder_id IN ${sql()(only.length ? only : [-1])}` : sql()``}
    ORDER BY last_read_day NULLS FIRST, id LIMIT ${limit}`;
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
