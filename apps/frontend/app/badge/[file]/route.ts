import { badgeResponse } from '../../../lib/earnkit/badge';
import { cachedBadge } from './badge-load';

/** Launch-ready L8: earnkit.com/badge/<handle>.svg, the README badge (lib/earnkit/badge.ts, cached in badge-load.ts). */
export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  return badgeResponse(await cachedBadge((await params).file));
}
