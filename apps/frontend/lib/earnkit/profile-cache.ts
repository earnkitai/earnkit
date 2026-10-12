import { revalidatePath, revalidateTag } from 'next/cache';

/** v2.12 T10 review: the tag on every cached public profile read (app/b/[slug]/page.tsx). */
export const PROFILE_TAG = 'builder-profiles';

/**
 * A profile changed in a way the public page must show at once (hidden, shown, a new X handle and
 * slug): every cached profile read and every rendered /b/<slug> page is expired now, not after the
 * 10-minute ISR window. Rare (owner-driven), so the whole route is cheap to drop. Outside a Next
 * request (tests, scripts) there is no cache to drop: it does nothing and never throws.
 */
export function profileChanged(): void {
  try {
    revalidateTag(PROFILE_TAG, { expire: 0 });
    revalidatePath('/b/[slug]', 'page');
  } catch {
    // No Next request context.
  }
}
