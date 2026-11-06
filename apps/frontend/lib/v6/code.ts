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
/** A starter with fewer paths matches too much by chance (a package.json and a README) to name. */
const MIN_BOILERPLATE_PATHS = 20;
/** Commit pages read for 90 days: 3 of 100. */
const COMMIT_PAGES = 3;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|out)\//;

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

const whyNot = (e: unknown, b: Budget): string => {
  if (!(e instanceof GitHubError)) return 'not read: github unreachable';
  setRemaining(b, e.remaining);
  if (b.stopped) return 'not read: budget';
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

const own = (paths: string[]) => paths.filter((p) => !SKIP_DIRS.test(p));

/**
 * The starter whose paths the repo carries most: the share of that starter's paths present in the repo.
 * Only starters with 20+ paths count; null when none does. Build and vendor folders are ignored. Pure.
 */
export function templateOverlap(paths: string[], boilerplates: Boilerplate[]): { name: string; overlap: number } | null {
  const have = new Set(own(paths));
  let best: { name: string; overlap: number } | null = null;
  for (const b of boilerplates) {
    const theirs = own(b.paths);
    if (theirs.length < MIN_BOILERPLATE_PATHS) continue;
    const overlap = theirs.filter((p) => have.has(p)).length / theirs.length;
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

type CommitRow = { commit?: { author?: { date?: string }; committer?: { date?: string } } };
type IssueRow = { state?: string; comments?: number; pull_request?: unknown };
type Compare = { ahead_by?: number };

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
  const treeRead = paths.length > 0 && !read.partial;
  const fork_of = repo.fork && repo.parent ? repo.parent.full_name : null;

  // A fork is measured against its parent; a starter it forked is not also a template match.
  const starters = (BOILERPLATES as Boilerplate[]).filter((b) => !fork_of || b.repo.toLowerCase() !== fork_of.toLowerCase());
  const match = treeRead ? templateOverlap(paths, starters) : null;
  const matched = match && match.overlap > 0 ? match : null;

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

  // Commits in 90 days: up to 3 pages of 100.
  const since = since90(o.now);
  let commits_90d: number | null = 0;
  const dates: string[] = [];
  for (let page = 1; page <= COMMIT_PAGES; page++) {
    const p = await ghList<CommitRow>(`/repos/${full}/commits?since=${since}&per_page=100${page > 1 ? `&page=${page}` : ''}`, o);
    if (!p.ok) {
      commits_90d = miss(p.why);
      break;
    }
    commits_90d += p.value.rows.length;
    for (const c of p.value.rows) {
      const d = c.commit?.author?.date ?? c.commit?.committer?.date;
      if (d) dates.push(d);
    }
    if (p.value.rows.length < 100) break;
    if (page === COMMIT_PAGES) miss('commits_90d capped at 300');
  }

  const releases = await ghList(`/repos/${full}/releases?per_page=1`, o);
  const open = await ghList(`/repos/${full}/issues?state=open&per_page=1`, o);
  const recent = await ghList<IssueRow>(`/repos/${full}/issues?state=all&since=${since}&per_page=50`, o);

  if (!treeRead) miss('not read: tree');
  return {
    fork_of,
    template_overlap: matched ? matched.overlap : treeRead && match ? 0 : null,
    template_name: matched?.name ?? null,
    own_share,
    first_commit_at: read.first_commit_at,
    last_push_at: repo.pushed_at ?? null,
    commits_90d,
    active_weeks_90d: commits_90d === null ? null : activeWeeks(dates, o.now),
    releases: releases.ok ? countOf(releases.value) : miss(releases.why),
    has_tests: treeRead ? hasTests(paths) : null,
    has_ci: treeRead ? hasCi(paths) : null,
    issues_open: open.ok ? countOf(open.value) : miss(open.why),
    issues_answered_90d: recent.ok
      ? recent.value.rows.filter((i) => !i.pull_request && ((i.comments ?? 0) > 0 || i.state === 'closed')).length
      : miss(recent.why),
    note: notes.length ? notes.join('; ') : null,
  };
}
