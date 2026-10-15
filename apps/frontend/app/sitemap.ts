import { MetadataRoute } from 'next';
import { boardSlug } from '@/lib/earnkit/bonus-rounds';
import { benchEnabled } from '@/lib/earnkit/builder-score-flag';
import { sql } from '@/lib/earnkit/db';

const SITE = 'https://earnkit.com';

/** Read at request time: the builder bonus rounds come from the database. */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: SITE, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/terms`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE}/programs`, changeFrequency: 'daily', priority: 0.8 },
  ];
  // v2.13: the Bench and its feed, only under the flag (off: a 404).
  if (benchEnabled())
    pages.push({ url: `${SITE}/bench`, changeFrequency: 'daily', priority: 0.8 }, { url: `${SITE}/feed`, changeFrequency: 'daily', priority: 0.6 });
  try {
    // v2.7 §2: each open curated program's guide (never an EarnKit or sponsor campaign).
    const programs = await sql()<{ id: string }[]>`
      SELECT id FROM programs WHERE status = 'active' AND source = 'file' AND campaign IS NULL
        AND (ends_at IS NULL OR ends_at > now()) ORDER BY id`;
    for (const p of programs)
      pages.push({ url: `${SITE}/programs/${p.id}`, changeFrequency: 'daily', priority: 0.7 });
    // Every builder bonus round with a public page (an empty one has nothing to show); v2.13: none
    // under the Bench flag (the round pages are a 404 then).
    if (!benchEnabled()) {
      const rounds = await sql()<{ round_key: string }[]>`
        SELECT round_key FROM bonus_rounds WHERE state <> 'empty' ORDER BY ends_at DESC LIMIT 500`;
      for (const r of rounds)
        pages.push({ url: `${SITE}/bonus/${boardSlug(r.round_key)}`, changeFrequency: 'daily', priority: 0.6 });
    }
  } catch (err) {
    console.error('[sitemap] programs and bonus rounds', err);
  }
  return pages;
}
