import { MetadataRoute } from 'next';
import { sql } from '@/lib/earnkit/db';

const SITE = 'https://earnkit.com';

/** Read at request time: the builder bonus rounds come from the database. */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: SITE, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/policy`, changeFrequency: 'monthly', priority: 0.5 },
  ];
  try {
    // Every builder bonus round with a public page (an empty one has nothing to show).
    const rounds = await sql()<{ round_key: string }[]>`
      SELECT round_key FROM bonus_rounds WHERE state <> 'empty' ORDER BY ends_at DESC LIMIT 500`;
    for (const r of rounds)
      pages.push({ url: `${SITE}/bonus/${encodeURIComponent(r.round_key)}`, changeFrequency: 'daily', priority: 0.6 });
  } catch (err) {
    console.error('[sitemap] bonus rounds', err);
  }
  return pages;
}
