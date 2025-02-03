import type { Metadata } from "next";
import { Funnel_Display } from "next/font/google";
import "./globals.css";
import SchemaOrg from '@/components/SchemaOrg';

const funnelDisplay = Funnel_Display({
  variable: "--font-funnel-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://earnkit.com'),
  title: "EarnKit - Create Specialized AI Agents in Minutes",
  description: "Build and deploy custom AI agents effortlessly with EarnKit. Our platform enables quick creation of specialized AI solutions for various business needs.",
  keywords: [
    "AI agents", "artificial intelligence", "custom AI", "AI development",
    "no-code AI", "AI platform", "business automation", "AI chatbots",
    "Earnkit", "EarnKit AI", "AI automation tools", "AI solutions for businesses",
    "create AI agent online", "build AI assistant without coding",
    "best AI automation platform", "AI tools for business growth",
    "AI for startups", "automate business with AI", "AI chatbot for sales",
    "how to build AI agent", "AI for e-commerce", "AI for customer support"
  ],
  authors: [{ name: "EarnKit Team" }],
  robots: "index, follow",
  alternates: {
    canonical: 'https://earnkit.com',
  },
  themeColor: "#000000",
  openGraph: {
    title: "EarnKit - Create Specialized AI Agents in Minutes",
    siteName: "EarnKit",
    url: "https://earnkit.com",
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
    <html lang="en">
      <head>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="apple-touch-icon" type="image/png" sizes="180x180" href="/apple-icon.png" />
        <SchemaOrg />
      </head>
      <body className={`${funnelDisplay.variable} antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
