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
        /* Brand palette (DESIGN.md): the primary blue, its soft tint, and the coin/win accent. */
        'ek-blue-bright': '#579DFF',
        'ek-blue-soft': '#A3C5FE',
        'ek-score-orange': '#FF7A1A',

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
        'ek-glass': 'var(--ek-p-glass)',
      },
      fontFamily: {
        'funnel-display': ['var(--font-funnel-display)', 'sans-serif'],
        'funnel-sans': ['var(--font-funnel-sans)', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
