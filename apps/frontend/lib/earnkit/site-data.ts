import { sql } from './db';
import type { ProfileData } from './bench-data';
import { builderToken, tradeUrl } from './builder-token';
import { allTimeCommunityUsd } from './community';
import { backersOfCoin } from './backers';
import { EARNKIT_ORGS } from './earnkit-orgs';
import { REPO_KEY, benchConfirmedSql } from './main-project';
import { PRIVATE_NAME, norm, programLabel, projectProgramsDated, shownProjects } from './page-data';
import { listedRanked, standingOf, weekCounts } from './person-score';
import { BACKING_EXCLUDED_REPOS, COIN_PROGRAM } from './policy-constants';
import { benchPercent, shownRankLine, type Standing } from './rank';
import { firstName, logoColor, monthDay, monthYear, standingTier } from './site-copy';
import { WALLET_CHAINS, explorerHref, walletChain } from './wallet-chains';
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

export type HighlightIcon = 'live' | 'users' | 'contract' | 'products' | 'consistency' | 'won' | 'experience' | 'start';
/** One Highlights fact; `href`, its proof (opened in a new tab), only where a visitor can open it (never a private repo's). */
export type Highlight = { icon: HighlightIcon; title: string; sub: string; href?: string };
export const HIGHLIGHTS_MAX = 5;
const PROGRAMS_MAX = 2;
/** Products shipped shows from this many distinct live hosts (one is already the live item). */
export const PRODUCTS_MIN = 2;
/** At most this many product hosts are named in its sub line; the rest are "and N more". */
const PRODUCTS_NAMED = 3;
/** Uptime is "Up N of the last D days checked": D the days of the last UPTIME_DAYS with a reading, shown from UPTIME_MIN_READS. */
export const UPTIME_DAYS = 30;
export const UPTIME_MIN_READS = 7;
const count = (n: number) => n.toLocaleString('en-US');

/** A hostname without `www.`, lowercase; null for anything that is not a URL. Pure. */
const hostOf = (ref: string): string | null => {
  const u = URL.canParse(ref) ? new URL(ref) : URL.canParse(`https://${ref}`) ? new URL(`https://${ref}`) : null;
  return u?.hostname ? u.hostname.toLowerCase().replace(/^www\./, '') : null;
};
/** GitHub's own hosts: a hidden repo's site there names the repo (page-data.ts shownProjects' link rule). */
const GITHUB_HOST = /(^|\.)github\.(io|com)$/;

/** A site source's own https origin (the WHATWG parser escapes it), null for anything else. Pure. */
export const siteHref = (ref: string): string | null => {
  const u = URL.canParse(ref) ? new URL(ref) : null;
  return u && u.protocol === 'https:' && u.hostname && !u.username && !u.password ? u.origin : null;
};
const ADDRESS = /^0x[0-9a-f]{40}$/i;
export { explorerHref };
/** The explorers a stored Used by link may point at (wallet-chains.ts). */
const WALLET_EXPLORERS = new Set<string>(WALLET_CHAINS.map((c) => c.explorer));
const segments = (path: string) => path.split('/').map(encodeURIComponent).join('/');
/** A public repo's GitHub page ("owner/repo" keys only). Pure. */
export const githubRepoHref = (key: string): string | null => (REPO_KEY.test(norm(key)) ? `https://github.com/${segments(norm(key))}` : null);
/**
 * A file's GitHub page on a branch (each segment escaped; "HEAD", GitHub's default branch, when the branch is unknown);
 * null for a key that is not "owner/repo", an empty path, or a path that climbs out ("..", "."). Pure. Back for v3.1
 * Used by: a Builder Code number links the file the code is in (used-by.ts stores it, usedByOf shows it while public).
 */
export const githubFileHref = (key: string, branch: string | null, path: string): string | null => {
  const repo = githubRepoHref(key);
  const parts = path.split('/');
  if (!repo || !path || parts.some((x) => x === '' || x === '.' || x === '..')) return null;
  return `${repo}/blob/${segments(branch || 'HEAD')}/${segments(path)}`;
};
const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;

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
    if (hiddenRepo && GITHUB_HOST.test(host)) continue;
    const href = siteHref(r.ref);
    return { icon: 'live', title: `Live at ${host}`, sub: liveSub(r), ...(href && { href }) };
  }
  return null;
}

/** v3.1 Used by: the row shows from this many people (never "1 person"). */
export const USED_MIN = 10;
/** v3.1 Used by: a source's newest day older than this many days is hidden (its daily read has stopped). */
export const USED_STALE_DAYS = 3;
/** One app_usage row (used-by.ts): a source's newest day. */
export type UsageRow = { source: 'contracts' | 'builder_code'; users: number; returning: number; capped: boolean; href: string | null; chains: string[] };

/**
 * 2. used by, v3.1 Used by (2026-10-27, owner: "agreed and go"; real people use what they built): from the newest
 * fresh app_usage row of each source (used-by.ts reads them daily), the one with more people (they overlap, never
 * summed; a tie keeps contracts), from USED_MIN. "Used by N people in the last 30 days" ("N+" when a contract's read
 * hit its page cap); sub "P% came back" (returning: 2 or more ISO weeks), or where when P rounds to 0 ("On Base",
 * "On 2 chains"; nothing when unknown). Link: the busiest contract on its explorer; for a Builder Code number, the
 * file the code is in only while `repoPrefix` (the public main repo's page) starts it, else none. Never a wallet. Pure.
 */
export function usedByOf(rows: UsageRow[], repoPrefix: string | null): Highlight | null {
  const best = bestUsage(rows);
  if (!best) return null;
  const n = best.users;
  const p = Math.round((100 * Math.min(Math.max(best.returning, 0), n)) / n);
  const chains = best.chains.filter((c) => walletChain(c));
  const where = chains.length === 1 ? `On ${walletChain(chains[0])!.label}` : chains.length > 1 ? `On ${count(chains.length)} chains` : '';
  const href = best.source === 'contracts'
    ? (best.href && /^https:\/\/[a-z.]+\/address\/0x[0-9a-f]{40}$/.test(best.href) && WALLET_EXPLORERS.has(new URL(best.href).hostname) ? best.href : null)
    : (best.href && repoPrefix && best.href.startsWith(`${repoPrefix}/blob/`) ? best.href : null);
  return {
    icon: 'users',
    title: `Used by ${count(n)}${best.capped ? '+' : ''} people in the last 30 days`,
    sub: p > 0 ? `${p}% came back` : where,
    ...(href && { href }),
  };
}
/**
 * The Used by source shown (v4.5 Task 3: also the drafts' and replies' usage line): the source with more people, from
 * USED_MIN (they overlap, never summed; a tie keeps contracts), or null. Pure.
 */
export function bestUsage(rows: UsageRow[]): UsageRow | null {
  return rows
    .filter((r) => Number.isInteger(r.users) && r.users >= USED_MIN)
    .sort((a, b) => b.users - a.users || (a.source === 'contracts' ? -1 : 1))[0] ?? null;
}
/** The newest app_usage row of each source no older than USED_STALE_DAYS (a stopped read is hidden). */
export async function usageRows(builderId: number, now: Date): Promise<UsageRow[]> {
  return [...await sql()<UsageRow[]>`
    SELECT DISTINCT ON (source) source, users, "returning" AS returning, capped, href, chains FROM app_usage
    WHERE builder_id = ${builderId} AND day >= ${now.toISOString().slice(0, 10)}::date - ${USED_STALE_DAYS}::int
    ORDER BY source, day DESC`];
}
async function usedByItem(builderId: number, repoPrefix: string | null, now: Date): Promise<Highlight | null> {
  return usedByOf(await usageRows(builderId, now), repoPrefix);
}

/**
 * 3. contracts, v3.1 Highlights competence (2026-10-25, owner: contracts deployed are a good signal, across chains;
 * never anything coin related): the builder's counted wallet_contracts rows (`rows`, oldest first), the contracts a
 * wallet they proved by signature created itself that are not tokens and that another address used (discovery reads
 * them, alchemy.ts alchemyWalletContracts). "3 contracts on Base" on one chain, "12 contracts on 3 chains" on several;
 * sub "Since <Mon YYYY>" from the earliest dated; linked to the earliest on its explorer. Never a wallet address. Pure.
 */
export function contractsOf(rows: { chain: string; address: string; at: Date | string | null }[]): Highlight | null {
  const kept = rows.filter((r) => walletChain(r.chain) && ADDRESS.test(r.address));
  if (kept.length === 0) return null;
  const n = kept.length;
  const chains = new Set(kept.map((r) => r.chain));
  const where = chains.size === 1 ? walletChain(kept[0].chain)!.label : `${count(chains.size)} chains`;
  const dated = kept.filter((r) => r.at !== null && Number.isFinite(new Date(r.at).getTime())).sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime());
  const first = dated[0] ?? kept[0];
  const href = explorerHref(first.chain, first.address);
  return {
    icon: 'contract',
    title: `${count(n)} ${n === 1 ? 'contract' : 'contracts'} on ${where}`,
    sub: dated[0] ? `Since ${monthYear(new Date(dated[0].at!))}` : '',
    ...(href && { href }),
  };
}
async function contractsItem(builderId: number): Promise<Highlight | null> {
  return contractsOf(await sql()<{ chain: string; address: string; at: Date | null }[]>`
    SELECT c.chain, c.address, c.created_at AS at FROM wallet_contracts c JOIN person_wallets w ON w.wallet = c.wallet
    WHERE w.builder_id = ${builderId} AND c.counts ORDER BY c.created_at NULLS LAST, c.chain, c.address`);
}

/**
 * 4. products, v3.1 Highlights competence: the distinct hosts of the builder's verified site sources, any project, that
 * read up at least once, oldest first up day first (liveItem's rules: hostOf, and a hidden repo's GitHub-hosted site
 * left out). From PRODUCTS_MIN: "Shipped N products", the first PRODUCTS_NAMED hosts named ("and N more" after),
 * linked to the oldest one's site.
 */
async function productsItem(builderId: number): Promise<Highlight | null> {
  const rows = await sql()<{ ref: string; key: string }[]>`
    SELECT s.ref, s.project_key AS key FROM builder_sources s JOIN source_readings r ON r.source_id = s.id
    WHERE s.builder_id = ${builderId} AND s.kind = 'site' AND s.state = 'verified' AND r.ok AND r.signals->>'up' = 'true'
    GROUP BY s.id, s.ref, s.project_key ORDER BY min(r.day), s.id`;
  const sites = rows.map((r) => ({ ...r, host: hostOf(r.ref) })).filter((r): r is typeof r & { host: string } => r.host !== null);
  // Only a GitHub-hosted site needs its project's repo shown (shownProjects); an unknown repo-shaped key reads hidden.
  const github = sites.filter((r) => GITHUB_HOST.test(r.host));
  const shown = github.length ? new Map(((await shownProjects([builderId])).get(builderId) ?? []).map((p) => [norm(p.key), !p.hiddenRepo])) : new Map<string, boolean>();
  const hosts: { host: string; ref: string }[] = [];
  for (const r of sites) {
    if (GITHUB_HOST.test(r.host) && (shown.get(norm(r.key)) ?? !REPO_KEY.test(norm(r.key))) === false) continue;
    if (!hosts.some((h) => h.host === r.host)) hosts.push(r);
  }
  return productsOf(hosts);
}
/** The products item from its hosts, oldest first. Pure. */
export function productsOf(hosts: { host: string; ref: string }[]): Highlight | null {
  if (hosts.length < PRODUCTS_MIN) return null;
  const named = hosts.slice(0, PRODUCTS_NAMED).map((h) => h.host).join(', ');
  const more = hosts.length - PRODUCTS_NAMED;
  const href = siteHref(hosts[0].ref);
  return { icon: 'products', title: `Shipped ${count(hosts.length)} products`, sub: more > 0 ? `${named} and ${count(more)} more` : named, ...(href && { href }) };
}

/**
 * 5. consistency, v3.1 Highlights competence (replaces the repo's commit count): the weeks with code in the profile's
 * 52-week grid (ProfileData.grid), "Shipped in N of the last 52 weeks", from one week. Sub "Building <name> since
 * <Mon YYYY>" from the ship reading's created_at (no name for PRIVATE_NAME; empty when unknown or in the future),
 * linked to the repo while it is public. Pure.
 */
export function consistencyItem(name: string, grid: { on: boolean }[], reading: Record<string, unknown> | null, repoHref: string | null, now: Date): Highlight | null {
  const n = grid.filter((w) => w.on).length;
  if (n < 1) return null;
  const raw = reading?.created_at;
  const created = typeof raw === 'string' ? Date.parse(raw) : NaN;
  const what = name === PRIVATE_NAME ? '' : ` ${name}`;
  const sub = Number.isFinite(created) && created <= now.getTime() ? `Building${what} since ${monthYear(new Date(created))}` : '';
  return { icon: 'consistency', title: `Shipped in ${count(n)} of the last 52 weeks`, sub, ...(repoHref && { href: repoHref }) };
}

/**
 * 6. won (page-data.ts projectProgramsDated): won, funded or accepted only (programLabel), never "Applied to", at most
 * PROGRAMS_MAX, linked to the program's guide when it has one.
 */
async function programItems(builderId: number, key: string): Promise<Highlight[]> {
  // GTM W2: an acceptance or funding a public page proved is an outcome; v3.1 Highlights competence: only outcomes show.
  return (await projectProgramsDated(builderId, key)).filter((g) => g.won || g.outcome).slice(0, PROGRAMS_MAX).map((g) => ({
    icon: 'won' as const,
    title: programLabel(g)!,
    sub: monthYear(g.at),
    ...(g.guide && { href: `/programs/${encodeURIComponent(g.guide)}` }),
  }));
}

/**
 * 7. experience, v3.1 Highlights competence: when the builder's GitHub account was made (github_users, which
 * people-signals.ts fills) for the proven login (builder_profiles.github_login is only ever set from a verified
 * source), linked to their GitHub profile. A filler: shown only while the rows before it leave a slot.
 */
async function experienceItem(builderId: number): Promise<Highlight | null> {
  const [r] = await sql()<{ login: string; at: Date }[]>`
    SELECT p.github_login AS login, g.created_at AS at FROM builder_profiles p JOIN github_users g ON g.login = lower(p.github_login)
    WHERE p.builder_id = ${builderId} AND p.github_login IS NOT NULL`;
  if (!r || !LOGIN.test(r.login)) return null;
  const at = new Date(r.at);
  return { icon: 'experience', title: `Writing code since ${at.getUTCFullYear()}`, sub: `On GitHub since ${monthYear(at)}`, href: `https://github.com/${r.login.toLowerCase()}` };
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
 * The Highlights card, v3.1 Highlights competence (owner ruling 2026-10-25: what ecosystems and investors value about
 * the builder's competence, chain-agnostic; never anything coin related, no Base-only rows): every item a fact a judge
 * can check in one click, linked to its proof, at most HIGHLIGHTS_MAX in order: live, used by (v3.1 Used by: people
 * in the last 30 days, from USED_MIN), contracts deployed (every chain),
 * products shipped (from 2), consistency (weeks with code), won (at most 2), then experience (GitHub's account age)
 * only while a slot is free. Without a Bench-confirmed project, or with none of these yet, one item: on EarnKit since
 * the claim. Never empty.
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
  const [live, usedBy, contracts, products, programs, experience] = await Promise.all([
    part('live', () => liveItem(builderId, key, hiddenRepo, now), null),
    part('used by', () => usedByItem(builderId, publicRepo ? githubRepoHref(key) : null, now), null),
    part('contracts', () => contractsItem(builderId), null),
    part('products', () => productsItem(builderId), null),
    part('programs', () => programItems(builderId, key), [] as Highlight[]),
    part('experience', () => experienceItem(builderId), null),
  ]);
  const consistency = consistencyItem(d.project.name, d.grid, reading, publicRepo ? githubRepoHref(key) : null, now);
  // Experience is last, so the slice keeps it only while the rows before it leave a slot.
  const items = [live, usedBy, contracts, products, consistency, ...programs, experience].filter((h): h is Highlight => h !== null).slice(0, HIGHLIGHTS_MAX);
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

/**
 * The builder's token on the Token card: `backers` is its holders, `url` where to trade it, `photo` the builder's X
 * photo (https only; else null and the circle shows `letter`, the builder's initial, on `color`).
 */
export type TokenCard = { symbol: string; url: string; backers: number; fees_usd: number; weeks: number[]; letter: string; color: string; photo: string | null };
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

/** An https photo URL, else null (an http or malformed one never shows). Pure. */
const httpsPhoto = (u: string | null) => (u && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null);

/**
 * v4.0 Task 9: the Token card is the builder's own token (builder_tokens status 'launched' with its coin), never a
 * project's coin and whatever EARNKIT_RAISING says: $SYMBOL, its holders (coin_backers), every creator fee claimed to
 * its wallet (community.ts allTimeCommunityUsd), 12 weeks of new holders, Trade on Uniswap, the X photo. Declined,
 * launching, unknown or no row: null.
 */
async function tokenCard(builderId: number, d: ProfileData, now: Date): Promise<TokenCard | null> {
  const t = await builderToken(builderId);
  if (t?.status !== 'launched' || !t.coin_address || !t.symbol) return null;
  const coin = t.coin_address.toLowerCase();
  const [[p], backers, fees_usd, weeks] = await Promise.all([
    sql()<{ x_avatar_url: string | null }[]>`SELECT x_avatar_url FROM builder_profiles WHERE builder_id = ${builderId}`,
    backersOfCoin(coin),
    allTimeCommunityUsd(builderId),
    backerWeeks(coin, now),
  ]);
  const first = firstName(d.name, d.handle);
  return { symbol: t.symbol, url: tradeUrl(coin), backers, fees_usd, weeks, letter: letterOf(first), color: logoColor(first), photo: httpsPhoto(p?.x_avatar_url ?? null) };
}

/**
 * Everything the v3.1 profile reads beyond profileData, one call per page view. Each part catches its own error
 * (logged "[site] <part>") and falls back to null, 0 or [] (Highlights' own items fail one by one; [] only when its
 * first read fails). `only` limits the rank pool (tests).
 */
export async function profileSite(builderId: number, d: ProfileData, now: Date, o: { only?: number[] } = {}): Promise<ProfileSite> {
  const [main, reading] = await Promise.all([part('main', () => mainOf(builderId), null), part('reading', () => mainReading(builderId), null)]);
  const key = main?.key ?? null;
  const thisWeek = commitsFrom(reading, now);
  const [items, standing, token] = await Promise.all([
    main ? part('highlights', () => highlightsOf(builderId, d, now, main, reading), [] as Highlight[]) : Promise.resolve([] as Highlight[]),
    part('standing', () => standingPill(builderId, d, o), null),
    part('token', () => tokenCard(builderId, d, now), null),
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
  const curated = db`g.status <> 'unlisted' AND g.source IN ('file', 'api') AND g.campaign IS NULL`;
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
