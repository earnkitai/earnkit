import type { NextConfig } from 'next';

/**
 * Sent on every response: no page may be framed, and other sites see only our origin as the referrer.
 * The CSP carries only frame-ancestors: a script-src policy would need per-request nonces for Next's inline scripts.
 */
export const securityHeaders = (production: boolean) => [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // HTTPS only from the first visit on; never pins local http. No includeSubDomains until every
  // earnkit.com subdomain is confirmed to serve HTTPS.
  ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
];

/** Static images: nothing loads or runs, even if one is opened directly. */
export const IMAGE_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";

/** The old legal pages are one page, /terms. `statusCode: 301`, never `permanent: true` (Next sends 308 for that). */
export const LEGAL_REDIRECTS = [
  { source: '/policy', destination: '/terms', statusCode: 301 as const },
  { source: '/risk-disclosure', destination: '/terms', statusCode: 301 as const },
  { source: '/sponsor-terms', destination: '/terms', statusCode: 301 as const },
];

/** Sign-in and the builder's record: never indexed, never in the sitemap. */
export const NOINDEX_PATHS = ['/me', '/me/:path*', '/link/:path*', '/auth/:path*'];

const nextConfig: NextConfig = {
  // No X-Powered-By: the framework is nobody's business (v6.1.7 S5).
  poweredByHeader: false,
  async redirects() {
    return LEGAL_REDIRECTS;
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders(process.env.NODE_ENV === 'production') },
      // The builder's private pages are never indexed; /me is never cached.
      ...NOINDEX_PATHS.map((source) => ({ source, headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] })),
      { source: '/me', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      // A program logo under /public/programs, matched by extension only so it never catches /programs/<id>.
      {
        source: '/programs/:file([a-z0-9-]+\\.(?:svg|png))',
        headers: [{ key: 'Content-Security-Policy', value: IMAGE_CSP }],
      },
    ];
  },
};

export default nextConfig;
