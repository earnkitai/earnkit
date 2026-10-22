import { prizeOf } from './entry-text';
import { guideSourceList, programGuide, type Guide, type GuideSource } from './guide';
import { CHAIN_NAMES } from './match';
import { byRelevance, daysLeftText, NO_CELL, type Card } from './present';
import { eachLine, openCurated, openGrantsText, openMoneyWords } from './pool';
import { getProgramRow, isOpen, listPrograms, NotFoundError } from './programs';
import { openMoneyUsd, readStats, wonLine, type PublicStats } from './stats';
import { sql } from './db';
import { GUIDE_ID, guideProgramSql } from './guide-pages';
import { carouselCards, type FeedCard } from './feed';
import { ROLLING, compactUsd, heroChipText, isPrizeProgram, monthDay, programKind } from './site-copy';

/** v3 Stage 2: the tiles' order (present.ts, so bench-find shares it). */
export { byRelevance };

/**
 * The landing page's live data (v2.7 §1, v2.7.1): the open curated programs as cards, the hero's
 * "$X open right now" (v2.9 F21: the one money figure, openMoneyUsd), the hero chip, one short stats line and the
 * Activity cards (the feed's first three). `landingFrom` is pure; `readLanding` is the one DB read behind it
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
  /** v3.1 site: "grant", "grant, in USDC", "hackathon" or "investment" (site-copy programKind). */
  kind: string;
  /** v3.1 site: the per-winner max compacted ("$5K"), null without one. */
  big: string | null;
  /** v3.1 site: "Not open yet", "Closes Nov 18" or "Rolling, apply anytime" (site-copy ROLLING). */
  when: string;
  /** Clarity batch: who runs it ("Alliance"; the title without an organizer), the landing's tile text when there is no logo file. */
  organizer: string;
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
  /** v3.1 site: the hero chip, "$105K in grants open now" (site-copy heroChipText), null when nothing is open. */
  open_chip: string | null;
  tiles: Tile[];
  /** v2.7.1: "312 agents earning", or null below the threshold. */
  stats_line: string | null;
  /** v2.9 E20: "Builders using EarnKit won $12,500" under the stats line, or null (no announced win with a prize). */
  won_line: string | null;
  /** v3.1 site: the Activity section's cards, the feed's first LANDING_ACTIVITY (carouselCards); [] with an empty feed. */
  activity: FeedCard[];
};

/** The landing's Activity section shows this many cards. */
export const LANDING_ACTIVITY = 3;
/**
 * Pure. One card a builder (their first, the newest), in order: the Activity row never shows the same person twice, so
 * with one builder it is one card and the invite (Activity.tsx), never three weeks of the same name.
 */
export const oneEach = <C extends { handle: string }>(cards: C[]): C[] => cards.filter((c, i) => cards.findIndex((d) => d.handle === c.handle) === i);
/** The landing's Earning opportunities section shows this many open programs. */
export const LANDING_PROGRAMS = 4;
/** The open tiles the landing shows, in the tiles' own (byRelevance) order. Pure. */
export const landingPrograms = (tiles: Tile[]): Tile[] => tiles.filter((t) => t.status === 'active').slice(0, LANDING_PROGRAMS);

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
  const kept = cards.filter((c) => !c.sponsored && !c.earnkit_campaign && c.status !== 'unlisted').sort(byRelevance);
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
      kind: programKind(c),
      big: perWinner > 0 ? compactUsd(perWinner) : null,
      when: c.status === 'upcoming' ? 'Not open yet' : c.ends_at ? `Closes ${monthDay(new Date(c.ends_at))}` : ROLLING,
      organizer: c.organizer?.trim() || c.title,
    };
  });
  // The chip says "and prizes" when a program it sums is a prize or hackathon by kind (in person, or prize text); a pool alone never is (Circle's grants).
  const prizes = kept.some((c) => openCurated(c, now) && (c.max_award_usd ?? 0) > 0 && isPrizeProgram(c));
  return {
    open_text: kept.some((c) => openCurated(c, now)) ? openGrantsText(openMoneyUsd(kept, now)) : null,
    open_more: openMoneyWords(kept, now),
    open_chip: heroChipText(openMoneyUsd(kept, now), prizes),
    tiles,
    stats_line: statsLine(stats),
    won_line: wonLine(stats.builders_won_usd),
    activity: [],
  };
}

/**
 * The landing page's one read: open programs, the public stats and the Activity cards (the feed's first
 * LANDING_ACTIVITY). It rejects when the database is unreachable (never empty data): the caller renders without the
 * live parts (Ruling 21 (plan), Review Focus 1).
 */
export async function readLanding(now = new Date()): Promise<Landing> {
  const cards: Card[] = await listPrograms();
  const stats = await readStats(now);
  const activity = oneEach(await carouselCards(now)).slice(0, LANDING_ACTIVITY);
  return { ...landingFrom(cards, stats, now), activity };
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

export { GUIDE_ID };

/** Every curated program id, closed ones included (Ruling 22: old links keep working); never an unlisted one (v3.1 D2: its guide is a 404, not "closed"). */
export async function readGuideIds(): Promise<string[]> {
  const db = sql();
  const rows = await db<{ id: string }[]>`SELECT g.id FROM programs g WHERE ${guideProgramSql(db)} ORDER BY g.id`;
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
