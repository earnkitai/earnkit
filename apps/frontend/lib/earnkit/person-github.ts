import { isoWeek, type ReaderDeps, type RepoSignals } from './source-readers';

/**
 * The fields read for every repo, in the person query and the by-name query: its homepage and commit days
 * of the last 52 weeks (the newest 100 commits; sources.ts keeps earlier weeks from the previous reading).
 * Scoring and clarity R16b: no stargazers or forks (no score uses them).
 */
const REPO_FIELDS = `nameWithOwner description homepageUrl primaryLanguage { name } isFork isTemplate isPrivate createdAt pushedAt
        owner { __typename login }
        parent { nameWithOwner } templateRepository { nameWithOwner }
        defaultBranchRef { target { ... on Commit { history(first: 100, since: $since) { totalCount nodes { committedDate } } } } }`;

/**
 * v2.12.1 spec "Scale": "GitHub is one GraphQL query per person per day covering all their repos."
 * Public repos the person owns, newest pushed first (100), each with REPO_FIELDS. Replaces v2.12's
 * per-repo REST reads (about 8 calls a repo). A tracked repo outside the newest 100 is read by name
 * (reposQuery), up to REPOS_MAX in one more call.
 */
export const PERSON_GITHUB_QUERY = `query($login: String!, $since: GitTimestamp!) {
  user(login: $login) {
    login twitterUsername websiteUrl
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        ${REPO_FIELDS}
      }
    }
  }
}`;

/**
 * v2.12.2: the light listing of a reported login's own public repos (names, homepages, languages;
 * no stargazers, forks or commits). About 1 s where PERSON_GITHUB_QUERY takes 6 s or more (or times
 * out) on an account with popular repos: the on-demand refresh has 8 s. Never a reading: repos it
 * finds are proposed only, and the daily read reads them in full.
 */
export const OWNED_REPOS_QUERY = `query($login: String!, $first: Int!) {
  user(login: $login) {
    login twitterUsername websiteUrl
    repositories(first: $first, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        nameWithOwner description homepageUrl primaryLanguage { name } isFork isTemplate isPrivate createdAt pushedAt
        owner { __typename login }
        parent { nameWithOwner } templateRepository { nameWithOwner }
      }
    }
  }
}`;

/** At most this many repos are read by name in one GraphQL call (one alias each). */
export const REPOS_MAX = 25;

/** One aliased `repository(owner:, name:)` per repo (`r0`..), names passed as variables, never inlined. Pure. */
export function reposQuery(n: number): string {
  const i = Array.from({ length: n }, (_, k) => k);
  return `query($since: GitTimestamp!, ${i.map((k) => `$o${k}: String!, $n${k}: String!`).join(', ')}) {
${i.map((k) => `  r${k}: repository(owner: $o${k}, name: $n${k}) {\n        ${REPO_FIELDS}\n  }`).join('\n')}
}`;
}

export type PersonRepo = RepoSignals & {
  /** v2.12.2: the repo's name as GitHub writes it ("Hello-World"; `key` is lowercase). */
  name?: string | null;
  /** v2.12.2: a sign it is a website (a homepage, or mostly web code): only then is putting it online offered. */
  web?: boolean;
  key: string; description: string | null; homepage: string | null; pushed_at: string | null; derived: boolean;
};
export type PersonGithub = { login: string; twitter: string | null; website: string | null; repos: Map<string, PersonRepo> };

const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
const REPO = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/(?!\.\.?$)[a-z0-9._-]{1,100}$/i;
const str = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
type O = Record<string, unknown>;
const obj = (x: unknown): O => (x && typeof x === 'object' && !Array.isArray(x) ? (x as O) : {});
const DAY_MS = 86_400_000;
const since = (now: Date) => new Date(now.getTime() - 52 * 7 * DAY_MS).toISOString();

/** v2.12.2: GitHub primary languages that make a repo a likely website (static or a web framework). */
const WEB_LANGS = new Set(['html', 'css', 'javascript', 'typescript', 'vue', 'svelte', 'astro', 'mdx']);

/**
 * Hotfix 2026-10-19: the weeks of the last 52 (this week first) as [since, until) windows, Monday 00:00 UTC; this week
 * ends at `now` (a commit dated in the future counts nowhere, as repoFrom). Pure.
 */
export function commitWindows(now: Date): { week: string; since: string; until: string }[] {
  const day = Math.floor(now.getTime() / DAY_MS);
  const monday = (day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7)) * DAY_MS;
  return Array.from({ length: 52 }, (_, i) => {
    const since = monday - i * 7 * DAY_MS;
    return { week: isoWeek(new Date(since)), since: new Date(since).toISOString(), until: new Date(i === 0 ? now.getTime() : since + 7 * DAY_MS).toISOString() };
  });
}

/**
 * Hotfix 2026-10-19: one repo's commit count in each of the last 52 weeks (commitWindows), one alias a week
 * (`w0`.. totalCount, cost 1, about 1.5 s). Read only when REPO_FIELDS' newest 100 commits don't reach back 52 weeks
 * (a busy repo: 100 commits can be a few days). The owner and name are variables, never inlined. Pure.
 */
export function weeklyCommitsQuery(now: Date): string {
  const w = commitWindows(now);
  return `query($o: String!, $n: String!) {
  repository(owner: $o, name: $n) { defaultBranchRef { target { ... on Commit {
${w.map((x, i) => `    w${i}: history(since: "${x.since}", until: "${x.until}") { totalCount }`).join('\n')}
  } } } }
}`;
}

/** weeklyCommitsQuery's answer as { week: count } (weeks with commits only); null when malformed. Pure. */
export function weeklyCommitsFrom(json: unknown, now: Date): Record<string, number> | null {
  const t = obj(obj(obj(obj(obj(json).data).repository).defaultBranchRef).target);
  const out: Record<string, number> = {};
  const w = commitWindows(now);
  for (let i = 0; i < w.length; i++) {
    const n = obj(t[`w${i}`]).totalCount;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
    if (n > 0) out[w[i].week] = n;
  }
  return out;
}

/**
 * A repo read whose newest 100 commits missed some (history totalCount above the nodes read) gets its whole
 * 52 weeks from weeklyCommitsQuery through `ask` (the reader's GraphQL, EarnKit's token or the App's); a full
 * read is returned as is. A failed weekly read throws (the caller writes a failed reading, never a short one).
 */
async function withAllWeeks(r: RepoRead, now: Date, ask: (query: string, variables: Record<string, unknown>) => Promise<unknown>): Promise<PersonRepo> {
  const { truncated, ...repo } = r;
  if (!truncated) return repo;
  const [o, n] = repo.key.split('/');
  const counts = weeklyCommitsFrom(await ask(weeklyCommitsQuery(now), { o, n }), now);
  if (!counts) throw new Error('GitHub answered no weekly commit counts');
  return { ...repo, commit_counts: counts, commit_weeks: Object.keys(counts).sort() };
}

type RepoRead = PersonRepo & { truncated: boolean };

/** One repo node (REPO_FIELDS) as repo signals, or null when it is malformed. `truncated`: the newest 100 commits are not all of the 52 weeks'. Pure. */
function repoFrom(raw: unknown, now: Date): RepoRead | null {
  const r = obj(raw);
  const key = str(r.nameWithOwner)?.toLowerCase();
  if (!key || !REPO.test(key)) return null;
  const history = obj(obj(obj(r.defaultBranchRef).target).history);
  const nodes = arr(history.nodes);
  const total = history.totalCount;
  const commits = nodes
    .map((c) => Date.parse(str(obj(c).committedDate) ?? ''))
    .filter((t) => Number.isFinite(t) && t <= now.getTime());
  const counts: Record<string, number> = {};
  for (const t of commits) {
    const w = isoWeek(new Date(t));
    counts[w] = (counts[w] ?? 0) + 1;
  }
  const fork = r.isFork === true;
  const template = r.isTemplate === true;
  return {
    key, owner: key.split('/')[0], owner_type: obj(r.owner).__typename === 'Organization' ? 'Organization' : 'User', private: r.isPrivate === true,
    created_at: str(r.createdAt), fork, template,
    stargazers: [], forkers: [], issue_authors: [], contributors: [],
    commit_weeks: [...new Set(commits.map((t) => isoWeek(new Date(t))))].sort(),
    commit_counts: counts,
    partial: false,
    description: str(r.description)?.slice(0, 200) ?? null,
    name: str(r.nameWithOwner)?.split('/')[1] ?? null,
    web: str(r.homepageUrl) !== null || WEB_LANGS.has(str(obj(r.primaryLanguage).name)?.toLowerCase() ?? ''),
    homepage: str(r.homepageUrl), pushed_at: str(r.pushedAt),
    derived: fork || template || obj(r.parent).nameWithOwner !== undefined || obj(r.templateRepository).nameWithOwner !== undefined,
    truncated: typeof total === 'number' && total > nodes.length,
  };
}

/** The query's answer as repo signals keyed by lowercase `owner/name`; null for no user or a malformed answer. Pure. */
export function personGithubFrom(json: unknown, now: Date): PersonGithub | null {
  const user = obj(obj(obj(json).data).user);
  const login = str(user.login)?.toLowerCase();
  if (!login || !LOGIN.test(login)) return null;
  const repos = new Map<string, PersonRepo>();
  for (const raw of arr(obj(user.repositories).nodes)) {
    const r = repoFrom(raw, now);
    if (!r) continue;
    const { truncated: _t, ...repo } = r;
    repos.set(repo.key, repo);
  }
  return { login, twitter: str(user.twitterUsername), website: str(user.websiteUrl), repos };
}

/**
 * Up to REPOS_MAX repos by name ('owner/name') in one GraphQL call: a tracked repo outside the person
 * query's newest 100, or an organization's repo. Keyed by the asked name (lowercase); a repo GitHub
 * does not know, or a malformed name (never sent), is absent.
 */
export async function readGithubRepos(keys: string[], d: ReaderDeps): Promise<Map<string, PersonRepo>> {
  // A malformed name is never sent (it is absent from the answer); the rest still are.
  const asked = [...new Set(keys.map((k) => k.toLowerCase()))].filter((k) => REPO.test(k));
  if (asked.length === 0) return new Map();
  if (asked.length > REPOS_MAX) throw new Error('too many repo names');
  const variables: Record<string, unknown> = { since: since(d.now) };
  asked.forEach((k, i) => {
    const [o, n] = k.split('/');
    variables[`o${i}`] = o;
    variables[`n${i}`] = n;
  });
  const data = obj(obj(await d.ghGraphql(reposQuery(asked.length), variables)).data);
  const out = new Map<string, PersonRepo>();
  for (const [i, k] of asked.entries()) {
    const r = repoFrom(data[`r${i}`], d.now);
    if (r) out.set(k, await withAllWeeks({ ...r, key: k }, d.now, (q, v) => d.ghGraphql(q, v)));
  }
  return out;
}

/** v2.13 (R2): the person's GitHub profile only, for the X field match; no repos (about 0.2 s). */
export const GITHUB_USER_QUERY = `query($login: String!) { user(login: $login) { login twitterUsername websiteUrl } }`;
export async function readGithubUser(login: string, d: ReaderDeps): Promise<PersonGithub | null> {
  if (!LOGIN.test(login)) throw new Error('not a GitHub login');
  return personGithubFrom(await d.ghGraphql(GITHUB_USER_QUERY, { login }), d.now);
}

/**
 * v2.13.3 (5): the repos EarnKit's own token can't read (private, or an org's it can't see), each read
 * with the read-only GitHub App's installation token for exactly that repo, minted per call for the
 * person whose source it is (github-app.ts appTokenFor: only their own App proof of that repo). Never
 * stored or logged. One GraphQL call each (reposQuery). Keyed by source id, so one person's
 * installation never reads into another's source. Only under the Bench, with the App on and a fetch;
 * a repo without a token is absent. A failed read throws (the caller writes a failed reading).
 */
export async function readAppRepos(items: { id: number; builder_id: number; ref: string }[], d: ReaderDeps): Promise<Map<number, PersonRepo>> {
  const out = new Map<number, PersonRepo>();
  const f = d.ghFetch;
  if (!f || items.length === 0) return out;
  const { appTokenFor, githubAppEnabled } = await import('./github-app');
  if (!githubAppEnabled()) return out;
  const { graphqlErrors, graphqlUsable } = await import('./source-readers');
  for (const s of items) {
    const key = s.ref.toLowerCase();
    if (!REPO.test(key)) continue;
    const token = await appTokenFor({ installationId: s.builder_id, repoKey: key }, { fetch: f });
    if (!token) continue;
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'earnkit', Authorization: `Bearer ${token}` };
    const [o, n] = key.split('/');
    const ask = async (query: string, variables: Record<string, unknown>): Promise<unknown> => {
      const res = await f('https://api.github.com/graphql', {
        method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(15_000), body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`GitHub GraphQL returned ${res.status}`);
      }
      const body = (await res.json()) as unknown;
      if (!graphqlUsable(body)) throw new Error(graphqlErrors(body));
      return body;
    };
    const r = repoFrom(obj(obj(await ask(reposQuery(1), { since: since(d.now), o0: o, n0: n })).data).r0, d.now);
    if (!r || r.key !== key) continue;
    out.set(s.id, await withAllWeeks({ ...r, key }, d.now, ask));
  }
  return out;
}
