import { badgeFileOk, badgeMiss, badgeResponse } from '../../../lib/earnkit/badge';
import { cachedBadge } from './badge-load';

/** Launch-ready L8: earnkit.com/badge/<handle>.svg, the README badge (lib/earnkit/badge.ts, cached in badge-load.ts). */
export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = (await params).file;
  // Final fix M6: a name that can't be a handle never reaches the cache or the database.
  return badgeResponse(badgeFileOk(file) ? await cachedBadge(file) : badgeMiss());
}
