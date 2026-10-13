import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { builderScoreEnabled } from '@/lib/earnkit/builder-score-flag';
import ProfileView from './ProfileView';
import { cachedProfile } from './profile-load';

export const revalidate = 600;

/** No profile is prerendered; each is rendered on its first visit and cached (ISR, 10 minutes). */
export const generateStaticParams = async () => [];

/** The cached read (profile-load.ts), under the lowercase slug; React `cache` shares it between the metadata and the page. */
const load = cache((slug: string) => cachedProfile(slug.toLowerCase()));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = builderScoreEnabled() ? await load(slug) : null;
  const name = data && !('redirect' in data) ? data.name : 'Builder';
  // The share card exists only with a public score (card.png is a 404 otherwise).
  const card = data && 'score' in data ? `/b/${encodeURIComponent(data.slug)}/card.png` : null;
  return {
    title: `${name} · EarnKit`,
    description: 'A verified builder score from what they shipped and who used it.',
    ...(card && { openGraph: { images: [{ url: card, width: 1200, height: 630 }] }, twitter: { card: 'summary_large_image' } }),
  };
}

/** v2.12 spec 7: the public profile. Hidden or unknown: 404. An old slug: a permanent redirect (plan R15). */
export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  if (!builderScoreEnabled()) notFound();
  const { slug } = await params;
  // One URL per profile: /b/Lee_Builds is /b/lee_builds.
  if (slug !== slug.toLowerCase()) permanentRedirect(`/b/${encodeURIComponent(slug.toLowerCase())}`);
  const data = await load(slug);
  if (!data) notFound();
  if ('redirect' in data) permanentRedirect(`/b/${encodeURIComponent(data.redirect)}`);
  return <ProfileView data={data} />;
}
