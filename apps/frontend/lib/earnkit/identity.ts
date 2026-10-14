import { archiveFlag, builderScoreEnabled } from './builder-score-flag';
import { githubRepo, normalizeRepoUrl } from './campaigns';
import { sql } from './db';
import { sharedGroup } from './installations';
import { profileChanged } from './profile-cache';
import { mergeProfiles } from './profiles';
import {
  fetchOwnershipFile,
  fetchOwnershipLatestBranch,
  fetchOwnershipViaApi,
  ownershipBaseUrl,
  ownershipFileUrl,
  parseOwnershipFile,
  type FetchResult,
} from './ownership';
import { tokenCode } from './token-gate';
import { repoKey } from './answer-bank';
import { createVerifyLink, githubVerifyEnabled, verifiedFor } from './github-verify';
import { timingSafeEqual } from 'node:crypto';

/**
 * v2.8.1 §E18: the builder's identity follows them across installs. A reinstall or an agent switch is
 * a new installation; when it states a GitHub user or a wallet that earlier installations used, the
 * builder is offered one yes/no ("Pick up your 2 earlier entries?"). On yes the installations are
 * linked: every one of them then acts as the group's first installation (its root), so entries, the
 * answer bank, remembered details, alerts and limits are shared.
 *
 * Privacy (no cross-user leaks):
 * - The match only uses what the builder states in this exchange (the GitHub user or wallet given on
 *   this call), never what an installation remembers: on a shared hosted registration the memory may
 *   be another user's.
 * - A stated GitHub user or wallet is public, so a yes alone never links. The link also needs this
 *   agent's proof line in the repo of one of the earlier entries: the same line a token launch needs,
 *   which only someone who can push to that repo can add (token-gate.ts tokenCode, bound to this
 *   installation). Without it, the answer bank, contact details and launch rights stay put.
 * - The proof covers one repo, so only the groups with an entry in that repo are offered and linked
 *   (final fix wave, C1): a group that only shares a public GitHub user or wallet is never linked by
 *   another group's proof, and the question counts only the covered groups' entries.
 * - Ruling F13: an entry naming the repo proves nothing (anyone can name any repo). A covered group
 *   counts only once it has itself proven the repo: its token on the repo launched, one of its
 *   installations' own proof line is in the repo's earnkit.txt, or (v2.9 B9, P8) one of its
 *   installations signed in with GitHub for the repo. Unproven groups are never counted in the
 *   question and never linked.
 * - v2.9 B9 (P8): the caller may prove the repo with a GitHub sign-in (a `pickup` verification of the
 *   offer's repo for its own installation, made after the offer) instead of the proof line.
 * - A hosted agent (shared_client) serves many builders: no group holding one is ever offered or
 *   linked, and a hosted caller is never offered a pickup (final fix wave, C2).
 * - Nothing is linked without the builder's yes; a no is remembered and never asked again for the
 *   same earlier installations.
 */

/** A GitHub username as GitHub allows it (also safe inside the SQL pattern below). Pure. */
const GITHUB_USER = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;

/** The earlier installations a stated identity points to, outside this installation's group. */
export type Earlier = {
  /** The roots of the matched groups, ascending. */
  roots: number[];
  /** Entries those groups recorded. */
  entries: number;
  /** A GitHub repo of one of those entries (the newest, the stated user's first): where the proof goes. */
  repo: string | null;
  /** Entries per matched root. */
  counts: Record<number, number>;
};

/** What an installation holds for the pickup offer (installations.pickup). */
type PickupState = {
  offered?: number[];
  repo?: string | null;
  entries?: number;
  declined?: number[];
  /** v2.9 B9 (P8): when the offer was made (ISO); a sign-in counts only if made after it. */
  at?: string;
  /**
   * v2.9 T12 (G0 N2): the last earnkit.txt read for the offer: its repo, the groups it was read for
   * and when (ISO). The same groups are not read for again within READ_TTL_MS.
   */
  read?: { repo: string; roots: number[]; at: string };
};

/** v2.9 T12 (G0 N2): how long one earnkit.txt read stands for the same repo and groups. */
const READ_TTL_MS = 3_600_000;

/** This installation's group root (itself when it isn't linked). */
export async function rootOf(installationId: number): Promise<number> {
  const [row] = await sql()<{ root: number }[]>`
    SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${installationId}`;
  return row?.root ?? installationId;
}

/**
 * The earlier installations whose GitHub user, wallets or entries match what the builder stated now,
 * outside `root`'s group. Only entries count (an installation that never entered has nothing to pick
 * up). `github_user` and `wallet` must come from this call's input, never from memory.
 */
export type Stated = {
  /** GitHub users the builder named on this call: the GitHub user, and the owners of repos reported now. */
  github_users?: (string | null | undefined)[];
  wallet?: string | null;
};

/** The valid, lowercase GitHub users of a statement, at most 5. Pure; exported for tests. */
export function statedUsers(stated: Stated): string[] {
  const users = (stated.github_users ?? [])
    .map((u) => u?.trim().toLowerCase() ?? '')
    .filter((u) => GITHUB_USER.test(u));
  return [...new Set(users)].slice(0, 5);
}

export async function findEarlier(root: number, stated: Stated): Promise<Earlier | null> {
  const users = statedUsers(stated);
  const w = stated.wallet?.trim().toLowerCase() || null;
  const wallet = w && /^0x[0-9a-f]{40}$/.test(w) ? w : null;
  if (users.length === 0 && !wallet) return null;
  // GitHub users are [a-z0-9-] only (GITHUB_USER), so they are safe inside the pattern.
  const pattern = users.length > 0 ? `github\\.com[/:](${users.join('|')})/` : null;
  const db = sql();
  // C2: a group holding a hosted (shared_client) installation is never matched.
  const rows = await db<{ root: number }[]>`
    SELECT DISTINCT COALESCE(i.builder_id, i.id) AS root FROM installations i
    WHERE COALESCE(i.builder_id, i.id) <> ${root}
      AND NOT EXISTS (
        SELECT 1 FROM installations s
        WHERE COALESCE(s.builder_id, s.id) = COALESCE(i.builder_id, i.id) AND s.shared_client)
      AND (
      (${users.length > 0} AND lower(i.github_user) = ANY(${users}::text[]))
      OR (${wallet}::text IS NOT NULL AND EXISTS (
        SELECT 1 FROM installation_wallets iw WHERE iw.installation_id = i.id AND iw.wallet = ${wallet}))
      OR EXISTS (
        SELECT 1 FROM projects p WHERE p.installation_id = i.id AND (
          (${pattern}::text IS NOT NULL AND lower(p.repo_url) ~ ${pattern})
          OR (${wallet}::text IS NOT NULL AND (lower(p.payout_wallet) = ${wallet} OR lower(p.creator_wallet) = ${wallet})))))
    ORDER BY root`;
  const roots = rows.map((r) => r.root);
  if (roots.length === 0) return null;
  const entries = await groupEntries(roots);
  if (entries.length === 0) return null;
  const repos = entries.map((e) => e.repo_url).filter((u): u is string => !!u && githubRepo(u) !== null);
  // The stated user's repos first, newest first, then the others.
  const ordered = [
    ...repos.filter((u) => users.includes(githubRepo(u)!.owner.toLowerCase())),
    ...repos.filter((u) => !users.includes(githubRepo(u)!.owner.toLowerCase())),
  ];
  // v2.9 T12 (G0 N1): the proof goes in a repo a matched group already proved (its token launched,
  // or a GitHub sign-in for it), so a newer entry anyone can record on another of the builder's
  // repos never takes the proof repo away from an honest pickup. Else the newest, as before.
  const proved = await provedRepos(roots);
  const repo = ordered.find((u) => proved.has(normalizeRepoUrl(u))) ?? ordered[0] ?? null;
  if (!repo) return { roots, entries: entries.length, repo: null, counts: countBy(entries) };
  // C1: the proof covers this repo only: just the groups with an entry in it, and just their entries.
  const covered = coveredRoots(entries, repo);
  const kept = entries.filter((e) => covered.includes(e.root));
  return { roots: covered, entries: kept.length, repo, counts: countBy(kept) };
}

/**
 * v2.9 T12 (G0 N1): the repos (normalizeRepoUrl form) the groups rooted at `roots` proved without a
 * file read: a launched EarnKit token on the repo, or (while sign-in is on) a GitHub sign-in for it.
 */
async function provedRepos(roots: number[]): Promise<Set<string>> {
  const db = sql();
  const [launched, signedIn] = await Promise.all([
    db<{ key: string }[]>`
      SELECT DISTINCT p.token_repo_key AS key FROM projects p JOIN installations i ON i.id = p.installation_id
      WHERE COALESCE(i.builder_id, i.id) IN ${db(roots)} AND p.token_repo_key IS NOT NULL
        AND p.token_status = 'launched' AND p.token_url IS NOT NULL AND p.token_url <> 'pending'`,
    !githubVerifyEnabled() ? Promise.resolve([]) : db<{ key: string }[]>`
      SELECT DISTINCT 'github.com/' || v.repo_key AS key FROM github_verifications v JOIN installations i ON i.id = v.installation_id
      WHERE COALESCE(i.builder_id, i.id) IN ${db(roots)} AND v.used_at IS NULL`,
  ]);
  return new Set([...launched, ...signedIn].map((r) => r.key.toLowerCase()));
}

const countBy = (entries: { root: number }[]) => {
  const out: Record<number, number> = {};
  for (const e of entries) out[e.root] = (out[e.root] ?? 0) + 1;
  return out;
};

/**
 * Ruling F13: of the covered groups `roots`, those that have themselves proven `repo`: an EarnKit
 * token launched on it by one of the group's entries, or one of the group's installations' own proof
 * line (tokenCode(installation, repo)) among `codes` (the repo's earnkit.txt now). Ascending.
 */
export async function provenRoots(roots: number[], repo: string, codes: readonly string[]): Promise<number[]> {
  if (roots.length === 0) return [];
  const db = sql();
  const key = normalizeRepoUrl(repo);
  const [launched, signedIn] = await Promise.all([
    db<{ root: number }[]>`
      SELECT DISTINCT COALESCE(i.builder_id, i.id) AS root FROM projects p JOIN installations i ON i.id = p.installation_id
      WHERE COALESCE(i.builder_id, i.id) IN ${db(roots)} AND p.token_repo_key = ${key}
        AND p.token_status = 'launched' AND p.token_url IS NOT NULL AND p.token_url <> 'pending'`,
    // v2.9 B9 (P8): or one of the group's installations signed in with GitHub for the repo (only
    // while the feature is on).
    !githubVerifyEnabled() ? Promise.resolve([]) : db<{ root: number }[]>`
      SELECT DISTINCT COALESCE(i.builder_id, i.id) AS root FROM github_verifications v JOIN installations i ON i.id = v.installation_id
      WHERE COALESCE(i.builder_id, i.id) IN ${db(roots)} AND v.repo_key = ${repoKey({ url: repo, name: '' })}
        AND v.used_at IS NULL`,
  ]);
  const proven = new Set([...launched, ...signedIn].map((r) => r.root));
  if (codes.length > 0) {
    const members = await db<{ id: number; root: number }[]>`
      SELECT id, COALESCE(builder_id, id) AS root FROM installations WHERE COALESCE(builder_id, id) IN ${db(roots)}`;
    for (const m of members) {
      const code = tokenCode(m.id, repo);
      if (code && codes.some((c) => same(c, code))) proven.add(m.root);
    }
  }
  return roots.filter((r) => proven.has(r));
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The proof codes in the repo's earnkit.txt now (default branch and the latest pushed branch). */
async function repoCodes(repo: string, deps: PickupDeps): Promise<{ codes: string[]; unreadable: boolean }> {
  const gh = githubRepo(repo);
  if (!gh) return { codes: [], unreadable: true };
  const d = { ...defaults, ...deps };
  const onDefault = await d.owner(gh).catch((): FetchResult => ({ status: 'error', message: 'unreadable' }));
  const latest = (await d.latest(gh).catch(() => null))?.file;
  const codes = [onDefault, latest].flatMap((f) => (f?.status === 'ok' ? parseOwnershipFile(f.text).codes : []));
  return { codes, unreadable: onDefault.status === 'error' };
}

/** The entries of the groups rooted at `roots`, newest first. */
async function groupEntries(roots: number[]) {
  const db = sql();
  return db<{ root: number; repo_url: string | null }[]>`
    SELECT COALESCE(i.builder_id, i.id) AS root, p.repo_url FROM projects p JOIN installations i ON i.id = p.installation_id
    WHERE COALESCE(i.builder_id, i.id) IN ${db(roots)}
    ORDER BY p.submitted_at DESC, p.id DESC`;
}

/** The roots (ascending) with an entry whose normalized repo is `repo`'s. Pure; exported for tests. */
export function coveredRoots(entries: { root: number; repo_url: string | null }[], repo: string): number[] {
  const key = normalizeRepoUrl(repo);
  return [...new Set(entries.filter((e) => e.repo_url && normalizeRepoUrl(e.repo_url) === key).map((e) => e.root))].sort((a, b) => a - b);
}

/** The yes/no the builder sees. Pure; exported for tests. */
export const pickupQuestion = (entries: number) =>
  entries === 1 ? 'Pick up your earlier entry?' : `Pick up your ${entries} earlier entries?`;

/**
 * list_programs: the pickup offer for what the builder stated on this call, or null. Asked once per
 * set of earlier installations (the answer still works later), never again for groups the builder said
 * no to, and never without an earlier entry in a GitHub repo (the proof needs one). Saves the offer on
 * this installation, for the answer.
 */
export async function offerPickup(
  own: number,
  stated: Stated,
  deps: PickupDeps = {},
): Promise<{ question: string; entries: number } | null> {
  const root = await rootOf(own);
  // C2: a hosted agent's group is never offered a pickup (one registration serves many builders).
  if (await sharedGroup(root)) return null;
  const found = await findEarlier(root, stated);
  if (!found || !found.repo) return null;
  const [row] = await sql()<{ pickup: PickupState | null }[]>`SELECT pickup FROM installations WHERE id = ${own}`;
  const declined = new Set(row?.pickup?.declined ?? []);
  const open = found.roots.filter((r) => !declined.has(r));
  if (open.length === 0) return null;
  // Asked once: the same earlier installations already offered wait for the answer (it still works
  // later). v2.9 T12 (G0 N2): checked before any read, so an open offer costs no GitHub call.
  const asked = new Set(row?.pickup?.offered ?? []);
  if (open.every((r) => asked.has(r))) return null;
  // Ruling F13: only groups that proved the repo themselves are offered and counted. G0 N2: the
  // repo's earnkit.txt is read only when a launched token or a sign-in doesn't already prove every
  // group, and at most once per READ_TTL_MS for the same repo and groups (unreadable: only launched
  // tokens and sign-ins count).
  let roots = await provenRoots(open, found.repo, []);
  const now = new Date();
  const last = row?.pickup?.read;
  const fresh =
    last?.repo === found.repo && open.every((r) => last.roots.includes(r)) && now.getTime() - Date.parse(last.at) < READ_TTL_MS;
  let read: PickupState['read'] = last;
  if (roots.length < open.length && !fresh) {
    roots = await provenRoots(open, found.repo, (await repoCodes(found.repo, deps)).codes);
    read = { repo: found.repo, roots: open, at: now.toISOString() };
    await sql()`UPDATE installations SET pickup = ${sql().json({ ...row?.pickup, read })} WHERE id = ${own}`;
  }
  if (roots.length === 0) return null;
  const entries = roots.reduce((n, r) => n + (found.counts[r] ?? 0), 0);
  if (roots.every((r) => asked.has(r))) return null;
  const state: PickupState = { ...row?.pickup, read, offered: roots, repo: found.repo, entries, at: now.toISOString() };
  await sql()`UPDATE installations SET pickup = ${sql().json(state)} WHERE id = ${own}`;
  return { question: pickupQuestion(entries), entries };
}

export type PickupDeps = {
  /** Reads the repo's earnkit.txt on its default branch (GitHub contents API, or the dev/test override). */
  owner?: (r: { owner: string; repo: string }) => Promise<FetchResult>;
  /** earnkit.txt at the most recently pushed branch, or null. */
  latest?: (r: { owner: string; repo: string }) => Promise<{ branch: string; file: FetchResult } | null>;
};

const defaults: Required<PickupDeps> = {
  owner: (r) =>
    process.env.EARNKIT_OWNERSHIP_BASE_URL
      ? fetchOwnershipFile(ownershipFileUrl(r, ownershipBaseUrl()))
      : fetchOwnershipViaApi(r),
  latest: (r) =>
    process.env.EARNKIT_OWNERSHIP_BASE_URL ? Promise.resolve(null) : fetchOwnershipLatestBranch(r, undefined),
};

export type PickupResult =
  | { status: 'linked'; entries: number }
  | { status: 'declined' }
  | { status: 'none' }
  | { status: 'needs_proof'; repo: string; line: string; unreadable: boolean; sign_in?: string };

/**
 * The builder's answer to the pickup offer. No: remembered, nothing changes. Yes: the earlier groups
 * are linked once this agent's proof line is in the offer's repo (default branch or the latest
 * pushed branch); until then, what to push. `own` is the calling installation, never its root.
 */
export async function answerPickup(own: number, yes: boolean, deps: PickupDeps = {}): Promise<PickupResult> {
  // v2.12.1 fix round 2: with the score flag on, people join only through a pending join both groups
  // said yes to (answerJoin); an offer made before the flag went on never links.
  if (builderScoreEnabled()) return { status: 'none' };
  const [row] = await sql()<{ pickup: PickupState | null }[]>`SELECT pickup FROM installations WHERE id = ${own}`;
  const state = row?.pickup ?? {};
  const offered = state.offered ?? [];
  if (offered.length === 0 || !state.repo) return { status: 'none' };
  // C2: a hosted agent's group never links (it can't have been offered; checked again here).
  if (await sharedGroup(await rootOf(own))) return { status: 'none' };
  if (!yes) {
    const declined = [...new Set([...(state.declined ?? []), ...offered])];
    await sql()`UPDATE installations SET pickup = ${sql().json({ declined })} WHERE id = ${own}`;
    return { status: 'declined' };
  }
  const gh = githubRepo(state.repo);
  const code = tokenCode(own, state.repo);
  if (!gh || !code) return { status: 'none' };
  const key = `${gh.owner}/${gh.repo}`.toLowerCase();
  // v2.9 B9 (P8): this installation's GitHub sign-in for the offer's repo, made after the offer,
  // stands in for its proof line.
  const signedIn =
    githubVerifyEnabled() &&
    state.at !== undefined &&
    (await verifiedFor({ installationId: own, repoKey: key, since: new Date(state.at), purpose: 'pickup' })) !== null;
  const file = await repoCodes(state.repo, deps);
  if (!signedIn && !file.codes.some((c) => same(c, code))) {
    const signIn = githubVerifyEnabled()
      ? await createVerifyLink({ installationId: own, projectId: null, repoKey: key, purpose: 'pickup' })
      : null;
    return {
      status: 'needs_proof',
      repo: `github.com/${gh.owner}/${gh.repo}`,
      line: `token: ${code}`,
      unreadable: file.unreadable,
      ...(signIn && { sign_in: signIn }),
    };
  }
  // C1, C2: link only the offered groups the proof covers now (an entry in the proven repo) and that
  // hold no hosted installation; read again, so a group that changed since the offer is left out.
  const mine = await rootOf(own);
  const current = [...new Set(offered.map(Number).filter(Number.isInteger))];
  const covered = current.length === 0 ? [] : coveredRoots(await groupEntries(current), state.repo);
  // Ruling F13: and that proved the repo themselves (a launched token, or their own line now).
  const roots = await provenRoots(covered, state.repo, file.codes);
  const safe: number[] = [];
  for (const r of roots) if (r !== mine && (await rootOf(r)) === r && !(await sharedGroup(r))) safe.push(r);
  await sql()`UPDATE installations SET pickup = ${sql().json({ declined: state.declined ?? [] })} WHERE id = ${own}`;
  if (safe.length === 0) return { status: 'none' };
  const entries = await linkInstallations(own, safe);
  return { status: 'linked', entries };
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
  let profilesMoved = false;
  const n = await sql().begin(async (tx) => {
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
      // v2.12 plan R3: the two people's profiles, sources and slugs become one (nothing exists, so
      // nothing is written, while EARNKIT_BUILDER_SCORE is off).
      if (await mergeProfiles(tx, root, other)) profilesMoved = true;
    }
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM projects WHERE installation_id = ${root}`;
    return n;
  });
  // After commit, so a render can't cache the pre-merge profile (v2.12 T10 review).
  if (profilesMoved) profileChanged();
  return n;
}

export type ProvenTie = { x_user_id: string } | { github_login: string } | { deploy_wallet: string };
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
} as const;

/**
 * v2.12.1 spec "Identity": "Installations join one person only on proven ties: the same confirmed
 * X account (immutable X user id), the same proven GitHub login (sign-in or proof line), or the
 * same EarnKit deploy wallet. An agent-reported login or wallet never merges anyone." A login
 * proven only by the X field match (github_basis 'x_match') never joins. Two people claimed with
 * different X accounts are never joined. Shared clients never join. Flag off: nothing.
 *
 * Fix round 1 (controller ruling): a sign-in link can be completed by whoever it was sent to, so a
 * proof on this installation never merges it into a group that already holds the tie. Each such
 * group gets a pending join instead. Fix round 2: it joins only after a yes from both groups' agents
 * (answerJoin), each asked once (askJoin); either no deletes it. With no other
 * group holding it, the tie simply proves it here (nothing to join). Returns how many groups were
 * asked. T6 (the X claim) calls this with { x_user_id } before writing the claim.
 */
export async function joinOnProvenTie(installationId: number, tie: ProvenTie): Promise<number> {
  if (!builderScoreEnabled() || (await sharedGroup(installationId))) return 0;
  // Held for the owner's ruling: a deploy's owner_wallet is the wallet the agent typed (deploy.ts:
  // "a wallet is only named"), so a tie on it would let anyone who deploys to a stranger's wallet
  // reach that stranger's group, which the binding rule forbids ("an agent-reported login or wallet
  // never merges anyone"). Until a deploy wallet is proven, it asks no one; deploy.ts does not call this.
  if ('deploy_wallet' in tie && !DEPLOY_WALLET_TIES) return 0;
  const root = await rootOf(installationId);
  const db = sql();
  const rows =
    'x_user_id' in tie
      ? await db<{ r: number }[]>`SELECT builder_id AS r FROM builder_profiles WHERE x_user_id = ${tie.x_user_id} AND builder_id <> ${root}`
      : 'github_login' in tie
        ? await db<{ r: number }[]>`
            SELECT DISTINCT COALESCE(i.builder_id, i.id) AS r FROM github_verifications v JOIN installations i ON i.id = v.installation_id
            WHERE lower(v.login) = ${tie.github_login.toLowerCase()} AND COALESCE(i.builder_id, i.id) <> ${root}
            UNION
            SELECT builder_id FROM builder_profiles
            WHERE lower(github_login) = ${tie.github_login.toLowerCase()} AND github_basis IN ('signin', 'app', 'proof_line') AND builder_id <> ${root}`
        : await db<{ r: number }[]>`
            SELECT DISTINCT COALESCE(i.builder_id, i.id) AS r FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
            WHERE lower(d.owner_wallet) = ${tie.deploy_wallet.toLowerCase()} AND d.status = 'deployed' AND COALESCE(i.builder_id, i.id) <> ${root}`;
  const kind: JoinTie = 'x_user_id' in tie ? 'x_user_id' : 'github_login';
  const xOf = async (id: number) =>
    (await db<{ x: string | null }[]>`SELECT x_user_id AS x FROM builder_profiles WHERE builder_id = ${id}`)[0]?.x ?? null;
  const mine = await xOf(root);
  const asked: number[] = [];
  for (const { r } of rows) {
    if (asked.includes(r) || (await sharedGroup(r))) continue;
    const theirs = await xOf(r);
    if (mine && theirs && mine !== theirs) continue; // two X accounts: two people
    await db`
      INSERT INTO pending_joins (installation_id, target, tie) VALUES (${installationId}, ${r}, ${kind})
      ON CONFLICT (installation_id, target) DO NOTHING`;
    asked.push(r);
  }
  return asked.length;
}

type PendingRow = { installation_id: number; target: number; tie: JoinTie; side: 'target' | 'joiner'; asked: boolean };

/**
 * The oldest pending join this group has not answered yet: as its target (it already held the tie) or
 * as the joining side (its installation proved a tie another group holds). Groups are read through
 * their current roots; a join whose two sides are already one person is skipped.
 */
async function pendingRow(root: number): Promise<PendingRow | null> {
  const [row] = await sql()<PendingRow[]>`
    SELECT j.installation_id, j.target, j.tie,
      CASE WHEN COALESCE(t.builder_id, t.id) = ${root} AND j.target_yes IS NULL THEN 'target' ELSE 'joiner' END AS side,
      CASE WHEN COALESCE(t.builder_id, t.id) = ${root} AND j.target_yes IS NULL THEN j.target_asked_at IS NOT NULL
        ELSE j.joiner_asked_at IS NOT NULL END AS asked
    FROM pending_joins j
    JOIN installations t ON t.id = j.target
    JOIN installations i ON i.id = j.installation_id
    WHERE COALESCE(t.builder_id, t.id) <> COALESCE(i.builder_id, i.id)
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
  if (!builderScoreEnabled()) return null;
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
export async function answerJoin(installationId: number, yes: boolean): Promise<'linked' | 'waiting' | 'declined' | 'none'> {
  if (!builderScoreEnabled()) return 'none';
  const row = await pendingRow(await rootOf(installationId));
  if (!row) return 'none';
  const key = sql()`installation_id = ${row.installation_id} AND target = ${row.target}`;
  if (!yes) {
    await sql()`DELETE FROM pending_joins WHERE ${key}`;
    return 'declined';
  }
  const [both] = await sql()<{ both: boolean }[]>`
    UPDATE pending_joins SET ${row.side === 'target' ? sql()`target_yes = true` : sql()`joiner_yes = true`}
    WHERE ${key} RETURNING (target_yes AND joiner_yes) IS TRUE AS both`;
  if (!both?.both) return 'waiting';
  const [joiner, target] = [await rootOf(row.installation_id), await rootOf(row.target)];
  await sql()`DELETE FROM pending_joins WHERE ${key}`;
  if ((await sharedGroup(joiner)) || (await sharedGroup(target))) return 'none';
  await linkInstallations(row.installation_id, [target]);
  return (await rootOf(row.installation_id)) === (await rootOf(row.target)) ? 'linked' : 'none';
}
