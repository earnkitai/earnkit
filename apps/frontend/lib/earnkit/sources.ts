import { sql } from './db';
import { profileCodesIn } from './discovery-clues';
import { noteEvent } from './events';
import type { PackageSignals, RepoSignals } from './source-readers';

/** spec 6: at most this many sources are read a run (oldest first). */
export const READS_PER_RUN = 200;

/** v2.12 spec 2: a person's sources and their daily readings. Only the server verifies (owner rule 1). */
export type Proof = 'github_signin' | 'proof_line' | 'repo_owner' | 'deployer' | 'deploy_wallet' | 'earnkit_txt' | 'dns_txt' | 'repo_link';

export const repoOwned = (s: RepoSignals, login: string, topContributor: boolean, everDerived: boolean) =>
  !s.fork && !s.template && !everDerived && (s.owner === login.toLowerCase() || topContributor);

const repoKeyOf = (url: string | null) => url?.replace(/^https:\/\/github\.com\//, '').toLowerCase() ?? null;
export const packageOwned = (p: PackageSignals, verifiedRepos: ReadonlySet<string>) => {
  const k = repoKeyOf(p.repo_url);
  return k !== null && verifiedRepos.has(k);
};

/** The earnkit.txt `profile:` line names this person and origin (one parser: discovery-clues.ts profileCodesIn). */
export const siteOwnedByText = (text: string, code: string | null) => code !== null && profileCodesIn(text).includes(code.toLowerCase());

export function contractOwned(c: { deployer: string | null; earnkitDeployed: boolean; inVerifiedRepo: boolean }, provenWallets: ReadonlySet<string>): Proof | null {
  if (c.earnkitDeployed) return 'deployer';
  if (c.deployer && provenWallets.has(c.deployer.toLowerCase())) return 'deploy_wallet';
  if (c.inVerifiedRepo) return 'repo_link';
  return null;
}

export async function proposeSource(s: { builder_id: number; kind: string; ref: string; project_key: string; proposed_by: 'agent' | 'server' }): Promise<number | null> {
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources ${sql()(s)} ON CONFLICT (builder_id, kind, ref) DO NOTHING RETURNING id`;
  if (!row) return null;
  const id = Number(row.id);
  await noteEvent('source_proposed', () => ({ type: 'source_proposed', dedupe_key: `source_proposed:${id}`, installation_id: s.builder_id, detail: { source_id: id, kind: s.kind, by: s.proposed_by } }));
  return id;
}

export async function verifySource(id: number, proof: Proof): Promise<void> {
  const [row] = await sql()<{ builder_id: number; kind: string }[]>`
    UPDATE builder_sources SET state = 'verified', proof = ${proof}, verified_at = now(), reject_reason = NULL
    WHERE id = ${id} AND state <> 'verified' RETURNING builder_id, kind`;
  if (row) await noteEvent('source_verified', () => ({ type: 'source_verified', dedupe_key: `source_verified:${id}`, installation_id: row.builder_id, detail: { source_id: id, kind: row.kind, proof } }));
}

export async function rejectSource(id: number, reason: string): Promise<void> {
  const [row] = await sql()<{ builder_id: number }[]>`
    UPDATE builder_sources SET state = 'rejected', reject_reason = ${reason} WHERE id = ${id} AND state = 'proposed' RETURNING builder_id`;
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

export async function writeReading(id: number, builderId: number, day: string, r: { ok: true; signals: unknown } | { ok: false; error: string }): Promise<boolean> {
  const db = sql();
  const written = await db.begin(async (tx) => {
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
