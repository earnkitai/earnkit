import { sql } from './db';
import { normalizeRepoUrl } from './campaigns';
import type { Detection, Odds } from './match';

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
export type CachedProduct = {
  young: boolean;
  /** v2.10 item 6: false for a starter too. */
  original: boolean;
  readme: boolean;
  addresses: string[];
  /** v2.10 item 6 (R7): an EarnKit chain-kit example by package name or README heading. A row without it is read again. */
  starter?: boolean;
  /** v2.10 item 6: the traction and odds of the last scoring (for reads without GitHub). */
  traction?: number;
  odds?: Odds;
};

export type CachedFacts = {
  chains: Detection;
  /** ISO window start -> has commits at or after it. */
  commits_since: Record<string, boolean>;
  /** v2.9 A2: null on a row read before v2.9 (then the files are read again). */
  product?: CachedProduct | null;
  /** v2.10 R10: read through the read-only GitHub App (a private repo): never public evidence. */
  via_app?: boolean;
  fetched_at: Date;
};

/** Whether a cached row is still usable at `now`. Pure; exported for tests. */
export const isFresh = (fetchedAt: Date, now: Date) =>
  now.getTime() - fetchedAt.getTime() < REPO_FACTS_TTL_MS;

/**
 * The cached facts for this repo version, if fetched within the hour. Errors read as a miss.
 * v2.10 fix round 1 (I2): a row read through the App (`via_app`) is returned only to a read that
 * holds an App token for the repo itself (`o.viaApp`), never to anyone naming it.
 */
export async function loadRepoFacts(fullName: string, pushedAt: string, o: { viaApp?: boolean } = {}) {
  if (!pushedAt) return null;
  try {
    const [row] = await sql()<CachedFacts[]>`
      SELECT chains, commits_since, product, fetched_at FROM github_repo_facts
      WHERE full_name = ${fullName.toLowerCase()} AND pushed_at = ${pushedAt} AND (NOT via_app OR ${o.viaApp === true})`;
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
      INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since, product, fetched_at, via_app)
      VALUES (${key}, ${pushedAt}, ${sql().json(facts.chains as never)},
        ${sql().json(facts.commits_since)}, ${facts.product ? sql().json(facts.product) : null}, ${fetchedAt}, ${facts.via_app === true})
      ON CONFLICT (full_name, pushed_at) DO UPDATE SET chains = EXCLUDED.chains,
        commits_since = EXCLUDED.commits_since, product = EXCLUDED.product, fetched_at = EXCLUDED.fetched_at,
        -- v2.10 R10: once read through the App, the row stays private (fail closed).
        via_app = github_repo_facts.via_app OR EXCLUDED.via_app`;
    // Older versions of this repo, and anything past its hour, are of no further use.
    await sql()`
      DELETE FROM github_repo_facts
      WHERE (full_name = ${key} AND pushed_at <> ${pushedAt})
        OR fetched_at < now() - interval '1 day'`;
  } catch (err) {
    console.error('[match] repo cache write failed:', err);
  }
}

/**
 * v2.10 Ruling H6: how long an anonymous public read of a repo lets public pages show its URL.
 * Past it (or with no such read, or a failed one) a public page shows the project name only.
 */
export const PUBLIC_READ_DAYS = 7;
const PUBLIC_READ_MS = PUBLIC_READ_DAYS * 86_400_000;

/** The key public reads are stored under: a repo link or `owner/repo`, normalized (campaigns.ts). Pure. */
export const publicReadKey = (repo: string) =>
  normalizeRepoUrl(/^[^/:]+\/[^/]+$/.test(repo.trim()) ? `github.com/${repo}` : repo);

/**
 * v2.10 Ruling H6: GitHub just said this repo is public (`private: false` on a read made without
 * an App token). Kept in repo_public_reads, which outlives the 1-day facts purge. Never throws.
 */
export async function markRepoPublic(fullName: string, now = new Date()) {
  try {
    await sql()`
      INSERT INTO repo_public_reads (repo_key, read_at) VALUES (${publicReadKey(fullName)}, ${now})
      ON CONFLICT (repo_key) DO UPDATE SET read_at = GREATEST(repo_public_reads.read_at, EXCLUDED.read_at)`;
  } catch (err) {
    console.error('[match] public read write failed:', err instanceof Error ? err.name : 'error');
  }
}

/**
 * v2.10 Ruling H6: of these repo links, the normalized keys with an anonymous public read in the
 * last PUBLIC_READ_DAYS. Fails closed: a failed read of the table is an empty set.
 */
export async function publicRepoKeys(urls: (string | null | undefined)[], now = new Date()): Promise<Set<string>> {
  const keys = [...new Set(urls.filter((u): u is string => Boolean(u)).map(publicReadKey))];
  if (keys.length === 0) return new Set();
  try {
    const rows = await sql()<{ repo_key: string }[]>`
      SELECT repo_key FROM repo_public_reads WHERE repo_key IN ${sql()(keys)} AND read_at > ${new Date(now.getTime() - PUBLIC_READ_MS)}`;
    return new Set(rows.map((r) => r.repo_key));
  } catch (err) {
    console.error('[match] public read check failed:', err instanceof Error ? err.name : 'error');
    return new Set();
  }
}

/**
 * v2.10 Ruling H6: a repo link a public page may show: only with a fresh public read in `shown`
 * (publicRepoKeys), else null (the project name only). Pure.
 */
export const publicRepoUrl = (url: string | null | undefined, shown: Set<string>) =>
  url && shown.has(publicReadKey(url)) ? url : null;

/** v2.10 fix round 1: the hourly cron drops public reads past their window, at most `limit` a run. */
export async function sweepPublicReads(now = new Date(), limit = 1000): Promise<number> {
  const rows = await sql()`
    DELETE FROM repo_public_reads WHERE repo_key IN (
      SELECT repo_key FROM repo_public_reads WHERE read_at < ${new Date(now.getTime() - PUBLIC_READ_MS)} LIMIT ${limit})`;
  return rows.count;
}
