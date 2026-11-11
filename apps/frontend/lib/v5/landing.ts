/**
 * The landing and /programs data: one tile per listed program (open or upcoming), Base first, for
 * /programs; the six featured tiles and the listed count for the landing; the hero's money chip.
 * Plain JSON, so it can be cached.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { closeDay } from './deadline';
import { NOT_OPEN_YET, ROLLING, heroChipText, programKind } from './site-copy';
import { moneyOf } from './programs-read';
import type { Program } from './program-file';
import { listListedPrograms, type ProgramRow } from './programs';
import { readStats, type Stats } from './stats';

export type Tile = {
  id: string;
  title: string;
  /** Who runs it; the title when the record has no organizer. */
  organizer: string;
  money: string;
  /** True when the money is one short figure ("$5K", or a range's "Up to $900K"), shown large. */
  big: boolean;
  /** "Closes Nov 18", "Rolling" or "Not open yet". */
  when: string;
  kind: string;
  status: 'active' | 'upcoming';
  /** A file under public/, or null (no logo, or the file is missing). */
  logo: string | null;
};
export type Landing = {
  chip: string | null;
  /** Every listed program, for /programs. */
  tiles: Tile[];
  /** The landing's six, by featuredTiles. */
  featured: Tile[];
  /** How many programs are listed (open plus upcoming), for the link to /programs. */
  total: number;
};

const LOCAL_LOGO = /^programs\/[a-z0-9-]+\.(svg|png)$/;
const PUBLIC_DIRS = [join(process.cwd(), 'public'), join(process.cwd(), 'apps/frontend/public')];
const found = new Map<string, boolean>();

/** The logo's path when the program names one and the file is in public/; never a path to a missing file. */
export function logoOf(p: Pick<Program, 'logo'>): string | null {
  const path = p.logo?.path;
  if (!path || !LOCAL_LOGO.test(path)) return null;
  let ok = found.get(path);
  if (ok === undefined) found.set(path, (ok = PUBLIC_DIRS.some((d) => existsSync(join(d, path)))));
  return ok ? `/${path}` : null;
}

/**
 * Open before upcoming; Base, then any chain, then the rest; grants before investments; the sooner
 * close (rolling last); the bigger per-winner award; the id. Pure.
 */
export function byRelevance(a: Program, b: Program): number {
  const later = (p: Program) => Number(p.status === 'upcoming');
  const reach = (p: Program) => (p.chains.includes('base') ? 0 : p.any_chain ? 1 : 2);
  const inv = (p: Program) => Number(p.investment);
  const at = (p: Program) => (p.ends_at ? Date.parse(p.ends_at) : 8.64e15);
  return later(a) - later(b) || reach(a) - reach(b) || inv(a) - inv(b) || at(a) - at(b) || (b.max_award_usd ?? -1) - (a.max_award_usd ?? -1) || a.id.localeCompare(b.id);
}

/** One full figure, with a range's "Up to " (v6.1.14; full figures, lane 22, v6.1.15); the tile draws "Up to" small
 *  above the figure. */
const BIG = /^(Up to )?\$[\d,]+$/;

function tileOf(p: Program): Tile {
  const money = moneyOf(p);
  const day = closeDay(p);
  return {
    id: p.id,
    title: p.title,
    organizer: p.organizer.trim() || p.title,
    money,
    big: BIG.test(money),
    when: p.status === 'upcoming' ? NOT_OPEN_YET : day ? `Closes ${day}` : ROLLING,
    kind: programKind(p),
    status: p.status === 'upcoming' ? 'upcoming' : 'active',
    logo: logoOf(p),
  };
}

/** One tile per program, in the list's order. Pure apart from the logo file check. */
export function landingTiles(rows: ProgramRow[], _now: Date): Tile[] {
  return rows.map((r) => r.file).sort(byRelevance).map(tileOf);
}

const FEATURED = 6;
const MAX_HACKATHONS = 3;
const MIN_USD = 10_000;
const SOON_MIN_USD = 25_000;
const SOON_MS = 14 * 86_400_000;
const ORG_STOPWORDS = new Set(['the', 'open', 'foundation']);

/** The organizer key for one-per-organizer: the first word not in `ORG_STOPWORDS`, lower-cased (else the first word). Pure. */
export const orgKey = (name: string): string => {
  const words = name.trim().toLowerCase().split(/\s+/);
  return words.find((w) => !ORG_STOPWORDS.has(w)) ?? words[0];
};

/**
 * The landing's six (v6.2.0): open programs only, no investments, money of at least $10K
 * (the larger of `pool_usd` and `max_award_usd`); those closing within 14 days with at least $25K
 * first (soonest first), then by money, then the id; one per organizer (`orgKey`: the organizer's first word
 * after `the`, `open` and `foundation`, lower-cased; the title when there is no organizer); at most three hackathons.
 * Merge risk: the key merges every organizer that shares a first word. Wanted: "Monad Foundation ..." pairs,
 * Solana Labs / Foundation / Mobile, the Arbitrum programs. Unwanted: two different orgs with one first word
 * (say "Ethereum Foundation" and another Ethereum org); the stopwords keep "The ..." and "Open ..." apart.
 * Pure apart from the logo file check.
 */
export function featuredTiles(rows: ProgramRow[], now: Date): Tile[] {
  const size = (p: Program) => Math.max(p.max_award_usd ?? 0, p.pool_usd ?? 0);
  const soonAt = (p: Program): number | null => {
    if (size(p) < SOON_MIN_USD || !closeDay(p)) return null;
    const left = Date.parse(p.ends_at!) - now.getTime();
    return left >= 0 && left <= SOON_MS ? left : null;
  };
  const ranked = rows
    .map((r) => r.file)
    .filter((p) => p.status === 'active' && !p.investment && size(p) >= MIN_USD)
    .map((p) => ({ p, soon: soonAt(p), size: size(p) }))
    .sort(
      (a, b) =>
        Number(a.soon === null) - Number(b.soon === null) ||
        (a.soon ?? 0) - (b.soon ?? 0) ||
        b.size - a.size ||
        a.p.id.localeCompare(b.p.id),
    );
  const seen = new Set<string>();
  const out: Tile[] = [];
  let hackathons = 0;
  for (const { p } of ranked) {
    const org = orgKey(p.organizer.trim() || p.title);
    const tile = tileOf(p);
    const hack = tile.kind === 'hackathon';
    if (seen.has(org) || (hack && hackathons >= MAX_HACKATHONS)) continue;
    seen.add(org);
    if (hack) hackathons++;
    out.push(tile);
    if (out.length === FEATURED) break;
  }
  return out;
}

export function landingFrom(rows: ProgramRow[], stats: Stats, now: Date): Landing {
  return { chip: heroChipText(stats.open_money_usd), tiles: landingTiles(rows, now), featured: featuredTiles(rows, now), total: rows.length };
}

/** The one read behind the landing and /programs. It rejects when the database is unreachable. */
export async function readLanding(now: Date = new Date()): Promise<Landing> {
  const [rows, stats] = await Promise.all([listListedPrograms(now), readStats(now)]);
  return landingFrom(rows, stats, now);
}
