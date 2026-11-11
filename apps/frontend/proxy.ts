/**
 * The /me gate: no live session is a 302 to /docs#record before the page renders (lib/v6/me-routes.ts).
 * On /oauth/authorize and /.well-known (no request body): a method no route can export (PROPFIND and any other) is 405
 * with that path's Allow before the route runs (L19-1); the rest go on to the route.
 * /mcp, /oauth/token and /oauth/register are never matched (v6.1.16 Task 5 fix round 1, I1): a matched path has its
 * whole body buffered by Next before the route runs, which defeats the 5 s body timeout and the body caps. Their
 * PUT, PATCH, GET and DELETE 405s come from the route files; PROPFIND-class methods there, and TRACE and CONNECT
 * everywhere (Next's fetch Request refuses them first: a bare 500), are parked as an edge rule.
 */
import { NextResponse } from 'next/server';
import { notAllowed } from './lib/v5/http';
import { meGet } from './lib/v6/me-routes';

/** The methods a route handler can be asked for; any other never reaches one. */
const ROUTE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** The Allow of every endpoint the proxy matches past /me (authorize and discovery; the route files answer the same). */
const ALLOW = 'GET, HEAD, OPTIONS';

export function proxy(request: Request) {
  const { pathname } = new URL(request.url);
  if (pathname === '/me') return meGet(request);
  if (!ROUTE_METHODS.has(request.method.toUpperCase())) return notAllowed(ALLOW);
  return NextResponse.next();
}

export const config = { matcher: ['/me', '/oauth/authorize', '/.well-known/:path*'] };
