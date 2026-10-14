import { notFound, permanentRedirect } from 'next/navigation';
import { builderScoreEnabled } from '../../../lib/earnkit/builder-score-flag';
import { resolveSlug } from '../../../lib/earnkit/profiles';
import { isReserved, pagePath } from '../../../lib/earnkit/reserved-routes';
import { HandleView } from '../../[handle]/handle-view';

/** Read live on every request: a hide, a claim or a rename shows at once. */
export const dynamic = 'force-dynamic';

/**
 * v2.12.1 spec "Identity": "A handle equal to a site route is served at /b/<handle>." Any other name
 * here is a v2.12 slug (or a handle): a person who claimed their page with X moves to /<handle>
 * (308); an unclaimed or hidden one has no public page (404). Flag off: 404.
 */
export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  if (!builderScoreEnabled()) notFound();
  const { slug } = await params;
  if (isReserved(slug)) return HandleView({ handle: slug, path: `/b/${slug}` });
  const r = await resolveSlug(slug);
  if (!r) notFound();
  permanentRedirect(pagePath(r.handle));
}
