import { sql } from './db';
import { defaultReaderDeps, readContractOrigin, type ContractOrigin } from './source-readers';

/**
 * v3.1 Highlights fix round 1: the bounded backfill of builder_sources.deployed_at ("First deployed") for Base contract
 * sources verified before discovery kept the creation time. Blockscout's creation transaction (free, keyless; the read
 * discovery already makes at verification), at most ORIGIN_READS_PER_RUN a cron run; a contract is asked once, or again
 * after ORIGIN_RETRY_MS when Blockscout had no time for it (origin_read_at).
 */
export const ORIGIN_READS_PER_RUN = 20;
export const ORIGIN_RETRY_MS = 7 * 86_400_000;

export async function backfillContractOrigins(
  now: Date,
  o: { origin?: (ref: string) => Promise<ContractOrigin>; limit?: number; only?: number[]; deadline?: number } = {},
): Promise<{ due: number; dated: number }> {
  const db = sql();
  const due = await db<{ id: number; ref: string }[]>`
    SELECT id::int AS id, lower(ref) AS ref FROM builder_sources
    WHERE kind = 'contract' AND state = 'verified' AND deployed_at IS NULL AND lower(ref) ~ '^base:0x[0-9a-f]{40}$'
      AND (origin_read_at IS NULL OR origin_read_at <= ${new Date(now.getTime() - ORIGIN_RETRY_MS)})
      ${o.only ? db`AND builder_id IN ${db(o.only)}` : db``}
    ORDER BY origin_read_at NULLS FIRST, id LIMIT ${o.limit ?? ORIGIN_READS_PER_RUN}`;
  const deadline = o.deadline ?? Date.now() + 60_000;
  const origin = o.origin ?? ((ref: string) => readContractOrigin(ref, defaultReaderDeps(now, deadline)));
  let dated = 0;
  for (const s of due) {
    if (Date.now() >= deadline) break;
    const at = await origin(s.ref).then(
      (r) => (r.created_at && !Number.isNaN(Date.parse(r.created_at)) ? r.created_at : null),
      (err: unknown) => {
        console.error('[origins] read', s.id, err instanceof Error ? err.name : 'error');
        return null;
      },
    );
    await db`UPDATE builder_sources SET origin_read_at = ${now}, deployed_at = COALESCE(deployed_at, ${at}::timestamptz) WHERE id = ${s.id}`;
    if (at) dated++;
  }
  return { due: due.length, dated };
}
