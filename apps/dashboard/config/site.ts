import { SiteConfig } from '@/types';

const baseUrl =
  process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
    : `http://localhost:3000`;

export const siteConfig: SiteConfig = {
  name: 'Earnkit',
  author: 'earnkit',
  description: 'Earnkit is a platform for creating ai agents.',
  keywords: [
    'Turnkey',
    'Web3',
    'Next.js',
    'React',
    'Tailwind CSS',
    'Radix UI',
    'shadcn/ui',
  ],
  url: {
    base: baseUrl,
    author: 'https://earnkit.com',
  },
  links: {
    github: 'https://github.com/earnkitai/earnkit',
  },
  ogImage: `${baseUrl}/og.jpg`,
};
