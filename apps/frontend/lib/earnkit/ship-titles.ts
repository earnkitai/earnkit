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
  // Fix round 1: dependency bumps say nothing shipped (also after a conventional prefix: "chore: bump deps").
  /^(bump|update|upgrade)s?\s+(deps|dependencies)\b/i,
];
/** Fix round 1: a squash merge's "(#12)" suffix, so the commit and its PR read as one title. */
const SQUASH = /\s*\(#\d+\)$/;
/** Fix round 1: at most TITLE_MAX code points (never half an emoji), "..." at the cut. Pure. */
const cap = (t: string): string => {
  const cps = [...t];
  return cps.length > TITLE_MAX ? `${cps.slice(0, TITLE_MAX - 3).join('').trimEnd()}...` : t;
};
/** Fix round 1: the duplicate key: NFKC, lower case, letters and digits of any script. Pure. */
const dedupeKey = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const PREFIX = /^(feat|fix|chore|docs|refactor|perf|style|test|build|ci)(\([^)]*\))?!?:\s*/i;

/**
 * Final fix 13: how much a title says, counted in letter and digit code points (never UTF-16 units or punctuation);
 * a Han, kana or Hangul character carries a word, so it counts 2. A title under TITLE_MIN is dropped: "ok" and "v1"
 * go, a 2-character Chinese or Japanese title ("修复") stays. Pure.
 */
const TITLE_MIN = 3;
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const titleWeight = (t: string) => [...t].reduce((n, c) => n + (WIDE.test(c) ? 2 : LETTER_OR_DIGIT.test(c) ? 1 : 0), 0);

export function cleanTitle(raw: string): string | null {
  const first = (raw.split(/\r?\n/)[0] ?? '').replace(/\s+/g, ' ').trim().replace(SQUASH, '');
  if (!first || DROP.some((r) => r.test(first))) return null;
  let t = first.replace(PREFIX, '').trim();
  if (titleWeight(t) < TITLE_MIN || DROP.some((r) => r.test(t))) return null;
  t = t[0].toUpperCase() + t.slice(1);
  return cap(t);
}

export function shipTitles(items: RawTitle[], own: OwnLinks, max = TITLES_MAX): string[] {
  const newest = (a: RawTitle, b: RawTitle) => b.at.localeCompare(a.at);
  const ordered = [...items.filter((i) => i.source === 'pr').sort(newest), ...items.filter((i) => i.source === 'commit').sort(newest)];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of ordered) {
    if (i.bot || i.merge) continue;
    const t = cleanTitle(i.title);
    if (!t) continue;
    const k = dedupeKey(t);
    if (!k || seen.has(k)) continue;
    const checked = checkUpdate(t, own);
    if (!checked.ok) continue;
    // Fix round 1: the stored text (checkUpdate's normalisation may lengthen it) is capped too, and checked again.
    let text = checked.text;
    if (cap(text) !== text) {
      const again = checkUpdate(cap(text), own);
      if (!again.ok || [...again.text].length > TITLE_MAX) continue;
      text = again.text;
    }
    seen.add(k);
    out.push(text);
    if (out.length === max) break;
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
