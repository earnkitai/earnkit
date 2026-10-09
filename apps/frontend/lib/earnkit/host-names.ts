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
