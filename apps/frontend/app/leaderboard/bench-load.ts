import { unstable_cache } from 'next/cache';
import { PROFILE_TAG } from '../../lib/earnkit/profile-cache';
import { benchRows, filterHref, type BenchFilter } from '../../lib/earnkit/bench-data';

/**
 * One cached read per filter variant (at most 16), 60 seconds; a hide, claim or rename expires them
 * (PROFILE_TAG).
 */
export const cachedBench = (f: BenchFilter) =>
  unstable_cache(async () => benchRows(f), ['bench-v4', filterHref(f)], { revalidate: 60, tags: [PROFILE_TAG] })();
