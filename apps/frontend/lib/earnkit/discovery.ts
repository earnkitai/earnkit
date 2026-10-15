import { benchEnabled, builderScoreEnabled } from './builder-score-flag';
import { sql, type Db } from './db';
import {
  CLUE_PATHS,
  cnameSite,
  foundryBroadcast,
  githubProfileClues,
  githubRemote,
  hardhatDeployment,
  npmPackage,
  pagesSite,
  pypiPackage,
  vercelSites,
  wranglerSites,
  type ContractClue,
} from './discovery-clues';
import { loginBasisFor, repoEverDerived, type LoginProof } from './github-verify';
import { ScoreDeadline, beforeDeadline } from './campaigns';
import { fetchLinePusher } from './ownership';
import { loginStands } from './login-contests';
import { clearXHandle, releaseLogin, setFallback } from './profiles';
import { GitHubBudgetStop, isBudgetStop, readContractOrigin, soft, type ReaderDeps, type RepoSignals } from './source-readers';
import { claimContract, proposeSource, rejectSource, repoOwned, verifySource, type Proof } from './sources';
import { proofLineOwner } from './token-gate';
import { readGithubUser, readOwnedRepos, readPersonGithub, type PersonGithub } from './person-github';

/**
 * v2.12 spec 3: finding a person's past work. `find` never waits on it: it records the agent's
 * clues and queues the person; the hourly cron's `discover` step (Task 6) does the reads.
 */
export type LocalGit = { emails: string[]; remotes: string[]; live_urls: string[] };

/** How many queued people one cron run's discover step reads (Task 6). */
export const DISCOVER_PER_RUN = 20;
/** v2.12.2: an unproven reported login's newest owned repos proposed per person (the 25-project cap). */
export const REPORTED_REPOS_MAX = 25;

/** At most `scan` entries are looked at; strings only, trimmed, non-empty. */
const strings = (v: unknown, scan: number): string[] =>
  Array.isArray(v) ? v.slice(0, scan).filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : [];

/** A live link must be a public https site: no loopback, private, link-local or .local host. */
export function publicHttpsOrigin(u: string): string | null {
  if (u.length > 300 || !URL.canParse(u)) return null;
  const url = new URL(u);
  if (url.protocol !== 'https:') return null;
  const h = url.hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (h.startsWith('[') || h.includes(':')) return null; // any IPv6 literal (::1, fe80::, fc00::)
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  } else if (!h.includes('.') || /^[\d.]+$/.test(h) || /^0x/i.test(h)) return null; // no bare or numeric hosts
  return url.origin;
}

/** find's `local_git`, read leniently (v2.8.1 §B6 style): never throws; at most 20 remotes and 5 emails and live links. */
export function localGitInput(v: unknown): LocalGit {
  try {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const remotes = [...new Set(strings(o.remotes, 200).map(githubRemote).filter((r): r is string => !!r))].slice(0, 20);
    const emails = strings(o.emails, 50).filter((e) => /^[^@\s]{1,64}@[^@\s]{1,255}$/.test(e)).map((e) => e.toLowerCase()).slice(0, 5);
    const live_urls = [...new Set(strings(o.live_urls, 50).map(publicHttpsOrigin).filter((u): u is string => !!u))].slice(0, 5);
    return { emails, remotes, live_urls };
  } catch {
    return { emails: [], remotes: [], live_urls: [] };
  }
}

export async function enqueueDiscovery(builderId: number, reason: 'first_find' | 'wallet' | 'signin' | 'local_repo', db: Db = sql()): Promise<void> {
  // first_find is insert-only: a later find never re-opens a done entry. Only a new clue does.
  if (reason === 'first_find') {
    await db`INSERT INTO discovery_queue (builder_id, reason) VALUES (${builderId}, ${reason}) ON CONFLICT (builder_id) DO NOTHING`;
    return;
  }
  await db`
    INSERT INTO discovery_queue (builder_id, reason) VALUES (${builderId}, ${reason})
    ON CONFLICT (builder_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now(), done_at = NULL
    WHERE discovery_queue.done_at IS NOT NULL`;
}

/**
 * spec 3: a new clue (a wallet remembered at deploy, a GitHub sign-in) queues the person's discovery
 * again. Only with EARNKIT_BUILDER_SCORE=on, only for a person who already has a profile (their
 * first find queues them), never for a shared group. Never throws: the caller's step goes on.
 */
export async function enqueueClue(installationId: number, reason: 'wallet' | 'signin'): Promise<boolean> {
  if (!builderScoreEnabled()) return false;
  try {
    const [p] = await sql()<{ root: number }[]>`
      SELECT p.builder_id AS root FROM installations i
      JOIN builder_profiles p ON p.builder_id = COALESCE(i.builder_id, i.id)
      WHERE i.id = ${installationId}
        AND NOT EXISTS (SELECT 1 FROM installations s WHERE COALESCE(s.builder_id, s.id) = p.builder_id AND s.shared_client)`;
    if (!p) return false;
    await enqueueDiscovery(p.root, reason);
    return true;
  } catch (err) {
    console.error('[discovery] clue', err instanceof Error ? err.name : 'error');
    return false;
  }
}

// ---- spec 3, Task 6: the cron's discover step.

/** Who a person's GitHub login is (plan R4: a sign-in, the read-only App, the v2.11 proof line; v2.12.1 T7: the X field match). */
export type LoginOf = (builderId: number) => Promise<LoginProof | null>;

/** T7: how many of a person's signed wallets have their created contracts read per discovery. */
export const WALLET_READS = 3;
/** Per person and run: orgs looked at, repos checked per org, agent remotes checked, repos scanned for clue files, files per repo, contracts. */
export const DISCOVER_CAPS = { orgs: 3, orgRepos: 10, remotes: 5, clueRepos: 10, clueFiles: 10, contracts: 20, sites: 5 } as const;
/** A person whose discovery threw this many times is marked done until the next clue queues them. */
export const DISCOVER_MAX_ATTEMPTS = 5;

const FOUNDRY_FILE = /^broadcast\/[^/]+\/\d+\/run-latest\.json$/;
const HARDHAT_FILE = /^deployments\/[^/]+\/[^/]+\.json$/;
const REPO_KEY = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/(?!\.\.?$)[a-z0-9._-]{1,100}$/;

type ListedRepo = {
  full_name?: string; fork?: boolean; is_template?: boolean; homepage?: string | null; has_pages?: boolean;
  created_at?: string | null; pushed_at?: string | null; owner?: { login?: string; type?: string };
};

/** A repo's homepage as a public https origin ('example.com' and http:// read as https), or null. */
export function homepageOrigin(h: unknown): string | null {
  if (typeof h !== 'string' || !h.trim()) return null;
  const t = h.trim();
  return publicHttpsOrigin(/^https?:\/\//i.test(t) ? t.replace(/^http:/i, 'https:') : `https://${t}`);
}

/** The v2.11 proof-line check of one installation's repo ('owner/repo'): the proven login, or null. */
export type ProofLineCheck = (installationId: number, repoKey: string) => Promise<LoginProof | null>;
/** The proof-line check is not started with less than this much of the run left (it reads GitHub's activity log). */
export const PROOF_LINE_MIN_MS = 15_000;

/**
 * The proof-line check inside a cron run: its GitHub API reads go through the run's `ghFetch` (the
 * same budget as every other read, stopped at the same deadline), the whole check is cut at the
 * deadline, and it is not started when the budget is spent (GitHubBudgetStop) or less than
 * PROOF_LINE_MIN_MS remains (ScoreDeadline). A reader without `ghFetch` (tests) never checks.
 */
export function proofLineCheck(d: ReaderDeps, deadline: number, o: { skipShort?: boolean; onSkip?: () => void; minMs?: number } = {}): ProofLineCheck {
  return async (installationId, repoKey) => {
    const ghFetch = d.ghFetch;
    if (!ghFetch) return null;
    if (d.ghSpent?.()) throw new GitHubBudgetStop();
    if (deadline - Date.now() < (o.minMs ?? PROOF_LINE_MIN_MS)) {
      // v2.12.2: the on-demand refresh (8 s) never has PROOF_LINE_MIN_MS: it skips the check (no
      // proof from it this time; the cron's discovery still checks) instead of aborting discovery.
      if (o.skipShort) {
        o.onSkip?.();
        return null;
      }
      throw new ScoreDeadline();
    }
    const found = await beforeDeadline(
      (async () => {
        const lineOwner = await proofLineOwner(
          { installationId, repoUrl: `https://github.com/${repoKey}` },
          { pusher: (r, has, at) => fetchLinePusher(r, has, at, { everDerived: repoEverDerived, fetch: ghFetch }) },
        );
        // proofLineOwner never throws: a budget spent inside it reads as null, so ask again.
        if (d.ghSpent?.()) throw new GitHubBudgetStop();
        return lineOwner ? loginBasisFor(installationId, repoKey, { lineOwner }) : null;
      })(),
      deadline,
    );
    if (d.ghSpent?.()) throw new GitHubBudgetStop();
    return found;
  };
}

/**
 * plan R4: who the person is on GitHub. A sign-in or App verification proves that a login approved
 * a repo for an installation, not who the person is, so it names them only when every verification
 * of the group names one and the same login (two or more: none). With no verification, the v2.11
 * proof line on one of the agent's proposed repos (at most DISCOVER_CAPS.remotes), for each
 * installation of the group, through `proofLine`. v2.12.1 T7: then, for a claimed person, the login
 * their agent reported (`reported_github`) when GitHub's own X field for it (one person query through
 * `reader`) is the X handle the claim wrote (x_user_id-bound): basis `x_match`. Any other reported
 * login stays not yet confirmed. `person` receives that read, so discovery reuses it. Never guessed.
 */
export async function provenLogin(
  builderId: number,
  o: { proofLine?: ProofLineCheck; reader?: ReaderDeps; person?: (p: PersonGithub) => void } = {},
): Promise<LoginProof | null> {
  const members = (await sql()<{ id: number }[]>`SELECT id FROM installations WHERE COALESCE(builder_id, id) = ${builderId} ORDER BY id`).map((m) => m.id);
  if (members.length === 0) return null;
  const logins = await sql()<{ login: string; via: string }[]>`
    SELECT lower(login) AS login, (array_agg(via ORDER BY verified_at DESC, id DESC))[1] AS via
    FROM github_verifications WHERE installation_id IN ${sql()(members)}
    GROUP BY lower(login) LIMIT 2`;
  if (logins.length > 1) return null;
  if (logins.length === 1) return { login: logins[0].login, basis: logins[0].via === 'app' ? 'app' : 'signin' };
  if (o.proofLine) {
    const repos = await sql()<{ ref: string }[]>`
      SELECT ref FROM builder_sources WHERE builder_id = ${builderId} AND kind = 'repo' AND state = 'proposed' ORDER BY (proposed_by = 'agent') DESC, id LIMIT ${DISCOVER_CAPS.remotes}`;
    for (const { ref } of repos)
      for (const m of members) {
        const p = await o.proofLine(m, ref);
        if (p) return p;
      }
  }
  if (!o.reader) return null;
  // Only the claim-written handle: an unclaimed profile's x_handle (typed, or GitHub's prefill) never matches.
  const [p] = await sql()<{ x_handle: string | null; reported: string | null }[]>`
    SELECT x_handle, lower(reported_github) AS reported FROM builder_profiles WHERE builder_id = ${builderId} AND x_user_id IS NOT NULL`;
  if (!p?.x_handle || !p.reported || !GITHUB_LOGIN.test(p.reported)) return null;
  // A failed read proves nothing this time (a spent budget or the deadline still stops the run).
  const person = await soft((benchEnabled() ? readGithubUser : readPersonGithub)(p.reported, o.reader), null);
  if (!person || person.login !== p.reported) return null;
  o.person?.(person);
  const twitter = person.twitter?.replace(/^@/, '').toLowerCase();
  return twitter && twitter === p.x_handle.toLowerCase() ? { login: p.reported, basis: 'x_match' } : null;
}
const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

type Counts = {
  people: number; proposed: number; verified: number;
  /** v2.12.2: the proof-line check was skipped for lack of time with candidates to check (discoverPerson). */
  proofSkipped?: boolean;
};
type Row = { id: number; state: string };
type DiscoverOpts = {
  deadline: number; reader: ReaderDeps; login?: LoginOf; proofLine?: ProofLineCheck;
  /** v2.12.2: skip the proof-line check (never throw) when less than PROOF_LINE_MIN_MS remains. */
  skipShortProofLine?: boolean;
  /** v2.13 plan B4: the proof-line check's floor in place of PROOF_LINE_MIN_MS (a skip still goes to the cron). */
  proofLineMinMs?: number;
};

/**
 * One person's discovery (spec 3, clues 1, 2, 3 and 5; v2.12.1 S9 removed 4 and 6). Every read happens first; every verdict (verify,
 * reject, contract claim, the profile's login) is applied only once all reads are done, so a
 * person cut short (the deadline, a spent budget, a failed core read: all throw) leaves nothing
 * decided from partial reads. Proposals are written as found (they decide nothing).
 */
async function discoverOne(root: number, o: DiscoverOpts, out: Counts): Promise<void> {
  const d = o.reader;
  const db = sql();
  const members = (await db<{ id: number }[]>`SELECT id FROM installations WHERE COALESCE(builder_id, id) = ${root}`).map((m) => m.id);
  const group = members.length ? members : [-1];
  const verdicts: (() => Promise<void>)[] = [];
  const planned = new Map<number, string>();
  const stateOf = (row: Row) => planned.get(row.id) ?? row.state;
  const propose = async (kind: string, ref: string, key: string): Promise<Row> => {
    if ((await proposeSource({ builder_id: root, kind, ref, project_key: key, proposed_by: 'server' })) !== null) out.proposed++;
    const [row] = await db<Row[]>`SELECT id::int AS id, state FROM builder_sources WHERE builder_id = ${root} AND kind = ${kind} AND ref = ${ref}`;
    return row;
  };
  // Only a proposed source is verified: a rejected (or revoked) one stays rejected.
  const verify = (row: Row, proof: Proof) => {
    if (stateOf(row) !== 'proposed') return;
    planned.set(row.id, 'verified');
    verdicts.push(async () => {
      await verifySource(row.id, proof);
      out.verified++;
    });
  };
  const reject = (row: Row, reason: string) => {
    if (stateOf(row) === 'rejected') return;
    planned.set(row.id, 'rejected');
    verdicts.push(() => rejectSource(row.id, reason));
  };
  // Post-push audit: a token's creator_wallet and a deploy's owner_wallet are typed by the agent, so
  // they never prove anything. v2.12.1 T7: a wallet is proven only by a signature bound to this person
  // (wallet-proof.ts, person_wallets). Contracts EarnKit deployed still verify through `earnkitDeployed`.
  const signed = await db<{ wallet: string }[]>`
    SELECT wallet FROM person_wallets WHERE builder_id = ${root} ORDER BY proven_at DESC, wallet`;
  const proven = new Set(signed.map((w) => w.wallet.toLowerCase()));
  // Clue 5: contracts EarnKit deployed for this person (their own group's deploys only).
  const deploys = await db<{ chain: string; address: string; repo_key: string }[]>`
    SELECT chain, lower(address) AS address, lower(repo_key) AS repo_key FROM contract_deploys
    WHERE installation_id IN ${db(group)} AND status = 'deployed' AND address IS NOT NULL ORDER BY id`;
  const ours = new Set(deploys.map((x) => `${x.chain}:${x.address}`));
  let contracts = 0;
  const claim = async (ref: string, key: string, facts: { clue?: ContractClue; repoCreated?: string | null }) => {
    if (contracts >= DISCOVER_CAPS.contracts) return;
    contracts++;
    const row = await propose('contract', ref, key);
    if (stateOf(row) !== 'proposed') return;
    planned.set(row.id, 'claimed');
    const earnkitDeployed = ours.has(ref);
    // EarnKit's own deploys need no onchain read (the deployer is EarnKit's, never the person's).
    const origin = earnkitDeployed ? { deployer: null, created_at: null } : await soft(readContractOrigin(ref, d), { deployer: null, created_at: null });
    verdicts.push(async () => {
      const r = await claimContract(row.id, root, ref, {
        deployer: origin.deployer, created_at: origin.created_at, earnkitDeployed,
        repo: facts.clue ? { deployer: facts.clue.deployer, created_at: facts.repoCreated ?? null } : null,
      }, proven);
      if ('proof' in r) out.verified++;
    });
  };
  for (const x of deploys) await claim(`${x.chain}:${x.address}`, x.repo_key, {});
  // T7: the contracts a signed wallet created (the newest WALLET_READS wallets; Base); contractOwnership proves them deploy_wallet.
  for (const w of [...proven].slice(0, WALLET_READS))
    for (const c of await soft(d.walletCreations(w), [])) {
      const a = typeof c?.address === 'string' ? c.address.toLowerCase() : '';
      if (/^0x[0-9a-f]{40}$/.test(a)) await claim(`base:${a}`, `base:${a}`, {});
    }

  let person: PersonGithub | null = null;
  let proof = await (o.login ??
    ((id: number) => provenLogin(id, { proofLine: o.proofLine ?? proofLineCheck(d, o.deadline, { skipShort: o.skipShortProofLine, minMs: o.proofLineMinMs, onSkip: () => void (out.proofSkipped = true) }), reader: d, person: (p) => void (person = p) })))(root);
  // T7: an X field match GitHub no longer shows (twitter_username is self-declared, so it can be
  // withdrawn) stops confirming: the login and what it confirmed go back to not yet confirmed.
  const read0 = person as PersonGithub | null;
  if (!proof && read0) {
    const [held] = await db`SELECT 1 FROM builder_profiles WHERE builder_id = ${root} AND github_basis = 'x_match' AND lower(github_login) = ${read0.login}`;
    if (held) verdicts.push(async () => void (await releaseLogin(root, read0.login)));
  }
  if (proof) {
    // One login, one person: a login another profile already holds names no one here, and once a
    // profile has its login (set once, by setFallback) a different proven login names no one either.
    const [taken] = await db`SELECT 1 FROM builder_profiles WHERE lower(github_login) = ${proof.login.toLowerCase()} AND builder_id <> ${root}`;
    const [own] = await db<{ login: string | null }[]>`SELECT lower(github_login) AS login FROM builder_profiles WHERE builder_id = ${root}`;
    if (taken || (own?.login && own.login !== proof.login.toLowerCase())) proof = null;
  }
  // v2.12.1 T5 fix round 2: a contested login (two unlinked groups prove it) stands only for the group
  // the owner ruled for, or whose confirmed X is the one this GitHub profile lists (login-contests.ts).
  let read: { user: { blog?: string | null; twitter_username?: string | null } | null; clues: ReturnType<typeof githubProfileClues> } | null = null;
  if (proof) {
    const L = proof.login.toLowerCase();
    // The X field match already read this person (one query): reused, never read twice.
    const known = person as PersonGithub | null;
    const user = known && known.login === L
      ? { blog: known.website, twitter_username: known.twitter }
      : await d.gh<{ blog?: string | null; twitter_username?: string | null }>(`/users/${L}`);
    read = { user, clues: githubProfileClues(user ?? {}) };
    if (!(await loginStands(root, L, read.clues.twitter ?? null))) {
      // A login this profile shows but no longer stands for goes (with what it confirmed).
      verdicts.push(async () => void (await releaseLogin(root, L)));
      proof = null;
    }
  }
  if (proof && read) {
    const L = proof.login.toLowerCase();
    const basis = proof.basis;
    const { user, clues } = read;
    verdicts.unshift(async () => {
      await setFallback(root, { github_login: L, basis });
      // The latest GitHub read replaces the prefill (twitter_username is self-declared, so it can be
      // withdrawn); a shown X handle GitHub no longer lists is cleared (the slug falls back, the old
      // one redirects).
      if (!user || typeof user !== 'object') return; // no profile read: nothing to refresh
      const [p] = await db<{ x_handle: string | null }[]>`
        UPDATE builder_profiles SET twitter_prefill = ${clues.twitter ?? null}, updated_at = now()
        WHERE builder_id = ${root} AND github_login = ${L} RETURNING x_handle`;
      if (p?.x_handle && p.x_handle.toLowerCase() !== clues.twitter?.toLowerCase()) await clearXHandle(root, 'github');
    });
    // Clue 2: own repos, and org repos where they are the top contributor.
    const candidates = new Map<string, { meta: ListedRepo; top: boolean }>();
    // v2.13 (R2, "Cost"): under the flag no owned-repo or org listing; the main project (an agent remote) is checked below.
    if (!benchEnabled())
      for (const r of await d.gh<ListedRepo[]>(`/users/${L}/repos?type=owner&per_page=100`)) {
        const key = r?.full_name?.toLowerCase();
        if (key) candidates.set(key, { meta: r, top: false });
      }
    const topOf = async (key: string) => {
      const c = await soft(d.gh<{ login?: string }[]>(`/repos/${key}/contributors?per_page=1`), []);
      return Array.isArray(c) && c[0]?.login?.toLowerCase() === L;
    };
    const orgs = benchEnabled() ? [] : await soft(d.gh<{ login?: string }[]>(`/users/${L}/orgs`), []);
    for (const org of (Array.isArray(orgs) ? orgs : []).slice(0, DISCOVER_CAPS.orgs)) {
      if (!org?.login || !/^[A-Za-z0-9-]{1,39}$/.test(org.login)) continue;
      const repos = await soft(d.gh<ListedRepo[]>(`/orgs/${org.login}/repos?per_page=100&sort=pushed`), []);
      for (const r of (Array.isArray(repos) ? repos : []).filter((x) => !x?.fork && !x?.is_template).slice(0, DISCOVER_CAPS.orgRepos)) {
        const key = r.full_name?.toLowerCase();
        if (key && REPO_KEY.test(key) && !candidates.has(key) && (await topOf(key))) candidates.set(key, { meta: r, top: true });
      }
    }
    // The agent's remotes (R4: clues only) are checked against the proven login.
    const remotes = await db<{ ref: string }[]>`
      SELECT ref FROM builder_sources WHERE builder_id = ${root} AND kind = 'repo' AND state = 'proposed' ORDER BY (proposed_by = 'agent') DESC, id LIMIT ${DISCOVER_CAPS.remotes}`;
    for (const { ref } of remotes) {
      const key = ref.toLowerCase();
      if (candidates.has(key) || !REPO_KEY.test(key)) continue;
      const meta = await soft(d.gh<ListedRepo | null>(`/repos/${key}`), null);
      if (!meta) continue;
      candidates.set(key, { meta, top: meta.owner?.type === 'Organization' && (await topOf(key)) });
    }
    const scan: { key: string; meta: ListedRepo }[] = [];
    for (const [key, c] of candidates) {
      if (!REPO_KEY.test(key)) continue;
      const row = await propose('repo', key, key);
      const fork = c.meta.fork === true;
      const template = c.meta.is_template === true;
      const ever = await repoEverDerived(key, fork || template);
      const signals = { owner: (c.meta.owner?.login ?? key.split('/')[0]).toLowerCase(), owner_type: c.meta.owner?.type ?? 'User', fork, template } as RepoSignals;
      if (!repoOwned(signals, L, c.top, ever)) reject(row, fork || template || ever ? 'derived' : 'not_owner');
      else if (stateOf(row) !== 'rejected') {
        verify(row, 'repo_owner');
        scan.push({ key, meta: c.meta });
      }
    }
    // Clue 3: files of their newest verified repos.
    scan.sort((a, b) => String(b.meta.pushed_at ?? '').localeCompare(String(a.meta.pushed_at ?? '')));
    for (const { key, meta } of scan.slice(0, DISCOVER_CAPS.clueRepos)) {
      const [owner, name] = key.split('/');
      const sites = new Set<string>();
      const home = homepageOrigin(meta.homepage);
      if (home) sites.add(home);
      const tree = await soft(d.gh<{ tree?: { path?: string; type?: string }[] }>(`/repos/${key}/git/trees/HEAD?recursive=1`), {});
      const paths = (Array.isArray(tree?.tree) ? tree.tree : []).filter((t) => t?.type === 'blob' && typeof t.path === 'string').map((t) => t.path!);
      const has = new Set(paths);
      const want = [...CLUE_PATHS.filter((p) => has.has(p)), ...paths.filter((p) => FOUNDRY_FILE.test(p) || HARDHAT_FILE.test(p))];
      let files = 0;
      const text = async (path: string): Promise<string | null> => {
        if (files >= DISCOVER_CAPS.clueFiles) return null;
        files++;
        const f = await soft(d.gh<{ content?: unknown; encoding?: unknown }>(`/repos/${key}/contents/${path.split('/').map(encodeURIComponent).join('/')}`), null);
        return f && typeof f.content === 'string' && f.encoding === 'base64' ? Buffer.from(f.content, 'base64').toString('utf8') : null;
      };
      const found: ContractClue[] = [];
      for (const path of want) {
        if (files >= DISCOVER_CAPS.clueFiles) break;
        const t = await text(path);
        if (t === null) continue;
        if (path === 'CNAME') {
          const c = cnameSite(t);
          if (c) sites.add(c);
        } else if (path === 'vercel.json') vercelSites(t).forEach((x) => sites.add(x));
        else if (path === 'wrangler.toml') wranglerSites(t).forEach((x) => sites.add(x));
        else if (path === 'package.json') {
          const n = npmPackage(t);
          if (n) await propose('package_npm', n, key);
        } else if (path === 'pyproject.toml') {
          const n = pypiPackage(t);
          if (n) await propose('package_pypi', n, key);
        } else if (FOUNDRY_FILE.test(path)) found.push(...foundryBroadcast(path, t));
        else {
          const net = path.split('/')[1];
          const chainId = has.has(`deployments/${net}/.chainId`) ? await text(`deployments/${net}/.chainId`) : null;
          const c = hardhatDeployment(path, t, chainId);
          if (c) found.push(c);
        }
      }
      // Sites the repo links (homepage, CNAME, vercel.json, wrangler.toml) as public origins, and its
      // Pages site. Shown as theirs; only the Pages site (or an earnkit.txt line) counts as use (score).
      const linked = [...new Set([...sites].map(publicHttpsOrigin).filter((x): x is string => !!x))];
      if (meta.has_pages === true) linked.push(pagesSite(owner, name));
      for (const site of linked) verify(await propose('site', site, key), 'repo_link');
      for (const c of found) await claim(`${c.chain}:${c.address}`, key, { clue: c, repoCreated: meta.created_at ?? null });
    }
    // The GitHub profile's blog: a proposal (verified above only when a verified repo links it, or by earnkit.txt below).
    if (clues.site) {
      const blog = publicHttpsOrigin(clues.site);
      if (blog) await propose('site', blog, blog);
    }
  }
  // v2.12.2: no proven login, but the agent reported one: that login's own public repos (not forks or
  // templates, newest pushed first, at most REPORTED_REPOS_MAX) and the homepages they link are shown
  // as theirs, not yet confirmed (spec "Not yet confirmed: anything else the agent reported. Shown,
  // never scored."). Proposed only: never verified, never a merge; proving the login later verifies
  // these same rows (Clue 2). A login another profile has proven is skipped. One GraphQL call (the X
  // field check's read when there was one), only within the budget and before the deadline.
  if (!proof && !benchEnabled()) {
    const [r] = await db<{ reported: string | null }[]>`SELECT lower(reported_github) AS reported FROM builder_profiles WHERE builder_id = ${root}`;
    const L = r?.reported && GITHUB_LOGIN.test(r.reported) ? r.reported : null;
    const [taken] = L ? await db`SELECT 1 FROM builder_profiles WHERE lower(github_login) = ${L} AND builder_id <> ${root}` : [];
    // The read itself stops on a spent budget or the deadline (budgeted ghGraphql; soft rethrows both).
    if (L && !taken && Date.now() < o.deadline) {
      const known = person as PersonGithub | null;
      // The light listing (about 1 s): the full person read can take the refresh's whole 8 s.
      const gh = known && known.login === L ? known : await soft(readOwnedRepos(L, REPORTED_REPOS_MAX, d), null);
      const own = [...(gh?.repos.values() ?? [])]
        .filter((x) => !x.derived && x.private !== true && x.owner === L)
        .sort((a, b) => (b.pushed_at ?? '').localeCompare(a.pushed_at ?? ''))
        .slice(0, REPORTED_REPOS_MAX);
      let homes = 0;
      for (const x of own) {
        await propose('repo', x.key, x.key);
        const home = homepageOrigin(x.homepage);
        const site = home && publicHttpsOrigin(home);
        if (site && homes < DISCOVER_CAPS.sites) {
          homes++;
          await propose('site', site, x.key);
        }
      }
    }
  }
  // v2.12.1 S9: no merged-PR clue (4) and no earnkit.txt site check (6); existing rows stay, not confirmed.
  // Every read is done: now the verdicts.
  for (const v of verdicts) await v();
}

/**
 * spec 3, the cron's discover step: the oldest queued people (at most `limit`, DISCOVER_PER_RUN),
 * while `deadline` allows. A shared client's group is never a person (R2): marked done untouched.
 * A finished person is marked done; a thrown read leaves them queued and counts an attempt (after
 * DISCOVER_MAX_ATTEMPTS they are done until the next clue); a spent GitHub budget or the deadline
 * stops the step without counting one, and nothing is decided for the person it cut short.
 */
export async function discover(
  now: Date,
  o: { deadline: number; reader: ReaderDeps; login?: LoginOf; proofLine?: ProofLineCheck; limit?: number; only?: number[] },
): Promise<Counts> {
  void now;
  const db = sql();
  const queue = await db<{ builder_id: number }[]>`
    SELECT builder_id FROM discovery_queue WHERE done_at IS NULL
      ${o.only ? db`AND builder_id IN ${db(o.only.length ? o.only : [-1])}` : db``}
    ORDER BY queued_at, builder_id LIMIT ${o.limit ?? DISCOVER_PER_RUN}`;
  const out: Counts = { people: 0, proposed: 0, verified: 0 };
  for (const { builder_id: root } of queue) {
    if (Date.now() >= o.deadline) break;
    const [g] = await db<{ shared: boolean | null }[]>`SELECT bool_or(shared_client) AS shared FROM installations WHERE COALESCE(builder_id, id) = ${root}`;
    if (g?.shared) {
      await db`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${root}`;
      continue;
    }
    try {
      await discoverOne(root, o, out);
      await db`UPDATE discovery_queue SET done_at = now(), attempts = attempts + 1 WHERE builder_id = ${root}`;
      out.people++;
    } catch (err) {
      if (isBudgetStop(err) || err instanceof ScoreDeadline || Date.now() >= o.deadline) break;
      console.error('[discovery] person', err instanceof Error ? err.name : 'error');
      await db`
        UPDATE discovery_queue SET attempts = attempts + 1,
          done_at = CASE WHEN attempts + 1 >= ${DISCOVER_MAX_ATTEMPTS} THEN now() END
        WHERE builder_id = ${root}`;
    }
  }
  return out;
}

/**
 * v2.12.1 refresh: one person's discovery now (discoverOne with `o.deadline`). A shared client's
 * group is never a person. On success the queue row is done, as in `discover`; a thrown read
 * (deadline, spent budget, failed core read) propagates and decides nothing.
 */
export async function discoverPerson(root: number, o: DiscoverOpts): Promise<Counts> {
  const db = sql();
  const out: Counts = { people: 0, proposed: 0, verified: 0 };
  const [g] = await db<{ shared: boolean | null }[]>`SELECT bool_or(shared_client) AS shared FROM installations WHERE COALESCE(builder_id, id) = ${root}`;
  if (g?.shared) return out;
  // v2.12.2: the refresh's short budget skips the proof-line check rather than aborting discovery.
  await discoverOne(root, { skipShortProofLine: true, ...o }, out);
  if (out.proofSkipped) {
    // The skipped check is the cron's to run: the row stays open (reason 'proof_line'), so the next
    // cron discover checks the proof line; the refresh does not rerun discovery for it (person-score.ts).
    await db`
      INSERT INTO discovery_queue (builder_id, reason) VALUES (${root}, 'proof_line')
      ON CONFLICT (builder_id) DO UPDATE SET reason = 'proof_line', queued_at = now(), done_at = NULL`;
  } else {
    // A person never queued gets a done row too, so the refresh can tell when discovery last ran.
    await db`
      INSERT INTO discovery_queue (builder_id, reason, done_at) VALUES (${root}, 'first_find', now())
      ON CONFLICT (builder_id) DO UPDATE SET done_at = now()`;
  }
  out.people++;
  return out;
}
