import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getGuidePage } from '../../lib/landing-cache';
import { NOT_FOUND_METADATA } from '../../../lib/v5/site-copy';
import GuideView, { Unavailable } from './GuideView';

export const revalidate = 600;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const page = await getGuidePage(id);
  if (page === null) return NOT_FOUND_METADATA;
  if (page === 'error') return { title: 'Program guide · EarnKit' };
  return {
    title: `${page.guide.title} · EarnKit`,
    description: `${page.guide.money}, ${page.guide.closes.toLowerCase()}. Who can apply, what the form asks and the rules.`,
    alternates: { canonical: `https://earnkit.com/programs/${id}` },
  };
}

/** A program's guide. No such program is a 404; a failed read is the "unavailable" panel (HTTP 200), never a 404. */
export default async function ProgramGuidePage({ params }: Props) {
  const { id } = await params;
  const page = await getGuidePage(id);
  if (page === null) notFound();
  if (page === 'error') return <Unavailable text="This guide is unavailable right now. Try again in a few minutes." />;
  return <GuideView id={id} page={page} />;
}
