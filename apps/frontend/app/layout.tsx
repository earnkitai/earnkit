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
  title: 'EarnKit | The Agent Monetization Layer',
  description: 'Onchain Payments for AI Agents',
  keywords: [
    'ai agent monetization',
    'web3 monetization sdk',
    'crypto payments api',
    'smart wallet billing',
    'onchain billing solution',
    'usage based pricing web3',
    'ethereum payment sdk',
    'stablecoin payment integration',
    'web3 developer tools',
    'monetize ai agents with crypto',
    'agent fee routing sdk',
    'per prompt billing api',
    'credit system for ai bots',
    'wallet native subscription payments',
    'fee capture from swaps and bridges',
    'farcaster bot monetization',
    'telegram trading bot fees',
    'erc4337 smart wallet billing',
    'turnkey wallet integration',
    'privy wallet billing',
    'zora coins sdk monetization',
    'langchain monetization plugin',
    'agentkit billing integration',
    'elizaos fee layer',
    'stripe alternative for crypto agents',
    'how to charge per api call in web3',
    'add usage based fees to ai agent',
    'integrate crypto payments in nextjs app',
    'best sdk for ethereum micropayments',
    'credit top up system for llm usage',
    'accept eth and stablecoins in dapp',
    'build pay per use farcaster mini app',
    'create subscription model for onchain bots',
    'sdk to track prompts and onchain fees',
    'monetize openai agent on polygon',
    'implement wallet auto deduction no popups',
    'web3 analytics for agent revenue',
    'fee splitting smart contract template',
    'deploy tokenized mini app with earnings',
    'convert llm usage to onchain revenue',
    'stripe vs earnkit',
    'polar sh alternative web3',
    'web3 billing vs stripe',
    'best crypto payment sdk 2025',
    'segment for agent billing',
    'earnkit sdk',
    'earnkit monetization protocol',
    'earnkit agent templates',
    'earnkit crypto payments',
    'earnkit dashboard',
  ],
  authors: [{ name: 'EarnKit Team' }],
  robots: 'index, follow',
  alternates: {
    canonical: 'https://earnkit.com',
  },
  openGraph: {
    title: 'EarnKit | The Agent Matrix',
    siteName: 'EarnKit',
    url: 'https://earnkit.com',
    type: 'website',
    locale: 'en_US',
    description: 'Onchain Payments for AI Agents',
    images: [
      {
        url: 'https://res.cloudinary.com/coinvise/image/upload/v1751438732/earnkit_monetize_metaimage_ub79zc.png',
        width: 1200,
        height: 630,
        alt: 'EarnKit Platform Preview',
      },
    ],
  },
  twitter: {
    site: '@EarnKit_ai',
    creator: '@EarnKit_ai',
    card: 'summary_large_image',
    title: 'EarnKit | The Agent Matrix',
    description: 'Onchain Payments for AI Agents',
    images: [
      {
        url: 'https://res.cloudinary.com/coinvise/image/upload/v1751438732/earnkit_monetize_metaimage_ub79zc.png',
        alt: 'EarnKit Platform Preview',
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
        <meta name="theme-color" content="#000000" />
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
