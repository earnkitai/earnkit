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
