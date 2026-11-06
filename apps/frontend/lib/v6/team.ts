/**
 * Team evidence rows for one public repo: its top contributors, their account ages and how many other
 * repos of theirs people use (50+ stars or a live homepage). Accounts under 30 days old are not counted.
 * Every row is a read fact; a skipped or failed read is left out and the note says why. Never throws.
 */
import { type Budget, ghList, ghObject } from './code';

export type TeamRows = {
  contributors_90d: number | null;
  top_share: number | null;
  account_ages_days: number[];
  prior_repos_used: number | null;
  logins: string[];
  note: string | null;
};

/** Contributors whose accounts and repos are read: 2 requests each. */
const TOP = 5;
/** An account younger than this is not counted: a fresh account is the cheapest way to pad a team. */
const MIN_AGE_DAYS = 30;
/** A prior repo counts as used at this many stars (or with a homepage). */
const USED_STARS = 50;
const DAY = 86_400_000;

type Contributor = { login?: string; type?: string; contributions?: number };
type User = { created_at?: string };
type UserRepo = { full_name?: string; fork?: boolean; stargazers_count?: number; homepage?: string | null };

/** Reads the team rows for a repo. Never throws. */
export async function readTeam(fullName: string, o: { gh: typeof fetch; token?: string; now: Date; budget: Budget }): Promise<TeamRows> {
  const notes: string[] = [];
  const miss = (why: string) => {
    if (!notes.includes(why)) notes.push(why);
  };
  const done = (rows: Omit<TeamRows, 'note'>): TeamRows => ({ ...rows, note: notes.length ? notes.join('; ') : null });

  const list = await ghList<Contributor>(`/repos/${fullName}/contributors?per_page=10`, o);
  if (!list.ok) {
    miss(list.why);
    return done({ contributors_90d: null, top_share: null, account_ages_days: [], prior_repos_used: null, logins: [] });
  }
  const people = list.value.rows
    .filter((c): c is Required<Pick<Contributor, 'login'>> & Contributor => !!c.login && c.type !== 'Bot' && !c.login.endsWith('[bot]'))
    .sort((a, b) => (b.contributions ?? 0) - (a.contributions ?? 0));
  const total = people.reduce((s, c) => s + (c.contributions ?? 0), 0);
  const top = people.slice(0, TOP);
  if (people.length > TOP) miss(`contributors beyond ${TOP} not read`);

  let counted = 0;
  const ages: number[] = [];
  const used = new Set<string>();
  let reposRead = 0;
  for (const c of top) {
    const user = await ghObject<User>(`/users/${encodeURIComponent(c.login)}`, o);
    if (!user.ok) miss(user.why);
    else if (user.value.created_at) {
      const age = Math.floor((o.now.getTime() - Date.parse(user.value.created_at)) / DAY);
      ages.push(age);
      if (age >= MIN_AGE_DAYS) counted++;
    }
    const repos = await ghList<UserRepo>(`/users/${encodeURIComponent(c.login)}/repos?sort=pushed&per_page=20`, o);
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
    top_share: total > 0 ? (top[0]?.contributions ?? 0) / total : null,
    account_ages_days: ages,
    prior_repos_used: reposRead > 0 || top.length === 0 ? used.size : null,
    logins: top.map((c) => c.login),
  });
}
