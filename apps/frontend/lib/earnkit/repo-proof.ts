import { CONFIRMED_PROOFS } from './confirmed';
import { sql, type Db } from './db';
import { appTokenFor, githubAppEnabled, installationToken, repoInstallation, type AppDeps } from './github-app';
import { createVerifyLink, repoEverDerived } from './github-verify';
import { sharedGroup } from './installations';
import { profileChanged } from './profile-cache';
import { hit, windowStart } from './rate-limit';
import { repoReadPublic } from './repo-public';
import { proposeSource, rejectSource } from './sources';

/**
 * v2.14 spec 2: the read-only GitHub App is the only way a repo is proven. github-app.ts appSetup (the sign-in
 * hop names the installer; appProof: the installation lists the repo and the installer owns the account or
 * administers the repo) calls proveByApp, which reads the repo once with the installation token and verifies
 * the person's repo source as `github_app`. Installation tokens are minted per call, never stored or logged.
 * Sources verified before v2.14 stay verified ('kept').
 */
export const APP_PROOF = 'github_app';
export const APP_REMOVED = 'app_removed';
/** Fix round 1 (ruling): the note on another person's non-App hold that an App proof replaced (state 'proposed'). */
export const REPLACED_BY_APP = 'replaced_by_app';
export const APP_CHECK_PER_RUN = 50;
export const APP_CHECK_EVERY_MS = 24 * 60 * 60_000;
/**
 * T6 security review (stale authorization): an action (a coin, a deploy, a hosted site) trusts an App proof only
 * while GitHub confirmed the install this recently (proveByApp, or appCheckStep's daily check, run hourly).
 * Older (the check keeps failing, or the App was removed and the check hasn't run): the install link again.
 */
export const APP_PROOF_FRESH_MS = APP_CHECK_EVERY_MS + 2 * 60 * 60_000;
export type RepoProof = { ok: true; via: 'app' | 'kept'; owner: string; private: boolean } | { ok: false; why: 'none' | 'taken' | 'copy' };

/**
 * v2.13.2 (1): an Organization's repo confirmed by a proof branch (before v2.14) is confirmed for this long
 * after `verified_at` (any member's push confirmed it, and the pusher may since have lost push access). A
 * User's repo never expires; a `github_app` source is checked daily instead (appCheckStep).
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

/** A repo source's ref as a repo key (benchConfirmedSql's own normalisation). */
const refKey = (db: Db) => db`regexp_replace(lower(trim(ref)), '^(https?://)?(www[.])?github[.]com/', '')`;

/** A builder id's person: its installation's group root, else the id itself. */
const rootSql = (db: Db, id: number) => db`COALESCE((SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = ${id}), ${id})`;

/**
 * Whether another person (another group root: never the person's own linked installation) already holds `key`
 * with the App (the first App holder keeps a repo; fix round 1 ruling: a non-App hold is replaced by an App proof,
 * proveByApp). Moved from the v2.13.1 proof-branch module.
 */
export async function heldByOther(builderId: number, key: string, db: Db = sql()): Promise<boolean> {
  // Fix round 1 (ruling): only another person's App hold keeps a repo; a non-App hold is replaced by an App proof.
  const [r] = await db`
    SELECT 1 FROM builder_sources s WHERE s.kind = 'repo' AND s.state = 'verified'
      AND s.proof = ${APP_PROOF} AND regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', '') = ${key.toLowerCase()}
      AND COALESCE((SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = s.builder_id), s.builder_id) <> ${rootSql(db, builderId)}
    LIMIT 1`;
  return Boolean(r);
}

/**
 * Whether `key` is this person's proven repo: by the App, or verified before v2.14 (kept: it still counts on the
 * Bench). `builderId`: the person's root. T6 security review: `forAction` (a coin, a deploy, a hosted site) takes
 * only an App proof: one GitHub confirmed within APP_PROOF_FRESH_MS, else checked now (appProofLive through
 * `fetch`); a kept proof (discovery's repo_owner or x_match, a proof line or branch, a sign-in, never re-read at
 * the action), a gone or an unanswered App proof is `none`, so the install link is asked.
 */
export async function repoProof(builderId: number, repoKey: string, db: Db = sql(), o: { forAction?: boolean; now?: Date; fetch?: typeof fetch } = {}): Promise<RepoProof> {
  const key = repoKey.toLowerCase();
  const now = o.now ?? new Date();
  const [s] = await db<{ id: number; state: string; proof: string | null; gh_owner: string | null; gh_owner_type: string | null; reject_reason: string | null; app_checked_at: Date | null }[]>`
    SELECT id::int AS id, state, proof, gh_owner, gh_owner_type, reject_reason, app_checked_at FROM builder_sources
    WHERE builder_id = ${builderId} AND kind = 'repo' AND ${refKey(db)} = ${key}
    ORDER BY (state = 'verified') DESC, id LIMIT 1`;
  if (s?.state === 'verified' && s.proof && CONFIRMED_PROOFS.has(s.proof)) {
    const app = s.proof === APP_PROOF;
    let fresh = app && s.app_checked_at !== null && now.getTime() - s.app_checked_at.getTime() <= APP_PROOF_FRESH_MS;
    // T6 fix round 1 (controller ruling): an older App proof is checked with GitHub now: held passes (and is
    // refreshed); gone is demoted and refused; unknown (GitHub didn't answer) is refused (fail closed).
    if (o.forAction && app && !fresh)
      fresh = (await recheckAppSource({ id: s.id, builder_id: builderId, key, gh_owner_type: s.gh_owner_type }, now, { fetch: o.fetch }).catch(() => 'unknown' as const)) === 'held';
    if (!o.forAction || fresh)
      return { ok: true, via: app ? 'app' : 'kept', owner: s.gh_owner ?? key.split('/')[0], private: !(await repoReadPublic(builderId, key, now, db)) };
    return { ok: false, why: 'none' };
  }
  if (s?.reject_reason === 'derived') return { ok: false, why: 'copy' };
  if (await heldByOther(builderId, key, db)) return { ok: false, why: 'taken' };
  return { ok: false, why: 'none' };
}

type RepoMeta = { id?: unknown; full_name?: unknown; private?: unknown; fork?: unknown; is_template?: unknown; owner?: { login?: unknown; type?: unknown } | null };

/**
 * appSetup's last step: the person's repo source verified by the App (A8), then a rescore, so the next reply
 * ranks it. A fork or template is refused (`derived`); a repo another person holds with the App stays theirs
 * (`taken`); another person's non-App hold is replaced (REPLACED_BY_APP, rescored).
 * Preflight S8: the hold check and the write run in ONE transaction under the repo's advisory lock
 * (`repo_hold:<key>`), so two people completing the App on one repo at once can't both hold it. The person's
 * own `source_proof:<id>` lock (page-joins.ts attachFresh takes it too) keeps an R1 join's emptiness check
 * and this write apart.
 */
export async function proveByApp(a: { builderId: number; repoKey: string; githubInstallationId: number }, deps: AppDeps = {}): Promise<RepoProof> {
  const key = a.repoKey.toLowerCase();
  if (await sharedGroup(a.builderId)) return { ok: false, why: 'none' }; // A19: no person on a shared client
  const f = deps.fetch ?? fetch;
  const token = await installationToken(a.githubInstallationId, key.split('/')[1], deps);
  const res = await f(`https://api.github.com/repos/${key}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'earnkit', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, why: 'none' };
  }
  const meta = (await res.json().catch(() => null)) as RepoMeta | null;
  const owner = typeof meta?.owner?.login === 'string' ? meta.owner.login.toLowerCase() : null;
  const ownerType = meta?.owner?.type === 'User' || meta?.owner?.type === 'Organization' ? meta.owner.type : null;
  // Exactly this repo (never a renamed or transferred one), with GitHub's numeric id.
  if (!meta || typeof meta.full_name !== 'string' || meta.full_name.toLowerCase() !== key || !owner || owner !== key.split('/')[0]
    || !ownerType || typeof meta.id !== 'number' || !Number.isSafeInteger(meta.id)) return { ok: false, why: 'none' };
  const now = deps.now ?? new Date();
  await proposeSource({ builder_id: a.builderId, kind: 'repo', ref: key, project_key: key, proposed_by: 'server' });
  const [row] = await sql()<{ id: number }[]>`
    SELECT id::int AS id FROM builder_sources WHERE builder_id = ${a.builderId} AND kind = 'repo' AND ${refKey(sql())} = ${key}
    ORDER BY (state = 'verified') DESC, id LIMIT 1`;
  if (!row) return { ok: false, why: 'none' };
  // Final fix M6: a repo that ever read as a fork or a template is never the person's own work.
  if (await repoEverDerived(key, meta.fork !== false || meta.is_template === true)) {
    await rejectSource(row.id, 'derived');
    return { ok: false, why: 'copy' };
  }
  // T6 security review (defence in depth): GitHub names this very installation for the repo now (appSetup's
  // appProof checked the installation lists it and the installer owns or administers it).
  if ((await repoInstallation(key, deps).catch(() => null)) !== a.githubInstallationId) return { ok: false, why: 'none' };
  const isPrivate = meta.private !== false;
  const replaced: number[] = [];
  const out = await sql().begin(async (tx): Promise<RepoProof> => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`repo_hold:${key}`}))`;
    // Fix round 1: the person's page lock before the source lock, the order page-joins.ts attachFresh takes them in.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`page_join:${a.builderId}`}))`;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`source_proof:${a.builderId}`}))`;
    // Only while the builder id is still a person's root (an installation attached to a page meanwhile writes nothing).
    const [r] = await tx<{ root: number }[]>`SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${a.builderId}`;
    if (r && r.root !== a.builderId) return { ok: false, why: 'none' };
    // Fix round 1 (controller ruling): another person's App hold keeps the repo (taken); another person's
    // discovery-derived or other non-App hold (x_match, repo_owner, a proof line or branch, a sign-in) is replaced:
    // that row goes back to proposed ('replaced_by_app') and this person proves it.
    const others = await tx<{ id: number; builder_id: number; proof: string }[]>`
      SELECT s.id::int AS id, s.builder_id, s.proof FROM builder_sources s
      WHERE s.kind = 'repo' AND s.state = 'verified' AND s.proof = ANY(${[...CONFIRMED_PROOFS]}::text[])
        AND regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', '') = ${key}
        AND COALESCE((SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = s.builder_id), s.builder_id) <> ${a.builderId}
      FOR UPDATE`;
    if (others.some((o) => o.proof === APP_PROOF)) return { ok: false, why: 'taken' };
    for (const o of others) {
      await tx`UPDATE builder_sources SET state = 'proposed', reject_reason = ${REPLACED_BY_APP} WHERE id = ${o.id} AND state = 'verified'`;
      replaced.push(o.builder_id);
    }
    // The App is the strongest proof: it verifies a proposed, rejected or stale row alike.
    await tx`
      UPDATE builder_sources SET state = 'verified', proof = ${APP_PROOF}, verified_at = ${now}, reject_reason = NULL, app_checked_at = ${now},
        gh_repo_id = ${meta.id as number}, gh_owner = ${owner}, gh_owner_type = ${ownerType}, public_at = ${isPrivate ? null : now}
      WHERE id = ${row.id}`;
    return { ok: true, via: 'app', owner, private: isPrivate };
  });
  if (!out.ok) return out;
  for (const other of new Set(replaced))
    await (await import('./person-score')).rescorePerson(other, now).catch((err: unknown) => console.error('[repo-proof] rescore', err instanceof Error ? err.name : 'error'));
  await (await import('./events')).noteEvent('source_verified', () => ({
    type: 'source_verified', dedupe_key: `source_verified:${row.id}:${now.toISOString()}`, installation_id: a.builderId, detail: { source_id: row.id, kind: 'repo', proof: APP_PROOF },
  }));
  await (await import('./person-score')).rescorePerson(a.builderId, now).catch((err: unknown) => console.error('[repo-proof] rescore', err instanceof Error ? err.name : 'error'));
  profileChanged();
  return out;
}

/** What GitHub says about a person's App proof now (appProofLive). */
export type LiveHold = 'held' | 'gone' | 'unknown';

/**
 * T6 fix round 1: does this person's App proof of `key` hold right now. GitHub must name an installation for the
 * repo (none: gone), it must be one this person proved through the setup URL (github_verifications via 'app' on
 * their group `root`, `login` when given; another account's install: gone), and when the repo's account is not
 * the prover's own (an Organization's, or an owner other than the proving login) the prover must still be the
 * repo's admin (read with a per-call installation token; anything but admin: gone). A redirect (a renamed or
 * transferred repo, fix round 2) is gone; another GitHub error is `unknown` (the caller decides: the daily check tries again, an action refuses). The token is never kept.
 */
export async function appProofLive(
  a: { root: number; key: string; login?: string | null; ownerType?: string | null },
  deps: AppDeps = {},
  db: Db = sql(),
): Promise<LiveHold> {
  const key = a.key.toLowerCase();
  const moved = (status: unknown) => typeof status === 'number' && status >= 300 && status < 400;
  let inst: number | null;
  try {
    inst = await repoInstallation(key, deps);
  } catch (err) {
    // Fix round 2: a redirect (renamed or transferred) is gone: the builder re-proves under the new name.
    return moved((err as { status?: unknown })?.status) ? 'gone' : 'unknown';
  }
  if (inst === null) return 'gone';
  const [v] = await db<{ login: string }[]>`
    SELECT lower(v.login) AS login FROM github_verifications v JOIN installations i ON i.id = v.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${a.root} AND v.via = 'app' AND v.repo_key = ${key} AND v.github_installation_id = ${inst}
      ${a.login ? db`AND v.login = ${a.login.toLowerCase()}` : db``}
    ORDER BY v.verified_at DESC, v.id DESC LIMIT 1`;
  if (!v) return 'gone';
  const owner = key.split('/')[0];
  if (a.ownerType !== 'Organization' && owner === v.login) return 'held';
  const f = deps.fetch ?? fetch;
  try {
    const token = await installationToken(inst, key.split('/')[1], deps);
    const res = await f(`https://api.github.com/repos/${key}/collaborators/${encodeURIComponent(v.login)}/permission`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'earnkit', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || moved(res.status)) {
      await res.body?.cancel().catch(() => {});
      return 'gone';
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return 'unknown';
    }
    const body = (await res.json().catch(() => null)) as { permission?: unknown } | null;
    return body?.permission === 'admin' ? 'held' : 'gone';
  } catch (err) {
    const status = (err as { status?: unknown })?.status;
    return status === 404 || status === 422 || moved(status) ? 'gone' : 'unknown';
  }
}

/**
 * T6 fix round 1: appProofLive for one `github_app` source, applied: held refreshes app_checked_at; gone sends it
 * back to proposed (APP_REMOVED) and rescores its person at once; unknown changes nothing.
 */
export async function recheckAppSource(
  s: { id: number; builder_id: number; key: string; gh_owner_type: string | null },
  now: Date,
  deps: AppDeps = {},
): Promise<LiveHold> {
  const db = sql();
  // Fix round 2: every attempt is stamped (app_tried_at), so unanswered rows go behind the others in the daily queue;
  // app_checked_at is written only on held, so an action's window still closes.
  await db`UPDATE builder_sources SET app_tried_at = ${now} WHERE id = ${s.id}`;
  const r = await appProofLive({ root: s.builder_id, key: s.key, ownerType: s.gh_owner_type }, { ...deps, now }, db);
  if (r === 'held') await db`UPDATE builder_sources SET app_checked_at = ${now} WHERE id = ${s.id} AND state = 'verified' AND proof = ${APP_PROOF}`;
  if (r === 'gone') {
    const gone = await db`UPDATE builder_sources SET state = 'proposed', reject_reason = ${APP_REMOVED}, app_checked_at = ${now} WHERE id = ${s.id} AND state = 'verified' RETURNING 1`;
    if (gone.length) {
      await (await import('./person-score')).rescorePerson(s.builder_id, now).catch((err: unknown) => console.error('[repo-proof] rescore', err instanceof Error ? err.name : 'error'));
      profileChanged();
    }
  }
  return r;
}

/**
 * T6 fix round 1: the shared-client coin gate (Ruling G10): the caller's own verified `login` holds an App proof
 * of `key` on this installation's group right now (appProofLive with the login). Fails closed: a database error,
 * a GitHub error, an uninstalled App or another account's install is false.
 */
export async function sharedAppProven(installationId: number, repoKey: string, login: string, deps: AppDeps = {}, db: Db = sql()): Promise<boolean> {
  try {
    const [r] = await db<{ root: number }[]>`SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${installationId}`;
    const root = r?.root ?? installationId;
    // Fix round 2: the group must hold the repo (a verified github_app source of its group), not only a verification
    // row (a second org admin whose proveByApp was `taken` has one).
    const [held] = await db`
      SELECT 1 FROM builder_sources s JOIN installations i ON i.id = s.builder_id
      WHERE COALESCE(i.builder_id, i.id) = ${root} AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = ${APP_PROOF}
        AND regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', '') = ${repoKey.toLowerCase()} LIMIT 1`;
    if (!held) return false;
    return (await appProofLive({ root, key: repoKey, login }, deps, db)) === 'held';
  } catch (err) {
    console.error('[repo-proof] shared proof', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/** The reply's install link (the v2.10 App link: sign-in hop, then install), or null while the App is off (or the person has no page). */
export async function installLink(builderId: number, repoKey: string, now: Date): Promise<string | null> {
  if (!githubAppEnabled()) return null;
  return createVerifyLink({ installationId: builderId, projectId: null, repoKey: repoKey.toLowerCase(), purpose: 'app' }, now).catch(() => null);
}

/** One installation token for one repo of this person, and a GET with it (null on any failure). Never stored or logged. */
export async function appClient(builderId: number, repoKey: string, f: typeof fetch): Promise<(<T>(path: string) => Promise<T | null>) | null> {
  const token = await appTokenFor({ installationId: builderId, repoKey: repoKey.toLowerCase() }, { fetch: f });
  if (!token) return null;
  return async <T,>(path: string): Promise<T | null> => {
    const res = await f(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'earnkit', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok) {
      await res?.body?.cancel().catch(() => {});
      return null;
    }
    return (await res.json().catch(() => null)) as T | null;
  };
}

/**
 * A8: each run, up to APP_CHECK_PER_RUN `github_app` sources not checked in a day, through recheckAppSource
 * (appProofLive): held refreshes app_checked_at; gone (removed from the repo, uninstalled, another account's
 * install, or an org's prover no longer its admin) goes back to proposed (APP_REMOVED) and the person is
 * rescored at once, so it leaves the Bench (which reads benchConfirmedSql live); unknown is tried next run.
 */
export async function appCheckStep(now: Date, o: { deadline: number; only?: number[]; fetch?: typeof fetch }): Promise<{ checked: number; removed: number }> {
  if (!githubAppEnabled()) return { checked: 0, removed: 0 };
  const db = sql();
  const due = await db<{ id: number; builder_id: number; key: string; gh_owner_type: string | null }[]>`
    SELECT id::int AS id, builder_id, ${refKey(db)} AS key, gh_owner_type FROM builder_sources
    WHERE kind = 'repo' AND state = 'verified' AND proof = ${APP_PROOF}
      AND (app_checked_at IS NULL OR app_checked_at <= ${new Date(now.getTime() - APP_CHECK_EVERY_MS)})
      ${o.only ? db`AND builder_id IN ${db(o.only.length ? o.only : [-1])}` : db``}
    ORDER BY greatest(app_checked_at, app_tried_at) NULLS FIRST, id LIMIT ${APP_CHECK_PER_RUN}`;
  let checked = 0;
  let removed = 0;
  for (const s of due) {
    if (Date.now() >= o.deadline) break;
    // T6 fix round 1: appProofLive (an installation this person proved, and an org's prover still its admin).
    const r = await recheckAppSource(s, now, { fetch: o.fetch });
    if (r === 'unknown') continue; // GitHub didn't answer: try again next run
    checked++;
    if (r === 'gone') removed++;
  }
  return { checked, removed };
}

/**
 * v2.13.2 (1): every Organization-owned repo source confirmed by a proof branch (before v2.14) over
 * ORG_PROOF_MAX_AGE_MS ago (at most `limit`, oldest first) goes back to 'proposed' with the note STALE,
 * and its person is rescored at once (off the Bench until re-proven). The proof stays 'proof_branch'; the
 * re-proof is the App (proveByApp verifies a stale row, verifySource never does). User-owned repos never
 * expire. Review M1: one person at a time (their rows, then their rescore), stopping at `deadline`: the rest
 * stay verified for the next run. A rescore that fails puts that person's rows back to verified (noted
 * STALE_RETRY, so the next run takes them last), is logged by class name, and the run goes on with the next
 * person. `done`: every expired row was handled (none failed, none left over at `limit` or the deadline).
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
      console.error('[repo-proof] org proof expiry rescore', err instanceof Error ? err.name : 'error');
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
