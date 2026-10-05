import { LARGE_PAGE_MAX_BYTES, SafeFetchError, safeFetchText } from './safe-fetch';
import { normalizeRepoUrl } from './campaigns';
import { roundFor } from './bonus-rounds';
import { sql } from './db';
import type { SubmissionProof } from './program-file';

/**
 * Submission proof for the builder bonus (v2.5 spec §3, Eligibility #3): a public URL on the
 * program's own submission site that EarnKit fetches and that links the entry's repo (or, for an
 * entry without one, its own live site). `program.submission_proof` (program-file.ts) names the host and the path shape of a
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
 * entry's normalized repo link when it has a repo (Ruling 22), else its live site's host when that
 * isn't a shared one (sharedHost), regardless of case or exact form. Never throws. `deps.fetchText` is injectable for tests; pure otherwise. Exported for tests.
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
  // Ruling 22: an entry with a repo must have its repo on the page. Only a repo-less entry may
  // prove itself by its live site's host, and never a host every submission page links (the
  // proof site itself, or a shared platform): otherwise any other team's page would pass.
  if (repoUrl) {
    if (!lower.includes(normalizeRepoUrl(repoUrl)))
      return `the page at ${url} doesn't link to your repo yet; add the repo link there, and EarnKit checks again daily.`;
    return null;
  }
  // Fix I1: a malformed liveUrl (bad stored data, or a caller that skipped canonicalBuilderUrl)
  // must never make proofProblem throw; it just can't contribute a needle.
  const liveNeedle = liveUrl && URL.canParse(liveUrl) ? bareHost(new URL(liveUrl).hostname) : null;
  if (!liveNeedle || sharedHost(liveNeedle, proof.host))
    return `a live link on ${liveNeedle ?? 'that host'} can't prove this entry (every submission page can link it); add the project's repo_url, or use a live site on its own domain.`;
  if (!hostLinked(lower, liveNeedle))
    return `the page at ${url} doesn't link to your live site yet; add the link there, and EarnKit checks again daily.`;
  return null;
}

/**
 * Hosts any submission page may link whoever the entry is (Ruling 22): never proof of one entry by
 * themselves. Sites and their subdomains: the submission platforms, code hosts and social sites.
 */
export const SHARED_SITES = [
  'dorahacks.io', 'colosseum.com', 'devpost.com', 'devfolio.co', 'ethglobal.com', 'taikai.network',
  'github.com', 'gitlab.com', 'bitbucket.org', 'x.com', 'twitter.com', 't.co', 'youtube.com', 'youtu.be',
  'loom.com', 'linkedin.com', 'medium.com', 'mirror.xyz', 'discord.com', 'discord.gg', 't.me', 'telegram.org',
  'warpcast.com', 'farcaster.xyz', 'google.com', 'notion.so', 'figma.com', 'basescan.org', 'etherscan.io',
];
/** Hosting platforms whose bare (apex) domain is shared; a project's own subdomain is its own site. */
export const SHARED_APEXES = ['vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'notion.site', 'replit.app', 'onrender.com', 'railway.app'];

/** Whether `host` is the proof host or a shared site (or a subdomain of one), or a shared apex. Pure. */
export function sharedHost(host: string, proofHost: string) {
  const h = bareHost(host);
  const under = (site: string) => h === site || h.endsWith(`.${site}`);
  return under(bareHost(proofHost)) || SHARED_SITES.some(under) || SHARED_APEXES.includes(h);
}

/**
 * Whether `host` appears in `text` as a whole host (N1): not inside a longer host on either side
 * (so dex.vercel.app never matches super-dex.vercel.app or dex.vercel.app.evil.io), with an
 * optional www. before it. Text and host lowercase. Pure.
 */
export function hostLinked(text: string, host: string) {
  const h = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9.-])(?:www\\.)?${h}(?!\\.?[a-z0-9-])`).test(text);
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
/** Entries re-checked per cron run at most (M11); the hourly runs take the rest. */
export const RECHECK_BATCH = 50;

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
  // M11: only entries that can still become eligible (an active program with a builder bonus whose
  // round is open now, as roundFor judges it), oldest attempt first, at most RECHECK_BATCH a run.
  const rows = await sql()<RecheckRow[]>`
    SELECT pr.id AS project_id, pr.submission_proof_url, pr.repo_url, pr.live_url,
      p.id AS program_id, p.status, p.starts_at, p.ends_at, p.submission_proof
    FROM projects pr
    JOIN programs p ON p.id = pr.program_id
    WHERE pr.submission_proof_url IS NOT NULL AND pr.submission_proof_ok_at IS NULL
      AND (pr.submission_proof_checked_at IS NULL OR pr.submission_proof_checked_at < ${stale})
      AND p.status = 'active' AND p.submission_proof IS NOT NULL
      AND (p.starts_at IS NULL OR p.starts_at <= ${now})
      AND (p.ends_at IS NULL OR (p.starts_at IS NOT NULL AND ${now} < p.ends_at))
    ORDER BY pr.submission_proof_checked_at ASC NULLS FIRST, pr.id
    LIMIT ${RECHECK_BATCH}`;
  let checked = 0;
  let passed = 0;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    if (row.status !== 'active' || !roundFor({ id: row.program_id, starts_at: row.starts_at, ends_at: row.ends_at }, now)) {
      // Can't become eligible now: stamped, so it isn't picked again within the day.
      await sql()`UPDATE projects SET submission_proof_checked_at = ${now} WHERE id = ${row.project_id}`;
      continue;
    }
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
