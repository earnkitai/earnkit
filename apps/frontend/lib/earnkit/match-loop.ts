import { sql } from './db';
import { repoKey } from './answer-bank';
import type { Level } from './guide';
import { testInstallationIds } from './installations';
import { WIN_RATE_MIN_LABELLED } from './stats';

/**
 * v2.9 A8: the outcome feedback loop, run inside programs:sync (no new cron). list_programs records
 * what matching showed (recordShown); per program, over announced outcomes only, updateMatchFloors
 * writes `match_floor` (the lowest winning product score) and `match_precision` (wins or places per
 * entry from `likely` rows), once 30 entries have an announced result (WIN_RATE_MIN_LABELLED,
 * Pre-flight P31). Dormant until then: both stay null.
 */

/** v2.10 item 6: `traction`, the repo's traction score shown (null when unscored). */
export type ShownRow = { program_id: string; repo_key: string; status: string; product_score: number | null; row_level: Level; traction: number | null };

/** Today's UTC date, "2026-10-08". */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * What matching showed this installation, one row per (program, repo) per UTC day; a second call the
 * same day keeps the latest status, score, level and traction.
 */
export async function recordShown(installationId: number, rows: ShownRow[], day: string = today()): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((r) => ({
    installation_id: installationId,
    program_id: r.program_id,
    repo_key: r.repo_key,
    status: r.status,
    product_score: r.product_score,
    row_level: r.row_level,
    traction: r.traction,
    day,
  }));
  const db = sql();
  await db`
    INSERT INTO match_shown ${db(values, 'installation_id', 'program_id', 'repo_key', 'status', 'product_score', 'row_level', 'traction', 'day')}
    ON CONFLICT (installation_id, program_id, repo_key, day) DO UPDATE SET
      status = EXCLUDED.status, product_score = EXCLUDED.product_score, row_level = EXCLUDED.row_level,
      traction = EXCLUDED.traction`;
}

/**
 * One program's floor and precision from its labelled entries (an announced result other than
 * 'unknown'; the SQL never passes a self-report). Null both under WIN_RATE_MIN_LABELLED entries.
 * `floor`: the lowest product score among won or placed entries (null when none has a score).
 * `precision`: won or placed among entries shown as `likely`, over those entries (null with none). The
 * 30-entry minimum is on labelled entries, as spec A8 states, not on `likely` ones: with only a few
 * `likely` entries the figure can swing (one loss is 0%). Pure.
 */
export function matchStats(rows: { result: string; product_score: number | null; shown_status: string | null }[]): {
  floor: number | null;
  precision: number | null;
  labelled: number;
} {
  const labelled = rows.length;
  if (labelled < WIN_RATE_MIN_LABELLED) return { floor: null, precision: null, labelled };
  const won = (r: { result: string }) => r.result === 'won' || r.result === 'placed';
  const scores = rows.filter((r) => won(r) && r.product_score != null).map((r) => r.product_score!);
  const likely = rows.filter((r) => r.shown_status === 'likely');
  return {
    floor: scores.length > 0 ? Math.min(...scores) : null,
    precision: likely.length > 0 ? likely.filter(won).length / likely.length : null,
    labelled,
  };
}

/**
 * Writes every program's match_floor and match_precision from announced outcomes (never a
 * self-report, never an owner test installation's entry); programs under WIN_RATE_MIN_LABELLED
 * labelled entries are set back to null. Returns how many programs got figures.
 */
export async function updateMatchFloors(): Promise<{ updated: number }> {
  const db = sql();
  const ids = testInstallationIds();
  // Each labelled entry once: its latest announced result other than 'unknown'.
  const entries = await db<
    { id: number; program_id: string; installation_id: number | null; repo_url: string | null; name: string; product_score: number | null; submitted_at: Date; result: string }[]
  >`
    SELECT p.id, p.program_id, p.installation_id, p.repo_url, p.name, p.product_score, p.submitted_at, eo.result
    FROM projects p
    JOIN LATERAL (
      SELECT result FROM entry_outcomes
      WHERE project_id = p.id AND basis = 'announcement' AND result <> 'unknown'
      ORDER BY captured_at DESC, id DESC LIMIT 1
    ) eo ON true
    WHERE NOT COALESCE(p.installation_id = ANY(${ids}::int[]), false)`;
  const installs = [...new Set(entries.map((e) => e.installation_id).filter((i): i is number => i !== null))];
  const programs = [...new Set(entries.map((e) => e.program_id))];
  const shown = installs.length
    ? await db<{ installation_id: number; program_id: string; repo_key: string; status: string; day: string }[]>`
        SELECT installation_id, program_id, repo_key, status, day::text AS day FROM match_shown
        WHERE installation_id = ANY(${installs}::int[]) AND program_id = ANY(${programs}::text[])
        ORDER BY day DESC`
    : [];
  // What the entry's repo was last shown as in its program, on or before the day it was entered.
  const shownStatus = (e: (typeof entries)[number]) => {
    const key = repoKey({ url: e.repo_url, name: e.name });
    const entered = e.submitted_at.toISOString().slice(0, 10);
    return (
      shown.find((s) => s.installation_id === e.installation_id && s.program_id === e.program_id && s.repo_key === key && s.day <= entered)
        ?.status ?? null
    );
  };
  const byProgram = new Map<string, { result: string; product_score: number | null; shown_status: string | null }[]>();
  for (const e of entries) {
    const list = byProgram.get(e.program_id) ?? [];
    list.push({ result: e.result, product_score: e.product_score, shown_status: shownStatus(e) });
    byProgram.set(e.program_id, list);
  }
  const written: string[] = [];
  for (const [programId, rows] of byProgram) {
    const s = matchStats(rows);
    if (s.labelled < WIN_RATE_MIN_LABELLED) continue;
    await db`UPDATE programs SET match_floor = ${s.floor}, match_precision = ${s.precision} WHERE id = ${programId}`;
    written.push(programId);
  }
  await db`
    UPDATE programs SET match_floor = NULL, match_precision = NULL
    WHERE (match_floor IS NOT NULL OR match_precision IS NOT NULL) AND NOT (id = ANY(${written}::text[]))`;
  return { updated: written.length };
}

/**
 * v2.9 A8: keeps the entry's product score (projects.product_score) at confirmation, as matching
 * last showed it for this repo to this installation (the GitHub facts cache keeps no builder-dependent
 * signal, Pre-flight P6, so the score shown is the one on record). Unchanged when never shown.
 */
export async function saveEntryScore(projectId: number, installationId: number, key: string): Promise<void> {
  await sql()`
    UPDATE projects SET product_score = COALESCE((
      SELECT product_score FROM match_shown
      WHERE installation_id = ${installationId} AND repo_key = ${key} AND product_score IS NOT NULL
      ORDER BY day DESC LIMIT 1
    ), product_score)
    WHERE id = ${projectId}`;
}
