import { createHash, createHmac, randomBytes } from 'node:crypto';
import { cantSeeLine, cantShowLine, copyLine, displayName, foreignLine, installAppAsk, takenLine } from './bench-reply';
import { CONFIRMED_PROOFS } from './confirmed';
import { sql, type Db } from './db';
import { noteEvent } from './events';
import { appTokenFor, githubAppEnabled } from './github-app';
import { createVerifyLink, repoEverDerived } from './github-verify';
import { REPO_KEY, benchConfirmedSql, mainProjectOf } from './main-project';
import { profileChanged } from './profile-cache';
import { setFallback } from './profiles';
import { hit, windowStart } from './rate-limit';
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
 * - O5 N2: before a code is issued, one cheap read of the repo (REPO_PROBE_MS, outside any lock, its
 *   verdict kept a day): a repo EarnKit's token can't read, a fork or template, or a User's repo under
 *   another login, gets its plain line at once and no code; the agent
 *   reports a refused push with tell proof { pushed: false } (pushRefused), which ends the code at once.
 * Only under EARNKIT_BENCH (the callers are the Bench's find and score, and the cron's step).
 */
export const PROOF_BRANCH_TTL_MS = 60 * 60_000;
/** Fix round 1: GitHub is read for a code at most this often. */
export const PROOF_BRANCH_RECHECK_MS = 60_000;
/** Fix round 1 (ruling b): a code that expired unused blocks a new one for its key this long. */
export const PROOF_BRANCH_ISSUE_GAP_MS = 24 * 60 * 60_000;
/** v2.13.1 O2 fix round 1 (ruling 2): at most this many new codes per person per rolling PROOF_BRANCH_ISSUE_GAP_MS, across every key. */
export const PROOF_BRANCH_MAX_PER_DAY = 5;
/** Fix round 1: the cron clears used or expired codes issued longer ago than this. */
export const PROOF_BRANCH_KEEP_MS = 7 * 24 * 60 * 60_000;
/**
 * v2.13.2 (1): an Organization's repo confirmed by a proof branch is confirmed for this long after
 * `verified_at` (any member's push confirms it, and the pusher may since have lost push access). A
 * User's repo (only its owner's push confirms it) never expires.
 */
export const ORG_PROOF_MAX_AGE_MS = 90 * 24 * 60 * 60_000;
/** v2.13.2 (1): at most this many expired org proofs are returned to proposed per run. */
export const ORG_PROOF_PER_RUN = 100;
/** v2.13.2 (1): the reject_reason note on a repo source whose org proof expired (state 'proposed'). */
export const STALE = 'stale';
/**
 * v2.13.2 review: the note on a still-verified source whose expiry was rolled back because its person's
 * rescore failed: the next run takes it last, so it never blocks anyone (cleared when it expires or is re-proven).
 */
export const STALE_RETRY = 'stale_retry';

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

/**
 * O5 N2, N3: the agent is told how to report a refused push (tell proof { pushed: false }, which ends the
 * wait at once) and what to do when the next find still says it's checking (GitHub can take a minute).
 */
export const PROOF_BRANCH_NOTE =
  "Run proof.push now in the folder of the repo proof.repo names: it points a temporary branch at the current commit (no file, no commit). " +
  "If the push is refused, call tell with proof: { pushed: false } and don't retry. Then call find once more, which checks it. " +
  "If it still says it's checking, wait a minute and call find once more; never show the same reply twice. " +
  "Once EarnKit confirms it, delete the branch with proof.remove. Don't ask the builder anything else. Don't show this note.";
/** O5 N10: an agent note, so it says it is one. */
export const removeNote = (remove: string) => `Confirmed. Delete the branch now: ${remove}. Don't show this note.`;
/** O5 N2: the reply to tell proof { pushed: false }: the next find says it plainly. */
export const PUSH_REFUSED_NOTE = "Saved. Call find once now and show its reply as written; it tells the builder what's next. Don't retry the push. Don't show this note.";
/** O5 N2: tell proof { pushed: true } (or nothing open to check): nothing changes. */
export const PUSH_DONE_NOTE = "Saved. Call find once more, which checks it. Don't show this note.";

export type ProofBranch = { repo: string; branch: string; push: string; remove: string; agent_note: string };
/**
 * What the reply says while the one project (a repo key) isn't confirmed: checking (with the agent's
 * proof), the branch never showed, the agent can't push (no code), or another person holds the repo.
 * Null: nothing to say about a branch (not a repo key, the code was used, or no code may be issued yet).
 */
export type BranchState =
  /** v2.13.2 (1): `again`, the repo's org proof expired (STALE): the reply says it's time to show it's still theirs. */
  | { kind: 'checking'; proof: ProofBranch; again?: true }
  | { kind: 'failed' }
  | { kind: 'needs_agent' }
  | { kind: 'taken' }
  /** O5 N2: a User's repo whose owner is not the login the person proved or the agent reported. */
  | { kind: 'foreign' }
  /** O5 fix round 1: a fork or a template (only original work goes on the Bench). */
  | { kind: 'copy' }
  /** O5 fix round 1: EarnKit's token can't read the repo (404: private, or gone). */
  | { kind: 'unseen' }
  | null;

const proofOf = (key: string, code: string): ProofBranch => ({
  repo: key, branch: branchOf(code), push: pushCommand(code), remove: removeCommand(code), agent_note: PROOF_BRANCH_NOTE,
});
/** A repo source's ref as a repo key (benchConfirmedSql's own normalisation). */
const refKey = (db: Db) => db`regexp_replace(lower(trim(ref)), '^(https?://)?(www[.])?github[.]com/', '')`;

/** A builder id's person: its installation's group root (fix round 2), else the id itself. */
const rootSql = (db: Db, id: number) => db`COALESCE((SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = ${id}), ${id})`;

/**
 * Whether another person (another group root, fix round 2: never the person's own linked
 * installation) already holds a confirmed repo source for `key`. Discovery's repo_owner verdict asks
 * it too, so the first confirmed holder keeps a repo.
 */
export async function heldByOther(builderId: number, key: string, db: Db = sql()): Promise<boolean> {
  const [r] = await db`
    SELECT 1 FROM builder_sources s WHERE s.kind = 'repo' AND s.state = 'verified'
      AND s.proof = ANY(${[...CONFIRMED_PROOFS]}::text[]) AND regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', '') = ${key.toLowerCase()}
      AND COALESCE((SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = s.builder_id), s.builder_id) <> ${rootSql(db, builderId)}
    LIMIT 1`;
  return Boolean(r);
}

/**
 * v2.13.3 (5): the read-only GitHub App's installation token for exactly `key`, when THIS person (their
 * installation, github_verifications via 'app') installed it on that repo; else null (the App is off, no
 * such proof, or GitHub refused). Minted per call through `f` (the caller's budgeted fetch), never stored
 * or logged: it only replaces EarnKit's own token on reads of that repo. Never throws.
 */
async function appBearer(builderId: number, key: string, f: typeof fetch): Promise<string | null> {
  if (!githubAppEnabled()) return null;
  return appTokenFor({ installationId: builderId, repoKey: key }, { fetch: f }).catch(() => null);
}
/** v2.13.3 review M1: `p`'s answer if it comes within `ms`, else null (it runs on; nothing waits for it). Never throws. */
async function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}
/** GitHub REST headers: the installation token when given (v2.13.3), else EarnKit's own token. */
const ghHeaders = (bearer: string | null = null) => {
  const token = bearer ?? process.env.GITHUB_TOKEN?.trim();
  return { Accept: 'application/vnd.github+json', 'User-Agent': 'EarnKit', 'X-GitHub-Api-Version': '2022-11-28', ...(token && { Authorization: `Bearer ${token}` }) };
};

/** O5 N1, N2: the reply waits at most this long for the one cheap read of the repo; slower is "unknown". */
export const REPO_PROBE_MS = 700;
type Probe =
  | { kind: 'read'; private: boolean | null; owner: string; ownerType: string | null }
  | { kind: 'missing' } | { kind: 'copy' } | { kind: 'unknown' };
/**
 * O5 N2, N4: one read of `GET /repos/{key}` (EarnKit's token, redirects refused), cut at REPO_PROBE_MS:
 * the repo as GitHub shows it, `missing` (404: private to EarnKit's token, or gone), else `unknown` (slow,
 * down, renamed, rate-limited). Never throws.
 */
async function probeRepo(key: string, f: typeof fetch, bearer: string | null = null, ms = REPO_PROBE_MS): Promise<Probe> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Probe>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'unknown' }), ms);
  });
  const read = (async (): Promise<Probe> => {
    const res = await f(`https://api.github.com/repos/${key}`, { redirect: 'manual', signal: AbortSignal.timeout(ms), headers: ghHeaders(bearer) });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return res.status === 404 ? { kind: 'missing' } : { kind: 'unknown' };
    }
    const repo = obj(await res.json().catch(() => null));
    const owner = obj(repo?.owner);
    const login = typeof owner?.login === 'string' ? owner.login.toLowerCase() : null;
    if (typeof repo?.full_name !== 'string' || repo.full_name.toLowerCase() !== key || login !== key.split('/')[0]) return { kind: 'unknown' };
    if (repo.fork !== false || repo.is_template === true) return { kind: 'copy' };
    return { kind: 'read', private: typeof repo.private === 'boolean' ? repo.private : null, owner: login, ownerType: typeof owner?.type === 'string' ? owner.type : null };
  })().catch((): Probe => ({ kind: 'unknown' }));
  const out = await Promise.race([read, late]);
  clearTimeout(timer);
  return out;
}

/** O5 N4: the person's repo source for `key` read public just now (the page names it until a newer reading says otherwise). */
async function markPublic(builderId: number, key: string, now: Date, db: Db = sql()): Promise<void> {
  await db`UPDATE builder_sources SET public_at = ${now} WHERE builder_id = ${builderId} AND kind = 'repo' AND state <> 'rejected' AND ${refKey(db)} = ${key}`;
}

/** O5 fix round 1: a probe's verdict is remembered this long per person and key (standing_seen.repo_probe). */
export const REPO_PROBE_KEEP_MS = 24 * 60 * 60_000;
type Kept = Exclude<Probe, { kind: 'unknown' }> & { at: string };

/**
 * O5 N2 (and fix round 1): before a code is issued, what one cheap read of the repo already shows:
 * `unseen` when EarnKit's token can't read it (no branch on it could ever be read), `copy` for a fork or a
 * template, `foreign` when it is a User's repo and the person's proven GitHub login (else the one the agent
 * reported) is someone else (only the owner's push confirms a User's repo). A public read marks the source
 * public at once (N4). The verdict is kept REPO_PROBE_KEEP_MS (`fresh`: a coin launch reads again); the
 * login is compared on every call. Runs outside any transaction. Null: nothing known, so the code is
 * issued as before (a slow or failed read never blocks it, and is never kept).
 */
async function knownUnprovable(builderId: number, key: string, now: Date, f: typeof fetch | undefined, o: { fresh: boolean }): Promise<BranchState> {
  const db = sql();
  const [row] = await db<{ kept: Kept | null; login: string | null }[]>`
    SELECT standing_seen->'repo_probe'->(${key}::text) AS kept, lower(COALESCE(github_login, reported_github)) AS login FROM builder_profiles WHERE builder_id = ${builderId}`;
  const kept = row?.kept && typeof row.kept === 'object' && typeof row.kept.at === 'string' && now.getTime() - Date.parse(row.kept.at) < REPO_PROBE_KEEP_MS ? row.kept : null;
  let probe: Probe | Kept | null = o.fresh ? null : kept;
  const fetchFn = f ?? defaultReaderDeps(now, Date.now() + REPO_PROBE_MS).ghFetch ?? fetch;
  const keep = async (p: Probe) => {
    if (p.kind === 'read' && p.private === false) await markPublic(builderId, key, now, db);
    if (p.kind !== 'unknown')
      // O5 fix round 2: kept reads older than REPO_PROBE_KEEP_MS are dropped on every write.
      await db`
        UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{repo_probe}',
          COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(standing_seen->'repo_probe') e
            WHERE (e.value->>'at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' AND (e.value->>'at')::timestamptz > ${new Date(now.getTime() - REPO_PROBE_KEEP_MS)}), '{}'::jsonb)
            || jsonb_build_object(${key}::text, ${db.json({ ...p, at: now.toISOString() } as never)}::jsonb))
        WHERE builder_id = ${builderId}`;
  };
  if (!probe) {
    probe = await probeRepo(key, fetchFn);
    await keep(probe);
  }
  // v2.13.3 (5): a repo EarnKit's token can't see is read again with the App's token, when this person
  // installed the App on it (a kept "missing" from before the install never stands in the way). Review M1:
  // the mint and that read share one REPO_PROBE_MS window on the reply path; slower, the repo stays unseen
  // for this reply (nothing is kept from it) and the next reply tries again.
  if (probe.kind === 'missing' && githubAppEnabled()) {
    const until = Date.now() + REPO_PROBE_MS;
    const viaApp = await within(
      (async () => {
        const bearer = await appBearer(builderId, key, fetchFn);
        return bearer ? probeRepo(key, fetchFn, bearer, Math.max(1, until - Date.now())) : null;
      })(),
      REPO_PROBE_MS,
    );
    if (viaApp && viaApp.kind !== 'unknown') {
      probe = viaApp;
      await keep(viaApp);
    }
  }
  if (probe.kind === 'missing') return { kind: 'unseen' };
  if (probe.kind === 'copy') return { kind: 'copy' };
  if (probe.kind !== 'read' || probe.ownerType !== 'User') return null;
  const login = row?.login ?? null;
  return login && LOGIN.test(login) && login !== probe.owner ? { kind: 'foreign' } : null;
}

/**
 * O5 N2: the agent says the push of the branch was refused (tell proof { pushed: false }): the open code
 * for the one project ends now, unused, so the next find says the plain line and asks for a different
 * project at once (the day's `failed`). True when a code was open.
 */
export async function pushRefused(builderId: number, now: Date): Promise<boolean> {
  const key = (await mainProjectOf(builderId))?.toLowerCase() ?? null;
  if (!key) return false;
  const ended = await sql()`
    UPDATE proof_branches SET expires_at = ${now}
    WHERE builder_id = ${builderId} AND repo_key = ${key} AND used_at IS NULL AND closed_at IS NULL AND expires_at > ${now}
    RETURNING 1`;
  return ended.length > 0;
}

/**
 * The proof branch for `key` (the person's one project, not confirmed), as the module comment says:
 * the open code; else, for an agent that can build and with no code issued to the person in the last
 * day, a new one; else `failed` (this key's last code expired unused) or null (wait for the day).
 * `buildDeploy`: no day's wait after an expired code (the 5-a-day cap still holds).
 */
export async function proofBranchFor(
  builderId: number, key: string, now: Date,
  o: {
    canBuild: boolean; reproof?: boolean;
    /**
     * v2.13.1 O3: a starter build's deploy step. Its code may have expired while the agent was building,
     * so an expired unused code gets a fresh one at once (still within PROOF_BRANCH_MAX_PER_DAY), never
     * the day's `failed` lockout that find gives.
     */
    buildDeploy?: boolean;
    /** O5 N2, N4: the fetch for the one cheap read of the repo before a code is issued (absent: EarnKit's own, budgeted). */
    ghFetch?: typeof fetch;
    /** O5 N2: a starter build's own new repo (the agent just created and pushed it): no read first. */
    newRepo?: boolean;
  },
): Promise<BranchState> {
  const k = key.toLowerCase();
  const secret = process.env.EARNKIT_AUTH_SECRET;
  if (!REPO_KEY.test(k) || !secret) return null;
  if (await heldByOther(builderId, k)) return { kind: 'taken' };
  type Last = { seed: string; expires_at: Date; used_at: Date | null; closed_at: Date | null; issued_at: Date };
  const lastOf = async (db: Db) =>
    (await db<Last[]>`
      SELECT seed, expires_at, used_at, closed_at, issued_at FROM proof_branches WHERE builder_id = ${builderId} AND repo_key = ${k} ORDER BY issued_at DESC LIMIT 1`)[0];
  const dayAgo = new Date(now.getTime() - PROOF_BRANCH_ISSUE_GAP_MS);
  // v2.13.2 (1): the repo's org proof expired (expireOrgProofs): a used code no longer settles it.
  const [stale] = await sql()`
    SELECT 1 FROM builder_sources WHERE builder_id = ${builderId} AND kind = 'repo' AND state = 'proposed' AND reject_reason = ${STALE} AND ${refKey(sql())} = ${k} LIMIT 1`;
  const again = stale ? ({ again: true } as const) : {};
  // A code that expired unused (the branch never showed, or O5 N2 the agent said the push was refused):
  // no loop, the plain line for a day. O2 fix round 1 (ruling 2): a code closed because the one project
  // changed doesn't count. `undefined`: a new code may be issued.
  const settled = (last: Last | undefined): BranchState | undefined => {
    // A used code confirmed the repo; only a coin launch's fresh proof (fix round 2) asks again.
    if (last?.used_at && !o.reproof && !stale) return null;
    if (last && !last.used_at && last.expires_at > now) {
      const code = codeOf(last.seed, secret);
      return code ? { kind: 'checking', proof: proofOf(k, code), ...again } : null;
    }
    if (last && !last.used_at && !last.closed_at && !o.buildDeploy && last.issued_at > dayAgo) return { kind: 'failed' };
    return undefined;
  };
  const before = settled(await lastOf(sql()));
  if (before !== undefined) return before;
  // O5 N2: what EarnKit can know at once, from one cheap read of the repo (never a wait of an hour).
  // O5 fix round 1: read outside the transaction and its lock, and remembered a day per key.
  const known = o.newRepo ? null : await knownUnprovable(builderId, k, now, o.ghFetch, { fresh: o.reproof === true });
  if (known) return known;
  if (!o.canBuild) return { kind: 'needs_agent' };
  return sql().begin(async (tx) => {
    // Per person: the once-a-day cap spans every key.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`proof_branch:${builderId}`}))`;
    const last = await lastOf(tx);
    const now2 = settled(last);
    if (now2 !== undefined) return now2;
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM proof_branches WHERE builder_id = ${builderId} AND issued_at > ${dayAgo}`;
    const failed = Boolean(last && !last.used_at && !last.closed_at);
    if (n >= PROOF_BRANCH_MAX_PER_DAY) return failed ? { kind: 'failed' as const } : null;
    const seed = randomBytes(16).toString('base64url');
    const code = codeOf(seed, secret)!;
    await tx`
      INSERT INTO proof_branches (code_hash, seed, builder_id, repo_key, issued_at, expires_at)
      VALUES (${sha256(code)}, ${seed}, ${builderId}, ${k}, ${now}, ${new Date(now.getTime() + PROOF_BRANCH_TTL_MS)})`;
    return { kind: 'checking' as const, proof: proofOf(k, code), ...again };
  });
}

const TIMEOUT_MS = 10_000;
/** Fix round 2: a coin trusts a proof branch this long, and only after a launch-time read of the repo. */
export const PROOF_BRANCH_COIN_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

/** One GitHub REST read of `/repos/{key}{path}` (EarnKit's token, redirects refused): the JSON, or null on anything but a 200. */
async function ghRead(key: string, path: string, f: typeof fetch, bearer: string | null = null): Promise<unknown> {
  const res = await f(`https://api.github.com/repos/${key}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: ghHeaders(bearer) });
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  return res.json().catch(() => null);
}
const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

/** What GitHub says about exactly `key` when it is the person's own work (discovery's rule): its numeric id and owner; else null. */
type RepoRead = { id: number; owner: string; ownerType: 'User' | 'Organization'; private: boolean | null };
async function readRepo(key: string, f: typeof fetch, bearer: string | null = null): Promise<RepoRead | null> {
  const repo = obj(await ghRead(key, '', f, bearer));
  if (typeof repo?.full_name !== 'string' || repo.full_name.toLowerCase() !== key) return null;
  if (typeof repo.id !== 'number' || !Number.isSafeInteger(repo.id)) return null;
  if (await repoEverDerived(key, repo.fork !== false || repo.is_template === true)) return null;
  const owner = obj(repo.owner);
  const login = typeof owner?.login === 'string' ? owner.login.toLowerCase() : null;
  const type = owner?.type;
  if (!login || login !== key.split('/')[0] || (type !== 'User' && type !== 'Organization')) return null;
  return { id: repo.id, owner: login, ownerType: type, private: typeof repo.private === 'boolean' ? repo.private : null };
}

/**
 * Who pushed `earnkit-<code>` to exactly `key`, when that push may confirm it, with the repo's read;
 * else null. The ref is on that key (no redirect), the repo is that key and the person's own work, and
 * the branch's pushes (GitHub's activity record): a User's repo only when every one names its owner
 * (fix round 2: one with no readable actor refuses); an Organization's, its creator (the
 * branch_creation entry, never a later push). Never throws.
 */
async function branchPusher(key: string, code: string, f: typeof fetch, bearer: string | null = null): Promise<(RepoRead & { login: string }) | null> {
  try {
    const branch = branchOf(code);
    const full = `refs/heads/${branch}`;
    const ref = obj(await ghRead(key, `/git/ref/heads/${branch}`, f, bearer));
    if (ref?.ref !== full) return null;
    if (typeof ref.url !== 'string' || !ref.url.toLowerCase().startsWith(`https://api.github.com/repos/${key}/git/refs/heads/`)) return null;
    const repo = await readRepo(key, f, bearer);
    if (!repo) return null;
    const activity = await ghRead(key, `/activity?ref=${encodeURIComponent(full)}&per_page=100`, f, bearer);
    const entries = (Array.isArray(activity) ? activity : []).map(obj).filter((a): a is Record<string, unknown> => a?.ref === full);
    const actorOf = (a: Record<string, unknown>) => {
      const l = obj(a.actor)?.login;
      return typeof l === 'string' && LOGIN.test(l) ? l.toLowerCase() : null;
    };
    if (entries.length === 0) return null;
    if (repo.ownerType === 'Organization') {
      const created = entries.find((a) => a.activity_type === 'branch_creation');
      const login = created ? actorOf(created) : null;
      return login ? { ...repo, login } : null;
    }
    return entries.every((a) => actorOf(a) === repo.owner) ? { ...repo, login: repo.owner } : null;
  } catch (err) {
    console.error('[proof-branch] read', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * Checks the person's open code for `key` (default: their one project), unexpired, unused, not read
 * in the last minute (claimed atomically, so at most one GitHub check a minute however many replies
 * ask). On a pass, the module comment's steps; a repo already verified (a coin's fresh proof, fix
 * round 2) gets the proof again with GitHub's id and owner now. True when it confirmed. `ghFetch`:
 * the caller's budgeted fetch (absent: a budget of its own). Never throws.
 */
export async function checkProofBranch(builderId: number, now: Date, o: { ghFetch?: typeof fetch; key?: string } = {}): Promise<boolean> {
  try {
    const key = (o.key ?? (await mainProjectOf(builderId)))?.toLowerCase() ?? null;
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
    // v2.13.3 (5): a private or org repo this person installed the App on is read with its per-call token
    // (the same branch, pusher and repo rules: the App never confirms anything by itself).
    const read = await branchPusher(key, code, f, await appBearer(builderId, key, f));
    if (!read) return false;
    const sourceId = await sql().begin(async (tx) => {
      // Per repo: two people's checks of one repo never both confirm it.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`proof_branch_repo:${key}`}))`;
      if (await heldByOther(builderId, key, tx)) return null;
      const find = () => tx<{ id: number; state: string }[]>`
        SELECT id::int AS id, state FROM builder_sources WHERE builder_id = ${builderId} AND kind = 'repo' AND ${refKey(tx)} = ${key}
        ORDER BY (state = 'verified') DESC, (state = 'proposed') DESC, id LIMIT 1`;
      let [s] = await find();
      if (!s) {
        await tx`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${builderId}, 'repo', ${key}, ${key}, 'server') ON CONFLICT DO NOTHING`;
        [s] = await find();
      }
      // A refused repo stays refused (a push never overrides discovery's verdict).
      if (!s || s.state === 'rejected') return null;
      const [used] = await tx`
        UPDATE proof_branches SET used_at = ${now} WHERE code_hash = ${open.code_hash} AND used_at IS NULL AND expires_at > ${now} RETURNING 1`;
      if (!used) return null;
      await tx`
        UPDATE builder_sources SET state = 'verified', proof = 'proof_branch', verified_at = ${now}, reject_reason = NULL,
          gh_repo_id = ${read.id}, gh_owner = ${read.owner}, gh_owner_type = ${read.ownerType},
          -- O5 N4: the repo read just now says public: the page names it at once.
          public_at = CASE WHEN ${read.private === false} THEN ${now}::timestamptz ELSE public_at END
        WHERE id = ${s.id} AND state IN ('proposed', 'verified')`;
      return s.id;
    });
    if (sourceId === null) return false;
    await noteEvent('source_verified', () => ({
      type: 'source_verified', dedupe_key: `source_verified:${sourceId}:${now.toISOString()}`, installation_id: builderId,
      detail: { source_id: sourceId, kind: 'repo', proof: 'proof_branch' },
    }));
    await setFallback(builderId, { github_login: read.login, basis: 'proof_branch' });
    await (await import('./person-score')).rescorePerson(builderId, now);
    profileChanged();
    return true;
  } catch (err) {
    console.error('[proof-branch] check', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/**
 * Fix round 2 (controller ruling): whether a coin may trust the person's proof branch for `key`: taken
 * under PROOF_BRANCH_COIN_MAX_AGE_MS ago, and a launch-time read of the repo shows the same numeric
 * id, still not a fork or template, and (a User's repo) the same owner. Never throws.
 */
async function freshBranchProof(builderId: number, key: string, now: Date, f: typeof fetch): Promise<boolean> {
  try {
    const db = sql();
    const [p] = await db<{ gh_repo_id: string; gh_owner: string | null; gh_owner_type: string | null }[]>`
      SELECT s.gh_repo_id::text AS gh_repo_id, s.gh_owner, s.gh_owner_type FROM builder_sources s
      WHERE s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'proof_branch' AND s.gh_repo_id IS NOT NULL
        AND s.verified_at > ${new Date(now.getTime() - PROOF_BRANCH_COIN_MAX_AGE_MS)} AND ${refKey(db)} = ${key}
        AND COALESCE((SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = s.builder_id), s.builder_id) = ${rootSql(db, builderId)}
      ORDER BY s.verified_at DESC LIMIT 1`;
    if (!p) return false;
    // v2.13.3 review: a private repo installed with the App is read with its token (no re-push loop).
    const read = await readRepo(key, f, await appBearer(builderId, key, f));
    if (!read || String(read.id) !== p.gh_repo_id) return false;
    return p.gh_owner_type !== 'User' || read.owner === p.gh_owner;
  } catch (err) {
    console.error('[proof-branch] coin read', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/** v2.13.1 O2 fix round 1 (revised controller ruling): proofs of control of the repo (a push or a sign-in). */
const CONTROL_PROOFS = ['proof_line', 'github_signin'] as const;

/**
 * v2.13.1 O2 fix round 1 (revised controller ruling): `key` is the person's one project (their group
 * root's), Bench-confirmed, with a verified repo source whose proof shows control of the repo
 * (CONTROL_PROOFS: never repo_owner, x_match, deployer or repo_link, which discovery can derive from
 * history); no other person holds it; and a launch-time read of the repo shows it is still exactly that
 * key, not a fork or template, with the stored owner and numeric id where they were kept. Never throws.
 */
async function controlProvenMain(builderId: number, key: string, f: typeof fetch): Promise<boolean> {
  try {
    const db = sql();
    const [r] = await db<{ gh_repo_id: string | null; gh_owner: string | null; gh_owner_type: string | null }[]>`
      SELECT s.gh_repo_id::text AS gh_repo_id, s.gh_owner, s.gh_owner_type
      FROM builder_profiles p JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key)
        JOIN builder_sources s ON s.builder_id = p.builder_id AND s.kind = 'repo' AND s.state = 'verified'
          AND s.proof = ANY(${[...CONTROL_PROOFS]}::text[]) AND regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', '') = ${key}
      WHERE p.builder_id = ${rootSql(db, builderId)} AND lower(p.main_project_key) = ${key} AND ${benchConfirmedSql(db)}
      ORDER BY s.verified_at DESC NULLS LAST LIMIT 1`;
    if (!r || (await heldByOther(builderId, key))) return false;
    const read = await readRepo(key, f, await appBearer(builderId, key, f));
    if (!read) return false;
    if (r.gh_repo_id !== null && r.gh_repo_id !== String(read.id)) return false;
    return !(r.gh_owner_type === 'User' && r.gh_owner && r.gh_owner !== read.owner);
  } catch (err) {
    console.error('[proof-branch] control proof', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/** v2.13.1 O2 fix round 1 (fresh-build ruling): a build's deploy trusts a proof branch taken this recently. */
export const PROOF_BRANCH_DEPLOY_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * v2.13.1 O2 fix round 1 (fresh-build ruling): under the Bench a build's repo is proven by its proof
 * branch, never an earnkit.txt line. The owner of `key` when the person (group root) holds a verified
 * `proof_branch` source for exactly that key, taken under PROOF_BRANCH_DEPLOY_MAX_AGE_MS ago, on a
 * User's repo whose owner pushed it (checkProofBranch's rule, gh_owner the key's owner), and no other
 * person holds it; else null. The deploy's own owner gate (a User, 30 days, a public repo) still runs.
 * Never throws.
 */
export async function branchProvenOwner(builderId: number, key: string, now: Date): Promise<string | null> {
  try {
    const k = key.toLowerCase();
    const owner = k.split('/')[0];
    if (!REPO_KEY.test(k)) return null;
    const db = sql();
    const [r] = await db`
      SELECT 1 FROM builder_sources s
      WHERE s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'proof_branch' AND ${refKey(db)} = ${k}
        AND s.gh_owner_type = 'User' AND s.gh_owner = ${owner} AND s.verified_at > ${new Date(now.getTime() - PROOF_BRANCH_DEPLOY_MAX_AGE_MS)}
        AND COALESCE((SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = s.builder_id), s.builder_id) = ${rootSql(db, builderId)}
      LIMIT 1`;
    if (!r || (await heldByOther(builderId, k))) return null;
    return owner;
  } catch (err) {
    console.error('[proof-branch] deploy proof', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/** The coin gate's answer under the Bench: the proof stands, or a branch for the agent to push, or a plain line. */
export type CoinBranchProof = { ok: true } | { proof: ProofBranch } | { line: string };

/**
 * Fix round 1 (ruling a) and round 2: under the Bench a coin's repo is proven by a proof branch, never
 * an earnkit.txt line. A fresh proof (freshBranchProof) stands; else an open code for this repo is
 * checked; else a code is issued (the once-a-day cap holds), or the plain line (another person holds
 * it, or no code may be issued now).
 */
export async function coinBranchProof(builderId: number, repoKey: string, now: Date, o: { ghFetch?: typeof fetch } = {}): Promise<CoinBranchProof> {
  const key = repoKey.toLowerCase();
  const name = key.split('/')[1] ?? key;
  const f = o.ghFetch ?? defaultReaderDeps(now, Date.now() + TIMEOUT_MS).ghFetch ?? fetch;
  // v2.13.1 O2 fix round 1 (revised ruling): a Bench-confirmed one project proven by control (a line
  // or a sign-in) passes with no line, after one launch-time read; a proof branch keeps its 30 days below.
  if (await controlProvenMain(builderId, key, f)) return { ok: true };
  if (await freshBranchProof(builderId, key, now, f)) return { ok: true };
  if (await checkProofBranch(builderId, now, { ghFetch: f, key })) return { ok: true };
  const state = await proofBranchFor(builderId, key, now, { canBuild: true, reproof: true, ghFetch: f }).catch(() => null);
  if (state?.kind === 'checking') return { proof: state.proof };
  // v2.13.3 review M2: with the App on, a repo EarnKit can't see gets the install ask (its link the one link).
  if (state?.kind === 'unseen' && githubAppEnabled()) {
    const link = await createVerifyLink({ installationId: builderId, projectId: null, repoKey: key, purpose: 'app' }, now).catch(() => null);
    if (link) return { line: installAppAsk(displayName(name, key, null), link) };
  }
  return {
    line: state?.kind === 'taken' ? takenLine(name)
      : state?.kind === 'foreign' ? foreignLine(name)
      : state?.kind === 'copy' ? copyLine(name)
      : state?.kind === 'unseen' ? cantSeeLine(name)
      : cantShowLine(name),
  };
}

/** v2.13.1 O2 fix round 1 (ruling 2): a code closed because the one project changed. */
export const closedRemoveNote = (remove: string) => `The project changed, so that check is off. If you pushed its branch, delete it now: ${remove}. Don't show this note.`;

/**
 * Once after a confirmation (or, O2 fix round 1, after a code was closed because the one project
 * changed): the agent's note to delete the branch (null when there is nothing to tell).
 */
export async function branchToRemove(builderId: number, now: Date): Promise<{ remove: string; agent_note: string } | null> {
  const [row] = await sql()<{ seed: string; used: boolean }[]>`
    UPDATE proof_branches SET told_at = ${now}
    WHERE code_hash = (SELECT code_hash FROM proof_branches WHERE builder_id = ${builderId} AND (used_at IS NOT NULL OR closed_at IS NOT NULL) AND told_at IS NULL
        ORDER BY COALESCE(used_at, closed_at) DESC LIMIT 1)
      AND told_at IS NULL
    RETURNING seed, used_at IS NOT NULL AS used`;
  const code = row ? codeOf(row.seed) : null;
  if (!code) return null;
  const remove = removeCommand(code);
  return { remove, agent_note: row!.used ? removeNote(remove) : closedRemoveNote(remove) };
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

/**
 * v2.13.2 (1): every Organization-owned repo source confirmed by a proof branch over
 * ORG_PROOF_MAX_AGE_MS ago (at most `limit`, oldest first) goes back to 'proposed' with the note STALE,
 * and its person is rescored at once (off the Bench until re-proven). The proof stays 'proof_branch', so
 * discovery's not_owner verdict still never rejects it; find then issues a fresh proof branch
 * (proofBranchFor: `again`). A pass of that branch verifies it again and clears the note. User-owned
 * repos never expire. Review M1: one person at a time (their rows, then their rescore), stopping at
 * `deadline`: the rest stay verified for the next run. A rescore that fails puts that person's rows back
 * to verified (noted STALE_RETRY, so the next run takes them last), is logged by class name, and the run
 * goes on with the next person. `done`: every expired row was handled (none failed, none left over at
 * `limit` or the deadline).
 */
export async function expireOrgProofs(
  now: Date,
  o: { only?: number[]; limit?: number; deadline?: number; rescore?: (id: number, now: Date) => Promise<unknown> } = {},
): Promise<{ expired: number; done: boolean }> {
  const db = sql();
  const only = o.only ? db`AND builder_id IN ${db(o.only.length ? o.only : [-1])}` : db``;
  const limit = o.limit ?? ORG_PROOF_PER_RUN;
  const cutoff = new Date(now.getTime() - ORG_PROOF_MAX_AGE_MS);
  const due = await db<{ id: number; builder_id: number }[]>`
    SELECT id::int AS id, builder_id::int AS builder_id FROM builder_sources
    WHERE kind = 'repo' AND state = 'verified' AND proof = 'proof_branch' AND gh_owner_type = 'Organization'
      AND verified_at <= ${cutoff} ${only}
    ORDER BY (reject_reason IS NOT DISTINCT FROM ${STALE_RETRY}), verified_at, id LIMIT ${limit + 1}`;
  const rows = due.slice(0, limit);
  const people = [...new Set(rows.map((r) => r.builder_id))];
  const rescore = o.rescore ?? (async (id: number, at: Date) => (await import('./person-score')).rescorePerson(id, at));
  let expired = 0;
  let cut = false;
  let failed = false;
  for (const person of people) {
    if (Date.now() >= (o.deadline ?? Infinity)) {
      cut = true;
      break;
    }
    const ids = rows.filter((r) => r.builder_id === person).map((r) => r.id);
    const gone = await db<{ id: number }[]>`
      UPDATE builder_sources SET state = 'proposed', reject_reason = ${STALE}
      WHERE id IN ${db(ids)} AND state = 'verified' AND verified_at <= ${cutoff} RETURNING id::int AS id`;
    if (!gone.length) continue;
    try {
      await rescore(person, now);
    } catch (err) {
      console.error('[proof-branch] org proof expiry rescore', err instanceof Error ? err.name : 'error');
      failed = true;
      await db`UPDATE builder_sources SET state = 'verified', reject_reason = ${STALE_RETRY} WHERE id IN ${db(gone.map((g) => g.id))} AND state = 'proposed' AND reject_reason = ${STALE}`;
      continue;
    }
    expired += gone.length;
  }
  if (expired) profileChanged();
  return { expired, done: !cut && !failed && due.length <= limit };
}

/** v2.13.2 (1): the expiry's daily slot key. */
const expiryKey = (now: Date) => `orgProofExpiry:${now.toISOString().slice(0, 10)}`;

/**
 * v2.13.2 (1): the cron's daily expiry step (the hourly run, until one run of the UTC day finishes; a run
 * for `only` people runs for them and leaves the day alone). Review M1: the day's slot is taken only after
 * a run that handled every expired row and its rescore; an error, the deadline or the per-run bound
 * leaves it open, so the next hourly run carries on. `expire`: tests only.
 */
export async function orgProofExpiryStep(
  now: Date,
  o: { only?: number[]; deadline?: number; expire?: typeof expireOrgProofs } = {},
): Promise<{ step: 'skipped' } | { expired: number; done: boolean }> {
  const expire = o.expire ?? expireOrgProofs;
  if (o.only) return expire(now, { only: o.only, deadline: o.deadline });
  const db = sql();
  const [taken] = await db`SELECT 1 FROM rate_windows WHERE key = ${expiryKey(now)} AND window_start = ${windowStart(now, 86_400_000)} AND count >= 1`;
  if (taken) return { step: 'skipped' };
  const r = await expire(now, { deadline: o.deadline });
  if (r.done) await hit(expiryKey(now), 1, 86_400, now);
  return r;
}
