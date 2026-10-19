export type Standing = { ranked: boolean; rank: number; total: number };

/** v2.13 R14: the chains a project can be shown on (logos), in the Bench's order. */
export const BENCH_CHAINS = ['base', 'robinhood', 'arc'] as const;
export type BenchChain = (typeof BENCH_CHAINS)[number];
export const CHAIN_LABEL: Record<BenchChain, string> = { base: 'Base', robinhood: 'Robinhood Chain', arc: 'Arc' };

/**
 * Scoring and clarity (owner ruling 2026-10-19): the one rank line, everywhere (replies, profile,
 * card, page meta, the leaderboard, news). Under RANK_PERCENT_FROM ranked builders: "#N of M builders
 * this week" ("#1 of 1 builder this week"). From then, "Top P% of builders this week" in the top half
 * (P <= 50) and "#N of M builders this week" for the rest. Every ranked builder sees a rank. A
 * chain's pool uses the same rule and names the chain ("#2 of 12 builders on Arc this week"), from
 * one ranked project on it (R16e; the leaderboard's chain chips too). Numbers carry thousands separators
 * ("#1,204 of 3,500 builders this week"). P of 1 or more is rounded up to a whole
 * number, under 1 rounded up to one decimal and never below 0.1. Pure.
 */
export const RANK_PERCENT_FROM = 20;
export const TOP_PERCENT_MAX = 50;
export function benchPercent(rank: number, total: number): number {
  const whole = Math.ceil((100 * rank) / total);
  if (whole > 1 || (100 * rank) / total === 1) return whole;
  return Math.max(1, Math.ceil((1000 * rank) / total)) / 10;
}
export const percentText = (p: number) => (p >= 1 ? String(p) : p.toFixed(1));
export function rankLine(s: Standing, o: { chain?: BenchChain } = {}): string | null {
  if (!s.ranked || !Number.isFinite(s.rank) || !Number.isFinite(s.total) || s.rank < 1 || s.total < 1 || s.rank > s.total) return null;
  const where = o.chain ? ` on ${CHAIN_LABEL[o.chain]}` : '';
  if (s.total >= RANK_PERCENT_FROM && (100 * s.rank) / s.total <= TOP_PERCENT_MAX) return `Top ${percentText(benchPercent(s.rank, s.total))}% of builders${where} this week`;
  const n = (x: number) => x.toLocaleString('en-US');
  return `#${n(s.rank)} of ${n(s.total)} ${s.total === 1 ? 'builder' : 'builders'}${where} this week`;
}
/**
 * R16c: the one score line, everywhere it appears (profile header, MCP replies, the card and share
 * text, the page meta): "Shipping 72 · #3 of 40 builders this week"; "Shipping 72" without a rank. Pure.
 */
export const scoreLine = (score: number, rank: string | null) => (rank ? `Shipping ${score} · ${rank}` : `Shipping ${score}`);
