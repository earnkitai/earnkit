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

const nextConfig: NextConfig = {
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
    ];
  },
};

export default nextConfig;
