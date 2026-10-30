/**
 * v2.12.1 spec "Identity": "A handle equal to a site route is served at /b/<handle>." Every
 * top-level directory under app/, the app's own file routes and every top-level name in public/
 * (extension dropped) is listed; reserved-routes.test.ts reads both directories, so a new
 * top-level route fails the suite until it is added here. Pure, import-free.
 */
export const RESERVED_ROUTES: ReadonlySet<string> = new Set([
  // app/ directories (components, fonts and lib have no page but are kept out of the handle space too)
  '.well-known', 'admin', 'api', 'b', 'badge', 'bench', 'bonus', 'campaigns', 'claim', 'components', 'connect', 'docs', 'feed', 'fonts', 'github', 'install', 'leaderboard', 'lib', 'mcp', 'oauth', 'p', 'programs', 'signin', 'terms', 'x',
  // app/ file routes and Next metadata names
  'favicon', 'sitemap', 'robots', 'manifest', 'icon', 'apple-icon', 'opengraph-image', 'twitter-image', '_next',
  // public/ (extension dropped)
  'art', 'earnkit', 'favicon-32x32', 'images', 'llms', 'logo', 'og',
]);

export const isReserved = (handle: string): boolean => RESERVED_ROUTES.has(handle.toLowerCase());
/** The page's path, in the handle's own case: /<handle>, or /b/<handle> for a reserved one. Pure. */
export const pagePath = (handle: string): string => (isReserved(handle) ? `/b/${handle}` : `/${handle}`);
/** How replies and the card write the page: earnkit.com/<handle> (no scheme, as the spec's examples). Pure. */
export const pageUrl = (handle: string): string => `earnkit.com${pagePath(handle)}`;
