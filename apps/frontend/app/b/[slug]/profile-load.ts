import { unstable_cache } from 'next/cache';
import { PROFILE_TAG } from '@/lib/earnkit/profile-cache';
import { profileData } from '@/lib/earnkit/profile-data';

/**
 * v2.12: the one cached profile read behind /b/<slug>, its card and its share link. At most one
 * read per slug per 10 minutes (plain JSON), always under the lowercase slug; tagged so hide, show
 * and an X handle change expire it at once (profile-cache.ts).
 */
export const cachedProfile = unstable_cache((slug: string) => profileData(slug), ['builder-profile-v212'], { revalidate: 600, tags: [PROFILE_TAG] });
