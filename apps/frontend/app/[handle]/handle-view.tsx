import { Suspense } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { REFRESH_BUDGET_MS, pageViewRefresh } from '../../lib/earnkit/person-score';
import { clientIp } from '../../lib/earnkit/rate-limit';
import { pageCards, pageHead } from '../../lib/earnkit/page-data';
import { resolveHandle } from '../../lib/earnkit/profiles';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import ProfileView from './ProfileView';
import ProjectCards from './ProjectCards';

/**
 * The projects, after a fresh read of the person's sources only when their last read is over a day
 * old, under the hourly caps (pageViewRefresh; find and score keep the 10-minute refresh).
 */
async function Cards({ id }: { id: number }) {
  // Local design review only (never in production): hold the cards back to see the skeletons.
  const hold = process.env.NODE_ENV === 'development' ? Number(process.env.EARNKIT_DEV_CARDS_DELAY_MS ?? 0) : 0;
  if (hold > 0) await new Promise((done) => setTimeout(done, Math.min(hold, 30_000)));
  await pageViewRefresh(id, { now: new Date(), deadline: Date.now() + REFRESH_BUDGET_MS, ip: clientIp(await headers()) });
  return <ProjectCards cards={await pageCards(id)} />;
}

/**
 * v2.12.1 spec "Identity" and "Profile": the page at a person's X handle, reached at `path` (/<handle>,
 * or /b/<handle> for a reserved one). Hidden, unclaimed or unknown: 404. Another case or a recent
 * rename: a permanent redirect to the page's path. The header renders at once from stored numbers;
 * the project cards stream in after the refresh (skeletons meanwhile).
 */
export async function HandleView({ handle, path }: { handle: string; path: string }) {
  const r = await resolveHandle(handle);
  if (!r) notFound();
  if ('redirect' in r) permanentRedirect(r.redirect);
  // A reserved handle reached at the root (/Terms) lives at /b/Terms.
  if (pagePath(r.handle) !== path) permanentRedirect(pagePath(r.handle));
  return (
    <ProfileView head={await pageHead(r.builderId)}>
      <Suspense fallback={<ProjectCards cards={null} />}>
        <Cards id={r.builderId} />
      </Suspense>
    </ProfileView>
  );
}

/** The page's title, description and share card; nothing for a page that is not public. */
export async function handleMetadata(handle: string): Promise<Metadata> {
  const r = await resolveHandle(handle);
  if (!r || 'redirect' in r) return {};
  const h = await pageHead(r.builderId);
  const card = `${pagePath(r.handle)}/card.png`;
  const title = `${h.name} on EarnKit`;
  return {
    title,
    description: h.topLine,
    alternates: { canonical: pagePath(r.handle) },
    openGraph: { title, description: h.topLine, url: pagePath(r.handle), type: 'profile', images: [{ url: card, width: 1200, height: 630, alt: h.topLine }] },
    twitter: { card: 'summary_large_image', title, description: h.topLine, images: [{ url: card, alt: h.topLine }] },
  };
}
