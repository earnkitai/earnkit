/**
 * v2.12.1 spec "Rules": the rank line only when it reads well. "#N of M builders on EarnKit" while
 * fewer than RANK_LIST_UNTIL people are ranked and the person is in the top half; from then, "top P% of people building with AI"
 * only when P <= TOP_PERCENT_MAX; otherwise no rank line. Rank is 1 + the number of ranked people
 * with a higher public score (ties share a number). Pure.
 */
export const RANK_LIST_UNTIL = 50;
export const TOP_PERCENT_MAX = 50;
export type Standing = { ranked: boolean; rank: number; total: number };

export const topPercentOf = (rank: number, total: number): number => Math.max(1, Math.ceil((100 * rank) / Math.max(1, total)));

export function rankWords(s: Standing): { reply: string; short: string } | null {
  if (!s.ranked || !Number.isFinite(s.rank) || !Number.isFinite(s.total) || s.rank < 1 || s.total < 1 || s.rank > s.total) return null;
  if (s.total < RANK_LIST_UNTIL) {
    // Only when it reads well: the top half.
    if (s.rank > Math.ceil(s.total / 2)) return null;
    const short = `#${s.rank} of ${s.total} ${s.total === 1 ? 'builder' : 'builders'} on EarnKit`;
    return { reply: `You're ${short}.`, short };
  }
  const p = topPercentOf(s.rank, s.total);
  if (p > TOP_PERCENT_MAX) return null;
  return { reply: `You're in the top ${p}% of people building with AI.`, short: `Top ${p}% of people building with AI` };
}

/** v2.13 R14: the chains a project can be shown on (logos), in the Bench's order. */
export const BENCH_CHAINS = ['base', 'robinhood', 'arc'] as const;
export type BenchChain = (typeof BENCH_CHAINS)[number];
export const CHAIN_LABEL: Record<BenchChain, string> = { base: 'Base', robinhood: 'Robinhood Chain', arc: 'Arc' };

/**
 * v2.13 spec "Percentile (R13)": P = 100 * rank / total. "Top P%" only from BENCH_PERCENT_FROM ranked
 * and P <= TOP_PERCENT_MAX; P of 1 or more rounded up to a whole number, under 1 rounded up to one
 * decimal and never below 0.1. Under BENCH_PERCENT_FROM: "#N of M", only in the top half. A chain's
 * pool uses the same rule and names the chain; a chain's line shows only from CHAIN_CHIP_MIN ranked
 * projects on it (bench-rank.ts). The word "percentile" never appears. Pure.
 */
export const BENCH_PERCENT_FROM = 20;
export const CHAIN_CHIP_MIN = 10;
export function benchPercent(rank: number, total: number): number {
  const whole = Math.ceil((100 * rank) / total);
  if (whole > 1 || (100 * rank) / total === 1) return whole;
  return Math.max(1, Math.ceil((1000 * rank) / total)) / 10;
}
export const percentText = (p: number) => (p >= 1 ? String(p) : p.toFixed(1));
export function benchRank(s: Standing, o: { chain?: BenchChain } = {}): { short: string; phrase: string } | null {
  if (!s.ranked || !Number.isFinite(s.rank) || !Number.isFinite(s.total) || s.rank < 1 || s.total < 1 || s.rank > s.total) return null;
  const where = o.chain ? `on ${CHAIN_LABEL[o.chain]}` : 'on the Bench';
  if (s.total < BENCH_PERCENT_FROM) {
    if (s.rank > Math.ceil(s.total / 2)) return null;
    const of = `#${s.rank} of ${s.total}`;
    return { short: `${of} ${where}`, phrase: o.chain ? `${of} ${where}` : `${of} ${s.total === 1 ? 'builder' : 'builders'}` };
  }
  const p = benchPercent(s.rank, s.total);
  if ((100 * s.rank) / s.total > TOP_PERCENT_MAX) return null;
  const t = percentText(p);
  return { short: `Top ${t}% ${where}`, phrase: o.chain ? `top ${t}% ${where}` : `top ${t}% of builders` };
}
