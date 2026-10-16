import { sql } from './db';
import { newProgramOf, openCuratedRows, repoCanWin } from './alerts';
import { benchPool, chainPools, rankLines } from './bench-rank';
import { raisingEnabled } from './builder-score-flag';
import { readFitRepos } from './installations';
import { REPO_KEY, benchConfirmedSql } from './main-project';
import { listedRanked } from './person-score';
import { avatarUrl, displayName, money, norm, projectPrograms, safeNames, shownProjects } from './page-data';
import { COIN_PROGRAM } from './policy-constants';
import { byPrize, type Card } from './present';
import { listPrograms } from './programs';
import { pillOf, raisingCoin } from './raising';
import { BENCH_CHAINS, CHAIN_CHIP_MIN, benchRank, type BenchChain } from './rank';
import { MAX_V2 } from './score-v2';
import { earnPrize, earnWhen, showable } from './stand-view';
import { shownUrl } from './untrusted-text';
import { factChips, hasFacts, startedChips, startedLine, type WeekFacts } from './week-facts';
import { last52, weekOfMonday } from './weeks';

/** v2.13 spec "The Bench": its rows and its URL filters (R9). */
export type BenchFilter = { chain: BenchChain | null; raising: boolean; weekly: boolean };
/** "Shipping every week": a streak of at least this many weeks. */
export const WEEKLY_STREAK = 4;
export const BENCH_MAX = 100;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/** Pure but for EARNKIT_RAISING. Anything but one known value per key is ignored, so at most 4 x 2 x 2 = 16 variants exist. */
export function parseBenchFilter(q: Record<string, string | string[] | undefined>): BenchFilter {
  const c = one(q.chain)?.toLowerCase();
  // EARNKIT_RAISING off: the raising filter doesn't exist (?raising=1 is ignored).
  const raising = raisingEnabled() && one(q.raising) === '1';
  return { chain: (BENCH_CHAINS as readonly string[]).includes(c ?? '') ? (c as BenchChain) : null, raising, weekly: one(q.weekly) === '1' };
}

/** Pure. The one URL of a filter variant (also its cache key). */
export function filterHref(f: BenchFilter): string {
  const p = new URLSearchParams();
  if (f.chain) p.set('chain', f.chain);
  if (f.raising) p.set('raising', '1');
  if (f.weekly) p.set('weekly', '1');
  const s = p.toString();
  return s ? `/bench?${s}` : '/bench';
}

/** Pure. The project's one best fact in plain words: people this week, then the streak, then weeks shipping. */
export function bestFact(p: { people_week: number; streak: number; weeks_shipping: number; shipped: boolean }): string {
  if (p.people_week > 0) return `${p.people_week.toLocaleString('en-US')} ${p.people_week === 1 ? 'person' : 'people'} this week`;
  if (p.streak >= 2) return `${p.streak} weeks in a row`;
  if (p.weeks_shipping > 0) return `${p.weeks_shipping} ${p.weeks_shipping === 1 ? 'week' : 'weeks'} shipping`;
  return p.shipped ? 'Live' : 'Building';
}

export type BenchRow = { rank: number; line: string | null; handle: string; name: string; avatar: string | null; raising: { symbol: string; url: string } | null; chains: BenchChain[]; project: string; best: string };

/**
 * The Bench: the listed ranked people whose one project counts as confirmed now (bench-rank
 * benchPool: final fix M1, the gate is read here, not only at the last rescore), best score first,
 * filtered by chain, raising and the weekly streak. A rank is always the whole Bench's. The coin read
 * mirrors raising.ts raisingCoin (the newest coin on the one project); the pill is pillOf's rule in
 * the same read (final fix M7: launched, raising, the one project confirmed, and EARNKIT_RAISING on).
 * The project's name is the shown one (final fix I1: never a private repo's).
 */
export async function benchRows(f: BenchFilter, o: { limit?: number; only?: number[] } = {}): Promise<{ rows: BenchRow[]; count: number; chips: BenchChain[] }> {
  const db = sql();
  const raisingOn = raisingEnabled();
  const byRaising = f.raising && raisingOn;
  const rows = await db<{ builder_id: number; rank: number; handle: string; x_name: string | null; avatar: string | null; chains: string[]; key: string;
    people_week: number; streak: number; weeks_shipping: number; shipped: boolean; raising: boolean; symbol: string | null; url: string | null }[]>`
    WITH ranked AS (
      SELECT x.builder_id, x.score, rank() OVER (ORDER BY x.score DESC)::int AS rank FROM ${benchPool(o.only)} x)
    SELECT r.builder_id, r.rank, p.x_handle AS handle, p.x_name, p.x_avatar_url AS avatar, b.chains, b.project_key AS key, b.people_week, b.streak, b.weeks_shipping, b.shipped,
      COALESCE(c.token_status = 'launched' AND c.raising_at IS NOT NULL, false) AS raising, c.token_symbol AS symbol, c.token_url AS url
    FROM ranked r JOIN builder_profiles p USING (builder_id)
    JOIN builder_projects b ON b.builder_id = r.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)}
    LEFT JOIN LATERAL (SELECT x.token_status, x.raising_at, x.token_symbol, x.token_url FROM projects x JOIN installations i ON i.id = x.installation_id
      WHERE COALESCE(i.builder_id, i.id) = r.builder_id AND x.token_url IS NOT NULL AND x.token_symbol IS NOT NULL
        AND (x.token_repo_key = 'github.com/' || lower(p.main_project_key)
          OR lower(x.repo_url) IN (lower('https://github.com/' || p.main_project_key), lower('https://github.com/' || p.main_project_key || '/')))
      ORDER BY x.coin_launched_at DESC NULLS LAST, x.id DESC LIMIT 1) c ON true
    WHERE (${f.chain}::text IS NULL OR ${f.chain}::text = ANY(b.chains))
      AND (NOT ${byRaising}::boolean OR (c.token_status = 'launched' AND c.raising_at IS NOT NULL))
      AND (NOT ${f.weekly}::boolean OR b.streak >= ${WEEKLY_STREAK})
    ORDER BY r.score DESC, lower(p.x_handle) LIMIT ${Math.min(BENCH_MAX, o.limit ?? BENCH_MAX)}`;
  const [{ total }] = await db<{ total: number }[]>`SELECT count(*)::int AS total FROM ${benchPool(o.only)} x`;
  const pools = await chainPools(o);
  const nameOf = await safeNames(rows.map((r) => r.builder_id));
  const pill = (r: (typeof rows)[number]) => (raisingOn && r.raising && r.symbol && r.url ? { symbol: r.symbol, url: r.url } : null);
  return {
    count: total,
    chips: BENCH_CHAINS.filter((c) => pools[c] >= CHAIN_CHIP_MIN),
    rows: rows.map((r) => ({
      rank: r.rank,
      // The page is the Bench: "Top 4%" or "#3 of 12", without "on the Bench".
      line: benchRank({ ranked: true, rank: r.rank, total })?.short.replace(/ on the Bench$/, '') ?? null,
      handle: r.handle,
      name: displayName(r.x_name, r.handle),
      avatar: avatarUrl(r.avatar),
      raising: pill(r),
      chains: BENCH_CHAINS.filter((c) => r.chains.includes(c)),
      project: nameOf(r.builder_id, r.key),
      best: bestFact(r),
    })),
  };
}

// ---- v2.13 T11: the profile (spec "Profile", R10, R11, R12) ----------------------------------------

/** One card in the Ship log: the week's Monday, the update (or null), the fact chips; `started` marks the Started card. */
export type ProfileCard = { week: string; text: string | null; chips: string[]; started?: string | null };
export type ProjectTabData = {
  name: string; what: string | null; live: string | null; repo: string | null; chains: BenchChain[]; people: number | null; money: string | null;
  coin: { symbol: string; url: string } | null; programs: { title: string; won: boolean }[]; funds: string[]; confirmed: boolean;
};
export type ProfileData = {
  handle: string; name: string; avatar: string | null; initials: string; raising: { symbol: string; url: string } | null; bench: string | null;
  chainLines: { chain: BenchChain; label: string; line: string }[]; score: number | null;
  parts: { label: 'Shipped' | 'Used' | 'Earned' | 'Consistency'; points: number; max: number }[];
  grid: { week: string; on: boolean }[]; streak: number; log: ProfileCard[]; project: ProjectTabData | null;
};

const PARTS = [['Shipped', 'shipped'], ['Used', 'used'], ['Earned', 'earned'], ['Consistency', 'consistency']] as const;
/** The Ship log reads at most this many weeks. */
const LOG_MAX = 60;
/** At most this many "Ways to get funded" lines. */
const FUNDS_MAX = 3;

/** The project's live site: its link, never its GitHub page (that is the code link). Pure. */
const liveSite = (link: string | null) => {
  const u = shownUrl(link);
  return u && !/(^|\.)github\.com$/i.test(new URL(u).hostname) ? u : null;
};

/** "6 weeks in a row"; null under one week. Pure. */
export const streakWords = (n: number): string | null => (n >= 1 ? `${n} ${n === 1 ? 'week' : 'weeks'} in a row` : null);

/** The first letter of the handle, as Avatar draws it. Pure. */
export const initialsOf = (handle: string) => handle.replace(/^_+/, '').charAt(0).toUpperCase() || '?';

/** v2.13.1 O3: the chip a week's card carries when tracking started that week. */
export const STARTED_CHIP = 'Started tracking';

/**
 * The Ship log, newest first: a week with text or facts is a card (chips alone when there is no
 * text). The week with facts.started: v2.13.1 O3, when it has a card, the start is a chip on it
 * ("Started tracking" first, then the start's own chips), never a second card under the same week
 * heading; with no card that week, the Started card. Hidden weeks never. Pure.
 */
export function logCards(rows: { week: string; text: string | null; facts: WeekFacts }[], name: string, raising: string | null): ProfileCard[] {
  const out: ProfileCard[] = [];
  for (const r of rows) {
    const facts = r.facts ?? {};
    // The Raising chip once, on the newest card (the header carries the pill).
    if (r.text || hasFacts(facts)) {
      const chips = factChips(facts, { raising: out.length === 0 ? raising : null });
      // O3 fix round 1: one live chip on a start week that went live ("Went live", not also "Live").
      const own = facts.started ? startedChips(facts.started).filter((c) => !(c === 'Live' && facts.went_live)) : [];
      const start = facts.started ? [STARTED_CHIP, ...own] : [];
      out.push({ week: r.week, text: r.text, chips: [...new Set([...start.slice(0, 1), ...chips, ...start.slice(1)])] });
    } else if (facts.started) out.push({ week: r.week, text: null, chips: startedChips(facts.started), started: startedLine(name) });
  }
  return out;
}

/**
 * v2.13.1 O3: the grid's shipping weeks: the rescored ship weeks, plus every shown week whose row
 * EarnKit checked commits for (facts.shipped_code), so a card with commits always has its square
 * filled, even before the next rescore. Pure.
 */
export function gridWeeks(shipWeeks: string[], rows: { week: string; facts: WeekFacts }[]): Set<string> {
  const weeks = new Set(shipWeeks);
  for (const r of rows) {
    const w = (r.facts?.shipped_code?.n ?? 0) > 0 ? weekOfMonday(r.week) : null;
    if (w) weeks.add(w);
  }
  return weeks;
}

/**
 * "Ways to get funded": the open curated programs the project `key` can win now, by find's rules
 * without a GitHub read (stand-view.ts scoreEarn: alerts.ts repoCanWin over the fits find last saw),
 * biggest prize first, entered ones left out. Never throws (no lines on an error).
 */
async function fundLines(builderId: number, key: string, now: Date): Promise<string[]> {
  try {
    const [programs, fits, rows, entered] = await Promise.all([
      listPrograms(),
      readFitRepos(builderId),
      openCuratedRows(),
      sql()<{ program_id: string }[]>`SELECT DISTINCT p.program_id FROM projects p JOIN installations i ON i.id = p.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND p.program_id <> ${COIN_PROGRAM}`,
    ]);
    const mine = fits.filter((f) => f.key.toLowerCase() === key.toLowerCase());
    if (mine.length === 0) return [];
    const byId = new Map(rows.map((r) => [r.id, newProgramOf(r)]));
    const skip = new Set(entered.map((e) => e.program_id));
    const out: string[] = [];
    for (const c of (programs as (Card & { agent_completable?: boolean; earnkit_campaign?: boolean })[]).filter((x) => showable(x, now, skip)).sort(byPrize)) {
      const np = byId.get(c.id);
      if (!np || !mine.some((f) => repoCanWin(np, f))) continue;
      const when = earnWhen(c);
      out.push(`${c.title} pays ${earnPrize(c)}; ${when === 'open all year' ? "it's open all year" : `it ${when}`}.`);
      if (out.length >= FUNDS_MAX) break;
    }
    return out;
  } catch (err) {
    console.error('[profile] funds', err instanceof Error ? err.name : 'error');
    return [];
  }
}

/**
 * The page at earnkit.com/<x-handle> under the Bench flag, from stored rows only. Null without a
 * claimed profile. The one project's facts only while the Bench counts it confirmed (the repo's own
 * proof, benchConfirmedSql); people and money also never while the person is held for a review; a
 * repo is named and linked only while it reads public (page-data shownProjects). The ring only
 * beside a rank line (never a bare ring); the pill only from pillOf.
 */
export async function profileData(builderId: number, now: Date, o: { only?: number[] } = {}): Promise<ProfileData | null> {
  const db = sql();
  const [p] = await db<{ x_handle: string | null; x_name: string | null; x_avatar_url: string | null; main: string | null }[]>`
    SELECT x_handle, x_name, x_avatar_url, main_project_key AS main FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.x_handle) return null;
  const [live] = await db<{ score: number; parts: Record<string, { points?: number } | undefined> | null }[]>`
    SELECT score::float8 AS score, parts FROM builder_live WHERE builder_id = ${builderId}`;
  const [lines, pill] = await Promise.all([rankLines(builderId, o), pillOf(builderId)]);
  const base = {
    handle: p.x_handle,
    name: displayName(p.x_name, p.x_handle),
    avatar: avatarUrl(p.x_avatar_url),
    initials: initialsOf(p.x_handle),
    raising: pill,
    bench: lines.bench,
    chainLines: lines.chains,
    score: lines.bench !== null && live ? Math.round(live.score) : null,
    parts: PARTS.map(([label, k]) => ({ label, points: Math.round(live?.parts?.[k]?.points ?? 0), max: MAX_V2[k] })),
  };
  const empty = { ...base, grid: last52(now).map((week) => ({ week, on: false })), streak: 0, log: [], project: null };
  if (!p.main) return empty;
  const [b] = await db<{ chains: string[]; streak: number; ship_weeks: string[]; confirmed: boolean }[]>`
    SELECT b.chains, b.streak, b.ship_weeks, ${benchConfirmedSql(db)} AS confirmed FROM builder_projects b
    WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(${p.main})`;
  const shown = ((await shownProjects([builderId])).get(builderId) ?? []).find((r) => norm(r.key) === norm(p.main!));
  if (!b || !shown) return empty;
  const confirmed = b.confirmed;
  const name = shown.safeName;
  const updates = confirmed
    ? await db<{ week: string; text: string | null; facts: WeekFacts }[]>`
        SELECT week::text AS week, text, facts FROM project_updates
        WHERE builder_id = ${builderId} AND lower(project_key) = lower(${p.main}) AND NOT hidden ORDER BY week DESC LIMIT ${LOG_MAX}`
    : [];
  const weeks = confirmed ? gridWeeks(b.ship_weeks, updates) : new Set<string>();
  const measured = confirmed && !shown.held;
  const coin = confirmed ? await raisingCoin(builderId) : null;
  const repoKey = norm(p.main);
  const [programs, funds] = await Promise.all([projectPrograms(builderId, p.main), confirmed ? fundLines(builderId, p.main, now) : Promise.resolve([])]);
  return {
    ...base,
    grid: last52(now).map((week) => ({ week, on: weeks.has(week) })),
    streak: confirmed ? b.streak : 0,
    log: logCards(updates, name, pill?.symbol ?? null),
    project: {
      name,
      what: shown.safeWhat,
      live: liveSite(shown.link),
      repo: REPO_KEY.test(repoKey) && !shown.hiddenRepo ? `https://github.com/${p.main}` : null,
      chains: confirmed ? BENCH_CHAINS.filter((c) => b.chains.includes(c)) : [],
      people: measured && shown.people > 0 ? shown.people : null,
      money: measured && shown.money_usd > 1 ? money(shown.money_usd) : null,
      coin: coin && coin.status === 'launched' ? { symbol: coin.symbol, url: coin.url } : null,
      programs,
      funds,
      confirmed,
    },
  };
}

/** v2.13 spec "Card (OG image)": what the share card shows under the Bench flag. */
export type BenchCardFacts = { handle: string; name: string; avatar: string | null; bench: string | null; project: string | null; streak: number; raising: string | null };

/**
 * The card's facts from stored rows, lighter than profileData (no log, no programs): the Bench line
 * (none outside the top half), the one project's shown name (page-data shownProjects: never a
 * private repo's), its streak while the Bench counts it confirmed, the pill's coin. Null without a claim.
 */
export async function benchCardFacts(builderId: number): Promise<BenchCardFacts | null> {
  const db = sql();
  const [p] = await db<{ x_handle: string | null; x_name: string | null; x_avatar_url: string | null; main: string | null }[]>`
    SELECT x_handle, x_name, x_avatar_url, main_project_key AS main FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.x_handle) return null;
  const [lines, pill] = await Promise.all([rankLines(builderId), pillOf(builderId)]);
  let project: string | null = null;
  let streak = 0;
  if (p.main) {
    const [b] = await db<{ streak: number; confirmed: boolean }[]>`
      SELECT b.streak, ${benchConfirmedSql(db)} AS confirmed FROM builder_projects b WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(${p.main})`;
    const shown = ((await shownProjects([builderId])).get(builderId) ?? []).find((r) => norm(r.key) === norm(p.main!));
    if (b && shown) {
      // Fix round 1: a project the Bench doesn't count as confirmed (maybe someone else's repo) is never named on the card.
      project = b.confirmed ? shown.safeName : null;
      streak = b.confirmed ? b.streak : 0;
    }
  }
  return { handle: p.x_handle, name: displayName(p.x_name, p.x_handle), avatar: avatarUrl(p.x_avatar_url), bench: lines.bench, project, streak, raising: pill?.symbol ?? null };
}

/**
 * The share post's words under the Bench flag, matching the card: the Bench line, else the confirmed
 * project and its streak, else the person's page. Pure.
 */
export function benchShareText(f: Pick<BenchCardFacts, 'handle' | 'bench' | 'project' | 'streak'>): string {
  if (f.bench) return `${f.bench} at EarnKit.`;
  const streak = streakWords(f.streak);
  if (f.project) return streak ? `Shipping ${f.project}, ${streak}, on EarnKit.` : `Shipping ${f.project} on EarnKit.`;
  return `@${f.handle} on EarnKit.`;
}
