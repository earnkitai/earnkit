import { builderScoreEnabled } from './builder-score-flag';
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
  ownPagesSite,
  profileCode,
  pypiPackage,
  vercelSites,
  wranglerSites,
  type ContractClue,
} from './discovery-clues';
import { noteEvent } from './events';
import { loginBasisFor, repoEverDerived, type LoginProof } from './github-verify';
import { ScoreDeadline, beforeDeadline } from './campaigns';
import { fetchLinePusher } from './ownership';
import { clearXHandle, setFallback } from './profiles';
import { GitHubBudgetStop, isBudgetStop, readContractOrigin, readMergedPrs, soft, type ReaderDeps, type RepoSignals } from './source-readers';
import { claimContract, proposeSource, proveLinkedSite, rejectSource, repoOwned, siteOwnedByText, verifySource, type Proof } from './sources';
import { proofLineOwner } from './token-gate';

/**
 * v2.12 spec 3: finding a person's past work. `find` never waits on it: it records the agent's
 * clues and queues the person; the hourly cron's `discover` step (Task 6) does the reads.
 */
export type LocalGit = { emails: string[]; remotes: string[]; live_urls: string[] };

/** How many queued people one cron run's discover step reads (Task 6). */
export const DISCOVER_PER_RUN = 20;

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

/** Proposes the agent's remotes and live links as sources (never verified here); queues discovery on anything new. */
export async function noteLocalGit(builderId: number, g: LocalGit): Promise<number> {
  const db = sql();
  const rows = [
    ...g.remotes.map((r) => ({ builder_id: builderId, kind: 'repo', ref: r, project_key: r, proposed_by: 'agent' })),
    ...g.live_urls.map((u) => ({ builder_id: builderId, kind: 'site', ref: u, project_key: u, proposed_by: 'agent' })),
  ];
  if (rows.length === 0) return 0;
  const added = await db<{ id: string; kind: string; ref: string }[]>`
    INSERT INTO builder_sources ${db(rows)} ON CONFLICT (builder_id, kind, ref) DO NOTHING RETURNING id, kind, ref`;
  for (const s of added)
    await noteEvent('source_proposed', () => ({
      type: 'source_proposed', dedupe_key: `source_proposed:${s.id}`, installation_id: builderId,
      detail: { source_id: Number(s.id), kind: s.kind, by: 'agent' },
    }));
  if (added.length > 0) await enqueueDiscovery(builderId, 'local_repo', db);
  return added.length;
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

/** Who a person's GitHub login is (plan R4: a sign-in, the read-only App, or the v2.11 proof line). */
export type LoginOf = (builderId: number) => Promise<{ login: string; basis: 'signin' | 'app' | 'proof_line' } | null>;

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
export function proofLineCheck(d: ReaderDeps, deadline: number): ProofLineCheck {
  return async (installationId, repoKey) => {
    const ghFetch = d.ghFetch;
    if (!ghFetch) return null;
    if (d.ghSpent?.()) throw new GitHubBudgetStop();
    if (deadline - Date.now() < PROOF_LINE_MIN_MS) throw new ScoreDeadline();
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
 * installation of the group, through `proofLine`. Never guessed.
 */
export async function provenLogin(builderId: number, o: { proofLine?: ProofLineCheck } = {}): Promise<LoginProof | null> {
  const members = (await sql()<{ id: number }[]>`SELECT id FROM installations WHERE COALESCE(builder_id, id) = ${builderId} ORDER BY id`).map((m) => m.id);
  if (members.length === 0) return null;
  const logins = await sql()<{ login: string; via: string }[]>`
    SELECT lower(login) AS login, (array_agg(via ORDER BY verified_at DESC, id DESC))[1] AS via
    FROM github_verifications WHERE installation_id IN ${sql()(members)}
    GROUP BY lower(login) LIMIT 2`;
  if (logins.length > 1) return null;
  if (logins.length === 1) return { login: logins[0].login, basis: logins[0].via === 'app' ? 'app' : 'signin' };
  if (!o.proofLine) return null;
  const repos = await sql()<{ ref: string }[]>`
    SELECT ref FROM builder_sources WHERE builder_id = ${builderId} AND kind = 'repo' AND state = 'proposed' ORDER BY id LIMIT ${DISCOVER_CAPS.remotes}`;
  for (const { ref } of repos)
    for (const m of members) {
      const p = await o.proofLine(m, ref);
      if (p) return p;
    }
  return null;
}

type Counts = { people: number; proposed: number; verified: number };
type Row = { id: number; state: string };
type DiscoverOpts = { deadline: number; reader: ReaderDeps; login?: LoginOf; proofLine?: ProofLineCheck };

/**
 * One person's discovery (spec 3, clues 1 to 6). Every read happens first; every verdict (verify,
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
  // Post-push audit: no wallet is proven yet. A token's creator_wallet and a deploy's owner_wallet are
  // typed by the agent, so treating them as proven let anyone claim a stranger's contracts by naming its
  // deployer. A wallet will count only once it signs a message bound to this person (not built yet).
  // Contracts EarnKit deployed for this person still verify through `earnkitDeployed`.
  const proven = new Set<string>();
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

  let proof = await (o.login ?? ((id: number) => provenLogin(id, { proofLine: o.proofLine ?? proofLineCheck(d, o.deadline) })))(root);
  if (proof) {
    // One login, one person: a login another profile already holds names no one here, and once a
    // profile has its login (set once, by setFallback) a different proven login names no one either.
    const [taken] = await db`SELECT 1 FROM builder_profiles WHERE lower(github_login) = ${proof.login.toLowerCase()} AND builder_id <> ${root}`;
    const [own] = await db<{ login: string | null }[]>`SELECT lower(github_login) AS login FROM builder_profiles WHERE builder_id = ${root}`;
    if (taken || (own?.login && own.login !== proof.login.toLowerCase())) proof = null;
  }
  if (proof) {
    const L = proof.login.toLowerCase();
    const user = await d.gh<{ blog?: string | null; twitter_username?: string | null }>(`/users/${L}`);
    const clues = githubProfileClues(user ?? {});
    verdicts.unshift(async () => {
      await setFallback(root, { github_login: L });
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
    for (const r of await d.gh<ListedRepo[]>(`/users/${L}/repos?type=owner&per_page=100`)) {
      const key = r?.full_name?.toLowerCase();
      if (key) candidates.set(key, { meta: r, top: false });
    }
    const topOf = async (key: string) => {
      const c = await soft(d.gh<{ login?: string }[]>(`/repos/${key}/contributors?per_page=1`), []);
      return Array.isArray(c) && c[0]?.login?.toLowerCase() === L;
    };
    const orgs = await soft(d.gh<{ login?: string }[]>(`/users/${L}/orgs`), []);
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
      SELECT ref FROM builder_sources WHERE builder_id = ${root} AND kind = 'repo' AND state = 'proposed' ORDER BY id LIMIT ${DISCOVER_CAPS.remotes}`;
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
    // Clue 4: merged PRs to repos they don't own.
    const prProof: Proof = proof.basis === 'proof_line' ? 'proof_line' : 'github_signin';
    const orgLogins = (Array.isArray(orgs) ? orgs : []).map((o) => o?.login).filter((x): x is string => typeof x === 'string');
    for (const pr of await soft(readMergedPrs(L, d, orgLogins), [])) if (pr.url) verify(await propose('merged_pr', pr.url, 'oss'), prProof);
  }
  // Clue 6: proposed live links whose earnkit.txt names this person. v2.12 T8: also a site a repo
  // only links (shown, never scored), which the score tool's next step asks to prove the same way;
  // the repo's own Pages site already counts. The score tool lists these same sites, in this order.
  // Proposed sites first, so linked sites never crowd a new proposal out of the cap.
  const proposedSites = (await db<(Row & { ref: string; project_key: string })[]>`
    SELECT id::int AS id, state, ref, project_key FROM builder_sources
    WHERE builder_id = ${root} AND kind = 'site' AND (state = 'proposed' OR (state = 'verified' AND proof = 'repo_link'))
    ORDER BY (state = 'proposed') DESC, id`)
    .filter((s) => s.state === 'proposed' || !ownPagesSite(s.ref, s.project_key))
    .slice(0, DISCOVER_CAPS.sites);
  for (const s of proposedSites) {
    const origin = publicHttpsOrigin(s.ref);
    if (!origin || (s.state === 'proposed' && stateOf(s) !== 'proposed')) continue;
    const text = await soft(d.fetchText(`${origin}/earnkit.txt`), null);
    if (text === null || !siteOwnedByText(text, profileCode(root, origin))) continue;
    if (s.state === 'proposed') verify(s, 'earnkit_txt');
    else verdicts.push(() => proveLinkedSite(s.id));
  }
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
