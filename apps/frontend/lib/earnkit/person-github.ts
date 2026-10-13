import { isoWeek, type ReaderDeps, type RepoSignals, type Who } from './source-readers';

/**
 * v2.12.1 spec "Scale": "GitHub is one GraphQL query per person per day covering all their repos."
 * Public repos the person owns, newest pushed first (50), each with its homepage, the newest 10
 * stargazers and forks (account ages included, for the fresh-account rule) and commit days of the
 * last 52 weeks (up to 100). Replaces v2.12's per-repo REST reads (about 8 calls a repo).
 */
export const PERSON_GITHUB_QUERY = `query($login: String!, $since: GitTimestamp!) {
  user(login: $login) {
    login twitterUsername websiteUrl
    repositories(first: 50, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        nameWithOwner description homepageUrl isFork isTemplate createdAt pushedAt stargazerCount forkCount
        parent { nameWithOwner } templateRepository { nameWithOwner }
        stargazers(last: 10, orderBy: {field: STARRED_AT, direction: ASC}) { edges { starredAt node { login createdAt } } }
        forks(first: 10, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { createdAt owner { login ... on User { createdAt } } } }
        defaultBranchRef { target { ... on Commit { history(first: 100, since: $since) { nodes { committedDate } } } } }
      }
    }
  }
}`;

export type PersonRepo = RepoSignals & {
  key: string; description: string | null; homepage: string | null; pushed_at: string | null; derived: boolean; stars: number; forks: number;
};
export type PersonGithub = { login: string; twitter: string | null; website: string | null; repos: Map<string, PersonRepo> };

const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
const REPO = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/(?!\.\.?$)[a-z0-9._-]{1,100}$/i;
const str = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
type O = Record<string, unknown>;
const obj = (x: unknown): O => (x && typeof x === 'object' && !Array.isArray(x) ? (x as O) : {});

/** The query's answer as repo signals keyed by lowercase `owner/name`; null for no user or a malformed answer. Pure. */
export function personGithubFrom(json: unknown, now: Date): PersonGithub | null {
  const user = obj(obj(obj(json).data).user);
  const login = str(user.login)?.toLowerCase();
  if (!login || !LOGIN.test(login)) return null;
  const repos = new Map<string, PersonRepo>();
  for (const raw of arr(obj(user.repositories).nodes)) {
    const r = obj(raw);
    const key = str(r.nameWithOwner)?.toLowerCase();
    if (!key || !REPO.test(key)) continue;
    const stargazers: Who[] = arr(obj(r.stargazers).edges).flatMap((e) => {
      const n = obj(obj(e).node);
      const l = str(n.login);
      const at = str(obj(e).starredAt);
      return l && at ? [{ id: `gh:${l.toLowerCase()}`, at, created_at: str(n.createdAt) }] : [];
    });
    const forkers: Who[] = arr(obj(r.forks).nodes).flatMap((f) => {
      const o = obj(obj(f).owner);
      const l = str(o.login);
      const at = str(obj(f).createdAt);
      return l && at ? [{ id: `gh:${l.toLowerCase()}`, at, created_at: str(o.createdAt) }] : [];
    });
    const commits = arr(obj(obj(obj(obj(r.defaultBranchRef).target).history)).nodes)
      .map((c) => Date.parse(str(obj(c).committedDate) ?? ''))
      .filter((t) => Number.isFinite(t) && t <= now.getTime());
    const fork = r.isFork === true;
    const template = r.isTemplate === true;
    repos.set(key, {
      key, owner: key.split('/')[0], owner_type: 'User', private: false,
      created_at: str(r.createdAt), fork, template,
      stargazers, forkers, issue_authors: [], contributors: [],
      commit_weeks: [...new Set(commits.map((t) => isoWeek(new Date(t))))].sort(),
      partial: num(r.stargazerCount) > stargazers.length || num(r.forkCount) > forkers.length,
      description: str(r.description)?.slice(0, 200) ?? null,
      homepage: str(r.homepageUrl), pushed_at: str(r.pushedAt),
      derived: fork || template || obj(r.parent).nameWithOwner !== undefined || obj(r.templateRepository).nameWithOwner !== undefined,
      stars: num(r.stargazerCount), forks: num(r.forkCount),
    });
  }
  return { login, twitter: str(user.twitterUsername), website: str(user.websiteUrl), repos };
}

/** One GraphQL call for `login` (commit days since 52 weeks before `d.now`). */
export async function readPersonGithub(login: string, d: ReaderDeps): Promise<PersonGithub | null> {
  if (!LOGIN.test(login)) throw new Error('not a GitHub login');
  const since = new Date(d.now.getTime() - 52 * 7 * 86_400_000).toISOString();
  return personGithubFrom(await d.ghGraphql(PERSON_GITHUB_QUERY, { login, since }), d.now);
}
