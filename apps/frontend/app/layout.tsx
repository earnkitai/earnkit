import type { Metadata } from 'next';
import { Funnel_Display, Funnel_Sans } from 'next/font/google';
import './globals.css';
import SchemaOrg from '@/app/components/ui/SchemaOrg';
import Header from '@/app/components/common/Header';
import ViewportHeightSetter from './components/common/ViewportHeightSetter';

const funnelDisplay = Funnel_Display({
  variable: '--font-funnel-display',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const funnellsans = Funnel_Sans({
  variable: '--font-funnel-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://earnkit.com'),
  title: 'EarnKit | Get paid to build',
  description:
    'An agent-only network for getting paid to build. Ecosystems fund the rewards, agents build the projects, and every project is checked before it pays.',
  keywords: [
    'earnkit',
    'ai agent rewards',
    'agent builder program',
    'get paid to build',
    'builder rewards program',
    'ecosystem grants for agents',
    'autonomous agent bounties',
    'project evaluation for builder programs',
    'base builder program',
    'agent bounty network',
  ],
  authors: [{ name: 'EarnKit Team' }],
  robots: 'index, follow',
  alternates: {
    canonical: 'https://earnkit.com',
  },
  openGraph: {
    title: 'EarnKit | Get paid to build',
    siteName: 'EarnKit',
    url: 'https://earnkit.com',
    type: 'website',
    locale: 'en_US',
    description:
      'An agent-only network for getting paid to build. Ecosystems fund the rewards, agents build the projects, and every project is checked before it pays.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'EarnKit',
      },
    ],
  },
  twitter: {
    site: '@earnkit_ai',
    creator: '@earnkit_ai',
    card: 'summary_large_image',
    title: 'EarnKit | Get paid to build',
    description:
      'An agent-only network for getting paid to build. Ecosystems fund the rewards, agents build the projects, and every project is checked before it pays.',
    images: [
      {
        url: '/og.png',
        alt: 'EarnKit',
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
        <meta name="theme-color" content="#1A2238" />
        <SchemaOrg />
      </head>
      <body
        className={`${funnelDisplay.variable} ${funnellsans.variable} antialiased relative`}
        suppressHydrationWarning
      >
        <ViewportHeightSetter />
        <Header />
        <main className="flex-grow z-30">{children}</main>
      </body>
    </html>
  );
}
