import { usd } from './campaigns';
import { prizeOf } from './entry-text';
import { difficultyLabel } from './guide';
import { CHAIN_NAMES } from './match';
import { bonusCell, byPrize, daysLeftText, openMoneyUsd, type Card } from './present';
import { listPrograms } from './programs';
import { roundPoolsWei } from './bonus-rounds';
import { readStats, type PublicStats } from './stats';

/**
 * The landing page's live data (v2.7 §1): the open curated programs as cards, the "open right now"
 * figure and the stats strip. `landingFrom` is pure; `readLanding` is the one DB read behind it
 * (app/lib/landing-cache.ts caches it for 10 minutes).
 */

/** Spec §1, Ruling 20 (plan): "Agents earning" shows from 100 installs. */
export const INSTALLS_SHOWN_FROM = 100;
/** Spec §1: the first 6 cards, then "See all". */
export const HOME_CARDS = 6;
/** v2.7 fix round 1: below the `sm` breakpoint the homepage shows 3 cards, then "See all programs". */
export const HOME_CARDS_MOBILE = 3;

export type Tile = {
  id: string;
  title: string;
  /** "Base · Tempo · Robinhood Chain". */
  chain: string;
  /**
   * Ruling C8: the per-winner amount that feeds the hero total ("up to $25,000 per winner"); the
   * curated prize text ("milestone-based USDC grants") when no per-winner amount is known.
   */
  prize: string;
  /** Ruling C8: the curated prize text ("$250K+ prize pool") as a small line, when it differs. */
  prize_note: string | null;
  /** The per-winner USD amount behind `prize` (0 when unknown): the tiles sum to `open_usd`. */
  prize_usd: number;
  /** "Medium (estimate)", or "—" without one. */
  difficulty: string;
  /** "8 days left", "ends today" or "rolling". */
  ends: string;
  /** bonusCell ("0.42 ETH so far", "new pool"), or null when the program has none. */
  bonus: string | null;
  /** "/programs/arc-microgrants.svg" (a local file, Ruling 23 (plan)), or null for the monogram. */
  logo: string | null;
};
export type StatItem = { label: string; value: string };
/** Plain JSON only (Ruling 21 (plan), Review Focus 2): unstable_cache serializes it. */
export type Landing = { open_usd: number; tiles: Tile[]; stats: StatItem[] };

/**
 * Two decimals, rounded down. `eth` has 6 decimals (weiToEth); rounding to whole micro-ETH first
 * keeps float error from flooring 0.29 to 0.28 (fix round 1, Important 3).
 */
const ethText = (eth: number) =>
  eth < 0.01 ? 'under 0.01' : (Math.floor(Math.round(eth * 1e6) / 1e4) / 100).toFixed(2);

/** v2.7 §1, Ruling 20 (plan): the stats strip. Pure. */
export function statItems(openUsd: number, s: PublicStats): StatItem[] {
  const items: StatItem[] = [{ label: 'Open money', value: usd(openUsd) }];
  if (s.installs >= INSTALLS_SHOWN_FROM) items.push({ label: 'Agents earning', value: s.installs.toLocaleString('en-US') });
  items.push({
    label: 'Builder bonus',
    value:
      s.bonus_paid_eth > 0
        ? `${ethText(s.bonus_paid_eth)} ETH paid`
        : s.bonus_pools_eth > 0
          ? `${ethText(s.bonus_pools_eth)} ETH so far`
          : `on ${s.bonus_programs_open} programs`,
  });
  return items;
}

/**
 * The landing data from open program cards (Ruling 21 (plan): curated programs only, never an
 * EarnKit or sponsor campaign), their open rounds' pools and the public stats. The figure is
 * `openMoneyUsd` of the same cards, so the page and the first message's "$X is open right now"
 * never disagree (Ruling 20). Pure.
 */
export function landingFrom(cards: Card[], pools: Map<string, bigint | null>, stats: PublicStats, now: Date): Landing {
  const kept = cards.filter((c) => !c.sponsored && !c.earnkit_campaign).sort(byPrize);
  const open_usd = openMoneyUsd(kept);
  const tiles = kept.map((c): Tile => {
    const pool = pools.get(c.id);
    const bonus = bonusCell({ builder_bonus: c.builder_bonus, bonus_pool_wei: pool ?? null, bonus_closed: pools.has(c.id) && pool === null });
    const curated = prizeOf(c);
    const perWinner = c.max_award_usd ?? 0;
    const prize = perWinner > 0 ? `up to ${usd(perWinner)} per winner` : curated;
    return {
      id: c.id,
      title: c.title,
      chain: (c.chains ?? []).map((ch) => CHAIN_NAMES[ch]).join(' · '),
      prize,
      // No note when the curated text only restates the amount ("up to $5,000").
      prize_note: perWinner > 0 && ![usd(perWinner), `up to ${usd(perWinner)}`].includes(curated) ? curated : null,
      prize_usd: perWinner,
      difficulty: c.difficulty ? difficultyLabel(c.difficulty) : '—',
      ends: c.ends_at ? daysLeftText(c.ends_at, now) : 'rolling',
      bonus: bonus === '—' ? null : bonus,
      logo: c.logo ? `/${c.logo}` : null,
    };
  });
  return { open_usd, tiles, stats: statItems(open_usd, stats) };
}

/**
 * The landing page's one read: open programs, their open rounds' pools, the public stats. It
 * rejects when the database is unreachable (never empty data): the caller renders without the
 * live parts (Ruling 21 (plan), Review Focus 1).
 */
export async function readLanding(now = new Date()): Promise<Landing> {
  const cards: Card[] = await listPrograms();
  const pools = await roundPoolsWei(
    cards.filter((c) => c.builder_bonus).map((c) => c.id),
    { now },
  );
  const stats = await readStats(now);
  return landingFrom(cards, pools, stats, now);
}
