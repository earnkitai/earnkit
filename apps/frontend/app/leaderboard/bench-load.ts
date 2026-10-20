import { unstable_cache } from 'next/cache';
import { PROFILE_TAG } from '../../lib/earnkit/profile-cache';
import { raisingEnabled } from '../../lib/earnkit/builder-score-flag';
import { benchRows, filterHref, type BenchFilter } from '../../lib/earnkit/bench-data';

/**
 * One cached read per filter variant (at most 8), 60 seconds; a hide, claim or rename expires them
 * (PROFILE_TAG). Final fix: the key carries EARNKIT_RAISING, so a flip never serves the other's pills.
 */
export const cachedBench = (f: BenchFilter) =>
  unstable_cache(async () => benchRows(f), ['bench-v213', raisingEnabled() ? 'raising' : 'no-raising', filterHref(f)], { revalidate: 60, tags: [PROFILE_TAG] })();
