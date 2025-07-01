import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans } from "next/font/google";
import "./globals.css";
import SchemaOrg from '@/app/components/ui/SchemaOrg';
import { Providers } from "@/providers";

// import { Providers } from "@/providers";
// import Header from "@/app/components/common/Header";
// import Footer from "@/app/components/common/Footer";
const funnelDisplay = Funnel_Display({
  variable: "--font-funnel-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const funnellsans = Funnel_Sans({
  variable: "--font-funnel-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://app.earny.chat'),
  title: "Earny - Your Earning Assistant",
  description: "Earny is your AI-powered earning assistant for automated trading on Zora, Clanker.",
  keywords: [
    "AI agents", "artificial intelligence", "custom AI", "AI development",
    "no-code AI", "AI platform", "business automation", "AI chatbots",
    "Earnkit", "EarnKit AI", "AI automation tools", "AI solutions for businesses",
    "create AI agent", "build AI assistant without coding",
    "best AI automation platform", "AI tools for business growth",
    "AI for startups", "automate business with AI", "AI chatbot for sales",
    "how to build AI agent", "AI for e-commerce", "AI for customer support", "Earn",
    "Decentralized AI", "AI Agent Framework", "AI in Web3", "AI-Powered Blockchain",
    "AI & Blockchain Integration", "AI agent crypto", "Web3 Automation",
    "Blockchain AI", "Crypto Earning Platform", "Earn Cryptocurrency",
    "Next-Gen AI Agents", "AI-Driven dApps", "Agentic AI", "EarnKit Web3",
    "AI agent create free", "EarnKit AI Agent Framework"
  ],
  authors: [{ name: "EarnKit Team" }],
  robots: "index, follow",
  alternates: {
    canonical: 'https://app.earny.chat',
  },
  openGraph: {
    title: "Earny - Your Earning Assistant",
    siteName: "Earny",
    url: "https://app.earny.chat",
    type: "website",
    locale: "en_US",
    description: "Build and deploy custom AI agents effortlessly with EarnKit. Our platform enables quick creation of specialized AI solutions for various business needs.",
    images: [
      {
        url: "https://res.cloudinary.com/dptwcv6rr/image/upload/v1737913728/csm4k01ftwomjsbr89hl.png",
        width: 1200,
        height: 630,
        alt: "EarnKit Platform Preview",
      },
    ],
  },
  twitter: {
    site: "@EarnKit_ai",
    creator: "@EarnKit_ai",
    card: "summary_large_image",
    title: "EarnKit - Create Specialized AI Agents in Minutes",
    description: "Build and deploy custom AI agents effortlessly with EarnKit. Our platform enables quick creation of specialized AI solutions for various business needs.",
    images: [
      {
        url: "https://res.cloudinary.com/dptwcv6rr/image/upload/v1737913728/csm4k01ftwomjsbr89hl.png",
        alt: "EarnKit Platform Preview",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="apple-touch-icon" type="image/png" sizes="180x180" href="/apple-icon.png" />
        <meta name="theme-color" content="#000000" />
        <SchemaOrg />
      </head>
      <body className={`${funnelDisplay.variable} ${funnellsans.variable} antialiased relative`} suppressHydrationWarning>
        <Providers>
          {/* <Header />
              <main className="flex-grow z-30" > */}
          {children}
          {/* </main>
              <Footer /> */}
        </Providers>
      </body>
    </html>
  );
}
