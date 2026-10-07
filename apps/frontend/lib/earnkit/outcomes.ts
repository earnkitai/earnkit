import { z } from 'zod';
import { normalizeRepoUrl, usd } from './campaigns';
import { sql, type Db } from './db';
import { NotFoundError } from './programs';

/**
 * v2.8 Part G, Ruling 30 (plan): what happened to each entry.
 *
 * - Announcements: the weekly routine commits `programs/outcomes/<program-id>.json` (OutcomeFile);
 *   `pnpm programs:sync` matches each result to EarnKit entries (matchOutcome) and upserts
 *   `entry_outcomes` rows with basis 'announcement'. Only these alert ("you won ...") and count in
 *   `/api/stats`.
 * - Self-reports: once a program's `results.expected` has passed, list_programs asks the agent once
 *   per entry (outcomeToAsk) and stores the answer with basis 'self_reported' (saveSelfReport).
 *   Never in stats, never alerted, never on a public page; the next weekly run checks it.
 *
 * No new service and no new cron: sync runs at deploy, alerts are pulled on the builder's calls.
 */

export const OUTCOME_RESULTS = ['won', 'placed', 'finalist', 'not_selected', 'unknown'] as const;

export const OutcomeFile = z
  .object({
    program_id: z.string(),
    round_label: z.string().min(1).max(80),
    source_url: z.string().url().startsWith('https://'),
    captured_at: z.string().date(),
    results: z
      .array(
        z
          .object({
            repo: z.string().optional(),
            name: z.string().optional(),
            live_url: z.string().optional(),
            result: z.enum(OUTCOME_RESULTS),
            prize_usd: z.number().nonnegative().optional(),
          })
          .strict()
          .refine((r) => r.repo || r.name || r.live_url, 'each result names a repo, name or live link'),
      )
      .min(1),
  })
  .strict();
export type OutcomeFile = z.infer<typeof OutcomeFile>;

/** An EarnKit entry as the matcher sees it. */
export type EntryRef = { id: number; repo_url: string | null; name: string; live_url: string | null };

/** "tipjar.example/app" from any form of a link: no scheme, no www., no trailing slash, lowercase. */
const site = (u: string) => {
  try {
    const x = new URL(u.startsWith('http') ? u : `https://${u}`);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * The entry an announced result names, or null. A repo decides alone (normalized; a repo that
 * matches no entry is no match, even if a name would). Then the live link (host and path). A name
 * matches case-insensitively only when exactly one entry has it. Pure.
 */
export function matchOutcome(r: { repo?: string; name?: string; live_url?: string }, entries: EntryRef[]): number | null {
  if (r.repo) {
    const key = normalizeRepoUrl(r.repo.startsWith('http') ? r.repo : `https://${r.repo}`);
    const hit = entries.find((e) => e.repo_url && normalizeRepoUrl(e.repo_url) === key);
    return hit ? hit.id : null;
  }
  if (r.live_url) {
    const want = site(r.live_url);
    const hit = want ? entries.find((e) => e.live_url && site(e.live_url) === want) : undefined;
    if (hit) return hit.id;
  }
  if (r.name) {
    const name = r.name.trim().toLowerCase();
    const same = entries.filter((e) => e.name.trim().toLowerCase() === name);
    return same.length === 1 ? same[0].id : null;
  }
  return null;
}

/** The win alert's line: "you won $500 in Arc Microgrants with TipJar", or without a stated prize "TipJar won in Arc Microgrants". Pure. */
export function winLine(o: { prize_usd: number | null; program_title: string; name: string }): string {
  return o.prize_usd !== null && o.prize_usd > 0
    ? `you won ${usd(o.prize_usd)} in ${o.program_title} with ${o.name}`
    : `${o.name} won in ${o.program_title}`;
}

/** list_programs' `report_outcome`: the builder's own answer to the outcome question. */
export const ReportOutcome = z
  .object({
    project_id: z.number().int().positive(),
    result: z.enum(['won', 'placed', 'finalist', 'not_selected']),
    prize_usd: z.number().nonnegative().optional(),
  })
  .strict();
export type ReportOutcome = z.infer<typeof ReportOutcome>;

/** The one question the agent asks after results are due. */
export const outcomeQuestion = (name: string, program: string) => `Did ${name} win anything in ${program}?`;

/** The round label a self-report is stored under (one self-report per entry; the latest answer wins). */
export const SELF_REPORT_ROUND = 'builder report';

/**
 * Upserts one announcement file's matched results as `entry_outcomes` rows (basis 'announcement').
 * Every entry in the program is a candidate (test installations are excluded later, in stats).
 * Returns counts only: callers print counts, never names.
 */
export async function syncOutcomeFile(f: OutcomeFile, db: Db = sql()): Promise<{ matched: number; unmatched: number }> {
  const entries = await db<EntryRef[]>`
    SELECT id, repo_url, name, live_url FROM projects WHERE program_id = ${f.program_id}`;
  let matched = 0;
  let unmatched = 0;
  for (const r of f.results) {
    const projectId = matchOutcome(r, entries);
    if (projectId === null) {
      unmatched++;
      continue;
    }
    matched++;
    await db`
      INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, source_url, captured_at, basis)
      VALUES (${projectId}, ${f.program_id}, ${f.round_label}, ${r.result}, ${r.prize_usd ?? null}, ${f.source_url},
        ${f.captured_at}::date, 'announcement')
      ON CONFLICT (project_id, round_label, basis) DO UPDATE SET
        result = EXCLUDED.result, prize_usd = EXCLUDED.prize_usd, source_url = EXCLUDED.source_url,
        captured_at = EXCLUDED.captured_at`;
  }
  return { matched, unmatched };
}

/**
 * Stores the builder's answer for one of this installation's own entries (basis 'self_reported').
 * Another installation's entry, or none: NotFoundError.
 */
export async function saveSelfReport(installationId: number, r: ReportOutcome): Promise<void> {
  const rows = await sql()<{ id: number }[]>`
    INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis)
    SELECT p.id, p.program_id, ${SELF_REPORT_ROUND}, ${r.result}, ${r.prize_usd ?? null}, 'self_reported'
    FROM projects p WHERE p.id = ${r.project_id} AND p.installation_id = ${installationId}
    ON CONFLICT (project_id, round_label, basis) DO UPDATE SET
      result = EXCLUDED.result, prize_usd = EXCLUDED.prize_usd, captured_at = now()
    RETURNING id`;
  if (rows.length === 0) throw new NotFoundError(`No entry ${r.project_id} for this agent.`);
}

/**
 * At most one entry to ask about per call (Ruling 30): this installation's submitted entry whose
 * program's `results.expected` day has passed, with no outcome of any basis and never asked.
 * Marks it asked in the same statement, so the question is asked once. Null when there is none.
 */
export async function outcomeToAsk(installationId: number, now = new Date()) {
  const [row] = await sql()<{ project_id: number; name: string; program_title: string }[]>`
    WITH pick AS (
      SELECT p.id FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE p.installation_id = ${installationId}
        AND p.outcome_asked_at IS NULL
        AND pr.results IS NOT NULL
        AND (pr.results->>'expected')::date < ${now}::date
        -- Submitted only (the Ruling C10 rule): a confirmed entry never sent is not asked about.
        AND (p.confirmed_at IS NULL OR p.submission_proof_ok_at IS NOT NULL OR p.submission_confirmed_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM submissions su WHERE su.project_id = p.id))
        AND NOT EXISTS (SELECT 1 FROM entry_outcomes eo WHERE eo.project_id = p.id)
      ORDER BY p.submitted_at, p.id
      LIMIT 1
      FOR UPDATE OF p SKIP LOCKED
    )
    UPDATE projects p SET outcome_asked_at = now()
    FROM pick, programs pr
    WHERE p.id = pick.id AND pr.id = p.program_id AND p.outcome_asked_at IS NULL
    RETURNING p.id AS project_id, p.name, pr.title AS program_title`;
  return row ?? null;
}
