import { unstable_cache } from 'next/cache';
import { PROGRAMS_TAG } from '../../lib/v5/programs-read';

/**
 * A read cached for 10 minutes and expired at once by an API write (PROGRAMS_TAG). A failed read is
 * never cached. Outside Next (a test) there is no cache and the read runs directly.
 */
export function cachedRead<A extends unknown[], T>(read: (...args: A) => Promise<T>, key: string[], revalidate = 600): (...args: A) => Promise<T> {
  const cached = unstable_cache(read, key, { revalidate, tags: [PROGRAMS_TAG] });
  return async (...args: A) => {
    try {
      return await cached(...args);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Invariant: incrementalCache missing')) return read(...args);
      throw err;
    }
  };
}
