// Common types for the Earny Home project

export interface MetaData {
  title: string;
  description: string;
  keywords: string[];
  image?: string;
}

export interface NavItem {
  label: string;
  href: string;
  external?: boolean;
}

export interface SocialLink {
  platform: string;
  url: string;
  icon: string;
}
