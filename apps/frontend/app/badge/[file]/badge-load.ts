import { unstable_cache } from 'next/cache';
import { badgeFor } from '../../../lib/earnkit/badge';
import { PROFILE_TAG } from '../../../lib/earnkit/profile-cache';

/**
 * Launch-ready fix round 1: one cached read per badge file (lowercase: every case is the same badge), an hour; a
 * rescore, hide, claim or rename expires it (PROFILE_TAG), so a README badge never reads the database per view.
 */
export const cachedBadge = (file: string) =>
  unstable_cache(async () => badgeFor(file), ['badge-l8', file.toLowerCase()], { revalidate: 3600, tags: [PROFILE_TAG] })();
