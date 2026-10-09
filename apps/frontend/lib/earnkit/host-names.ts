/**
 * v2.9 C12/C14: names shared by the host Worker (infra/host-worker, bundled by wrangler through a
 * relative import) and the hosting server code. Import-free.
 */

/**
 * Subdomains that never route to the Worker and are never a site slug. The owner adds every existing
 * DNS record in the zone to `EARNKIT_RESERVED_SUBDOMAINS` (Railway) and the Worker's `RESERVED` var.
 */
export const HOST_RESERVED = ['www', 'docs', 'api', 'mcp', 'app', 'mail', 'admin', 'status', 'abuse', 'host'] as const;

/** Opaque origin: a hosted site gets no earnkit.com cookies, storage or same-site requests. */
export const HOST_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals; form-action 'self'";

/** Sent on every Worker response: files, errors, the end page and the taken-down page. */
export const HOST_HEADERS: Record<string, string> = {
  'Content-Security-Policy': HOST_CSP,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** R2 key prefixes: `sites/<slug>/<path>` holds the files, `state/<slug>.json` the site's status. */
export const SITE_PREFIX = 'sites/';
export const STATE_PREFIX = 'state/';

/** The Content-Type the Worker serves (and the upload writes) for each static extension. */
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  webmanifest: 'application/manifest+json',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** The Content-Type for a key, from the extension of its last segment. */
export function contentTypeFor(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return TYPES[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}
