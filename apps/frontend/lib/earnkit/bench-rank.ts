import { sql } from './db';
import { benchConfirmedSql } from './main-project';
import { benchPool, standingOf } from './person-score';
import { BENCH_CHAINS, CHAIN_LABEL, rankLine, scoreLine, shownRankLine, type BenchChain } from './rank';

/** v2.13 spec "Chains (R14)": a chain's pool is the Bench (person-score benchPool) on that chain. A chain's chip shows from one ranked project in its pool (R16e); its line from RANK_MIN_POOL (v3.1 F3). */
export { benchPool };

export async function chainPools(o: { only?: number[] } = {}): Promise<Record<BenchChain, number>> {
  const rows = await sql()<{ chain: string; n: number }[]>`
    SELECT c AS chain, count(*)::int AS n FROM ${benchPool(o.only)} x, unnest(x.chains) c GROUP BY c`;
  const out = Object.fromEntries(BENCH_CHAINS.map((c) => [c, 0])) as Record<BenchChain, number>;
  for (const r of rows) if ((BENCH_CHAINS as readonly string[]).includes(r.chain)) out[r.chain as BenchChain] = r.n;
  return out;
}

/**
 * `bench`: the rank phrase (rank.ts shownRankLine: null under RANK_MIN_POOL ranked builders); `line`: the score line
 * with it (rank.ts scoreLine; "Shipping 60" alone under the minimum), null while unranked; `chains`: each chain's rank
 * phrase, against its own chain pool (v3.1 F3: from RANK_MIN_POOL on it); `listed`: in the leaderboard's pool (a
 * whole-pool rankLine exists), so a ranked page even while `bench` is null.
 */
export type RankLines = { bench: string | null; line: string | null; chains: { chain: BenchChain; label: string; line: string }[]; listed: boolean };

const unranked = (): RankLines => ({ bench: null, line: null, chains: [], listed: false });

/**
 * R10: a rank only while the one project counts as confirmed now (benchConfirmedSql, read live): a stale
 * builder_live.ranked (set at the last rescore) never shows a rank beside "isn't counted yet", on the
 * profile, the card, the page meta or a reply.
 */
export async function rankLines(builderId: number, o: { only?: number[] } = {}): Promise<RankLines> {
  const s = await standingOf(builderId, o);
  // Hotfix 2026-10-19: a public rank only inside the leaderboard's pool (never "#1 of 1" while held, hidden or unlisted).
  if (!s.ranked || !s.listed) return unranked();
  const [me] = await sql()<{ chains: string[]; score: number }[]>`
    SELECT b.chains, l.score FROM builder_profiles p JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key)
      AND ${benchConfirmedSql(sql())}
    JOIN builder_live l ON l.builder_id = p.builder_id WHERE p.builder_id = ${builderId}`;
  if (!me) return unranked();
  // v3.1 F3: the rank phrase only from RANK_MIN_POOL ranked builders; the score line stands alone under it.
  const listed = rankLine(s) !== null;
  const bench = shownRankLine(s);
  const out: RankLines = { bench, line: listed ? scoreLine(s.score, bench) : null, chains: [], listed };
  for (const chain of BENCH_CHAINS) {
    if (!me.chains.includes(chain)) continue;
    const [r] = await sql()<{ total: number; rank: number }[]>`
      SELECT (count(*) + CASE WHEN bool_or(x.builder_id = ${builderId}) THEN 0 ELSE 1 END)::int AS total,
        (1 + count(*) FILTER (WHERE x.score > ${me.score} AND x.builder_id <> ${builderId}))::int AS rank
      FROM ${benchPool(o.only)} x WHERE ${chain} = ANY(x.chains)`;
    const line = shownRankLine({ ranked: true, rank: r.rank, total: r.total }, { chain });
    if (line) out.chains.push({ chain, label: CHAIN_LABEL[chain], line });
  }
  return out;
}
