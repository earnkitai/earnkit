import { raisingEnabled } from './builder-score-flag';
import { sql } from './db';
import { noteEvent } from './events';
import { mainConfirmed, mainProjectOf } from './main-project';
import { normalizeRepoUrl } from './campaigns';

/**
 * v2.13 spec "4. Optional: raise" (R8), v3 Stage 2 (spec 5.3 Route 2): the one project's coin, the backing flag on it
 * (projects.raising_at, the column keeps its name), the pill. A coin launched before v2.13 never turns the pill on by
 * itself: the builder says yes first (showRaisingLine, only when the builder asks about a token: bench-find.ts tokenAsk).
 * Closing backing clears the flag; the coin stays. The pill, the line and setRaising do nothing while EARNKIT_RAISING is
 * off (final fix, controller ruling). Builder text says Backing, never "community round", "raise" or "raising".
 */
export const RAISE_LINES = {
  on: (symbol: string) => `Done. Your page shows backing for $${symbol}.`,
  off: 'Okay. Your page no longer shows backing. Your coin stays onchain.',
  notLaunched: 'Backing opens once your coin is launched.',
} as const;
/** The line for a launched coin not shown as backing yet (tell token: 'ask'). Pure. */
export const showRaisingLine = (symbol: string) => `Want your page to show backing for $${symbol}?`;

export type RaisingCoin = { project_id: number; symbol: string; url: string; status: string | null; raising: boolean };

/**
 * The one project's launched (or launching) coin entry, newest first. A launch records the repo
 * as token_repo_key (campaigns.ts normalizeRepoUrl); an entry whose claim predates that is matched
 * by its repo link.
 */
export async function raisingCoin(builderId: number): Promise<RaisingCoin | null> {
  const key = await mainProjectOf(builderId);
  if (!key) return null;
  const repo = `https://github.com/${key}`;
  const [r] = await sql()<RaisingCoin[]>`
    SELECT x.id AS project_id, x.token_symbol AS symbol, x.token_url AS url, x.token_status AS status, x.raising_at IS NOT NULL AS raising
    FROM projects x JOIN installations i ON i.id = x.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND x.token_url IS NOT NULL AND x.token_symbol IS NOT NULL
      AND (x.token_repo_key = ${normalizeRepoUrl(repo)} OR lower(x.repo_url) IN (lower(${repo}), lower(${`${repo}/`})))
    ORDER BY x.coin_launched_at DESC NULLS LAST, x.id DESC LIMIT 1`;
  return r ?? null;
}

/**
 * tell coin { raising }: on only for a launched coin on a confirmed one project (fix round 1: a
 * Confirming project never shows it); off clears the flag and keeps the coin.
 */
export async function setRaising(builderId: number, on: boolean): Promise<{ show_to_builder: string }> {
  if (!raisingEnabled()) return { show_to_builder: 'Okay.' };
  const c = await raisingCoin(builderId);
  if (!c || (on && !(await mainConfirmed(builderId)))) return { show_to_builder: 'Okay.' };
  if (on && c.status !== 'launched') return { show_to_builder: RAISE_LINES.notLaunched };
  if (on) await sql()`UPDATE projects SET raising_at = COALESCE(raising_at, now()) WHERE id = ${c.project_id}`;
  else await sql()`UPDATE projects SET raising_at = NULL WHERE id = ${c.project_id}`;
  const type = on ? 'raising_on' : 'raising_off';
  await noteEvent(type, () => ({ type, dedupe_key: `${type}:${c.project_id}:${new Date().toISOString()}`, installation_id: builderId, project_id: c.project_id }));
  return { show_to_builder: on ? RAISE_LINES.on(c.symbol) : RAISE_LINES.off };
}

/** The pill: only while EARNKIT_RAISING is on, the coin is launched, the builder opened backing, and the one project is confirmed. */
export async function pillOf(builderId: number): Promise<{ symbol: string; url: string } | null> {
  if (!raisingEnabled()) return null;
  const c = await raisingCoin(builderId);
  if (!c || c.status !== 'launched' || !c.raising || !(await mainConfirmed(builderId))) return null;
  return { symbol: c.symbol, url: c.url };
}
