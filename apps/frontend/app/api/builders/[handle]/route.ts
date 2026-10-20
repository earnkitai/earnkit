import { unstable_cache } from 'next/cache';
import { builderJson, builderPreflight, builderResponse } from '@/lib/earnkit/builder-json';
import { raisingEnabled } from '@/lib/earnkit/builder-score-flag';
import { PROFILE_TAG } from '@/lib/earnkit/profile-cache';

/**
 * v3 Stage 2 (spec 5.3 Route 2): GET /api/builders/<handle>.json, one builder's public numbers for the tokens.fun
 * coin page (builder-json.ts). One read per handle a minute (a hide, claim or rename expires it; the key carries
 * EARNKIT_RAISING); 404 for an unknown or hidden page. Readable from https://tokens.fun (CORS).
 */
export const dynamic = 'force-dynamic';

const cached = (handle: string) =>
  unstable_cache(() => builderJson(handle, new Date()), ['builder-json', raisingEnabled() ? 'raising' : 'no-raising', handle.toLowerCase()], {
    revalidate: 60,
    tags: [PROFILE_TAG],
  })();

export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  return builderResponse((await params).handle, cached);
}

export function OPTIONS() {
  return builderPreflight();
}
