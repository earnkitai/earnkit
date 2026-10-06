import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getGuidePage } from '../../lib/landing-cache';
import GuideView, { Unavailable } from './GuideView';

/** v2.7 §2: read server-side, revalidated every 10 minutes (no new service). */
export const revalidate = 600;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const page = await getGuidePage(id);
  if (page === null || page === 'error') return { title: 'Program guide · EarnKit' };
  return {
    title: `${page.title} guide · EarnKit`,
    description: `What can I earn on ${page.title}? Difficulty, what won before, and what ${page.ecosystem} wants now.`,
    alternates: { canonical: `https://earnkit.com/programs/${id}` },
  };
}

/**
 * v2.7 §2, Ruling 22 (plan): a curated program's guide. Any other id is a 404; a failed read is
 * the "unavailable" panel (HTTP 200), never a 404.
 */
export default async function ProgramGuidePage({ params }: Props) {
  const page = await getGuidePage((await params).id);
  if (page === null) notFound();
  if (page === 'error') return <Unavailable text="This guide is unavailable right now. Try again in a few minutes." />;
  return <GuideView page={page} />;
}
