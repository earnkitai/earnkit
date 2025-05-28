import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans } from "next/font/google";
import "./globals.css";
import SchemaOrg from '@/app/components/ui/SchemaOrg';
import Header from "@/app/components/common/Header";

const funnelDisplay = Funnel_Display({
  variable: "--font-funnel-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const funnellsans = Funnel_Sans({
  variable: "--font-funnel-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://earnkit.com'),
  title: "EarnKit | The Agent Matrix",
  description: "Build and deploy custom AI agents effortlessly with EarnKit's framework.",
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
    canonical: 'https://earnkit.com',
  },
  openGraph: {
    title: "EarnKit | The Agent Matrix",
    siteName: "EarnKit",
    url: "https://earnkit.com",
    type: "website",
    locale: "en_US",
    description: "Build and deploy custom AI agents effortlessly with EarnKit's framework.",
    images: [
      {
        url: "https://res.cloudinary.com/coinvise/image/upload/v1747986022/Earnkit_Platform_Meta_Image.png",
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
    title: "EarnKit | The Agent Matrix",
    description: "Build and deploy custom AI agents effortlessly with EarnKit's framework.",
    images: [
      {
        url: "https://res.cloudinary.com/coinvise/image/upload/v1747986022/Earnkit_Platform_Meta_Image.png",
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
    <html lang="en">
      <head>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="apple-touch-icon" type="image/png" sizes="180x180" href="/apple-icon.png" />
        <meta name="theme-color" content="#000000" />
        <SchemaOrg />
      </head>
      <body className={`${funnelDisplay.variable} ${funnellsans.variable} antialiased relative`} suppressHydrationWarning>
        <Header />
        <main className="flex-grow z-30" >
          {children}
        </main>
      </body>
    </html>
  );
}
