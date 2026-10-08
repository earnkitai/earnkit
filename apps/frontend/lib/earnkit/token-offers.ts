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

/**
 * Stores (or replaces) the pair shown. v2.9 Ruling G14: `firstReply` marks the first reply's token
 * offer (list_programs); the mark stays when a later offer replaces the pair.
 */
export async function saveOffer(installationId: number, programId: string, key: string, o: Offered, firstReply = false): Promise<void> {
  const mark = firstReply ? new Date() : null;
  await sql()`
    INSERT INTO token_offers (installation_id, program_id, entry_key, offered_name, offered_ticker, first_reply_at)
    VALUES (${installationId}, ${programId}, ${key}, ${o.name}, ${o.symbol}, ${mark})
    ON CONFLICT (installation_id, program_id, entry_key) DO UPDATE SET
      offered_name = EXCLUDED.offered_name, offered_ticker = EXCLUDED.offered_ticker, offered_at = now(),
      first_reply_at = COALESCE(token_offers.first_reply_at, EXCLUDED.first_reply_at)`;
}

/**
 * v2.9 Ruling G14 (M1): the first reply offered this repo's token for this program, so the entry
 * flow has said "40%": later offers in it use the repeat wording.
 */
export async function firstReplyShown(installationId: number, programId: string, key: string): Promise<boolean> {
  const [row] = await sql()<{ ok: number }[]>`
    SELECT 1 AS ok FROM token_offers
    WHERE installation_id = ${installationId} AND program_id = ${programId} AND entry_key = ${key} AND first_reply_at IS NOT NULL`;
  return Boolean(row);
}

/** The pair last shown for this entry, or null. */
export async function readOffer(installationId: number, programId: string, key: string): Promise<Offered | null> {
  const [row] = await sql()<{ offered_name: string; offered_ticker: string }[]>`
    SELECT offered_name, offered_ticker FROM token_offers
    WHERE installation_id = ${installationId} AND program_id = ${programId} AND entry_key = ${key}`;
  return row ? { name: row.offered_name, symbol: row.offered_ticker } : null;
}

/**
 * v2.9 B10: the token offer's identity for a decline (Ruling G12): the program and when its pair was
 * last shown (token_offers.offered_at), else the program alone. A new offer shown is a new identity.
 */
export async function offerIdentity(installationId: number, programId: string, key: string): Promise<string> {
  const [row] = await sql()<{ offered_at: Date }[]>`
    SELECT offered_at FROM token_offers
    WHERE installation_id = ${installationId} AND program_id = ${programId} AND entry_key = ${key}`;
  return row ? `${programId}@${row.offered_at.toISOString()}` : programId;
}

/**
 * v2.9 B10: the builder said skip to a token offer for this repo (`repoKey`, answer-bank.ts:
 * owner/repo). Returns the decline count; at 2 the repo's token is never offered again. Ruling G12:
 * counted once per offer (`offer`, offerIdentity), so a retried skip changes nothing; `login` is the
 * builder (memoryKey: '' off shared clients, the verified login on one).
 */
export async function recordDecline(
  installationId: number,
  repoKey: string,
  now: Date = new Date(),
  o: { login?: string; offer?: string } = {},
): Promise<number> {
  const login = o.login ?? '';
  const offer = o.offer ?? `at:${now.toISOString()}`;
  const [row] = await sql()<{ count: number }[]>`
    INSERT INTO token_declines (installation_id, login, repo_key, last_at, offers)
    VALUES (${installationId}, ${login}, ${repoKey}, ${now}, ARRAY[${offer}]::text[])
    ON CONFLICT (installation_id, login, repo_key) DO UPDATE SET
      count = token_declines.count + CASE WHEN ${offer} = ANY(token_declines.offers) THEN 0 ELSE 1 END,
      offers = CASE WHEN ${offer} = ANY(token_declines.offers) THEN token_declines.offers ELSE token_declines.offers || ${offer}::text END,
      last_at = EXCLUDED.last_at
    RETURNING count`;
  return row.count;
}

/** v2.9 B10: the decline count per repo key (owner/repo) for one builder (`login`); a repo never declined is absent. */
export async function declines(installationId: number, repoKeys: string[], login = ''): Promise<Map<string, number>> {
  if (repoKeys.length === 0) return new Map();
  const rows = await sql()<{ repo_key: string; count: number }[]>`
    SELECT repo_key, count FROM token_declines
    WHERE installation_id = ${installationId} AND login = ${login} AND repo_key IN ${sql()(repoKeys)}`;
  return new Map(rows.map((r) => [r.repo_key, r.count]));
}

/** v2.9 B10, Pre-flight P23: at this many skips a repo's token is never offered again. */
export const DECLINES_MAX = 2;
