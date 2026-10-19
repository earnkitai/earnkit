import { MetadataRoute } from 'next';
import { sql } from '@/lib/earnkit/db';

const SITE = 'https://earnkit.com';

/** Read at request time: the program guides come from the database. */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: SITE, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/terms`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE}/programs`, changeFrequency: 'daily', priority: 0.8 },
  ];
  // The leaderboard and its feed.
  pages.push({ url: `${SITE}/leaderboard`, changeFrequency: 'daily', priority: 0.8 }, { url: `${SITE}/feed`, changeFrequency: 'daily', priority: 0.6 });
  try {
    // v2.7 §2: each open curated program's guide (never an EarnKit or sponsor campaign).
    const programs = await sql()<{ id: string }[]>`
      SELECT id FROM programs WHERE status = 'active' AND source = 'file' AND campaign IS NULL
        AND (ends_at IS NULL OR ends_at > now()) ORDER BY id`;
    for (const p of programs)
      pages.push({ url: `${SITE}/programs/${p.id}`, changeFrequency: 'daily', priority: 0.7 });
  } catch (err) {
    console.error('[sitemap] programs', err);
  }
  return pages;
}
