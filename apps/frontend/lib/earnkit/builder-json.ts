import { sql } from './db';
import { profileData } from './bench-data';
import { siteUrl } from './entry-text';
import { standingOf } from './person-score';
import { X_HANDLE } from './profiles';
import { pagePath } from './reserved-routes';
import { lastFinishedMonday, mondayOfWeek, weekOfMonday } from './weeks';

/**
 * v3 Stage 2 (spec 5.3 Route 2): one builder's public numbers as JSON, for tokens.fun
 * (GET /api/builders/<handle>.json). Only what the public page already shows. `earned`, the profile's
 * third number (earned.ts: fees claimed plus announced prizes; waiting, still in the FeeLocker). v4.0 Task 11: no
 * `backing` (the per-project offers are retired; builder tokens are read from /api/builder-tokens).
 */
export type BuilderJson = {
  handle: string; name: string; page: string;
  /** Shipping (0 to 100), null while unranked. */
  shipping: number | null;
  /** The leaderboard rank, null while not listed; `total`, every ranked builder (the "of N builders" count). */
  rank: number | null; total: number;
  streak: number; points: number;
  /** Last finished week's ship-log card (its Monday and what it shipped), null with none. */
  last_week: { week: string; summary: string | null } | null;
  /** Days since the end of the newest week with code (0 for this week or one just finished), null with none. */
  last_shipped_days: number | null;
  /** No code in the last 2 finished weeks. */
  stopped_shipping: boolean;
  earned: { paid_usd: number; waiting_usd: number };
};

const DAY = 86_400_000;

/** `handle` may end in ".json". Null for an unknown, unclaimed or hidden page. */
export async function builderJson(handle: string, now: Date): Promise<BuilderJson | null> {
  const h = handle.replace(/\.json$/i, '');
  if (!X_HANDLE.test(h)) return null;
  const [p] = await sql()<{ builder_id: number; x_handle: string }[]>`
    SELECT builder_id, x_handle FROM builder_profiles WHERE lower(x_handle) = ${h.toLowerCase()} AND x_user_id IS NOT NULL AND NOT hidden`;
  if (!p) return null;
  const [d, s] = await Promise.all([profileData(p.builder_id, now), standingOf(p.builder_id)]);
  if (!d) return null;
  const monday = lastFinishedMonday(now);
  const card = d.log.find((c) => !c.started && c.week === monday);
  const on = d.grid.filter((g) => g.on).map((g) => g.week);
  const newest = on.length ? mondayOfWeek(on[on.length - 1]) : null;
  const finished = [monday, new Date(Date.parse(`${monday}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10)].map(weekOfMonday);
  return {
    handle: d.handle,
    name: d.name,
    page: `${siteUrl()}${pagePath(d.handle)}`,
    shipping: d.score,
    // v3.1 F3: the number stays at any pool size (the page hides it under RANK_MIN_POOL).
    rank: d.rankListed && s.ranked && s.listed ? s.rank : null,
    total: s.total,
    streak: d.streak,
    points: d.points,
    last_week: card ? { week: card.week, summary: card.summary ?? null } : null,
    last_shipped_days: newest ? Math.max(0, Math.floor((now.getTime() - (Date.parse(`${newest}T00:00:00Z`) + 7 * DAY)) / DAY)) : null,
    stopped_shipping: !finished.some((w) => w !== null && on.includes(w)),
    earned: d.earned,
  };
}

const HEADERS = { 'Access-Control-Allow-Origin': 'https://tokens.fun', Vary: 'Origin' };
/** The route's answer for `handle` from `load` (the route passes its cached read): 200, 404 or 503, readable from tokens.fun. */
export async function builderResponse(handle: string, load: (handle: string) => Promise<BuilderJson | null>): Promise<Response> {
  try {
    const j = await load(handle);
    return Response.json(j ?? { error: 'not found' }, { status: j ? 200 : 404, headers: { ...HEADERS, 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    console.error('[builder-json]', err instanceof Error ? err.name : 'error');
    return Response.json({ error: 'unavailable, try again shortly' }, { status: 503, headers: { ...HEADERS, 'Cache-Control': 'no-store' } });
  }
}
/** The CORS preflight's answer. */
export const builderPreflight = () =>
  new Response(null, { status: 204, headers: { ...HEADERS, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
