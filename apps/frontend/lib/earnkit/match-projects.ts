import { z } from 'zod';
import {
  CHAINS,
  DEFAULT_README,
  KNOWN_TOKEN_ADDRESSES,
  TUTORIAL,
  TUTORIAL_DESCRIPTION,
  chainOfId,
  detectChains,
  earnkitOwner,
  matchRepo,
  ownerOk,
  missingSignalNote,
  productScore,
  reportedFacts,
  pickFiles,
  type Chain,
  type Detection,
  type Product,
  type ProgramFacts,
  type RepoFacts,
  type ReportedRepo,
} from './match';
import { openProgramFacts } from './programs';
import { loadRepoFacts, saveRepoFacts, type CachedProduct } from './repo-cache';
import { sql } from './db';
import { placeholderLink } from './placeholder';
import { githubRepo } from './campaigns';
import { repoKey } from './answer-bank';
import { CheckBudget, GETCODE_PER_REPO, LIST_BUDGET, contractDeployed, liveChecked, type CheckDeps } from './verify';

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
 */
export async function gh<T>(
  path: string,
  accept = 'application/vnd.github+json',
  onResponse?: (res: Response) => void,
): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
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

/**
 * v2.9 A2: a fork, a template, or a tutorial, course, starter or docs repo by name or topic; a
 * description counts only on strong phrases (Ruling G3: TUTORIAL_DESCRIPTION). Pure.
 */
export const unoriginal = (r: Pick<Repo, 'name' | 'fork' | 'is_template' | 'template_repository' | 'description' | 'topics'>) =>
  r.fork ||
  r.is_template === true ||
  Boolean(r.template_repository) ||
  [r.name, ...(r.topics ?? [])].some((t) => TUTORIAL.test(t)) ||
  TUTORIAL_DESCRIPTION.test(r.description ?? '');

/**
 * v2.9 A1: dropped before any per-repo call: forks, templates, archived repos, tutorials, EarnKit's
 * own repos, and repos neither created nor pushed in the last 365 days. Pure.
 */
export function droppedRepo(r: Repo, now: Date, o: { named?: boolean } = {}): boolean {
  if (r.archived || unoriginal(r) || earnkitOwner(ownerOf(r))) return true;
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
): Promise<{ repos: Repo[]; found: number; dropped: Set<string>; contribReads: number }> {
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
  const dropped = new Set([...own.filter(notProduct), ...contributed.dropped].map(keyOf));
  return { repos, found: own.length + contributed.found, dropped, contribReads: contributed.reads };
}

/** Ruling G4 (I1): dropped as a fork, template, archived repo or tutorial (never by age). Pure. */
const notProduct = (r: Repo) => r.archived || unoriginal(r);
const keyOf = (r: Repo) => repoKey({ url: r.html_url, name: r.name });

/** The builder's share of a repo's last 100 commits, for ownerOk. Null when GitHub couldn't say. */
async function contribution(fullName: string, user: string) {
  try {
    const recent = await gh<{ author?: { login?: string } | null }[]>(`/repos/${fullName}/commits?per_page=100`);
    const me = user.toLowerCase();
    return { userCommits: recent.filter((c) => c.author?.login?.toLowerCase() === me).length, recentCommits: recent.length };
  } catch (err) {
    console.error('[match] contribution read failed:', err instanceof Error ? err.name : 'error');
    return null;
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

export const repoByName = (fullName: string) => gh<Repo>(`/repos/${fullName}`);

/** Whether a public repo has at least one commit (GitHub answers 409 for an empty repo). */
export async function repoHasCommits(fullName: string) {
  try {
    return (await gh<unknown[]>(`/repos/${fullName}/commits?per_page=1`)).length > 0;
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
};

/** The fork compare failed (ForkCheckError): the repo itself was read fine. */
export class ForkCheckError extends GitHubError {}

/**
 * Ruling 3 (plan): the public repo, its first commit, and (forks only) how far its default branch is
 * ahead of its parent's. The repo and commits reads run together, plus the compare for a fork with
 * commits. Throws GitHub's error; a private repo (which EarnKit's token may still see) throws the
 * same "not found (or private)" error as a missing one. A failed compare throws ForkCheckError.
 */
export async function repoCodeFacts(fullName: string): Promise<RepoCode> {
  const [r, hasCommits] = await Promise.all([
    gh<Repo & { parent?: { full_name: string; default_branch: string } }>(`/repos/${fullName}`),
    repoHasCommits(fullName),
  ]);
  if (r.private || (r.visibility !== undefined && r.visibility !== 'public'))
    throw new GitHubError(`GitHub: /repos/${fullName} not found (or private)`, 404);
  const defaultBranch = r.default_branch;
  if (!r.fork || !r.parent || !hasCommits)
    return { fork: r.fork, hasCommits, aheadOfParent: null, defaultBranch };
  const owner = r.full_name.split('/')[0];
  try {
    // per_page=1: only ahead_by is needed, not the commit list or the file diffs.
    const c = await gh<{ ahead_by: number }>(
      `/repos/${r.parent.full_name}/compare/${encodeURIComponent(r.parent.default_branch)}...${encodeURIComponent(owner)}:${encodeURIComponent(r.default_branch)}?per_page=1`,
    );
    return { fork: true, hasCommits, aheadOfParent: c.ahead_by, defaultBranch };
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

/** A raw file from the repo's default branch (raw.githubusercontent.com: no API rate limit), or null. */
async function rawFile(repo: Repo, path: string, init: RequestInit = {}) {
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
async function readRepoChains(repo: Repo) {
  let complete = true;
  const tree = await gh<{
    tree: { path: string; type: string; size?: number }[];
  }>(
    `/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
  ).catch(() => {
    complete = false;
    return { tree: [] };
  });
  const blobs = tree.tree.filter((t) => t.type === 'blob');
  const paths = pickFiles(blobs.map((t) => ({ path: t.path, size: t.size ?? 0 })));
  const files = await Promise.all(
    paths.map(async (path) => {
      const text = await rawFile(repo, path);
      if (text === null) complete = false;
      return { path, text: text ?? '' };
    }),
  );
  const readme = blobs.find((t) => /^readme(\.(md|markdown|txt|rst))?$/i.test(t.path)) ?? null;
  const addresses = [
    ...new Set(files.flatMap((f) => f.text.match(ADDRESS) ?? []).map((a) => a.toLowerCase())),
  ]
    // Ruling G3: a known token (USDC, EURC, WETH, USDT) in a config file is not the builder's deployment.
    .filter((a) => a !== ZERO_ADDRESS && !KNOWN_TOKEN_ADDRESSES.has(a))
    .slice(0, GETCODE_PER_REPO);
  return {
    chains: detectChains(files),
    complete,
    readme: readme ? { path: readme.path, size: readme.size ?? 0 } : null,
    addresses,
  };
}

/**
 * v2.9 A2: a root README of 1.5 KB or more whose first 2 KB (one raw read) is not a framework's
 * default text. Null when it couldn't be read.
 */
async function readmeCounts(repo: Repo, readme: { path: string; size: number } | null): Promise<boolean | null> {
  if (!readme || readme.size < README_MIN_BYTES) return false;
  const text = await rawFile(repo, readme.path, { headers: { Range: 'bytes=0-2047' } });
  return text === null ? null : !DEFAULT_README.test(text.slice(0, 2048));
}

export const repoChains = async (repo: Repo): Promise<Detection> =>
  (await readRepoChains(repo)).chains;

/**
 * v2.8 Ruling 29 (plan): a repo's cached chains, read from github_repo_facts only (no GitHub
 * call), for "Also qualifies" right after an entry. The latest cached row for this full name
 * (any version: a GitHub call to find the current pushed_at is exactly what this avoids), or null
 * when nothing is cached yet. Review fix round 1, item 2: mainnet evidence only, the same
 * convention matchRepo uses (match.ts: `repo.chains[chain]!.mainnet`) — a chain seen only via a
 * testnet host or id never counts as a fit.
 */
export async function cachedRepoChains(repoFullName: string): Promise<Chain[] | null> {
  const [row] = await sql()<{ chains: Detection }[]>`
    SELECT chains FROM github_repo_facts WHERE full_name = ${repoFullName.toLowerCase()}
    ORDER BY fetched_at DESC LIMIT 1`;
  if (!row) return null;
  return Object.entries(row.chains)
    .filter(([, v]) => v?.mainnet)
    .map(([k]) => k as Chain);
}

/**
 * v2.9 A5 (Pre-flight P4): the contract candidates found in a public repo's files by the last
 * scored read (github_repo_facts.product), read from the cache only (no GitHub call), at most
 * GETCODE_PER_REPO, lowercase. Empty when the repo isn't a GitHub link or nothing is cached.
 */
export async function cachedRepoAddresses(repoUrl: string | null | undefined): Promise<string[]> {
  const gh = repoUrl ? githubRepo(repoUrl) : null;
  if (!gh) return [];
  const [row] = await sql()<{ product: CachedProduct | null }[]>`
    SELECT product FROM github_repo_facts WHERE full_name = ${`${gh.owner}/${gh.repo}`.toLowerCase()} AND product IS NOT NULL
    ORDER BY fetched_at DESC LIMIT 1`;
  return (row?.product?.addresses ?? []).map((a) => a.toLowerCase()).slice(0, GETCODE_PER_REPO);
}

/** Whether the repo has a commit at or after `since`; null when GitHub couldn't say. */
async function commitsSince(repo: Repo, since: Date) {
  return gh<unknown[]>(
    `/repos/${repo.full_name}/commits?per_page=1&since=${since.toISOString()}`,
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
    .map((x) => x.toLowerCase());
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
  /** The repo facts cache (default: github_repo_facts). */
  cache?: { load: typeof loadRepoFacts; save: typeof saveRepoFacts };
  /** Link probe, getCode and url_checks cache; one LIST_BUDGET is added per call. */
  checks?: CheckDeps;
  now?: Date;
};

/** What scoring one repo needs: who the builder is, whether the repo counts as theirs, one shared budget. */
type ScoreCtx = {
  builder: string | null;
  owned: boolean;
  checks: CheckDeps;
  now: Date;
  cache: NonNullable<MatchDeps['cache']>;
  /** v2.9 plan Ruling 2: the local report of the same repo (it adds a live link or chains GitHub lacks). */
  local?: ReportedRepo;
  /** Ruling G4: the checks run in recency order (the budget goes to the newest repos first). */
  turn?: Turn;
};

/** One repo's place in the check order: wait for the previous repo's checks, then release the next. */
type Turn = { wait: Promise<void>; done: () => void };
const turns = (n: number): Turn[] => {
  const out: Turn[] = [];
  let prev: Promise<void> = Promise.resolve();
  for (let i = 0; i < n; i++) {
    let done!: () => void;
    const next = new Promise<void>((resolve) => (done = resolve));
    out.push({ wait: prev, done });
    prev = next;
  }
  return out;
};

/** deployedCheck in this repo's turn. */
async function inTurn<T>(turn: Turn | undefined, run: () => Promise<T>): Promise<T> {
  await turn?.wait;
  try {
    return await run();
  } finally {
    turn?.done();
  }
}

const within = (iso: string | undefined | null, days: number, now: Date) =>
  Boolean(iso) && now.getTime() - Date.parse(iso!) <= days * DAY_MS;

/** The chains with mainnet evidence. */
const mainnetChains = (d: Detection) =>
  Object.entries(d)
    .filter(([, v]) => v?.mainnet)
    .map(([c]) => c as Chain);

/**
 * v2.9 A2: deployed means the live link loads from here, or one of the repo's contract candidates
 * has code on a detected mainnet (at most GETCODE_PER_REPO checks). Never throws.
 */
async function deployedCheck(homepage: string | null, addresses: string[], chains: Chain[], checks: CheckDeps) {
  const probed = homepage ? await liveChecked(homepage, checks) : false;
  if (probed === true) return { live: true, deployed: true, unchecked: false };
  // Ruling G4: a check with no budget left is "unchecked", never a failure.
  let unchecked = probed === null;
  const pairs = addresses.flatMap((a) => chains.map((c) => [c, a] as const)).slice(0, GETCODE_PER_REPO);
  for (const [chain, address] of pairs) {
    const r = await contractDeployed(chain, address, checks);
    if (r === true) return { live: false, deployed: true, unchecked: false };
    if (r === null) unchecked = true;
  }
  return { live: false, deployed: false, unchecked };
}

/** Whether the builder committed to the repo in the last 90 days (one read); null when GitHub couldn't say. */
async function builderActive(repo: Repo, builder: string, now: Date) {
  const since = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  return gh<unknown[]>(
    `/repos/${repo.full_name}/commits?author=${encodeURIComponent(builder)}&since=${since}&per_page=1`,
  ).then(
    (c) => c.length > 0,
    () => null,
  );
}

/** Adds the chains a local report names that GitHub's files don't show (claims; plan Ruling 2). */
function withReportedChains(chains: Detection, local?: ReportedRepo): Detection {
  if (!local) return chains;
  const out: Detection = { ...chains };
  for (const c of local.chains)
    out[c.chain] ??= { mainnet: c.mainnet, testnet: !c.mainnet, evidence: 'reported by the agent' };
  return out;
}

/**
 * One repo's facts, its real-product score and its verdicts against the given programs. The repo's
 * own facts (chains, commits since a window, and its product signals: young, original, README,
 * contract candidates) come from the hour-long cache for this repo version (pushed_at) when
 * present; only complete reads are cached. owned, active and deployed are worked out on every call
 * (Pre-flight P6): one commits read for active, and the link and contract checks (url_checks).
 */
async function checkRepo(repo: Repo, programs: ProgramFacts[], ctx: ScoreCtx) {
  const cached = await ctx.cache.load(repo.full_name, repo.pushed_at);
  let changed = false;
  let cacheable = true;
  let chains = cached?.chains;
  let own: CachedProduct | null | undefined = cached?.product;
  if (!chains || !own) {
    const read = await readRepoChains(repo);
    chains = read.chains;
    cacheable = read.complete;
    const readme = await readmeCounts(repo, read.readme);
    if (readme === null) cacheable = false;
    own = {
      young: within(repo.created_at, 365, ctx.now),
      original: !unoriginal(repo),
      readme: readme === true,
      addresses: read.addresses,
    };
    changed = true;
  }
  const commitsSinceKnown = { ...cached?.commits_since };
  const commits_in_window: Record<string, boolean> = {};
  for (const p of programs) {
    if (
      p.existing_work === 'new_work_only' &&
      p.starts_at &&
      (p.any_chain || p.chains.some((c) => chains[c]))
    ) {
      const key = p.starts_at.toISOString();
      if (!(key in commitsSinceKnown)) {
        const has = await commitsSince(repo, p.starts_at);
        if (has === null) cacheable = false;
        else {
          commitsSinceKnown[key] = has;
          changed = true;
        }
      }
      commits_in_window[p.id] = commitsSinceKnown[key] ?? false;
    }
  }
  if (changed && cacheable)
    await ctx.cache.save(
      repo.full_name,
      repo.pushed_at,
      { chains, commits_since: commitsSinceKnown, product: own },
      cached?.product ? cached.fetched_at : undefined,
    );

  const allChains = withReportedChains(chains, ctx.local);
  // v2.9 A5: a placeholder homepage is no homepage. Plan Ruling 2: GitHub's wins, else the local link.
  const homepage = (repo.homepage && !placeholderLink(repo.homepage) ? repo.homepage : null) ?? ctx.local?.live_url ?? null;
  // Plan Ruling 1: a commit by the builder in 90 days; without a known builder, a push in 90 days.
  const active = ctx.builder
    ? ((await builderActive(repo, ctx.builder, ctx.now)) ?? within(repo.pushed_at, 90, ctx.now))
    : within(repo.pushed_at, 90, ctx.now);
  const { live, deployed, unchecked } = await inTurn(ctx.turn, () =>
    deployedCheck(
      homepage,
      [...new Set([...own.addresses, ...(ctx.local?.contracts ?? [])])],
      mainnetChains(allChains),
      ctx.checks,
    ),
  );
  const product = productScore(
    {
      active,
      young: own.young || active,
      original: own.original,
      readme: own.readme,
      deployed,
      owned: ctx.owned,
    },
    unchecked ? ['deployed'] : [],
  );
  const facts: RepoFacts = {
    name: repo.name,
    url: repo.html_url,
    homepage,
    created_at: repo.created_at,
    chains: allChains,
    commits_in_window,
    product,
    live_verified: live,
  };
  return { repo: facts, verdicts: matchRepo(facts, programs) };
}

/**
 * v2.9 A2 (plan Ruling 1): a local repo's score. EarnKit never reads its code, so `readme` is false;
 * active is a last commit within 90 days, or no date given (Ruling G3; young follows it); original
 * reads the name only.
 */
async function checkLocal(r: ReportedRepo, programs: ProgramFacts[], ctx: ScoreCtx) {
  const facts = reportedFacts(r, programs);
  // Ruling G3: an unknown last commit counts as active (the agent is asked to send it).
  const active = r.last_commit_at === undefined || within(r.last_commit_at, 90, ctx.now);
  const { live, deployed, unchecked } = await inTurn(ctx.turn, () =>
    deployedCheck(facts.homepage, r.contracts ?? [], mainnetChains(facts.chains), ctx.checks),
  );
  const product = productScore(
    { active, young: active, original: !TUTORIAL.test(r.name), readme: false, deployed, owned: ctx.owned },
    unchecked ? ['deployed'] : [],
  );
  const scored: RepoFacts = { ...facts, product, live_verified: live };
  return { repo: scored, verdicts: matchRepo(scored, programs) };
}

/** A repo to score: from GitHub (with any local report of the same repo), or local only. */
type Candidate =
  | { key: string; github: Repo; owned: boolean; local?: ReportedRepo }
  | { key: string; github?: undefined; owned: boolean; local: ReportedRepo };

const recency = (c: Candidate) => Date.parse(c.github?.pushed_at ?? c.local?.last_commit_at ?? '') || 0;

/**
 * Checks a builder's repos (public on GitHub, or reported by the agent) against open programs.
 * v2.9 A1, A2: only the builder's own repos (never EarnKit's, a fork, a template, an archived repo
 * or a tutorial), one per repo key, the SCORE_LIMIT most recent scored, under one LIST_BUDGET of
 * link and contract checks. `checked` counts every repo found (dropped ones too); `scored` the ones
 * scored.
 */
export async function matchProjects(input: z.infer<typeof MatchProjectsInput>, deps: MatchDeps = {}) {
  const now = deps.now ?? new Date();
  const programs = deps.programs ?? (await openProgramFacts());
  const builder = input.github_user ?? null;
  let found = 0;
  const github: { repo: Repo; owned: boolean }[] = [];
  // Ruling G4: keys dropped as a fork, template, archived repo or tutorial stay dropped when the
  // same repo comes back through local_repos; the 100-commit reads share one cap of 3.
  let dropped = new Set<string>();
  let contribReads = 0;
  if (input.repos?.length) {
    const names = input.repos.map(fullName);
    found += names.length;
    const read = await Promise.all(names.filter((n) => !earnkitOwner(n.split('/')[0])).map((n) => repoByName(n)));
    dropped = new Set(read.filter(notProduct).map(keyOf));
    const kept = read.filter((r) => !droppedRepo(r, now, { named: true })).sort(byPushed).slice(0, SCORE_LIMIT);
    // Pre-flight P28: without a builder, a named repo counts like a local one (owned unless EarnKit's).
    for (const r of kept) {
      const owner = ownerOf(r);
      let owned = !builder || ownerOk(owner, builder);
      if (builder && !owned && contribReads++ < CONTRIB_CANDIDATES) {
        const c = await contribution(r.full_name, builder);
        owned = c !== null && ownerOk(owner, builder, c);
      }
      github.push({ repo: r, owned });
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
    if (!candidates.has(key)) candidates.set(key, { key, github: g.repo, owned: g.owned });
  }
  for (const r of input.local_repos ?? []) {
    found++;
    const gh = r.url ? githubRepo(r.url) : null;
    if (gh && earnkitOwner(gh.owner)) continue;
    const key = repoKey({ url: r.url, name: r.name });
    if (dropped.has(key)) continue;
    const known = candidates.get(key);
    if (known) {
      known.local ??= r;
      continue;
    }
    // Plan Ruling 1: a local repo is the builder's unless its GitHub link names another owner. Ruling
    // G4 (I3): then it gets the same 100-commit read (within the shared cap of 3); a repo GitHub
    // won't show (private) counts as the builder's, as P28 (the token proof still gates a launch).
    let owned = !gh || !builder || gh.owner.toLowerCase() === builder.toLowerCase();
    if (gh && builder && !owned && contribReads++ < CONTRIB_CANDIDATES) {
      const c = await contribution(`${gh.owner}/${gh.repo}`, builder);
      owned = c === null || ownerOk(gh.owner, builder, c);
    }
    candidates.set(key, { key, owned, local: r });
  }
  const toScore = [...candidates.values()].sort((a, b) => recency(b) - recency(a)).slice(0, SCORE_LIMIT);

  const checks: CheckDeps = { ...deps.checks, now, budget: new CheckBudget(LIST_BUDGET) };
  const cache = deps.cache ?? { load: loadRepoFacts, save: saveRepoFacts };
  const order = turns(toScore.length);
  const results = await mapLimit(toScore.map((c, i) => ({ c, turn: order[i] })), 6, async ({ c, turn }) => {
    const ctx: ScoreCtx = { builder, owned: c.owned, checks, now, cache, local: c.local, turn };
    try {
      return { key: c.key, ...(c.github ? await checkRepo(c.github, programs, ctx) : await checkLocal(c.local, programs, ctx)) };
    } finally {
      turn.done(); // a repo that failed before its checks never holds up the next one
    }
  });
  // Builders want what can earn: "no" verdicts and repos with only those are left out.
  const fits = results
    .map((r) => ({
      key: r.key,
      repo: r.repo.name,
      repo_url: r.repo.url || null,
      // v2.8 Ruling 10 (plan): the repo's mainnet chains, for new program alerts (fit_chains);
      // testnet-only never counts as a fit (review minor 6, as cachedRepoChains).
      chains: mainnetChains(r.repo.chains),
      verdicts: r.verdicts.filter((v) => v.status !== 'no'),
      product: r.repo.product as Product,
      live_verified: r.repo.live_verified === true,
      // Pre-flight P13: the merged facts, for later steps (fit repos for alerts).
      facts: r.repo,
    }))
    .filter((r) => r.verdicts.length > 0)
    .sort(
      (a, b) =>
        Number(!a.verdicts.some((v) => v.status === 'likely')) -
          Number(!b.verdicts.some((v) => v.status === 'likely')) || b.product.score - a.product.score,
    );
  return { checked: found, scored: results.length, fits };
}

/** get_program's eligibility check: one repo against one open program (scored, owned unless EarnKit's). */
export async function checkEligibility(ref: string, programId: string, deps: MatchDeps = {}) {
  const program = (deps.programs ?? (await openProgramFacts())).find((p) => p.id === programId);
  if (!program) return null;
  const repo = await repoByName(fullName(ref));
  const now = deps.now ?? new Date();
  const { repo: facts, verdicts } = await checkRepo(repo, [program], {
    builder: null,
    owned: !earnkitOwner(ownerOf(repo)),
    checks: { ...deps.checks, now, budget: new CheckBudget(LIST_BUDGET) },
    now,
    cache: deps.cache ?? { load: loadRepoFacts, save: saveRepoFacts },
  });
  const [v] = verdicts;
  if (!v)
    return {
      status: 'no' as const,
      missing: [],
      effort: null,
      note:
        facts.product && facts.product.tier !== 'product' && (program.any_chain || program.chains.some((c) => facts.chains[c]))
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
