import { MetadataRoute } from 'next';
import { listListedPrograms } from '../lib/v5/programs';

const SITE = 'https://earnkit.com';

/** Read at request time: the program guides come from the database. */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: SITE, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/programs`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE}/docs`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE}/terms`, changeFrequency: 'monthly', priority: 0.5 },
  ];
  try {
    for (const p of await listListedPrograms()) pages.push({ url: `${SITE}/programs/${p.id}`, changeFrequency: 'daily', priority: 0.7 });
  } catch (err) {
    console.error('[sitemap] programs', (err as { name?: string } | null)?.name ?? 'unknown');
  }
  return pages;
}
