import { archiveFlag } from './builder-score-flag';
import { openR1Join } from './page-joins';
import { normalizeRepoUrl } from './campaigns';
import { sql, type Db } from './db';
import type postgres from 'postgres';
import { sharedGroup } from './installations';
import { profileChanged } from './profile-cache';
import { mergeProfiles } from './profiles';

/**
 * v2.8.1 §E18, v2.12.1 spec "Identity": installations of one person are one group (builder_id points
 * at the root). v2.14: the v2.8.1 pickup offer is gone; groups join only on proven ties, through a
 * pending join both groups say yes to (joinOnProvenTie, answerJoin), or the claim page's one-click join.
 */

/** This installation's group root (itself when it isn't linked). */
export async function rootOf(installationId: number): Promise<number> {
  const [row] = await sql()<{ root: number }[]>`
    SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${installationId}`;
  return row?.root ?? installationId;
}

/**
 * Links `own`'s group and the groups rooted at `roots` into one: the smallest root stays, every other
 * installation points to it (builder_id), and the other roots' rows move to it (entries, keeping the
 * one holding the token, else the earlier-submitted one, when both hold the same program and repo, answer bank,
 * wallets, token offers, sponsor drafts; on a clash the root's newer answer wins and the root's offer
 * stays). The root's memory keeps its own values, filling gaps from the others. One transaction.
 * Returns the group's entry count. Exported for tests.
 */
export async function linkInstallations(own: number, roots: number[]): Promise<number> {
  const r = await sql().begin((tx) => linkInTx(tx, own, roots));
  // After commit, so a render can't cache the pre-merge profile (v2.12 T10 review).
  if (r.moved) profileChanged();
  return r.n;
}

/**
 * linkInstallations inside a caller's transaction (v2.13.4: answerJoin checks and links in one).
 * Lock order (v2.14 T5 fix round 1): advisory locks first, then installation rows. Here: `own`'s row only.
 * x-install.ts attachToX: `x_attach`, `x_user`, `x_handle` advisory locks, then `own` and its members' rows in
 * id order (one SELECT ... ORDER BY id FOR UPDATE), then profile rows.
 */
async function linkInTx(tx: postgres.TransactionSql, own: number, roots: number[]): Promise<{ n: number; moved: boolean }> {
  let profilesMoved = false;
  const n = await (async () => {
    const [mine] = await tx<{ root: number }[]>`
      SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${own} FOR UPDATE`;
    const all = [...new Set([mine.root, ...roots])].sort((a, b) => a - b);
    const [root, ...others] = all;
    for (const other of others) {
      // v2.12.1 spec "Identity": two people claimed with different X accounts are never one person,
      // whatever links them (a pickup, a proven tie): that group is left out.
      const xs = await tx<{ x: string }[]>`
        SELECT DISTINCT x_user_id AS x FROM builder_profiles WHERE builder_id IN (${root}, ${other}) AND x_user_id IS NOT NULL`;
      if (xs.length > 1) continue;
      // M3: one entry per (program, repo) in the group (per program and name without a repo, as
      // ownEntry matches): the row with the token, else the earlier-submitted one, moves to (or stays
      // on) the root; the other duplicate stays on, or moves to, the member installation, out of the
      // group's entries.
      // v2.9 T12 (G0 N3): a row holding the repo's token is kept first, so the group's entry keeps it.
      const rows = await tx<{ id: number; program_id: string; repo_url: string | null; name: string }[]>`
        SELECT id, program_id, repo_url, name FROM projects
        WHERE installation_id IN (${root}, ${other}) ORDER BY (token_url IS NOT NULL) DESC, submitted_at, id`;
      const seen = new Set<string>();
      const later: number[] = [];
      for (const p of rows) {
        const k = `${p.program_id}\u0000${p.repo_url ? normalizeRepoUrl(p.repo_url) : `name:${p.name.trim().toLowerCase()}`}`;
        if (seen.has(k)) later.push(p.id);
        else seen.add(k);
      }
      await tx`
        UPDATE projects SET installation_id = CASE WHEN id = ANY(${later}::int[]) THEN ${other}::int ELSE ${root}::int END
        WHERE installation_id IN (${root}, ${other})`;
      // v2.12 spec 9: sponsor_campaigns is archived and receives no writes while the flag is off.
      if (archiveFlag('SPONSOR_CAMPAIGNS'))
        await tx`UPDATE sponsor_campaigns SET installation_id = ${root} WHERE installation_id = ${other}`;
      await tx`
        INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id, updated_at)
        SELECT ${root}, project_key, kind, answer, program_id, updated_at FROM answer_bank WHERE installation_id = ${other}
        ON CONFLICT (installation_id, project_key, kind) DO UPDATE SET
          answer = EXCLUDED.answer, program_id = EXCLUDED.program_id, updated_at = EXCLUDED.updated_at
        WHERE answer_bank.updated_at < EXCLUDED.updated_at`;
      await tx`DELETE FROM answer_bank WHERE installation_id = ${other}`;
      await tx`
        INSERT INTO installation_wallets (installation_id, wallet, first_seen_at)
        SELECT ${root}, wallet, first_seen_at FROM installation_wallets WHERE installation_id = ${other}
        ON CONFLICT DO NOTHING`;
      await tx`
        INSERT INTO token_offers (installation_id, program_id, entry_key, offered_name, offered_ticker, offered_at)
        SELECT ${root}, program_id, entry_key, offered_name, offered_ticker, offered_at FROM token_offers WHERE installation_id = ${other}
        ON CONFLICT DO NOTHING`;
      await tx`DELETE FROM token_offers WHERE installation_id = ${other}`;
      await tx`
        UPDATE installations r SET
          github_user = COALESCE(r.github_user, o.github_user),
          repos = COALESCE(r.repos, o.repos),
          local_repos = COALESCE(r.local_repos, o.local_repos),
          payout_wallet = COALESCE(r.payout_wallet, o.payout_wallet),
          working_on = ARRAY(SELECT DISTINCT unnest(r.working_on || o.working_on)),
          fit_chains = ARRAY(SELECT DISTINCT unnest(r.fit_chains || o.fit_chains) ORDER BY 1),
          fit_repos = CASE WHEN jsonb_array_length(r.fit_repos) > 0 THEN r.fit_repos ELSE o.fit_repos END,
          alert_state = COALESCE(o.alert_state, '{}'::jsonb) || COALESCE(r.alert_state, '{}'::jsonb)
        FROM installations o WHERE r.id = ${root} AND o.id = ${other}`;
      await tx`UPDATE installations SET builder_id = ${root} WHERE id = ${other} OR builder_id = ${other}`;
      // v2.12 plan R3: the two people's profiles, sources and slugs become one.
      if (await mergeProfiles(tx, root, other)) profilesMoved = true;
    }
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM projects WHERE installation_id = ${root}`;
    return n;
  })();
  return { n, moved: profilesMoved };
}

export type ProvenTie = { github_login: string } | { deploy_wallet: string };
/** Off until the owner rules that a deploy wallet is proven (see joinOnProvenTie). */
const DEPLOY_WALLET_TIES = false as boolean;

/** The one yes the group that already holds a tie sees in its next find or score reply. */
export const JOIN_QUESTIONS = {
  github_login: 'Another agent signed in as your GitHub. Add it to your page?',
  x_user_id: 'Another agent signed in with your X. Add it to your page?',
} as const;
export type JoinTie = keyof typeof JOIN_QUESTIONS;
/** v2.12.1 T6 (T5 carry): the same yes, as the agent that just signed in (the joining side) reads it. */
export const JOIN_QUESTIONS_JOINER: Record<JoinTie, string> = {
  github_login: 'Your GitHub is already on an EarnKit page from another agent. Add this agent to your EarnKit page?',
  x_user_id: 'Your X is already on an EarnKit page from another agent. Add this agent to your EarnKit page?',
};
/** The question for `side` of a pending join. Pure. */
export const joinQuestion = (tie: JoinTie, side: 'target' | 'joiner') => (side === 'joiner' ? JOIN_QUESTIONS_JOINER : JOIN_QUESTIONS)[tie];
/** The builder's lines for their answer (`...Here`: said on the joining side). */
export const JOIN_TEXT = {
  linked: 'Done. That agent is on your page now.',
  linkedHere: 'Done. This agent is on your page now.',
  waiting: 'Okay. It joins once the other agent says yes too.',
  waitingHere: 'Okay. This agent joins once your other agent says yes too.',
  declined: 'Okay. That agent stays apart from your page.',
  declinedHere: 'Okay. This agent stays apart from your page.',
  /** v2.13.4: the consent no longer matches what it was given for (changed, or over a day old). */
  expired: 'That request changed or is over a day old, so I dropped it.\nWant me to show where you stand now?',
  /** v2.13.4 R8: a new agent's notice on the page is still open. */
  refused: 'First answer the question about the new agent on your page.\nWant me to show it now?',
} as const;

/**
 * v2.12.1 spec "Identity": "Installations join one person only on proven ties: the same confirmed
 * X account (immutable X user id), the same proven GitHub login (sign-in or proof line), or the
 * same EarnKit deploy wallet. An agent-reported login or wallet never merges anyone." A login
 * proven only by the X field match (github_basis 'x_match') never joins. Two people claimed with
 * different X accounts are never joined. Shared clients never join. v2.13.4 R10: there is no X
 * two-agent yes (the claim page's one-click join is the only X join).
 *
 * Fix round 1 (controller ruling): a sign-in link can be completed by whoever it was sent to, so a
 * proof on this installation never merges it into a group that already holds the tie. Each such
 * group gets a pending join instead. Fix round 2: it joins only after a yes from both groups' agents
 * (answerJoin), each asked once (askJoin); either no deletes it. With no other
 * group holding it, the tie simply proves it here (nothing to join). Returns how many groups were
 * asked.
 */
export async function joinOnProvenTie(installationId: number, tie: ProvenTie): Promise<number> {
  if (await sharedGroup(installationId)) return 0;
  // Held for the owner's ruling: a deploy's owner_wallet is the wallet the agent typed (deploy.ts:
  // "a wallet is only named"), so a tie on it would let anyone who deploys to a stranger's wallet
  // reach that stranger's group, which the binding rule forbids ("an agent-reported login or wallet
  // never merges anyone"). Until a deploy wallet is proven, it asks no one; deploy.ts does not call this.
  if ('deploy_wallet' in tie && !DEPLOY_WALLET_TIES) return 0;
  const root = await rootOf(installationId);
  const db = sql();
  const rows =
    'github_login' in tie
        ? await db<{ r: number }[]>`
            SELECT DISTINCT COALESCE(i.builder_id, i.id) AS r FROM github_verifications v JOIN installations i ON i.id = v.installation_id
            WHERE lower(v.login) = ${tie.github_login.toLowerCase()} AND COALESCE(i.builder_id, i.id) <> ${root}
            UNION
            SELECT builder_id FROM builder_profiles
            WHERE lower(github_login) = ${tie.github_login.toLowerCase()} AND github_basis IN ('signin', 'app', 'proof_line') AND builder_id <> ${root}`
        : await db<{ r: number }[]>`
            SELECT DISTINCT COALESCE(i.builder_id, i.id) AS r FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
            WHERE lower(d.owner_wallet) = ${tie.deploy_wallet.toLowerCase()} AND d.status = 'deployed' AND COALESCE(i.builder_id, i.id) <> ${root}`;
  const kind: JoinTie = 'github_login';
  const xOf = async (id: number) =>
    (await db<{ x: string | null }[]>`SELECT x_user_id AS x FROM builder_profiles WHERE builder_id = ${id}`)[0]?.x ?? null;
  const mine = await xOf(root);
  const asked: number[] = [];
  for (const { r } of rows) {
    if (asked.includes(r) || (await sharedGroup(r))) continue;
    const theirs = await xOf(r);
    if (mine && theirs && mine !== theirs) continue; // two X accounts: two people
    // v2.13.4: the consent is bound to this joining installation, the page's root at ask time and both
    // sides' facts then (joinStamp); a stale row is replaced by a fresh ask.
    const [js, ts] = [await joinStamp(db, root, 'joiner'), await joinStamp(db, r, 'target')];
    await db`
      INSERT INTO pending_joins (installation_id, target, tie, target_root, joiner_stamp, target_stamp) VALUES (${installationId}, ${r}, ${kind}, ${r}, ${js}, ${ts})
      ON CONFLICT (installation_id, target) DO UPDATE SET tie = EXCLUDED.tie, target_root = EXCLUDED.target_root, joiner_stamp = EXCLUDED.joiner_stamp,
        target_stamp = EXCLUDED.target_stamp, created_at = now(), target_yes = NULL, joiner_yes = NULL, target_asked_at = NULL, joiner_asked_at = NULL
      WHERE pending_joins.joiner_stamp IS DISTINCT FROM EXCLUDED.joiner_stamp OR pending_joins.target_stamp IS DISTINCT FROM EXCLUDED.target_stamp
        OR pending_joins.created_at < now() - interval '24 hours'`;
    asked.push(r);
  }
  return asked.length;
}

type PendingRow = { installation_id: number; target: number; tie: JoinTie; side: 'target' | 'joiner'; asked: boolean };

/**
 * The oldest pending join this group has not answered yet: as its target (it already held the tie) or
 * as the joining side (its installation proved a tie another group holds). Groups are read through
 * their current roots; a join whose two sides are already one person is skipped. v2.13.4 R10: under the
 * Bench an X tie is never asked (the claim page's one click for a fresh connection is the only X join).
 */
async function pendingRow(root: number, db: Db = sql()): Promise<PendingRow | null> {
  const [row] = await db<PendingRow[]>`
    SELECT j.installation_id, j.target, j.tie,
      CASE WHEN COALESCE(t.builder_id, t.id) = ${root} AND j.target_yes IS NULL THEN 'target' ELSE 'joiner' END AS side,
      CASE WHEN COALESCE(t.builder_id, t.id) = ${root} AND j.target_yes IS NULL THEN j.target_asked_at IS NOT NULL
        ELSE j.joiner_asked_at IS NOT NULL END AS asked
    FROM pending_joins j
    JOIN installations t ON t.id = j.target
    JOIN installations i ON i.id = j.installation_id
    WHERE COALESCE(t.builder_id, t.id) <> COALESCE(i.builder_id, i.id)
      AND j.created_at > now() - interval '24 hours'
      -- v2.13.4 R10: there is no X two-agent yes (an X tie is never asked or answered).
      AND j.tie <> 'x_user_id'
      AND ((COALESCE(t.builder_id, t.id) = ${root} AND j.target_yes IS NULL)
        OR (COALESCE(i.builder_id, i.id) = ${root} AND j.joiner_yes IS NULL))
    ORDER BY j.created_at, j.installation_id LIMIT 1`;
  return row ?? null;
}

/** This group's unanswered pending join (`installation_id` is the joining installation), or null. */
export async function pendingJoinOf(installationId: number): Promise<{ installation_id: number; tie: JoinTie; side: 'target' | 'joiner' } | null> {
  const row = await pendingRow(await rootOf(installationId));
  return row ? { installation_id: row.installation_id, tie: row.tie, side: row.side } : null;
}

/**
 * The join question this group's reply asks now, or null: each side is asked once (its next find or
 * score reply); the answer, through tell, still works later.
 */
export async function askJoin(installationId: number): Promise<{ question: string } | null> {
  const row = await pendingRow(await rootOf(installationId));
  if (!row || row.asked) return null;
  if (row.side === 'target')
    await sql()`UPDATE pending_joins SET target_asked_at = now() WHERE installation_id = ${row.installation_id} AND target = ${row.target}`;
  else await sql()`UPDATE pending_joins SET joiner_asked_at = now() WHERE installation_id = ${row.installation_id} AND target = ${row.target}`;
  return { question: joinQuestion(row.tie, row.side) };
}

/**
 * This group's yes or no to its pending join. No (from either side): the join is deleted. Yes: kept;
 * once both groups said yes, the joining installation's group joins the target's (the older group
 * keeps its page; hidden or held if either was); never a shared group, never two X accounts.
 */
export async function answerJoin(installationId: number, yes: boolean): Promise<'linked' | 'waiting' | 'declined' | 'none' | 'refused' | 'expired'> {
  const out = await sql().begin(async (tx) => {
    const row = await pendingRow(await rootOf(installationId), tx);
    if (!row) return { r: 'none' as const };
    const key = tx`installation_id = ${row.installation_id} AND target = ${row.target}`;
    // One transaction (v2.13.4): both groups' page locks (the R1 join and detach take them too), in id
    // order, then the row itself; every check below and the link see the same state.
    const roots = [await rootOf(row.installation_id), await rootOf(row.target)].sort((a, b) => a - b);
    for (const r of roots) await tx`SELECT pg_advisory_xact_lock(hashtext(${`page_join:${r}`}))`;
    const [p] = await tx<{ target_root: number | null; joiner_stamp: string | null; target_stamp: string | null; fresh: boolean }[]>`
      SELECT target_root, joiner_stamp, target_stamp, created_at > now() - interval '24 hours' AS fresh FROM pending_joins WHERE ${key} FOR UPDATE`;
    if (!p) return { r: 'none' as const };
    if (!yes) {
      await tx`DELETE FROM pending_joins WHERE ${key}`;
      return { r: 'declined' as const };
    }
    // v2.13.4: a consent is used only for the facts it was given for: the same joining installation and
    // page root, under 24 hours, and neither side changed since (the joining side gained no data or
    // member; the page didn't re-root and had no R1 join or detach). Else it is dropped.
    const [jr, tr] = [await rootIn(tx, row.installation_id), await rootIn(tx, row.target)];
    const stale = !p.fresh || p.target_root === null || tr !== p.target_root
      || p.joiner_stamp !== (await joinStamp(tx, jr, 'joiner')) || p.target_stamp !== (await joinStamp(tx, tr, 'target'));
    if (stale) {
      await tx`DELETE FROM pending_joins WHERE ${key}`;
      return { r: 'expired' as const };
    }
    // v2.13.4 R8 (5): no tie-join onto a page whose R1 join notice isn't answered yet by every eligible
    // installation: that page's own yes is not recorded, and a link is never made while either side has one.
    const mine = row.side === 'target' ? row.target : row.installation_id;
    if (await openR1Join(mine)) return { r: 'refused' as const };
    const [both] = await tx<{ both: boolean }[]>`
      UPDATE pending_joins SET ${row.side === 'target' ? tx`target_yes = true` : tx`joiner_yes = true`}
      WHERE ${key} RETURNING (target_yes AND joiner_yes) IS TRUE AS both`;
    if (!both?.both) return { r: 'waiting' as const };
    if ((await openR1Join(row.installation_id)) || (await openR1Join(row.target))) {
      await tx`UPDATE pending_joins SET ${row.side === 'target' ? tx`target_yes = NULL, target_asked_at = NULL` : tx`joiner_yes = NULL, joiner_asked_at = NULL`} WHERE ${key}`;
      return { r: 'refused' as const };
    }
    await tx`DELETE FROM pending_joins WHERE ${key}`;
    if ((await sharedGroup(roots[0])) || (await sharedGroup(roots[1]))) return { r: 'none' as const };
    const linked = await linkInTx(tx, row.installation_id, [await rootOf(row.target)]);
    const [a] = await tx<{ same: boolean }[]>`
      SELECT (SELECT COALESCE(builder_id, id) FROM installations WHERE id = ${row.installation_id}) = (SELECT COALESCE(builder_id, id) FROM installations WHERE id = ${row.target}) AS same`;
    return { r: a?.same ? ('linked' as const) : ('none' as const), moved: linked.moved };
  });
  if ('moved' in out && out.moved) profileChanged();
  return out.r;
}

const rootIn = async (db: Db, id: number) => (await db<{ root: number }[]>`SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${id}`)[0]?.root ?? null;

/**
 * v2.13.4: what a pending join's consent was given for. `joiner`: the group's installations, verified
 * sources, GitHub verifications, wallets, payout wallets, entries, token offers, coin moments and X claim
 * (any change voids the yes). `target`: the page's root, its installations and its R1 joins and detaches.
 */
async function joinStamp(db: Db, root: number | null, side: 'joiner' | 'target'): Promise<string | null> {
  if (root === null) return null;
  const grp = db`SELECT id FROM installations WHERE COALESCE(builder_id, id) = ${root}`;
  const [r] = side === 'target'
    ? await db<{ s: string }[]>`
        SELECT md5(concat_ws('|', ${root}::text,
          (SELECT string_agg(id::text, ',' ORDER BY id) FROM installations WHERE COALESCE(builder_id, id) = ${root}),
          (SELECT string_agg(id::text || ':' || (detached_at IS NOT NULL)::text, ',' ORDER BY id) FROM page_joins WHERE root = ${root}))) AS s`
    : await db<{ s: string }[]>`
        SELECT md5(concat_ws('|', ${root}::text,
          (SELECT string_agg(id::text || ':' || coalesce(payout_wallet, ''), ',' ORDER BY id) FROM installations WHERE COALESCE(builder_id, id) = ${root}),
          (SELECT count(*) FROM builder_sources WHERE builder_id = ${root} AND state = 'verified'),
          (SELECT count(*) FROM github_verifications WHERE installation_id IN (${grp})),
          (SELECT count(*) FROM github_verify_nonces WHERE installation_id IN (${grp}) AND used_at IS NULL),
          (SELECT count(*) FROM installation_wallets WHERE installation_id IN (${grp})),
          (SELECT count(*) FROM person_wallets WHERE builder_id = ${root}),
          (SELECT count(*) FROM projects WHERE installation_id IN (${grp})),
          (SELECT count(*) FROM token_offers WHERE installation_id IN (${grp})),
          (SELECT count(*) FROM coin_moments WHERE builder_id = ${root}),
          (SELECT x_user_id FROM builder_profiles WHERE builder_id = ${root}))) AS s`;
  return r?.s ?? null;
}
