import { z } from 'zod';
import {
  hasCommitsSince,
  mapLimit,
  repoByName,
  repoChains,
  userRepos,
  type Repo,
} from './github';
import { matchRepo, presentMatches, type RepoFacts } from './match';
import { openProgramFacts } from './programs';

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

/** Checks a builder's public repos against open programs and returns verdicts plus ready-to-show text. */
export async function matchProjects(input: z.infer<typeof MatchProjectsInput>) {
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

  return {
    show_to_builder: presentMatches(
      input.repos?.length ? null : input.github_user!,
      repos.length,
      results,
    ),
    note: 'Show show_to_builder to the builder exactly as written. Verdicts are from public code; confirm each "check" before submitting.',
    matches: results
      .filter((r) => r.verdicts.length > 0)
      .map((r) => ({
        repo: r.repo.url,
        homepage: r.repo.homepage,
        chains: r.repo.chains,
        verdicts: r.verdicts,
      })),
  };
}
