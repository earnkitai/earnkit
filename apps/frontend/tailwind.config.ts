import type { Config } from 'tailwindcss';

export default {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /* Brand palette (see DESIGN.md) */
        'ek-base': '#1A2238',
        'ek-black': '#0A0B1A',
        'ek-navy-deep': '#0F1839',
        'ek-navy': '#112969',
        'ek-blue-deep': '#0D3991',
        'ek-blue-strong': '#0A4EC2',
        'ek-blue': '#2E70EA',
        'ek-blue-bright': '#579DFF',
        'ek-blue-soft': '#A3C5FE',
        'ek-blue-light': '#E5EEFC',
        'ek-white': '#F6F9FE',
        /* v2.12 builder score accents */
        'ek-score-orange': '#FF7A1A',
        'ek-score-purple': '#9B6BFF',
        /* Campaign pages (archived sponsor campaigns) */
        'ek-ember': '#140300',
        'ek-card-brown': '#210800',
        'ek-amber': '#FC9E19',
        'ek-cream': '#FDF1DF',

        /*
         * R18: the page tokens every page uses (lib/earnkit/theme.ts THEME, as the --ek-p-* variables
         * in globals.css). Page, card surface, raised spot, hairline, and the three text roles.
         */
        'ek-page': 'var(--ek-p-page)',
        'ek-surface': 'var(--ek-p-surface)',
        'ek-surface-top': 'var(--ek-p-surface-top)',
        'ek-raised': 'var(--ek-p-raised)',
        'ek-chip': 'var(--ek-p-chip)',
        'ek-chip-hover': 'var(--ek-p-chip-hover)',
        'ek-line': 'var(--ek-p-border)',
        'ek-line-strong': 'var(--ek-p-border-strong)',
        'ek-text': 'var(--ek-p-text)',
        'ek-body': 'var(--ek-p-body)',
        'ek-muted': 'var(--ek-p-muted)',
        'ek-accent': 'var(--ek-p-accent)',
      },
      fontFamily: {
        'funnel-display': ['var(--font-funnel-display)', 'sans-serif'],
        'funnel-sans': ['var(--font-funnel-sans)', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
