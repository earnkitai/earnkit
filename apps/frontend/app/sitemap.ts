import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://earnkit.com',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://earnkit.com/terms',
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: 'https://earnkit.com/privacy',
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
