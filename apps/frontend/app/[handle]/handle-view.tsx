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
import { profileSite } from '../../lib/earnkit/site-data';
import { NOT_FOUND_METADATA } from '../not-found';
import BenchProfileView, { BenchProfileSkeleton } from './BenchProfileView';

type Query = Record<string, string | string[] | undefined> | undefined;
/** v3 Stage 3's tabs. v3.1 (plan S15, owner decision O6): the profile has no tabs; `?tab=` is read and ignored. */
export type ProfileTab = 'log' | 'project' | 'money';
/** `?tab=project`, `?tab=money` (v3 Stage 3), else the Ship log (the default, the plain URL). Pure; the page ignores it. */
export const tabOf = (q: Query): ProfileTab => (q?.tab === 'project' ? 'project' : q?.tab === 'money' ? 'money' : 'log');
/** v3.1 W6: the Activity page, `?page=<n>` (1 when absent or not a whole number from 1; the view clamps past the end). Pure. */
export const pageOf = (q: Query): number => {
  const n = Number(Array.isArray(q?.page) ? q.page[0] : q?.page);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

/**
 * v2.13: the whole Bench profile, after a fresh read of the person's sources when the last is over a day old
 * (pageViewRefresh, under the hourly caps). v3.1: with the site's own reads (profileSite: last shipped, this week,
 * highlights, the standing pill, the Token card).
 */
async function BenchPage({ id, page }: { id: number; page: number }) {
  const now = new Date();
  await pageViewRefresh(id, {
    now,
    deadline: now.getTime() + REFRESH_BUDGET_MS,
    ip: clientIp(await headers()),
  });
  const at = new Date();
  const data = await profileData(id, at);
  if (!data) notFound();
  const site = await profileSite(id, data, at);
  return <BenchProfileView data={data} site={site} page={page} />;
}

/**
 * v2.12.1 spec "Identity" and "Profile": the page at a person's X handle, reached at `path` (/<handle>,
 * or /b/<handle> for a reserved one). Hidden, unclaimed or unknown: 404. Another case or a recent
 * rename: a permanent redirect to the page's path. v2.13: the Bench profile (spec "Profile"), its photo, name and
 * @handle first (a skeleton while the refresh runs); v3.1: on the Activity `page` the URL names.
 */
export async function HandleView({
  handle,
  path,
  page = 1,
}: {
  handle: string;
  path: string;
  /** v3 Stage 3's tab: ignored since v3.1 (no tabs). */
  tab?: ProfileTab;
  page?: number;
}) {
  const r = await resolveHandle(handle);
  if (!r) notFound();
  if ('redirect' in r) permanentRedirect(r.redirect);
  // A reserved handle reached at the root (/Terms) lives at /b/Terms.
  if (pagePath(r.handle) !== path) permanentRedirect(pagePath(r.handle));
  return (
    <Suspense fallback={<BenchProfileSkeleton head={await pageHead(r.builderId)} />}>
      <BenchPage id={r.builderId} page={page} />
    </Suspense>
  );
}

/** The page's title, description and share card; the 404's title for a page that is not public (page() calls notFound()). */
export async function handleMetadata(handle: string): Promise<Metadata> {
  const r = await resolveHandle(handle);
  if (!r) return NOT_FOUND_METADATA;
  if ('redirect' in r) return {};
  const h = await pageHead(r.builderId);
  const card = `${pagePath(r.handle)}/card.png`;
  const title = `${h.name} on EarnKit`;
  // The score line ("Shipping 62 · Top 4% of builders") describes the page; without one, the v2.12.1 top line.
  const description = (await rankLines(r.builderId)).line ?? h.topLine;
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
