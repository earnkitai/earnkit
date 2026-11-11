import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import './globals.css';
import SchemaOrg from '@/app/components/ui/SchemaOrg';
import Header from '@/app/components/common/Header';
import { SITE } from '@/lib/v5/site-theme';
import { SITE_METADATA } from '@/app/lib/meta';
import { SKIP_LINK } from '@/lib/v5/site-copy';
import { COOKIE } from '@/lib/v6/sessions';

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

/**
 * Pages for everyone (L27-8, L27-2, L27-16, v6.1.16): the skip link is the first thing in `body` and lands on
 * `main#content`; `#site-root` wraps everything but the install modal's portal, so the modal makes it `inert`; the
 * header shows `Your record` when a session cookie is present (presence only, no database read).
 */
export default async function RootLayout({
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
        <a href="#content" className="skip-link">
          {SKIP_LINK}
        </a>
        <div id="site-root">
          <Header signedIn={Boolean((await cookies()).get(COOKIE)?.value)} />
          <main id="content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
