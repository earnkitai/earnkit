import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { resolveSlug } from '../../../lib/earnkit/profiles';
import { isReserved, pagePath } from '../../../lib/earnkit/reserved-routes';
import { NOT_FOUND_METADATA } from '../../not-found';
import { HandleView, handleMetadata, pageOf } from '../../[handle]/handle-view';

/** Read live on every request: a hide, a claim or a rename shows at once. */
export const dynamic = 'force-dynamic';

/** A reserved handle's page carries the same title and card as any other (its card is /b/<handle>/card.png). */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (isReserved(slug)) return handleMetadata(slug);
  return (await resolveSlug(slug)) ? {} : NOT_FOUND_METADATA;
}

/**
 * v2.12.1 spec "Identity": "A handle equal to a site route is served at /b/<handle>." Any other name
 * here is a v2.12 slug (or a handle): a person who claimed their page with X moves to /<handle>
 * (308); an unclaimed or hidden one has no public page (404).
 */
export default async function ProfilePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  if (isReserved(slug)) return HandleView({ handle: slug, path: `/b/${slug}`, page: pageOf(await searchParams) });
  const r = await resolveSlug(slug);
  if (!r) notFound();
  permanentRedirect(pagePath(r.handle));
}
