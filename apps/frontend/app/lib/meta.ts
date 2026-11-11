/**
 * Each page's own share card (L25-6, v6.1.16, Review Focus 13): the canonical and og:url are the same address, and the
 * page's title and description go on the card. Next replaces the layout's openGraph and twitter objects whole, so the
 * card's fixed parts (site name, image) are repeated here. Pure.
 */
import type { Metadata } from 'next';
import { ONE_LINE } from '../../lib/v5/site-copy';

export const SITE_URL = 'https://earnkit.com';
/** The home page's title and the card the layout gives every page that sets none. */
export const SITE_TITLE = 'EarnKit | Get funded for what you ship.';
const IMAGE = { url: '/og.png', width: 1200, height: 630, alt: 'EarnKit: Get funded for what you ship.' };
export const OG_BASE = { siteName: 'EarnKit', type: 'website', locale: 'en_US', images: [IMAGE] } as const;
export const TWITTER_BASE = { site: '@EarnKitAI', creator: '@EarnKitAI', card: 'summary_large_image', images: [{ url: IMAGE.url, alt: IMAGE.alt }] } as const;

type PageMeta = {
  /** The page's path, "/" for home. */
  path: string;
  /** The page's <title>. */
  title: string;
  /** The page's meta description. */
  description: string;
  /** The card's title, when not the page's title (a guide: "{Title}: {money}"). */
  ogTitle?: string;
  /** The card's description, when not the page's description. */
  ogDescription?: string;
};

export function pageMeta(o: PageMeta): Metadata {
  const url = o.path === '/' ? SITE_URL : `${SITE_URL}${o.path}`;
  const title = o.ogTitle ?? o.title;
  const description = o.ogDescription ?? o.description;
  return {
    title: o.title,
    description: o.description,
    alternates: { canonical: url },
    openGraph: { ...OG_BASE, images: [...OG_BASE.images], url, title, description },
    twitter: { ...TWITTER_BASE, images: [...TWITTER_BASE.images], title, description },
  };
}

/**
 * The layout's metadata (L25-2): the one line on the description and the default card. No canonical and no og:url:
 * each page sets its own through pageMeta, so a page without one (the 404, L25-21) has none. No robots either:
 * indexing is the default, and Next's own noindex on a 404 must stay the page's only robots meta.
 */
export const SITE_METADATA: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: ONE_LINE,
  keywords: ['grants', 'hackathons', 'builder programs', 'developer grants', 'ecosystem programs', 'MCP'],
  authors: [{ name: 'EarnKit' }],
  openGraph: { ...OG_BASE, images: [...OG_BASE.images], title: SITE_TITLE, description: ONE_LINE },
  twitter: { ...TWITTER_BASE, images: [...TWITTER_BASE.images], title: SITE_TITLE, description: ONE_LINE },
};

/** A guide's card line: the first sentence of the program's description, else the one line. Pure. */
export function firstLine(description: string | null | undefined): string {
  const d = (description ?? '').trim();
  if (!d) return ONE_LINE;
  return d.split(/(?<=[.!?])\s+(?=[A-Z0-9$"'(])/)[0];
}
