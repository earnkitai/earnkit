import type { NextConfig } from 'next';

/**
 * Sent on every response (v2.2 §5): no page may be framed (the fund and award pages ask a wallet
 * to sign), and other sites see only our origin as the referrer. The CSP carries only
 * frame-ancestors: a script-src policy would need per-request nonces for Next's inline scripts.
 */
export const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

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
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
