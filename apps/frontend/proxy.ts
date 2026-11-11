/**
 * The /me gate: no live session is a 302 to /docs#record before the page renders (lib/v6/me-routes.ts).
 * On /mcp, /oauth and /.well-known: a method no route can export (PROPFIND and any other) is 405 with that path's
 * Allow before the route runs (L19-1); the rest go on to the route. TRACE and CONNECT never get here on `next start`:
 * Next builds a fetch Request first, which refuses them, and answers a bare 500 (no stack) on any route handler with
 * or without this proxy. Refusing those two needs the edge in front (v6.1.16 Task 5 report).
 */
import { NextResponse } from 'next/server';
import { notAllowed } from './lib/v5/http';
import { meGet } from './lib/v6/me-routes';

/** The methods a route handler can be asked for; any other never reaches one. */
const ROUTE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** The Allow of an endpoint the proxy matches (the same values the route files answer). Pure. */
function allowOf(pathname: string): string {
  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) return 'POST, DELETE, OPTIONS';
  if (pathname.startsWith('/oauth/authorize')) return 'GET';
  if (pathname.startsWith('/oauth/')) return 'POST, OPTIONS';
  return 'GET, HEAD, OPTIONS';
}

export function proxy(request: Request) {
  const { pathname } = new URL(request.url);
  if (pathname === '/me') return meGet(request);
  if (!ROUTE_METHODS.has(request.method.toUpperCase())) return notAllowed(allowOf(pathname));
  return NextResponse.next();
}

export const config = { matcher: ['/me', '/mcp', '/oauth/:path*', '/.well-known/:path*'] };
