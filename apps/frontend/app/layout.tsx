import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import SchemaOrg from '@/app/components/ui/SchemaOrg';
import Header from '@/app/components/common/Header';
import { SITE } from '@/lib/v5/site-theme';
import { SITE_METADATA } from '@/app/lib/meta';

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

// L25-2, L25-6 (v6.1.16): the site's metadata lives in app/lib/meta.ts (testable without the fonts and CSS).
export const metadata: Metadata = SITE_METADATA;

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
