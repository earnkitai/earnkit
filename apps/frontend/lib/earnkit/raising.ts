import { raisingEnabled } from './builder-score-flag';
import { sql } from './db';
import { noteEvent } from './events';
import { mainConfirmed, mainProjectOf } from './main-project';
import { normalizeRepoUrl } from './campaigns';
import type { BenchAsk } from './bench-reply';

/**
 * v2.13 spec "4. Optional: raise" (R8): the one project's coin, the raising flag on it, the pill.
 * A coin launched before v2.13 never turns the pill on by itself: the builder says yes first
 * ("Want to show you're raising with $X?", once per project). "Stop raising" clears the flag; the
 * coin stays. Everything here is reached only under the Bench flag, and the pill, the ask and
 * setRaising do nothing while EARNKIT_RAISING is off (final fix, controller ruling).
 */
export const RAISE_LINES = {
  on: (symbol: string) => `Done. Your page shows you're raising with $${symbol}.`,
  off: "Okay, your page no longer says you're raising. Your coin stays.",
  notLaunched: "Your coin isn't live yet. It shows once it is.",
} as const;
export const showRaisingLine = (symbol: string) => `Want to show you're raising with $${symbol}?`;

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

/** The pill: only while EARNKIT_RAISING is on, the coin is launched, the builder said they're raising, and the one project is confirmed. */
export async function pillOf(builderId: number): Promise<{ symbol: string; url: string } | null> {
  if (!raisingEnabled()) return null;
  const c = await raisingCoin(builderId);
  if (!c || c.status !== 'launched' || !c.raising || !(await mainConfirmed(builderId))) return null;
  return { symbol: c.symbol, url: c.url };
}

/**
 * A coin launched before v2.13 (or before the yes): "Want to show you're raising with $X?", once per
 * project. The caller gates on confirmation (bench-find coinAskBench); `coin` is its raisingCoin read, when it has one.
 */
export async function raiseAsk(
  builderId: number,
  key: string,
  seen: { raise_asked?: Record<string, string> },
  coin?: RaisingCoin | null,
): Promise<BenchAsk | null> {
  if (!raisingEnabled() || seen.raise_asked?.[key]) return null;
  const c = coin === undefined ? await raisingCoin(builderId) : coin;
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
