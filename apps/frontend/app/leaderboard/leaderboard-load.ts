import { unstable_cache } from 'next/cache';
import { PROFILE_TAG } from '../../lib/earnkit/profile-cache';
import { leaderboardData, programIds, programTitle, type BoardFilters } from '../../lib/earnkit/profile-data';
import { listPrograms } from '../../lib/earnkit/programs';

/**
 * v2.12 T12: the one cached read behind /leaderboard, per filter set (already validated by
 * leaderboardFilters). At most one board query per filter set per 10 minutes, plus the program names
 * for the filter. Tagged with the profiles, so hide, show and an X handle change expire it at once
 * (profile-cache.ts). `known` is false for a program id that names no program (the page is a 404);
 * a closed program still shows, as a bonus round's board moves here (owner ruling D1).
 */
/**
 * v2.12 final review (T12): every program id, in one cached entry (10 minutes). The page checks a
 * `program=` value against it before the board's cached read, so an unknown id is a 404 that never
 * makes a cache entry of its own.
 */
export const cachedProgramIds = unstable_cache(async () => programIds(), ['builder-leaderboard-program-ids-v212'], { revalidate: 600 });

export const cachedBoard = unstable_cache(
  async (f: BoardFilters) => {
    const listed = (await listPrograms()).map((p) => ({ id: p.id, title: p.title }));
    let programs = listed;
    if (f.program && !listed.some((p) => p.id === f.program)) {
      const title = await programTitle(f.program);
      if (title === null) return { known: false as const };
      programs = [...listed, { id: f.program, title }];
    }
    return { known: true as const, data: await leaderboardData(f), programs };
  },
  ['builder-leaderboard-v212'],
  { revalidate: 600, tags: [PROFILE_TAG] },
);
