/**
 * v2.12.1 spec "Rules": the rank line only when it reads well. "#N of M builders on EarnKit" while
 * fewer than RANK_LIST_UNTIL people are ranked; from then, "top P% of people building with AI"
 * only when P <= TOP_PERCENT_MAX; otherwise no rank line. Rank is 1 + the number of ranked people
 * with a higher public score (ties share a number). Pure.
 */
export const RANK_LIST_UNTIL = 50;
export const TOP_PERCENT_MAX = 50;
export type Standing = { ranked: boolean; rank: number; total: number };

export const topPercentOf = (rank: number, total: number): number => Math.max(1, Math.ceil((100 * rank) / Math.max(1, total)));

export function rankWords(s: Standing): { reply: string; short: string } | null {
  if (!s.ranked || !Number.isFinite(s.rank) || !Number.isFinite(s.total) || s.rank < 1 || s.total < 1) return null;
  if (s.total < RANK_LIST_UNTIL) {
    const short = `#${s.rank} of ${s.total} ${s.total === 1 ? 'builder' : 'builders'} on EarnKit`;
    return { reply: `You're ${short}.`, short };
  }
  const p = topPercentOf(s.rank, s.total);
  if (p > TOP_PERCENT_MAX) return null;
  return { reply: `You're in the top ${p}% of people building with AI.`, short: `Top ${p}% of people building with AI` };
}
