import { builderScoreEnabled } from '../../../../lib/earnkit/builder-score-flag';
import { resolveSlug } from '../../../../lib/earnkit/profiles';
import { isReserved, pagePath } from '../../../../lib/earnkit/reserved-routes';
import { shareResponse } from '../../../[handle]/card-response';

/**
 * v2.12.1 spec 5 (Review Focus 4): a reserved handle's share link lives at /b/<handle>/share
 * (pagePath + /share), handled as /<handle>/share (records card_shared, opens X). A v2.12 slug of a
 * person who claimed their page with X moves to that page's share link (308, nothing recorded here);
 * anything else is a 404. Flag off: 404.
 */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!builderScoreEnabled()) return new Response('Not found', { status: 404 });
  const { slug } = await params;
  if (isReserved(slug)) return shareResponse(slug, `/b/${slug}`);
  const r = await resolveSlug(slug);
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 308, headers: { Location: `${pagePath(r.handle)}/share`, 'Cache-Control': 'no-store' } });
}
