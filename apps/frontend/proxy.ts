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
 * /_next, /api (case-exact), /.well-known, a file name with a dot, /mcp or /oauth in any case.
 */
import { NextResponse } from 'next/server';
import { notAllowed } from './lib/v5/http';
import { meGet } from './lib/v6/me-routes';
import { publicOrigin } from './lib/v5/oauth';

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
const NOT_A_PAGE = /^\/(?:_next\/|api\/|\.well-known\/|mcp(?:\/|$)|oauth\/)|\.[^/]*$/i;

export function proxy(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname === '/me') return meGet(request);
  if (pathname === '/oauth/authorize' || pathname.startsWith('/.well-known/')) {
    if (!ROUTE_METHODS.has(request.method.toUpperCase())) return notAllowed(ALLOW);
    return NextResponse.next();
  }
  const lower = NOT_A_PAGE.test(pathname) ? null : lowerPath(url);
  if (lower) return new Response(null, { status: 308, headers: { Location: `${publicOrigin(request)}${lower.pathname}${lower.search}` } });
  return NextResponse.next();
}

/**
 * The last entry matches only a path with an upper-case letter and no dot, outside /_next, /api, /mcp and /oauth (in
 * any case), so /mcp, /oauth/token and /oauth/register are never matched (their bodies stay unbuffered, Task 5).
 */
export const config = {
  matcher: [
    '/me',
    '/oauth/authorize',
    '/.well-known/:path*',
    '/((?![Aa][Pp][Ii]/|_next/|[Mm][Cc][Pp](?:/|$)|[Oo][Aa][Uu][Tt][Hh]/)[^.]*[A-Z][^.]*)',
  ],
};
