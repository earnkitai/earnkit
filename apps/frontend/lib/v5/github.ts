/**
 * Public GitHub reads with EarnKit's own token: the repo, its tree, the README and up to 12 config
 * files for chain detection, plus the first commit date. Four API calls; files come from raw.
 * `fetch` is injectable so tests replay recorded responses.
 */

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubError';
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
};
export type TreeEntry = { path: string; type: string; size?: number };
export type RepoRead = {
  repo: Repo;
  tree: TreeEntry[];
  readme: string | null;
  files: { path: string; text: string }[];
  first_commit_at: string | null;
};

type Fetch = typeof fetch;

/** GET one GitHub API path as JSON; 404 and other failures throw GitHubError. */
export async function gh<T>(path: string, token: string | undefined = process.env.GITHUB_TOKEN, f: Fetch = fetch): Promise<T> {
  return (await ghResponse(path, token, f)).json() as Promise<T>;
}

async function ghResponse(path: string, token: string | undefined, f: Fetch): Promise<Response> {
  const res = await f(`${API}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'earnkit', ...(token && { Authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new GitHubError(`GitHub: ${path.split('?')[0]} not found (or private)`, 404);
  if (!res.ok) throw new GitHubError(`GitHub request failed (${res.status})`, res.status);
  return res;
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

async function raw(f: Fetch, repo: Repo, path: string, headers?: Record<string, string>): Promise<string | null> {
  const res = await f(`${RAW}/${repo.full_name}/${encodeURIComponent(repo.default_branch)}/${encodePath(path)}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return res?.ok ? await res.text().catch(() => null) : null;
}

/** The oldest commit's date: the last page of a one-per-page list, else null. */
async function firstCommit(fullName: string, token: string | undefined, f: Fetch): Promise<string | null> {
  try {
    const res = await ghResponse(`/repos/${fullName}/commits?per_page=1`, token, f);
    const last = res.headers.get('link')?.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/)?.[1];
    const one = last && last !== '1' ? await gh<CommitRow[]>(`/repos/${fullName}/commits?per_page=1&page=${last}`, token, f) : ((await res.json()) as CommitRow[]);
    return one[0]?.commit?.committer?.date ?? one[0]?.commit?.author?.date ?? null;
  } catch {
    return null;
  }
}
type CommitRow = { commit?: { committer?: { date?: string }; author?: { date?: string } } };

/** The repo object alone: pushed_at for the cache check. */
export const readRepoObject = (fullName: string, token: string | undefined, f: Fetch = fetch) => gh<Repo>(`/repos/${fullName}`, token, f);

/** Reads a public repo: object, recursive tree, README, up to 12 picked files, first commit date. */
export async function readRepo(fullName: string, o: { token?: string; fetch?: Fetch } = {}): Promise<RepoRead> {
  const f = o.fetch ?? fetch;
  const token = o.token ?? process.env.GITHUB_TOKEN;
  const repo = await readRepoObject(fullName, token, f);
  if (repo.private) throw new GitHubError('GitHub: repo is private', 404);
  const [tree, first] = await Promise.all([
    gh<{ tree: TreeEntry[] }>(`/repos/${fullName}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`, token, f).then((t) => t.tree, () => [] as TreeEntry[]),
    firstCommit(fullName, token, f),
  ]);
  const blobs = tree.filter((t) => t.type === 'blob');
  const submodules = tree.filter((t) => t.type === 'commit').map((t) => t.path);
  const picks = pickFiles(blobs.map((t) => ({ path: t.path, size: t.size ?? 0 })), 12, submodules);
  const readmePath = blobs.find((t) => /^readme(\.(md|markdown|txt|rst))?$/i.test(t.path))?.path;
  const [readme, files] = await Promise.all([
    readmePath ? raw(f, repo, readmePath, { Range: 'bytes=0-4095' }) : null,
    Promise.all(picks.map(async (path) => ({ path, text: (await raw(f, repo, path)) ?? '' }))),
  ]);
  return { repo, tree, readme, files, first_commit_at: first };
}
