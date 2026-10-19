import { sql, type Db } from './db';
import { CONFIRMED_PROOFS } from './confirmed';
import { projectKeyOf, type IdentityProject } from './identity-input';

/**
 * v2.13 spec R1, "2a": the person's one project (builder_profiles.main_project_key), set once (plan
 * B2). v2.14 spec 2: a repo is proven only by the read-only GitHub App (repo-proof.ts).
 */
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
 * agent names replaces an unconfirmed one; once confirmed it is set once (plan B2), and a different project later is stored in
 * identity only. `set`: this call wrote it; `key` is the one project's key either way.
 */
export async function setMainProject(builderId: number, p: IdentityProject): Promise<{ key: string; set: boolean }> {
  const key = projectKeyOf(p);
  return sql().begin(async (tx) => {
    const [old] = await tx<{ was: string | null }[]>`SELECT main_project_key AS was FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!old) return { key, set: false };
    if (old.was !== null && (old.was.toLowerCase() === key.toLowerCase() || (await confirmedIn(tx, builderId)))) return { key: old.was, set: false };
    await tx`UPDATE builder_profiles SET main_project_key = ${key}, updated_at = now() WHERE builder_id = ${builderId}`;
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
 * v2.13.1 O2 (B6): the builder said `key` is not theirs (tell repo_facts not_mine). When it is the one
 * project and not Bench-confirmed, it is cleared, so the next project the
 * agent names is the one. True when cleared.
 */
export async function dropMainProject(builderId: number, key: string): Promise<boolean> {
  return sql().begin(async (tx) => {
    const [old] = await tx<{ was: string | null }[]>`SELECT main_project_key AS was FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!old?.was || old.was.toLowerCase() !== key.toLowerCase() || (await confirmedIn(tx, builderId))) return false;
    await tx`UPDATE builder_profiles SET main_project_key = NULL, updated_at = now() WHERE builder_id = ${builderId}`;
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

/**
 * Plan B3: github_user is the repo's owner when empty and the reported login (if any) is that owner.
 * Never overwritten. It proves nothing (v2.14 spec 2: only the read-only App proves a repo).
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
