import { unstable_cache } from 'next/cache';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { builderScoreEnabled } from '@/lib/earnkit/builder-score-flag';
import { profileData } from '@/lib/earnkit/profile-data';
import ProfileView from './ProfileView';

export const revalidate = 600;

/** No profile is prerendered; each is rendered on its first visit and cached (ISR, 10 minutes). */
export const generateStaticParams = async () => [];

/** At most one read per slug per 10 minutes (plain JSON); React `cache` shares it between the metadata and the page. */
const cached = unstable_cache((slug: string) => profileData(slug.toLowerCase()), ['builder-profile-v212'], { revalidate: 600 });
const load = cache((slug: string) => cached(slug));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = builderScoreEnabled() ? await load(slug) : null;
  const name = data && !('redirect' in data) ? data.name : 'Builder';
  return {
    title: `${name} · EarnKit`,
    description: 'A verified builder score from what they shipped and who used it.',
    openGraph: { images: [{ url: `/b/${encodeURIComponent(slug)}/card.png`, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image' },
  };
}

/** v2.12 spec 7: the public profile. Hidden or unknown: 404. An old slug: a permanent redirect (plan R15). */
export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  if (!builderScoreEnabled()) notFound();
  const data = await load((await params).slug);
  if (!data) notFound();
  if ('redirect' in data) permanentRedirect(`/b/${encodeURIComponent(data.redirect)}`);
  return <ProfileView data={data} />;
}
