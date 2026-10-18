import { sql, type Db } from './db';
import { CONFIRMED_PROOFS } from './confirmed';
import { projectKeyOf, type IdentityProject } from './identity-input';

/**
 * v2.13 spec R1, "2a": the person's one project (builder_profiles.main_project_key), set once (plan
 * B2), and the proof that it is theirs: the v2.9 earnkit.txt line, committed and pushed by their
 * agent in the same turn (plan B3), or GitHub sign-in when the agent can't push.
 */
export const CONFIRMING_REFRESH_MS = 60_000;
export const MAIN_PROOF_MIN_MS = 4_000;
/** T2 fix round 1 (ruling on B4): the fast checks last this long after the proof line was first issued. */
export const CONFIRMING_WINDOW_MS = 60 * 60_000;
/** A GitHub repo key, lowercase (owner/repo). The Bench's "repo-shaped" rule (person-score, benchConfirmedSql) uses this one regex. */
export const REPO_KEY = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/(?!\.\.?$)[a-z0-9._-]{1,100}$/;

/**
 * T4 fix round 1 (ruling): the Bench's "confirmed" for a builder_projects row aliased `b`. A GitHub
 * repo key (REPO_KEY) needs a confirmed repo source of the builder whose ref is that key,
 * case-insensitive, whatever project it is filed under (a coin or an entry naming the repo proves
 * nothing); other keys (a hosted slug, a site, a scoped npm package) keep `confirmed`.
 * person-score's bench_confirmed is its twin (same regex, same ref match).
 */
export const benchConfirmedSql = (db: Db) => db`(b.confirmed AND (NOT (lower(b.project_key) ~ ${REPO_KEY.source}) OR EXISTS (
  SELECT 1 FROM builder_sources rs WHERE rs.builder_id = b.builder_id AND rs.kind = 'repo' AND rs.state = 'verified'
    AND rs.proof = ANY(${[...CONFIRMED_PROOFS]}::text[])
    AND regexp_replace(lower(trim(rs.ref)), '^(https?://)?(www[.])?github[.]com/', '') = lower(b.project_key))))`;

export async function mainProjectOf(builderId: number, db: Db = sql()): Promise<string | null> {
  const [p] = await db<{ key: string | null }[]>`SELECT main_project_key AS key FROM builder_profiles WHERE builder_id = ${builderId}`;
  return p?.key ?? null;
}

/**
 * The one project. v2.13.1 O2 (B6): it can change until it is Bench-confirmed: a different project the
 * agent names replaces an unconfirmed one (and the old key's open proof code is closed, fix round 1); once confirmed it is set once (plan B2), and a different project later is stored in
 * identity only. `set`: this call wrote it; `key` is the one project's key either way.
 */
export async function setMainProject(builderId: number, p: IdentityProject): Promise<{ key: string; set: boolean }> {
  const key = projectKeyOf(p);
  return sql().begin(async (tx) => {
    const [old] = await tx<{ was: string | null }[]>`SELECT main_project_key AS was FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!old) return { key, set: false };
    if (old.was !== null && (old.was.toLowerCase() === key.toLowerCase() || (await confirmedIn(tx, builderId)))) return { key: old.was, set: false };
    await tx`UPDATE builder_profiles SET main_project_key = ${key}, updated_at = now() WHERE builder_id = ${builderId}`;
    if (old.was !== null) await clearOpenCodes(tx, builderId, old.was);
    return { key, set: true };
  });
}

/** Whether the person's one project is Bench-confirmed (mainConfirmed, on a transaction). */
const confirmedIn = async (db: Db, builderId: number) =>
  Boolean(
    (
      await db`
    SELECT 1 FROM builder_profiles p JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key)
    WHERE p.builder_id = ${builderId} AND ${benchConfirmedSql(db)}`
    )[0],
  );
/**
 * v2.13.1 O2 (B6), fix round 1 (ruling 2): the old key's open proof codes are closed (never deleted, so
 * they still count toward the 5-a-day cap); the next reply tells the agent once to delete any branch it
 * pushed (proof-branch.ts branchToRemove).
 */
const clearOpenCodes = (db: Db, builderId: number, key: string) =>
  db`UPDATE proof_branches SET closed_at = now(), expires_at = LEAST(expires_at, now())
    WHERE builder_id = ${builderId} AND repo_key = ${key.toLowerCase()} AND used_at IS NULL AND closed_at IS NULL AND expires_at > now()`;

/**
 * v2.13.1 O2 (B6): the builder said `key` is not theirs (tell repo_facts not_mine). When it is the one
 * project and not Bench-confirmed, it is cleared (with its open proof code), so the next project the
 * agent names is the one. True when cleared.
 */
export async function dropMainProject(builderId: number, key: string): Promise<boolean> {
  return sql().begin(async (tx) => {
    const [old] = await tx<{ was: string | null }[]>`SELECT main_project_key AS was FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!old?.was || old.was.toLowerCase() !== key.toLowerCase() || (await confirmedIn(tx, builderId))) return false;
    await tx`UPDATE builder_profiles SET main_project_key = NULL, updated_at = now() WHERE builder_id = ${builderId}`;
    await clearOpenCodes(tx, builderId, old.was);
    return true;
  });
}

/** Whether the one project is a confirmed project of the person (its proof was read). */
export async function mainConfirmed(builderId: number): Promise<boolean> {
  const [r] = await sql()`
    SELECT 1 FROM builder_profiles p JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key)
    WHERE p.builder_id = ${builderId} AND ${benchConfirmedSql(sql())}`;
  return Boolean(r);
}

/** "Confirming": the one project is set, not confirmed, and its proof line was issued to one of the group's installations. */
export async function confirming(builderId: number): Promise<boolean> {
  const [r] = await sql()`
    SELECT 1 FROM builder_profiles p
    WHERE p.builder_id = ${builderId} AND p.main_project_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM builder_projects b WHERE b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(sql())})
      AND EXISTS (SELECT 1 FROM proof_line_issues l JOIN installations i ON i.id = l.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND l.repo_key = lower(p.main_project_key))`;
  return Boolean(r);
}

/**
 * T2 fix round 1 (ruling on B4): confirming, and the proof line was first issued to one of the group's
 * installations within CONFIRMING_WINDOW_MS of `now`. Only then does the refresh run every minute and
 * check the line itself; after it, the normal cadence and the cron's proof-line check apply.
 */
export async function confirmingFast(builderId: number, now: Date): Promise<boolean> {
  const [r] = await sql()`
    SELECT 1 FROM builder_profiles p
    WHERE p.builder_id = ${builderId} AND p.main_project_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM builder_projects b WHERE b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(sql())})
      AND EXISTS (SELECT 1 FROM proof_line_issues l JOIN installations i ON i.id = l.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND l.repo_key = lower(p.main_project_key)
          AND l.first_at > ${new Date(now.getTime() - CONFIRMING_WINDOW_MS)})`;
  return Boolean(r);
}

/**
 * Plan B3: github_user is the repo's owner when empty and the reported login (if any) is that owner.
 * Never overwritten. It proves nothing alone: proofLineLogin names the owner only when the line was
 * pushed by that same account.
 */
export async function fillGithubUser(installationId: number, repoKey: string, reported: string | null): Promise<void> {
  const owner = repoKey.toLowerCase().split('/')[0];
  if (!REPO_KEY.test(repoKey.toLowerCase()) || (reported && reported.toLowerCase() !== owner)) return;
  await sql()`UPDATE installations SET github_user = ${owner} WHERE id = ${installationId} AND github_user IS NULL`;
}

/**
 * Plan B2: a person with projects and no main one gets one, once: most people, then newest. Final
 * fix I2: only a project the Bench counts as confirmed (benchConfirmedSql); with none, it stays null,
 * so the project the agent names next (find's identity.project) is the one.
 */
export async function pickMainProject(builderId: number, db: Db): Promise<string | null> {
  const [r] = await db<{ key: string | null }[]>`
    UPDATE builder_profiles p SET main_project_key = COALESCE(p.main_project_key, (
      SELECT b.project_key FROM builder_projects b WHERE b.builder_id = p.builder_id AND ${benchConfirmedSql(db)}
      ORDER BY b.people DESC, b.last_active_at DESC NULLS LAST, b.project_key LIMIT 1))
    WHERE p.builder_id = ${builderId} RETURNING p.main_project_key AS key`;
  return r?.key ?? null;
}
