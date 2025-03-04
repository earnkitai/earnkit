import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  async redirects() {
    return [
      // Basic redirect
      {
        source: '/',
        destination: '/dashboard',
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        hostname: 'www.notion.so',
      },
    ],
  },
};

export default nextConfig;
