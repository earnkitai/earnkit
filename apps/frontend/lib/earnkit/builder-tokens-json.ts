import { sql } from './db';
import { siteUrl } from './entry-text';
import { avatarUrl, displayName } from './page-data';
import { streaksFor } from './streak';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { pagePath } from './reserved-routes';

/**
 * v4.0 Task 10: the builders' own tokens as JSON, for tokens.fun's list (GET /api/builder-tokens). Only `launched`
 * tokens of claimed, non-hidden, non-held profiles with a handle (the leaderboard's listing rule, person-score
 * listedRanked, minus the ranked requirement: an unranked builder's `shipping` is null). Best Shipping first, then symbol.
 */
export type BuilderTokenRow = { coin: string; symbol: string; handle: string; name: string; photo: string | null; shipping: number | null; streak: number; page: string };

export async function builderTokensJson(now: Date): Promise<BuilderTokenRow[]> {
  const rows = await sql()<{ builder_id: number; coin: string; symbol: string; handle: string; x_name: string | null; avatar: string | null; github_login: string | null; shipping: number | null }[]>`
    SELECT t.builder_id, t.coin_address AS coin, t.symbol, p.x_handle AS handle, p.x_name, p.x_avatar_url AS avatar, p.github_login,
      CASE WHEN l.ranked AND l.calibration = ${LIVE_CALIBRATION_V2} AND l.pending IS NULL THEN round(l.score)::int END AS shipping
    FROM builder_tokens t JOIN builder_profiles p USING (builder_id) LEFT JOIN builder_live l USING (builder_id)
    WHERE t.status = 'launched' AND t.coin_address IS NOT NULL AND t.symbol IS NOT NULL
      AND p.x_user_id IS NOT NULL AND p.x_handle IS NOT NULL AND NOT p.hidden AND NOT p.held`;
  const streaks = await streaksFor(rows.map((r) => r.builder_id), now);
  return rows
    .map((r) => ({
      coin: r.coin,
      symbol: r.symbol,
      handle: r.handle,
      name: displayName(r.x_name, r.handle),
      photo: avatarUrl(r.avatar, r.github_login),
      shipping: r.shipping,
      streak: streaks.get(r.builder_id)?.streak ?? 0,
      page: `${siteUrl()}${pagePath(r.handle)}`,
    }))
    .sort((a, b) => (b.shipping ?? -1) - (a.shipping ?? -1) || a.symbol.localeCompare(b.symbol));
}

const HEADERS = { 'Access-Control-Allow-Origin': 'https://tokens.fun', Vary: 'Origin' };
/** The route's answer from `load` (the route passes its cached read): 200 (an empty list too) or 503, readable from tokens.fun. */
export async function builderTokensResponse(load: () => Promise<BuilderTokenRow[]>): Promise<Response> {
  try {
    return Response.json(await load(), { headers: { ...HEADERS, 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    console.error('[builder-tokens]', err instanceof Error ? err.name : 'error');
    return Response.json({ error: 'unavailable, try again shortly' }, { status: 503, headers: { ...HEADERS, 'Cache-Control': 'no-store' } });
  }
}
