import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans } from "next/font/google";
import "./globals.css";
import NewFooter from "./components/common/NewFooter";

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
    metadataBase: new URL('https://earny.chat'),
    title: "Earny | Your Earning Assistant",
    description: "Welcome to Earny - Earn with automated trading on Zora, Uniswap, Jupiter and more.",
    keywords: [
        "Earny", "AI earning", "artificial intelligence", "earning platform",
        "AI automation", "passive income", "AI tools", "earn money online",
        "Earny platform", "AI-powered earning", "automated earning",
        "best earning platform", "AI for income", "earn with AI",
        "automated income", "AI earning tools", "passive income with AI"
    ],
    authors: [{ name: "Earny Team" }],
    robots: "index, follow",
    alternates: {
        canonical: 'https://earny.chat',
    },
    openGraph: {
        title: "Earny | Your Earning Assistant",
        siteName: "Earny",
        url: "https://earny.chat",
        type: "website",
        locale: "en_US",
        description: "Welcome to Earny - Earn with automated trading on Zora, Uniswap, Jupiter and more.",
        images: [
            {
                url: "https://res.cloudinary.com/coinvise/image/upload/v1747986022/Earny_Platform_Meta_Image.png",
                width: 1200,
                height: 630,
                alt: "Earny Platform Preview",
            },
        ],
    },
    twitter: {
        site: "@Earny_ai",
        creator: "@Earny_ai",
        card: "summary_large_image",
        title: "Earny | Your Earning Assistant",
        description: "Welcome to Earny - Earn with automated trading on Zora, Uniswap, Jupiter and more.",
        images: [
            {
                url: "https://res.cloudinary.com/coinvise/image/upload/v1747986022/Earny_Platform_Meta_Image.png",
                alt: "Earny Platform Preview",
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
            </head>
            <body className={`${funnelDisplay.variable} ${funnellsans.variable} antialiased relative`} suppressHydrationWarning>
                <main className="flex-grow z-30" >
                    {children}
                </main>
                <NewFooter />
            </body>
        </html>
    );
} 