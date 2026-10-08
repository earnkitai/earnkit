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
    /**
     * Ruling C22: true when the announcement names every winner of this round. Then every other
     * submitted EarnKit entry of the program is labelled `not_selected`; when false, `unknown`
     * (which never counts as a published result).
     */
    complete: z.boolean(),
    /**
     * Final review I4: the round's window, as UTC days, both inclusive. Only entries submitted in
     * it are this round's: an entry made after the round closed (already in the next round of a
     * rolling program) is never labelled here. Re-review I-A: a complete file needs both
     * `entries_from` (the round's first day) and `entries_until` (its deadline), so only this
     * round's entries are ever labelled `not_selected`; a partial file may leave them out.
     */
    entries_from: z.string().date().optional(),
    entries_until: z.string().date().optional(),
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
  .strict()
  .refine((f) => !f.complete || f.entries_from !== undefined, {
    message: "a complete file needs entries_from (the round's first day), so earlier rounds are never labelled",
    path: ['entries_from'],
  })
  .refine((f) => !f.complete || f.entries_until !== undefined, {
    message: 'a complete file needs entries_until (the round deadline), so later rounds are never labelled',
    path: ['entries_until'],
  })
  .refine((f) => !f.entries_from || !f.entries_until || f.entries_from <= f.entries_until, {
    message: 'entries_from is after entries_until',
    path: ['entries_from'],
  });
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
 * Every entry an announced result names (review minor 5: two entries of the same repo, say an
 * owner test entry and a real one, are both labelled). A repo decides alone (normalized; a repo
 * that matches no entry is no match, even if a name would). Then the live link (host and path). A
 * name matches case-insensitively only when exactly one entry has it. Pure.
 */
export function matchOutcomeAll(r: { repo?: string; name?: string; live_url?: string }, entries: EntryRef[]): number[] {
  if (r.repo) {
    const key = normalizeRepoUrl(r.repo.startsWith('http') ? r.repo : `https://${r.repo}`);
    return entries.filter((e) => e.repo_url && normalizeRepoUrl(e.repo_url) === key).map((e) => e.id);
  }
  if (r.live_url) {
    const want = site(r.live_url);
    const hits = want ? entries.filter((e) => e.live_url && site(e.live_url) === want) : [];
    if (hits.length > 0) return hits.map((e) => e.id);
  }
  if (r.name) {
    const name = r.name.trim().toLowerCase();
    const same = entries.filter((e) => e.name.trim().toLowerCase() === name);
    return same.length === 1 ? [same[0].id] : [];
  }
  return [];
}

/** The first entry an announced result names, or null (matchOutcomeAll's rules). Pure. */
export function matchOutcome(r: { repo?: string; name?: string; live_url?: string }, entries: EntryRef[]): number | null {
  return matchOutcomeAll(r, entries)[0] ?? null;
}

/** The win alert's line: "you won $500 in Arc Microgrants with TipJar", or without a stated prize "TipJar won in Arc Microgrants". Pure. */
export function winLine(o: { prize_usd: number | null; program_title: string; name: string }): string {
  return o.prize_usd !== null && o.prize_usd > 0
    ? `you won ${usd(o.prize_usd)} in ${o.program_title} with ${o.name}`
    : `${o.name} won in ${o.program_title}`;
}

/** The builder's own answer to the outcome question (v2.9 A3: given through tell_earnkit). */
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
 * Upserts one announcement file as `entry_outcomes` rows (basis 'announcement'). Candidates are
 * the program's submitted entries (the Ruling C10 rule) made by the announcement day and inside
 * the round's window (`entries_from` to `entries_until`, UTC days, final review I4), in id order;
 * test installations are included here and excluded later, in stats. Each named result labels
 * every entry it matches. Ruling C22: every other candidate is labelled too, `not_selected` when
 * the file is `complete`, else `unknown`, except an entry already labelled by another round's
 * announcement (it belongs to that round). The file is the truth for its round: a re-sync
 * overwrites. Returns counts only: callers print counts, never names.
 */
export async function syncOutcomeFile(
  f: OutcomeFile,
  db: Db = sql(),
): Promise<{ matched: number; unmatched: number; others: number }> {
  // Re-review I-A: the loader parses with OutcomeFile; this guards a caller that didn't.
  if (f.complete && (!f.entries_from || !f.entries_until))
    throw new Error('a complete outcome file needs entries_from and entries_until');
  const entries = await db<EntryRef[]>`
    SELECT p.id, p.repo_url, p.name, p.live_url FROM projects p
    WHERE p.program_id = ${f.program_id}
      -- By the end of the announcement day, in UTC (never the server's time zone).
      AND p.submitted_at < ((${f.captured_at}::date + 1)::timestamp AT TIME ZONE 'UTC')
      -- Final review I4: the round's window (UTC days, inclusive). A later round's entry is not this round's.
      AND (${f.entries_until ?? null}::date IS NULL
        OR p.submitted_at < ((${f.entries_until ?? null}::date + 1)::timestamp AT TIME ZONE 'UTC'))
      AND (${f.entries_from ?? null}::date IS NULL
        OR p.submitted_at >= (${f.entries_from ?? null}::date::timestamp AT TIME ZONE 'UTC'))
      AND (p.confirmed_at IS NULL OR p.submission_proof_ok_at IS NOT NULL OR p.submission_confirmed_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM submissions su WHERE su.project_id = p.id))
    ORDER BY p.id`;
  const upsert = (projectId: number, result: (typeof OUTCOME_RESULTS)[number], prize: number | null) => db`
    INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, source_url, captured_at, basis)
    VALUES (${projectId}, ${f.program_id}, ${f.round_label}, ${result}, ${prize}, ${f.source_url},
      (${f.captured_at}::date::timestamp AT TIME ZONE 'UTC'), 'announcement')
    ON CONFLICT (project_id, round_label, basis) DO UPDATE SET
      result = EXCLUDED.result, prize_usd = EXCLUDED.prize_usd, source_url = EXCLUDED.source_url,
      captured_at = EXCLUDED.captured_at`;
  const named = new Set<number>();
  let matched = 0;
  let unmatched = 0;
  for (const r of f.results) {
    const ids = matchOutcomeAll(r, entries);
    if (ids.length === 0) {
      unmatched++;
      continue;
    }
    matched++;
    for (const id of ids) {
      named.add(id);
      await upsert(id, r.result, r.prize_usd ?? null);
    }
  }
  // An unnamed entry another round's announcement already labelled (a real result, not `unknown`)
  // belongs to that round.
  const elsewhere = new Set(
    (
      await db<{ project_id: number }[]>`
        SELECT DISTINCT project_id FROM entry_outcomes
        WHERE program_id = ${f.program_id} AND basis = 'announcement' AND round_label <> ${f.round_label}
          AND result <> 'unknown'`
    ).map((r) => r.project_id),
  );
  const others = entries.filter((e) => !named.has(e.id) && !elsewhere.has(e.id));
  for (const e of others) await upsert(e.id, f.complete ? 'not_selected' : 'unknown', null);
  return { matched, unmatched, others: others.length };
}

/**
 * Stores the builder's answer for one of this installation's own entries (basis 'self_reported').
 * Another installation's entry, or none: NotFoundError.
 */
export async function saveSelfReport(installationId: number, r: ReportOutcome, db: Db = sql()): Promise<void> {
  const rows = await db<{ id: number }[]>`
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
