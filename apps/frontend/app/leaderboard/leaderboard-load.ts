import { unstable_cache } from 'next/cache';
import { PROFILE_TAG } from '../../lib/earnkit/profile-cache';
import { boardRows } from '../../lib/earnkit/page-data';

/**
 * v2.12.1 spec "Leaderboard": the one cached read behind /leaderboard, at most one board query per
 * 10 minutes. Tagged with the profiles, so a hide, a claim or a rename expires it at once
 * (profile-cache.ts profileChanged).
 */
export const cachedBoard = unstable_cache(async () => boardRows(), ['builder-leaderboard-v2121'], { revalidate: 600, tags: [PROFILE_TAG] });
