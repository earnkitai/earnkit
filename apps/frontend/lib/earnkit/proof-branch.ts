import { createHash, createHmac, randomBytes } from 'node:crypto';
import { githubRepo } from './campaigns';
import { CONFIRMED_PROOFS } from './confirmed';
import { sql, type Db } from './db';
import { noteEvent } from './events';
import { repoEverDerived } from './github-verify';
import { REPO_KEY, mainProjectOf } from './main-project';
import { profileChanged } from './profile-cache';
import { setFallback } from './profiles';
import { defaultReaderDeps, type ReaderDeps } from './source-readers';

/**
 * v2.13.1 O1 (owner ruling, 2026-10-16, after weighing a gist, GitHub sign-in and a commit): the one
 * project's proof is a short-lived branch, `earnkit-<code>`, that the coding agent pushes to the exact
 * repo. It points at the current commit: no file, no commit, nothing for the builder to do. The
 * builder is told in one line, and the agent deletes the branch once EarnKit has confirmed it.
 *
 * - The code: 12 lowercase base32 characters of HMAC(EARNKIT_AUTH_SECRET, seed), the seed 16 random
 *   bytes. Only the seed and the code's sha256 are stored (the database alone never gives a code
 *   back). Bound to the person and this exact repo key, PROOF_BRANCH_TTL_MS, single use.
 * - Issued (fix round 1, ruling b) only to an agent that can build (ruling c), only when no code is
 *   open for this key, and at most once per PROOF_BRANCH_ISSUE_GAP_MS per person across every key. A
 *   code that expired unused shows the plain "couldn't show" line until the next one may be issued.
 * - Exclusive (authorization ruling): a repo another person already holds a confirmed repo source for
 *   is never confirmed again, and gets no code (the first confirmed holder keeps it).
 * - The check (at most once per PROOF_BRANCH_RECHECK_MS per code, claimed atomically): the ref
 *   `GET /repos/{key}/git/ref/heads/earnkit-<code>`, the repo itself (that key, never a fork or a
 *   template), and who pushed the branch (the repo activity API). A User's repo confirms only when every
 *   push of that branch is its owner's; an Organization's repo for any pusher (push access implied).
 *   EarnKit's GITHUB_TOKEN, a budgeted ghFetch, redirects refused.
 * - On a pass: the code is used, the repo source verified with `proof_branch`, the pusher recorded
 *   as the person's proven GitHub login (github_basis `proof_branch`), the person rescored at once;
 *   the next reply tells the agent to delete the branch, once.
 * Only under EARNKIT_BENCH (the callers are the Bench's find and score, and the cron's step).
 */
export const PROOF_BRANCH_TTL_MS = 60 * 60_000;
/** Fix round 1: GitHub is read for a code at most this often. */
export const PROOF_BRANCH_RECHECK_MS = 60_000;
/** Fix round 1 (ruling b): at most one new code per person in this long, across every repo key. */
export const PROOF_BRANCH_ISSUE_GAP_MS = 24 * 60 * 60_000;
/** Fix round 1: the cron clears used or expired codes issued longer ago than this. */
export const PROOF_BRANCH_KEEP_MS = 7 * 24 * 60 * 60_000;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** The code a seed stands for (32 divides 256, so unbiased). Null without the secret. */
function codeOf(seed: string, secret = process.env.EARNKIT_AUTH_SECRET): string | null {
  if (!secret) return null;
  const mac = createHmac('sha256', secret).update(`proof-branch:v1:${seed}`).digest();
  return [...mac.subarray(0, 12)].map((b) => BASE32[b % 32]).join('');
}
export const branchOf = (code: string) => `earnkit-${code}`;
export const pushCommand = (code: string) => `git push origin HEAD:refs/heads/${branchOf(code)}`;
export const removeCommand = (code: string) => `git push origin :refs/heads/${branchOf(code)}`;

export const PROOF_BRANCH_NOTE =
  "Run proof.push now in the folder of the repo proof.repo names: it points a temporary branch at the current commit (no file, no commit). Then call find again, which checks it. Once EarnKit confirms it, delete the branch with proof.remove. Don't ask the builder anything else. Don't show this note.";
export const removeNote = (remove: string) => `Confirmed. Delete the branch now: ${remove}`;

export type ProofBranch = { repo: string; branch: string; push: string; remove: string; agent_note: string };
/**
 * What the reply says while the one project (a repo key) isn't confirmed: checking (with the agent's
 * proof), the branch never showed, the agent can't push (no code), or another person holds the repo.
 * Null: nothing to say about a branch (not a repo key, the code was used, or no code may be issued yet).
 */
export type BranchState =
  | { kind: 'checking'; proof: ProofBranch }
  | { kind: 'failed' }
  | { kind: 'needs_agent' }
  | { kind: 'taken' }
  | null;

const proofOf = (key: string, code: string): ProofBranch => ({
  repo: key, branch: branchOf(code), push: pushCommand(code), remove: removeCommand(code), agent_note: PROOF_BRANCH_NOTE,
});
/** A repo source's ref as a repo key (benchConfirmedSql's own normalisation). */
const refKey = (db: Db) => db`regexp_replace(lower(trim(ref)), '^(https?://)?(www[.])?github[.]com/', '')`;

/** Whether another person already holds a confirmed repo source for `key`. */
async function heldByOther(builderId: number, key: string, db: Db = sql()): Promise<boolean> {
  const [r] = await db`
    SELECT 1 FROM builder_sources WHERE builder_id <> ${builderId} AND kind = 'repo' AND state = 'verified'
      AND proof = ANY(${[...CONFIRMED_PROOFS]}::text[]) AND ${refKey(db)} = ${key} LIMIT 1`;
  return Boolean(r);
}

/**
 * The proof branch for `key` (the person's one project, not confirmed), as the module comment says:
 * the open code; else, for an agent that can build and with no code issued to the person in the last
 * day, a new one; else `failed` (this key's last code expired unused) or null (wait for the day).
 */
export async function proofBranchFor(builderId: number, key: string, now: Date, o: { canBuild: boolean }): Promise<BranchState> {
  const k = key.toLowerCase();
  const secret = process.env.EARNKIT_AUTH_SECRET;
  if (!REPO_KEY.test(k) || !secret) return null;
  if (await heldByOther(builderId, k)) return { kind: 'taken' };
  return sql().begin(async (tx) => {
    // Per person: the once-a-day cap spans every key.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`proof_branch:${builderId}`}))`;
    const [last] = await tx<{ seed: string; expires_at: Date; used_at: Date | null }[]>`
      SELECT seed, expires_at, used_at FROM proof_branches WHERE builder_id = ${builderId} AND repo_key = ${k} ORDER BY issued_at DESC LIMIT 1`;
    if (last?.used_at) return null;
    if (last && last.expires_at > now) {
      const code = codeOf(last.seed, secret);
      return code ? { kind: 'checking' as const, proof: proofOf(k, code) } : null;
    }
    if (!o.canBuild) return { kind: 'needs_agent' as const };
    const [recent] = await tx`
      SELECT 1 FROM proof_branches WHERE builder_id = ${builderId} AND issued_at > ${new Date(now.getTime() - PROOF_BRANCH_ISSUE_GAP_MS)} LIMIT 1`;
    if (recent) return last ? { kind: 'failed' as const } : null;
    const seed = randomBytes(16).toString('base64url');
    const code = codeOf(seed, secret)!;
    await tx`
      INSERT INTO proof_branches (code_hash, seed, builder_id, repo_key, issued_at, expires_at)
      VALUES (${sha256(code)}, ${seed}, ${builderId}, ${k}, ${now}, ${new Date(now.getTime() + PROOF_BRANCH_TTL_MS)})`;
    return { kind: 'checking' as const, proof: proofOf(k, code) };
  });
}

const TIMEOUT_MS = 10_000;

/**
 * Who pushed `earnkit-<code>` to exactly `key`, when that push may confirm it, else null: the ref is on
 * that key (no redirect), the repo is that key and the person's own work (not a fork or template), and
 * (a User's repo) every push of the branch is its owner's, or (an Organization's) anyone's: its creator.
 * Never throws.
 */
async function branchPusher(key: string, code: string, f: typeof fetch): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const get = async (path: string): Promise<unknown> => {
    const res = await f(`https://api.github.com/repos/${key}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EarnKit', 'X-GitHub-Api-Version': '2022-11-28', ...(token && { Authorization: `Bearer ${token}` }) },
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    return res.json().catch(() => null);
  };
  const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
  try {
    const branch = branchOf(code);
    const full = `refs/heads/${branch}`;
    const ref = obj(await get(`/git/ref/heads/${branch}`));
    if (ref?.ref !== full) return null;
    if (typeof ref.url !== 'string' || !ref.url.toLowerCase().startsWith(`https://api.github.com/repos/${key}/git/refs/heads/`)) return null;
    const repo = obj(await get(''));
    if (typeof repo?.full_name !== 'string' || repo.full_name.toLowerCase() !== key) return null;
    if (await repoEverDerived(key, repo.fork !== false || repo.is_template === true)) return null;
    const owner = obj(repo.owner);
    const ownerLogin = typeof owner?.login === 'string' ? owner.login.toLowerCase() : null;
    if (!ownerLogin || ownerLogin !== key.split('/')[0]) return null;
    const activity = await get(`/activity?ref=${encodeURIComponent(full)}&per_page=30`);
    const pushers = (Array.isArray(activity) ? activity : [])
      .map(obj)
      .filter((a): a is Record<string, unknown> => a?.ref === full)
      .map((a) => obj(a.actor)?.login)
      .filter((l): l is string => typeof l === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(l))
      .map((l) => l.toLowerCase());
    if (pushers.length === 0) return null;
    if (owner?.type === 'Organization') return pushers[pushers.length - 1];
    return owner?.type === 'User' && pushers.every((l) => l === ownerLogin) ? ownerLogin : null;
  } catch (err) {
    console.error('[proof-branch] read', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * Checks the person's open code (their one project, unexpired, unused, not read in the last minute:
 * claimed atomically, so at most one GitHub check a minute however many replies ask). On a pass, the
 * module comment's steps. True when it confirmed. `ghFetch`: the caller's budgeted fetch (absent: a
 * budget of its own). Never throws.
 */
export async function checkProofBranch(builderId: number, now: Date, o: { ghFetch?: typeof fetch } = {}): Promise<boolean> {
  try {
    const key = (await mainProjectOf(builderId))?.toLowerCase() ?? null;
    if (!key || !REPO_KEY.test(key)) return false;
    const [open] = await sql()<{ code_hash: string; seed: string }[]>`
      UPDATE proof_branches SET checked_at = ${now}
      WHERE code_hash = (
        SELECT code_hash FROM proof_branches
        WHERE builder_id = ${builderId} AND repo_key = ${key} AND used_at IS NULL AND expires_at > ${now}
        ORDER BY issued_at DESC LIMIT 1)
        AND (checked_at IS NULL OR checked_at <= ${new Date(now.getTime() - PROOF_BRANCH_RECHECK_MS)})
      RETURNING code_hash, seed`;
    const code = open ? codeOf(open.seed) : null;
    if (!open || !code || (await heldByOther(builderId, key))) return false;
    const f = o.ghFetch ?? defaultReaderDeps(now, Date.now() + TIMEOUT_MS).ghFetch ?? fetch;
    const pusher = await branchPusher(key, code, f);
    if (!pusher) return false;
    const sourceId = await sql().begin(async (tx) => {
      // Per repo: two people's checks of one repo never both confirm it.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`proof_branch_repo:${key}`}))`;
      if (await heldByOther(builderId, key, tx)) return null;
      const find = () => tx<{ id: number; state: string }[]>`
        SELECT id::int AS id, state FROM builder_sources WHERE builder_id = ${builderId} AND kind = 'repo' AND ${refKey(tx)} = ${key}
        ORDER BY (state = 'proposed') DESC, id LIMIT 1`;
      let [s] = await find();
      if (!s) {
        await tx`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${builderId}, 'repo', ${key}, ${key}, 'server') ON CONFLICT DO NOTHING`;
        [s] = await find();
      }
      // A refused repo stays refused (a push never overrides discovery's verdict).
      if (!s || s.state !== 'proposed') return null;
      const [used] = await tx`
        UPDATE proof_branches SET used_at = ${now} WHERE code_hash = ${open.code_hash} AND used_at IS NULL AND expires_at > ${now} RETURNING 1`;
      if (!used) return null;
      await tx`
        UPDATE builder_sources SET state = 'verified', proof = 'proof_branch', verified_at = now(), reject_reason = NULL
        WHERE id = ${s.id} AND state = 'proposed'`;
      return s.id;
    });
    if (sourceId === null) return false;
    await noteEvent('source_verified', () => ({
      type: 'source_verified', dedupe_key: `source_verified:${sourceId}`, installation_id: builderId, detail: { source_id: sourceId, kind: 'repo', proof: 'proof_branch' },
    }));
    await setFallback(builderId, { github_login: pusher, basis: 'proof_branch' });
    await (await import('./person-score')).rescorePerson(builderId, now);
    profileChanged();
    return true;
  } catch (err) {
    console.error('[proof-branch] check', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/**
 * Fix round 1 (ruling a): whether this installation's person proved `repoUrl` with a proof branch,
 * so a coin needs no earnkit.txt line. The installation's own rows or its group root's. Never throws.
 */
export async function branchProvenRepo(installationId: number, repoUrl: string): Promise<boolean> {
  const gh = githubRepo(repoUrl);
  if (!gh) return false;
  const key = `${gh.owner}/${gh.repo}`.toLowerCase();
  try {
    const db = sql();
    const [r] = await db`
      SELECT 1 FROM builder_sources s JOIN installations i ON s.builder_id IN (i.id, COALESCE(i.builder_id, i.id))
      WHERE i.id = ${installationId} AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'proof_branch' AND ${refKey(db)} = ${key}
      LIMIT 1`;
    return Boolean(r);
  } catch (err) {
    console.error('[proof-branch] proven', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/** Once after a confirmation: the agent's note to delete the branch (null when there is nothing to tell). */
export async function branchToRemove(builderId: number, now: Date): Promise<{ remove: string; agent_note: string } | null> {
  const [row] = await sql()<{ seed: string }[]>`
    UPDATE proof_branches SET told_at = ${now}
    WHERE code_hash = (SELECT code_hash FROM proof_branches WHERE builder_id = ${builderId} AND used_at IS NOT NULL AND told_at IS NULL ORDER BY used_at DESC LIMIT 1)
      AND told_at IS NULL
    RETURNING seed`;
  const code = row ? codeOf(row.seed) : null;
  if (!code) return null;
  const remove = removeCommand(code);
  return { remove, agent_note: removeNote(remove) };
}

/**
 * The cron's step: each person with an open code not read in the last minute (at most `limit`),
 * checked with the run's budgeted ghFetch until `deadline`; then codes used or expired and issued over
 * PROOF_BRANCH_KEEP_MS ago are deleted. No ghFetch, or past the deadline: nothing.
 */
export async function proofBranchStep(
  now: Date,
  o: { reader?: ReaderDeps; only?: number[]; limit?: number; deadline: number },
): Promise<{ checked: number; confirmed: number; cleared: number }> {
  const ghFetch = o.reader?.ghFetch;
  if (!ghFetch || Date.now() >= o.deadline) return { checked: 0, confirmed: 0, cleared: 0 };
  const db = sql();
  const only = o.only ? db`AND builder_id IN ${db(o.only.length ? o.only : [-1])}` : db``;
  const due = await db<{ builder_id: number }[]>`
    SELECT DISTINCT builder_id FROM proof_branches
    WHERE used_at IS NULL AND expires_at > ${now} AND (checked_at IS NULL OR checked_at <= ${new Date(now.getTime() - PROOF_BRANCH_RECHECK_MS)}) ${only}
    ORDER BY builder_id LIMIT ${o.limit ?? 50}`;
  let checked = 0;
  let confirmed = 0;
  for (const { builder_id } of due) {
    if (Date.now() >= o.deadline) break;
    checked++;
    if (await checkProofBranch(builder_id, now, { ghFetch })) confirmed++;
  }
  const gone = await db`
    DELETE FROM proof_branches
    WHERE issued_at < ${new Date(now.getTime() - PROOF_BRANCH_KEEP_MS)} AND (used_at IS NOT NULL OR expires_at <= ${now}) ${only}`;
  return { checked, confirmed, cleared: gone.count };
}
