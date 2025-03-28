import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  // async redirects() {
  //   return [
  //     // Basic redirect
  //     {
  //       source: '/',
  //       destination: '/dashboard',
  //       permanent: true,
  //     },
  //   ];
  // },
  images: {
    remotePatterns: [
      {
        hostname: 'www.notion.so',
      },
      {
        hostname: 'coin-images.coingecko.com',
      },
      {
        hostname: 'imagedelivery.net',
      },
      {
        hostname: 'assets.coingecko.com',
      },
      {
        hostname: 'assets.geckoterminal.com',
      },
    ],
  },
};

export default nextConfig;
