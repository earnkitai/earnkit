import { CODE_PATTERN } from '../../../../../lib/earnkit/post-drafts';
import { resolveSlug } from '../../../../../lib/earnkit/profiles';
import { isReserved, pagePath } from '../../../../../lib/earnkit/reserved-routes';
import { postResponse } from '../../../../[handle]/post-response';

/**
 * v3.1 one-tap posts: a reserved handle's post link lives at /b/<handle>/post/<code> (pagePath + /post/<code>), handled
 * as /<handle>/post/<code>. A v2.12 slug of a person who claimed their page with X moves to that page's post link (308,
 * nothing counted here); anything else, or a malformed code, is a 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = await params;
  const notFound = new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!CODE_PATTERN.test(code)) return notFound;
  if (isReserved(slug)) return postResponse(slug, `/b/${slug}`, code, { request: req });
  const r = await resolveSlug(slug);
  if (!r) return notFound;
  return new Response(null, { status: 308, headers: { Location: `${pagePath(r.handle)}/post/${code}`, 'Cache-Control': 'no-store' } });
}
