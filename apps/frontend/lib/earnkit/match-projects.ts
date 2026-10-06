import { z } from 'zod';
import {
  CHAINS,
  detectChains,
  matchRepo,
  reportedFacts,
  pickFiles,
  type Detection,
  type ProgramFacts,
  type RepoFacts,
} from './match';
import { openProgramFacts } from './programs';
import { loadRepoFacts, saveRepoFacts } from './repo-cache';

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
};

const CONTRIBUTED_LIMIT = 10;

/**
 * Most recently pushed original (non-fork, non-archived) public repos: the user's own, plus
 * public repos owned by others (e.g. their orgs) they committed to in the last year.
 */
export async function userRepos(user: string, limit: number) {
  const own: Repo[] = [];
  for (let page = 1; page <= 3 && own.length < limit * 2; page++) {
    const batch = await gh<Repo[]>(
      `/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed&page=${page}`,
    );
    own.push(...batch);
    if (batch.length < 100) break;
  }
  const names = new Set(own.map((r) => r.full_name.toLowerCase()));
  const repos = [...own, ...(await contributedRepos(user, names))];
  return repos
    .filter((r) => !r.fork && !r.archived)
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .slice(0, limit);
}

/** Public repos owned by someone else that `user` authored commits in during the last year. */
async function contributedRepos(user: string, skip: Set<string>) {
  const since = new Date(Date.now() - 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const q = encodeURIComponent(`author:${user} author-date:>${since}`);
  let found: { items: { repository: { full_name: string } }[] };
  try {
    found = await gh(
      `/search/commits?q=${q}&sort=author-date&order=desc&per_page=100`,
    );
  } catch (err) {
    // The user's own repos still match; this only adds org/other repos.
    console.error('[match] commit search failed:', err);
    return [];
  }
  const names = [
    ...new Set(found.items.map((i) => i.repository.full_name)),
  ].filter(
    (n) =>
      !skip.has(n.toLowerCase()) &&
      n.split('/')[0].toLowerCase() !== user.toLowerCase(),
  );
  const repos = await Promise.all(
    names
      .slice(0, CONTRIBUTED_LIMIT)
      .map((n) => repoByName(n).catch(() => null)),
  );
  return repos.filter((r) => r !== null);
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
export type RepoCode = { fork: boolean; hasCommits: boolean; aheadOfParent: number | null };

/**
 * Ruling 3 (plan): the repo, its first commit, and (forks only) how far its default branch is ahead
 * of its parent's. Two reads, plus the compare for a fork with commits. Throws GitHub's error (a
 * missing or private repo says "not found").
 */
export async function repoCodeFacts(fullName: string): Promise<RepoCode> {
  const r = await gh<Repo & { parent?: { full_name: string; default_branch: string } }>(
    `/repos/${fullName}`,
  );
  const hasCommits = await repoHasCommits(fullName);
  if (!r.fork || !r.parent || !hasCommits)
    return { fork: r.fork, hasCommits, aheadOfParent: null };
  const owner = r.full_name.split('/')[0];
  const c = await gh<{ ahead_by: number }>(
    `/repos/${r.parent.full_name}/compare/${encodeURIComponent(r.parent.default_branch)}...${encodeURIComponent(owner)}:${encodeURIComponent(r.default_branch)}`,
  );
  return { fork: true, hasCommits, aheadOfParent: c.ahead_by };
}

/**
 * Reads a handful of config-like files and detects which chains the repo targets. `complete` is
 * false when the tree or a file couldn't be read (such a result isn't cached).
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
      if (!res?.ok) complete = false;
      return { path, text: res?.ok ? await res.text() : '' };
    }),
  );
  return { chains: detectChains(files), complete };
}

export const repoChains = async (repo: Repo): Promise<Detection> =>
  (await readRepoChains(repo)).chains;

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

export const ReportedRepoInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    /** Chains the code targets, and whether it's on mainnet (else testnet only). */
    chains: z
      .array(z.object({ chain: z.enum(CHAINS), mainnet: z.boolean() }).strict())
      .max(CHAINS.length),
    live_url: z.string().url().optional(),
    last_commit_at: z.string().datetime({ offset: true }).optional(),
    /**
     * Ruling 13 (plan): validated by `githubRepo`, never zod, so a bad url never fails the call.
     * A `.max()` would reject (not drop) an oversize one, so length is dropped the same way:
     * anything over 300 characters becomes undefined instead of a parse error.
     */
    url: z
      .string()
      .optional()
      .transform((u) => (u === undefined || u.length > 300 ? undefined : u)),
  })
  .strict();

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

/**
 * One repo's facts and its verdicts against the given programs. Facts come from the hour-long
 * cache for this repo version (pushed_at) when present; only complete reads are cached.
 */
async function checkRepo(repo: Repo, programs: ProgramFacts[]) {
  const cached = await loadRepoFacts(repo.full_name, repo.pushed_at);
  let changed = false;
  let cacheable = true;
  let chains = cached?.chains;
  if (!chains) {
    const read = await readRepoChains(repo);
    chains = read.chains;
    cacheable = read.complete;
    changed = true;
  }
  const commitsSinceKnown = { ...cached?.commits_since };
  const commits_in_window: Record<string, boolean> = {};
  for (const p of programs) {
    if (
      p.existing_work === 'new_work_only' &&
      p.starts_at &&
      p.chains.some((c) => chains[c])
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
    await saveRepoFacts(
      repo.full_name,
      repo.pushed_at,
      { chains, commits_since: commitsSinceKnown },
      cached?.fetched_at,
    );
  const facts: RepoFacts = {
    name: repo.name,
    url: repo.html_url,
    homepage: repo.homepage || null,
    created_at: repo.created_at,
    chains,
    commits_in_window,
  };
  return { repo: facts, verdicts: matchRepo(facts, programs) };
}

/** Checks a builder's repos (public on GitHub, or reported by the agent) against open programs. */
export async function matchProjects(input: z.infer<typeof MatchProjectsInput>) {
  const programs = await openProgramFacts();
  const repos: Repo[] = input.repos?.length
    ? await Promise.all(input.repos.map((r) => repoByName(fullName(r))))
    : input.github_user
      ? await userRepos(input.github_user, REPO_LIMIT)
      : [];
  const local = input.local_repos ?? [];

  const results = [
    ...(await mapLimit(repos, 6, (repo) => checkRepo(repo, programs))),
    ...local.map((r) => {
      const facts = reportedFacts(r, programs);
      return { repo: facts, verdicts: matchRepo(facts, programs) };
    }),
  ];
  // Builders want what can earn: "no" verdicts and repos with only those are left out.
  const fits = results
    .map((r) => ({
      repo: r.repo.name,
      repo_url: r.repo.url || null,
      verdicts: r.verdicts.filter((v) => v.status !== 'no'),
    }))
    .filter((r) => r.verdicts.length > 0)
    .sort(
      (a, b) =>
        Number(!a.verdicts.some((v) => v.status === 'likely')) -
        Number(!b.verdicts.some((v) => v.status === 'likely')),
    );
  return { checked: results.length, fits };
}

/** get_program's eligibility check: one repo against one open program. */
export async function checkEligibility(ref: string, programId: string) {
  const program = (await openProgramFacts()).find((p) => p.id === programId);
  if (!program) return null;
  const { verdicts } = await checkRepo(await repoByName(fullName(ref)), [
    program,
  ]);
  const [v] = verdicts;
  if (!v)
    return {
      status: 'no' as const,
      missing: [],
      effort: null,
      note: `no ${program.chains.join(' or ')} code found in this repo`,
    };
  return {
    status: v.status,
    missing: v.missing,
    effort: v.effort,
    note: v.note,
  };
}
