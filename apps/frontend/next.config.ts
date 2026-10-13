import type { NextConfig } from 'next';

/**
 * Sent on every response (v2.2 §5): no page may be framed (the fund and award pages ask a wallet
 * to sign), and other sites see only our origin as the referrer. The CSP carries only
 * frame-ancestors: a script-src policy would need per-request nonces for Next's inline scripts.
 */
export const securityHeaders = (production: boolean) => [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // HTTPS only from the first visit on (no SSL-stripping of /fund); never pins local http.
  // No includeSubDomains until every earnkit.com subdomain is confirmed to serve HTTPS.
  ...(production
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=31536000',
        },
      ]
    : []),
];

/** Uploaded token images: nothing loads or runs, even if one is opened directly. */
export const IMAGE_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";

/**
 * v2.9 F22 (Ruling 16): the three old legal pages are one page, /terms; each old path 301s to its
 * anchor. `statusCode: 301`, never `permanent: true` (Next sends 308 for that).
 */
export const LEGAL_REDIRECTS = [
  { source: '/policy', destination: '/terms#policy', statusCode: 301 as const },
  { source: '/risk-disclosure', destination: '/terms#risk-disclosure', statusCode: 301 as const },
  { source: '/sponsor-terms', destination: '/terms#sponsor-terms', statusCode: 301 as const },
];

const nextConfig: NextConfig = {
  async redirects() {
    return LEGAL_REDIRECTS;
  },
  images: {
    remotePatterns: [
      {
        hostname: 'www.notion.so',
      },
      {
        hostname: '*.cloudinary.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders(process.env.NODE_ENV === 'production'),
      },
      // Config headers replace a route's own: keep the token image's stricter policy (a later
      // rule wins for the same header).
      {
        source: '/api/projects/:id/image',
        headers: [{ key: 'Content-Security-Policy', value: IMAGE_CSP }],
      },
      {
        source: '/api/projects/:id/token-image',
        headers: [{ key: 'Content-Security-Policy', value: IMAGE_CSP }],
      },
      // v2.10 item 12: the generated mark, same policy.
      {
        source: '/api/projects/:id/mark',
        headers: [{ key: 'Content-Security-Policy', value: IMAGE_CSP }],
      },
      // v2.12 spec 7: the share card, same policy.
      {
        source: '/b/:slug/card.png',
        headers: [{ key: 'Content-Security-Policy', value: IMAGE_CSP }],
      },
      // v2.7 fix round 1 (Finding 4), narrowed in fix round 2: a program logo under
      // /public/programs is a static file on this origin; nothing loads or runs if it's opened
      // directly, same as the token images. Matched by extension only (never a bare :file*), so
      // this never catches Task 7's /programs/<id> guide-page route.
      {
        source: '/programs/:file([a-z0-9-]+\\.(?:svg|png))',
        headers: [{ key: 'Content-Security-Policy', value: IMAGE_CSP }],
      },
    ];
  },
};

export default nextConfig;
