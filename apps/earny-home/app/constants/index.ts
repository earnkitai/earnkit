// Constants for the Earny Home project

export const SITE_CONFIG = {
  name: 'Earny',
  description: 'Your AI-powered earning platform',
  url: 'https://earny.com',
  ogImage:
    'https://res.cloudinary.com/coinvise/image/upload/v1747986022/Earny_Platform_Meta_Image.png',
  links: {
    twitter: 'https://twitter.com/Earny_ai',
    github: 'https://github.com/earny',
  },
} as const;

export const NAVIGATION = [
  {
    title: 'Home',
    href: '/',
  },
  {
    title: 'Features',
    href: '/features',
  },
  {
    title: 'About',
    href: '/about',
  },
  {
    title: 'Contact',
    href: '/contact',
  },
] as const;
