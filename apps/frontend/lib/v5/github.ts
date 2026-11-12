/**
 * Public GitHub reads with EarnKit's own token: the repo, its tree, the README and up to 12 config
 * files for chain detection, plus the first commit date. Four API calls; files come from raw.
 * `fetch` is injectable so tests replay recorded responses.
 */

const API = 'https://api.github.com';
type Fetch = typeof fetch;
const RAW = 'https://raw.githubusercontent.com';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** x-ratelimit-remaining on the failed response, when GitHub sent it. */
    readonly remaining: number | null = null,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/** M1 (v6.1.14 fix round 1): the read found the repo private (a 404 to every caller, but private, never gone). */
export class RepoPrivateError extends GitHubError {
  constructor() {
    super('GitHub: repo is private', 404);
    this.name = 'RepoPrivateError';
  }
}

/** L26-8 (v6.1.16 Task 12): the whole read passed its one budget (`readBudget`); the facts are report-only. */
export class GitHubSlow extends Error {
  constructor() {
    super('GitHub: the read passed its time budget');
    this.name = 'GitHubSlow';
  }
}

/** L26-8 (v6.1.16 Task 12): the one time budget of a whole repo read, every request under it. */
export const READ_BUDGET_MS = 20_000;
/** One signal for the whole read (L26-8), in place of each request's own timeout. */
export const readBudget = (ms = READ_BUDGET_MS): AbortSignal => AbortSignal.timeout(ms);

/**
 * A fetch under the read's budget: it rejects with GitHubSlow when the budget ends first, whether or not the fetch
 * itself honours the signal. Without a signal, the request's own `fallbackMs` timeout (a lone repo-object check).
 */
async function budgeted(f: Fetch, url: string, init: RequestInit, signal: AbortSignal | undefined, fallbackMs: number): Promise<Response> {
  const s = signal ?? AbortSignal.timeout(fallbackMs);
  if (s.aborted) throw signal ? new GitHubSlow() : s.reason;
  let stop: () => void = () => {};
  const ended = new Promise<never>((_, reject) => {
    const on = () => reject(signal ? new GitHubSlow() : s.reason);
    s.addEventListener('abort', on, { once: true });
    stop = () => s.removeEventListener('abort', on);
  });
  try {
    return await Promise.race([f(url, { ...init, signal: s }), ended]);
  } catch (err) {
    throw signal?.aborted ? new GitHubSlow() : err;
  } finally {
    stop();
  }
}

export type Repo = {
  full_name: string;
  html_url: string;
  homepage: string | null;
  default_branch: string;
  created_at: string;
  pushed_at: string;
  private?: boolean;
  description?: string | null;
  fork?: boolean;
  archived?: boolean;
  /** In KB; 0 for a repo with no commits. */
  size?: number;
  /** The repo's topics, lower-case (v6.1.10). */
  topics?: string[];
  parent?: { full_name: string; default_branch: string; id?: number };
  /** GitHub's repo id: the same through a rename or a transfer (L28-6, v6.1.16 Task 14). */
  id?: number;
  owner?: { login?: string; type?: string };
  /** L38-27 (v6.1.18 Task 11): the license GitHub detects; null when the repo has no license file. */
  license?: { key?: string; spdx_id?: string | null } | null;
};
export type TreeEntry = { path: string; type: string; size?: number };
export type RepoRead = {
  repo: Repo;
  tree: TreeEntry[];
  readme: string | null;
  files: { path: string; text: string }[];
  first_commit_at: string | null;
  /** A tree or file read failed: the facts are incomplete and must not be cached. */
  partial: boolean;
  /** L28-3 (v6.1.16 Task 14): the logins of the repo's contributors (the first 100), lower-case; null when not read. */
  contributors?: string[] | null;
};

/** L28-3 (v6.1.16 Task 14): the repo's contributor logins (one page of 100), lower-case; null when the read fails. */
async function contributorsOf(fullName: string, token: string | undefined, f: Fetch, signal: AbortSignal): Promise<string[] | null> {
  try {
    const rows = await gh<unknown>(`/repos/${fullName}/contributors?per_page=100`, token, f, signal);
    if (!Array.isArray(rows)) return null;
    return rows.map((r) => (r && typeof r === 'object' && typeof (r as { login?: unknown }).login === 'string' ? (r as { login: string }).login.toLowerCase() : '')).filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * L28-3 (v6.1.16 Task 14): whether `login` is a public member of the organization `org` (GitHub answers 204 for a member,
 * 404 otherwise); null when the read fails. Under the read's budget when given.
 */
export async function isPublicMember(org: string, login: string, o: { token?: string; fetch?: Fetch; signal?: AbortSignal } = {}): Promise<boolean | null> {
  const f = o.fetch ?? fetch;
  const token = o.token ?? process.env.GITHUB_TOKEN;
  try {
    await ghResponse(`/orgs/${encodeURIComponent(org)}/public_members/${encodeURIComponent(login)}`, token, f, o.signal ?? readBudget());
    return true;
  } catch (err) {
    return err instanceof GitHubError && err.status === 404 ? false : null;
  }
}


/** GET one GitHub API path as JSON; 404 and other failures throw GitHubError; past the read's budget, GitHubSlow. */
export async function gh<T>(path: string, token: string | undefined = process.env.GITHUB_TOKEN, f: Fetch = fetch, signal?: AbortSignal): Promise<T> {
  return (await ghResponse(path, token, f, signal)).json() as Promise<T>;
}

/** x-ratelimit-remaining as a number, or null when absent. */
export function rateRemaining(res: Response): number | null {
  const v = res.headers.get('x-ratelimit-remaining');
  return v !== null && /^\d+$/.test(v) ? Number(v) : null;
}

/** The page number of a link header's rel="last", or null. */
const lastPage = (link: string | null): number | null => {
  const n = link?.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/)?.[1];
  return n ? Number(n) : null;
};

/**
 * GET one GitHub API path; 404 and other failures throw GitHubError (with the rate-limit remaining). Under `signal`
 * (the read's one budget, L26-8) it throws GitHubSlow when the budget ends; with none, its own 15 s.
 */
export async function ghResponse(path: string, token: string | undefined, f: Fetch, signal?: AbortSignal): Promise<Response> {
  const res = await budgeted(f, `${API}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'earnkit', ...(token && { Authorization: `Bearer ${token}` }) },
  }, signal, 15_000);
  if (res.status === 404) throw new GitHubError(`GitHub: ${path.split('?')[0]} not found (or private)`, 404, rateRemaining(res));
  if (!res.ok) throw new GitHubError(`GitHub request failed (${res.status})`, res.status, rateRemaining(res));
  return res;
}

/** GET one page of a GitHub list: its rows, the rel="last" page number (null when there is one page) and the rate-limit remaining. */
export async function ghPage<T>(path: string, token: string | undefined, f: Fetch = fetch): Promise<{ rows: T[]; last: number | null; remaining: number | null }> {
  const res = await ghResponse(path, token, f);
  const body = (await res.json()) as unknown;
  return { rows: Array.isArray(body) ? (body as T[]) : [], last: lastPage(res.headers.get('link')), remaining: rateRemaining(res) };
}

/**
 * The files worth reading for chain signals, best first: deploy configs and the root manifest, then
 * files named for chains or contracts, then other manifests and constants. Tool configs, vendored
 * libraries and submodule folders are skipped. Pure.
 */
export function pickFiles(paths: { path: string; size: number }[], limit = 12, submodules: string[] = []): string[] {
  const skip = /(^|\/)(node_modules|dist|build|out|\.next|vendor|target|coverage)\/|(^|\/)lib\/(forge-std|openzeppelin-contracts[\w-]*|solmate|solady)\//;
  const noise = /(^|\/)(tsconfig[^/]*\.json|eslint\.config\.[^/]*|postcss\.config\.[^/]*|tailwind\.config\.[^/]*|next\.config\.[^/]*|jest\.config\.[^/]*|vitest\.config\.[^/]*|babel\.config\.[^/]*|slither\.config\.json)$/i;
  const interesting =
    /(^|\/)(package\.json|Anchor\.toml|hardhat\.config\.[cm]?[jt]s|foundry\.toml|wagmi\.config\.[jt]s|\.env\.(example|sample|template)|[^/]*(chain|network|config|constants|wagmi|viem|contracts?)[^/]*\.(ts|tsx|js|mjs|json|toml|py|rs|go|sol))$/i;
  const rank = (p: string) =>
    /(^|\/)(Anchor\.toml|hardhat\.config\.[^/]*|foundry\.toml|wagmi\.config\.[^/]*|\.env\.[^/]*)$/.test(p) || p === 'package.json'
      ? 0
      : /(chain|network|wagmi|viem|contracts?)[^/]*\.[a-z]+$/i.test(p)
        ? 1
        : /package\.json$/.test(p)
          ? 2
          : 3;
  return paths
    .filter((p) => p.size < 200_000 && !skip.test(p.path) && !noise.test(p.path) && !submodules.some((m) => p.path.startsWith(`${m}/`)) && interesting.test(p.path))
    .sort((a, b) => rank(a.path) - rank(b.path) || a.path.split('/').length - b.path.split('/').length)
    .slice(0, limit)
    .map((p) => p.path);
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

async function raw(f: Fetch, repo: Repo, path: string, signal: AbortSignal, headers?: Record<string, string>): Promise<string | null> {
  const res = await budgeted(f, `${RAW}/${repo.full_name}/${encodeURIComponent(repo.default_branch)}/${encodePath(path)}`, { headers }, signal, 10_000).catch(() => null);
  return res?.ok ? await res.text().catch(() => null) : null;
}

/** The oldest commit's date: the last page of a one-per-page list, else null. */
async function firstCommit(fullName: string, token: string | undefined, f: Fetch, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await ghResponse(`/repos/${fullName}/commits?per_page=1`, token, f, signal);
    const last = lastPage(res.headers.get('link'));
    const one = last && last !== 1 ? await gh<CommitRow[]>(`/repos/${fullName}/commits?per_page=1&page=${last}`, token, f, signal) : ((await res.json()) as CommitRow[]);
    return one[0]?.commit?.committer?.date ?? one[0]?.commit?.author?.date ?? null;
  } catch {
    return null;
  }
}
type CommitRow = { commit?: { committer?: { date?: string }; author?: { date?: string } } };

/** The repo object alone: pushed_at for the cache check (under the read's budget when given). */
export const readRepoObject = (fullName: string, token: string | undefined, f: Fetch = fetch, signal?: AbortSignal) => gh<Repo>(`/repos/${fullName}`, token, f, signal);

/**
 * Reads a public repo: object, recursive tree, README, up to 12 picked files, first commit date. L26-8 (v6.1.16 Task
 * 12): one budget (`signal`, READ_BUDGET_MS by default) for the whole read; after the repo object, the first commit runs
 * beside the tree and the raw files the tree names. Past the budget it throws GitHubSlow, never a partial read.
 */
export async function readRepo(fullName: string, o: { token?: string; fetch?: Fetch; signal?: AbortSignal } = {}): Promise<RepoRead> {
  const f = o.fetch ?? fetch;
  const token = o.token ?? process.env.GITHUB_TOKEN;
  const signal = o.signal ?? readBudget();
  const repo = await readRepoObject(fullName, token, f, signal);
  if (repo.private) throw new RepoPrivateError();
  let partial = false;
  const treeAndFiles = async () => {
    const tree = await gh<{ tree: TreeEntry[] }>(`/repos/${fullName}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`, token, f, signal).then(
      (t) => t.tree ?? [],
      () => {
        partial = true;
        return [] as TreeEntry[];
      },
    );
    const blobs = tree.filter((t) => t.type === 'blob');
    const submodules = tree.filter((t) => t.type === 'commit').map((t) => t.path);
    const picks = pickFiles(blobs.map((t) => ({ path: t.path, size: t.size ?? 0 })), 12, submodules);
    const readmePath = blobs.find((t) => /^readme(\.(md|markdown|txt|rst))?$/i.test(t.path))?.path;
    const [readme, files] = await Promise.all([
      readmePath ? raw(f, repo, readmePath, signal, { Range: 'bytes=0-4095' }) : null,
      Promise.all(
        picks.map(async (path) => {
          const text = await raw(f, repo, path, signal);
          if (text === null) partial = true;
          return { path, text: text ?? '' };
        }),
      ),
    ]);
    if (readmePath && readme === null) partial = true;
    return { tree, readme, files };
  };
  const [{ tree, readme, files }, first, contributors] = await Promise.all([treeAndFiles(), firstCommit(fullName, token, f, signal), repo.size === 0 ? null : contributorsOf(fullName, token, f, signal)]);
  if (signal.aborted) throw new GitHubSlow();
  return { repo, tree, readme, files, first_commit_at: first, partial, contributors };
}
