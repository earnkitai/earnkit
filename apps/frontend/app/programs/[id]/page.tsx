import type { Metadata } from 'next';
import { getGuidePage } from '../../lib/landing-cache';
import { firstLine, pageMeta } from '../../lib/meta';
import { guideMeta } from '../../../lib/v5/guide';
import { NOT_FOUND_METADATA } from '../../../lib/v5/site-copy';
import GuideView from './GuideView';
import { notFound } from 'next/navigation';

export const revalidate = 600;

/**
 * No guide is built ahead (v6.1.17 Task 4): each renders on its first request and is then kept as ISR for 10 minutes,
 * so the route is static, not rendered per request. A failed read throws and is never kept (landing-cache N3).
 */
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return [];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const page = await getGuidePage(id);
  if (page === null) return NOT_FOUND_METADATA;
  if (page === 'error') return { title: 'Program guide · EarnKit' };
  // L25-6 (v6.1.16): the guide's own card, "{Title}: {money}" over its description's first sentence.
  return pageMeta({
    path: `/programs/${id}`,
    title: `${page.guide.title} · EarnKit`,
    description: guideMeta(page.guide),
    ogTitle: `${page.guide.title}: ${page.guide.money}`,
    ogDescription: firstLine(page.guide.description),
  });
}

/**
 * A program's guide. An id no list shows never reaches here (L27-3, v6.1.16): proxy.ts rewrites it to a path no route
 * serves, so the site's 404 page is in the server HTML with status 404. A record that stops parsing between the two
 * reads is notFound() (a 404; Next 16.4 sends that body as its empty error shell, filled in by the browser), noindex
 * through the metadata; a failed read throws (error.tsx: the "unavailable" panel, never cached), never a 404.
 */
export default async function ProgramGuidePage({ params }: Props) {
  const { id } = await params;
  const page = await getGuidePage(id);
  if (page === null) notFound();
  // N3 (v6.1.17 Task 4): a failed read throws, so ISR keeps the last good guide (or, on a first render, error.tsx shows
  // the unavailable panel) and never caches the failure.
  if (page === 'error') throw new Error('guide read failed');
  return <GuideView id={id} page={page} />;
}
