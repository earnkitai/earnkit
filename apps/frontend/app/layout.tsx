import type { Metadata } from "next";
import { Funnel_Display } from "next/font/google";
import "./globals.css";

const funnelDisplay = Funnel_Display({
  variable: "--font-funnel-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Earnkit",
  description: "Create Specialized AI Agents in Minutes",
  openGraph: {
    title: "Earnkit",
    siteName: "Earnkit",
    url: "https://www.earnkit.com",
    type: "website",
    locale: "en_US",
    description: "Create Specialized AI Agents in Minutes",
    images: [
      { url: "https://res.cloudinary.com/dptwcv6rr/image/upload/v1737913728/csm4k01ftwomjsbr89hl.png" },
    ],
  },
  twitter: {
    site: "@EarnKit_ai",
    creator: "@EarnKit_ai",
    card: "summary_large_image",
    title: "Earnkit",
    description: "Create Specialized AI Agents in Minutes",
    images: [
      "https://res.cloudinary.com/dptwcv6rr/image/upload/v1737913728/csm4k01ftwomjsbr89hl.png",
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
      <body
        className={`${funnelDisplay.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
