import { sql } from './db';
import { chainPools } from './bench-rank';
import { listedRanked } from './person-score';
import { avatarUrl, displayName } from './page-data';
import { pillOf } from './raising';
import { BENCH_CHAINS, CHAIN_CHIP_MIN, benchRank, type BenchChain } from './rank';

/** v2.13 spec "The Bench": its rows and its URL filters (R9). */
export type BenchFilter = { chain: BenchChain | null; raising: boolean; weekly: boolean };
/** "Shipping every week": a streak of at least this many weeks. */
export const WEEKLY_STREAK = 4;
export const BENCH_MAX = 100;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/** Pure. Anything but one known value per key is ignored, so at most 4 x 2 x 2 = 16 variants exist. */
export function parseBenchFilter(q: Record<string, string | string[] | undefined>): BenchFilter {
  const c = one(q.chain)?.toLowerCase();
  return { chain: (BENCH_CHAINS as readonly string[]).includes(c ?? '') ? (c as BenchChain) : null, raising: one(q.raising) === '1', weekly: one(q.weekly) === '1' };
}

/** Pure. The one URL of a filter variant (also its cache key). */
export function filterHref(f: BenchFilter): string {
  const p = new URLSearchParams();
  if (f.chain) p.set('chain', f.chain);
  if (f.raising) p.set('raising', '1');
  if (f.weekly) p.set('weekly', '1');
  const s = p.toString();
  return s ? `/bench?${s}` : '/bench';
}

/** Pure. The project's one best fact in plain words: people this week, then the streak, then weeks shipping. */
export function bestFact(p: { people_week: number; streak: number; weeks_shipping: number; shipped: boolean }): string {
  if (p.people_week > 0) return `${p.people_week.toLocaleString('en-US')} ${p.people_week === 1 ? 'person' : 'people'} this week`;
  if (p.streak >= 2) return `${p.streak} weeks in a row`;
  if (p.weeks_shipping > 0) return `${p.weeks_shipping} ${p.weeks_shipping === 1 ? 'week' : 'weeks'} shipping`;
  return p.shipped ? 'Live' : 'Building';
}

export type BenchRow = { rank: number; line: string | null; handle: string; name: string; avatar: string | null; raising: { symbol: string; url: string } | null; chains: BenchChain[]; project: string; best: string };

/**
 * The Bench: the listed ranked people (listedRanked: ranked means the one project is confirmed),
 * best score first, filtered by chain, raising and the weekly streak. A rank is always the whole
 * Bench's. The coin read mirrors raising.ts raisingCoin (the newest coin on the one project); a row
 * whose coin reads as raising is checked with pillOf, and the pill is pillOf's result only.
 */
export async function benchRows(f: BenchFilter, o: { limit?: number; only?: number[] } = {}): Promise<{ rows: BenchRow[]; count: number; chips: BenchChain[] }> {
  const db = sql();
  const rows = await db<{ builder_id: number; rank: number; handle: string; x_name: string | null; avatar: string | null; chains: string[]; project: string;
    people_week: number; streak: number; weeks_shipping: number; shipped: boolean; raising: boolean }[]>`
    WITH ranked AS (
      SELECT x.builder_id, x.score, rank() OVER (ORDER BY x.score DESC)::int AS rank FROM ${listedRanked(db, o.only)} x)
    SELECT r.builder_id, r.rank, p.x_handle AS handle, p.x_name, p.x_avatar_url AS avatar, b.chains, b.name AS project, b.people_week, b.streak, b.weeks_shipping, b.shipped,
      COALESCE(c.token_status = 'launched' AND c.raising_at IS NOT NULL, false) AS raising
    FROM ranked r JOIN builder_profiles p USING (builder_id)
    JOIN builder_projects b ON b.builder_id = r.builder_id AND lower(b.project_key) = lower(p.main_project_key)
    LEFT JOIN LATERAL (SELECT x.token_status, x.raising_at FROM projects x JOIN installations i ON i.id = x.installation_id
      WHERE COALESCE(i.builder_id, i.id) = r.builder_id AND x.token_url IS NOT NULL AND x.token_symbol IS NOT NULL
        AND (x.token_repo_key = 'github.com/' || lower(p.main_project_key)
          OR lower(x.repo_url) IN (lower('https://github.com/' || p.main_project_key), lower('https://github.com/' || p.main_project_key || '/')))
      ORDER BY x.coin_launched_at DESC NULLS LAST, x.id DESC LIMIT 1) c ON true
    WHERE (${f.chain}::text IS NULL OR ${f.chain}::text = ANY(b.chains))
      AND (NOT ${f.raising}::boolean OR (c.token_status = 'launched' AND c.raising_at IS NOT NULL))
      AND (NOT ${f.weekly}::boolean OR b.streak >= ${WEEKLY_STREAK})
    ORDER BY r.score DESC, lower(p.x_handle) LIMIT ${Math.min(BENCH_MAX, o.limit ?? BENCH_MAX)}`;
  const [{ total }] = await db<{ total: number }[]>`SELECT count(*)::int AS total FROM ${listedRanked(db, o.only)} x`;
  const pools = await chainPools(o);
  const pills = new Map(await Promise.all(rows.filter((r) => r.raising).map(async (r) => [r.builder_id, await pillOf(r.builder_id)] as const)));
  return {
    count: total,
    chips: BENCH_CHAINS.filter((c) => pools[c] >= CHAIN_CHIP_MIN),
    rows: rows
      .filter((r) => !f.raising || pills.get(r.builder_id))
      .map((r) => ({
        rank: r.rank,
        // The page is the Bench: "Top 4%" or "#3 of 12", without "on the Bench".
        line: benchRank({ ranked: true, rank: r.rank, total })?.short.replace(/ on the Bench$/, '') ?? null,
        handle: r.handle,
        name: displayName(r.x_name, r.handle),
        avatar: avatarUrl(r.avatar),
        raising: pills.get(r.builder_id) ?? null,
        chains: BENCH_CHAINS.filter((c) => r.chains.includes(c)),
        project: r.project,
        best: bestFact(r),
      })),
  };
}
