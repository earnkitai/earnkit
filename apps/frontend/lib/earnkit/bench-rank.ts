import { sql } from './db';
import { benchConfirmedSql } from './main-project';
import { listedRanked, standingOf } from './person-score';
import { BENCH_CHAINS, CHAIN_CHIP_MIN, CHAIN_LABEL, benchRank, type BenchChain } from './rank';

/**
 * v2.13 spec "Chains (R14)": a ranked project is on a chain when builder_projects.chains (T4) names
 * it. The pool of a chain is the listed ranked people whose one project is on it (and, final fix
 * M1, counts as confirmed now: benchConfirmedSql, not only at the last rescore). A chain's line (and
 * its chip on the Bench) only from CHAIN_CHIP_MIN ranked projects in its pool.
 */
export const benchPool = (only?: number[]) => {
  const db = sql();
  return db`(SELECT l.builder_id, l.score, b.chains FROM ${listedRanked(db, only)} l
    JOIN builder_profiles p ON p.builder_id = l.builder_id
    JOIN builder_projects b ON b.builder_id = l.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)})`;
};

export async function chainPools(o: { only?: number[] } = {}): Promise<Record<BenchChain, number>> {
  const rows = await sql()<{ chain: string; n: number }[]>`
    SELECT c AS chain, count(*)::int AS n FROM ${benchPool(o.only)} x, unnest(x.chains) c GROUP BY c`;
  const out = Object.fromEntries(BENCH_CHAINS.map((c) => [c, 0])) as Record<BenchChain, number>;
  for (const r of rows) if ((BENCH_CHAINS as readonly string[]).includes(r.chain)) out[r.chain as BenchChain] = r.n;
  return out;
}

export type RankLines = { bench: string | null; phrase: string | null; chains: { chain: BenchChain; label: string; line: string }[] };

export async function rankLines(builderId: number, o: { only?: number[] } = {}): Promise<RankLines> {
  const s = await standingOf(builderId, o);
  const words = benchRank(s);
  // v2.13.4 (owner, reversing v2.13.1 O5 P2): the reply names the Bench rank by the spec's rule alone ("#N of
  // M" under 20 ranked, top half only; "Top P%" from 20), from 1 ranked: "#1 of 1 builder" shows.
  const out: RankLines = { bench: words?.short ?? null, phrase: words?.phrase ?? null, chains: [] };
  if (!s.ranked) return out;
  const [me] = await sql()<{ chains: string[]; score: number }[]>`
    SELECT b.chains, l.score FROM builder_profiles p JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key)
      AND ${benchConfirmedSql(sql())}
    JOIN builder_live l ON l.builder_id = p.builder_id WHERE p.builder_id = ${builderId}`;
  if (!me) return out;
  const pools = await chainPools(o);
  for (const chain of BENCH_CHAINS) {
    if (!me.chains.includes(chain) || pools[chain] < CHAIN_CHIP_MIN) continue;
    const [r] = await sql()<{ total: number; rank: number }[]>`
      SELECT (count(*) + CASE WHEN bool_or(x.builder_id = ${builderId}) THEN 0 ELSE 1 END)::int AS total,
        (1 + count(*) FILTER (WHERE x.score > ${me.score} AND x.builder_id <> ${builderId}))::int AS rank
      FROM ${benchPool(o.only)} x WHERE ${chain} = ANY(x.chains)`;
    const w = benchRank({ ranked: true, rank: r.rank, total: r.total }, { chain });
    if (w) out.chains.push({ chain, label: CHAIN_LABEL[chain], line: w.short });
  }
  return out;
}
