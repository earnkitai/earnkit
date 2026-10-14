import { builderScoreEnabled } from '../../../../lib/earnkit/builder-score-flag';
import { resolveSlug } from '../../../../lib/earnkit/profiles';
import { isReserved, pagePath } from '../../../../lib/earnkit/reserved-routes';
import { cardResponse } from '../../../[handle]/card-response';

/**
 * v2.12.1 spec "Identity" (Review Focus 4): a reserved handle's card lives at /b/<handle>/card.png
 * (pagePath + /card.png), drawn by the same handler as /<handle>/card.png. A v2.12 slug of a person
 * who claimed their page with X moves to that page's card (308), as /b/<slug> moves to the page;
 * anything else is a 404. Flag off: 404.
 */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!builderScoreEnabled()) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const { slug } = await params;
  if (isReserved(slug)) return cardResponse(slug, `/b/${slug}`);
  const r = await resolveSlug(slug);
  if (!r) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(null, { status: 308, headers: { Location: `${pagePath(r.handle)}/card.png`, 'Cache-Control': 'no-store' } });
}
