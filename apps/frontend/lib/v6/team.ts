/**
 * Team rows for one public repo from its commits in 90 days (a fork's: only those after the fork point;
 * a starter's maintainers dropped): who committed, the top author's share, the top 5 authors' account
 * ages and other repos of theirs people use (50+ stars or a homepage). Accounts under 30 days old are not
 * counted. `contributors` (L15-19, v6.1.14) is everyone who ever committed: the repo's full contributor list, paged,
 * anonymous authors included, bots and a starter's maintainers dropped (a fork's: its authors after the fork); when that
 * list reads empty or fails, the window's authors, and never 0 for a repo with commits. A failed read is left out with
 * a note. Never throws.
 */
import { type Budget, type ForkRef, ghList, ghObject, readCommitWindow } from './code';

export type TeamRows = {
  contributors_90d: number | null;
  top_share: number | null;
  account_ages_days: number[];
  prior_repos_used: number | null;
  logins: string[];
  /** L15-19 (v6.1.14): everyone who committed (see above); absent on rows cached before. */
  contributors?: number;
  /** The list held more than CONTRIBUTOR_PAGES pages: `contributors` is a floor. */
  contributors_more?: boolean;
  note: string | null;
};

/** Authors whose accounts and repos are read: 2 requests each. */
const TOP = 5;
/** An account younger than this is not counted: a fresh account is the cheapest way to pad a team. */
const MIN_AGE_DAYS = 30;
/** A prior repo counts as used at this many stars (or with a homepage). */
const USED_STARS = 50;
const DAY = 86_400_000;
/** Contributor list pages read, 100 each: 500 people is past any team a screen compares. */
export const CONTRIBUTOR_PAGES = 5;

type User = { created_at?: string };
type UserRepo = { full_name?: string; fork?: boolean; stargazers_count?: number; homepage?: string | null };
type Contributor = { login?: string; type?: string; email?: string; name?: string };

/**
 * The repo's full contributor list (L15-19, v6.1.14), paged, anonymous authors included, bots and `drop` left out: how
 * many, and whether more pages were left; null when it could not be read. A failed read adds no note: the window's
 * authors stand in.
 */
async function contributorList(fullName: string, o: { gh: typeof fetch; token?: string; now: Date; budget: Budget }, drop: Set<string>) {
  let n = 0;
  for (let page = 1; page <= CONTRIBUTOR_PAGES; page++) {
    const p = await ghList<Contributor>(`/repos/${fullName}/contributors?anon=1&per_page=100${page > 1 ? `&page=${page}` : ''}`, o);
    if (!p.ok) return null;
    n += p.value.rows.filter((c) => c.type !== 'Bot' && !(c.login && (drop.has(c.login.toLowerCase()) || c.login.toLowerCase().endsWith('[bot]')))).length;
    if (p.value.rows.length < 100) return { n, more: false };
  }
  return { n, more: true };
}

/**
 * Reads the team rows for a repo. Shares the 90-day commit read with readCode through the Budget. `fork`
 * limits the window to commits after the fork point; `drop` lists logins (a matched starter's
 * maintainers) whose commits are not the applicant's. Never throws.
 */
export async function readTeam(
  fullName: string,
  o: { gh: typeof fetch; token?: string; now: Date; budget: Budget },
  x: { fork?: ForkRef | null; drop?: string[] } = {},
): Promise<TeamRows> {
  const notes: string[] = [];
  const miss = (why: string) => {
    if (!notes.includes(why)) notes.push(why);
  };
  const done = (rows: Omit<TeamRows, 'note'>): TeamRows => ({ ...rows, note: notes.length ? notes.join('; ') : null });

  const drop = new Set((x.drop ?? []).map((l) => l.toLowerCase()));
  // A fork's list holds its parent's people: a fork counts its own authors after the fork only.
  const list = x.fork ? null : await contributorList(fullName, o, drop);
  const window = await readCommitWindow(fullName, o, x.fork ?? null);
  if (!window.ok) {
    miss(window.why);
    return done({
      contributors_90d: null, top_share: null, account_ages_days: [], prior_repos_used: null, logins: [],
      ...(list && list.n > 0 && { contributors: list.n, ...(list.more && { contributors_more: true }) }),
    });
  }
  if (window.capped) miss(`commits window capped at ${window.cap}`);
  const dropped = new Set<string>();
  let droppedCommits = 0;
  const byLogin = new Map<string, number>();
  for (const a of window.authors) {
    if (drop.has(a.toLowerCase())) {
      dropped.add(a.toLowerCase());
      droppedCommits++;
    } else byLogin.set(a, (byLogin.get(a) ?? 0) + 1);
  }
  if (dropped.size) miss(`${dropped.size} starter ${dropped.size === 1 ? 'maintainer' : 'maintainers'} not counted`);
  const counted_commits = window.count - droppedCommits;
  const ranked = [...byLogin].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked.slice(0, TOP).map(([login]) => login);
  if (ranked.length > TOP) miss(`contributors beyond ${TOP} not read`);

  let counted = 0;
  const ages: number[] = [];
  const used = new Set<string>();
  let reposRead = 0;
  for (const login of top) {
    const user = await ghObject<User>(`/users/${encodeURIComponent(login)}`, o);
    if (!user.ok) miss(user.why);
    else if (user.value.created_at) {
      const age = Math.floor((o.now.getTime() - Date.parse(user.value.created_at)) / DAY);
      ages.push(age);
      if (age >= MIN_AGE_DAYS) counted++;
    }
    const repos = await ghList<UserRepo>(`/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=20`, o);
    if (!repos.ok) {
      miss(repos.why);
      continue;
    }
    reposRead++;
    for (const r of repos.value.rows) {
      if (!r.full_name || r.full_name.toLowerCase() === fullName.toLowerCase() || r.fork) continue;
      if ((r.stargazers_count ?? 0) >= USED_STARS || (r.homepage ?? '').trim() !== '') used.add(r.full_name.toLowerCase());
    }
  }

  // The list when it read anyone; else the window's authors, at least 1 when the window holds a commit.
  const authors = byLogin.size || (counted_commits > 0 ? 1 : 0);
  const everyone = list && list.n > 0 ? list : { n: authors, more: false };
  return done({
    contributors: everyone.n,
    ...(everyone.more && { contributors_more: true }),
    contributors_90d: counted,
    // Share of the window's commits, including those with no linked GitHub author.
    top_share: counted_commits > 0 && ranked.length > 0 ? ranked[0][1] / counted_commits : null,
    account_ages_days: ages,
    prior_repos_used: reposRead > 0 || top.length === 0 ? used.size : null,
    logins: top,
  });
}
