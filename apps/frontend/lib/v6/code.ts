/**
 * Code evidence rows for one public repo: fork parent, the fork's own commits and share, overlap with a
 * known starter and the files beyond it, activity in 60 and 90 days (a fork's: only commits after the fork
 * point), releases, tests, CI and issues. Every row is a read fact; a failed read is null with a note.
 * Reads stop when the GitHub budget runs low.
 */
import { GitHubError, ghPage, ghResponse, rateRemaining, type RepoRead } from '../v5/github';
import BOILERPLATES from './boilerplates.json';

export type CodeRows = {
  fork_of: string | null;
  template_overlap: number | null;
  template_name: string | null;
  own_share: number | null;
  /** A fork's commits after the fork point (the compare's ahead_by); null for a repo that is not a fork. */
  commits_own: number | null;
  /** Non-generic files outside the matched starter; null when no starter matched. */
  files_own: number | null;
  first_commit_at: string | null;
  last_push_at: string | null;
  commits_90d: number | null;
  commits_60d: number | null;
  active_weeks_90d: number | null;
  releases: number | null;
  has_tests: boolean | null;
  has_ci: boolean | null;
  issues_open: number | null;
  issues_answered_90d: number | null;
  /** L15-7 (v6.1.14): the repo has no commits (GitHub's size 0); nothing else is read. Absent on rows cached before. */
  empty?: boolean;
  note: string | null;
};

/** One evidence read's GitHub allowance, shared by every reader in it. */
export type Budget = { remaining: number | null; stopped: boolean };
/** A recorded starter: its tree paths and its top contributors (whose commits are not the applicant's). */
export type Boilerplate = { name: string; repo: string; recorded_at: string; paths: string[]; maintainers?: string[] };
const STARTERS = BOILERPLATES as Boilerplate[];

/** Whether `full` (owner/name) is a recorded starter's repo. Pure. */
export function isStarterRepo(full: string | null): boolean {
  return !!full && STARTERS.some((b) => b.repo.toLowerCase() === full.toLowerCase());
}
/** The recorded maintainers of the starter named `name`, lowercased; none when unknown. Pure. */
export function starterMaintainers(name: string | null): string[] {
  const b = name ? STARTERS.find((x) => x.name === name) : undefined;
  return (b?.maintainers ?? []).map((m) => m.toLowerCase());
}
export type GhRead = { gh: typeof fetch; token?: string; now: Date; budget: Budget };

/** Under this many requests left in the hour, readers stop: what other tools need stays available. */
export const BUDGET_FLOOR = 500;
/** Fewer shared paths than this is chance (a layout and a page file), not a starter carried over. */
const MIN_MATCHING_PATHS = 8;
/** Commit pages read for 90 days: 3 of 100. */
const COMMIT_PAGES = 3;
/** Days of commits that make a repo building (design section 7); the window read stays 90 days. */
export const BUILDING_DAYS = 60;
/** The compare lists at most this many commits unpaged (oldest first); past it the newest pages are read. */
const COMPARE_MAX = 250;
/** Under this overlap a starter match is chance (shared config file names), so neither the name nor the share is reported. */
export const TEMPLATE_FLOOR = 0.2;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|out)\//;
/** Files every project has whatever it started from: never evidence of a starter. */
const GENERIC = /(^|\/)(README[^/]*|LICENSE[^/]*|\.gitignore|\.editorconfig|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json|\.prettierrc[^/]*|\.eslintrc[^/]*)$/i;

const setRemaining = (b: Budget, n: number | null) => {
  if (n === null) return;
  b.remaining = n;
  if (n < BUDGET_FLOOR) b.stopped = true;
};
/** Reads x-ratelimit-remaining from a GitHub response; under 500 the budget stops. */
export function noteBudget(b: Budget, res: Response): void {
  setRemaining(b, rateRemaining(res));
}

/** A read's result: the value, or why it was not read. */
export type Got<T> = { ok: true; value: T } | { ok: false; why: string };

/** Why a request that was made failed. A rate-limit refusal (403 or 429 with nothing left) is the budget. */
const whyNot = (e: unknown, b: Budget): string => {
  if (!(e instanceof GitHubError)) return 'not read: github unreachable';
  setRemaining(b, e.remaining);
  if ((e.status === 403 || e.status === 429) && e.remaining === 0) return 'not read: budget';
  return e.status === 404 ? 'not read: private or missing' : `not read: github ${e.status ?? 'error'}`;
};

/** One GitHub object, within the budget. Never throws. */
export async function ghObject<T>(path: string, o: GhRead): Promise<Got<T>> {
  if (o.budget.stopped) return { ok: false, why: 'not read: budget' };
  try {
    const res = await ghResponse(path, o.token, o.gh);
    noteBudget(o.budget, res);
    return { ok: true, value: (await res.json()) as T };
  } catch (e) {
    return { ok: false, why: whyNot(e, o.budget) };
  }
}

/** One page of a GitHub list, within the budget. Never throws. */
export async function ghList<T>(path: string, o: GhRead): Promise<Got<{ rows: T[]; last: number | null }>> {
  if (o.budget.stopped) return { ok: false, why: 'not read: budget' };
  try {
    const p = await ghPage<T>(path, o.token, o.gh);
    setRemaining(o.budget, p.remaining);
    return { ok: true, value: { rows: p.rows, last: p.last } };
  } catch (e) {
    return { ok: false, why: whyNot(e, o.budget) };
  }
}

/** Items in a list read one per page: the last page number, else the rows on the only page. */
const countOf = (p: { rows: unknown[]; last: number | null }) => p.last ?? p.rows.length;

/** The 90-day window's start, at midnight UTC so the request URL is the same all day. Pure. */
export function since90(now: Date): string {
  return `${new Date(now.getTime() - 90 * DAY).toISOString().slice(0, 10)}T00:00:00Z`;
}

const own = (paths: string[]) => paths.filter((p) => !SKIP_DIRS.test(p) && !GENERIC.test(p));

/**
 * The starter the repo is most made of: the share of the repo's paths that are that starter's paths.
 * Build folders and generic files (README, licence, manifests, lockfiles, tool configs) are left out
 * on both sides; a match needs 8+ shared paths, else null. `files_own` counts the repo's paths outside it. Pure.
 */
export function templateOverlap(paths: string[], boilerplates: Boilerplate[]): { name: string; overlap: number; files_own: number } | null {
  const mine = [...new Set(own(paths))];
  if (mine.length === 0) return null;
  let best: { name: string; overlap: number; files_own: number } | null = null;
  for (const b of boilerplates) {
    const theirs = new Set(own(b.paths));
    const shared = mine.filter((p) => theirs.has(p)).length;
    if (shared < MIN_MATCHING_PATHS) continue;
    const overlap = shared / mine.length;
    if (!best || overlap > best.overlap) best = { name: b.name, overlap, files_own: mine.length - shared };
  }
  return best;
}

const VENDORED = /(^|\/)(node_modules|vendor|dist|build|\.next|out)\//;
/** Test files or folders outside vendored code (JS/TS, Solidity, Python, Go, Rust). Pure. */
export function hasTests(paths: string[]): boolean {
  return paths.some(
    (p) =>
      !VENDORED.test(p) &&
      (/(^|\/)(test|tests|__tests__|spec)\/[^/]+/.test(p) ||
        /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
        /\.t\.sol$/.test(p) ||
        /(^|\/)test_[^/]+\.py$|_test\.(py|go)$/.test(p)),
  );
}

/** A CI config: a GitHub Actions workflow or .gitlab-ci.yml. A deploy config (vercel.json) is not CI. Pure. */
export function hasCi(paths: string[]): boolean {
  return paths.some((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) || p === '.gitlab-ci.yml');
}

/** Distinct 7-day spans, counted back from now, holding at least one date in the last 90 days. Pure. */
export function activeWeeks(dates: string[], now: Date): number {
  const weeks = new Set<number>();
  for (const d of dates) {
    const age = now.getTime() - Date.parse(d);
    if (age >= 0 && age <= 90 * DAY) weeks.add(Math.floor(age / WEEK));
  }
  return weeks.size;
}

type CommitRow = {
  sha?: string;
  author?: { login?: string; type?: string } | null;
  commit?: { author?: { date?: string }; committer?: { date?: string } };
};
/**
 * The 90-day commits read: dates and linked GitHub authors, whether the window was cut short (`cap` is
 * the number of commits it held then), or why it was not read.
 */
export type CommitWindow = { ok: true; count: number; dates: string[]; authors: string[]; capped: boolean; cap: number } | { ok: false; why: string };
/** A fork and the parent it is compared with. */
export type ForkRef = { parent: string; parent_branch: string; branch: string };
/** The fork read by readRepo, or null when the repo is not a fork. Pure. */
export function forkRef(read: RepoRead): ForkRef | null {
  const r = read.repo;
  return r.fork && r.parent ? { parent: r.parent.full_name, parent_branch: r.parent.default_branch, branch: r.default_branch } : null;
}

// One window and one compare per repo per Budget: readCode and readTeam share them.
const windows = new WeakMap<Budget, Map<string, Promise<CommitWindow>>>();
const compares = new WeakMap<Budget, Map<string, Promise<Got<Compare>>>>();
const memo = <T>(m: WeakMap<Budget, Map<string, Promise<T>>>, b: Budget, key: string, read: () => Promise<T>): Promise<T> => {
  const byKey = m.get(b) ?? new Map<string, Promise<T>>();
  m.set(b, byKey);
  const hit = byKey.get(key);
  if (hit) return hit;
  const p = read();
  byKey.set(key, p);
  return p;
};

type CompareBody = { ahead_by?: number; commits?: CommitRow[] };
/** The fork's commits after the fork point, oldest first: all of them, else the newest 200 (`capped`). */
type Compare = { ahead_by: number | null; commits: CommitRow[]; capped: boolean };

/** Compares the fork with its parent: one request, two more when over 250 commits. Never throws. */
export function readCompare(full: string, fork: ForkRef, o: GhRead): Promise<Got<Compare>> {
  return memo(compares, o.budget, `${full.toLowerCase()} ${fork.parent.toLowerCase()}`, async () => {
    const [owner] = fork.parent.split('/');
    const base = `/repos/${full}/compare/${encodeURIComponent(`${owner}:${fork.parent_branch}`)}...${encodeURIComponent(fork.branch)}`;
    const first = await ghObject<CompareBody>(base, o);
    if (!first.ok) return { ok: false, why: first.why };
    const ahead = typeof first.value.ahead_by === 'number' ? first.value.ahead_by : null;
    const commits = Array.isArray(first.value.commits) ? first.value.commits : [];
    if (ahead === null || ahead <= commits.length || commits.length < COMPARE_MAX) return { ok: true, value: { ahead_by: ahead, commits, capped: false } };
    // Past 250 the list is the oldest; the last two pages of 100 hold the newest.
    const last = Math.ceil(ahead / 100);
    const newest: CommitRow[] = [];
    for (const page of [last - 1, last]) {
      const p = await ghObject<CompareBody>(`${base}?per_page=100&page=${page}`, o);
      if (!p.ok) return { ok: false, why: p.why };
      newest.push(...(Array.isArray(p.value.commits) ? p.value.commits : []));
    }
    return { ok: true, value: { ahead_by: ahead, commits: newest, capped: true } };
  });
}

const dateOf = (c: CommitRow) => c.commit?.author?.date ?? c.commit?.committer?.date;
const loginOf = (c: CommitRow) => {
  const login = c.author?.login;
  return login && c.author?.type !== 'Bot' && !login.endsWith('[bot]') ? login : null;
};

/**
 * The repo's commits in 90 days, read once per Budget: up to 3 pages of 100, or for a fork only the
 * commits after the fork point (the upstream's own commits are not the fork's). Never throws.
 */
export function readCommitWindow(full: string, o: GhRead, fork: ForkRef | null = null): Promise<CommitWindow> {
  const since = since90(o.now);
  return memo(windows, o.budget, `${full.toLowerCase()} ${o.now.toISOString().slice(0, 10)} ${fork ? 'fork' : 'all'}`, async (): Promise<CommitWindow> => {
    const dates: string[] = [];
    const authors: string[] = [];
    let count = 0;
    const take = (c: CommitRow) => {
      count++;
      const d = dateOf(c);
      if (d) dates.push(d);
      const login = loginOf(c);
      if (login) authors.push(login);
    };
    if (fork) {
      const cmp = await readCompare(full, fork, o);
      if (!cmp.ok) return { ok: false, why: cmp.why === 'not read: private or missing' ? 'not read: parent gone' : cmp.why };
      const recent = cmp.value.commits.filter((c) => (dateOf(c) ?? '') >= since);
      recent.forEach(take);
      // Cut short only when the oldest commit held is itself inside the window.
      const oldest = dateOf(cmp.value.commits[0] ?? {});
      const capped = cmp.value.capped && !!oldest && oldest >= since;
      return { ok: true, count, dates, authors, capped, cap: cmp.value.commits.length };
    }
    for (let page = 1; page <= COMMIT_PAGES; page++) {
      const p = await ghList<CommitRow>(`/repos/${full}/commits?since=${since}&per_page=100${page > 1 ? `&page=${page}` : ''}`, o);
      if (!p.ok) return { ok: false, why: p.why };
      p.value.rows.forEach(take);
      if (p.value.rows.length < 100) return { ok: true, count, dates, authors, capped: false, cap: COMMIT_PAGES * 100 };
    }
    return { ok: true, count, dates, authors, capped: true, cap: COMMIT_PAGES * 100 };
  });
}
type IssueRow = { state?: string; comments?: number; pull_request?: unknown };
/** Issues read from the search per request, newest updated first. */
const ISSUES_PAGE = 100;

/**
 * Open issues without pull requests, from the search API. Its own rate limit (30 a minute) is not the
 * core budget, so its headers never stop the budget; a failure is null with 'not read: issues search'.
 */
async function openIssues(full: string, o: GhRead): Promise<Got<number>> {
  if (o.budget.stopped) return { ok: false, why: 'not read: budget' };
  try {
    const res = await ghResponse(`/search/issues?q=repo:${full}+is:issue+is:open&per_page=1`, o.token, o.gh);
    const n = ((await res.json()) as { total_count?: unknown }).total_count;
    return typeof n === 'number' ? { ok: true, value: n } : { ok: false, why: 'not read: issues search' };
  } catch {
    return { ok: false, why: 'not read: issues search' };
  }
}

/**
 * Issues (never pull requests) updated in 90 days that were answered: commented on or closed. One search
 * page of the newest 100; `more` when the window holds more. Search rate limits never stop the budget.
 */
async function answeredIssues(full: string, since: string, o: GhRead): Promise<Got<{ answered: number; more: boolean }>> {
  if (o.budget.stopped) return { ok: false, why: 'not read: budget' };
  try {
    const q = `repo:${full}+is:issue+updated:${encodeURIComponent('>=')}${since.slice(0, 10)}`;
    const res = await ghResponse(`/search/issues?q=${q}&per_page=${ISSUES_PAGE}`, o.token, o.gh);
    const body = (await res.json()) as { total_count?: unknown; items?: IssueRow[] };
    if (typeof body.total_count !== 'number' || !Array.isArray(body.items)) return { ok: false, why: 'not read: issues search' };
    const answered = body.items.filter((i) => !i.pull_request && ((i.comments ?? 0) > 0 || i.state === 'closed')).length;
    return { ok: true, value: { answered, more: body.total_count > ISSUES_PAGE } };
  } catch {
    return { ok: false, why: 'not read: issues search' };
  }
}

/** Reads the code rows for a repo already read by readRepo. Never throws. */
export async function readCode(read: RepoRead, o: GhRead): Promise<CodeRows> {
  const notes: string[] = [];
  const miss = (why: string) => {
    if (!notes.includes(why)) notes.push(why);
    return null;
  };
  const { repo } = read;
  const full = repo.full_name;
  // L15-7 (v6.1.14): an empty repo has no tree or commits to read; it reads as empty, not as a partial read.
  if (repo.size === 0) {
    return {
      fork_of: repo.fork && repo.parent ? repo.parent.full_name : null, template_overlap: null, template_name: null, own_share: null, commits_own: null,
      files_own: null, first_commit_at: null, last_push_at: repo.pushed_at ?? null, commits_90d: 0, commits_60d: 0, active_weeks_90d: 0, releases: null,
      has_tests: null, has_ci: null, issues_open: null, issues_answered_90d: null, empty: true, note: null,
    };
  }
  const paths = read.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  // A failed tree read is an empty tree; a failed README or file read (partial) leaves the tree usable.
  const treeRead = paths.length > 0;
  const fork_of = repo.fork && repo.parent ? repo.parent.full_name : null;

  // A fork is measured against its parent; a starter it forked is not also a template match.
  const fork = forkRef(read);
  const starters = STARTERS.filter((b) => !fork_of || b.repo.toLowerCase() !== fork_of.toLowerCase());
  const match = treeRead ? templateOverlap(paths, starters) : null;
  const matched = match && match.overlap >= TEMPLATE_FLOOR ? match : null;

  let own_share: number | null = null;
  let commits_own: number | null = null;
  if (fork) {
    const cmp = await readCompare(full, fork, o);
    const total = cmp.ok ? await ghList<CommitRow>(`/repos/${full}/commits?per_page=1`, o) : null;
    if (!cmp.ok) miss(cmp.why === 'not read: private or missing' ? 'own_share not read: parent gone' : cmp.why);
    else {
      commits_own = cmp.value.ahead_by;
      if (total && !total.ok) miss(total.why);
      else if (total?.ok && cmp.value.ahead_by !== null && countOf(total.value) > 0) own_share = Math.min(1, cmp.value.ahead_by / countOf(total.value));
    }
  } else if (matched) own_share = 1 - matched.overlap;

  const since = since90(o.now);
  const window = await readCommitWindow(full, o, fork);
  const commits_90d = window.ok ? window.count : miss(window.why === 'not read: parent gone' ? 'commits_90d not read: parent gone' : window.why);
  if (window.ok && window.capped) {
    miss(`commits_90d capped at ${window.cap}`);
    miss(`commits_60d from newest ${window.cap} commits`);
    miss(`active_weeks_90d from newest ${window.cap} commits`);
  }
  const since60 = o.now.getTime() - BUILDING_DAYS * DAY;
  const commits_60d = window.ok ? window.dates.filter((d) => Date.parse(d) >= since60).length : null;

  const releases = await ghList(`/repos/${full}/releases?per_page=1`, o);
  const open = await openIssues(full, o);
  const recent = await answeredIssues(full, since, o);
  if (recent.ok && recent.value.more) miss('issues_answered_90d from newest 100');

  if (!treeRead) miss('not read: tree');
  return {
    fork_of,
    template_overlap: matched?.overlap ?? null,
    template_name: matched?.name ?? null,
    own_share,
    commits_own,
    files_own: matched?.files_own ?? null,
    first_commit_at: read.first_commit_at,
    last_push_at: repo.pushed_at ?? null,
    commits_90d,
    commits_60d,
    active_weeks_90d: window.ok ? activeWeeks(window.dates, o.now) : null,
    releases: releases.ok ? countOf(releases.value) : miss(releases.why),
    has_tests: treeRead ? hasTests(paths) : null,
    has_ci: treeRead ? hasCi(paths) : null,
    issues_open: open.ok ? open.value : miss(open.why),
    issues_answered_90d: recent.ok ? recent.value.answered : miss(recent.why),
    note: notes.length ? notes.join('; ') : null,
  };
}
