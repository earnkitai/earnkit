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

const nextConfig: NextConfig = {
  async redirects() {
    return LEGAL_REDIRECTS;
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders(process.env.NODE_ENV === 'production') },
      // A program logo under /public/programs, matched by extension only so it never catches /programs/<id>.
      {
        source: '/programs/:file([a-z0-9-]+\\.(?:svg|png))',
        headers: [{ key: 'Content-Security-Policy', value: IMAGE_CSP }],
      },
    ];
  },
};

export default nextConfig;
