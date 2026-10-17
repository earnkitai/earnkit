import { sql, type Db } from './db';

/** A repo is named in public only while its newest reading is at most this old (page-data.ts shownProjects' rule). */
export const PUBLIC_REPO_DAYS = 7;

/**
 * v2.13.3 review (I1): whether the person's repo source for `key` was read public within PUBLIC_REPO_DAYS:
 * its newest reading (daily or live) is ok and says not private, or the cheap read of the repo itself
 * (public_at, O5 N4) said public after that reading. The same test page-data.ts shownProjects applies, so
 * nothing public (the ship log's repo link, a coin's name and repo link) names a private repo. Fails closed.
 */
export async function repoReadPublic(builderId: number, key: string, now = new Date(), db: Db = sql()): Promise<boolean> {
  try {
    const cut = new Date(now.getTime() - PUBLIC_REPO_DAYS * 86_400_000);
    const [r] = await db<{ public: boolean }[]>`
      SELECT bool_or(COALESCE(n.ok AND n.signals->'private' = 'false'::jsonb AND n.at >= ${cut}, false)
        OR COALESCE(b.public_at >= ${cut} AND b.public_at > COALESCE(n.at, '-infinity'::timestamptz), false)) AS public
      FROM builder_sources b
      LEFT JOIN LATERAL (
        SELECT x.ok, x.signals, x.at FROM (
          (SELECT r.ok, r.signals, r.day::timestamptz AS at FROM source_readings r WHERE r.source_id = b.id ORDER BY r.day DESC LIMIT 1)
          UNION ALL (SELECT s.ok, s.signals, s.read_at FROM source_live s WHERE s.source_id = b.id ORDER BY s.read_at DESC LIMIT 1)
        ) x ORDER BY x.at DESC LIMIT 1) n ON true
      WHERE b.builder_id = ${builderId} AND b.kind = 'repo' AND b.state <> 'rejected'
        AND regexp_replace(lower(trim(b.ref)), '^(https?://)?(www[.])?github[.]com/', '') = ${key.toLowerCase()}`;
    return r?.public === true;
  } catch (err) {
    console.error('[repo-public]', err instanceof Error ? err.name : 'error');
    return false;
  }
}
