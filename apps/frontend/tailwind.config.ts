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
        /*
         * v3 (spec 5.8): every colour is a page token (lib/earnkit/theme.ts THEME, as the --ek-p-*
         * variables in globals.css). No raw hex here: the mirror is globals.css. Page, flat surface,
         * raised spot, hairlines, the three text roles, the one accent and the brand fill.
         */
        'ek-page': 'var(--ek-p-page)',
        'ek-surface': 'var(--ek-p-surface)',
        'ek-surface-top': 'var(--ek-p-surface-top)',
        'ek-raised': 'var(--ek-p-raised)',
        'ek-chip': 'var(--ek-p-chip)',
        'ek-chip-hover': 'var(--ek-p-chip-hover)',
        'ek-line': 'var(--ek-p-border)',
        'ek-line-strong': 'var(--ek-p-border-strong)',
        'ek-track': 'var(--ek-p-track)',
        'ek-text': 'var(--ek-p-text)',
        'ek-body': 'var(--ek-p-body)',
        'ek-muted': 'var(--ek-p-muted)',
        /* The one accent: blue text (links, the won line, the Backing pill) and the brand fill's hover. */
        'ek-accent': 'var(--ek-p-accent)',
        /* Base blue: fills only (the primary button, dots, selection). Text on it is ek-text. */
        'ek-brand': 'var(--ek-p-brand)',
        'ek-brand-hover': 'var(--ek-p-accent)',
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
