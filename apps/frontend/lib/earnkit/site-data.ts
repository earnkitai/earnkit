import { sql } from './db';
import type { ProfileData } from './bench-data';
import { appProvenRepo, storedBuilderCode } from './builder-codes-check';
import { raisingEnabled } from './builder-score-flag';
import { EARNKIT_ORGS } from './earnkit-orgs';
import { REPO_KEY, benchConfirmedSql } from './main-project';
import { PRIVATE_NAME, norm, projectProgramsDated } from './page-data';
import { listedRanked, standingOf, weekCounts } from './person-score';
import { BACKING_EXCLUDED_REPOS, COIN_PROGRAM } from './policy-constants';
import { benchPercent, shownRankLine, type Standing } from './rank';
import { pillCoin } from './raising';
import { firstName, logoColor, monthDay, monthYear, standingTier } from './site-copy';
import { shipReading } from './week-facts';
import { isoWeekOf, last52, mondayOfWeek } from './weeks';

/**
 * v3.1 site Task 3: the profile's own reads (plan S5 to S10, W8), one profileSite call per page view. Facts EarnKit
 * checked itself only: no outcome until it is tracked, never points, a rank only from RANK_MIN_POOL ranked builders,
 * Backing only while EARNKIT_RAISING is on and never for EarnKit's own repo, and never a hidden repo's name.
 */

/** Base mainnet block 0's time (unix seconds; eth_getBlockByNumber 0x0 on mainnet.base.org, 0x648a5ce3). Base makes a block every 2s. */
export const BASE_GENESIS_UNIX = 1686789347;
const WEEK_S = 7 * 86_400;
const DAY_MS = 86_400_000;

type MainRow = { key: string | null; claimed_at: Date; confirmed: boolean; starting: boolean };

/** 2026-10-23 Base onboarding: what a page with no project on the leaderboard says once the builder said yes to the Base walk-through. */
export const STARTING_ON_BASE = 'Getting started on Base';
export const NO_PROJECT_YET = 'No project on the leaderboard yet';

/**
 * The one project's key, the claim's time (else the profile's creation), whether the Bench counts the project confirmed
 * now, and whether the builder said yes to the Base walk-through (standing_seen.base_walk, bench-find.ts).
 */
async function mainOf(builderId: number): Promise<MainRow | null> {
  const db = sql();
  const [r] = await db<MainRow[]>`
    SELECT p.main_project_key AS key, COALESCE(p.claimed_at, p.created_at) AS claimed_at, COALESCE(b.confirmed, false) AS confirmed,
      COALESCE(p.standing_seen->'base_walk'->>'answer' = 'yes', false) AS starting
    FROM builder_profiles p
    LEFT JOIN LATERAL (SELECT ${benchConfirmedSql(db)} AS confirmed FROM builder_projects b
      WHERE b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key)) b ON true
    WHERE p.builder_id = ${builderId}`;
  return r ?? null;
}

/**
 * The ship reading (week-facts.ts shipReading) of the one project's verified repo source, while the project is
 * Bench-confirmed; a source whose ref is the key itself first. Null without one.
 */
async function mainReading(builderId: number): Promise<Record<string, unknown> | null> {
  const db = sql();
  // Owner batch 2026-10-23: the ship reading can predate commits_year (readings before 2026-10-22, or a live read
  // stamped later in the day than its daily row's midnight): then the count comes from the newest reading that has it.
  const [r] = await db<{ signals: Record<string, unknown>; commits_year: unknown }[]>`
    SELECT x.signals, cy.n AS commits_year FROM builder_profiles f
    JOIN builder_projects b ON b.builder_id = f.builder_id AND lower(b.project_key) = lower(f.main_project_key) AND ${benchConfirmedSql(db)}
    JOIN builder_sources s ON s.builder_id = f.builder_id AND s.kind = 'repo' AND s.state = 'verified' AND lower(s.project_key) = lower(b.project_key)
    JOIN LATERAL ${shipReading(db)} x ON true
    LEFT JOIN LATERAL (
      SELECT y.n FROM (
        (SELECT l.signals->'commits_year' AS n, l.read_at AS at FROM source_live l
          WHERE l.source_id = s.id AND l.ok AND jsonb_typeof(l.signals->'commits_year') = 'number')
        UNION ALL (SELECT r.signals->'commits_year', r.day::timestamptz FROM source_readings r
          WHERE r.source_id = s.id AND r.ok AND jsonb_typeof(r.signals->'commits_year') = 'number' ORDER BY r.day DESC LIMIT 1)
      ) y ORDER BY y.at DESC LIMIT 1) cy ON true
    WHERE f.builder_id = ${builderId}
    ORDER BY (lower(s.ref) = lower(b.project_key)) DESC, s.id LIMIT 1`;
  if (!r) return null;
  return typeof r.signals.commits_year !== 'number' && typeof r.commits_year === 'number' ? { ...r.signals, commits_year: r.commits_year } : r.signals;
}

/** Plan S6: the last push to the one project's repo (its ship reading's pushed_at); null when absent, unparsable or after `now`. */
export async function lastShippedAt(builderId: number, now: Date): Promise<Date | null> {
  return shippedFrom(await mainReading(builderId), now);
}
/** lastShippedAt from a ship reading already read. Pure. */
function shippedFrom(g: Record<string, unknown> | null, now: Date): Date | null {
  const raw = g?.pushed_at;
  if (typeof raw !== 'string') return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t <= now.getTime() ? new Date(t) : null;
}

/** Plan S7: this ISO week's commits on the ship reading, through the anti-backdating floor (person-score.ts weekCounts); else 0. */
export async function thisWeekCommits(builderId: number, now: Date): Promise<number> {
  return commitsFrom(await mainReading(builderId), now);
}
/** thisWeekCommits from a ship reading already read. Pure. */
function commitsFrom(g: Record<string, unknown> | null, now: Date): number {
  const week = isoWeekOf(now);
  if (!g || !weekCounts(g, week, now)) return 0;
  const counts = g.commit_counts as Record<string, unknown> | null | undefined;
  const n = Number(counts?.[week] ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export type HighlightIcon = 'live' | 'code' | 'contract' | 'repo' | 'applied' | 'won' | 'start';
/** One Highlights fact; `href`, its proof (opened in a new tab), only where a visitor can open it (never a private repo's). */
export type Highlight = { icon: HighlightIcon; title: string; sub: string; href?: string };
const HIGHLIGHTS_MAX = 5;
const PROGRAMS_MAX = 2;
/** Uptime is "Up N of the last D days checked": D the days of the last UPTIME_DAYS with a reading, shown from UPTIME_MIN_READS. */
export const UPTIME_DAYS = 30;
export const UPTIME_MIN_READS = 7;

/** A hostname without `www.`, lowercase; null for anything that is not a URL. Pure. */
const hostOf = (ref: string): string | null => {
  const u = URL.canParse(ref) ? new URL(ref) : URL.canParse(`https://${ref}`) ? new URL(`https://${ref}`) : null;
  return u?.hostname ? u.hostname.toLowerCase().replace(/^www\./, '') : null;
};

/** A site source's own https origin (the WHATWG parser escapes it), null for anything else. Pure. */
export const siteHref = (ref: string): string | null => {
  const u = URL.canParse(ref) ? new URL(ref) : null;
  return u && u.protocol === 'https:' && u.hostname && !u.username && !u.password ? u.origin : null;
};
const ADDRESS = /^0x[0-9a-f]{40}$/i;
/** A Base contract's Basescan page, null unless `address` is a 0x address. Pure. */
export const basescanHref = (address: string): string | null => (ADDRESS.test(address) ? `https://basescan.org/address/${address.toLowerCase()}` : null);
const segments = (path: string) => path.split('/').map(encodeURIComponent).join('/');
/** A public repo's GitHub page ("owner/repo" keys only). Pure. */
export const githubRepoHref = (key: string): string | null => (REPO_KEY.test(norm(key)) ? `https://github.com/${segments(norm(key))}` : null);
/**
 * A file's GitHub page on a branch (each segment escaped; "HEAD", GitHub's default branch, when the branch is unknown);
 * null for a key that is not "owner/repo", an empty path, or a path that climbs out ("..", "."). Pure.
 */
export const githubFileHref = (key: string, branch: string | null, path: string): string | null => {
  const repo = githubRepoHref(key);
  const parts = path.split('/');
  if (!repo || !path || parts.some((x) => x === '' || x === '.' || x === '..')) return null;
  return `${repo}/blob/${segments(branch || 'HEAD')}/${segments(path)}`;
};

/**
 * The live item's sub line from a site source's readings: "Up N of the last D days checked", D the days of the last
 * UPTIME_DAYS EarnKit read the site (a day it did not read counts nowhere), N of them up; from UPTIME_MIN_READS days
 * read, else since the first up day. Pure.
 */
export function liveSub(r: { checked: number; up: number; first_up: string }): string {
  return r.checked >= UPTIME_MIN_READS
    ? `Up ${r.up} of the last ${r.checked} days checked`
    : `Since ${monthYear(new Date(`${r.first_up}T00:00:00Z`))}`;
}

/**
 * 1. live: a verified site source of the project whose newest ok reading is up (a site down at its last read is no item;
 * a failed read, ok false, is EarnKit's own failure and never hides a live site),
 * the one that first read up (week-facts.ts went_live's site rule), linked to the site; its sub line is liveSub. Owner
 * ruling (fix round 1): a site the builder proved is shown even when the repo is private; only a hidden repo's
 * GitHub-hosted site is left out (it names the repo; page-data.ts shownProjects' link rule).
 */
async function liveItem(builderId: number, key: string, hiddenRepo: boolean, now: Date): Promise<Highlight | null> {
  const today = now.toISOString().slice(0, 10);
  const rows = await sql()<{ ref: string; first_up: string; newest_up: boolean; checked: number; up: number }[]>`
    SELECT s.ref, min(r.day) FILTER (WHERE r.ok AND r.signals->>'up' = 'true')::text AS first_up,
      (array_agg(r.signals->>'up' = 'true' ORDER BY r.day DESC) FILTER (WHERE r.ok))[1] AS newest_up,
      count(*) FILTER (WHERE r.ok AND r.day > ${today}::date - ${UPTIME_DAYS}::int)::int AS checked,
      count(*) FILTER (WHERE r.ok AND r.day > ${today}::date - ${UPTIME_DAYS}::int AND r.signals->>'up' = 'true')::int AS up
    FROM builder_sources s JOIN source_readings r ON r.source_id = s.id AND r.day <= ${today}::date
    WHERE s.builder_id = ${builderId} AND s.kind = 'site' AND s.state = 'verified' AND lower(s.project_key) = lower(${key})
    GROUP BY s.id, s.ref ORDER BY 2 NULLS LAST, s.id`;
  for (const r of rows) {
    const host = hostOf(r.ref);
    if (!r.newest_up || !r.first_up || !host) continue;
    if (hiddenRepo && /(^|\.)github\.(io|com)$/.test(host)) continue;
    const href = siteHref(r.ref);
    return { icon: 'live', title: `Live at ${host}`, sub: liveSub(r), ...(href && { href }) };
  }
  return null;
}

/**
 * 2. contract: distinct Base addresses over the project's verified contract sources ("base:0x..."), the contracts a
 * wallet the builder proved by signature created (v3.1 wallet proof: deploy_wallet sources discovery files under their
 * own "base:0x..." key) and EarnKit's deploys on Base, linked to one on Basescan (the earliest when dated). "First
 * deployed" only when every counted contract has a known creation time (a deploy's row, a source's stored Blockscout
 * time, contract-origins.ts backfills the rest), so the date is never later than an undated one; else "Verified
 * onchain". v3.1 wallet proof: "On Base since <Mon YYYY>" joins the sub line when a proven wallet's first Base
 * transaction is known (person_wallets.base_since, read by discovery). Never a wallet address.
 */
async function contractItem(builderId: number, key: string): Promise<Highlight | null> {
  const rows = await sql()<{ a: string; at: Date | null }[]>`
    SELECT a, min(at) AS at FROM (
      SELECT split_part(lower(s.ref), ':', 2) AS a, s.deployed_at AS at FROM builder_sources s
      WHERE s.builder_id = ${builderId} AND s.kind = 'contract' AND s.state = 'verified' AND lower(s.ref) LIKE 'base:0x%'
        AND (lower(s.project_key) = lower(${key}) OR (s.proof = 'deploy_wallet' AND lower(s.project_key) = lower(s.ref)))
      UNION ALL
      SELECT lower(d.address), d.created_at FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
      WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND d.status = 'deployed' AND d.chain = 'base' AND d.address IS NOT NULL AND lower(d.repo_key) = lower(${key})
    ) x WHERE a <> '' GROUP BY a ORDER BY min(at) NULLS LAST, a`;
  const n = rows.length;
  if (n === 0) return null;
  const first = rows[0];
  const href = basescanHref(first.a);
  const allDated = rows.every((r) => r.at !== null);
  const [w] = await sql()<{ since: Date | null }[]>`SELECT min(base_since) AS since FROM person_wallets WHERE builder_id = ${builderId}`;
  const since = w?.since ? `On Base since ${monthYear(new Date(w.since))}` : null;
  return {
    icon: 'contract',
    title: `${n} ${n === 1 ? 'contract' : 'contracts'} on Base`,
    sub: [allDated ? `First deployed ${monthYear(new Date(first.at!))}` : 'Verified onchain', since].filter(Boolean).join(' · '),
    ...(href && { href }),
  };
}

/**
 * 3. code: Base projects only, the stored Builder Codes answer for a repo the builder proved through the App, linked
 * to the file it is in while the repo is public. Only a found code is an item (v3.1 final fix 4): the public page never
 * says "not in the repo"; unknown or not found is no item.
 */
async function codeItem(builderId: number, key: string, publicRepo: boolean, branch: string | null): Promise<Highlight | null> {
  const repo = norm(key);
  if (!(await appProvenRepo(builderId, repo))) return null;
  const known = await storedBuilderCode(repo);
  if (!known?.found) return null;
  const href = publicRepo && known.path ? githubFileHref(repo, branch, known.path) : null;
  return { icon: 'code', title: 'Builder Code in the repo', sub: `Base, checked ${monthDay(new Date(known.checked_at))}`, ...(href && { href }) };
}

/**
 * 4. repo: when the project's repo was created and its commits on the default branch in the read's 52 weeks (the ship
 * reading's created_at and commits_year), linked to the repo while it is public. A repo created inside those 52 weeks
 * says "N commits"; an older one "N commits in the last year". No created_at: no item.
 */
export function repoItem(name: string, reading: Record<string, unknown> | null, repoHref: string | null, now: Date): Highlight | null {
  const raw = reading?.created_at;
  const created = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (!Number.isFinite(created) || created > now.getTime()) return null;
  const n = reading?.commits_year;
  const yearAgo = now.getTime() - 52 * 7 * DAY_MS;
  const sub = typeof n === 'number' && Number.isInteger(n) && n > 0
    ? `${n.toLocaleString('en-US')} ${n === 1 ? 'commit' : 'commits'}${created < yearAgo ? ' in the last year' : ''}`
    : '';
  const what = name === PRIVATE_NAME ? '' : ` ${name}`;
  return { icon: 'repo', title: `Building${what} since ${monthYear(new Date(created))}`, sub, ...(repoHref && { href: repoHref }) };
}

/** 5. won and applied (page-data.ts projectProgramsDated), won first, at most PROGRAMS_MAX, linked to the program's guide when it has one. */
async function programItems(builderId: number, key: string): Promise<Highlight[]> {
  return (await projectProgramsDated(builderId, key)).slice(0, PROGRAMS_MAX).map((g) => ({
    icon: g.won ? 'won' : 'applied',
    title: g.won ? `Won ${g.title}` : `Applied to ${g.title}`,
    sub: monthYear(g.at),
    ...(g.guide && { href: `/programs/${encodeURIComponent(g.guide)}` }),
  }));
}

/** Each part on its own: a failed read is logged and leaves its item out. */
const part = async <T>(name: string, read: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await read();
  } catch (err) {
    console.error(`[site] ${name}`, err instanceof Error ? `${err.name}: ${err.message}` : 'error');
    return fallback;
  }
};

/**
 * The Highlights card: every item a fact a judge can check in one click, linked to its proof, at most HIGHLIGHTS_MAX
 * in order: live, contracts on Base, Builder Code (Base projects), the repo's track record, won or applied (at most
 * 2). Without a Bench-confirmed project, or with none of these yet, one item: on EarnKit since the claim. Never empty.
 */
export async function highlights(builderId: number, d: ProfileData, now: Date): Promise<Highlight[]> {
  const [main, reading] = await Promise.all([mainOf(builderId), mainReading(builderId)]);
  return highlightsOf(builderId, d, now, main, reading);
}
async function highlightsOf(builderId: number, d: ProfileData, now: Date, main: MainRow | null, reading: Record<string, unknown> | null): Promise<Highlight[]> {
  const claimedAt = main ? new Date(main.claimed_at) : now;
  const since = `On EarnKit since ${monthDay(claimedAt)}`;
  if (!main?.key || !main.confirmed || !d.project?.confirmed) return [{ icon: 'start', title: since, sub: main?.starting ? STARTING_ON_BASE : NO_PROJECT_YET }];
  const key = main.key;
  // profileData links a repo-shaped key unless the repo is hidden (page-data.ts shownProjects), so no link is hidden.
  const hiddenRepo = REPO_KEY.test(norm(key)) && d.project.repo === null;
  // A repo is linked only while it reads public (shown) and the reading does not say private: never a link to a 404.
  const publicRepo = REPO_KEY.test(norm(key)) && !hiddenRepo && reading?.private !== true;
  const branch = typeof reading?.default_branch === 'string' ? reading.default_branch : null;
  const [live, contract, code, programs] = await Promise.all([
    part('live', () => liveItem(builderId, key, hiddenRepo, now), null),
    part('contract', () => contractItem(builderId, key), null),
    d.project.chains.includes('base') ? part('code', () => codeItem(builderId, key, publicRepo, branch), null) : Promise.resolve(null),
    part('programs', () => programItems(builderId, key), [] as Highlight[]),
  ]);
  const repo = REPO_KEY.test(norm(key)) ? repoItem(d.project.name, reading, publicRepo ? githubRepoHref(key) : null, now) : null;
  const items = [live, contract, code, repo, ...programs].filter((h): h is Highlight => h !== null).slice(0, HIGHLIGHTS_MAX);
  return items.length > 0 ? items : [{ icon: 'start', title: since, sub: 'On the leaderboard' }];
}

export type StandingPill = { label: string; tier: 'gold' | 'silver' | 'bronze'; title: string };

/**
 * Plan S5, v3.1 GTM W3 (one rank everywhere): the metal standing pill. Only on a ranked page (d.rankListed). Its words
 * are the rank line every other surface shows (rank.ts shownRankLine over the whole leaderboard pool, person-score
 * standingOf, as bench-rank.ts rankLines: the replies, the card, the page meta and the email read the same), so never
 * "Top 7%" on the page beside "#1 of 13 builders" in a reply; none under RANK_MIN_POOL ranked builders. The metal
 * (standingTier) still comes from the percentile; none outside the top 25%. `only` limits the pool (tests).
 */
export async function standingPill(builderId: number, d: ProfileData, o: { only?: number[] } = {}): Promise<StandingPill | null> {
  if (!d.rankListed) return null;
  const s = await standingOf(builderId, o);
  return s.listed ? pillOf(s) : null;
}
/** The pill for a whole-pool standing: label and title the one rank line, the metal from its percentile. Pure. */
export function pillOf(s: Standing): StandingPill | null {
  const line = shownRankLine(s);
  if (!line) return null;
  const tier = standingTier(benchPercent(s.rank, s.total));
  return tier ? { label: line, tier, title: line } : null;
}

/** Plan S8: new backers per ISO week over the last 12 (oldest first), from coin_backers.first_block (Base's 2s blocks). */
export async function backerWeeks(coin: string, now: Date): Promise<number[]> {
  const weeks = last52(now).slice(-12);
  const start = Date.parse(`${mondayOfWeek(weeks[0])}T00:00:00Z`) / 1000;
  const fromBlock = Math.ceil((start - BASE_GENESIS_UNIX) / 2);
  const rows = await sql()<{ i: number; n: number }[]>`
    SELECT ((${BASE_GENESIS_UNIX}::bigint + 2 * first_block - ${start}::bigint) / ${WEEK_S})::int AS i, count(*)::int AS n
    FROM coin_backers WHERE coin = ${coin.toLowerCase()} AND first_block >= ${fromBlock} GROUP BY 1`;
  const out = weeks.map(() => 0);
  for (const r of rows) if (r.i >= 0 && r.i < out.length) out[r.i] = r.n;
  return out;
}

export type TokenCard = { symbol: string; url: string; backers: number; fees_usd: number; weeks: number[]; letter: string; color: string };
export type ProjectPanel = {
  name: string; about: string | null; link: { href: string; text: string } | null; repo: string | null; onBase: boolean; earnkit: boolean; letter: string; color: string;
};
export type ProfileSite = {
  lastShippedAt: string | null; thisWeek: number; highlights: Highlight[]; standing: StandingPill | null; token: TokenCard | null; project: ProjectPanel | null; first: string;
  /** 2026-10-23: the builder said yes to the Base walk-through (the hero's no-project line reads "getting started on Base"). */
  starting?: boolean;
};

/** The GitHub owner of a project key ("owner/repo"), lowercase. Pure. */
const ownerOf = (key: string | null) => (key ? norm(key).split('/')[0] : '');
/** EarnKit's own repos never show Backing (plan Global Constraints; policy-constants BACKING_EXCLUDED_REPOS). Pure. */
const isEarnkitRepo = (key: string) =>
  (EARNKIT_ORGS as readonly string[]).includes(ownerOf(key)) || (BACKING_EXCLUDED_REPOS as readonly string[]).includes(norm(key));
/**
 * Whether the Token card may show for this main project key: fails closed, so an unknown key (none, or its read failed)
 * never shows it, and EarnKit's own repos never do. Pure.
 */
export const tokenAllowed = (key: string | null): boolean => Boolean(key) && !isEarnkitRepo(key!);
/** A link as text: no scheme, no www., no trailing slash. Pure. */
const linkText = (href: string) => href.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
const letterOf = (s: string) => s.trim().charAt(0).toUpperCase() || '?';

/** The inset project panel, from the page's own project (already safe: a hidden repo's name, link and about are not in it). */
function projectPanel(d: ProfileData, key: string | null): ProjectPanel | null {
  const p = d.project;
  if (!p) return null;
  const href = p.live ?? p.repo;
  return {
    name: p.name,
    about: p.what,
    link: href ? { href, text: linkText(href) } : null,
    repo: p.repo,
    onBase: p.chains.includes('base'),
    earnkit: (EARNKIT_ORGS as readonly string[]).includes(ownerOf(key)),
    letter: letterOf(p.name),
    color: logoColor(p.name),
  };
}

/** The Token card: only while EARNKIT_RAISING is on, backing open (d.backing, pillCoin's coin) and never for EarnKit's own repo. */
async function tokenCard(builderId: number, d: ProfileData, key: string | null, now: Date): Promise<TokenCard | null> {
  if (!raisingEnabled() || !d.backing || !tokenAllowed(key)) return null;
  const coin = (await pillCoin(builderId))?.coin;
  if (!coin) return null;
  const { symbol, url, backers, earned_usd } = d.backing;
  return { symbol, url, backers, fees_usd: earned_usd, weeks: await backerWeeks(coin, now), letter: letterOf(symbol), color: logoColor(symbol) };
}

/**
 * Everything the v3.1 profile reads beyond profileData, one call per page view. Each part catches its own error
 * (logged "[site] <part>") and falls back to null, 0 or [] (Highlights' own items fail one by one; [] only when its
 * first read fails). `only` limits the rank pool (tests).
 */
export async function profileSite(builderId: number, d: ProfileData, now: Date, o: { only?: number[] } = {}): Promise<ProfileSite> {
  const [main, reading] = await Promise.all([part('main', () => mainOf(builderId), null), part('reading', () => mainReading(builderId), null)]);
  // A failed main read leaves the key null: the Token card then fails closed (tokenAllowed).
  const key = main?.key ?? null;
  const thisWeek = commitsFrom(reading, now);
  const [items, standing, token] = await Promise.all([
    main ? part('highlights', () => highlightsOf(builderId, d, now, main, reading), [] as Highlight[]) : Promise.resolve([] as Highlight[]),
    part('standing', () => standingPill(builderId, d, o), null),
    part('token', () => tokenCard(builderId, d, key, now), null),
  ]);
  return {
    lastShippedAt: shippedFrom(reading, now)?.toISOString() ?? null,
    thisWeek,
    highlights: items,
    standing,
    token,
    project: projectPanel(d, key),
    first: firstName(d.name, d.handle),
    starting: main?.starting === true,
  };
}

export type FeedWeekStats = { builders: number; commits: number; went_live: number; applications: number };

/**
 * Plan W5: the feed week's four numbers for the week starting `monday`. builders and commits: the week's visible updates
 * (feed.ts feedRows' joins: listed, the one project Bench-confirmed, not hidden, not feed_hidden; uncapped) with
 * shipped_code.n above 0. went_live: the visible updates whose facts say went live. applications: distinct
 * (builder, program) with a submitted entry (page-data.ts programEntries' applied rule) or a told "applied"
 * (builder_program_status) timed inside the week, over all builders, on curated programs only. The visibility rule is feedRows' (including points > 0, which rankFeed sets), so builders never exceeds the cards the feed can show. `only` limits the pool (tests).
 */
export async function feedWeekStats(monday: string, o: { only?: number[] } = {}): Promise<FeedWeekStats> {
  const db = sql();
  const from = new Date(`${monday}T00:00:00Z`);
  const to = new Date(from.getTime() + 7 * DAY_MS);
  // Curated programs only, as the landing lists them: no unlisted, no EarnKit or sponsor campaign.
  const curated = db`g.status <> 'unlisted' AND g.source = 'file' AND g.campaign IS NULL`;
  const [row] = await db<{ builders: number; commits: number; went_live: number }[]>`
    SELECT count(*) FILTER (WHERE n > 0)::int AS builders, COALESCE(sum(n) FILTER (WHERE n > 0), 0)::int AS commits, count(*) FILTER (WHERE live)::int AS went_live
    FROM (
      SELECT COALESCE((u.facts->'shipped_code'->>'n')::int, 0) AS n, COALESCE((u.facts->>'went_live')::boolean, false) AS live
      FROM project_updates u
      JOIN ${listedRanked(db, o.only)} l ON l.builder_id = u.builder_id
      JOIN builder_profiles p ON p.builder_id = u.builder_id AND lower(p.main_project_key) = lower(u.project_key)
      JOIN builder_projects b ON b.builder_id = u.builder_id AND lower(b.project_key) = lower(u.project_key) AND ${benchConfirmedSql(db)}
      WHERE u.week >= ${monday} AND u.week < ${to.toISOString().slice(0, 10)} AND NOT u.hidden AND NOT u.feed_hidden AND u.points > 0
    ) x`;
  const [apps] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT COALESCE(i.builder_id, i.id) AS builder, p.program_id AS program
      FROM projects p JOIN installations i ON i.id = p.installation_id JOIN programs g ON g.id = p.program_id AND ${curated}
      WHERE p.program_id <> ${COIN_PROGRAM} AND p.vetoed_at IS NULL AND p.submitted_at >= ${from} AND p.submitted_at < ${to}
        AND (p.confirmed_at IS NULL OR p.submission_proof_ok_at IS NOT NULL OR p.submission_confirmed_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM submissions su WHERE su.project_id = p.id))
      UNION
      SELECT COALESCE(i.builder_id, i.id), s.program_id
      FROM builder_program_status s JOIN installations i ON i.id = s.installation_id JOIN programs g ON g.id = s.program_id AND ${curated}
      WHERE s.login = '' AND s.status = 'applied' AND s.at >= ${from} AND s.at < ${to}
    ) a`;
  return { builders: row.builders, commits: row.commits, went_live: row.went_live, applications: apps.n };
}
