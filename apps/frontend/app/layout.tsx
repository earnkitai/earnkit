import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import SchemaOrg from '@/app/components/ui/SchemaOrg';
import Header from '@/app/components/common/Header';
import { SITE } from '@/lib/v5/site-theme';
import { CTA_INSTALL, HERO_SUB } from '@/lib/v5/site-copy';

// Self-hosted (SIL OFL 1.1, app/fonts/OFL.txt), so a Google Fonts outage can't fail a build.
const funnelDisplay = localFont({
  src: './fonts/funnel-display-latin-wght-normal.woff2',
  variable: '--font-funnel-display',
  weight: '400 700',
  display: 'swap',
});

const funnellsans = localFont({
  src: './fonts/funnel-sans-latin-wght-normal.woff2',
  variable: '--font-funnel-sans',
  weight: '300 700',
  display: 'swap',
});

// Kaftan Serif (owner-owned licence) for headlines, big numbers and section titles (.ek-serif).
const kaftan = localFont({
  src: './fonts/kaftan-serif.woff2',
  variable: '--font-kaftan',
  weight: '400',
  display: 'swap',
});

const TITLE = 'EarnKit | Get funded for what you ship.';
// #1 (v6.1.15): the hero line's own words, so the meta never says more than the page.
const DESCRIPTION = `${CTA_INSTALL} and ask: What can I earn? ${HERO_SUB}`;

export const metadata: Metadata = {
  metadataBase: new URL('https://earnkit.com'),
  title: TITLE,
  description: DESCRIPTION,
  keywords: ['grants', 'hackathons', 'builder programs', 'developer grants', 'ecosystem programs', 'MCP'],
  authors: [{ name: 'EarnKit' }],
  robots: 'index, follow',
  alternates: {
    canonical: 'https://earnkit.com',
  },
  openGraph: {
    title: TITLE,
    siteName: 'EarnKit',
    url: 'https://earnkit.com',
    type: 'website',
    locale: 'en_US',
    description: DESCRIPTION,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'EarnKit: Get funded for what you ship.',
      },
    ],
  },
  twitter: {
    site: '@EarnKitAI',
    creator: '@EarnKitAI',
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/og.png',
        alt: 'EarnKit: Get funded for what you ship.',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon-32x32.png"
        />
        <link
          rel="apple-touch-icon"
          type="image/png"
          sizes="180x180"
          href="/apple-icon.png"
        />
        <meta name="theme-color" content={SITE.page} />
        <SchemaOrg />
      </head>
      <body
        className={`${funnelDisplay.variable} ${funnellsans.variable} ${kaftan.variable} antialiased relative`}
        suppressHydrationWarning
      >
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
