import { prizeOf } from './entry-text';
import { guideSourceList, programGuide, type Guide, type GuideSource } from './guide';
import { CHAIN_NAMES } from './match';
import { byRelevance, daysLeftText, NO_CELL, type Card } from './present';
import { eachLine, openCurated, openGrantsText, openMoneyWords } from './pool';
import { getProgramRow, isOpen, listPrograms, NotFoundError } from './programs';
import { openMoneyUsd, readStats, wonLine, type PublicStats } from './stats';
import { sql } from './db';
import { benchCardFacts, benchRows, profileData, type BenchCardFacts, type BenchRow } from './bench-data';
import { raisingEnabled } from './builder-score-flag';
import { feedWeeks, type FeedCard } from './feed';
import { resolveHandle } from './profiles';
import { rankSplit, type BenchChain } from './rank';

/** v3 Stage 2: the tiles' order (present.ts, so bench-find shares it). */
export { byRelevance };

/**
 * The landing page's live data (v2.7 §1, v2.7.1): the open curated programs as cards, the hero's
 * "$X open right now" (v2.9 F21: the one money figure, openMoneyUsd), one short stats line and the
 * Bench's parts. `landingFrom` is pure; `readLanding` is the one DB read behind it
 * (app/lib/landing-cache.ts caches it for 10 minutes).
 */

/** Spec §1, Ruling 20 (plan): "agents earning" shows from 100 installs. */
export const INSTALLS_SHOWN_FROM = 100;

export type Tile = {
  id: string;
  title: string;
  /** "Base · Tempo · Robinhood Chain", or "Any chain" (v2.8 Ruling 13 (plan)). */
  chain: string;
  /**
   * v2.7.1: the big line. The pool when the source states one ("$840K in prizes", "10,000 USDC
   * pool"), else the per-winner amount ("up to $5,000 per winner"), else the curated prize text
   * ("milestone-based USDC grants").
   */
  prize: string;
  /** v2.7.1: "up to $30,000 per winner" / "$5K–$100K per grant" under the big line, when it differs from it. */
  prize_note: string | null;
  /** The per-winner USD amount (0 when unknown). */
  prize_usd: number;
  /** v2.7.1: the source-stated pool in USD (programs.ts poolFacts), or null. */
  pool_usd: number | null;
  /** v2.8 Ruling 21 (plan): the level word only ("Hard", never "(estimate)"; the guide keeps the full label), or NO_CELL without one (then no chip). */
  difficulty: string;
  /** v2.8: "8 days left", "ends today" or "rolling" (was `ends`); v3 Stage 2: "not open yet" for an upcoming program. */
  days_left: string;
  /** v3 Stage 2: an upcoming program is listed, never open (its guide has no Ask button). */
  status: 'active' | 'upcoming';
  /** v3 Stage 2: the card adds an "In person" chip. */
  in_person: boolean;
  /** "/programs/arc-microgrants.svg" (a local file, Ruling 23 (plan)), or null for the monogram. */
  logo: string | null;
};
/** Plain JSON only (Ruling 21 (plan), Review Focus 2): unstable_cache serializes it. */
export type Landing = {
  /**
   * v2.9 F21, v3 Stage 2: the money line, "$115K in grants and prizes open" (openGrantsText(openMoneyUsd) of the
   * tiles' programs, never an investment), or null when no program is open.
   */
  open_text: string | null;
  /** v3 Stage 2: what the total leaves out, "Plus 2 accelerators and 1 hackathon." (openMoneyWords), or null. */
  open_more: string | null;
  tiles: Tile[];
  /** v2.7.1: "312 agents earning", or null below the threshold. */
  stats_line: string | null;
  /** v2.9 E20: "Builders using EarnKit won $12,500" under the stats line, or null (no announced win with a prize). */
  won_line: string | null;
  /** v2.13 spec "Landing page": the Bench's top 10 and its chain chips, and the Feed section's rows (v3 Stage 3: the last finished week's, at most FEED_ROWS; null from landingFrom alone). */
  /** `raising`: EARNKIT_RAISING was on for this read (the Raising chip shows only then). */
  /** `count`: every ranked builder (R18 fix 1: the header count line), not only the 10 rows. */
  bench: { rows: BenchRow[]; count: number; chips: BenchChain[]; cards: FeedCard[]; raising: boolean } | null;
  /** v3 Stage 3 (spec 5.8): the hero's one real artifact, the featured builder's live profile preview; null from landingFrom alone or when nobody qualifies. */
  featured: FeaturedData | null;
};

/**
 * v3 Stage 3: what the landing's FeaturedCard shows (plain JSON): the share card's facts (the name, @handle, the
 * project, the streak), `rank` (the rank line's lead, "#3" or "Top 4%", rank.ts rankSplit; null unranked), the two
 * latest log lines, `points` (the Shipping number, as BenchRow.points) and `earned` (profileData.earned.paid_usd,
 * whole dollars; null at 0 or without the Stage 2 field, so the card omits the number: never "$0", review round 1).
 */
export type FeaturedData = { f: BenchCardFacts; rank: string | null; log: { week: string; summary: string | null }[]; points: number; earned: number | null };

/** The landing's Feed section shows at most this many rows of the last finished week. */
export const FEED_ROWS = 6;
/** The FeaturedCard shows the two latest log lines. */
export const FEATURED_LOG = 2;
/** The featured builder when LANDING_FEATURED_HANDLE is unset: the founder's own page. */
export const FEATURED_HANDLE_DEFAULT = 'jenilt';
/** LANDING_FEATURED_HANDLE (trimmed), else FEATURED_HANDLE_DEFAULT. Pure over the env. */
export const featuredHandle = (): string => process.env.LANDING_FEATURED_HANDLE?.trim() || FEATURED_HANDLE_DEFAULT;

/** v2.7.1: the one short line under the hero, only once there is something to show: installs from 100. Null otherwise. */
export function statsLine(s: PublicStats): string | null {
  return s.installs >= INSTALLS_SHOWN_FROM ? `${s.installs.toLocaleString('en-US')} agents earning` : null;
}

/**
 * The landing data from open program cards, Base first (`byRelevance`, v3 Stage 2), every one of them (v2.8 Ruling 20: no cap) (Ruling 21 (plan): curated programs only, never an
 * EarnKit or sponsor campaign) and the public stats. v2.9 F21: the hero
 * figure is moneyText(openMoneyUsd) of the same cards (/programs, the first reply and /api/stats show the same). Pure.
 */
export function landingFrom(cards: Card[], stats: PublicStats, now: Date): Landing {
  // v3 Stage 2: Base first (byRelevance), upcoming programs last.
  const kept = cards.filter((c) => !c.sponsored && !c.earnkit_campaign).sort(byRelevance);
  const tiles = kept.map((c): Tile => {
    const perWinner = c.max_award_usd ?? 0;
    // Review #1: "per grant" for a grant program, a stated range ("$5K–$100K per grant").
    const each = eachLine({ title: c.title, reward: c.reward ?? '', max_award_usd: perWinner || null, min_award_usd: c.min_award_usd ?? null, investment: c.investment === true });
    const prize = c.pool_line ?? each ?? prizeOf(c);
    return {
      id: c.id,
      title: c.title,
      // v2.8 Ruling 13 (plan): a program not tied to one chain.
      chain: c.any_chain ? 'Any chain' : (c.chains ?? []).map((ch) => CHAIN_NAMES[ch]).join(' · '),
      prize,
      prize_note: each && each !== prize ? each : null,
      prize_usd: perWinner,
      pool_usd: c.pool_usd ?? null,
      difficulty: c.difficulty ? c.difficulty.level : NO_CELL,
      days_left: c.status === 'upcoming' ? 'not open yet' : c.ends_at ? daysLeftText(c.ends_at, now) : 'rolling',
      logo: c.logo ? `/${c.logo}` : null,
      status: c.status === 'upcoming' ? 'upcoming' : 'active',
      in_person: c.in_person === true,
    };
  });
  return {
    open_text: kept.some((c) => openCurated(c, now)) ? openGrantsText(openMoneyUsd(kept, now)) : null,
    open_more: openMoneyWords(kept, now),
    tiles,
    stats_line: statsLine(stats),
    won_line: wonLine(stats.builders_won_usd),
    bench: null,
    featured: null,
  };
}

/** v2.13: the landing's leaderboard parts (`rows`, `count` and `chips` from benchRows); v3 Stage 3: the last finished week's feed rows. Plain JSON. */
async function readBench(now: Date): Promise<Landing['bench']> {
  const { rows, count, chips } = await benchRows({ chain: null, weekly: false }, { limit: 10 });
  const [week] = await feedWeeks(now);
  return { rows, count, chips, cards: (week?.cards ?? []).slice(0, FEED_ROWS), raising: raisingEnabled() };
}

/**
 * v3 Stage 3 (spec 5.8, Review Focus 3): the featured builder's preview, or null. The handle (featuredHandle) goes
 * through resolveHandle (a malformed or unknown handle, or a hidden profile, is null; a case redirect is followed once),
 * then benchCardFacts and profileData. No score line (unranked, or held: rankLines gives none outside the pool) is null:
 * the hero never shows a page that cannot show its rank. A missing handle falls back silently; a database failure
 * rejects like the rest of readLanding.
 */
async function readFeatured(now: Date): Promise<FeaturedData | null> {
  let r = await resolveHandle(featuredHandle(), now);
  if (r && 'redirect' in r) r = await resolveHandle(r.redirect.replace(/^\/(b\/)?/, ''), now);
  if (!r || 'redirect' in r) return null;
  // Task 7: Earned comes from profileData below; the card facts skip their own read of it.
  const f = await benchCardFacts(r.builderId, { money: false });
  if (!f?.bench) return null;
  const d = await profileData(r.builderId, now);
  if (!d || d.score === null) return null;
  return {
    f,
    rank: d.bench ? rankSplit(d.bench).lead : null,
    // The two latest weeks with a line (the summary, else the builder's note); a chips-only week shows nothing worth a row.
    log: d.log.filter((c) => !c.started && (c.summary || c.text)).slice(0, FEATURED_LOG).map((c) => ({ week: c.week, summary: c.summary ?? c.text ?? null })),
    points: d.score,
    earned: d.earned.paid_usd > 0 ? Math.round(d.earned.paid_usd) : null,
  };
}

/** Test seam: readLanding's featured read. */
export type LandingDeps = { featured?: (now: Date) => Promise<FeaturedData | null> };

/**
 * The landing page's one read: open programs, the public stats, the Bench parts and the featured builder. It rejects
 * when the database is unreachable (never empty data): the caller renders without the live parts (Ruling 21 (plan),
 * Review Focus 1). Review round 1: a failing featured read alone is logged and leaves `featured` null; the hero's
 * card never takes the landing or /programs down.
 */
export async function readLanding(now = new Date(), deps: LandingDeps = {}): Promise<Landing> {
  const cards: Card[] = await listPrograms();
  const stats = await readStats(now);
  const bench = await readBench(now);
  const featured = await (deps.featured ?? readFeatured)(now).catch((err: unknown) => {
    console.error('[landing] featured', err instanceof Error ? err.message : err);
    return null;
  });
  return { ...landingFrom(cards, stats, now), bench, featured };
}

/**
 * v2.7 §2: one curated program's guide page (/programs/<id>). Plain JSON only (Ruling 21 (plan)):
 * `Guide` holds strings, numbers and booleans, so unstable_cache can serialize it.
 */
export type GuidePage = {
  guide: Guide;
  title: string;
  /** "/programs/arc-microgrants.svg" (a local file, Ruling 23 (plan)), or null for the monogram. */
  logo: string | null;
  /** Ruling 22 (plan): a closed or past-deadline program still renders, without "Ask your agent". */
  open: boolean;
  /** v3 Stage 2: not open yet: the header reads "not open yet", the note shows under it, no "Ask your agent". */
  upcoming: boolean;
  /** v2.8 Ruling 13 (plan), Task 3 carry: the program fits any chain; the page says "Any chain". */
  any_chain: boolean;
  /** v3 Stage 3 Task 4: the chains as one fact ("Base", "Base, Tempo, Robinhood Chain"), null for any chain or none. */
  chain: string | null;
  /** The program's own page. */
  source_url: string;
  /** The program's own page, then every source the guide's facts rest on, labelled by role. */
  sources: GuideSource[];
  /** The ecosystem the page's description names: focus.ecosystem, else the first chain's name. */
  ecosystem: string;
};

/**
 * v2.7 §2, Ruling 22 (plan): the guide page of a curated program, or null when `id` is not one (no
 * such program, an EarnKit campaign, a sponsor campaign). A closed program still has a page. A
 * database failure rejects (never null), so a blip shows "unavailable", never a 404.
 */
export async function readGuidePage(id: string, now = new Date()): Promise<GuidePage | null> {
  let row;
  try {
    row = await getProgramRow(id);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
  if (row.source !== 'file' || row.campaign) return null;
  const guide = programGuide(row, now);
  return {
    guide,
    title: row.title,
    logo: row.logo ? `/${row.logo.path}` : null,
    open: isOpen(row) && (row.ends_at === null || row.ends_at > now),
    upcoming: row.status === 'upcoming' && (row.ends_at === null || row.ends_at > now),
    any_chain: row.any_chain === true,
    chain: row.any_chain ? null : (row.chains ?? []).map((ch) => CHAIN_NAMES[ch]).filter(Boolean).join(', ') || null,
    source_url: row.source_url,
    // Review #9: where the pool is stated, when that isn't the program page (Circle's portal).
    sources: guideSourceList(row, [
      { label: 'program page', url: row.source_url },
      ...(row.pool_usd != null && row.pool_source_url && row.pool_source_url !== row.source_url
        ? [{ label: 'prize pool', url: row.pool_source_url }]
        : []),
    ]),
    ecosystem: guide.wants?.ecosystem ?? CHAIN_NAMES[row.chains[0]] ?? row.title,
  };
}

/** A guide page id: a program file's id shape. Anything else is a 404 with no read. */
export const GUIDE_ID = /^[a-z0-9-]{1,64}$/;

/** Every curated program id, closed ones included (Ruling 22: old links keep working); never an unlisted one (v3.1 D2: its guide is a 404, not "closed"). */
export async function readGuideIds(): Promise<string[]> {
  const rows = await sql()<{ id: string }[]>`
    SELECT id FROM programs WHERE source = 'file' AND campaign IS NULL AND status <> 'unlisted' ORDER BY id`;
  return rows.map((r) => r.id);
}

/**
 * The guide page for `id`, gated (fix round 1, Important 1): a malformed id is null with no read;
 * an id outside the curated set is null with no per-id read, so random ids cost at most the one
 * cached id-set read. A failed read rejects (the caller shows "unavailable", never a 404).
 */
export async function gatedGuidePage(
  id: string,
  ids: () => Promise<string[]>,
  read: (id: string) => Promise<GuidePage | null>,
): Promise<GuidePage | null> {
  if (!GUIDE_ID.test(id)) return null;
  if (!(await ids()).includes(id)) return null;
  return read(id);
}

/** The guide page's description, naming only the parts it has. Pure. */
export function guideDescription(page: Pick<GuidePage, 'title' | 'guide' | 'ecosystem'>): string {
  const parts = [
    'Difficulty',
    ...(page.guide.won ? ['what won before'] : []),
    ...(page.guide.wants ? [`what ${page.ecosystem} wants now`] : []),
  ];
  const list = parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
  return `What can I earn on ${page.title}? ${list}.`;
}
