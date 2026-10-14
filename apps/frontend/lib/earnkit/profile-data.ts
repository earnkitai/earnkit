import { publicRow, publicScore, type StoredProject } from './builder-score';
import { sql } from './db';
import { shortWallet } from './entry-text';
import { profileOf, slugOwner } from './profiles';
import { publicReadKey } from './repo-cache';
import { shownTop, type Parts } from './score';
import { shownUrl } from './untrusted-text';

/**
 * v2.12 spec 7: the public profile's data (/b/<slug>). Public facts only: verified sources, the
 * public score (held days never), announced outcomes. Nothing self-reported, no private repo name,
 * never a wallet as the name.
 */

/** The ring's gradient stops and the panel they sit on (ek-score-orange, ek-score-purple, ek-navy-deep); plan R17. */
export const SCORE_COLORS = { from: '#FF7A1A', to: '#9B6BFF', panel: '#0F1839' } as const;
export type Stat = { value: string; meaning: string };
export type SourceKind = 'github' | 'site' | 'onchain' | 'packages';
export type ProjectCard = {
  key: string;
  title: string;
  numbers: string[];
  sources: { kind: SourceKind; label: string; href: string | null }[];
  entries: { program: string; outcome: 'won' | 'submitted' | 'entered' }[];
};
export type ProfileData = {
  /** top_percent: N of "Top N%", null above TOP_SHOWN_MAX (score.ts shownTop: show the score only). */
  name: string; slug: string; score: number; top_percent: number | null; change_7d: number | null;
  stats: Stat[]; projects: ProjectCard[]; sources: ProjectCard['sources']; spark: number[]; stricter_note: string | null;
};
/** spec 7: the public page of a profile with nothing verified. Neutral: the page is public, so the fill step stays in the agent's replies. */
export const EMPTY_LINE = 'No verified outcomes yet.';
export type EmptyProfile = { name: string; slug: string; line: typeof EMPTY_LINE };

/** The name of a profile with no X handle and no proven login (the card omits it). */
export const FALLBACK_NAME = 'Builder';
/** spec 7: X, else the proven GitHub login, else plain "Builder". A wallet or a slug is never the name (a wallet only as a source badge). Pure. */
export function profileName(p: { x_handle: string | null; github_login: string | null }): string {
  if (p.x_handle) return `@${p.x_handle}`;
  if (p.github_login) return p.github_login;
  return FALLBACK_NAME;
}

export function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `$${Math.round(n)}`;
}

const MONTH_MS = 30.44 * 86_400_000;
const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The three strongest parts of the score, in words, each with a one-line plain meaning. Pure. */
export function statsOf(parts: Parts, projects: { first_outcome_at: string | null }[], now: Date): Stat[] {
  const firsts = projects.map((p) => p.first_outcome_at).filter((x): x is string => !!x).map(Date.parse);
  const months = firsts.length ? Math.max(1, Math.floor((now.getTime() - Math.min(...firsts)) / MONTH_MS)) : 0;
  const users = Math.round(parts.users.raw.U ?? 0);
  const M = parts.money.raw.M ?? 0;
  const weeks = parts.consistency.raw.weeks ?? 0;
  // `n`: the number the value shows. A 0 is never shown ("0 months live" when no first outcome is known).
  const all: (Stat & { points: number; n: number })[] = [
    { points: parts.users.points, n: users, value: count(users, 'user', 'users'), meaning: 'people who used what they shipped' },
    { points: parts.staying.points, n: months, value: `${count(months, 'month', 'months')} live`, meaning: 'how long the work kept being used' },
    { points: parts.money.points, n: Math.round(M), value: `${money(M)} fees and volume`, meaning: 'money through what they built, last 12 months' },
    { points: parts.consistency.points, n: weeks, value: `${count(weeks, 'week', 'weeks')} shipping`, meaning: 'weeks shipping to something people use' },
    { points: parts.recency.points, n: 1, value: 'Active lately', meaning: 'people used the work recently' },
  ];
  return all.filter((s) => s.points > 0 && s.n > 0).sort((a, b) => b.points - a.points).slice(0, 3).map(({ value, meaning }) => ({ value, meaning }));
}

/** Rows newest first. The note shows only when the calibration changed and the percentile did not fall. Pure. */
export function stricterNote(rows: { day: string; calibration: string; percentile: number }[]): string | null {
  const [now, ...older] = rows;
  const before = older.find((r) => r.calibration !== now?.calibration);
  if (!now || !before || now.percentile < before.percentile) return null;
  const d = new Date(`${now.day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `Scoring got stricter on ${d}. Rank unchanged.`;
}

const DAY_MS = 86_400_000;
const KIND_ORDER: Record<SourceKind, number> = { github: 0, site: 1, packages: 2, onchain: 3 };
const RANK: Record<ProjectCard['entries'][number]['outcome'], number> = { won: 3, submitted: 2, entered: 1 };
type Outcome = ProjectCard['entries'][number]['outcome'];
const MAX_PROJECTS = 6;
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** A repo's name shows only while its newest reading is at most this old (repo-cache.ts PUBLIC_READ_DAYS). */
const PUBLIC_REPO_DAYS = 7;
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);

/** The week's change: against the latest public row 7 to 10 days before the public day; null without one. Rows newest first. Pure. */
export function weekChange(rows: { day: string; score: number }[]): number | null {
  const [now] = rows;
  if (!now) return null;
  const before = rows.find((r) => r.day <= addDays(now.day, -7) && r.day >= addDays(now.day, -10));
  return before ? now.score - before.score : null;
}

/**
 * The public profile behind `slug` (already lowercase): null for unknown or hidden (also through an
 * old slug), a redirect for an old slug, the neutral empty line without a public score above 0,
 * else the score (the last unheld or released day), its 90-day trend, the stats and the verified
 * projects. Every read is this person's own rows: the per-project numbers are the ones the scorer
 * stored with the public score row (builder_scores.projects), never recomputed here.
 */
export async function profileData(slug: string, now: Date = new Date()): Promise<{ redirect: string } | ProfileData | EmptyProfile | null> {
  const r = await slugOwner(slug);
  if (!r) return null;
  if (r.redirect) return { redirect: r.redirect };
  const p = await profileOf(r.builderId);
  if (!p || p.hidden) return null;
  const id = p.builder_id;
  const name = profileName(p);
  const pub = await publicScore(id);
  if (!pub || pub.score <= 0) return { name, slug: p.slug, line: EMPTY_LINE };

  // The public rows of the 90 days up to the public day: the trend, the week's change, the note.
  const rows = await sql()<{ day: string; score: number; calibration: string; percentile: number }[]>`
    SELECT s.day::text AS day, s.score, s.calibration, s.percentile FROM builder_scores s
    WHERE s.builder_id = ${id} AND ${publicRow()} AND s.day <= ${pub.day}::date AND s.day > ${addDays(pub.day, -90)}::date
    ORDER BY s.day DESC`;
  const [stored] = await sql()<{ projects: StoredProject[] | null }[]>`SELECT projects FROM builder_scores WHERE builder_id = ${id} AND day = ${pub.day}::date`;
  const projects = (Array.isArray(stored?.projects) ? stored.projects : []).filter((x) => typeof x?.key === 'string');

  // The person's verified sources, each with its latest ok reading up to the public day (a held day's never shows).
  // For a repo, also its newest reading of any kind, any day: it is named only while that one is ok,
  // says public and is under PUBLIC_REPO_DAYS old (a repo gone private fails its reads: unnamed at once).
  const sources = await sql()<{ id: number; kind: string; ref: string; project_key: string; signals: Record<string, unknown> | null; repo_public: boolean | null }[]>`
    SELECT b.id::int AS id, b.kind, b.ref, b.project_key, last.signals,
      (newest.ok AND newest.signals->'private' = 'false'::jsonb AND newest.day >= ${addDays(now.toISOString().slice(0, 10), -PUBLIC_REPO_DAYS)}::date) AS repo_public
    FROM builder_sources b
    LEFT JOIN LATERAL (
      SELECT r.signals FROM source_readings r WHERE r.source_id = b.id AND r.ok AND r.day <= ${pub.day}::date ORDER BY r.day DESC LIMIT 1) last ON true
    LEFT JOIN LATERAL (
      SELECT r.ok, r.day, r.signals FROM source_readings r WHERE r.source_id = b.id AND b.kind = 'repo' ORDER BY r.day DESC LIMIT 1) newest ON true
    WHERE b.builder_id = ${id} AND b.state = 'verified' ORDER BY b.id`;

  const chips = new Map<string, ProjectCard['sources']>();
  const titles = new Map<string, string>();
  const shownRepos = new Set<string>();
  for (const s of sources) {
    const list = chips.get(s.project_key) ?? [];
    let chip: ProjectCard['sources'][number] | null = null;
    // A repo is named only while its newest reading (ok or failed, any day) is ok, recent and says public.
    if (s.kind === 'repo' && s.repo_public === true) {
      chip = { kind: 'github', label: s.ref, href: shownUrl(`https://github.com/${s.ref}`) };
      shownRepos.add(publicReadKey(s.ref));
      if (s.ref === s.project_key) titles.set(s.project_key, s.ref.split('/')[1] ?? s.ref);
    } else if (s.kind === 'merged_pr') {
      const target = s.signals?.target;
      chip = { kind: 'github', label: typeof target === 'string' ? `PR to ${target}` : 'Merged PR', href: shownUrl(s.ref) };
      if (!titles.has(s.project_key)) titles.set(s.project_key, 'Open source');
    } else if (s.kind === 'site') {
      // A site is shown only when its latest reading found it up: "live", never more (siteShowsUse decides what scores).
      const h = host(s.ref);
      if (h && s.signals?.up === true) chip = { kind: 'site', label: h, href: shownUrl(s.ref) };
    } else if (s.kind === 'package_npm' || s.kind === 'package_pypi') {
      const npm = s.kind === 'package_npm';
      chip = { kind: 'packages', label: `${npm ? 'npm' : 'PyPI'} ${s.ref}`, href: shownUrl(npm ? `https://www.npmjs.com/package/${s.ref}` : `https://pypi.org/project/${s.ref}`) };
    } else if (s.kind === 'contract') {
      const [chain, address] = s.ref.split(':');
      if (address && /^0x[0-9a-f]{40}$/i.test(address))
        chip = { kind: 'onchain', label: shortWallet(address.toLowerCase()), href: chain === 'base' ? shownUrl(`https://basescan.org/address/${address.toLowerCase()}`) : null };
    }
    if (chip) list.push(chip);
    chips.set(s.project_key, list);
  }

  // Entries: the person's projects whose repo is a shown one; announced outcomes only (never self-reported).
  const entryRows = shownRepos.size === 0 ? [] : await sql()<{ repo_url: string; program: string; won: boolean; submitted: boolean }[]>`
    SELECT p.repo_url, g.title AS program,
      EXISTS (SELECT 1 FROM entry_outcomes o WHERE o.project_id = p.id AND o.basis = 'announcement' AND o.result IN ('won', 'placed', 'finalist')) AS won,
      (p.submission_proof_ok_at IS NOT NULL OR EXISTS (SELECT 1 FROM builder_events e WHERE e.type = 'submitted' AND e.project_id = p.id)) AS submitted
    FROM projects p JOIN installations i ON i.id = p.installation_id JOIN programs g ON g.id = p.program_id
    WHERE COALESCE(i.builder_id, i.id) = ${id} AND p.repo_url IS NOT NULL`;
  const entries = new Map<string, Map<string, Outcome>>();
  for (const e of entryRows) {
    const repo = publicReadKey(e.repo_url);
    if (!shownRepos.has(repo)) continue;
    const outcome: Outcome = e.won ? 'won' : e.submitted ? 'submitted' : 'entered';
    const m = entries.get(repo) ?? new Map<string, Outcome>();
    if (!m.has(e.program) || RANK[outcome] > RANK[m.get(e.program)!]) m.set(e.program, outcome);
    entries.set(repo, m);
  }

  // Every project key the person has: stored numbers first (strongest first), then sources-only projects.
  const strength = (x: StoredProject) => num(x.users) + num(x.money_usd) / 10;
  const keys = [
    ...[...projects].sort((a, b) => strength(b) - strength(a) || a.key.localeCompare(b.key)).map((x) => x.key),
    ...[...chips.keys()].sort(),
  ].filter((k, i, all) => all.indexOf(k) === i);
  const byKey = new Map(projects.map((x) => [x.key, x]));
  const cards: ProjectCard[] = keys
    .map((key, i) => {
      const x = byKey.get(key);
      const users = Math.round(num(x?.users));
      const usd = num(x?.money_usd);
      const src = (chips.get(key) ?? []).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
      const repo = /^[^/]+\/[^/]+$/.test(key) ? publicReadKey(key) : null;
      return {
        // The key is public markup: a repo's key only when that repo is shown (else it could name a private repo).
        key: titles.has(key) && key !== 'oss' ? key : `project-${i + 1}`,
        // A repo's name only when the repo is shown; else the live site's host or the package's name.
        title: titles.get(key) ?? src.find((c) => c.kind === 'site')?.label ?? src.find((c) => c.kind === 'packages')?.label.replace(/^\S+ /, '') ?? 'Private project',
        numbers: [...(users > 0 ? [count(users, 'user', 'users')] : []), ...(usd >= 1 ? [money(usd)] : [])],
        sources: src,
        entries: [...((repo ? entries.get(repo) : undefined) ?? new Map<string, Outcome>())].map(([program, outcome]) => ({ program, outcome })),
      };
    })
    .filter((c) => c.numbers.length > 0 || c.sources.length > 0)
    .slice(0, MAX_PROJECTS);

  return {
    name,
    slug: p.slug,
    score: pub.score,
    top_percent: shownTop(pub.percentile),
    change_7d: weekChange(rows),
    stats: statsOf(pub.parts, projects, now),
    projects: cards,
    sources: cards.flatMap((c) => c.sources),
    spark: [...rows].reverse().map((x) => x.score),
    stricter_note: stricterNote(rows),
  };
}

// ---- v2.12 T12: the leaderboard (spec 7 "Leaderboard", app/leaderboard).

export const PAGE_SIZE = 50;
export type BoardFilters = { chain: 'base' | 'arc' | null; program: string | null; window: 'week' | 'all'; page: number };
export type BoardRow = { rank: number; slug: string; name: string; score: number; top_percent: number | null; top_outcome: string; change_7d: number };
export type LeaderboardData = { rows: BoardRow[]; page: number; pages: number; filters: BoardFilters };

/** The board's query params. Junk (an unknown chain or window, an odd program id, a repeated key, a bad page) is dropped, never echoed. Pure. */
/**
 * v2.12 final review (T12): the highest board page a URL may ask for (10,000 people at 50 a page).
 * Past it the page falls back to 1, so crafted page numbers can't each fill a cache entry.
 */
export const MAX_BOARD_PAGE = 200;

export function leaderboardFilters(q: Record<string, string | string[] | undefined>): BoardFilters {
  const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : null);
  const chain = one('chain');
  const program = one('program');
  const raw = one('page');
  const page = raw && /^[1-9]\d{0,2}$/.test(raw) && Number(raw) <= MAX_BOARD_PAGE ? Number(raw) : 1;
  return {
    chain: chain === 'base' || chain === 'arc' ? chain : null,
    program: program && /^[a-z0-9-]{1,100}$/.test(program) ? program : null,
    window: one('window') === 'week' ? 'week' : 'all',
    page,
  };
}

/** The board's URL for these filters: defaults left out, in one fixed order (chain, program, window, page). Pure. */
export function boardHref(f: BoardFilters): string {
  const q = new URLSearchParams();
  if (f.chain) q.set('chain', f.chain);
  if (f.program) q.set('program', f.program);
  if (f.window === 'week') q.set('window', 'week');
  if (f.page > 1) q.set('page', String(f.page));
  const s = q.toString();
  return s ? `/leaderboard?${s}` : '/leaderboard';
}

/**
 * A row's top outcome in plain words, the share card's wording (share.ts cardModel). The project is
 * named by the same rules as the profile: a repo only while it reads public (repo_title), else
 * "their open source work" for merged PRs, a live site's host, a package's name, else "a private
 * project". Never a wallet, never a private repo. Pure.
 */
export function boardOutcome(r: { score: number; users: number | null; money_usd: number | null; repo_title: string | null; oss: boolean; site_ref: string | null; package_ref: string | null }): string {
  if (r.score <= 0) return 'No verified outcomes yet';
  // No stored top project (an older row): no title to give.
  if (r.users === null && r.money_usd === null) return 'Verified builder';
  const users = Math.round(num(r.users));
  const usd = num(r.money_usd);
  const site = r.site_ref ? host(r.site_ref) : null;
  const title = r.repo_title ?? (r.oss ? 'their open source work' : site ?? r.package_ref ?? 'a private project');
  if (users > 0) return `${users.toLocaleString('en-US')} ${users === 1 ? 'person' : 'people'} used ${title}`;
  if (usd >= 1) return `${money(usd)} through ${title}`;
  return `Shipped ${title}`;
}

type BoardRaw = {
  builder_id: number; slug: string; x_handle: string | null; github_login: string | null; score: number; percentile: number; total: number;
  change: number | null; users: number | null; money_usd: number | null; repo_title: string | null; oss: boolean; site_ref: string | null; package_ref: string | null;
};

/**
 * One page of the board in one query. Everyone with a profile and a public score is listed (score
 * and percentile from builder_ranks: the last unheld or released day, hidden people included in the
 * percentile) except hidden people and people not yet shown the consent line (final review I4; both
 * still count in percentiles), filtered here only. A shared client has no profile, so it is
 * never listed. `all` ranks by score; `week` by the 7-day change (the public score against the
 * latest public row 7 to 10 days before it, as the profile's weekChange; none is no change), then
 * score. The top outcome comes from the public row's stored top_outcome, its project named only by
 * the profile's public rules; the per-row lookups run on the page's 50 rows only (all) or on the
 * filtered set's latest rows (week, to sort).
 */
export async function leaderboardData(f: BoardFilters, now: Date = new Date()): Promise<LeaderboardData> {
  const db = sql();
  const week = f.window === 'week';
  const offset = (f.page - 1) * PAGE_SIZE;
  const fresh = addDays(now.toISOString().slice(0, 10), -PUBLIC_REPO_DAYS);
  const pageCut = db`LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
  const raw = await db<BoardRaw[]>`
    WITH cand AS (
      SELECT r.builder_id, r.score::int AS score, r.percentile, p.slug, p.x_handle, p.github_login, count(*) OVER ()::int AS total
      FROM builder_ranks r JOIN builder_profiles p ON p.builder_id = r.builder_id
      WHERE NOT p.hidden AND p.consent_shown_at IS NOT NULL
        ${f.chain ? db`AND EXISTS (SELECT 1 FROM builder_sources b WHERE b.builder_id = r.builder_id AND b.kind = 'contract' AND b.state = 'verified' AND b.ref LIKE ${`${f.chain}:%`})` : db``}
        ${f.program ? db`AND EXISTS (SELECT 1 FROM projects j JOIN installations i ON i.id = j.installation_id WHERE COALESCE(i.builder_id, i.id) = r.builder_id AND j.program_id = ${f.program})` : db``}
      ${week ? db`` : db`ORDER BY r.score DESC, p.slug ${pageCut}`}),
    moved AS (
      SELECT c.*, pub.day, pub.top_outcome, pub.score - prev.score AS change
      FROM cand c
      LEFT JOIN LATERAL (
        SELECT s.day, s.score, s.top_outcome FROM builder_scores s WHERE s.builder_id = c.builder_id AND ${publicRow()} ORDER BY s.day DESC LIMIT 1) pub ON true
      LEFT JOIN LATERAL (
        SELECT s.score FROM builder_scores s WHERE s.builder_id = c.builder_id AND ${publicRow()} AND s.day <= pub.day - 7 AND s.day >= pub.day - 10
        ORDER BY s.day DESC LIMIT 1) prev ON true
      ${week ? db`ORDER BY COALESCE(pub.score - prev.score, 0) DESC, c.score DESC, c.slug ${pageCut}` : db``}),
    shown AS (SELECT m.*, m.top_outcome->>'key' AS top_key FROM moved m)
    SELECT t.builder_id, t.slug, t.x_handle, t.github_login, t.score, t.percentile, t.total, t.change,
      CASE WHEN jsonb_typeof(t.top_outcome->'users') = 'number' THEN (t.top_outcome->>'users')::float8 END AS users,
      CASE WHEN jsonb_typeof(t.top_outcome->'money_usd') = 'number' THEN (t.top_outcome->>'money_usd')::float8 END AS money_usd,
      (SELECT split_part(b.ref, '/', 2) FROM builder_sources b
        JOIN LATERAL (SELECT n.ok, n.day, n.signals FROM source_readings n WHERE n.source_id = b.id ORDER BY n.day DESC LIMIT 1) n ON true
        WHERE b.builder_id = t.builder_id AND b.kind = 'repo' AND b.state = 'verified' AND b.ref = t.top_key AND b.project_key = t.top_key
          AND n.ok AND n.signals->'private' = 'false'::jsonb AND n.day >= ${fresh}::date
        LIMIT 1) AS repo_title,
      EXISTS (SELECT 1 FROM builder_sources b WHERE b.builder_id = t.builder_id AND b.kind = 'merged_pr' AND b.state = 'verified' AND b.project_key = t.top_key) AS oss,
      (SELECT b.ref FROM builder_sources b
        JOIN LATERAL (SELECT r.signals FROM source_readings r WHERE r.source_id = b.id AND r.ok AND r.day <= t.day ORDER BY r.day DESC LIMIT 1) l ON true
        WHERE b.builder_id = t.builder_id AND b.kind = 'site' AND b.state = 'verified' AND b.project_key = t.top_key AND l.signals->'up' = 'true'::jsonb
        ORDER BY b.id LIMIT 1) AS site_ref,
      (SELECT b.ref FROM builder_sources b
        WHERE b.builder_id = t.builder_id AND b.kind IN ('package_npm', 'package_pypi') AND b.state = 'verified' AND b.project_key = t.top_key
        ORDER BY b.id LIMIT 1) AS package_ref
    FROM shown t
    ORDER BY ${week ? db`COALESCE(t.change, 0) DESC,` : db``} t.score DESC, t.slug`;
  const total = raw[0]?.total ?? 0;
  const rows = raw.map((r, i) => ({
    rank: offset + i + 1,
    slug: r.slug,
    name: profileName(r),
    score: r.score,
    top_percent: shownTop(r.percentile),
    top_outcome: boardOutcome(r),
    change_7d: r.change ?? 0,
  }));
  return { rows, page: f.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), filters: f };
}

/** A program's title by id, any status (a closed bonus round's program too, owner ruling D1); null when unknown. */
/** Every program id (open or closed): the board validates `program=` against it before its cached read. */
export async function programIds(): Promise<string[]> {
  return (await sql()<{ id: string }[]>`SELECT id FROM programs ORDER BY id`).map((r) => r.id);
}

export async function programTitle(id: string): Promise<string | null> {
  const [row] = await sql()<{ title: string }[]>`SELECT title FROM programs WHERE id = ${id}`;
  return row?.title ?? null;
}
