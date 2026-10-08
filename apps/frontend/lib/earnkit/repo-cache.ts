import { sql } from './db';
import type { Detection } from './match';

/**
 * GitHub repo facts for matching, cached in Postgres for an hour (v2.2 §5), keyed by the repo and
 * its pushed_at: a push makes a new key, so a cached answer never outlives the code it read.
 * Holds the chains read from the repo's files and, per window start, whether it has commits since.
 */
export const REPO_FACTS_TTL_MS = 3_600_000;

/**
 * v2.9 A2 (Pre-flight P6): the repo's own product signals for this version. The builder-dependent
 * ones (owned, active, deployed) are never cached. `addresses`: contract candidates in its files.
 */
export type CachedProduct = { young: boolean; original: boolean; readme: boolean; addresses: string[] };

export type CachedFacts = {
  chains: Detection;
  /** ISO window start -> has commits at or after it. */
  commits_since: Record<string, boolean>;
  /** v2.9 A2: null on a row read before v2.9 (then the files are read again). */
  product?: CachedProduct | null;
  fetched_at: Date;
};

/** Whether a cached row is still usable at `now`. Pure; exported for tests. */
export const isFresh = (fetchedAt: Date, now: Date) =>
  now.getTime() - fetchedAt.getTime() < REPO_FACTS_TTL_MS;

/** The cached facts for this repo version, if fetched within the hour. Errors read as a miss. */
export async function loadRepoFacts(fullName: string, pushedAt: string) {
  if (!pushedAt) return null;
  try {
    const [row] = await sql()<CachedFacts[]>`
      SELECT chains, commits_since, product, fetched_at FROM github_repo_facts
      WHERE full_name = ${fullName.toLowerCase()} AND pushed_at = ${pushedAt}`;
    return row && isFresh(row.fetched_at, new Date()) ? row : null;
  } catch (err) {
    console.error('[match] repo cache read failed:', err);
    return null;
  }
}

/**
 * Stores this repo version's facts. `fetchedAt` keeps the first fetch's time when only new
 * commit answers are added, so the hour counts from when the files were read.
 */
export async function saveRepoFacts(
  fullName: string,
  pushedAt: string,
  facts: Omit<CachedFacts, 'fetched_at'>,
  fetchedAt = new Date(),
) {
  const key = fullName.toLowerCase();
  if (!pushedAt) return; // an empty repo has no pushed_at: nothing to key on, so no cache
  try {
    await sql()`
      INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since, product, fetched_at)
      VALUES (${key}, ${pushedAt}, ${sql().json(facts.chains as never)},
        ${sql().json(facts.commits_since)}, ${facts.product ? sql().json(facts.product) : null}, ${fetchedAt})
      ON CONFLICT (full_name, pushed_at) DO UPDATE SET chains = EXCLUDED.chains,
        commits_since = EXCLUDED.commits_since, product = EXCLUDED.product, fetched_at = EXCLUDED.fetched_at`;
    // Older versions of this repo, and anything past its hour, are of no further use.
    await sql()`
      DELETE FROM github_repo_facts
      WHERE (full_name = ${key} AND pushed_at <> ${pushedAt})
        OR fetched_at < now() - interval '1 day'`;
  } catch (err) {
    console.error('[match] repo cache write failed:', err);
  }
}
