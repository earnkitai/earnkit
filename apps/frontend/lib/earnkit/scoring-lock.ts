import { sql } from './db';

/** How long a scoring claim lasts: past the pass's budget, so a crashed pass frees it soon. */
const SCORING_LEASE_MS = 60_000;

/**
 * Runs `fn` holding this campaign's scoring lease (a row in scoring_leases, claimed and released
 * by single statements), so concurrent status calls never score the same entries at once. No
 * connection is held while `fn` runs its network reads; its writes are single statements.
 * 'busy' when another call holds an unexpired lease. `leaseMs`: how long the claim lasts (the cron's
 * campaign lifecycle holds it for its whole budget).
 */
export async function withScoringLock<T>(
  programId: string,
  fn: () => Promise<T>,
  leaseMs = SCORING_LEASE_MS,
): Promise<T | 'busy'> {
  const until = new Date(Date.now() + leaseMs);
  const [claimed] = await sql()`
    INSERT INTO scoring_leases (program_id, until) VALUES (${programId}, ${until})
    ON CONFLICT (program_id) DO UPDATE SET until = EXCLUDED.until
      WHERE scoring_leases.until < now()
    RETURNING program_id`;
  if (!claimed) return 'busy';
  try {
    return await fn();
  } finally {
    await sql()`DELETE FROM scoring_leases WHERE program_id = ${programId} AND until = ${until}`;
  }
}
