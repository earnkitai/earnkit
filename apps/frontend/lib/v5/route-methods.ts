/**
 * The methods each route serves, outside Task 5's /mcp, /oauth and /.well-known (L31-1, v6.1.16 Task 17): a method
 * outside a route's set is 405 JSON `{ error: 'method_not_allowed' }` with that set as `Allow` and CORS. The proxy
 * answers for the paths it matches (pages, /me, /link/<code>); a route file with a body (POST) answers for itself
 * through `refuseFor`, because a path the proxy matches has its whole body buffered by Next first (Task 5, I1).
 */
import { notAllowed } from './http';

/** Every path the table does not name is a page (the 404 page included). */
export const PAGE_METHODS = 'GET, HEAD';

/** Route by route, first match wins; the Allow is the route's own exports (HEAD served wherever GET is). */
export const METHODS_BY_ROUTE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/me$/, PAGE_METHODS],
  // GET on a /me form route is a 303 to /me, so a reload or an opened link lands on the page (L43-9, v6.1.19:
  // /me/sent is one of them).
  [/^\/me\/[^/]+$/, 'GET, POST'],
  [/^\/link\/[^/]+\/confirm$/, 'POST'],
  [/^\/link\/[^/]+$/, 'GET'],
  [/^\/api\/cron$/, 'POST'],
  [/^\/api\/programs\/(?:approve|revert)$/, 'GET, HEAD, POST'],
  [/^\/api\/programs\/reviewers$/, 'POST, OPTIONS'],
  [/^\/api\/programs\/write$/, 'POST'],
  [/^\/api\/(?:programs|programs\/writes|programs\/applications|stats|me\/signed-in)$/, 'GET, HEAD'],
  [/^\/auth\/github\/callback$/, 'GET, HEAD'],
  [/^\/llms\.txt$/, 'GET, HEAD'],
];

/** The Allow of a path. Pure. */
export const allowOf = (pathname: string): string => METHODS_BY_ROUTE.find(([re]) => re.test(pathname))?.[1] ?? PAGE_METHODS;

/** Whether `allow` serves `method` (HEAD wherever GET is, as Next answers HEAD with GET). Pure. */
export function serves(allow: string, method: string): boolean {
  const m = method.toUpperCase();
  const set = allow.split(', ');
  return set.includes(m) || (m === 'HEAD' && set.includes('GET'));
}

/** The 405 handler a route file exports for each method it does not serve (L31-1). */
export const refuseFor = (path: string) => () => notAllowed(allowOf(path));

/** GET on a /me form route: back to the page (L31-1, so its Allow names GET). */
export const toMe = () => new Response(null, { status: 303, headers: { Location: '/me', 'Cache-Control': 'no-store' } });
