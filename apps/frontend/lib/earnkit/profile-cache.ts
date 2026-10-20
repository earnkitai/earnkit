import { revalidatePath, revalidateTag } from 'next/cache';

/** v2.12 T10 review: the tag on every cached public profile read (app/b/[slug]/page.tsx). */
export const PROFILE_TAG = 'builder-profiles';

/**
 * A profile changed in a way the public page must show at once (hidden, shown, a new X handle and
 * slug): every cached profile read, every rendered /b/<slug> page and the leaderboard (T12) are expired now, not after the
 * 10-minute ISR window. Rare (owner-driven), so the whole route is cheap to drop. Outside a Next
 * request (tests, scripts) there is no cache to drop: it does nothing and never throws.
 */
export function profileChanged(): void {
  try {
    revalidateTag(PROFILE_TAG, { expire: 0 });
    revalidatePath('/b/[slug]', 'page');
    revalidatePath('/leaderboard');
  } catch {
    // No Next request context.
  }
}

/**
 * Hotfix 2026-10-19: the leaderboard pool changed (a rescore moved a score, a rank or a hold; a ship-log week was
 * written): the landing's top 10 and carousel, the feed and the leaderboard are expired now, so the home page never
 * says "Nobody on the leaderboard yet" while a profile shows a rank. Their caches carry PROFILE_TAG. Outside a Next
 * request (tests, scripts) it does nothing and never throws.
 */
export function poolChanged(): void {
  try {
    revalidateTag(PROFILE_TAG, { expire: 0 });
    revalidatePath('/');
    revalidatePath('/feed');
    revalidatePath('/leaderboard');
  } catch {
    // No Next request context.
  }
}
