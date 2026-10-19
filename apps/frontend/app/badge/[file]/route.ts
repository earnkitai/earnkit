import { BADGE_CACHE, BADGE_MISS_CACHE, badgeFor } from '../../../lib/earnkit/badge';

/** Launch-ready L8: earnkit.com/badge/<handle>.svg, the README badge (lib/earnkit/badge.ts). */
export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const { status, svg } = await badgeFor(file);
  return new Response(svg, {
    status,
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': status === 200 ? BADGE_CACHE : BADGE_MISS_CACHE, 'X-Content-Type-Options': 'nosniff' },
  });
}
