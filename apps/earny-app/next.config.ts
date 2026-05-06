import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.cache = false;
    return config;
  },
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
  // async headers() {
  //   return [
  //     {
  //       source: '/:path*',
  //       headers: [
  //         {
  //           key: 'Content-Security-Policy-Report-Only',
  //           value: `
  //             default-src 'self';
  //             script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com;
  //             style-src 'self' unsafe-inline;
  //             img-src 'self' data: blob: https://*.privy.io https://*.walletconnect.com https://*.walletconnect.org;
  //             font-src 'self';
  //             object-src 'none';
  //             base-uri 'self';
  //             form-action 'self';
  //             frame-ancestors 'none';
  //             child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org;
  //             frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com;
  //             connect-src 'self' https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://api.coingecko.com https://*.walletconnect.com https://*.walletconnect.org https://*.sentry.io;
  //             worker-src 'self';
  //             manifest-src 'self'
  //           `
  //             .replace(/\s+/g, ' ')
  //             .trim(),
  //         },
  //       ],
  //     },
  //   ];
  // },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: 'earnkit-g7',
  project: 'javascript-nextjs',

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
