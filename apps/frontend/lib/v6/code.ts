/**
 * Code evidence rows for one public repo: fork parent and the fork's own share, overlap with a known
 * starter, activity in 90 days, releases, tests, CI and issues. Every row is a read fact; a skipped or
 * failed read leaves the row null and the note says why. Reads stop when the GitHub budget runs low.
 */
import { GitHubError, ghPage, ghResponse, rateRemaining, type RepoRead } from '../v5/github';
import BOILERPLATES from './boilerplates.json';

export type CodeRows = {
  fork_of: string | null;
  template_overlap: number | null;
  template_name: string | null;
  own_share: number | null;
  first_commit_at: string | null;
  last_push_at: string | null;
  commits_90d: number | null;
  active_weeks_90d: number | null;
  releases: number | null;
  has_tests: boolean | null;
  has_ci: boolean | null;
  issues_open: number | null;
  issues_answered_90d: number | null;
  note: string | null;
};

/** One evidence read's GitHub allowance, shared by every reader in it. */
export type Budget = { remaining: number | null; stopped: boolean };
export type Boilerplate = { name: string; repo: string; recorded_at: string; paths: string[] };
export type GhRead = { gh: typeof fetch; token?: string; now: Date; budget: Budget };

/** Under this many requests left in the hour, readers stop: what other tools need stays available. */
export const BUDGET_FLOOR = 500;
/** Fewer shared paths than this is chance (a layout and a page file), not a starter carried over. */
const MIN_MATCHING_PATHS = 8;
/** Commit pages read for 90 days: 3 of 100. */
const COMMIT_PAGES = 3;
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
 * on both sides; a match needs 8+ shared paths, else null. Pure.
 */
export function templateOverlap(paths: string[], boilerplates: Boilerplate[]): { name: string; overlap: number } | null {
  const mine = [...new Set(own(paths))];
  if (mine.length === 0) return null;
  let best: { name: string; overlap: number } | null = null;
  for (const b of boilerplates) {
    const theirs = new Set(own(b.paths));
    const shared = mine.filter((p) => theirs.has(p)).length;
    if (shared < MIN_MATCHING_PATHS) continue;
    const overlap = shared / mine.length;
    if (!best || overlap > best.overlap) best = { name: b.name, overlap };
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

type CommitRow = { author?: { login?: string; type?: string } | null; commit?: { author?: { date?: string }; committer?: { date?: string } } };
/** The 90-day commits read: dates and linked GitHub authors, whether the 300 cap was hit, or why it was not read. */
export type CommitWindow = { ok: true; count: number; dates: string[]; authors: string[]; capped: boolean } | { ok: false; why: string };

// One window read per evidence read: readCode and readTeam share the Budget, so they share the commits.
const windows = new WeakMap<Budget, Map<string, Promise<CommitWindow>>>();

/** The repo's commits in 90 days: up to 3 pages of 100, read once per Budget. Never throws. */
export function readCommitWindow(full: string, o: GhRead): Promise<CommitWindow> {
  const byRepo = windows.get(o.budget) ?? new Map<string, Promise<CommitWindow>>();
  windows.set(o.budget, byRepo);
  const key = `${full.toLowerCase()} ${o.now.toISOString().slice(0, 10)}`;
  const hit = byRepo.get(key);
  if (hit) return hit;
  const read = (async (): Promise<CommitWindow> => {
    const since = since90(o.now);
    const dates: string[] = [];
    const authors: string[] = [];
    let count = 0;
    for (let page = 1; page <= COMMIT_PAGES; page++) {
      const p = await ghList<CommitRow>(`/repos/${full}/commits?since=${since}&per_page=100${page > 1 ? `&page=${page}` : ''}`, o);
      if (!p.ok) return p;
      count += p.value.rows.length;
      for (const c of p.value.rows) {
        const d = c.commit?.author?.date ?? c.commit?.committer?.date;
        if (d) dates.push(d);
        const login = c.author?.login;
        if (login && c.author?.type !== 'Bot' && !login.endsWith('[bot]')) authors.push(login);
      }
      if (p.value.rows.length < 100) return { ok: true, count, dates, authors, capped: false };
    }
    return { ok: true, count, dates, authors, capped: true };
  })();
  byRepo.set(key, read);
  return read;
}
type IssueRow = { state?: string; comments?: number; pull_request?: unknown };
/** Issues read from the search per request, newest updated first. */
const ISSUES_PAGE = 100;
type Compare = { ahead_by?: number };

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
  const paths = read.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  // A failed tree read is an empty tree; a failed README or file read (partial) leaves the tree usable.
  const treeRead = paths.length > 0;
  const fork_of = repo.fork && repo.parent ? repo.parent.full_name : null;

  // A fork is measured against its parent; a starter it forked is not also a template match.
  const starters = (BOILERPLATES as Boilerplate[]).filter((b) => !fork_of || b.repo.toLowerCase() !== fork_of.toLowerCase());
  const match = treeRead ? templateOverlap(paths, starters) : null;
  const matched = match && match.overlap >= TEMPLATE_FLOOR ? match : null;

  let own_share: number | null = null;
  if (fork_of && repo.parent) {
    const [owner] = fork_of.split('/');
    const cmp = await ghObject<Compare>(
      `/repos/${full}/compare/${encodeURIComponent(`${owner}:${repo.parent.default_branch}`)}...${encodeURIComponent(repo.default_branch)}`,
      o,
    );
    const total = cmp.ok ? await ghList<CommitRow>(`/repos/${full}/commits?per_page=1`, o) : null;
    if (!cmp.ok) miss(cmp.why === 'not read: private or missing' ? 'own_share not read: parent gone' : cmp.why);
    else if (total && !total.ok) miss(total.why);
    else if (total?.ok && typeof cmp.value.ahead_by === 'number' && countOf(total.value) > 0)
      own_share = Math.min(1, cmp.value.ahead_by / countOf(total.value));
  } else if (matched) own_share = 1 - matched.overlap;

  const since = since90(o.now);
  const window = await readCommitWindow(full, o);
  const commits_90d = window.ok ? window.count : miss(window.why);
  if (window.ok && window.capped) {
    miss('commits_90d capped at 300');
    miss('active_weeks_90d from newest 300 commits');
  }

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
    first_commit_at: read.first_commit_at,
    last_push_at: repo.pushed_at ?? null,
    commits_90d,
    active_weeks_90d: window.ok ? activeWeeks(window.dates, o.now) : null,
    releases: releases.ok ? countOf(releases.value) : miss(releases.why),
    has_tests: treeRead ? hasTests(paths) : null,
    has_ci: treeRead ? hasCi(paths) : null,
    issues_open: open.ok ? open.value : miss(open.why),
    issues_answered_90d: recent.ok ? recent.value.answered : miss(recent.why),
    note: notes.length ? notes.join('; ') : null,
  };
}
