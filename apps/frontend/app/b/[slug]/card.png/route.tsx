import { CODE_PATTERN } from '../../../../lib/earnkit/post-drafts';
import { resolveSlug } from '../../../../lib/earnkit/profiles';
import { isReserved, pagePath } from '../../../../lib/earnkit/reserved-routes';
import { cardResponse } from '../../../[handle]/card-response';

/**
 * v2.12.1 spec "Identity" (Review Focus 4): a reserved handle's card lives at /b/<handle>/card.png
 * (pagePath + /card.png), drawn by the same handler as /<handle>/card.png. A v2.12 slug of a person
 * who claimed their page with X moves to that page's card (308), as /b/<slug> moves to the page;
 * anything else is a 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // v3.1 one-tap posts: ?m=<code>, one post's card (kept on the 308 when it is a well-formed code).
  const m = new URL(req.url).searchParams.get('m');
  const code = m && CODE_PATTERN.test(m) ? m : null;
  if (isReserved(slug)) return cardResponse(slug, `/b/${slug}`, code);
  const r = await resolveSlug(slug);
  if (!r) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(null, { status: 308, headers: { Location: `${pagePath(r.handle)}/card.png${code ? `?m=${code}` : ''}`, 'Cache-Control': 'no-store' } });
}
