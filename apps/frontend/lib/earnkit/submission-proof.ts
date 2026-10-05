import { LARGE_PAGE_MAX_BYTES, SafeFetchError, safeFetchText } from './safe-fetch';
import { normalizeRepoUrl } from './campaigns';
import { roundFor } from './bonus-rounds';
import { sql } from './db';
import type { SubmissionProof } from './program-file';

/**
 * Submission proof for the builder bonus (v2.5 spec §3, Eligibility #3): a public URL on the
 * program's own submission site that EarnKit fetches and that links the entry's repo or live
 * site. `program.submission_proof` (program-file.ts) names the host and the path shape of a
 * specific entry (e.g. a DoraHacks BUIDL, `/buidl/<id>`); it is null for programs whose
 * submissions aren't public pages (a Google Form, a private review dashboard), which can never
 * earn the bonus.
 *
 * A failure here never fails `record_submission` (projects.ts): the entry is still recorded, just
 * not (yet) bonus-eligible, with this function's message telling the agent what to fix. A fetch
 * failure (network, timeout, a bad status) is reported as transient ("we retry daily") since the
 * cron re-checks a failed proof daily until the round ends.
 */

/** The one-sentence note for any fetch-level failure: transient, so it's retried, not final. */
const RETRY_NOTE = "couldn't check yet; we retry daily.";

/** host, lowercased, with one leading "www." dropped (same leniency as safe-fetch's sameSite). */
const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '');

const defaultFetch = (url: string) =>
  safeFetchText(url, { maxBytes: LARGE_PAGE_MAX_BYTES });

/**
 * Why `url` doesn't prove this entry's bonus-eligible submission, or null when it does. The link
 * must be https, on `program.submission_proof.host`, with a path matching `path_pattern`; the
 * fetched page (through `safeFetchText`, capped at `LARGE_PAGE_MAX_BYTES`) must then contain the
 * entry's normalized repo link or its live site's host, regardless of case or exact form. Never
 * throws. `deps.fetchText` is injectable for tests; pure otherwise. Exported for tests.
 */
export async function proofProblem(
  program: { id: string; submission_proof: SubmissionProof | null },
  url: string,
  repoUrl: string | undefined,
  liveUrl: string | undefined,
  deps: { fetchText?: (url: string) => Promise<string> } = {},
): Promise<string | null> {
  const proof = program.submission_proof;
  if (!proof)
    return `${program.id} has no public submission page EarnKit can check; the builder bonus isn't available here.`;
  if (!URL.canParse(url)) return 'external_submission_url is not a valid link.';
  const u = new URL(url);
  if (u.protocol !== 'https:') return 'the submission link must be https.';
  if (bareHost(u.hostname) !== bareHost(proof.host))
    return `the submission link must be on ${proof.host} (got ${u.hostname}).`;
  let pattern: RegExp;
  try {
    pattern = new RegExp(proof.path_pattern);
  } catch {
    return `${program.id}'s submission_proof pattern isn't valid; that's an EarnKit bug, not yours.`;
  }
  if (!pattern.test(u.pathname))
    return `the submission link doesn't look like one specific entry on ${proof.host}.`;
  if (!repoUrl && !liveUrl)
    return 'this entry has no repo_url or live_url to match against the submission page.';

  const fetchText = deps.fetchText ?? defaultFetch;
  let body: string;
  try {
    body = await fetchText(url);
  } catch (err) {
    if (err instanceof SafeFetchError && /larger than/.test(err.message))
      return `the submission page is larger than EarnKit can check (over ${Math.round(LARGE_PAGE_MAX_BYTES / 1000)} KB).`;
    return RETRY_NOTE;
  }
  const lower = body.toLowerCase();
  const repoNeedle = repoUrl ? normalizeRepoUrl(repoUrl) : null;
  // Fix I1: a malformed liveUrl (bad stored data, or a caller that skipped canonicalBuilderUrl)
  // must never make proofProblem throw; it just can't contribute a needle.
  const liveNeedle =
    liveUrl && URL.canParse(liveUrl) ? bareHost(new URL(liveUrl).hostname) : null;
  const found =
    (!!repoNeedle && lower.includes(repoNeedle)) ||
    (!!liveNeedle && lower.includes(liveNeedle));
  if (!found)
    return `the page at ${url} doesn't link to your repo or live site yet; add the link there, and EarnKit checks again daily.`;
  return null;
}

/** An entry whose submission proof hasn't passed yet, with what proofProblem needs to re-check it. */
type RecheckRow = {
  project_id: number;
  submission_proof_url: string;
  repo_url: string | null;
  live_url: string | null;
  program_id: string;
  status: string;
  starts_at: Date | null;
  ends_at: Date | null;
  submission_proof: SubmissionProof | null;
};

/** At most once a day per entry (Ruling 11). */
export const PROOF_RECHECK_INTERVAL_MS = 24 * 3_600_000;

/**
 * Fix round 1, Ruling 11 (carried from Task 5's review): the cron's daily re-check of a submission
 * proof that hasn't passed yet. For every entry with a `submission_proof_url` and no
 * `submission_proof_ok_at`, not re-checked within `PROOF_RECHECK_INTERVAL_MS`, whose program is
 * still `active` and whose bonus round is still open (`roundFor`, bonus-rounds.ts) at `now`:
 * re-runs `proofProblem` and records the attempt (`submission_proof_checked_at`, always;
 * `submission_proof_ok_at`, only once it passes). An entry whose round has ended (or hasn't
 * started, or whose program is no longer active) is skipped without a fetch — it can never be
 * checked into eligibility again. Bounded by `deadline`; one entry's failure never stops the rest.
 * `deps.fetchText` is injectable for tests.
 */
export async function recheckSubmissionProofs(
  now: Date,
  deadline: number,
  deps: { fetchText?: (url: string) => Promise<string> } = {},
): Promise<{ checked: number; passed: number }> {
  const stale = new Date(now.getTime() - PROOF_RECHECK_INTERVAL_MS);
  const rows = await sql()<RecheckRow[]>`
    SELECT pr.id AS project_id, pr.submission_proof_url, pr.repo_url, pr.live_url,
      p.id AS program_id, p.status, p.starts_at, p.ends_at, p.submission_proof
    FROM projects pr
    JOIN programs p ON p.id = pr.program_id
    WHERE pr.submission_proof_url IS NOT NULL AND pr.submission_proof_ok_at IS NULL
      AND (pr.submission_proof_checked_at IS NULL OR pr.submission_proof_checked_at < ${stale})
    ORDER BY pr.submission_proof_checked_at ASC NULLS FIRST, pr.id`;
  let checked = 0;
  let passed = 0;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    if (row.status !== 'active') continue;
    if (!roundFor({ id: row.program_id, starts_at: row.starts_at, ends_at: row.ends_at }, now))
      continue;
    let problem: string | null;
    try {
      problem = await proofProblem(
        { id: row.program_id, submission_proof: row.submission_proof },
        row.submission_proof_url,
        row.repo_url ?? undefined,
        row.live_url ?? undefined,
        deps,
      );
    } catch (err) {
      console.error('[submission-proof] recheck', row.project_id, err);
      continue;
    }
    checked++;
    if (problem) {
      await sql()`UPDATE projects SET submission_proof_checked_at = ${now} WHERE id = ${row.project_id}`;
    } else {
      passed++;
      await sql()`
        UPDATE projects SET submission_proof_checked_at = ${now}, submission_proof_ok_at = ${now}
        WHERE id = ${row.project_id}`;
    }
  }
  return { checked, passed };
}
