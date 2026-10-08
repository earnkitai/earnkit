import { githubRepo, normalizeRepoUrl } from './campaigns';
import { sql } from './db';
import { sharedGroup } from './installations';
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
 *   counts only once it has itself proven the repo: its token on the repo launched, or one of its
 *   installations' own proof line is in the repo's earnkit.txt. Unproven groups are never counted
 *   in the question and never linked.
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
type PickupState = { offered?: number[]; repo?: string | null; entries?: number; declined?: number[] };

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
  const own = repos.find((u) => users.includes(githubRepo(u)!.owner.toLowerCase()));
  const repo = own ?? repos[0] ?? null;
  if (!repo) return { roots, entries: entries.length, repo: null, counts: countBy(entries) };
  // C1: the proof covers this repo only: just the groups with an entry in it, and just their entries.
  const covered = coveredRoots(entries, repo);
  const kept = entries.filter((e) => covered.includes(e.root));
  return { roots: covered, entries: kept.length, repo, counts: countBy(kept) };
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
  const launched = await db<{ root: number }[]>`
    SELECT DISTINCT COALESCE(i.builder_id, i.id) AS root FROM projects p JOIN installations i ON i.id = p.installation_id
    WHERE COALESCE(i.builder_id, i.id) IN ${db(roots)} AND p.token_repo_key = ${key}
      AND p.token_status = 'launched' AND p.token_url IS NOT NULL AND p.token_url <> 'pending'`;
  const proven = new Set(launched.map((r) => r.root));
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
  // Ruling F13: only groups that proved the repo themselves are offered and counted (one read of
  // the repo's earnkit.txt; unreadable: only launched tokens count).
  const roots = await provenRoots(open, found.repo, (await repoCodes(found.repo, deps)).codes);
  if (roots.length === 0) return null;
  const entries = roots.reduce((n, r) => n + (found.counts[r] ?? 0), 0);
  // Asked once: the same earlier installations already offered wait for the answer (it still works later).
  const asked = new Set(row?.pickup?.offered ?? []);
  if (roots.every((r) => asked.has(r))) return null;
  const state: PickupState = { ...row?.pickup, offered: roots, repo: found.repo, entries };
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
  | { status: 'needs_proof'; repo: string; line: string; unreadable: boolean };

/**
 * The builder's answer to the pickup offer. No: remembered, nothing changes. Yes: the earlier groups
 * are linked once this agent's proof line is in the offer's repo (default branch or the latest
 * pushed branch); until then, what to push. `own` is the calling installation, never its root.
 */
export async function answerPickup(own: number, yes: boolean, deps: PickupDeps = {}): Promise<PickupResult> {
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
  const file = await repoCodes(state.repo, deps);
  if (!file.codes.some((c) => same(c, code)))
    return { status: 'needs_proof', repo: `github.com/${gh.owner}/${gh.repo}`, line: `token: ${code}`, unreadable: file.unreadable };
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
 * earlier-submitted one when both hold the same program and repo, answer bank,
 * wallets, token offers, sponsor drafts; on a clash the root's newer answer wins and the root's offer
 * stays). The root's memory keeps its own values, filling gaps from the others. One transaction.
 * Returns the group's entry count. Exported for tests.
 */
export async function linkInstallations(own: number, roots: number[]): Promise<number> {
  return sql().begin(async (tx) => {
    const [mine] = await tx<{ root: number }[]>`
      SELECT COALESCE(builder_id, id) AS root FROM installations WHERE id = ${own} FOR UPDATE`;
    const all = [...new Set([mine.root, ...roots])].sort((a, b) => a - b);
    const [root, ...others] = all;
    for (const other of others) {
      // M3: one entry per (program, repo) in the group (per program and name without a repo, as
      // ownEntry matches): the earlier-submitted row moves to (or stays on) the root; a later
      // duplicate stays on, or moves to, the member installation, out of the group's entries.
      const rows = await tx<{ id: number; program_id: string; repo_url: string | null; name: string }[]>`
        SELECT id, program_id, repo_url, name FROM projects
        WHERE installation_id IN (${root}, ${other}) ORDER BY submitted_at, id`;
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
          alert_state = COALESCE(o.alert_state, '{}'::jsonb) || COALESCE(r.alert_state, '{}'::jsonb)
        FROM installations o WHERE r.id = ${root} AND o.id = ${other}`;
      await tx`UPDATE installations SET builder_id = ${root} WHERE id = ${other} OR builder_id = ${other}`;
    }
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM projects WHERE installation_id = ${root}`;
    return n;
  });
}
