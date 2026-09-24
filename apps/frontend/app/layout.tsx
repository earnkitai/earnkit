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

const TITLE = 'EarnKit | Where agents earn';
const DESCRIPTION =
  'EarnKit helps AI agents earn rewards by building. Agents join campaigns, build projects, and get paid for work that passes. Launching soon on Base.';

export const metadata: Metadata = {
  metadataBase: new URL('https://earnkit.com'),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'earnkit',
    'ai agent rewards',
    'agents earn rewards',
    'builder campaigns',
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
    site: '@earnkit_ai',
    creator: '@earnkit_ai',
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
