/**
 * The /me gate: no live session is a 302 to /docs#record before the page renders (lib/v6/me-routes.ts).
 * On /oauth/authorize and /.well-known (no request body): a method no route can export (PROPFIND and any other) is 405
 * with that path's Allow before the route runs (L19-1); the rest go on to the route.
 * /mcp, /oauth/token and /oauth/register are never matched (v6.1.16 Task 5 fix round 1, I1): a matched path has its
 * whole body buffered by Next before the route runs, which defeats the 5 s body timeout and the body caps. Their
 * PUT, PATCH, GET and DELETE 405s come from the route files; PROPFIND-class methods there, and TRACE and CONNECT
 * everywhere (Next's fetch Request refuses them first: a bare 500), are parked as an edge rule.
 * L25-20 (v6.1.16): a page path with an upper-case letter is a 308 to its lower-case form, the query kept
 * (`/Programs/Thiel-Fellowship` to `/programs/thiel-fellowship`). The matcher picks only such paths, and never
 * /_next, /api (case-exact), /.well-known, a file name with a dot, /mcp, /oauth or /link in any case (a sign-in code
 * is case-sensitive: lower-casing /link/<code> broke every link, L27-4 v6.1.16). A POST to /link/<code> is 405.
 * L31-1 (v6.1.16 Task 17): every other path the proxy matches (every page, /me, /link/<code>) answers a method outside
 * its `METHODS_BY_ROUTE` set (lib/v5/route-methods.ts) with 405 and that set as Allow; TRACE and CONNECT get the same
 * answer here, but on a real server Next 16.4.1 refuses them before the proxy runs (a bare 500, the parked edge rule).
 * Routes with a body (/me/*, /link/<code>/confirm, /api/*) are not matched and answer from their route files.
 * L27-3 (v6.1.16): a guide path for an id no list shows is rewritten to a path no route serves, so the site's 404 page
 * renders in the server HTML (lang, main, the h1) with status 404. A notFound() thrown by the page itself reaches the
 * browser as Next's empty error shell (seen on a production build of Next 16.4.1), so it stays only as the fallback.
 */
import { NextResponse } from 'next/server';
import { notAllowed } from './lib/v5/http';
import { meGet } from './lib/v6/me-routes';
import { publicOrigin } from './lib/v5/oauth';
import { listGuideIds } from './lib/v5/guide-page';
import { allowOf, serves } from './lib/v5/route-methods';

/** The methods a route handler can be asked for; any other never reaches one. */
const ROUTE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** The Allow of every endpoint the proxy matches past /me (authorize and discovery; the route files answer the same). */
const ALLOW = 'GET, HEAD, OPTIONS';

/** The same URL with its path lower-cased when the path has an upper-case letter, else null. Pure. */
export function lowerPath(url: URL): URL | null {
  if (!/[A-Z]/.test(url.pathname)) return null;
  const to = new URL(url.href);
  to.pathname = url.pathname.toLowerCase();
  return to;
}

/** Paths the lower-case redirect never touches (the matcher leaves them out too): case-exact or body-carrying routes. */
const NOT_A_PAGE = /^\/(?:_next\/|api\/|\.well-known\/|mcp(?:\/|$)|oauth\/|link\/)|\.[^/]*$/i;

/** A path no route serves: a rewrite to it renders the site's 404 page with status 404. */
export const NOT_A_ROUTE = '/_ek/not-found';
/** A guide path: never a logo file (`/programs/<id>.svg` has a dot). */
const GUIDE = /^\/programs\/([^/.]+)$/;

/**
 * The rewrite for a guide path whose id `ids` does not hold (NOT_A_ROUTE on the request's origin), else null: any other
 * path, a listed id, or a failed read (the page then answers as it does today).
 */
export async function guideGate(url: URL, ids: () => Promise<ReadonlySet<string>>): Promise<URL | null> {
  const m = GUIDE.exec(url.pathname);
  if (!m) return null;
  let known: ReadonlySet<string>;
  try {
    known = await ids();
  } catch {
    return null;
  }
  return known.has(m[1]) ? null : new URL(NOT_A_ROUTE, url);
}

/** The listed guide ids, read at most once a minute per process (a new program shows within a minute). */
let guideCache: { at: number; ids: ReadonlySet<string> } | null = null;
async function guideIds(): Promise<ReadonlySet<string>> {
  if (guideCache && Date.now() - guideCache.at < 60_000) return guideCache.ids;
  guideCache = { at: Date.now(), ids: new Set(await listGuideIds()) };
  return guideCache.ids;
}

export async function proxy(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname === '/oauth/authorize' || pathname.startsWith('/.well-known/')) {
    if (!ROUTE_METHODS.has(request.method.toUpperCase())) return notAllowed(ALLOW);
    return NextResponse.next();
  }
  // L31-1 (v6.1.16 Task 17): a method the path does not serve (L27-4: /link/<code> is a page; its POST is /confirm).
  // Read on the lower-case path, so a capitalised route path (/Me/Edit) keeps its 308 for the methods it serves.
  const allow = allowOf(pathname.toLowerCase());
  if (!serves(allow, request.method)) return notAllowed(allow);
  // L35-17 (v6.1.17 Task 4): an old-name session is read, never promoted into the new name.
  if (pathname === '/me') return meGet(request);
  const lower = NOT_A_PAGE.test(pathname) ? null : lowerPath(url);
  if (lower) return new Response(null, { status: 308, headers: { Location: `${publicOrigin(request)}${lower.pathname}${lower.search}` } });
  const gone = await guideGate(url, guideIds);
  if (gone) return NextResponse.rewrite(gone);
  return NextResponse.next();
}

/**
 * The page entry (L31-1, v6.1.16 Task 17) matches every path with no dot outside /_next, /api, /mcp, /oauth, /me/,
 * /link/ and /auth/ (in any case), so a page's unserved method is 405; the last entry matches only a path with an
 * upper-case letter and no dot, outside /_next, /api, /mcp, /oauth and /link (in any case). /mcp, /oauth/token,
 * /oauth/register and every route with a body are never matched (their bodies stay unbuffered, Task 5).
 */
export const config = {
  matcher: [
    '/me',
    '/oauth/authorize',
    '/.well-known/:path*',
    '/programs/:id([^/.]+)',
    '/link/:code([^/.]+)',
    '/((?!_next/|[Aa][Pp][Ii]/|[Mm][Cc][Pp](?:/|$)|[Oo][Aa][Uu][Tt][Hh]/|[Mm][Ee]/|[Ll][Ii][Nn][Kk]/|[Aa][Uu][Tt][Hh]/|\\.well-known/)[^.]*)',
    '/((?![Aa][Pp][Ii]/|_next/|[Mm][Cc][Pp](?:/|$)|[Oo][Aa][Uu][Tt][Hh]/|[Ll][Ii][Nn][Kk]/)[^.]*[A-Z][^.]*)',
  ],
};
