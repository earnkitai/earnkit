import { sql } from './db';
import { newProgramOf, openCuratedRows, repoCanWin } from './alerts';
import { benchPool, chainPools, rankLines } from './bench-rank';
import { raisingEnabled } from './builder-score-flag';
import { readFitRepos } from './installations';
import { REPO_KEY, benchConfirmedSql } from './main-project';
import { readOriginality } from './originality';
import { pointsTotal } from './points';
import { backersOfCoin } from './backers';
import { NO_EARNED, earnedUsd } from './earned';
import { tokenAllowed } from './site-data';
import { avatarUrl, displayName, norm, projectPrograms, safeNames, shownProjects, type ProgramLabel } from './page-data';
import { COIN_PROGRAM } from './policy-constants';
import { byPrize, type Card } from './present';
import { listPrograms } from './programs';
import { pillCoin, pillOf, raisingCoin } from './raising';
import { BENCH_CHAINS, rankLine, type BenchChain } from './rank';
import { scoreWhy, storedShipping } from './score-v2';
import { targetFor } from './weekly-target';
import { earnPrize, earnWhen, showable } from './stand-view';
import { fitWhy, whyFacts } from './bench-find';
import { titlesShown } from './ship-titles';
import { summaryShown } from './week-summary';
import { shownUrl } from './untrusted-text';
import { factChips, hasFacts, startedChips, startedLine, type WeekFacts } from './week-facts';
import { last52 } from './weeks';
import { gridWeeks } from './site-streak';
import { streakOfBuilder, streaksFor } from './streak';

/**
 * v2.13 spec "The Bench": its rows and its URL filters (R9). v3 Stage 2: `backed`, builders with backing open
 * (`?backed=1`, only while EARNKIT_RAISING is on).
 */
export type BenchFilter = { chain: BenchChain | null; weekly: boolean; backed?: boolean };
/** "Shipping every week": a streak (commit weeks in a row, streak.ts) of at least this many weeks. */
export const WEEKLY_STREAK = 4;
export const BENCH_MAX = 100;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/**
 * Anything but one known value per key is ignored, so at most 4 x 2 x 2 = 16 variants exist. Launch-ready L3: an old
 * link's ?raising=1 is ignored too (the unfiltered board). v3 Stage 2: `?backed=1` only with EARNKIT_RAISING on.
 */
export function parseBenchFilter(q: Record<string, string | string[] | undefined>, raising = raisingEnabled()): BenchFilter {
  const c = one(q.chain)?.toLowerCase();
  return { chain: (BENCH_CHAINS as readonly string[]).includes(c ?? '') ? (c as BenchChain) : null, weekly: one(q.weekly) === '1', backed: raising && one(q.backed) === '1' };
}

/** Pure. The one URL of a filter variant (also its cache key). */
export function filterHref(f: BenchFilter): string {
  const p = new URLSearchParams();
  if (f.chain) p.set('chain', f.chain);
  if (f.weekly) p.set('weekly', '1');
  if (f.backed) p.set('backed', '1');
  const s = p.toString();
  return s ? `/leaderboard?${s}` : '/leaderboard';
}

/** Pure. The project's one best fact in plain words: the streak, then weeks shipping (R16b: never people). */
export function bestFact(p: { streak: number; weeks_shipping: number; shipped: boolean }): string {
  if (p.streak >= 2) return `${p.streak} weeks in a row`;
  if (p.weeks_shipping > 0) return `${p.weeks_shipping} ${p.weeks_shipping === 1 ? 'week' : 'weeks'} shipping`;
  return p.shipped ? 'Live' : 'Building';
}

/** R17: `points`, the builder's Shipping score (0 to 100), shown in the leaderboard's points column. v3 Stage 2: `backing`, the Backing pill's coin. */
export type BenchRow = { rank: number; line: string | null; points: number; handle: string; name: string; avatar: string | null; backing: { symbol: string; url: string } | null; chains: BenchChain[]; project: string; best: string; /** v3.1 site: weeks of code in a row (streak.ts streaksFor, the profile's own value). */ streak: number };

/**
 * The Bench: the listed ranked people whose one project counts as confirmed now (bench-rank
 * benchPool: final fix M1, the gate is read here, not only at the last rescore), best score first,
 * filtered by chain and the weekly streak. A rank is always the whole Bench's. The coin read
 * mirrors raising.ts raisingCoin (the newest coin on the one project); the pill is pillOf's rule in
 * the same read (final fix M7: launched, raising, the one project confirmed, and EARNKIT_RAISING on).
 * The project's name is the shown one (final fix I1: never a private repo's).
 */
export async function benchRows(f: BenchFilter, o: { limit?: number; only?: number[]; now?: Date } = {}): Promise<{ rows: BenchRow[]; count: number; chips: BenchChain[] }> {
  const db = sql();
  const raisingOn = raisingEnabled();
  const rows = await db<{ builder_id: number; rank: number; points: number; handle: string; x_name: string | null; avatar: string | null; github_login: string | null; chains: string[]; key: string;
    weeks_shipping: number; shipped: boolean; raising: boolean; symbol: string | null; url: string | null }[]>`
    WITH ranked AS (
      SELECT x.builder_id, x.score, rank() OVER (ORDER BY x.score DESC)::int AS rank FROM ${benchPool(o.only)} x)
    SELECT r.builder_id, r.rank, r.score::int AS points, p.x_handle AS handle, p.x_name, p.x_avatar_url AS avatar, p.github_login, b.chains, b.project_key AS key, b.weeks_shipping, b.shipped,
      COALESCE(c.token_status = 'launched' AND c.raising_at IS NOT NULL, false) AS raising, c.token_symbol AS symbol, c.token_url AS url
    FROM ranked r JOIN builder_profiles p USING (builder_id)
    JOIN builder_projects b ON b.builder_id = r.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)}
    LEFT JOIN LATERAL (SELECT x.token_status, x.raising_at, x.token_symbol, x.token_url FROM projects x JOIN installations i ON i.id = x.installation_id
      WHERE COALESCE(i.builder_id, i.id) = r.builder_id AND x.token_url IS NOT NULL AND x.token_symbol IS NOT NULL
        AND (x.token_repo_key = 'github.com/' || lower(p.main_project_key)
          OR lower(x.repo_url) IN (lower('https://github.com/' || p.main_project_key), lower('https://github.com/' || p.main_project_key || '/')))
      ORDER BY x.coin_launched_at DESC NULLS LAST, x.id DESC LIMIT 1) c ON true
    WHERE (${f.chain}::text IS NULL OR ${f.chain}::text = ANY(b.chains))
      AND (NOT ${Boolean(f.backed && raisingOn)}::boolean OR (c.token_status = 'launched' AND c.raising_at IS NOT NULL))
    ORDER BY r.score DESC, lower(p.x_handle)`;
  const [{ total }] = await db<{ total: number }[]>`SELECT count(*)::int AS total FROM ${benchPool(o.only)} x`;
  const pools = await chainPools(o);
  const nameOf = await safeNames(rows.map((r) => r.builder_id));
  // v3.1 streak fix: the streak is read once (streak.ts), the profile's own value, never builder_projects.streak; the weekly
  // filter and the cap apply to it, so they come after the read.
  const streaks = await streaksFor(rows.map((r) => r.builder_id), o.now ?? new Date());
  const streakOf = (r: (typeof rows)[number]) => streaks.get(r.builder_id)?.streak ?? 0;
  // v3.1 site Task 8: never for EarnKit's own repo (site-data tokenAllowed, the Token card's rule), so neither the Backed
  // tag nor the Backed filter ever shows earnkitai/earnkit.
  const pill = (r: (typeof rows)[number]) => (raisingOn && r.raising && r.symbol && r.url && tokenAllowed(r.key) ? { symbol: r.symbol, url: r.url } : null);
  const listed = rows
    .filter((r) => !f.weekly || streakOf(r) >= WEEKLY_STREAK)
    .filter((r) => !(f.backed && raisingOn) || pill(r) !== null)
    .slice(0, Math.min(BENCH_MAX, o.limit ?? BENCH_MAX));
  return {
    count: total,
    // R16e: a chain's chip from one ranked project on it.
    chips: BENCH_CHAINS.filter((c) => pools[c] > 0),
    rows: listed.map((r) => ({
      rank: r.rank,
      line: rankLine({ ranked: true, rank: r.rank, total }),
      points: r.points,
      handle: r.handle,
      name: displayName(r.x_name, r.handle),
      avatar: avatarUrl(r.avatar, r.github_login),
      backing: pill(r),
      chains: BENCH_CHAINS.filter((c) => r.chains.includes(c)),
      project: nameOf(r.builder_id, r.key),
      best: bestFact({ ...r, streak: streakOf(r) }),
      streak: streakOf(r),
    })),
  };
}

// ---- v2.13 T11: the profile (spec "Profile", R10, R11, R12) ----------------------------------------

/** One card in the Ship log: the week's Monday, the update (or null), the fact chips; `started` marks the Started card. */
/** Weekly updates: `summary`, what the week shipped (week-summary.ts summaryShown); `text`, the builder's own note. */
export type ProfileCard = {
  week: string; text: string | null; summary?: string; chips: string[]; started?: string | null; /** facts.approved: the builder's yes; false reads "Not yet confirmed" (never set on a Started card). */ confirmed?: boolean;
  /** v3.1 site: the week's commits EarnKit checked (facts.shipped_code.n), set only from 1. */
  commits?: number;
};
export type ProjectTabData = {
  name: string; what: string | null; live: string | null; repo: string | null; chains: BenchChain[];
  coin: { symbol: string; url: string } | null; programs: ProgramLabel[]; funds: string[]; confirmed: boolean;
};
/** v3 Stage 3 (spec 5.6): one open program the project can win now (fundFits): its guide's path in `href`. */
export type MoneyFit = { title: string; prize: string; when: string; why: string; href: string };
/**
 * v3 Stage 3 (spec 5.6): the Money tab. `fits`: the open programs the project can win now; `applied`: the programs
 * it applied to or won (page-data projectPrograms, confirmed only); `backing`: as ProfileData.backing (null while
 * closed or EARNKIT_RAISING is off); `points`: as ProfileData.points.
 */
export type MoneyTabData = {
  fits: MoneyFit[];
  applied: { title: string; status: 'applied' | 'won' }[];
  backing: ProfileData['backing'];
  points: number;
};
/** Whole dollars, "$1,240". Pure. */
export const dollars = (usd: number) => `$${Math.round(usd).toLocaleString('en-US')}`;
export type ProfileData = {
  handle: string; name: string; avatar: string | null; initials: string;
  /**
   * v3 Stage 2: backing open on the one project (pillOf: EARNKIT_RAISING on): its backers (backers.ts, distinct wallets
   * that received the coin) and the creator fees claimed from it, whole USD (earned.ts fees_usd).
   */
  backing: { symbol: string; url: string; backers: number; earned_usd: number } | null;
  /**
   * v3 Stage 2 (spec 5.2): Earned, the third number (earned.ts earnedUsd): fees claimed plus announced prizes, and the
   * fees still waiting in the FeeLocker (shown as "and $X waiting", never summed in). Shown with EARNKIT_RAISING off too.
   */
  earned: { paid_usd: number; waiting_usd: number };
  bench: string | null;
  /** v3.1 F3: in the leaderboard's pool (bench-rank RankLines.listed), so a ranked page even while `bench` is null (under RANK_MIN_POOL). */
  rankListed: boolean;
  /** The header's score line (rank.ts scoreLine: "Shipping 72 · #3 of 40 builders"), null while unranked. */
  line: string | null;
  chainLines: { chain: BenchChain; label: string; line: string }[];
  /** Shipping, 0 to 100 (null: no rank line, so no score shown), and why it is what it is (score-v2.ts scoreWhy). */
  score: number | null; why: string | null;
  /** Launch ready L5: the weekly target under the why (weekly-target.ts: ranks only, never another builder's name), in the page's voice (L10: said to a visitor); null with no score. */
  target: string | null;
  /** Scoring and clarity R3: Originality, 0 to 100, shown small beside Shipping (never ranked); null until computed or while no score shows. */
  originality: number | null;
  /** v3 Stage 1: points awarded for approved weeks (points.ts); shown under Originality when above 0. */
  points: number;
  grid: { week: string; on: boolean }[]; streak: number; log: ProfileCard[]; project: ProjectTabData | null;
  /** v3 Stage 3 (spec 5.6): the Money tab's groups. */
  money: MoneyTabData;
};

/** The Ship log reads at most this many weeks. */
const LOG_MAX = 60;
/** At most this many "Ways to get funded" lines. */
const FUNDS_MAX = 3;

/** The project's live site: its link, never its GitHub page (that is the code link). Pure. */
export const liveSite = (link: string | null) => {
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
 * The Ship log, newest first: a week with a summary, a note or facts is a card (chips alone when there is
 * neither). The week with facts.started: v2.13.1 O3, when it has a card, the start is a chip on it
 * ("Started tracking" first, then the start's own chips), never a second card under the same week
 * heading; with no card that week, the Started card. Only the oldest week carrying facts.started shows the
 * start (a second stored start, from a race or a backfill, never repeats it). Hidden weeks never. Pure.
 */
export function logCards(rows: { week: string; text: string | null; summary?: string | null; facts: WeekFacts }[], name: string): ProfileCard[] {
  const out: ProfileCard[] = [];
  const startWeek = rows.reduce<string | null>((w, r) => (r.facts?.started && (!w || r.week < w) ? r.week : w), null);
  for (const r of rows) {
    const facts: WeekFacts = { ...(r.facts ?? {}) };
    if (r.week !== startWeek) delete facts.started;
    const summary = r.summary ?? null;
    if (r.text || summary || hasFacts(facts)) {
      const chips = factChips(facts);
      // O3 fix round 1: one live chip on a start week that went live ("Went live", not also "Live").
      const own = facts.started ? startedChips(facts.started).filter((c) => !(c === 'Live' && facts.went_live)) : [];
      const start = facts.started ? [STARTED_CHIP, ...own] : [];
      const n = Number(facts.shipped_code?.n ?? 0);
      const commits = Number.isFinite(n) ? Math.floor(n) : 0;
      out.push({
        week: r.week, text: r.text, confirmed: r.facts?.approved === true, ...(summary && { summary }), ...(commits > 0 && { commits }),
        chips: [...new Set([...start.slice(0, 1), ...chips, ...start.slice(1)])],
      });
    } else if (facts.started) out.push({ week: r.week, text: null, chips: startedChips(facts.started), started: startedLine(name) });
  }
  return out;
}

/** The grid's weeks (site-streak.ts gridWeeks: the one streak definition). */
export { gridWeeks };

/** A fit as the Project tab's "Ways to get funded" line: "X pays up to $10K; it's open all year.". Pure. */
export const fundLine = (f: MoneyFit) => `${f.title} pays ${f.prize}; ${f.when === 'open all year' ? "it's open all year" : `it ${f.when}`}.`;

/**
 * "Ways to get funded" and the Money tab's "Programs that fit": the open curated programs the project `key` can
 * win now, by find's rules without a GitHub read (stand-view.ts scoreEarn: alerts.ts repoCanWin over the fits find
 * last saw), biggest prize first, entered ones left out; why each fits in bench-find's words (fitWhy) and its guide's
 * path. Never throws (none on an error).
 */
async function fundFits(builderId: number, key: string, now: Date): Promise<MoneyFit[]> {
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
    const out: MoneyFit[] = [];
    for (const c of (programs as (Card & { agent_completable?: boolean; earnkit_campaign?: boolean })[]).filter((x) => showable(x, now, skip) && !x.in_person).sort(byPrize)) {
      // v3 Stage 2 final review: an in-person program is never a way to get funded (it stays on /programs).
      const np = byId.get(c.id);
      const repo = np ? mine.find((f) => repoCanWin(np, f)) : undefined;
      if (!repo) continue;
      out.push({ title: c.title, prize: earnPrize(c), when: earnWhen(c), why: fitWhy(c, whyFacts(repo)), href: `/programs/${c.id}` });
      if (out.length >= FUNDS_MAX) break;
    }
    return out;
  } catch (err) {
    console.error('[profile] funds', err instanceof Error ? err.name : 'error');
    return [];
  }
}

/**
 * The page at earnkit.com/<x-handle>, from stored rows only. Null without a
 * claimed profile. The one project's facts only while the Bench counts it confirmed (the repo's own
 * proof, benchConfirmedSql); people and money are never shown (not scored); a
 * repo is named and linked only while it reads public (page-data shownProjects). The ring only
 * beside a rank line (never a bare ring); the pill only from pillOf.
 */
export async function profileData(builderId: number, now: Date, o: { only?: number[] } = {}): Promise<ProfileData | null> {
  const db = sql();
  const [p] = await db<{ x_handle: string | null; x_name: string | null; x_avatar_url: string | null; github_login: string | null; main: string | null; titles_on: boolean }[]>`
    SELECT x_handle, x_name, x_avatar_url, github_login, main_project_key AS main, (ship_titles_at IS NOT NULL) AS titles_on FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.x_handle) return null;
  const [lines, pill, earned] = await Promise.all([
    rankLines(builderId, o),
    pillCoin(builderId),
    earnedUsd(builderId, now).catch((err: unknown) => {
      console.error('[profile] earned', err instanceof Error ? err.name : 'error');
      return NO_EARNED;
    }),
  ]);
  const backers = pill ? await backersOfCoin(pill.coin) : 0;
  const [live] = await db<{ score: number; parts: unknown }[]>`
    SELECT score::float8 AS score, parts FROM builder_live WHERE builder_id = ${builderId}`;
  // v3.1 F3: the score shows on a ranked page, with or without the rank phrase.
  const scored = lines.listed && live;
  const base = {
    handle: p.x_handle,
    name: displayName(p.x_name, p.x_handle),
    avatar: avatarUrl(p.x_avatar_url, p.github_login),
    initials: initialsOf(p.x_handle),
    backing: pill ? { symbol: pill.symbol, url: pill.url, backers, earned_usd: Math.round(earned.fees_usd) } : null,
    earned: { paid_usd: earned.paid_usd, waiting_usd: earned.waiting_usd },
    bench: lines.bench,
    rankListed: lines.listed,
    line: lines.line,
    chainLines: lines.chains,
    // Only a Shipping row shows a number (an older row is unranked, so `scored` is false for it anyway).
    score: scored ? (storedShipping(live.parts)?.points ?? null) : null,
    why: scored ? scoreWhy(live.parts, now) : null,
    target: scored ? await targetFor(builderId, live.parts, now, { only: o.only, voice: 'page' }) : null,
    originality: scored ? await readOriginality(builderId, p.main) : null,
    points: await pointsTotal(builderId),
  };
  const money = (fits: MoneyFit[], programs: ProgramLabel[]): MoneyTabData => ({
    fits,
    applied: programs.map((g) => ({ title: g.title, status: g.won ? 'won' : 'applied' })),
    backing: base.backing,
    points: base.points,
  });
  const empty = { ...base, grid: last52(now).map((week) => ({ week, on: false })), streak: 0, log: [], project: null, money: money([], []) };
  if (!p.main) return empty;
  const [b] = await db<{ chains: string[]; confirmed: boolean }[]>`
    SELECT b.chains, ${benchConfirmedSql(db)} AS confirmed FROM builder_projects b
    WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(${p.main})`;
  const shown = ((await shownProjects([builderId])).get(builderId) ?? []).find((r) => norm(r.key) === norm(p.main!));
  if (!b || !shown) return empty;
  const confirmed = b.confirmed;
  const name = shown.safeName;
  const stored = confirmed
    ? await db<{ week: string; text: string | null; titles: string[]; summary: string | null; facts: WeekFacts }[]>`
        SELECT week::text AS week, text, titles, summary, facts FROM project_updates
        WHERE builder_id = ${builderId} AND lower(project_key) = lower(${p.main}) AND NOT hidden ORDER BY week DESC LIMIT ${LOG_MAX}`
    : [];
  // Preflight S9: a repo that isn't read public shows its titles only while titles are on (and never its name);
  // its summary also once the builder approved the week (owner batch 2026-10-23).
  const rule = { hiddenRepo: shown.hiddenRepo, titlesOn: p.titles_on, repoKey: p.main! };
  const updates = stored.map(({ titles, ...u }) => {
    const r = { ...rule, approved: u.facts?.approved === true };
    return { ...u, summary: summaryShown(u.summary, titlesShown(titles, r), r) };
  });
  // The streak's inputs and rule are streak.ts's (the leaderboard, card, replies and JSON read the same), not recomputed here.
  const lit = confirmed ? (await streaksFor([builderId], now)).get(builderId) : undefined;
  const weeks = lit?.weeks ?? new Set<string>();
  const coin = confirmed ? await raisingCoin(builderId) : null;
  const repoKey = norm(p.main);
  const [programs, fits] = await Promise.all([projectPrograms(builderId, p.main), confirmed ? fundFits(builderId, p.main, now) : Promise.resolve([])]);
  const funds = fits.map(fundLine);
  return {
    ...base,
    // Fix round 1 (the Project tab's rule): until the project is confirmed, no programs on the Money tab either.
    money: money(fits, confirmed ? programs : []),
    grid: last52(now).map((week) => ({ week, on: weeks.has(week) })),
    streak: lit?.streak ?? 0,
    log: logCards(updates, name),
    project: {
      name,
      what: shown.safeWhat,
      live: liveSite(shown.link),
      repo: REPO_KEY.test(repoKey) && !shown.hiddenRepo ? `https://github.com/${p.main}` : null,
      chains: confirmed ? BENCH_CHAINS.filter((c) => b.chains.includes(c)) : [],
      // v3 Stage 2: the "$SYM on tokens.fun" line is coin-facing, so only with EARNKIT_RAISING on.
      coin: raisingEnabled() && coin && coin.status === 'launched' ? { symbol: coin.symbol, url: coin.url } : null,
      programs,
      funds,
      confirmed,
    },
  };
}

/** v2.13 spec "Card (OG image)": what the share card shows. */
/**
 * v3 Stage 3 Task 6: `score`, the Shipping number while ranked (the score line's; null without a rank, as the line);
 * `earned`, Earned in whole dollars from $1 while ranked (earned.ts paid_usd), else null, so the card never shows "$0".
 */
export type BenchCardFacts = {
  handle: string; name: string; avatar: string | null; bench: string | null; project: string | null; streak: number; raising: string | null;
  score: number | null; earned: number | null;
};

/**
 * The card's facts from stored rows, lighter than profileData (no log, no programs): the Bench line
 * (none outside the top half), the one project's shown name (page-data shownProjects: never a
 * private repo's), its streak while the Bench counts it confirmed, the pill's coin. Null without a claim.
 * Task 7: `money: false` skips the Earned read (earnedUsd) where the caller never draws it (/share reads only the
 * share text; the landing reads Earned from profileData); `earned` is then null.
 */
export async function benchCardFacts(builderId: number, o: { money?: boolean; now?: Date } = {}): Promise<BenchCardFacts | null> {
  const db = sql();
  const [p] = await db<{ x_handle: string | null; x_name: string | null; x_avatar_url: string | null; github_login: string | null; main: string | null }[]>`
    SELECT x_handle, x_name, x_avatar_url, github_login, main_project_key AS main FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.x_handle) return null;
  const [lines, pill] = await Promise.all([rankLines(builderId), pillOf(builderId)]);
  let project: string | null = null;
  let streak = 0;
  if (p.main) {
    const [b] = await db<{ confirmed: boolean }[]>`
      SELECT ${benchConfirmedSql(db)} AS confirmed FROM builder_projects b WHERE b.builder_id = ${builderId} AND lower(b.project_key) = lower(${p.main})`;
    const shown = ((await shownProjects([builderId])).get(builderId) ?? []).find((r) => norm(r.key) === norm(p.main!));
    if (b && shown) {
      // Fix round 1: a project the Bench doesn't count as confirmed (maybe someone else's repo) is never named on the card.
      project = b.confirmed ? shown.safeName : null;
      streak = b.confirmed ? await streakOfBuilder(builderId, o.now ?? new Date()) : 0;
    }
  }
  // R16c: the card's line is the score line. Task 6: its number and Earned, only while ranked (no bare score without a rank).
  const [score, earned] = lines.line
    ? await Promise.all([
        db<{ score: number }[]>`SELECT score::int AS score FROM builder_live WHERE builder_id = ${builderId}`.then((r) => r[0]?.score ?? null),
        o.money === false
          ? NO_EARNED
          : earnedUsd(builderId).catch((err: unknown) => {
              console.error('[card] earned', err instanceof Error ? err.name : 'error');
              return NO_EARNED;
            }),
      ])
    : [null, NO_EARNED];
  return {
    // Final review 10: the page's picture (X, else the proven GitHub login's).
    handle: p.x_handle, name: displayName(p.x_name, p.x_handle), avatar: avatarUrl(p.x_avatar_url, p.github_login), bench: lines.line, project, streak, raising: pill?.symbol ?? null,
    score, earned: earned.paid_usd > 0 ? Math.round(earned.paid_usd) : null,
  };
}

/**
 * The share post's words, matching the card: the Bench line, else the confirmed
 * project and its streak, else the person's page. Pure.
 */
export function benchShareText(f: Pick<BenchCardFacts, 'handle' | 'bench' | 'project' | 'streak'>): string {
  if (f.bench) return `${f.bench} at EarnKit.`;
  const streak = streakWords(f.streak);
  if (f.project) return streak ? `Shipping ${f.project}, ${streak}, on EarnKit.` : `Shipping ${f.project} on EarnKit.`;
  return `@${f.handle} on EarnKit.`;
}
