import { notFound, permanentRedirect } from 'next/navigation';
import { handleTopLine } from '../../lib/earnkit/handle-page';
import { resolveHandle } from '../../lib/earnkit/profiles';
import { pagePath } from '../../lib/earnkit/reserved-routes';

/**
 * v2.12.1 T6: the page at a person's X handle, reached at `path` (/<handle>, or /b/<handle> for a
 * reserved one). Hidden, unclaimed or unknown: 404. Another case or a recent rename: a permanent
 * redirect to the page's path. T11 replaces the view.
 */
export async function HandleView({ handle, path }: { handle: string; path: string }) {
  const r = await resolveHandle(handle);
  if (!r) notFound();
  if ('redirect' in r) permanentRedirect(r.redirect);
  // A reserved handle reached at the root (/Terms) lives at /b/Terms.
  if (pagePath(r.handle) !== path) permanentRedirect(pagePath(r.handle));
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold">{await handleTopLine(r.builderId)}</h1>
    </main>
  );
}
