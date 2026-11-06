/**
 * Team evidence rows for one public repo, from its commits in the last 90 days: who committed, the top
 * author's share, the top 5 authors' account ages and how many other repos of theirs people use (50+ stars
 * or a homepage). Accounts under 30 days old are not counted. A skipped or failed read is left out and the
 * note says why. Never throws.
 */
import { type Budget, ghList, ghObject, readCommitWindow } from './code';

export type TeamRows = {
  contributors_90d: number | null;
  top_share: number | null;
  account_ages_days: number[];
  prior_repos_used: number | null;
  logins: string[];
  note: string | null;
};

/** Authors whose accounts and repos are read: 2 requests each. */
const TOP = 5;
/** An account younger than this is not counted: a fresh account is the cheapest way to pad a team. */
const MIN_AGE_DAYS = 30;
/** A prior repo counts as used at this many stars (or with a homepage). */
const USED_STARS = 50;
const DAY = 86_400_000;

type User = { created_at?: string };
type UserRepo = { full_name?: string; fork?: boolean; stargazers_count?: number; homepage?: string | null };

/** Reads the team rows for a repo. Shares the 90-day commit read with readCode through the Budget. Never throws. */
export async function readTeam(fullName: string, o: { gh: typeof fetch; token?: string; now: Date; budget: Budget }): Promise<TeamRows> {
  const notes: string[] = [];
  const miss = (why: string) => {
    if (!notes.includes(why)) notes.push(why);
  };
  const done = (rows: Omit<TeamRows, 'note'>): TeamRows => ({ ...rows, note: notes.length ? notes.join('; ') : null });

  const window = await readCommitWindow(fullName, o);
  if (!window.ok) {
    miss(window.why);
    return done({ contributors_90d: null, top_share: null, account_ages_days: [], prior_repos_used: null, logins: [] });
  }
  if (window.capped) miss('commits window capped at 300');
  const byLogin = new Map<string, number>();
  for (const a of window.authors) byLogin.set(a, (byLogin.get(a) ?? 0) + 1);
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

  return done({
    contributors_90d: counted,
    // Share of the window's commits, including those with no linked GitHub author.
    top_share: window.count > 0 && ranked.length > 0 ? ranked[0][1] / window.count : null,
    account_ages_days: ages,
    prior_repos_used: reposRead > 0 || top.length === 0 ? used.size : null,
    logins: top,
  });
}
