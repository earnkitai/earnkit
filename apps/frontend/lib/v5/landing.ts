/**
 * The landing and /programs data: one tile per listed program (open or upcoming), Base first,
 * and the hero's money chip. Plain JSON, so it can be cached.
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
  /** True when the money is one short figure ("$5K"), shown large. */
  big: boolean;
  /** "Closes Nov 18", "Rolling, apply anytime" or "Not open yet". */
  when: string;
  kind: string;
  status: 'active' | 'upcoming';
  /** A file under public/, or null (no logo, or the file is missing). */
  logo: string | null;
};
export type Landing = { chip: string | null; tiles: Tile[] };

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

/** One tile per program, in the list's order. Pure apart from the logo file check. */
export function landingTiles(rows: ProgramRow[], _now: Date): Tile[] {
  return rows
    .map((r) => r.file)
    .sort(byRelevance)
    .map((p): Tile => {
      const money = moneyOf(p);
      const day = closeDay(p);
      return {
        id: p.id,
        title: p.title,
        organizer: p.organizer.trim() || p.title,
        money,
        big: /^\$[\d.]+[KM]?$/.test(money),
        when: p.status === 'upcoming' ? NOT_OPEN_YET : day ? `Closes ${day}` : ROLLING,
        kind: programKind(p),
        status: p.status === 'upcoming' ? 'upcoming' : 'active',
        logo: logoOf(p),
      };
    });
}

export function landingFrom(rows: ProgramRow[], stats: Stats, now: Date): Landing {
  return { chip: heroChipText(stats.open_money_usd), tiles: landingTiles(rows, now) };
}

/** The one read behind the landing and /programs. It rejects when the database is unreachable. */
export async function readLanding(now: Date = new Date()): Promise<Landing> {
  const [rows, stats] = await Promise.all([listListedPrograms(now), readStats(now)]);
  return landingFrom(rows, stats, now);
}
