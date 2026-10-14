import type postgres from 'postgres';
import { sql } from './db';
import { profileChanged } from './profile-cache';
import { releaseLogin } from './profiles';

/**
 * v2.12.1 T5 fix round 2 (controller ruling): a GitHub login proven by two or more unlinked groups
 * (a sign-in or App verification, or a profile's login proven by sign-in, App or proof line) is
 * contested. A sign-in link can be completed by anyone it is sent to, so a contested login confirms
 * nothing (no login on the page, no work found through it) for any of those groups, except:
 * - the group the owner ruled for on /admin/scores (login_contest_rulings), else
 * - the group whose confirmed X (a claim: x_user_id) is the X handle the GitHub profile lists.
 * This stops someone who got a victim to complete their sign-in link from showing the victim's
 * GitHub work under their own X. Shared groups are never people, so they never contest.
 */
const PROVEN_BASES = ['signin', 'app', 'proof_line'];

/** v2.12.1 T6 (T5 carry): a group with no agent call (MCP) in this many days and no X claim never contests. */
export const DORMANT_DAYS = 30;
/**
 * The group rooted at `col` contests: not a shared client, and active (an agent call in the last
 * DORMANT_DAYS) or claimed with X. A person's old, forgotten install (the owner has split installs)
 * never contests their own login at launch; it does again once its agent calls.
 */
const contesting = (col: postgres.Fragment) => sql()`
  NOT EXISTS (SELECT 1 FROM installations s WHERE COALESCE(s.builder_id, s.id) = ${col} AND s.shared_client)
  AND (EXISTS (SELECT 1 FROM installations a WHERE COALESCE(a.builder_id, a.id) = ${col} AND a.last_seen_at > now() - make_interval(days => ${DORMANT_DAYS}))
    OR EXISTS (SELECT 1 FROM builder_profiles q WHERE q.builder_id = ${col} AND q.x_user_id IS NOT NULL))`;

/** The roots (ascending) of the unlinked, contesting groups that prove `login`. */
export async function contestants(login: string): Promise<number[]> {
  const L = login.toLowerCase();
  const rows = await sql()<{ r: number }[]>`
    SELECT DISTINCT r FROM (
      SELECT COALESCE(i.builder_id, i.id) AS r FROM github_verifications v JOIN installations i ON i.id = v.installation_id
      WHERE lower(v.login) = ${L}
      UNION
      SELECT builder_id FROM builder_profiles WHERE lower(github_login) = ${L} AND github_basis IN ${sql()(PROVEN_BASES)}) x
    WHERE ${contesting(sql()`x.r`)}
    ORDER BY r`;
  return rows.map((x) => x.r);
}

/** The group root the owner ruled `login` for, or null. */
async function ruledRoot(login: string): Promise<number | null> {
  const [r] = await sql()<{ root: number }[]>`
    SELECT COALESCE(i.builder_id, i.id) AS root FROM login_contest_rulings c JOIN installations i ON i.id = c.builder_id
    WHERE c.login = ${login.toLowerCase()}`;
  return r?.root ?? null;
}

/**
 * Whether `login` counts as the GitHub identity of the group rooted at `root` (which is about to prove
 * it, or already does). `twitter`: the X handle the GitHub profile lists now (twitter_username), or null.
 */
export async function loginStands(root: number, login: string, twitter: string | null): Promise<boolean> {
  const groups = new Set(await contestants(login));
  groups.add(root);
  if (groups.size < 2) return true;
  const ruled = await ruledRoot(login);
  if (ruled !== null) return ruled === root;
  if (!twitter) return false;
  // v2.12.1 T6: only the handle the X claim wrote (bound to x_user_id). On a claimed page nothing else
  // writes x_handle (setXHandle refuses it, GitHub never clears it, a merge keeps the older page's claim and its handle together).
  const [p] = await sql()<{ x_user_id: string | null; x_handle: string | null }[]>`
    SELECT x_user_id, x_handle FROM builder_profiles WHERE builder_id = ${root}`;
  return Boolean(p?.x_user_id && p.x_handle && p.x_handle.toLowerCase() === twitter.replace(/^@/, '').toLowerCase());
}

/**
 * After a new proof of `login` (a sign-in) or a ruling: when it is contested, a profile holding it that
 * no longer stands loses it (releaseLogin: the login, its basis and the work confirmed through it go
 * back to not yet confirmed), and every contesting group is discovered again (the one that stands gets
 * it on its next discovery). Nothing when uncontested.
 */
export async function settleLogin(login: string): Promise<void> {
  const L = login.toLowerCase();
  const groups = await contestants(L);
  if (groups.length < 2) return;
  const holders = await sql()<{ builder_id: number; twitter: string | null }[]>`
    SELECT builder_id, twitter_prefill AS twitter FROM builder_profiles WHERE lower(github_login) = ${L}`;
  let changed = false;
  for (const h of holders) if (!(await loginStands(h.builder_id, L, h.twitter)) && (await releaseLogin(h.builder_id, L))) changed = true;
  await sql()`
    INSERT INTO discovery_queue (builder_id, reason)
    SELECT builder_id, 'signin' FROM builder_profiles WHERE builder_id IN ${sql()(groups)}
    ON CONFLICT (builder_id) DO UPDATE SET reason = 'signin', queued_at = now(), done_at = NULL`;
  if (changed) profileChanged();
}

export type LoginContest = { login: string; groups: number[]; ruled: number | null; line: string };

/** The owner's list (/admin/scores): every contested login, its groups and the ruling, if any. */
export async function loginContests(): Promise<LoginContest[]> {
  const rows = await sql()<{ login: string; groups: number[] }[]>`
    WITH c AS (
      SELECT lower(v.login) AS login, COALESCE(i.builder_id, i.id) AS r FROM github_verifications v JOIN installations i ON i.id = v.installation_id
      UNION
      SELECT lower(github_login), builder_id FROM builder_profiles WHERE github_login IS NOT NULL AND github_basis IN ${sql()(PROVEN_BASES)})
    SELECT login, array_agg(DISTINCT r ORDER BY r) AS groups FROM c
    WHERE ${contesting(sql()`c.r`)}
    GROUP BY login HAVING count(DISTINCT r) >= 2 ORDER BY login`;
  const out: LoginContest[] = [];
  for (const r of rows) {
    const ruled = await ruledRoot(r.login);
    out.push({
      login: r.login, groups: r.groups, ruled,
      line: `GitHub login ${r.login} proven by builder ids ${r.groups.join(', ')}${ruled !== null ? `; confirmed for ${ruled}` : '; confirmed for none'}`,
    });
  }
  return out;
}

/** The owner's ruling: `login` counts for `builderId`'s group (read through its root) only. */
export async function ruleContest(login: string, builderId: number): Promise<void> {
  const L = login.toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/.test(L)) return;
  await sql()`
    INSERT INTO login_contest_rulings (login, builder_id) VALUES (${L}, ${builderId})
    ON CONFLICT (login) DO UPDATE SET builder_id = EXCLUDED.builder_id, ruled_at = now()`;
  await settleLogin(L);
}
