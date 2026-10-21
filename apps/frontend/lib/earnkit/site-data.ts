import { sql } from './db';
import type { ProfileData } from './bench-data';
import { benchPool } from './bench-rank';
import { appProvenRepo, builderCodesKnown } from './builder-codes-check';
import { raisingEnabled } from './builder-score-flag';
import { EARNKIT_ORGS } from './earnkit-orgs';
import { REPO_KEY, benchConfirmedSql } from './main-project';
import { norm, projectProgramsDated } from './page-data';
import { standingOf, weekCounts } from './person-score';
import { BACKING_EXCLUDED_REPOS } from './policy-constants';
import { RANK_MIN_POOL, benchPercent, percentText, rankLine, type Standing } from './rank';
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

type MainRow = { key: string | null; claimed_at: Date; confirmed: boolean };

/** The one project's key, the claim's time (else the profile's creation) and whether the Bench counts the project confirmed now. */
async function mainOf(builderId: number): Promise<MainRow | null> {
  const db = sql();
  const [r] = await db<MainRow[]>`
    SELECT p.main_project_key AS key, COALESCE(p.claimed_at, p.created_at) AS claimed_at, COALESCE(b.confirmed, false) AS confirmed
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
  const [r] = await db<{ signals: Record<string, unknown> }[]>`
    SELECT x.signals FROM builder_profiles f
    JOIN builder_projects b ON b.builder_id = f.builder_id AND lower(b.project_key) = lower(f.main_project_key) AND ${benchConfirmedSql(db)}
    JOIN builder_sources s ON s.builder_id = f.builder_id AND s.kind = 'repo' AND s.state = 'verified' AND lower(s.project_key) = lower(b.project_key)
    JOIN LATERAL ${shipReading(db)} x ON true
    WHERE f.builder_id = ${builderId}
    ORDER BY (lower(s.ref) = lower(b.project_key)) DESC, s.id LIMIT 1`;
  return r?.signals ?? null;
}

/** Plan S6: the last push to the one project's repo (its ship reading's pushed_at); null when absent, unparsable or after `now`. */
export async function lastShippedAt(builderId: number, now: Date): Promise<Date | null> {
  const raw = (await mainReading(builderId))?.pushed_at;
  if (typeof raw !== 'string') return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t <= now.getTime() ? new Date(t) : null;
}

/** Plan S7: this ISO week's commits on the ship reading, through the anti-backdating floor (person-score.ts weekCounts); else 0. */
export async function thisWeekCommits(builderId: number, now: Date): Promise<number> {
  const g = await mainReading(builderId);
  const week = isoWeekOf(now);
  if (!g || !weekCounts(g, week, now)) return 0;
  const counts = g.commit_counts as Record<string, unknown> | null | undefined;
  const n = Number(counts?.[week] ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export type HighlightIcon = 'live' | 'code' | 'contract' | 'applied' | 'won' | 'start';
export type Highlight = { icon: HighlightIcon; title: string; sub: string };
const HIGHLIGHTS_MAX = 5;
const PROGRAMS_MAX = 2;

/** A hostname without `www.`, lowercase; null for anything that is not a URL. Pure. */
const hostOf = (ref: string): string | null => {
  const u = URL.canParse(ref) ? new URL(ref) : URL.canParse(`https://${ref}`) ? new URL(`https://${ref}`) : null;
  return u?.hostname ? u.hostname.toLowerCase().replace(/^www\./, '') : null;
};

/**
 * live: the first day a verified site source of the project read up (week-facts.ts went_live's site rule). A hidden
 * repo's site is left out when its host is GitHub's or carries the repo's name (Highlights never names a hidden repo).
 */
async function liveItem(builderId: number, key: string, hiddenRepo: boolean): Promise<Highlight | null> {
  const [r] = await sql()<{ ref: string; day: string }[]>`
    SELECT s.ref, min(r.day)::text AS day FROM source_readings r JOIN builder_sources s ON s.id = r.source_id
    WHERE s.builder_id = ${builderId} AND s.kind = 'site' AND s.state = 'verified' AND lower(s.project_key) = lower(${key}) AND r.ok AND r.signals->>'up' = 'true'
    GROUP BY s.id, s.ref ORDER BY min(r.day), s.id LIMIT 1`;
  const host = r ? hostOf(r.ref) : null;
  if (!r || !host) return null;
  const repoName = norm(key).split('/')[1] ?? '';
  if (hiddenRepo && (/(^|\.)github\.(io|com)$/.test(host) || (repoName && host.includes(repoName)))) return null;
  return { icon: 'live', title: `Live at ${host}`, sub: `Since ${monthYear(new Date(`${r.day}T00:00:00Z`))}` };
}

/** code: Base projects only, the stored Builder Codes answer for a repo the builder proved through the App; unknown is no item. */
async function codeItem(builderId: number, key: string, now: Date): Promise<Highlight | null> {
  const repo = norm(key);
  if (!(await appProvenRepo(builderId, repo))) return null;
  const known = await builderCodesKnown(repo, now);
  if (!known) return null;
  return { icon: 'code', title: 'Base Builder Code', sub: known.found ? 'Found in the repo' : 'Not in the repo yet' };
}

/** contract: distinct Base addresses over the project's verified contract sources ("base:0x...") and EarnKit's deploys on Base. */
async function contractItem(builderId: number, key: string): Promise<Highlight | null> {
  const [{ n }] = await sql()<{ n: number }[]>`
    SELECT count(DISTINCT a)::int AS n FROM (
      SELECT split_part(lower(s.ref), ':', 2) AS a FROM builder_sources s
      WHERE s.builder_id = ${builderId} AND s.kind = 'contract' AND s.state = 'verified' AND lower(s.project_key) = lower(${key}) AND lower(s.ref) LIKE 'base:0x%'
      UNION ALL
      SELECT lower(d.address) FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
      WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND d.status = 'deployed' AND d.chain = 'base' AND d.address IS NOT NULL AND lower(d.repo_key) = lower(${key})
    ) x WHERE a <> ''`;
  return n > 0 ? { icon: 'contract', title: `${n} ${n === 1 ? 'contract' : 'contracts'} on Base`, sub: 'Deployed by the project' } : null;
}

/** won and applied (page-data.ts projectProgramsDated), won first, at most PROGRAMS_MAX. */
async function programItems(builderId: number, key: string): Promise<Highlight[]> {
  return (await projectProgramsDated(builderId, key))
    .slice(0, PROGRAMS_MAX)
    .map((g) => (g.won ? { icon: 'won', title: `Won ${g.title}`, sub: monthDay(g.at) } : { icon: 'applied', title: `Applied to ${g.title}`, sub: monthDay(g.at) }));
}

/** start: since the oldest commit week on the grid (its Monday), else the claim. Pure. */
function startItem(d: ProfileData, claimedAt: Date, now: Date): Highlight {
  const firstOn = d.grid.find((g) => g.on);
  const monday = firstOn ? mondayOfWeek(firstOn.week) : null;
  const since = monday ? new Date(`${monday}T00:00:00Z`) : claimedAt;
  const title = `Shipping since ${now.getTime() - since.getTime() <= 12 * 7 * DAY_MS ? monthDay(since) : monthYear(since)}`;
  const on = d.grid.filter((g) => g.on).length;
  const sub =
    now.getTime() - claimedAt.getTime() <= 14 * DAY_MS && d.log.length <= 1
      ? 'First week on EarnKit'
      : d.streak >= 2
        ? `${d.streak} weeks in a row`
        : `${on} ${on === 1 ? 'week' : 'weeks'} with code in the last year`;
  return { icon: 'start', title, sub };
}

/** Each part on its own: a failed read is logged and leaves its item out. */
const part = async <T>(name: string, read: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await read();
  } catch (err) {
    console.error(`[site] ${name}`, err instanceof Error ? err.name : 'error');
    return fallback;
  }
};

/**
 * Plan W8: the Highlights card, at most HIGHLIGHTS_MAX verifiable facts in order: live, Base Builder Code (Base
 * projects), contracts on Base, won or applied (at most 2), shipping since. Without a Bench-confirmed project, one
 * item: on EarnKit since the claim. Never empty.
 */
export async function highlights(builderId: number, d: ProfileData, now: Date): Promise<Highlight[]> {
  const main = await mainOf(builderId);
  const claimedAt = main ? new Date(main.claimed_at) : now;
  if (!main?.key || !main.confirmed || !d.project?.confirmed)
    return [{ icon: 'start', title: `On EarnKit since ${monthDay(claimedAt)}`, sub: 'No project on the leaderboard yet' }];
  const key = main.key;
  // profileData links a repo-shaped key unless the repo is hidden (page-data.ts shownProjects), so no link is hidden.
  const hiddenRepo = REPO_KEY.test(norm(key)) && d.project.repo === null;
  const [live, code, contract, programs] = await Promise.all([
    part('live', () => liveItem(builderId, key, hiddenRepo), null),
    d.project.chains.includes('base') ? part('code', () => codeItem(builderId, key, now), null) : Promise.resolve(null),
    part('contract', () => contractItem(builderId, key), null),
    part('programs', () => programItems(builderId, key), [] as Highlight[]),
  ]);
  const items = [live, code, contract, ...programs].filter((h): h is Highlight => h !== null);
  return [...items.slice(0, HIGHLIGHTS_MAX - 1), startItem(d, claimedAt, now)];
}

export type StandingPill = { label: string; tier: 'gold' | 'silver' | 'bronze'; title: string };

/** The Base pool's standing of the builder (bench-rank.ts rankLines' chain SQL). */
async function baseStanding(builderId: number, o: { only?: number[] }): Promise<Standing | null> {
  const [me] = await sql()<{ score: number }[]>`SELECT score FROM builder_live WHERE builder_id = ${builderId}`;
  if (!me) return null;
  const [r] = await sql()<{ total: number; rank: number }[]>`
    SELECT (count(*) + CASE WHEN bool_or(x.builder_id = ${builderId}) THEN 0 ELSE 1 END)::int AS total,
      (1 + count(*) FILTER (WHERE x.score > ${me.score} AND x.builder_id <> ${builderId}))::int AS rank
    FROM ${benchPool(o.only)} x WHERE 'base' = ANY(x.chains)`;
  return { ranked: true, rank: r.rank, total: r.total };
}

/**
 * Plan S5: the metal "Top N%" pill. Only on a ranked page (d.rankListed); the Base pool's percentile when the project
 * is on Base and that pool has RANK_MIN_POOL ranked builders, else the whole pool's from RANK_MIN_POOL; none outside
 * the top 25% (standingTier). `title` is the rank line (rank.ts rankLine). `only` limits the pool (tests).
 */
export async function standingPill(builderId: number, d: ProfileData, o: { only?: number[] } = {}): Promise<StandingPill | null> {
  if (!d.rankListed) return null;
  const pill = (s: Standing, where: 'base' | null): StandingPill | null => {
    const title = rankLine(s, where ? { chain: where } : {});
    if (!title) return null;
    const pct = benchPercent(s.rank, s.total);
    const tier = standingTier(pct);
    return tier ? { label: `Top ${percentText(pct)}% ${where ? 'on Base' : 'of builders'}`, tier, title } : null;
  };
  if (d.project?.chains.includes('base')) {
    const s = await baseStanding(builderId, o);
    if (s && s.total >= RANK_MIN_POOL) return pill(s, 'base');
  }
  const s = await standingOf(builderId, o);
  return s.listed && s.total >= RANK_MIN_POOL ? pill(s, null) : null;
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
};

/** The GitHub owner of a project key ("owner/repo"), lowercase. Pure. */
const ownerOf = (key: string | null) => (key ? norm(key).split('/')[0] : '');
/** EarnKit's own repos never show Backing (plan Global Constraints; policy-constants BACKING_EXCLUDED_REPOS). Pure. */
const isEarnkitRepo = (key: string | null) =>
  Boolean(key) && ((EARNKIT_ORGS as readonly string[]).includes(ownerOf(key)) || (BACKING_EXCLUDED_REPOS as readonly string[]).includes(norm(key!)));
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
  if (!raisingEnabled() || !d.backing || isEarnkitRepo(key)) return null;
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
  const main = await part('main', () => mainOf(builderId), null);
  const key = main?.key ?? null;
  const [shipped, thisWeek, items, standing, token] = await Promise.all([
    part('shipped', () => lastShippedAt(builderId, now), null),
    part('this week', () => thisWeekCommits(builderId, now), 0),
    part('highlights', () => highlights(builderId, d, now), [] as Highlight[]),
    part('standing', () => standingPill(builderId, d, o), null),
    part('token', () => tokenCard(builderId, d, key, now), null),
  ]);
  return {
    lastShippedAt: shipped ? shipped.toISOString() : null,
    thisWeek,
    highlights: items,
    standing,
    token,
    project: projectPanel(d, key),
    first: firstName(d.name, d.handle),
  };
}
