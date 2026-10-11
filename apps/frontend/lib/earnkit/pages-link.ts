import { canonicalBuilderUrl } from './untrusted-text';

/**
 * v2.11 (moved from tools.ts in the final fix wave, so the owner's backfill reads the same rule
 * without loading the tools): the GitHub Pages links EarnKit accepts for a build. Pure.
 */

/** The owner of a GitHub Pages link (`https://<owner>.github.io/...`), lowercase, or null. Pure. */
export function githubPagesOwner(url: string | undefined): string | null {
  const canonical = url ? canonicalBuilderUrl(url).url : undefined;
  if (!canonical) return null;
  const m = /^([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\.github\.io$/.exec(new URL(canonical).hostname);
  return m ? m[1] : null;
}

/**
 * Security fix I2: the repo's own GitHub Pages link, `https://<owner>.github.io/<repo>/` (or `/` for
 * the repo named `<owner>.github.io`), canonical, else null. Pure. This is where a gh-pages branch
 * whose root holds the starter's site_dir is served (BUILD_PAGES_NOTE).
 */
export function pagesLinkOf(repoKey: string, url: string | undefined): string | null {
  const [owner, repo] = repoKey.toLowerCase().split('/');
  const canonical = url ? canonicalBuilderUrl(url).url : undefined;
  if (!canonical || !owner || !repo || githubPagesOwner(canonical) !== owner) return null;
  const u = new URL(canonical);
  if (u.search || u.hash) return null;
  const path = u.pathname.toLowerCase();
  const ok = repo === `${owner}.github.io` ? path === '/' : path === `/${repo}/` || path === `/${repo}`;
  return ok ? canonical : null;
}
