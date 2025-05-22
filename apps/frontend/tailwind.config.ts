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
        color1: 'rgba(46, 112, 234, 1)',
        color2: 'rgba(10, 78, 194, 1)',
        color3: 'rgba(13, 57, 145, 1)',
        color4: 'rgba(17, 41, 105, 1)',
        color5: 'rgba(15, 24, 57, 1)',
        color6: 'rgba(87, 157, 255, 1)',
        color7: 'rgba(163, 197, 254, 1)',
        color8: 'rgba(229, 238, 252, 1)',
        color9: 'rgba(20, 3, 0, 1)',
        color10: 'rgba(252, 135, 25, 1)',
        color11: 'rgba(253, 241, 223, 1)',
        color12: 'rgba(33, 8, 0, 1)',
        color13: 'rgba(86, 42, 167, 1)',
        color14: 'rgba(246, 249, 254, 1)',
      },
      borderColor: {
        color6: 'rgba(87, 157, 255, 1)',
      },
      fontFamily: {
        'funnel-display': ['var(--font-funnel-display)', 'sans-serif'],
        'funnel-sans': ['var(--font-funnel-sans)', 'sans-serif'],
      },
      backgroundSize: {
        grid: '60px 60px',
      },
    },
  },
  plugins: [],
} satisfies Config;
