import { DefaultSeoProps } from 'next-seo';

const config: DefaultSeoProps = {
  defaultTitle: 'Earnkit',
  titleTemplate: '%s | Earnkit',
  description: 'Create Specialized AI Agents in Minutes',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://www.earnkit.com',
    site_name: 'Earnkit',
    description: 'Create Specialized AI Agents in Minutes',
    title: 'Earnkit',
    images: [
      {
        url: 'https://res.cloudinary.com/dptwcv6rr/image/upload/v1737913728/csm4k01ftwomjsbr89hl.png',
        width: 1201,
        height: 630,
        alt: 'Earnkit',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    handle: '@EarnKit_ai',
    site: '@EarnKit_ai',
    cardType: 'summary_large_image',
  },
};

export default config;
