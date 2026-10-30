import { sql } from './db';
import { liveSite } from './bench-data';
import { rankLines } from './bench-rank';
import { benchConfirmedSql } from './main-project';
import { norm, shownProjects } from './page-data';
import { scoreLine } from './rank';
import { pageUrl } from './reserved-routes';
import { latestRevenue } from './revenue';
import { latestStripe } from './stripe';
import { scoreWhy, storedShipping } from './score-v2';
import { USED_MIN, bestUsage, usageRows } from './site-data';
import { streakOfBuilder } from './streak';

/**
 * v3 Stage 2 (spec 5.3 Route 1): the builder's ship log facts at the top of a drafted application, as the page shows
 * them (bench-data.ts profileData's reads, without the log itself): the Shipping score and its rank, why, the streak,
 * the live site and the page. Only the builder's own facts, never another builder's.
 */
export type ShipLogFacts = {
  score: number | null; rank: string | null; why: string | null; streak: number; live: string | null; page: string;
  /** v4.5 Task 3: verified usage (site-data.ts bestUsage of the fresh app_usage rows), or null. */
  usedBy: { users: number; returning: number; capped: boolean } | null;
  /** v4.5 Task 3: verified revenue (revenue.ts latestRevenue) from REVENUE_MIN, or null. Private: drafts and replies only. */
  revenue: { usd: number; capped: boolean } | null;
  /** v4.6 Task 3: verified Stripe revenue (stripe.ts latestStripe: fresh, shown, from REVENUE_MIN), or null. Private: drafts and replies only. */
  stripe?: { usd: number; mrr: number; capped: boolean } | null;
};

/** prepare's agent_note suffix when the block is shown. */
export const SHIP_LOG_NOTE = ' Use the ship log facts in the description and traction answers. Use the verified onchain numbers in traction answers as given.';

/** v4.5 Task 3: the revenue line shows from this many whole dollars. */
export const REVENUE_MIN = 100;
const dollars = (usd: number, capped: boolean) => `$${Math.floor(usd).toLocaleString('en-US')}${capped ? '+' : ''}`;

/** v4.6 Task 3: the Stripe line; MRR from REVENUE_MIN, its whole dollars with no plus (the + marks only a capped 30-day figure). */
const stripeLine = (s: NonNullable<ShipLogFacts['stripe']>) =>
  `${dollars(s.usd, s.capped)} received through Stripe in the last 30 days, verified from Stripe` +
  (Math.floor(s.mrr) >= REVENUE_MIN ? `, ${dollars(s.mrr, false)} a month in subscriptions` : '');

/**
 * v4.5 Task 3: the builder's verified traction for their own drafts and replies (private documents, so a hidden page
 * gets it too; never public): usage as the page's Used by row picks it (usageRows + bestUsage: fresh, from USED_MIN,
 * the larger source, never summed) and revenue from REVENUE_MIN whole dollars (latestRevenue: fresh, not
 * pass-through). Each null otherwise. Throws on a database error.
 */
export async function tractionFacts(builderId: number, now: Date): Promise<Pick<ShipLogFacts, 'usedBy' | 'revenue' | 'stripe'>> {
  const [rows, rev, stripe] = await Promise.all([usageRows(builderId, now), latestRevenue(builderId, now), latestStripe(builderId, now)]);
  const best = bestUsage(rows);
  return {
    usedBy: best ? { users: best.users, returning: Math.min(Math.max(best.returning, 0), best.users), capped: best.capped } : null,
    revenue: rev && Math.floor(rev.usd) >= REVENUE_MIN ? { usd: Math.floor(rev.usd), capped: rev.capped } : null,
    // v4.6: whole dollars like the onchain figure (latestStripe already gates freshness, shown and REVENUE_MIN).
    stripe: stripe && Math.floor(stripe.usd) >= REVENUE_MIN ? { usd: Math.floor(stripe.usd), mrr: Math.floor(stripe.mrr), capped: stripe.capped } : null,
  };
}

/**
 * The facts for `builderId`, or null without a claimed page (no handle). The score, rank and why only with a rank
 * line (as profileData); the streak only while the one project is confirmed (read off the same grid weeks the page
 * shows); the live site never a GitHub page. Throws on a database error.
 */
export async function shipLogFacts(builderId: number, now: Date): Promise<ShipLogFacts | null> {
  const db = sql();
  const [p] = await db<{ handle: string | null; main: string | null }[]>`
    SELECT x_handle AS handle, main_project_key AS main FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.handle) return null;
  const lines = await rankLines(builderId);
  const [live] = await db<{ parts: unknown }[]>`SELECT parts FROM builder_live WHERE builder_id = ${builderId}`;
  // v3.1 F3: the score on a ranked page; the rank phrase only from RANK_MIN_POOL (null under it).
  const scored = lines.listed && Boolean(live);
  const facts: ShipLogFacts = {
    score: scored ? (storedShipping(live!.parts)?.points ?? null) : null,
    rank: scored ? lines.bench : null,
    why: scored ? scoreWhy(live!.parts, now) : null,
    streak: 0,
    live: null,
    page: pageUrl(p.handle),
    // A failed traction read is no traction lines, never no ship log.
    ...(await tractionFacts(builderId, now).catch((err: unknown) => {
      console.error('[ship log] traction', err instanceof Error ? err.name : 'error');
      return { usedBy: null, revenue: null, stripe: null };
    })),
  };
  if (!p.main) return facts;
  const [b] = await db<{ confirmed: boolean }[]>`
    SELECT ${benchConfirmedSql(db)} AS confirmed FROM builder_projects b
    WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(${p.main})`;
  const shown = ((await shownProjects([builderId])).get(builderId) ?? []).find((r) => norm(r.key) === norm(p.main!));
  if (!b || !shown) return facts;
  facts.live = liveSite(shown.link);
  if (b.confirmed) {
    facts.streak = await streakOfBuilder(builderId, now);
  }
  return facts;
}

/**
 * The block's lines: "From your ship log:", the score line ("Shipping 72 · #3 of 40 builders"), the why
 * sentence, "3 weeks in a row" (2 or more), v4.5's verified usage (from USED_MIN), who came back (2 or more, with the
 * usage line) and revenue (from REVENUE_MIN), v4.6's Stripe line (from REVENUE_MIN), "Live: <site>", "Page: earnkit.com/<handle>". Statements only. Pure.
 */
export function shipLogBlock(f: ShipLogFacts): string[] {
  const used = f.usedBy && f.usedBy.users >= USED_MIN ? f.usedBy : null;
  const paid = f.revenue && Math.floor(f.revenue.usd) >= REVENUE_MIN ? f.revenue : null;
  const stripe = f.stripe && Math.floor(f.stripe.usd) >= REVENUE_MIN ? f.stripe : null;
  return [
    'From your ship log:',
    f.score !== null ? scoreLine(f.score, f.rank) : null,
    f.why,
    f.streak >= 2 ? `${f.streak} weeks in a row` : null,
    used ? `Used by ${used.users.toLocaleString('en-US')}${used.capped ? '+' : ''} people in the last 30 days, verified onchain` : null,
    used && used.returning >= 2 ? `${used.returning.toLocaleString('en-US')} came back in a second week` : null,
    paid ? `${dollars(paid.usd, paid.capped)} paid into its contracts by outside wallets in the last 30 days, verified onchain` : null,
    stripe ? stripeLine(stripe) : null,
    f.live ? `Live: ${f.live}` : null,
    `Page: ${f.page}`,
  ].filter((x): x is string => Boolean(x));
}
