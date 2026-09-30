import { z } from 'zod';
import {
  detectChains,
  matchRepo,
  pickFiles,
  type Detection,
  type RepoFacts,
} from './match';
import { openProgramFacts } from './programs';

/**
 * Reads public GitHub data with EarnKit's own token (GITHUB_TOKEN). Builders only give a
 * username or repo links; nothing of theirs is stored.
 */
const API = 'https://api.github.com';

export class GitHubError extends Error {}

async function gh<T>(path: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'earnkit',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404)
    throw new GitHubError(
      `GitHub: ${path.split('?')[0]} not found (or private)`,
    );
  if (!res.ok) throw new GitHubError(`GitHub request failed (${res.status})`);
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
};

/** Most recently pushed original (non-fork, non-archived) public repos. */
export async function userRepos(user: string, limit: number) {
  const repos: Repo[] = [];
  for (let page = 1; page <= 3 && repos.length < limit * 2; page++) {
    const batch = await gh<Repo[]>(
      `/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed&page=${page}`,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => !r.fork && !r.archived).slice(0, limit);
}

export const repoByName = (fullName: string) => gh<Repo>(`/repos/${fullName}`);

/** Reads a handful of config-like files and detects which chains the repo targets. */
export async function repoChains(repo: Repo): Promise<Detection> {
  const tree = await gh<{
    tree: { path: string; type: string; size?: number }[];
  }>(
    `/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
  ).catch(() => ({ tree: [] }));
  const paths = pickFiles(
    tree.tree
      .filter((t) => t.type === 'blob')
      .map((t) => ({ path: t.path, size: t.size ?? 0 })),
  );
  const files = await Promise.all(
    paths.map(async (path) => {
      // raw.githubusercontent.com doesn't count against the API rate limit.
      const res = await fetch(
        `https://raw.githubusercontent.com/${repo.full_name}/${encodeURIComponent(repo.default_branch)}/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        { signal: AbortSignal.timeout(10_000) },
      ).catch(() => null);
      return { path, text: res?.ok ? await res.text() : '' };
    }),
  );
  return detectChains(files);
}

/** True if the repo has at least one commit at or after `since`. */
export async function hasCommitsSince(repo: Repo, since: Date) {
  const commits = await gh<unknown[]>(
    `/repos/${repo.full_name}/commits?per_page=1&since=${since.toISOString()}`,
  ).catch(() => []);
  return commits.length > 0;
}

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

export const MatchProjectsInput = z
  .object({
    github_user: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,39}$/, 'a GitHub username')
      .optional(),
    /** "owner/repo" or a github.com URL. */
    repos: z.array(z.string()).max(REPO_LIMIT).optional(),
  })
  .strict()
  .refine((i) => i.github_user || i.repos?.length, {
    message: 'Give a github_user or repos',
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

/** Checks a builder's public repos against open programs; list_programs turns this into text. */
export async function matchProjects(
  input: z.infer<typeof MatchProjectsInput>,
) {
  const programs = await openProgramFacts();
  const repos: Repo[] = input.repos?.length
    ? await Promise.all(input.repos.map((r) => repoByName(fullName(r))))
    : await userRepos(input.github_user!, REPO_LIMIT);

  const results = await mapLimit(repos, 6, async (repo) => {
    const chains = await repoChains(repo);
    const commits_in_window: Record<string, boolean> = {};
    for (const p of programs) {
      if (
        p.existing_work === 'new_work_only' &&
        p.starts_at &&
        p.chains.some((c) => chains[c])
      ) {
        commits_in_window[p.id] = await hasCommitsSince(repo, p.starts_at);
      }
    }
    const facts: RepoFacts = {
      name: repo.name,
      url: repo.html_url,
      homepage: repo.homepage || null,
      created_at: repo.created_at,
      chains,
      commits_in_window,
    };
    return { repo: facts, verdicts: matchRepo(facts, programs) };
  });

  // Builders want what can earn: "no" verdicts and repos with only those are left out.
  const fits = results
    .map((r) => ({
      repo: r.repo.name,
      verdicts: r.verdicts.filter((v) => v.status !== 'no'),
    }))
    .filter((r) => r.verdicts.length > 0)
    .sort(
      (a, b) =>
        Number(!a.verdicts.some((v) => v.status === 'likely')) -
        Number(!b.verdicts.some((v) => v.status === 'likely')),
    );
  return { checked: repos.length, fits };
}
