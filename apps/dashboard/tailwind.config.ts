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
        background: 'var(--background)',
        foreground: 'var(--foreground)',

        primary: '#007AFF',
        destructive: '#EE4444',
        'destructive-foreground': 'var(--destructive-foreground)',
        'black/4': 'rgba(0, 0, 0, 0.04)',
        'black/10': 'rgba(0, 0, 0, 0.1)',
        'black/20': 'rgba(0, 0, 0, 0.2)',
        'black/30': 'rgba(0, 0, 0, 0.3)',
        'black/40': 'rgba(0, 0, 0, 0.4)',
        'black/50': 'rgba(0, 0, 0, 0.5)',
        'black/60': 'rgba(0, 0, 0, 0.6)',
        'black/70': 'rgba(0, 0, 0, 0.7)',
        'black/80': 'rgba(0, 0, 0, 0.8)',
        'black/90': 'rgba(0, 0, 0, 0.9)',
        'black/100': 'rgba(0, 0, 0, 1)',
      },
      fontFamily: {
        'funnel-display': ['var(--font-funnel-display)', 'sans-serif'],
        'funnel-sans': ['var(--font-funnel-sans)', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
