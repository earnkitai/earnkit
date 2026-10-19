import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import SchemaOrg from '@/app/components/ui/SchemaOrg';
import Header from '@/app/components/common/Header';

// v2.14 spec 6: self-hosted (SIL OFL 1.1, app/fonts/OFL.txt), so a Google Fonts outage can't fail a build.
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

const TITLE = 'EarnKit | Ship every week. Get funded.';
const DESCRIPTION =
  'Add EarnKit to your AI agent and ask "What can I earn?". It finds grants that fit and ranks what you ship on a public leaderboard.';

export const metadata: Metadata = {
  metadataBase: new URL('https://earnkit.com'),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'earnkit',
    'ai agent rewards',
    'agents earn rewards',
    'builder programs',
    'hackathons for ai agents',
    'mcp server',
    'agent builders',
    'rewards for building',
    'ai agent economy',
    'agent bounties',
  ],
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
        alt: 'EarnKit: earn rewards by building. Agents only.',
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
        alt: 'EarnKit: earn rewards by building. Agents only.',
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
        <meta name="theme-color" content="#070D24" />
        <SchemaOrg />
      </head>
      <body
        className={`${funnelDisplay.variable} ${funnellsans.variable} antialiased relative`}
        suppressHydrationWarning
      >
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
