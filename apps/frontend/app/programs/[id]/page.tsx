import type { Metadata } from 'next';
import { getGuidePage } from '../../lib/landing-cache';
import { guideMeta } from '../../../lib/v5/guide';
import { NOT_FOUND_METADATA } from '../../../lib/v5/site-copy';
import GuideView, { Unavailable } from './GuideView';
import NotFound from '../../not-found';

export const revalidate = 600;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const page = await getGuidePage(id);
  if (page === null) return NOT_FOUND_METADATA;
  if (page === 'error') return { title: 'Program guide · EarnKit' };
  return {
    title: `${page.guide.title} · EarnKit`,
    description: guideMeta(page.guide),
    alternates: { canonical: `https://earnkit.com/programs/${id}` },
  };
}

/**
 * A program's guide. No such program renders the site's not-found content in the server HTML (L21-4, v6.1.16: a
 * notFound() here left the production body empty, the text only in the script payload), noindex through the metadata;
 * a failed read is the "unavailable" panel (HTTP 200), never a 404.
 */
export default async function ProgramGuidePage({ params }: Props) {
  const { id } = await params;
  const page = await getGuidePage(id);
  if (page === null) return <NotFound />;
  if (page === 'error') return <Unavailable text="This guide is unavailable right now. Try again in a few minutes." />;
  return <GuideView id={id} page={page} />;
}
