import { checkUpdate, type OwnLinks } from './update-text';

/**
 * v2.14 spec 3: the ship log's words are the week's own PR and commit titles (no AI). Merges, "wip", bot
 * authors, version bumps and duplicates are dropped; conventional prefixes stripped; 80 characters; each title
 * must pass the update-text filter (links only to the project's own site or repo, no secrets, no @mentions, no
 * 7-digit runs) or it is dropped. At most 3, PRs merged in the week first, then commits, newest first.
 */
export const TITLES_MAX = 3;
export const TITLE_MAX = 80;
export type RawTitle = { title: string; at: string; source: 'pr' | 'commit'; bot: boolean; merge: boolean };
const DROP = [
  /^merge (pull request|branch|remote-tracking branch|tag)\b/i,
  /^(wip|work in progress)\b/i,
  /^v?\d+(\.\d+){1,3}([-+][\w.]+)?$/i,
  /^(chore|build|ci)\((release|deps|deps-dev)\)!?:/i,
  /^(release|bump(s|ed)?|version)\b.*\d/i,
  /\bbump(s|ed)? (the )?version\b/i,
];
const PREFIX = /^(feat|fix|chore|docs|refactor|perf|style|test|build|ci)(\([^)]*\))?!?:\s*/i;

export function cleanTitle(raw: string): string | null {
  const first = (raw.split(/\r?\n/)[0] ?? '').replace(/\s+/g, ' ').trim();
  if (!first || DROP.some((r) => r.test(first))) return null;
  let t = first.replace(PREFIX, '').trim();
  if (t.length < 3 || DROP.some((r) => r.test(t))) return null;
  t = t[0].toUpperCase() + t.slice(1);
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 3).trimEnd()}...` : t;
}

export function shipTitles(items: RawTitle[], own: OwnLinks): string[] {
  const newest = (a: RawTitle, b: RawTitle) => b.at.localeCompare(a.at);
  const ordered = [...items.filter((i) => i.source === 'pr').sort(newest), ...items.filter((i) => i.source === 'commit').sort(newest)];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of ordered) {
    if (i.bot || i.merge) continue;
    const t = cleanTitle(i.title);
    if (!t) continue;
    const k = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(k)) continue;
    const checked = checkUpdate(t, own);
    if (!checked.ok) continue;
    seen.add(k);
    out.push(checked.text);
    if (out.length === TITLES_MAX) break;
  }
  return out;
}

type ApiCommit = { commit?: { message?: string; author?: { name?: string; date?: string } }; author?: { login?: string; type?: string } | null; parents?: unknown[] };
type ApiPull = { title?: string; merged_at?: string | null; user?: { login?: string; type?: string } | null };
const isBot = (login: string | undefined, type: string | undefined, name?: string) =>
  type === 'Bot' || /\[bot\]$/i.test(login ?? '') || /\[bot\]$/i.test(name ?? '');

/** The week's raw titles through one installation client (repo-proof.ts appClient): 2 calls, at most 100 commits and 50 PRs. */
export async function readWeekTitles(get: <T>(path: string) => Promise<T | null>, repoKey: string, monday: string): Promise<RawTitle[]> {
  const since = `${monday}T00:00:00Z`;
  const until = new Date(new Date(since).getTime() + 7 * 86_400_000).toISOString();
  const [commits, pulls] = await Promise.all([
    get<ApiCommit[]>(`/repos/${repoKey}/commits?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`),
    get<ApiPull[]>(`/repos/${repoKey}/pulls?state=closed&sort=updated&direction=desc&per_page=50`),
  ]);
  const out: RawTitle[] = [];
  for (const p of Array.isArray(pulls) ? pulls : [])
    if (typeof p.title === 'string' && p.merged_at && p.merged_at >= since && p.merged_at < until)
      out.push({ title: p.title, at: p.merged_at, source: 'pr', bot: isBot(p.user?.login, p.user?.type), merge: false });
  for (const c of Array.isArray(commits) ? commits : [])
    if (typeof c.commit?.message === 'string')
      out.push({
        title: c.commit.message, at: c.commit.author?.date ?? since, source: 'commit',
        bot: isBot(c.author?.login, c.author?.type, c.commit.author?.name), merge: (c.parents?.length ?? 1) > 1,
      });
  return out;
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const squashed = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Whether `title` names the repo `repoKey` (owner/name): its name as words, or run together (6+ letters). Pure. */
export function namesRepo(title: string, repoKey: string): boolean {
  const name = repoKey.toLowerCase().split('/').pop() ?? '';
  if (!name) return false;
  if (words(name).trim() && words(title).includes(words(name))) return true;
  const n = squashed(name);
  return n.length >= 6 && squashed(title).includes(n);
}

/**
 * Preflight S9 (read time, the I1 private-name rule): the titles a card may show. A repo that reads public
 * (page-data shownProjects, not `hiddenRepo`): all of them. One that doesn't: none unless the builder turned
 * titles on (builder_profiles.ship_titles_at), and then never one that names the repo. Turning titles off
 * hides stored titles at once; nothing is deleted. Pure.
 */
export function titlesShown(titles: string[] | null | undefined, o: { hiddenRepo: boolean; titlesOn: boolean; repoKey: string }): string[] {
  const list = Array.isArray(titles) ? titles.filter((t): t is string => typeof t === 'string' && t !== '') : [];
  if (!o.hiddenRepo) return list;
  if (!o.titlesOn) return [];
  return list.filter((t) => !namesRepo(t, o.repoKey));
}
