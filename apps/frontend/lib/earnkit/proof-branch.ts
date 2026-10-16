import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { repoEverDerived } from './github-verify';
import { REPO_KEY, mainProjectOf } from './main-project';
import { profileChanged } from './profile-cache';
import { defaultReaderDeps, type ReaderDeps } from './source-readers';
import { proposeSource, verifySource } from './sources';

/**
 * v2.13.1 O1 (owner ruling, 2026-10-16, after weighing a gist, GitHub sign-in and a commit): the one
 * project's proof is a short-lived branch, `earnkit-<code>`, that the agent pushes to the exact repo.
 * It points at the current commit: no file, no commit, nothing for the builder to do. The builder is
 * told in one line, and the agent deletes the branch once EarnKit has confirmed it.
 * - The code is 12 lowercase base32 characters from a CSPRNG, bound to the person and this exact repo
 *   key, valid for PROOF_BRANCH_TTL_MS, single use. A new code is issued only when none was issued for
 *   this person and key before: an unused code that expired means the branch never showed (the agent
 *   couldn't push), and the reply says so once and for all (no loop, no proof line).
 * - The check is one read of `GET /repos/{key}/git/ref/heads/earnkit-<code>` with the server's
 *   GITHUB_TOKEN (a budgeted ghFetch where the caller has one), redirects refused, so a renamed repo or
 *   a fork (another key) never counts; then one read of the repo itself: it must be that key, and never
 *   a fork or a template (repoEverDerived, as discovery's own rule).
 * - On a pass: the code is used (atomically), the repo source is verified with proof `proof_branch`,
 *   and the person is rescored at once. The next reply tells the agent to delete the branch, once.
 * Only under EARNKIT_BENCH (the callers are the Bench's find, score and refresh, and the cron's step).
 */
export const PROOF_BRANCH_TTL_MS = 60 * 60_000;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** 12 random base32 characters (32 divides 256, so unbiased). */
const newCode = () => [...randomBytes(12)].map((b) => BASE32[b % 32]).join('');
export const branchOf = (code: string) => `earnkit-${code}`;
export const pushCommand = (code: string) => `git push origin HEAD:refs/heads/${branchOf(code)}`;
export const removeCommand = (code: string) => `git push origin :refs/heads/${branchOf(code)}`;

export const PROOF_BRANCH_NOTE =
  "Run proof.push now in the folder of the repo proof.repo names: it points a temporary branch at the current commit (no file, no commit). Then call find again, which checks it. Once EarnKit confirms it, delete the branch with proof.remove. Don't ask the builder anything else. Don't show this note.";
export const removeNote = (remove: string) => `Confirmed. Delete the branch now: ${remove}`;

export type ProofBranch = { repo: string; branch: string; push: string; remove: string; agent_note: string };
/** What the reply says while the one project (a repo key) isn't confirmed: checking (with the agent's proof), or the branch never showed. */
export type BranchState = { kind: 'checking'; proof: ProofBranch } | { kind: 'failed' } | null;

type Issue = { code: string; expires_at: Date; used_at: Date | null };
const proofOf = (key: string, code: string): ProofBranch => ({
  repo: key, branch: branchOf(code), push: pushCommand(code), remove: removeCommand(code), agent_note: PROOF_BRANCH_NOTE,
});

/**
 * The proof branch for `key` (the person's one project, a repo key, not confirmed): the open code, or
 * a new one when none was ever issued for this person and key (`issue`), or `failed` when the last
 * code expired unused. Null: not a repo key, or the last code was used (it confirmed), or nothing to issue.
 */
export async function proofBranchFor(builderId: number, key: string, now: Date, o: { issue: boolean }): Promise<BranchState> {
  const k = key.toLowerCase();
  if (!REPO_KEY.test(k)) return null;
  return sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`proof_branch:${builderId}:${k}`}))`;
    const [last] = await tx<Issue[]>`
      SELECT code, expires_at, used_at FROM proof_branches WHERE builder_id = ${builderId} AND repo_key = ${k} ORDER BY issued_at DESC LIMIT 1`;
    if (last?.used_at) return null;
    if (last) return last.expires_at > now ? { kind: 'checking' as const, proof: proofOf(k, last.code) } : { kind: 'failed' as const };
    if (!o.issue) return null;
    const code = newCode();
    await tx`
      INSERT INTO proof_branches (code, builder_id, repo_key, issued_at, expires_at)
      VALUES (${code}, ${builderId}, ${k}, ${now}, ${new Date(now.getTime() + PROOF_BRANCH_TTL_MS)})`;
    return { kind: 'checking' as const, proof: proofOf(k, code) };
  });
}

const TIMEOUT_MS = 10_000;

/** Whether the branch is on exactly `key` (no redirect), and `key` is the person's own work (not a fork or template). Never throws. */
async function branchShows(key: string, code: string, f: typeof fetch): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const get = async (path: string): Promise<Record<string, unknown> | null> => {
    const res = await f(`https://api.github.com/repos/${key}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EarnKit', 'X-GitHub-Api-Version': '2022-11-28', ...(token && { Authorization: `Bearer ${token}` }) },
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const body = (await res.json().catch(() => null)) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  };
  try {
    const branch = branchOf(code);
    const ref = await get(`/git/ref/heads/${branch}`);
    if (ref?.ref !== `refs/heads/${branch}`) return false;
    if (typeof ref.url !== 'string' || !ref.url.toLowerCase().startsWith(`https://api.github.com/repos/${key}/git/refs/heads/`)) return false;
    const repo = await get('');
    if (typeof repo?.full_name !== 'string' || repo.full_name.toLowerCase() !== key) return false;
    const derived = repo.fork !== false || repo.is_template === true;
    return !(await repoEverDerived(key, derived));
  } catch (err) {
    console.error('[proof-branch] read', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/**
 * Checks the person's open code (their one project, unexpired, unused) once. On a pass: the code is
 * used, the repo source verified (`proof_branch`) and the person rescored at once. True when it
 * confirmed. `ghFetch`: the run's budgeted fetch (absent: a fresh budget of its own). Never throws.
 */
export async function checkProofBranch(builderId: number, now: Date, o: { ghFetch?: typeof fetch } = {}): Promise<boolean> {
  try {
    const key = (await mainProjectOf(builderId))?.toLowerCase() ?? null;
    if (!key || !REPO_KEY.test(key)) return false;
    const [open] = await sql()<{ code: string }[]>`
      SELECT code FROM proof_branches
      WHERE builder_id = ${builderId} AND repo_key = ${key} AND used_at IS NULL AND expires_at > ${now}
      ORDER BY issued_at DESC LIMIT 1`;
    if (!open) return false;
    const f = o.ghFetch ?? defaultReaderDeps(now, Date.now() + TIMEOUT_MS).ghFetch ?? fetch;
    if (!(await branchShows(key, open.code, f))) return false;
    const [used] = await sql()`
      UPDATE proof_branches SET used_at = ${now}
      WHERE code = ${open.code} AND builder_id = ${builderId} AND repo_key = ${key} AND used_at IS NULL AND expires_at > ${now}
      RETURNING 1`;
    if (!used) return false;
    await confirmRepo(builderId, key);
    await (await import('./person-score')).rescorePerson(builderId, now);
    profileChanged();
    return true;
  } catch (err) {
    console.error('[proof-branch] check', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/**
 * The repo source for `key` (the agent's, any ref shape benchConfirmedSql matches; else a server one)
 * verified with `proof_branch`. A push proves more than a login does, so a repo discovery refused as
 * someone else's (`not_owner`) is opened again first; any other refusal (derived) stands.
 */
async function confirmRepo(builderId: number, key: string): Promise<void> {
  const find = () => sql()<{ id: number; state: string; reject_reason: string | null }[]>`
    SELECT id::int AS id, state, reject_reason FROM builder_sources
    WHERE builder_id = ${builderId} AND kind = 'repo' AND regexp_replace(lower(trim(ref)), '^(https?://)?(www[.])?github[.]com/', '') = ${key}
    ORDER BY (state = 'proposed') DESC, id LIMIT 1`;
  let [s] = await find();
  if (!s) {
    await proposeSource({ builder_id: builderId, kind: 'repo', ref: key, project_key: key, proposed_by: 'server' });
    [s] = await find();
  }
  if (!s) return;
  if (s.state === 'rejected' && s.reject_reason === 'not_owner')
    await sql()`UPDATE builder_sources SET state = 'proposed', reject_reason = NULL WHERE id = ${s.id} AND state = 'rejected'`;
  await verifySource(s.id, 'proof_branch');
}

/** Once after a confirmation: the agent's note to delete the branch (null when there is nothing to tell). */
export async function branchToRemove(builderId: number, now: Date): Promise<{ remove: string; agent_note: string } | null> {
  const [row] = await sql()<{ code: string }[]>`
    UPDATE proof_branches SET told_at = ${now}
    WHERE code = (SELECT code FROM proof_branches WHERE builder_id = ${builderId} AND used_at IS NOT NULL AND told_at IS NULL ORDER BY used_at DESC LIMIT 1)
      AND told_at IS NULL
    RETURNING code`;
  if (!row) return null;
  const remove = removeCommand(row.code);
  return { remove, agent_note: removeNote(remove) };
}

/** The cron's step: every person with an open code (at most `limit`), checked with the run's budgeted ghFetch (absent: skipped). */
export async function proofBranchStep(now: Date, o: { reader?: ReaderDeps; only?: number[]; limit?: number } = {}): Promise<{ checked: number; confirmed: number }> {
  const ghFetch = o.reader?.ghFetch;
  if (!ghFetch) return { checked: 0, confirmed: 0 };
  const due = await sql()<{ builder_id: number }[]>`
    SELECT DISTINCT builder_id FROM proof_branches WHERE used_at IS NULL AND expires_at > ${now}
      ${o.only ? sql()`AND builder_id IN ${sql()(o.only.length ? o.only : [-1])}` : sql()``}
    ORDER BY builder_id LIMIT ${o.limit ?? 50}`;
  let confirmed = 0;
  for (const { builder_id } of due) if (await checkProofBranch(builder_id, now, { ghFetch })) confirmed++;
  return { checked: due.length, confirmed };
}
