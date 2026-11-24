/**
 * v3.8 E9 (cutover A4): find's paged catalog read, behind `track_v2`. `find` with `catalog { limit, cursor }` lists
 * every listed program (open and upcoming, the same set as /programs and GET /api/programs) by id, `limit` at a time,
 * with no fit read and no reply cap: following `next_cursor` to null reads exactly `total` programs, the database's.
 */
import { z } from 'zod';
import { isOpenAt, listListedPrograms } from './programs';
import { programZone } from './deadline';
import { moneyOf } from './programs-read';
import { flagOn } from './flags';

export const CATALOG_DEFAULT = 50;
export const CATALOG_MAX = 100;
export const CatalogInput = z
  .object({
    limit: z.number().int().min(1).max(CATALOG_MAX).optional().describe('programs per page'),
    cursor: z.string().max(100).optional().describe("the last page's next_cursor"),
  })
  .strict();

/** find's advertised arguments with `catalog` when `track_v2` is on; off, `base` itself. Pure given `env`. */
export function withCatalog<T extends z.ZodObject>(base: T, env: Record<string, string | undefined> = process.env): z.ZodObject {
  return flagOn('track_v2', env)
    ? base.extend({ catalog: CatalogInput.optional().describe('Every listed program, a page at a time (no match); pass next_cursor as cursor until it is null') })
    : base;
}

export type CatalogItem = { program_id: string; title: string; money: string; open: boolean; category?: string; ends_at: string | null; zone: string };
export type CatalogPage = { show_to_builder: ''; agent_note: string; programs: CatalogItem[]; total: number; next_cursor: string | null; refused?: true };

/** One page of the listed catalog, by id after `cursor` (the last page's last id). */
export async function catalogPage(input: unknown, now: Date): Promise<CatalogPage> {
  const parsed = CatalogInput.safeParse(input ?? {});
  if (!parsed.success)
    return { show_to_builder: '', agent_note: `Nothing was read. catalog: ${parsed.error.issues[0].message}; fix it and call again.`, programs: [], total: 0, next_cursor: null, refused: true };
  const limit = parsed.data.limit ?? CATALOG_DEFAULT;
  const all = (await listListedPrograms(now)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const after = parsed.data.cursor;
  const rest = after === undefined ? all : all.filter((p) => p.id > after);
  const page = rest.slice(0, limit);
  return {
    show_to_builder: '',
    agent_note: `${page.length} of ${all.length} listed programs.${rest.length > limit ? ' Call find with catalog.cursor next_cursor for the next page.' : ''}`,
    programs: page.map((p) => ({
      program_id: p.id, title: p.file.title, money: moneyOf(p.file), open: isOpenAt(p.file, now),
      ...(p.file.category ? { category: p.file.category } : {}), ends_at: p.file.ends_at, zone: programZone(p.file),
    })),
    total: all.length,
    next_cursor: rest.length > limit ? page.at(-1)!.id : null,
  };
}
