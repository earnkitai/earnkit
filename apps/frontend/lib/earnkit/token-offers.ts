import { normalizeRepoUrl } from './campaigns';
import { sql } from './db';

/**
 * v2.8.1 fix round 1 (§A2): the exact token the confirmation's Yes line showed, kept per entry (this
 * agent, program and project), so "go" launches what the builder saw and nothing else.
 */
export type Offered = { name: string; symbol: string };

/** The entry's key: the normalized repo, else "name:<lowercased name>" (ownEntry's own match). Pure. */
export const offerKey = (repoUrl: string | null | undefined, name: string) =>
  repoUrl ? normalizeRepoUrl(repoUrl) : `name:${name.trim().toLowerCase()}`;

/** Stores (or replaces) the pair shown. */
export async function saveOffer(installationId: number, programId: string, key: string, o: Offered): Promise<void> {
  await sql()`
    INSERT INTO token_offers (installation_id, program_id, entry_key, offered_name, offered_ticker)
    VALUES (${installationId}, ${programId}, ${key}, ${o.name}, ${o.symbol})
    ON CONFLICT (installation_id, program_id, entry_key) DO UPDATE SET
      offered_name = EXCLUDED.offered_name, offered_ticker = EXCLUDED.offered_ticker, offered_at = now()`;
}

/** The pair last shown for this entry, or null. */
export async function readOffer(installationId: number, programId: string, key: string): Promise<Offered | null> {
  const [row] = await sql()<{ offered_name: string; offered_ticker: string }[]>`
    SELECT offered_name, offered_ticker FROM token_offers
    WHERE installation_id = ${installationId} AND program_id = ${programId} AND entry_key = ${key}`;
  return row ? { name: row.offered_name, symbol: row.offered_ticker } : null;
}

/**
 * v2.9 B10: the builder said skip to a token offer for this repo (`repoKey`, answer-bank.ts:
 * owner/repo). Returns the decline count; at 2 the repo's token is never offered again.
 */
export async function recordDecline(installationId: number, repoKey: string, now: Date = new Date()): Promise<number> {
  const [row] = await sql()<{ count: number }[]>`
    INSERT INTO token_declines (installation_id, repo_key, last_at) VALUES (${installationId}, ${repoKey}, ${now})
    ON CONFLICT (installation_id, repo_key) DO UPDATE SET count = token_declines.count + 1, last_at = EXCLUDED.last_at
    RETURNING count`;
  return row.count;
}

/** v2.9 B10: the decline count per repo key (owner/repo); a repo never declined is absent. */
export async function declines(installationId: number, repoKeys: string[]): Promise<Map<string, number>> {
  if (repoKeys.length === 0) return new Map();
  const rows = await sql()<{ repo_key: string; count: number }[]>`
    SELECT repo_key, count FROM token_declines WHERE installation_id = ${installationId} AND repo_key IN ${sql()(repoKeys)}`;
  return new Map(rows.map((r) => [r.repo_key, r.count]));
}

/** v2.9 B10, Pre-flight P23: at this many skips a repo's token is never offered again. */
export const DECLINES_MAX = 2;
