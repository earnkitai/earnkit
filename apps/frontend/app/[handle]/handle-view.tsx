import { Suspense } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import {
  REFRESH_BUDGET_MS,
  pageViewRefresh,
} from '../../lib/earnkit/person-score';
import { clientIp } from '../../lib/earnkit/rate-limit';
import { pageHead } from '../../lib/earnkit/page-data';
import { resolveHandle } from '../../lib/earnkit/profiles';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import { profileData } from '../../lib/earnkit/bench-data';
import { rankLines } from '../../lib/earnkit/bench-rank';
import BenchProfileView, { BenchProfileSkeleton } from './BenchProfileView';
import SlimTopBar from '../components/common/SlimTopBar';

export type ProfileTab = 'log' | 'project';
/** `?tab=project`, else the Ship log (the default, the plain URL). Pure. */
export const tabOf = (
  q: Record<string, string | string[] | undefined> | undefined,
): ProfileTab => (q?.tab === 'project' ? 'project' : 'log');

/** v2.13: the whole Bench profile, after a fresh read of the person's sources when the last is over a day old (pageViewRefresh, under the hourly caps). */
async function BenchPage({ id, tab }: { id: number; tab: ProfileTab }) {
  await pageViewRefresh(id, {
    now: new Date(),
    deadline: Date.now() + REFRESH_BUDGET_MS,
    ip: clientIp(await headers()),
  });
  const data = await profileData(id, new Date());
  if (!data) notFound();
  return <BenchProfileView data={data} tab={tab} />;
}

/**
 * v2.12.1 spec "Identity" and "Profile": the page at a person's X handle, reached at `path` (/<handle>,
 * or /b/<handle> for a reserved one). Hidden, unclaimed or unknown: 404. Another case or a recent
 * rename: a permanent redirect to the page's path. v2.13: the Bench profile (spec "Profile") on the
 * `tab` the URL names, its photo, name and @handle first (a skeleton while the refresh runs).
 */
export async function HandleView({
  handle,
  path,
  tab = 'log',
}: {
  handle: string;
  path: string;
  tab?: ProfileTab;
}) {
  const r = await resolveHandle(handle);
  if (!r) notFound();
  if ('redirect' in r) permanentRedirect(r.redirect);
  // A reserved handle reached at the root (/Terms) lives at /b/Terms.
  if (pagePath(r.handle) !== path) permanentRedirect(pagePath(r.handle));
  // profile-whoop v2: the near-black page with its own slim top bar (data-ek-premium: globals.css).
  return (
    <div data-ek-premium="" className="ek-premium">
      <SlimTopBar />
      <Suspense
        fallback={<BenchProfileSkeleton head={await pageHead(r.builderId)} />}
      >
        <BenchPage id={r.builderId} tab={tab} />
      </Suspense>
    </div>
  );
}

/** The page's title, description and share card; nothing for a page that is not public. */
export async function handleMetadata(handle: string): Promise<Metadata> {
  const r = await resolveHandle(handle);
  if (!r || 'redirect' in r) return {};
  const h = await pageHead(r.builderId);
  const card = `${pagePath(r.handle)}/card.png`;
  const title = `${h.name} on EarnKit`;
  // v2.13: the Bench line ("Top 4% on the Bench") describes the page; without one, the v2.12.1 top line.
  const description = (await rankLines(r.builderId)).bench ?? h.topLine;
  return {
    title,
    description,
    alternates: { canonical: pagePath(r.handle) },
    openGraph: {
      title,
      description,
      url: pagePath(r.handle),
      type: 'profile',
      images: [{ url: card, width: 1200, height: 630, alt: description }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: card, alt: description }],
    },
  };
}
