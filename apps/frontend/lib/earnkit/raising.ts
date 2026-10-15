import { sql } from './db';
import { noteEvent } from './events';
import { mainProjectOf } from './main-project';
import { normalizeRepoUrl } from './campaigns';
import type { BenchAsk } from './bench-reply';

/**
 * v2.13 spec "4. Optional: raise" (R8): the one project's coin, the raising flag on it, the pill.
 * A coin launched before v2.13 never turns the pill on by itself: the builder says yes first
 * ("Want to show you're raising with $X?", once per project). "Stop raising" clears the flag; the
 * coin stays. Everything here is reached only under the Bench flag.
 */
export const RAISE_LINES = {
  on: (symbol: string) => `Done. Your page shows you're raising with $${symbol}.`,
  off: "Okay, your page no longer says you're raising. Your coin stays.",
  notLaunched: "Your coin isn't live yet. It shows once it is.",
} as const;
export const showRaisingLine = (symbol: string) => `Want to show you're raising with $${symbol}?`;

type CoinRow = { project_id: number; symbol: string; url: string; status: string | null; raising: boolean };

/**
 * The one project's launched (or launching) coin entry, newest first. A launch records the repo
 * as token_repo_key (campaigns.ts normalizeRepoUrl); an entry whose claim predates that is matched
 * by its repo link.
 */
export async function raisingCoin(builderId: number): Promise<{ project_id: number; symbol: string; url: string; raising: boolean } | null> {
  const r = await coinRow(builderId);
  return r && { project_id: r.project_id, symbol: r.symbol, url: r.url, raising: r.raising };
}

async function coinRow(builderId: number): Promise<CoinRow | null> {
  const key = await mainProjectOf(builderId);
  if (!key) return null;
  const repo = `https://github.com/${key}`;
  const [r] = await sql()<CoinRow[]>`
    SELECT x.id AS project_id, x.token_symbol AS symbol, x.token_url AS url, x.token_status AS status, x.raising_at IS NOT NULL AS raising
    FROM projects x JOIN installations i ON i.id = x.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND x.token_url IS NOT NULL AND x.token_symbol IS NOT NULL
      AND (x.token_repo_key = ${normalizeRepoUrl(repo)} OR lower(x.repo_url) IN (lower(${repo}), lower(${`${repo}/`})))
    ORDER BY x.coin_launched_at DESC NULLS LAST, x.id DESC LIMIT 1`;
  return r ?? null;
}

/** tell coin { raising }: on only for a launched coin; off clears the flag and keeps the coin. */
export async function setRaising(builderId: number, on: boolean): Promise<{ show_to_builder: string }> {
  const c = await coinRow(builderId);
  if (!c) return { show_to_builder: 'Okay.' };
  if (on && c.status !== 'launched') return { show_to_builder: RAISE_LINES.notLaunched };
  if (on) await sql()`UPDATE projects SET raising_at = COALESCE(raising_at, now()) WHERE id = ${c.project_id}`;
  else await sql()`UPDATE projects SET raising_at = NULL WHERE id = ${c.project_id}`;
  const type = on ? 'raising_on' : 'raising_off';
  await noteEvent(type, () => ({ type, dedupe_key: `${type}:${c.project_id}:${new Date().toISOString()}`, installation_id: builderId, project_id: c.project_id }));
  return { show_to_builder: on ? RAISE_LINES.on(c.symbol) : RAISE_LINES.off };
}

/** The pill: only while the coin is launched and the builder said they're raising. */
export async function pillOf(builderId: number): Promise<{ symbol: string; url: string } | null> {
  const c = await coinRow(builderId);
  return c && c.status === 'launched' && c.raising ? { symbol: c.symbol, url: c.url } : null;
}

/** A coin launched before v2.13 (or before the yes): "Want to show you're raising with $X?", once per project. */
export async function raiseAsk(builderId: number, key: string, seen: { raise_asked?: Record<string, string> }): Promise<BenchAsk | null> {
  if (seen.raise_asked?.[key]) return null;
  const c = await coinRow(builderId);
  if (!c || c.status !== 'launched' || c.raising) return null;
  return { kind: 'raise', project_key: key, line: showRaisingLine(c.symbol) };
}

/** Records the raise ask as shown (standing_seen.raise_asked), so it is never asked again for this project. */
export async function markRaiseAsked(builderId: number, key: string, now: Date): Promise<void> {
  await sql()`
    UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{raise_asked}',
      COALESCE(standing_seen->'raise_asked', '{}'::jsonb) || jsonb_build_object(${key}::text, ${now.toISOString()}::text))
    WHERE builder_id = ${builderId}`;
}
