import { revalidatePath, revalidateTag } from 'next/cache';

/**
 * v4.9 Task 3 fix 1 (F1): the tag on every cached read an API write changes: the landing cards (app/lib/landing-cache.ts
 * cached), the guide-id set (cachedIds), each guide page (cachedGuide) and GET /api/programs' list.
 */
export const PROGRAMS_TAG = 'programs';

/**
 * An API write created, updated or closed `id`: those caches, the home page, the program's guide page and the sitemap
 * are expired now, so a new tile never links to a guide that is still a 404 and a corrected or closed program never
 * shows its old text for 10 minutes. profile-cache.ts's pattern. Outside a Next request (tests, scripts) there is no
 * cache: it does nothing and never throws.
 */
export function programsChanged(id: string): void {
  try {
    revalidateTag(PROGRAMS_TAG, { expire: 0 });
    revalidatePath('/');
    revalidatePath(`/programs/${id}`);
    revalidatePath('/sitemap.xml');
  } catch {
    // No Next request context.
  }
}
