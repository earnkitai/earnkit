import { sql } from './db';
import { standingOf } from './person-score';

/**
 * v3 Stage 1: points, the default program every ranked builder is in. Each approved week with facts earns points by the
 * builder's rank at approval; they convert to $EARN later, in proportion. Points never touch Shipping or rank.
 */
export type ApproveVia = 'share' | 'connect' | 'email';

/** Rank 1: 100; top 10%: 90; top 25%: 70; top 50%: 50; else 30 (also with no rank). Pure. */
export function pointsForRank(rank: number | null, total: number | null): number {
  if (rank === null || total === null || total <= 0) return 30;
  if (rank === 1) return 100;
  const share = rank / total;
  return share <= 0.1 ? 90 : share <= 0.25 ? 70 : share <= 0.5 ? 50 : 30;
}

/** A week approved by connecting (a unranked builder's proof): a flat 30. */
export const CONNECT_POINTS = 30;

/** The reply's points line. */
export const POINTS_LINE = (total: number) => `Points: ${total.toLocaleString('en-US')}. They convert to $EARN at launch, in proportion to all points earned.`;
/** The profile's small text under the points. */
export const POINTS_PAGE_LINE = 'Points convert to $EARN when it launches, in proportion to all points earned. They are not a token and have no value until then.';

/** One row per builder and week (created_at `now`): the points awarded now, or 0 when the week already had its row. */
export async function awardWeekPoints(builderId: number, week: string, via: ApproveVia, now: Date): Promise<number> {
  let points = CONNECT_POINTS;
  let rank: number | null = null;
  let total: number | null = null;
  if (via !== 'connect') {
    const s = await standingOf(builderId);
    rank = s.ranked ? s.rank : null;
    total = s.ranked ? s.total : null;
    points = pointsForRank(rank, total);
  }
  const [r] = await sql()<{ points: number }[]>`
    INSERT INTO builder_points (builder_id, week, points, rank, total, via, created_at) VALUES (${builderId}, ${week}, ${points}, ${rank}, ${total}, ${via}, ${now})
    ON CONFLICT (builder_id, week) DO NOTHING RETURNING points`;
  return r?.points ?? 0;
}

export async function pointsTotal(builderId: number): Promise<number> {
  const [r] = await sql()<{ n: string }[]>`SELECT COALESCE(sum(points), 0)::text AS n FROM builder_points WHERE builder_id = ${builderId}`;
  return Number(r?.n ?? 0);
}
