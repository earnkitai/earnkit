import { prizeOf } from './entry-text';
import { guideSourceList, programGuide, type Guide, type GuideSource } from './guide';
import { CHAIN_NAMES } from './match';
import { daysLeftText, NO_CELL, type Card } from './present';
import { eachLine } from './pool';
import { getProgramRow, isOpen, listPrograms, NotFoundError } from './programs';
import { moneyText, openMoneyUsd, readStats, wonLine, type PublicStats } from './stats';
import { sql } from './db';
import { benchRows, type BenchRow } from './bench-data';
import { raisingEnabled } from './builder-score-flag';
import { carouselCards, type FeedCard } from './feed';
import type { BenchChain } from './rank';

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
  /** v2.8: "8 days left", "ends today" or "rolling" (was `ends`). */
  days_left: string;
  /** "/programs/arc-microgrants.svg" (a local file, Ruling 23 (plan)), or null for the monogram. */
  logo: string | null;
};
/** Plain JSON only (Ruling 21 (plan), Review Focus 2): unstable_cache serializes it. */
export type Landing = {
  /** v2.9 F21: the one money figure ("$1.1M+", moneyText(openMoneyUsd) of the tiles' programs), or null at 0. */
  open_text: string | null;
  tiles: Tile[];
  /** v2.7.1: "312 agents earning", or null below the threshold. */
  stats_line: string | null;
  /** v2.9 E20: "Builders using EarnKit won $12,500" under the stats line, or null (no announced win with a prize). */
  won_line: string | null;
  /** v2.13 spec "Landing page": the Bench's top 10 and its chain chips, and this week's square cards (null from landingFrom alone). */
  /** `raising`: EARNKIT_RAISING was on for this read (the Raising chip shows only then). */
  /** `count`: every ranked builder (R18 fix 1: the header count line), not only the 10 rows. */
  bench: { rows: BenchRow[]; count: number; chips: BenchChain[]; cards: FeedCard[]; raising: boolean } | null;
};

/** v2.7.1: the one short line under the hero, only once there is something to show: installs from 100. Null otherwise. */
export function statsLine(s: PublicStats): string | null {
  return s.installs >= INSTALLS_SHOWN_FROM ? `${s.installs.toLocaleString('en-US')} agents earning` : null;
}

/**
 * v2.7.1: the cards' order (landing and /programs): programs with a source-stated pool first,
 * highest pool first; then the rest by their per-winner amount; then the sooner deadline. The first message keeps
 * `byPrize`. Pure.
 */
export const byPool = (a: Pick<Card, 'pool_usd' | 'max_award_usd' | 'ends_at'>, b: Pick<Card, 'pool_usd' | 'max_award_usd' | 'ends_at'>) =>
  // Review #10: programs with a pool first (never a pool against a per-winner amount).
  Number(b.pool_usd != null) - Number(a.pool_usd != null) ||
  (b.pool_usd ?? b.max_award_usd ?? -1) - (a.pool_usd ?? a.max_award_usd ?? -1) ||
  (a.ends_at?.getTime() ?? 8.64e15) - (b.ends_at?.getTime() ?? 8.64e15);

/**
 * The landing data from open program cards, by pool (`byPool`), every one of them (v2.8 Ruling 20: no cap) (Ruling 21 (plan): curated programs only, never an
 * EarnKit or sponsor campaign) and the public stats. v2.9 F21: the hero
 * figure is moneyText(openMoneyUsd) of the same cards (/programs, the first reply and /api/stats show the same). Pure.
 */
export function landingFrom(cards: Card[], stats: PublicStats, now: Date): Landing {
  const kept = cards.filter((c) => !c.sponsored && !c.earnkit_campaign).sort(byPool);
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
      days_left: c.ends_at ? daysLeftText(c.ends_at, now) : 'rolling',
      logo: c.logo ? `/${c.logo}` : null,
    };
  });
  return {
    open_text: moneyText(openMoneyUsd(kept, now)),
    tiles,
    stats_line: statsLine(stats),
    won_line: wonLine(stats.builders_won_usd),
    bench: null,
  };
}

/** v2.13: the landing's leaderboard parts (`rows`, `count` and `chips` from benchRows). Plain JSON. */
async function readBench(now: Date): Promise<Landing['bench']> {
  const { rows, count, chips } = await benchRows({ chain: null, raising: false, weekly: false }, { limit: 10 });
  return { rows, count, chips, cards: await carouselCards(now), raising: raisingEnabled() };
}

/**
 * The landing page's one read: open programs, the public stats and the Bench parts. It rejects when
 * the database is unreachable (never empty data): the caller renders without the live parts
 * (Ruling 21 (plan), Review Focus 1).
 */
export async function readLanding(now = new Date()): Promise<Landing> {
  const cards: Card[] = await listPrograms();
  const stats = await readStats(now);
  return { ...landingFrom(cards, stats, now), bench: await readBench(now) };
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
  /** v2.8 Ruling 13 (plan), Task 3 carry: the program fits any chain; the page says "Any chain". */
  any_chain: boolean;
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
    any_chain: row.any_chain === true,
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

/** Every curated program id, closed ones included (Ruling 22: old links keep working). */
export async function readGuideIds(): Promise<string[]> {
  const rows = await sql()<{ id: string }[]>`
    SELECT id FROM programs WHERE source = 'file' AND campaign IS NULL ORDER BY id`;
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
