import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import { resolveSlug as readSlug } from '../../../lib/earnkit/profiles';
import { isReserved, pagePath } from '../../../lib/earnkit/reserved-routes';
import { NOT_FOUND_METADATA } from '../../../lib/earnkit/site-copy';
import { HandleView, handleMetadata, pageOf, postOf } from '../../[handle]/handle-view';

/** One lookup per request: generateMetadata and the page share it. */
const resolveSlug = cache(readSlug);

/** Read live on every request: a hide, a claim or a rename shows at once. */
export const dynamic = 'force-dynamic';

/** A reserved handle's page carries the same title and card as any other (its card is /b/<handle>/card.png). */
export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const { slug } = await params;
  if (isReserved(slug)) return handleMetadata(slug, postOf(await searchParams));
  return (await resolveSlug(slug)) ? {} : NOT_FOUND_METADATA;
}

/**
 * v2.12.1 spec "Identity": "A handle equal to a site route is served at /b/<handle>." Any other name
 * here is a v2.12 slug (or a handle): a person who claimed their page with X moves to /<handle>
 * (308); an unclaimed or hidden one has no public page (404).
 */
export default async function ProfilePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  if (isReserved(slug)) {
    const q = await searchParams;
    return HandleView({ handle: slug, path: `/b/${slug}`, page: pageOf(q), post: postOf(q) });
  }
  const r = await resolveSlug(slug);
  if (!r) notFound();
  permanentRedirect(pagePath(r.handle));
}
