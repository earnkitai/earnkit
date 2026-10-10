import { z } from 'zod';
import {
  CHAINS,
  CLAIMED_MAINNET,
  DEFAULT_README,
  applyBuilderFacts,
  confirmMainnets,
  creditsMainnet,
  KNOWN_TOKEN_ADDRESSES,
  TUTORIAL,
  TUTORIAL_DESCRIPTION,
  chainOfId,
  detectChains,
  earnkitOwner,
  matchRepo,
  ownerOk,
  missingSignalNote,
  productOdds,
  hasRealUse,
  oddsRank,
  productScore,
  reportedFacts,
  traction,
  withRealUse,
  pickFiles,
  type Chain,
  type Claim,
  type Detection,
  type Product,
  type ProgramFacts,
  type RepoFacts,
  type ReportedRepo,
  type TractionFacts,
  type Verdict,
} from './match';
import { openProgramFacts } from './programs';
import { loadRepoFacts, markRepoPublic, saveRepoFacts, type CachedProduct } from './repo-cache';
import { sql } from './db';
import { placeholderLink } from './placeholder';
import { githubRepo } from './campaigns';
import { repoKey } from './answer-bank';
import type { SaidRepo } from './builder-memory';
import { EARNKIT_STARTER_NAMES } from './earnkit-orgs';
import { sharedContract } from './shared-contracts';
import {
  CheckBudget,
  ENTRY_BUDGET,
  GETCODE_PER_REPO,
  LIST_BUDGET,
  contractDeployed,
  liveChecked,
  peekContract,
  peekLive,
  peekTxCount,
  rpcFor,
  txCount,
  type CheckDeps,
} from './verify';

export { repoKey } from './answer-bank';

/**
 * Reads public GitHub data with EarnKit's own token (GITHUB_TOKEN). Builders only give a
 * username or repo links; nothing of theirs is stored.
 */
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * GET from the GitHub API with EarnKit's token; `accept` for media types like star+json;
 * `onResponse` sees every response first (traction.ts reads x-ratelimit-remaining from it).
 * v2.10 item 7b: an explicit `token` (a read-only App installation token) wins over GITHUB_TOKEN.
 */
export async function gh<T>(
  path: string,
  accept = 'application/vnd.github+json',
  onResponse?: (res: Response) => void,
  token: string | undefined = process.env.GITHUB_TOKEN,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: accept,
      'User-Agent': 'earnkit',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    signal: AbortSignal.timeout(15_000),
  });
  onResponse?.(res);
  if (res.status === 404)
    throw new GitHubError(
      `GitHub: ${path.split('?')[0]} not found (or private)`,
      404,
    );
  if (!res.ok) throw new GitHubError(`GitHub request failed (${res.status})`, res.status);
  return res.json() as Promise<T>;
}

export type Repo = {
  name: string;
  full_name: string;
  html_url: string;
  homepage: string | null;
  default_branch: string;
  created_at: string;
  pushed_at: string;
  fork: boolean;
  archived: boolean;
  /** Set by GitHub on every repo read; EarnKit's token can see some private repos. */
  private?: boolean;
  visibility?: string;
  /** v2.9 A1: set on list and repo reads. */
  is_template?: boolean;
  /** v2.9 A1 (Pre-flight P49): only on a single repo read (GET /repos/{r}). */
  template_repository?: unknown;
  description?: string | null;
  topics?: string[];
  owner: { login: string };
};

/** v2.9 A1: at most this many repos are scored per call (each costs GitHub reads and checks). */
export const SCORE_LIMIT = 8;
/** v2.9 A1: repos owned by others get the 100-commit read only with this many search hits, at most 3. */
const CONTRIB_MIN_HITS = 5;
const CONTRIB_CANDIDATES = 3;
const DAY_MS = 86_400_000;

/** A repo's owner login (the full name's first part when GitHub left `owner` out). */
const ownerOf = (r: Pick<Repo, 'full_name'> & { owner?: { login: string } }) => r.owner?.login ?? r.full_name.split('/')[0];

/** v2.9 A1: a fork or a template (a copy of someone else's code): dropped before scoring. Pure. */
const copiedRepo = (r: Pick<Repo, 'fork' | 'is_template' | 'template_repository'>) =>
  r.fork || r.is_template === true || Boolean(r.template_repository);

/**
 * v2.9 A2: not original: a fork, a template, or a tutorial, course, starter or docs repo by name or
 * topic; a description counts only on strong phrases (Ruling G3: TUTORIAL_DESCRIPTION). Ruling
 * G15: a tutorial-like repo only loses the `original` point; it is never dropped for it. Pure.
 */
export const unoriginal = (r: Pick<Repo, 'name' | 'fork' | 'is_template' | 'template_repository' | 'description' | 'topics'>) =>
  copiedRepo(r) ||
  [r.name, ...(r.topics ?? [])].some((t) => TUTORIAL.test(t)) ||
  TUTORIAL_DESCRIPTION.test(r.description ?? '');

/**
 * v2.9 A1 (Ruling G15): dropped before any per-repo call: forks, templates, archived repos, EarnKit's
 * own repos, and repos neither created nor pushed in the last 365 days. A tutorial-like name or
 * topic is scored (it costs `original`), never dropped. Pure.
 */
export function droppedRepo(r: Repo, now: Date, o: { named?: boolean } = {}): boolean {
  if (notProduct(r)) return true;
  // Ruling G3: a repo the builder names is never dropped for age.
  if (o.named) return false;
  const year = now.getTime() - 365 * DAY_MS;
  return Date.parse(r.created_at) < year && Date.parse(r.pushed_at) < year;
}

const byPushed = (a: Repo, b: Repo) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at);

/**
 * v2.9 A1: the builder's repos worth scoring, most recently pushed first, at most SCORE_LIMIT: their
 * own (after the pre-filter), plus repos owned by others where ownerOk holds on their last 100
 * commits. `found` counts every repo seen, dropped ones included (Pre-flight P12).
 */
export async function userRepos(
  user: string,
  now = new Date(),
): Promise<{ repos: Repo[]; found: number; dropped: Map<string, string>; contribReads: number }> {
  const own: Repo[] = [];
  for (let page = 1; page <= 3 && own.length < REPO_LIMIT * 2; page++) {
    const batch = await gh<Repo[]>(
      `/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed&page=${page}`,
    );
    own.push(...batch);
    if (batch.length < 100) break;
  }
  const names = new Set(own.map((r) => r.full_name.toLowerCase()));
  const contributed = await contributedRepos(user, names, now);
  const repos = [...own.filter((r) => !droppedRepo(r, now)), ...contributed.repos].sort(byPushed).slice(0, SCORE_LIMIT);
  // v2.10.1 B4: each dropped repo's key with its reason, for a local report of the same repo.
  const dropped = new Map([...own.filter(notProduct), ...contributed.dropped].map((r) => [keyOf(r), droppedReason(r)] as const));
  return { repos, found: own.length + contributed.found, dropped, contribReads: contributed.reads };
}

/** Rulings G4 (I1), G15: dropped as a fork, template, archived or EarnKit repo (never by age or name). Pure. */
function notProduct(r: Repo) {
  return r.archived || copiedRepo(r) || earnkitOwner(ownerOf(r));
}
const keyOf = (r: Repo) => repoKey({ url: r.html_url, name: r.name });

/** The builder's share of a repo's last 100 commits, for ownerOk. Null when GitHub couldn't say. */
async function contribution(fullName: string, user: string, token?: string) {
  return (await contributionRead(fullName, user, token)).c;
}

/** contribution, plus whether the read failed with a 404 (private or gone) rather than a rate limit or outage. */
async function contributionRead(fullName: string, user: string, token?: string) {
  try {
    const recent = await gh<{ author?: { login?: string } | null }[]>(
      `/repos/${fullName}/commits?per_page=100`,
      undefined,
      undefined,
      token ?? process.env.GITHUB_TOKEN,
    );
    const me = user.toLowerCase();
    return { c: { userCommits: recent.filter((c) => c.author?.login?.toLowerCase() === me).length, recentCommits: recent.length }, notFound: false };
  } catch (err) {
    console.error('[match] contribution read failed:', err instanceof Error ? err.name : 'error');
    return { c: null, notFound: err instanceof GitHubError && err.status === 404 };
  }
}

/**
 * v2.9 A1: public repos owned by someone else that `user` committed to in the last year. A repo
 * counts only with 5+ search hits (at most 3 candidates, most hits first), passing the pre-filter on
 * its own read, and ownerOk on its last 100 commits. EarnKit's own repos are never read.
 */
async function contributedRepos(
  user: string,
  skip: Set<string>,
  now: Date,
): Promise<{ repos: Repo[]; found: number; dropped: Repo[]; reads: number }> {
  const since = new Date(now.getTime() - 365 * DAY_MS).toISOString().slice(0, 10);
  const q = encodeURIComponent(`author:${user} author-date:>${since}`);
  let found: { items: { repository: { full_name: string } }[] };
  try {
    found = await gh(`/search/commits?q=${q}&sort=author-date&order=desc&per_page=100`);
  } catch (err) {
    // The user's own repos still match; this only adds org/other repos. Logged by class only.
    console.error('[match] commit search failed:', err instanceof Error ? err.name : 'error');
    return { repos: [], found: 0, dropped: [], reads: 0 };
  }
  const hits = new Map<string, number>();
  for (const i of found.items) {
    const n = i.repository.full_name;
    if (skip.has(n.toLowerCase()) || n.split('/')[0].toLowerCase() === user.toLowerCase()) continue;
    hits.set(n, (hits.get(n) ?? 0) + 1);
  }
  const candidates = [...hits]
    .filter(([n, count]) => count >= CONTRIB_MIN_HITS && !earnkitOwner(n.split('/')[0]))
    .sort((a, b) => b[1] - a[1])
    .slice(0, CONTRIB_CANDIDATES);
  const dropped: Repo[] = [];
  let reads = 0;
  const repos = await Promise.all(
    candidates.map(async ([n]) => {
      const r = await repoByName(n).catch(() => null);
      if (r && notProduct(r)) dropped.push(r);
      if (!r || droppedRepo(r, now)) return null;
      reads++;
      const c = await contribution(r.full_name, user);
      return c && ownerOk(ownerOf(r), user, c) ? r : null;
    }),
  );
  return { repos: repos.filter((r) => r !== null), found: hits.size, dropped, reads };
}

/** v2.10 item 7b: `token`, an App installation token, reads a private repo the builder allowed. */
export const repoByName = (fullName: string, token?: string) =>
  gh<Repo>(`/repos/${fullName}`, undefined, undefined, token ?? process.env.GITHUB_TOKEN);

/** Whether a repo has at least one commit (GitHub answers 409 for an empty repo). */
export async function repoHasCommits(fullName: string, token?: string) {
  try {
    return (await gh<unknown[]>(`/repos/${fullName}/commits?per_page=1`, undefined, undefined, token ?? process.env.GITHUB_TOKEN)).length > 0;
  } catch (err) {
    if (err instanceof GitHubError && /\(409\)/.test(err.message)) return false;
    throw err;
  }
}

/** What the coin gate needs to know about a repo's code (Ruling 3 (plan)). */
export type RepoCode = {
  fork: boolean;
  hasCommits: boolean;
  aheadOfParent: number | null;
  /** v2.8.1 §A3: the repo's default branch, where the proof line goes (absent in older test doubles). */
  defaultBranch?: string;
  /** v2.10 Ruling H6: GitHub said `private: false` on a read without an App token. */
  public?: boolean;
};

/** The fork compare failed (ForkCheckError): the repo itself was read fine. */
export class ForkCheckError extends GitHubError {}

/**
 * Ruling 3 (plan): the public repo, its first commit, and (forks only) how far its default branch is
 * ahead of its parent's. The repo and commits reads run together, plus the compare for a fork with
 * commits. Throws GitHub's error; a private repo (which EarnKit's token may still see) throws the
 * same "not found (or private)" error as a missing one. A failed compare throws ForkCheckError.
 * v2.10 item 7b (R9): with `token` (the builder's read-only App installation token) every read goes
 * through it and a private repo is read, never refused.
 */
export async function repoCodeFacts(fullName: string, opts: { token?: string } = {}): Promise<RepoCode> {
  const token = opts.token ?? process.env.GITHUB_TOKEN;
  const [r, hasCommits] = await Promise.all([
    gh<Repo & { parent?: { full_name: string; default_branch: string } }>(`/repos/${fullName}`, undefined, undefined, token),
    repoHasCommits(fullName, token),
  ]);
  if (!opts.token && (r.private || (r.visibility !== undefined && r.visibility !== 'public')))
    throw new GitHubError(`GitHub: /repos/${fullName} not found (or private)`, 404);
  const defaultBranch = r.default_branch;
  // v2.10 Ruling H6: public evidence only from a read without an App token.
  const shown = !opts.token && r.private === false && (r.visibility === undefined || r.visibility === 'public') ? { public: true } : {};
  if (!r.fork || !r.parent || !hasCommits)
    return { fork: r.fork, hasCommits, aheadOfParent: null, defaultBranch, ...shown };
  const owner = r.full_name.split('/')[0];
  try {
    // per_page=1: only ahead_by is needed, not the commit list or the file diffs.
    const c = await gh<{ ahead_by: number }>(
      `/repos/${r.parent.full_name}/compare/${encodeURIComponent(r.parent.default_branch)}...${encodeURIComponent(owner)}:${encodeURIComponent(r.default_branch)}?per_page=1`,
      undefined,
      undefined,
      token,
    );
    return { fork: true, hasCommits, aheadOfParent: c.ahead_by, defaultBranch, ...shown };
  } catch (err) {
    throw new ForkCheckError(
      `GitHub: couldn't compare the fork with its parent (${err instanceof Error ? err.message : String(err)})`,
      err instanceof GitHubError ? err.status : undefined,
    );
  }
}

/** v2.9 A2: a root README of at least this many bytes can count (1.5 KB). */
const README_MIN_BYTES = 1536;
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

/**
 * A file from the repo's default branch, or null: raw.githubusercontent.com (no API rate limit), or
 * with `token` (v2.10 Pre-flight P10: a private repo through the App) the contents API's raw media
 * type, the only authenticated path.
 */
async function rawFile(repo: Repo, path: string, init: RequestInit = {}, token?: string) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  if (token) {
    const res = await fetch(`${API}/repos/${repo.full_name}/contents/${encoded}?ref=${encodeURIComponent(repo.default_branch)}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Accept: 'application/vnd.github.raw', 'User-Agent': 'earnkit', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    return res?.ok ? await res.text().catch(() => null) : null;
  }
  const res = await fetch(
    `https://raw.githubusercontent.com/${repo.full_name}/${encodeURIComponent(repo.default_branch)}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    { ...init, signal: AbortSignal.timeout(10_000) },
  ).catch(() => null);
  return res?.ok ? await res.text().catch(() => null) : null;
}

/**
 * Reads a handful of config-like files and detects which chains the repo targets. `complete` is
 * false when the tree or a file couldn't be read (such a result isn't cached). v2.9 A2 (plan
 * Ruling 1): also the root README's size and path (free, from the tree) and up to 2 contract
 * candidates: addresses in the files read.
 */
async function readRepoChains(repo: Repo, token?: string) {
  let complete = true;
  const tree = await gh<{
    tree: { path: string; type: string; size?: number }[];
  }>(
    `/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
    undefined,
    undefined,
    token ?? process.env.GITHUB_TOKEN,
  ).catch(() => {
    complete = false;
    return { tree: [] };
  });
  const blobs = tree.tree.filter((t) => t.type === 'blob');
  const paths = pickFiles(blobs.map((t) => ({ path: t.path, size: t.size ?? 0 })));
  const files = await Promise.all(
    paths.map(async (path) => {
      const text = await rawFile(repo, path, {}, token);
      if (text === null) complete = false;
      return { path, text: text ?? '' };
    }),
  );
  const readme = blobs.find((t) => /^readme(\.(md|markdown|txt|rst))?$/i.test(t.path)) ?? null;
  // v2.10 item 6 (R7): the root package.json's name, from the files already read (for starters).
  const pkg = files.find((f) => f.path === 'package.json');
  let packageName: string | null = null;
  try {
    const name = pkg?.text ? (JSON.parse(pkg.text) as { name?: unknown }).name : null;
    packageName = typeof name === 'string' ? name.slice(0, 200) : null;
  } catch {
    packageName = null;
  }
  const addresses = [
    ...new Set(files.flatMap((f) => f.text.match(ADDRESS) ?? []).map((a) => a.toLowerCase())),
  ]
    // Ruling G3: a known token (USDC, EURC, WETH, USDT) in a config file is not the builder's deployment.
    .filter((a) => a !== ZERO_ADDRESS && !KNOWN_TOKEN_ADDRESSES.has(a) && !sharedContract(a))
    .slice(0, GETCODE_PER_REPO);
  return {
    // v2.10 item 9: every blob path, for deploy folders (broadcast/, ignition/, deployments/).
    chains: detectChains(files, blobs.map((t) => t.path)),
    complete,
    readme: readme ? { path: readme.path, size: readme.size ?? 0 } : null,
    addresses,
    packageName,
  };
}

/**
 * v2.9 A2: `counts`: a root README of 1.5 KB or more whose first 2 KB (one raw read) is not a
 * framework's default text; null when it couldn't be read. v2.10 item 6 (Pre-flight P27): the same
 * read, also under 1.5 KB, gives the README's first `#` heading (for starters).
 */
async function readmeCounts(
  repo: Repo,
  readme: { path: string; size: number } | null,
  token?: string,
): Promise<{ counts: boolean | null; heading: string | null }> {
  if (!readme) return { counts: false, heading: null };
  const text = await rawFile(repo, readme.path, { headers: { Range: 'bytes=0-2047' } }, token);
  const head = text?.slice(0, 2048) ?? '';
  const heading = head.match(/^#[ \t]+(.+?)[ \t#]*$/m)?.[1] ?? null;
  if (readme.size < README_MIN_BYTES) return { counts: false, heading };
  return { counts: text === null ? null : !DEFAULT_README.test(head), heading };
}

/** v2.10 item 6: a name folded for comparison: lowercase, no spaces, dashes or punctuation. Pure. */
const foldName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * v2.10 item 6 (R7): a repo whose root package.json name or README first heading is one of EarnKit's
 * chain-kit examples (`names`, default EARNKIT_STARTER_NAMES), with case, spaces and dashes folded. Pure.
 */
export function starterRepo(
  r: { packageName: string | null; heading: string | null },
  names: readonly string[] = EARNKIT_STARTER_NAMES,
): boolean {
  const known = new Set(names.map(foldName).filter(Boolean));
  return [r.packageName, r.heading].some((n) => n != null && known.has(foldName(n)));
}

export const repoChains = async (repo: Repo): Promise<Detection> =>
  (await readRepoChains(repo)).chains;

/**
 * v2.10 fix round 1 (I2): who reads a cached repo row: the EarnKit installation and, on a shared
 * client, the caller's verified login (null: none; undefined: not a shared client).
 */
export type AppViewer = { installationId: number; login?: string | null };

/**
 * v2.10 fix round 1 (I2): a row read through the App (`via_app`, a private repo) reaches only the
 * installation (and on a shared client the login) that proved the repo with the App; everyone else,
 * and every read without a viewer, sees public rows only. A SQL condition on github_repo_facts.
 */
function appRowsFor(full: string, viewer: AppViewer | undefined) {
  const db = sql();
  if (!viewer || viewer.login === null) return db`NOT via_app`;
  return db`(NOT via_app OR EXISTS (
    SELECT 1 FROM github_verifications v
    WHERE v.via = 'app' AND v.purpose = 'app' AND v.used_at IS NULL AND v.repo_key = ${full}
      AND v.installation_id = ${viewer.installationId}
      ${viewer.login !== undefined ? db`AND v.login = ${viewer.login.toLowerCase()}` : db``}))`;
}

/**
 * v2.8 Ruling 29 (plan): a repo's cached chains, read from github_repo_facts only (no GitHub
 * call), for "Also qualifies" right after an entry. The latest cached row for this full name
 * (any version: a GitHub call to find the current pushed_at is exactly what this avoids), or null
 * when nothing is cached yet. Review fix round 1, item 2: credited mainnets only, the same
 * convention matchRepo uses (v2.10 item 9: `creditsMainnet`) — a chain seen only via a testnet host
 * or id, or only mentioned (a v2.9 row without `basis` reads as a mention, R6), never counts as a fit.
 */
export async function cachedRepoChains(repoFullName: string, viewer?: AppViewer): Promise<Chain[] | null> {
  const full = repoFullName.toLowerCase();
  const [row] = await sql()<{ chains: Detection }[]>`
    SELECT chains FROM github_repo_facts WHERE full_name = ${full} AND ${appRowsFor(full, viewer)}
    ORDER BY fetched_at DESC LIMIT 1`;
  if (!row) return null;
  return creditedMainnets(row.chains);
}

/**
 * v2.9 A5 (Pre-flight P4): the contract candidates found in a public repo's files by the last
 * scored read (github_repo_facts.product), read from the cache only (no GitHub call), at most
 * GETCODE_PER_REPO, lowercase. Empty when the repo isn't a GitHub link or nothing is cached.
 */
export async function cachedRepoAddresses(repoUrl: string | null | undefined, viewer?: AppViewer): Promise<string[]> {
  const gh = repoUrl ? githubRepo(repoUrl) : null;
  if (!gh) return [];
  const full = `${gh.owner}/${gh.repo}`.toLowerCase();
  const [row] = await sql()<{ product: CachedProduct | null }[]>`
    SELECT product FROM github_repo_facts WHERE full_name = ${full} AND product IS NOT NULL AND ${appRowsFor(full, viewer)}
    ORDER BY fetched_at DESC LIMIT 1`;
  return (row?.product?.addresses ?? []).map((a) => a.toLowerCase()).slice(0, GETCODE_PER_REPO);
}

/** Whether the repo has a commit at or after `since`; null when GitHub couldn't say. */
async function commitsSince(repo: Repo, since: Date, token?: string) {
  return gh<unknown[]>(
    `/repos/${repo.full_name}/commits?per_page=1&since=${since.toISOString()}`,
    undefined,
    undefined,
    token ?? process.env.GITHUB_TOKEN,
  ).then(
    (commits) => commits.length > 0,
    () => null,
  );
}

/** True if the repo has at least one commit at or after `since`. */
export const hasCommitsSince = async (repo: Repo, since: Date) =>
  (await commitsSince(repo, since)) ?? false;

/** Runs `fn` over `items` with at most `n` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<R>,
) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---- match_projects ----

const REPO_LIMIT = 30;

/** v2.8.1 §B6: testnet words in a chain an agent names ("base-sepolia", "Avalanche Fuji"). */
const TESTNET_WORDS = /\b(sepolia|testnet|fuji|moderato|devnet|goerli)\b/;
/** v2.8.1 §B6: common names agents use for a chain EarnKit knows. */
const CHAIN_ALIASES: Record<string, Chain> = { avax: 'avalanche', 'c-chain': 'avalanche' };

/**
 * v2.8.1 §B6: one chain as an agent reports it (`"base"`, `"Base Sepolia"`, or
 * `{ chain, mainnet }`), or null when EarnKit doesn't know the chain or can't read the item. A plain
 * string says mainnet only when it names no testnet; an object without `mainnet` counts as testnet
 * (never a claim EarnKit can't back). Pure; exported for tests.
 */
export function reportedChain(item: unknown): { chain: Chain; mainnet: boolean } | null {
  // Fix round 1: a chain id (8453, "84532", or { chain: 8453 }) counts as that chain and network.
  const id = typeof item === 'object' && item !== null ? (item as { chain?: unknown }).chain : item;
  if (typeof id === 'number' || (typeof id === 'string' && /^\d{1,8}$/.test(id.trim())))
    return Number.isSafeInteger(Number(id)) ? chainOfId(Number(id)) : null;
  const obj = item !== null && typeof item === 'object' ? (item as { chain?: unknown; mainnet?: unknown }) : null;
  const raw = typeof item === 'string' ? item : typeof obj?.chain === 'string' ? obj.chain : null;
  if (raw === null || raw.length > 60) return null;
  const words = raw.trim().toLowerCase().replace(/[_\s]+/g, ' ').replace(/-/g, ' ');
  const first = words.split(' ')[0] ?? '';
  const chain =
    (CHAINS as readonly string[]).includes(first)
      ? (first as Chain)
      : (CHAIN_ALIASES[raw.trim().toLowerCase()] ?? CHAIN_ALIASES[first] ?? null);
  if (!chain) return null;
  const testnet = TESTNET_WORDS.test(words);
  if (!obj) return { chain, mainnet: !testnet };
  const m = obj.mainnet;
  const mainnet = m === true || m === 'true' || (typeof m === 'string' && m.toLowerCase() === 'mainnet');
  return { chain, mainnet: mainnet && !testnet };
}

/** v2.8.1 §B6: every known chain once (mainnet wins over testnet for the same chain); unknown ones dropped. Pure. */
export function reportedChains(items: unknown[]): { chain: Chain; mainnet: boolean }[] {
  const out = new Map<Chain, boolean>();
  for (const c of items.map(reportedChain))
    if (c) out.set(c.chain, (out.get(c.chain) ?? false) || c.mainnet);
  return [...out].map(([chain, mainnet]) => ({ chain, mainnet }));
}

/**
 * v2.8.1 §B6: a commit date as an agent reports it, as ISO 8601 UTC, or undefined (dropped, never an
 * error). A date or time without a timezone counts as UTC; git's own formats parse too. Pure.
 */
export function reportedDate(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (t === '' || t.length > 100) return undefined;
  const noZone = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(t);
  const iso = noZone ? (t.length === 10 ? `${t}T00:00:00Z` : `${t.replace(' ', 'T')}Z`) : t;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** v2.8.1 §B6: a live link with or without its scheme, or undefined (dropped, never an error). Pure. */
export function reportedUrl(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (t === '' || t.length > 300 || /\s/.test(t)) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  if (!URL.canParse(withScheme)) return undefined;
  const u = new URL(withScheme);
  // v2.9 A5: a placeholder (example.com, an IP, earnkit.com) is no live link.
  if (placeholderLink(withScheme)) return undefined;
  return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? withScheme : undefined;
}

/**
 * v2.9 A5 (Pre-flight P4): contract addresses as an agent reports them: one string or a list, the
 * 0x addresses in it, lowercase, at most 2; anything else is dropped (never an error). Pure.
 */
export function reportedContracts(v: unknown): string[] | undefined {
  const items = v == null ? [] : Array.isArray(v) ? v : [v];
  const found = items
    .filter((x): x is string => typeof x === 'string' && x.length <= 300)
    .flatMap((x) => x.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? [])
    .map((x) => x.toLowerCase())
    // v2.10.1 (I1): a shared contract (a router, PoolManager, Clanker's) is never the repo's own.
    .filter((x) => !sharedContract(x));
  const out = [...new Set(found)].slice(0, 2);
  return out.length ? out : undefined;
}

/**
 * v2.8.1 §B6: what an agent reports never fails list_programs. Unknown chains, unreadable dates and
 * links are dropped per repo; unknown keys are ignored. The size limits stay (20 chains, 100-char
 * names, 300-char links).
 */
export const ReportedRepoInput = z
  .object({
    // Fix round 1: a long name is cut to 100 characters, not refused.
    name: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 100) : v), z.string().min(1)),
    /** Chains the code targets, and whether it's on mainnet (else testnet only). */
    // Fix round 1: past 20, chains are truncated (the repo is kept).
    chains: z
      .preprocess((v) => (v == null ? [] : Array.isArray(v) ? v.slice(0, 20) : [v]), z.array(z.unknown()))
      .transform(reportedChains),
    live_url: z.unknown().transform((v) => reportedUrl(typeof v === 'string' ? v : undefined)).optional(),
    last_commit_at: z.unknown().transform((v) => reportedDate(typeof v === 'string' ? v : undefined)).optional(),
    /**
     * Ruling 13 (plan): validated by `githubRepo`, never zod, so a bad url never fails the call.
     * A `.max()` would reject (not drop) an oversize one, so length is dropped the same way:
     * anything over 300 characters becomes undefined instead of a parse error.
     */
    url: z.unknown().transform((u) => (typeof u !== 'string' || u.length > 300 ? undefined : u)).optional(),
    contracts: z.unknown().transform(reportedContracts).optional(),
    /** v2.10.1 (C1): the builder's own commits in 90 days, from the local git log (author = them). */
    my_commits_90d: z
      .unknown()
      .transform((v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1000) : undefined))
      .optional(),
  });

/**
 * v2.8.1 §B6 (fix round 2): a GitHub username as an agent gives it ("@octocat",
 * "https://github.com/octocat", "github.com/octocat/"), or undefined when it can't be one (dropped,
 * never an error). Pure; exported for tests.
 */
export function reportedGithubUser(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 200) return undefined;
  const t = v
    .trim()
    .replace(/^@/, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\/.*$/, '');
  return /^[A-Za-z0-9-]{1,39}$/.test(t) ? t : undefined;
}

/**
 * v2.8.1 §B6 (fix round 2): repos as an agent gives them, with local_repos' leniency: one string or
 * a list; anything that isn't an "owner/repo" or github.com link is dropped; the first 30 are kept
 * (REPO_LIMIT). Pure; exported for tests.
 */
export function reportedRepos(v: unknown): string[] {
  const items = v == null ? [] : Array.isArray(v) ? v : [v];
  return items
    .filter((r): r is string => typeof r === 'string' && r.length <= 300)
    .map((r) => r.trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, 'https://github.com/'))
    .filter((r) => /^(?:https:\/\/github\.com\/)?[A-Za-z0-9-]+\/[A-Za-z0-9._-]+?(?:\.git)?\/?$/.test(r))
    .slice(0, REPO_LIMIT);
}

/** Fix round 1: a repo reported without a name takes its GitHub link's repo name, when it has one. Pure. */
function withName(i: unknown): unknown {
  if (typeof i === 'string') return { name: i, chains: [] };
  if (i !== null && typeof i === 'object' && typeof (i as { name?: unknown }).name === 'number')
    return { ...i, name: String((i as { name: number }).name) };
  if (i === null || typeof i !== 'object') return i;
  const r = i as { name?: unknown; url?: unknown };
  if (typeof r.name === 'string' && r.name.trim() !== '') return i;
  const m = typeof r.url === 'string' ? r.url.match(/github\.com[/:][^/\s]+\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/) : null;
  return m ? { ...r, name: m[1] } : i;
}

/**
 * v2.8.1 §B6: list_programs' local_repos. A repo EarnKit can't read (no name) is skipped, never an
 * error; past the first 20, repos are ignored (the limit stays).
 */
export const LocalReposInput = z
  .preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.unknown()))
  .transform((items) =>
    items
      .slice(0, 20)
      .flatMap((i) => {
        const r = ReportedRepoInput.safeParse(withName(i));
        return r.success ? [r.data] : [];
      }),
  );

export const MatchProjectsInput = z
  .object({
    github_user: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,39}$/, 'a GitHub username')
      .optional(),
    /** "owner/repo" or a github.com URL. */
    repos: z.array(z.string()).max(REPO_LIMIT).optional(),
    /** Private or local repos, as the agent sees them. */
    local_repos: z.array(ReportedRepoInput).max(20).optional(),
    /** v2.9 A3: what the builder told EarnKit about their repos (builder-memory.ts), by repo key. Never from an agent's input. */
    said: z.record(z.string(), z.custom<SaidRepo>()).optional(),
  })
  .strict()
  .refine((i) => i.github_user || i.repos?.length || i.local_repos?.length, {
    message: 'Give a github_user, repos, or local_repos',
  });

function fullName(ref: string) {
  const m = ref
    .trim()
    .match(
      /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
    );
  if (!m)
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['repos'],
        message: `Not a GitHub repo: ${ref}`,
        input: ref,
      },
    ]);
  return m[1];
}

/** Test and e2e seams for matchProjects; production uses the defaults. */
export type MatchDeps = {
  /** The open programs (default: openProgramFacts). */
  programs?: ProgramFacts[];
  /**
   * The repo facts cache (default: github_repo_facts). v2.10 Ruling H6: `public` records GitHub saying
   * a repo is public (default repo-cache.ts markRepoPublic; absent in a test double: nothing recorded).
   */
  cache?: { load: typeof loadRepoFacts; save: typeof saveRepoFacts; public?: (fullName: string) => Promise<void> };
  /** Link probe, getCode and url_checks cache; one LIST_BUDGET is added per call. */
  checks?: CheckDeps;
  now?: Date;
  /** v2.10 item 6 (Pre-flight P27): EarnKit's starter names (default EARNKIT_STARTER_NAMES). */
  starters?: readonly string[];
  /**
   * v2.10 item 7b (R9): an installation token for a named repo GitHub won't show (404) that the
   * caller proved with the read-only App (github-app.ts appTokenFor), else null. Absent: no App reads.
   */
  appToken?: (fullName: string) => Promise<string | null>;
};

/**
 * v2.10 item 7: a private repo matched from the agent's local report. Final fix I2 (ledger c1): with
 * the App on and no App proof for it yet, the line carries the App's link once (still one line, no
 * question).
 */
export const PRIVATE_LOCAL_LINE = (name: string, link: string | null = null) =>
  `${name} is private, so I matched it from your local copy.${link ? ` For a fuller match, allow read access: ${link}` : ''}`;
/**
 * v2.10 item 7: a named repo GitHub won't show and nobody described; `link` only with the App on (7b).
 * Final fix M5: declarative, so the reply's one question stays the lead's.
 */
export const CANT_SEE_LINE = (name: string, link: string | null) =>
  `I can't see ${name} (private?).${link ? ` Allow read access: ${link}` : ''}`;

/** The production repo cache (github_repo_facts, and repo_public_reads for H6). */
const DB_CACHE: NonNullable<MatchDeps['cache']> = { load: loadRepoFacts, save: saveRepoFacts, public: (n) => markRepoPublic(n) };

/** What scoring one repo needs: who the builder is, whether the repo counts as theirs, one shared budget. */
type ScoreCtx = {
  builder: string | null;
  owned: boolean;
  checks: CheckDeps;
  now: Date;
  cache: NonNullable<MatchDeps['cache']>;
  /** v2.9 plan Ruling 2: the local report of the same repo (it adds a live link or chains GitHub lacks). */
  local?: ReportedRepo;
  /** v2.9 A3: what the builder said about this repo, applied before the link and contract checks (Pre-flight P15). */
  said?: SaidRepo;
  /** v2.10 item 6: EarnKit's starter names (MatchDeps.starters). */
  starters?: readonly string[];
  /** v2.10 item 7b: the App installation token this repo is read through (a private repo), else absent. */
  token?: string;
  /**
   * v2.10.1 B2: GitHub couldn't say who owns this repo (a private repo of another account or an org,
   * read from the local view): `owned` is unchecked (never named, never counted), not false.
   */
  ownerUnknown?: boolean;
  /**
   * v2.11 8a (S4): GitHub hides this repo (a 404, re-review m1: never a rate limit), so a repo that is
   * a product but for the unchecked owner is asked about (odds `unknown`), never scored low.
   */
  ownerHidden?: boolean;
};

const within = (iso: string | undefined | null, days: number, now: Date) =>
  Boolean(iso) && now.getTime() - Date.parse(iso!) <= days * DAY_MS;

/**
 * The chains with any mainnet evidence, for contract candidates: a getCode pass turns a mention into
 * `deployed` (v2.10 item 9). A fit uses `creditsMainnet` chains instead.
 */
const mainnetChains = (d: Detection) =>
  Object.entries(d)
    .filter(([, v]) => v?.mainnet)
    .map(([c]) => c as Chain);
/**
 * v2.10 item 9: the mainnets only a claim or a mention backs (v2.9 rows without basis included): a
 * contract with code there is what credits them, so their getCode pairs go first. Pure.
 */
const unverifiedMainnets = (d: Detection) =>
  (Object.entries(d) as [Chain, Detection[Chain]][]).filter(([, v]) => v?.mainnet && (v.basis ?? 'mention') === 'mention').map(([c]) => c);
/** v2.10 item 9: the mainnets a fit counts (deployed, in a deploy config, or claimed). */
const creditedMainnets = (d: Detection) =>
  (Object.entries(d) as [Chain, Detection[Chain]][]).filter(([, v]) => creditsMainnet(v)).map(([c]) => c);

/** `withCode` (v2.9 A3): the mainnets where a contract candidate has code (it verifies a mainnet claim; v2.10: or a mention). */
type Deployed = {
  live: boolean;
  deployed: boolean;
  unchecked: boolean;
  withCode: Chain[];
  /** v2.10 item 6: the largest Blockscout transaction count read for the repo's contracts with code; null when none was read. */
  tx_count: number | null;
  /**
   * v2.10.1 (I1): the same, for the contracts the agent reported only (never an address a config file
   * merely mentions): what real use reads.
   */
  used_tx: number | null;
};

/** One repo ready for its link and contract checks, and how to finish its facts with their answers. */
type Prepared = {
  homepage: string | null;
  /** Up to GETCODE_PER_REPO (chain, address) pairs, on mainnets with an RPC; unverified chains first. */
  pairs: (readonly [Chain, string])[];
  /**
   * v2.9 A3: mainnets only a claim backs (v2.10 item 9: or only a mention); their contracts are
   * checked even when the live link loads, since code there is what credits them.
   */
  claimed: Chain[];
  /** v2.10.1 (I1): the contracts the agent reported (lowercase): only their counts are real use. */
  reported: string[];
  /** Async: a GitHub repo's cache row is written here, with the traction and odds of this scoring. */
  finish: (d: Deployed) => Promise<{ repo: RepoFacts; verdicts: Verdict[] }>;
};

/** v2.10 item 6: the chains with a free Blockscout (txCount). */
const countedChain = (c: Chain) => c === 'base';

/**
 * Up to GETCODE_PER_REPO (chain, address) pairs on mainnets with an RPC. v2.9 A3: a claimed chain's
 * pairs first, so its claim can be verified. v2.10 Ruling H5 (I4): one Base pair always stays inside
 * the cap (it is what a transaction count needs), in place of the last pair. Pure.
 */
const contractPairs = (addresses: string[], chains: Chain[], claimed: Chain[] = []) => {
  const all = addresses
    .flatMap((a) => chains.filter((c) => rpcFor(c)).map((c) => [c, a] as const))
    .sort(([a], [b]) => Number(claimed.includes(b)) - Number(claimed.includes(a)));
  const out = all.slice(0, GETCODE_PER_REPO);
  const base = all.find(([c]) => countedChain(c));
  if (base && out.length > 0 && !out.some(([c]) => countedChain(c))) out[out.length - 1] = base;
  return out;
};

/**
 * v2.9 A2, Ruling G5: deployed means the live link loads from here, or one of the repo's contract
 * candidates has code on a detected mainnet. `list` is in recency order. The probe slots, then the
 * getCode slots, go to the newest repos first, deterministically (cached answers take none); then
 * the checks run in parallel, each repo on its own slots. A check with no slot is `unchecked`,
 * never a failure. v2.10 item 6 (R4): then, newest repos first, Blockscout counters for the
 * contracts with code on Base, within `budget.txCounts` (cached counts take no slot); a repo's
 * `tx_count` is the largest count read. Ruling H5 (I3): a repo whose live link loads gets at most
 * one extra Base getCode (for its count), only while a count slot remains, and none when that
 * address's count is cached (the cached count is used). `budget`: LIST_BUDGET, or ENTRY_BUDGET for
 * one repo (Pre-flight P27). Never throws.
 */
async function runChecks(
  list: Prepared[],
  checks: CheckDeps,
  budget: { probes: number; getCodes: number; txCounts: number } = LIST_BUDGET,
): Promise<Deployed[]> {
  const items = list.map((p, i) => ({ p, i }));
  const livePeek = await mapLimit(items, 6, ({ p }) => (p.homepage ? peekLive(p.homepage, checks) : Promise.resolve(false)));
  let probes = budget.probes;
  const probeSlots = items.map(({ p, i }) => (p.homepage && livePeek[i] === null && probes > 0 ? (probes--, 1) : 0));
  const live = await mapLimit(items, 6, ({ p, i }) =>
    p.homepage
      ? liveChecked(p.homepage, { ...checks, budget: new CheckBudget({ probes: probeSlots[i], getCodes: 0 }) })
      : Promise.resolve(false as boolean | null),
  );
  // Ruling H5 (I3): a live repo's one Base pair worth a getCode for its count (newest first, while a
  // count slot remains), or its cached count.
  const baseOf = (p: Prepared) => p.pairs.find(([c]) => countedChain(c) && !p.claimed.includes(c));
  const cachedTx = await mapLimit(items, 6, async ({ p, i }) => {
    const pair = live[i] === true ? baseOf(p) : undefined;
    return pair ? peekTxCount(pair[0], pair[1], checks) : null;
  });
  let txLeft = budget.txCounts;
  const extra = items.map(({ p, i }) => {
    const pair = live[i] === true && cachedTx[i] === null ? baseOf(p) : undefined;
    return pair && txLeft > 0 ? (txLeft--, pair) : undefined;
  });
  // v2.9 A3: once the live link loads, only a claimed chain's contracts are still worth a check (plus the extra Base pair).
  const pairsOf = (p: Prepared, i: number) =>
    live[i] === true ? p.pairs.filter((pair) => p.claimed.includes(pair[0]) || pair === extra[i]) : p.pairs;
  const codePeek = await mapLimit(items, 6, ({ p, i }) => Promise.all(pairsOf(p, i).map(([c, a]) => peekContract(c, a, checks))));
  let getCodes = budget.getCodes;
  const codeSlots = codePeek.map((peeks) =>
    peeks.reduce((n, v) => (v === null && getCodes > 0 ? (getCodes--, n + 1) : n), 0),
  );
  const done = await mapLimit(items, 6, async ({ p, i }) => {
    const slots = new CheckBudget({ probes: 0, getCodes: codeSlots[i] });
    const withCode: Chain[] = [];
    const counted: string[] = [];
    let deployed = live[i] === true;
    let unchecked = live[i] === null;
    for (const pair of pairsOf(p, i)) {
      const [chain, address] = pair;
      // Deployed already: only an unverified claimed chain, or the extra Base pair (its count), is still worth a check.
      if (deployed && pair !== extra[i] && (!p.claimed.includes(chain) || withCode.includes(chain))) continue;
      const r = await contractDeployed(chain, address, { ...checks, budget: slots });
      if (r === true) {
        deployed = true;
        if (!withCode.includes(chain)) withCode.push(chain);
        if (countedChain(chain)) counted.push(address);
      } else if (r === null) unchecked = true;
    }
    return { live: live[i] === true, deployed, unchecked: !deployed && unchecked, withCode, counted };
  });
  // v2.10 item 6 (R4): one shared budget, newest repos first (sequential, so the order is deterministic).
  const txSlots = new CheckBudget({ probes: 0, getCodes: 0, txCounts: budget.txCounts });
  const out: Deployed[] = [];
  for (const [i, { counted, ...d }] of done.entries()) {
    let tx: number | null = cachedTx[i];
    // v2.10.1 (I1): a cached count is real use only when its address is one the agent reported.
    const cachedPair = live[i] === true ? baseOf(items[i].p) : undefined;
    let used: number | null = cachedTx[i] !== null && cachedPair && items[i].p.reported.includes(cachedPair[1]) ? cachedTx[i] : null;
    for (const address of counted) {
      const n = await txCount('base', address, { ...checks, budget: txSlots });
      if (n !== null) tx = Math.max(tx ?? 0, n);
      if (n !== null && items[i].p.reported.includes(address)) used = Math.max(used ?? 0, n);
    }
    out.push({ ...d, tx_count: tx, used_tx: used });
  }
  return out;
}

/**
 * v2.10 item 8: the repo's commits in the last 90 days (one read, at most 100), by any author; by
 * `author` only for a repo someone else owns (v2.9 A1 contribution rule). Null when GitHub couldn't say.
 */
async function commitsRead(repo: Repo, now: Date, author: string | null, token?: string): Promise<number | null> {
  const since = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  return gh<unknown[]>(
    `/repos/${repo.full_name}/commits?since=${since}&per_page=100${author ? `&author=${encodeURIComponent(author)}` : ''}`,
    undefined,
    undefined,
    token ?? process.env.GITHUB_TOKEN,
  ).then(
    (c) => Math.min(c.length, 100),
    () => null,
  );
}

/**
 * Adds the chains a local report names that GitHub's files don't show. Plan Ruling 2: a mainnet
 * GitHub's files don't show is a claim (CLAIMED_MAINNET), like the builder's own word. v2.10
 * Pre-flight P8: also over a chain the files only mention.
 */
function withReportedChains(chains: Detection, local?: ReportedRepo): Detection {
  if (!local) return chains;
  const out: Detection = { ...chains };
  for (const c of local.chains) {
    if (c.mainnet && out[c.chain] && !creditsMainnet(out[c.chain]))
      out[c.chain] = { ...out[c.chain]!, mainnet: true, evidence: CLAIMED_MAINNET, basis: 'mention' };
    else
      out[c.chain] ??= {
        mainnet: c.mainnet,
        testnet: !c.mainnet,
        evidence: c.mainnet ? CLAIMED_MAINNET : 'reported by the agent',
        basis: 'mention',
      };
  }
  return out;
}

/**
 * v2.9 A3, Pre-flight P15: the builder's statements over a repo's facts, before the link and
 * contract checks, so a claimed live link is probed like a homepage (one LIST_BUDGET). A repo the
 * builder said isn't theirs never gets here (matchProjects drops it). Pure.
 */
function said(f: RepoFacts, s: SaidRepo | undefined): RepoFacts & { claims: Claim[] } {
  return applyBuilderFacts(f, s ? { ...s, not_mine: false } : undefined)!;
}

/**
 * One repo's facts, its real-product score and its verdicts against the given programs. The repo's
 * own facts (chains, commits since a window, and its product signals: young, original, README,
 * contract candidates) come from the hour-long cache for this repo version (pushed_at) when
 * present; only complete reads are cached. owned, active and deployed are worked out on every call
 * (Pre-flight P6): one commits read for active, and the link and contract checks (url_checks).
 */
async function checkRepo(repo: Repo, programs: ProgramFacts[], ctx: ScoreCtx): Promise<Prepared> {
  // v2.10 fix round 1 (I2): an App-read row only for a read through the App itself.
  const cached = await ctx.cache.load(repo.full_name, repo.pushed_at, { viaApp: ctx.token !== undefined });
  // v2.10 Ruling H6: GitHub said this repo is public (a read without an App token).
  if (!ctx.token && repo.private === false && (repo.visibility === undefined || repo.visibility === 'public'))
    await ctx.cache.public?.(repo.full_name);
  let changed = false;
  let cacheable = true;
  let chains = cached?.chains;
  let own: CachedProduct | null | undefined = cached?.product;
  // v2.10 item 6: a row cached before starters were read is read again.
  const reread = !chains || !own || own.starter === undefined;
  if (reread) {
    const read = await readRepoChains(repo, ctx.token);
    chains = read.chains;
    cacheable = read.complete;
    const readme = await readmeCounts(repo, read.readme, ctx.token);
    if (readme.counts === null) cacheable = false;
    // v2.10 item 6 (R7): an EarnKit chain-kit example loses `original`.
    const starter = starterRepo({ packageName: read.packageName, heading: readme.heading }, ctx.starters);
    own = {
      young: within(repo.created_at, 365, ctx.now),
      original: !unoriginal(repo) && !starter,
      readme: readme.counts === true,
      addresses: read.addresses,
      starter,
    };
    changed = true;
  }
  const files: CachedProduct = own!;
  const readChains: Detection = chains!;
  const commitsSinceKnown = { ...cached?.commits_since };
  const commits_in_window: Record<string, boolean> = {};
  for (const p of programs) {
    if (
      p.existing_work === 'new_work_only' &&
      p.starts_at &&
      (p.any_chain || p.chains.some((c) => readChains[c]))
    ) {
      const key = p.starts_at.toISOString();
      if (!(key in commitsSinceKnown)) {
        const has = await commitsSince(repo, p.starts_at, ctx.token);
        if (has === null) cacheable = false;
        else {
          commitsSinceKnown[key] = has;
          changed = true;
        }
      }
      commits_in_window[p.id] = commitsSinceKnown[key] ?? false;
    }
  }
  // Written in finish, with this scoring's traction and odds (one write, only when something changed).
  const save = (scored: Pick<CachedProduct, 'traction' | 'odds'>) =>
    cacheable && (changed || files.traction !== scored.traction || files.odds !== scored.odds)
      ? ctx.cache.save(
          repo.full_name,
          repo.pushed_at,
          // v2.10 R10: a row read through the App is private (never shown on public pages).
          { chains: readChains, commits_since: commitsSinceKnown, product: { ...files, ...scored }, via_app: ctx.token !== undefined },
          reread || !cached ? undefined : cached.fetched_at,
        )
      : Promise.resolve();

  // v2.9 A5: a placeholder homepage is no homepage. Plan Ruling 2: GitHub's wins, else the local
  // link, which is a claim (like a mainnet only the local report names).
  const ownHomepage = repo.homepage && !placeholderLink(repo.homepage) ? repo.homepage : null;
  const reported = withReportedChains(readChains, ctx.local);
  const claims: Claim[] = [
    ...(!ownHomepage && ctx.local?.live_url ? (['live'] as const) : []),
    ...(Object.values(reported).some((c) => c?.mainnet && c.evidence === CLAIMED_MAINNET) ? (['mainnet'] as const) : []),
  ];
  const base = said(
    {
      name: repo.name,
      url: repo.html_url,
      homepage: ownHomepage ?? ctx.local?.live_url ?? null,
      created_at: repo.created_at,
      chains: reported,
      commits_in_window,
      claims,
    },
    ctx.said,
  );
  const { homepage, chains: allChains } = base;
  const claimed = unverifiedMainnets(allChains);
  // v2.10 item 8: on an owned repo, a commit by any author in 90 days, or a push in 90 days (also
  // when the read is empty: commits with an unlinked email or old dates). Pre-flight P28: the read
  // also runs without a known builder. Ruling H1 (c3): on a repo someone else owns, only the
  // builder's own commits count (v2.9 A1), with no pushed_at fallback.
  const author = ctx.builder && ownerOf(repo).toLowerCase() !== ctx.builder.toLowerCase() ? ctx.builder : null;
  const commits_90d = await commitsRead(repo, ctx.now, author, ctx.token);
  const active = (commits_90d ?? 0) > 0 || (!author && within(repo.pushed_at, 90, ctx.now));
  const signals = { active, young: files.young || active, original: files.original, readme: files.readme, owned: ctx.owned };
  return {
    homepage,
    // v2.10.1 (I1): the agent's reported contracts first, so the one Base pair kept is theirs.
    pairs: contractPairs([...new Set([...(ctx.local?.contracts ?? []), ...files.addresses])], mainnetChains(allChains), claimed),
    claimed,
    reported: ctx.local?.contracts ?? [],
    finish: async ({ live, deployed, unchecked, withCode, tx_count, used_tx }) => {
      const product = scored(productScore({ ...signals, deployed }, unchecked ? ['deployed'] : []), { tx_count, live_ok: live, commits_90d }, used_tx, base.claims.includes('users'));
      await save({ traction: product.traction, odds: product.odds });
      const facts: RepoFacts = { ...confirmMainnets(base, withCode), product, live_verified: live, commits_90d, tx_count: used_tx, users_said: ctx.said?.has_users ?? null };
      return { repo: facts, verdicts: matchRepo(facts, programs) };
    },
  };
}

/**
 * v2.10 item 6: a product score with its traction and odds (productOdds). v2.10.1 B2: measured real
 * use makes it a product first (withRealUse), so polish never outweighs use. Pure.
 */
function scored(p: Product, t: TractionFacts, usedTx: number | null, usersClaim: boolean, hidden: { ownerHidden?: boolean; saidNoUsers?: boolean } = {}): Product {
  const score = traction(t);
  // v2.10.1 (C1 b): the builder's users claim is real use once the live link loads and there is a commit in 90 days.
  // v2.11 8a: on a repo GitHub hides, an active repo (last commit in 90 days, or no date sent, Ruling
  // G3) is enough, so the yes never relies on an optional field the agent may not send.
  const recent = (t.commits_90d ?? 0) > 0 || (hidden.ownerHidden === true && !p.missing.includes('active'));
  const used = withRealUse(p, usedTx, usersClaim && t.live_ok && recent);
  return { ...used, traction: score, ...productOdds(used, t, score, hidden) };
}

/**
 * v2.9 A2 (plan Ruling 1): a local repo's score. EarnKit never reads its code, so `readme` is false;
 * active is a last commit within 90 days, or no date given (Ruling G3; young follows it); original
 * reads the name only.
 */
function checkLocal(r: ReportedRepo, programs: ProgramFacts[], ctx: Pick<ScoreCtx, 'owned' | 'now' | 'said' | 'ownerUnknown' | 'ownerHidden'>): Prepared {
  const facts = said(reportedFacts(r, programs), ctx.said);
  const claimed = unverifiedMainnets(facts.chains);
  // Ruling G3: an unknown last commit counts as active (the agent is asked to send it).
  const active = r.last_commit_at === undefined || within(r.last_commit_at, 90, ctx.now);
  return {
    homepage: facts.homepage,
    pairs: contractPairs(r.contracts ?? [], mainnetChains(facts.chains), claimed),
    claimed,
    reported: r.contracts ?? [],
    finish: async ({ live, deployed, unchecked, withCode, tx_count, used_tx }) => {
      // Review M9: EarnKit never reads a local repo's README, so it is never named as missing.
      // v2.10 R3: EarnKit never reads its commits either: a last commit within 90 days is band 1.
      // v2.10.1 (C1 a): the builder's own count from the local git log, when the agent sends it.
      // Re-review m2: only for the builder's own repo; else the last-commit band.
      // v2.11 8a: no date sent is unknown (null, scores 0, never "no commits in 90 days"), as Ruling G3 reads it.
      const band = r.last_commit_at === undefined ? null : within(r.last_commit_at, 90, ctx.now) ? 1 : 0;
      const commits_90d = ctx.owned ? (r.my_commits_90d ?? band) : band;
      const product = scored(
        productScore(
          { active, young: active, original: !TUTORIAL.test(r.name), readme: false, deployed, owned: ctx.owned },
          // v2.10.1 B2: an owner GitHub couldn't name is unchecked, never "not your repo".
          [...(unchecked ? (['deployed', 'readme'] as const) : (['readme'] as const)), ...(ctx.ownerUnknown ? (['owned'] as const) : [])],
        ),
        { tx_count, live_ok: live, commits_90d },
        used_tx,
        facts.claims.includes('users'),
        { ownerHidden: ctx.ownerHidden === true, saidNoUsers: ctx.said?.has_users === false },
      );
      const repo: RepoFacts = { ...confirmMainnets(facts, withCode), product, live_verified: live, commits_90d, tx_count: used_tx, users_said: ctx.said?.has_users ?? null };
      return { repo, verdicts: matchRepo(repo, programs) };
    },
  };
}

/** A repo to score: from GitHub (with any local report of the same repo), or local only. */
type Candidate =
  | { key: string; github: Repo; owned: boolean; local?: ReportedRepo; token?: string; ownerUnknown?: undefined; ownerHidden?: undefined }
  | { key: string; github?: undefined; owned: boolean; local: ReportedRepo; token?: undefined; ownerUnknown?: boolean; ownerHidden?: boolean };

const recency = (c: Candidate) => Date.parse(c.github?.pushed_at ?? c.local?.last_commit_at ?? '') || 0;

/**
 * Checks a builder's repos (public on GitHub, or reported by the agent) against open programs.
 * v2.9 A1, A2: only the builder's own repos (never EarnKit's, a fork, a template or an archived
 * repo; a tutorial-like one is scored without `original`, Ruling G15), one per repo key, the
 * SCORE_LIMIT most recent scored, under one LIST_BUDGET of link and contract checks. `checked`
 * counts every repo found (dropped ones too); `scored` the ones scored.
 */
export async function matchProjects(input: z.infer<typeof MatchProjectsInput>, deps: MatchDeps = {}) {
  const now = deps.now ?? new Date();
  const programs = deps.programs ?? (await openProgramFacts());
  const builder = input.github_user ?? null;
  let found = 0;
  const github: { repo: Repo; owned: boolean; token?: string }[] = [];
  // Ruling G4: keys dropped as a fork, template or archived repo stay dropped when the
  // same repo comes back through local_repos; the 100-commit reads share one cap of 3.
  let dropped = new Map<string, string>();
  let contribReads = 0;
  // v2.10 item 7: named repos GitHub won't show (404): read through the App, else matched from a
  // local report (`fromLocal`), else `unseen`. `skipLocal`: keys whose read failed another way.
  const notFound: string[] = [];
  const skipLocal = new Set<string>();
  // v2.10.1 B4: every repo the agent named (repos or local_repos) that gets no row says why, once.
  const skipped = new Map<string, { name: string; reason: string }>();
  const skip = (key: string, name: string, reason: string) => {
    if (!skipped.has(key)) skipped.set(key, { name, reason });
  };
  const tokens = new Map<string, string>();
  if (input.repos?.length) {
    const names = input.repos.map(fullName);
    found += names.length;
    // v2.10 item 7: each repo read is caught on its own, so one private repo never fails the rest.
    for (const n of names.filter((n) => earnkitOwner(n.split('/')[0]))) skip(namedKey(n), n.split('/')[1], SKIP_REASONS.earnkit);
    const settled = await mapLimit(
      names.filter((n) => !earnkitOwner(n.split('/')[0])),
      6,
      (n) => repoByName(n).then((r) => ({ n, r }), (err: unknown) => ({ n, err })),
    );
    const read: Repo[] = [];
    for (const s of settled) {
      if ('r' in s) {
        read.push(s.r);
        continue;
      }
      if (!(s.err instanceof GitHubError && s.err.status === 404)) {
        // Review Focus 1: a rate limit or outage is not "private": skipped, and its local view too.
        skipLocal.add(namedKey(s.n));
        skip(namedKey(s.n), s.n.split('/')[1], SKIP_REASONS.github);
        continue;
      }
      const token = (await deps.appToken?.(s.n).catch(() => null)) ?? null;
      const viaApp = token ? await repoByName(s.n, token).catch(() => null) : null;
      if (token && viaApp) {
        read.push(viaApp);
        tokens.set(viaApp.full_name.toLowerCase(), token);
      } else notFound.push(s.n);
    }
    // Every named repo failed, and none was a 404: GitHub itself failed (today's "Couldn't read" line).
    const firstErr = settled.find((s): s is { n: string; err: unknown } => 'err' in s)?.err;
    if (settled.length > 0 && settled.every((s) => 'err' in s && !(s.err instanceof GitHubError && s.err.status === 404)))
      throw firstErr;
    dropped = new Map(read.filter(notProduct).map((r) => [keyOf(r), droppedReason(r)] as const));
    for (const r of read.filter(notProduct)) skip(keyOf(r), r.name, droppedReason(r));
    const unread = read.filter((r) => !droppedRepo(r, now, { named: true })).sort(byPushed);
    for (const r of unread.slice(SCORE_LIMIT)) skip(keyOf(r), r.name, SKIP_REASONS.limit);
    const kept = unread.slice(0, SCORE_LIMIT);
    // Pre-flight P28: without a builder, a named repo counts like a local one (owned unless EarnKit's).
    for (const r of kept) {
      const owner = ownerOf(r);
      let owned = !builder || ownerOk(owner, builder);
      const token = tokens.get(r.full_name.toLowerCase());
      if (builder && !owned && contribReads++ < CONTRIB_CANDIDATES) {
        // v2.10 item 7b: a private repo read through the App is read through it here too.
        const c = await contribution(r.full_name, builder, token);
        owned = c !== null && ownerOk(owner, builder, c);
      }
      github.push({ repo: r, owned, token });
    }
  } else if (builder) {
    const mine = await userRepos(builder, now);
    found += mine.found;
    dropped = mine.dropped;
    contribReads = mine.contribReads;
    github.push(...mine.repos.map((repo) => ({ repo, owned: true })));
  }

  const candidates = new Map<string, Candidate>();
  for (const g of github) {
    const key = repoKey({ url: g.repo.html_url, name: g.repo.name });
    if (!candidates.has(key)) candidates.set(key, { key, github: g.repo, owned: g.owned, token: g.token });
  }
  for (const r of input.local_repos ?? []) {
    found++;
    const gh = r.url ? githubRepo(r.url) : null;
    const key = repoKey({ url: r.url, name: r.name });
    if (gh && earnkitOwner(gh.owner)) {
      skip(key, r.name, SKIP_REASONS.earnkit);
      continue;
    }
    // v2.10.1 B4: a local repo GitHub showed as a fork, template, archived or EarnKit's says why.
    if (dropped.has(key)) skip(key, r.name, dropped.get(key)!);
    if (dropped.has(key) || skipLocal.has(key)) continue;
    const known = candidates.get(key);
    if (known) {
      known.local ??= r;
      continue;
    }
    // Plan Ruling 1: a local repo is the builder's unless its GitHub link names another owner. Ruling
    // G4 (I3): then it gets the same 100-commit read (within the shared cap of 3). Ruling G5: fail
    // closed, so a repo GitHub won't show (private) is not owned and caps at project tier.
    let owned = !gh || !builder || gh.owner.toLowerCase() === builder.toLowerCase();
    // v2.10.1 B2: GitHub couldn't say (a private org repo): not owned, but unchecked, never "not your repo".
    let ownerUnknown = false;
    let hidden = false;
    if (gh && builder && !owned && contribReads++ < CONTRIB_CANDIDATES) {
      const { c, notFound } = await contributionRead(`${gh.owner}/${gh.repo}`, builder);
      owned = c !== null && ownerOk(gh.owner, builder, c);
      ownerUnknown = c === null;
      hidden = notFound;
      // v2.10.1 (C1 a): GitHub can't say, but the local git log shows the builder's own recent
      // commits: owned for matching, as a readable repo with their commits would be. Matching only:
      // the launch, deploy, entry and bonus gates keep their own proofs. Re-review m1: only when
      // GitHub hides the repo (404); a rate limit or outage on a public repo stays unchecked.
      if (ownerUnknown && notFound && (r.my_commits_90d ?? 0) > 0) {
        owned = true;
        ownerUnknown = false;
      }
    }
    // v2.11 8a (S4): only a 404 makes the repo unknown (asked about); a rate limit stays low.
    candidates.set(key, { key, owned, local: r, ...(ownerUnknown && { ownerUnknown, ownerHidden: hidden }) });
  }
  // v2.9 A3: what the builder said, by repo key (else by the repo's name); a repo they said isn't
  // theirs is never scored (it still counts in `checked`).
  const saidOf = (c: Candidate) => {
    const name = c.github?.name ?? c.local?.name ?? '';
    return input.said?.[c.key] ?? input.said?.[repoKey({ name })];
  };
  const ranked = [...candidates.values()].filter((c) => !saidOf(c)?.not_mine).sort((a, b) => recency(b) - recency(a));
  const toScore = ranked.slice(0, SCORE_LIMIT);
  // v2.10.1 B4: only repos the agent named say why (a GitHub user's whole list never does).
  const named = (c: Candidate) => Boolean(c.local) || Boolean(input.repos?.length);
  for (const c of ranked.slice(SCORE_LIMIT)) if (named(c)) skip(c.key, c.github?.name ?? c.local!.name, SKIP_REASONS.limit);

  const checks: CheckDeps = { ...deps.checks, now };
  const cache = deps.cache ?? DB_CACHE;
  // The reads run in parallel; then one LIST_BUDGET of checks, newest repos first (Ruling G5).
  const prepared = await mapLimit(toScore, 6, async (c) => {
    const ctx: ScoreCtx = { builder, owned: c.owned, checks, now, cache, local: c.local, said: saidOf(c), starters: deps.starters, token: c.token, ownerUnknown: c.ownerUnknown, ownerHidden: c.ownerHidden };
    return c.github ? checkRepo(c.github, programs, ctx) : checkLocal(c.local, programs, ctx);
  });
  const deployed = await runChecks(prepared, checks);
  const results = await Promise.all(prepared.map(async (p, i) => ({ key: toScore[i].key, ...(await p.finish(deployed[i])) })));
  // Builders want what can earn: "no" verdicts and repos with only those are left out.
  const fits = results
    .map((r) => ({
      key: r.key,
      repo: r.repo.name,
      repo_url: r.repo.url || null,
      // v2.8 Ruling 10 (plan): the repo's mainnet chains, for new program alerts (fit_chains);
      // testnet-only never counts as a fit (review minor 6, as cachedRepoChains).
      // v2.10 Pre-flight P8: credited mainnets only (a mention gives no fit).
      chains: creditedMainnets(r.repo.chains),
      verdicts: r.verdicts.filter((v) => v.status !== 'no'),
      product: r.repo.product as Product,
      live_verified: r.repo.live_verified === true,
      // Pre-flight P13: the merged facts, for later steps (fit repos for alerts).
      facts: r.repo,
    }))
    .filter((r) => r.verdicts.length > 0)
    // v2.10 item 6 (Pre-flight P12): good odds first, then traction, then likely first, then the score.
    // v2.11 8a (S5): odds (good, unknown, low), then real use (measured or claimed), then traction.
    .sort(
      (a, b) =>
        oddsRank(a.product.odds) - oddsRank(b.product.odds) ||
        Number(hasRealUse(b.facts)) - Number(hasRealUse(a.facts)) ||
        (b.product.traction ?? 0) - (a.product.traction ?? 0) ||
        Number(!a.verdicts.some((v) => v.status === 'likely')) -
          Number(!b.verdicts.some((v) => v.status === 'likely')) || b.product.score - a.product.score,
    );
  // v2.10 item 7: a 404'd named repo the agent reported locally was scored from that report (one
  // line each); one with no report is never dropped silently (`unseen`).
  const fromLocal: { name: string; full_name: string }[] = [];
  const unseen: { name: string; full_name: string }[] = [];
  for (const n of notFound) {
    const c = candidates.get(namedKey(n));
    if (c && !c.github && c.local) {
      if (!saidOf(c)?.not_mine && toScore.includes(c)) fromLocal.push({ name: c.local.name, full_name: n });
    } else if (!c) unseen.push({ name: n.split('/')[1], full_name: n });
  }
  // v2.10.1 B4: a scored repo the agent named with no row left: why, in a few words.
  for (const r of results)
    if (!fits.some((f) => f.key === r.key) && named(candidates.get(r.key)!)) skip(r.key, r.repo.name, noFitReason(r.repo));
  // The can't-see line names the first unseen repo; every other one is listed here (never dropped).
  for (const u of unseen.slice(1)) skip(namedKey(u.full_name), u.name, SKIP_REASONS.unseen);
  return { checked: found, scored: results.length, fits, unseen, fromLocal, skipped: [...skipped.values()] };
}

/**
 * v2.10.1 B4: why a repo the agent named gets no row, in a few builder words (the "Not matched:"
 * line, present.ts skippedLine). Never a tool name.
 */
export const SKIP_REASONS = {
  earnkit: "EarnKit's own repo",
  fork: 'a fork',
  template: 'a template',
  archived: 'archived',
  github: "GitHub didn't answer, ask me again in a minute",
  limit: `only the ${SCORE_LIMIT} newest repos are checked`,
  unseen: "private, and I can't see it",
  noChain: 'no onchain code found',
  noProduct: 'not enough signs of a real product yet',
  noFit: 'no open program fits it yet',
} as const;

/** v2.10.1 B4: a dropped repo's reason (notProduct). Pure. */
const droppedReason = (r: Repo) =>
  earnkitOwner(ownerOf(r)) ? SKIP_REASONS.earnkit : r.archived ? SKIP_REASONS.archived : r.fork ? SKIP_REASONS.fork : SKIP_REASONS.template;

/** v2.10.1 B4: a scored repo with no row: no chain at all, too little product, else nothing open fits. Pure. */
const noFitReason = (f: RepoFacts) =>
  Object.keys(f.chains).length === 0 ? SKIP_REASONS.noChain : f.product?.tier === 'noise' ? SKIP_REASONS.noProduct : SKIP_REASONS.noFit;

/** A named repo's key (answer-bank.ts repoKey), as a local report of the same repo gets it. */
const namedKey = (n: string) => repoKey({ url: `https://github.com/${n}`, name: n.split('/')[1] });

/** get_program's eligibility check: one repo against one open program (scored, owned unless EarnKit's). */
export async function checkEligibility(ref: string, programId: string, deps: MatchDeps = {}) {
  const program = (deps.programs ?? (await openProgramFacts())).find((p) => p.id === programId);
  if (!program) return null;
  const repo = await repoByName(fullName(ref));
  const now = deps.now ?? new Date();
  const checks: CheckDeps = { ...deps.checks, now };
  const prepared = await checkRepo(repo, [program], {
    builder: null,
    owned: !earnkitOwner(ownerOf(repo)),
    checks,
    now,
    cache: deps.cache ?? DB_CACHE,
    starters: deps.starters,
  });
  // v2.10 R4 (Pre-flight P27): one repo, one ENTRY_BUDGET (1 Blockscout read).
  const { repo: facts, verdicts } = await prepared.finish((await runChecks([prepared], checks, ENTRY_BUDGET))[0]);
  const [v] = verdicts;
  if (!v)
    return {
      status: 'no' as const,
      missing: [],
      effort: null,
      note:
        facts.product && program.any_chain && facts.product.tier === 'product' && (facts.product.missing ?? []).includes('original')
          ? 'looks like a copy or tutorial'
          : facts.product && facts.product.tier !== 'product' && (program.any_chain || program.chains.some((c) => facts.chains[c]))
          ? (missingSignalNote(facts.product) ?? 'not enough signs of a real product yet')
          : `no ${program.chains.join(' or ')} code found in this repo`,
    };
  return {
    status: v.status,
    missing: v.missing,
    effort: v.effort,
    note: v.note,
  };
}
