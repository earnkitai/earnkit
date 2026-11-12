import { unstable_cache } from 'next/cache';
import { PROGRAMS_TAG } from '../../lib/v5/programs-read';

/**
 * S (v6.1.16): this build's id, inlined at build (next.config.ts `env`: RAILWAY_GIT_COMMIT_SHA, else the build time),
 * 'dev' outside a build.
 */
export const BUILD_ID = process.env.EK_BUILD_ID || 'dev';

/** A cache key carrying the build id, so a deploy never serves a page cached by the build before it. Pure. */
export function cacheKey(key: string[], build: string = BUILD_ID): string[] {
  return [...key, build];
}

/**
 * A read cached for 10 minutes and expired at once by an API write (PROGRAMS_TAG), keyed by build (cacheKey). A
 * failed read is never cached. Outside Next (a test) there is no cache and the read runs directly.
 */
export function cachedRead<A extends unknown[], T>(read: (...args: A) => Promise<T>, key: string[], revalidate = 600): (...args: A) => Promise<T> {
  const cached = unstable_cache(read, cacheKey(key), { revalidate, tags: [PROGRAMS_TAG] });
  return async (...args: A) => {
    try {
      return await cached(...args);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Invariant: incrementalCache missing')) return read(...args);
      throw err;
    }
  };
}
