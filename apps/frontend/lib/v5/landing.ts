/**
 * The landing and /programs data: one tile per listed program (open or upcoming), Base first, for
 * /programs; the six featured tiles and the listed count for the landing; the hero's money chip.
 * Plain JSON, so it can be cached.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDay, closesLead, programZone } from './deadline';
import { CLOSED, NOT_OPEN_YET, ROLLING, heroChipText, programKind } from './site-copy';
import { moneyOf } from './programs-read';
import { ProgramFile, type Program } from './program-file';
import { findProgramsDir } from './programs-dir';
import { closedAt, isOpenAt, listListedPrograms, statusAt, type ProgramRow } from './programs';
import { openMoneyUsd, readStats, type Stats } from './stats';

export type Tile = {
  id: string;
  title: string;
  /** Who runs it; the title when the record has no organizer. */
  organizer: string;
  money: string;
  /** True when the money is one short figure ("$5K", or a range's "Up to $900K"), shown large. */
  big: boolean;
  /** "Closes Nov 18", "Closes in under an hour" (closesWords, L23-22), "Rolling", "Not open yet" or "Closed" (L23-2). */
  when: string;
  /** The close (ISO) when it has a day, else null (rolling); with `zone`, what a render re-derives `when` from. */
  closes_at: string | null;
  zone: string;
  /** Fix round 1 (M1): an upcoming program's start (ISO) when it opens by date (it has a form), else null. */
  opens_at?: string | null;
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

/** A tile's close words at `now` (L23-2, L23-22, v6.1.16): Closed once past, the closes wording (`closesLead`), Rolling
 *  or Not open yet. Pure. */
function whenOf(t: Pick<Tile, 'status' | 'closes_at' | 'zone'> & Partial<Pick<Tile, 'opens_at'>>, now: Date): string {
  if (t.closes_at !== null && Date.parse(t.closes_at) <= now.getTime()) return CLOSED;
  if (statusOf(t, now) === 'upcoming') return NOT_OPEN_YET;
  return t.closes_at ? closesLead(t.closes_at, now, t.zone) : ROLLING;
}

/** A tile's status at `now` (fix round 1, M1): an upcoming tile whose start has passed reads active. Pure. */
const statusOf = (t: Pick<Tile, 'status'> & Partial<Pick<Tile, 'opens_at'>>, now: Date): Tile['status'] =>
  t.status === 'upcoming' && t.opens_at && Date.parse(t.opens_at) <= now.getTime() ? 'active' : t.status;

function tileOf(p: Program, now: Date): Tile {
  const money = moneyOf(p);
  const closes_at = closeDay(p, now) && p.ends_at ? new Date(p.ends_at).toISOString() : null;
  const zone = programZone(p);
  const status = statusAt(p, now) === 'upcoming' ? 'upcoming' : 'active';
  const opens_at = status === 'upcoming' && p.starts_at && p.submission_requirements.length > 0 ? new Date(p.starts_at).toISOString() : null;
  return {
    id: p.id,
    title: p.title,
    organizer: p.organizer.trim() || p.title,
    money,
    big: BIG.test(money),
    when: closedAt(p, now) ? CLOSED : whenOf({ status, closes_at, zone }, now),
    closes_at,
    zone,
    opens_at,
    kind: programKind(p),
    status,
    logo: logoOf(p),
  };
}

/** One tile per program, in the list's order. Pure apart from the logo file check. */
export function landingTiles(rows: ProgramRow[], now: Date): Tile[] {
  return rows.map((r) => r.file).sort(byRelevance).map((p) => tileOf(p, now));
}

/** The cached landing at `now` (L23-2, v6.1.16): every tile's close words re-derived from the clock at render, so a tile
 *  cached open reads Closed once its close passes. Pure. */
export function landingAt(l: Landing, now: Date): Landing {
  const at = (t: Tile): Tile => ({ ...t, status: statusOf(t, now), when: t.when === CLOSED ? CLOSED : whenOf(t, now) });
  return { ...l, tiles: l.tiles.map(at), featured: l.featured.map(at) };
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
    if (size(p) < SOON_MIN_USD || !closeDay(p, now)) return null;
    const left = Date.parse(p.ends_at!) - now.getTime();
    return left >= 0 && left <= SOON_MS ? left : null;
  };
  const ranked = rows
    .map((r) => r.file)
    .filter((p) => isOpenAt(p, now) && !p.investment && size(p) >= MIN_USD)
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
    const tile = tileOf(p, now);
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

/**
 * L1k-1 (v6.1.18): the landing from the catalog files alone, no database: every file under `dir` (default
 * `findProgramsDir()`) that parses as a `ProgramFile` and is listed (not closed, not past its ends_at), in the list's
 * order (the close, rolling last, then the id), the chip from the open ones' pools (`openMoneyUsd`). It is what
 * `getLanding` shows when the database read fails (at build there is no database), so the page stays prerendered.
 * Null with no catalog directory; a file that does not read or parse is left out.
 */
export function readLandingFromFiles(now: Date = new Date(), dir: string | null = findProgramsDir()): Landing | null {
  if (!dir) return null;
  const rows: ProgramRow[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const parsed = ProgramFile.safeParse(raw);
    if (!parsed.success || closedAt(parsed.data, now)) continue;
    rows.push({ id: parsed.data.id, file: parsed.data, source: 'file', created_at: now, updated_at: now, verified_at: null, stale_since: null });
  }
  const at = (p: Program) => (p.ends_at ? Date.parse(p.ends_at) : Infinity);
  rows.sort((a, b) => at(a.file) - at(b.file) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const open = rows.filter((r) => isOpenAt(r.file, now));
  return { chip: heroChipText(openMoneyUsd(open)), tiles: landingTiles(rows, now), featured: featuredTiles(rows, now), total: rows.length };
}
