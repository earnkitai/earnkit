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
        litepaperBg: '#E2E8EE',

        /* Brand system — source of truth (see DESIGN.md) */
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
        'ek-pink': '#D76CEF',
        'ek-purple': '#562AA7',
        'ek-orange': '#FE6C11',
        'ek-brown': '#210800',
        'ek-purple-paint': '#8A63D2',

        /* Orange world — sampled from the Figma landing (sections 2-4) */
        'ek-ember': '#140300',
        'ek-card-brown': '#210800',
        'ek-amber': '#FC9E19',
        'ek-cream': '#FDF1DF',

        /* Legacy aliases — kept so untouched pages keep rendering */
        color1: '#2E70EA',
        color2: '#0A4EC2',
        color3: '#0D3991',
        color4: '#112969',
        color5: '#0F1839',
        color6: '#579DFF',
        color7: '#A3C5FE',
        color8: '#E5EEFC',
        color9: 'rgba(20, 3, 0, 1)',
        color10: 'rgba(252, 158, 25, 1)',
        color11: 'rgba(253, 241, 223, 1)',
        color12: 'rgba(33, 8, 0, 1)',
        color13: 'rgba(86, 42, 167, 1)',
        color14: '#F6F9FE',
        color15: 'rgba(30, 9, 0, 1)',
        black10: 'rgba(0, 0, 0, 0.1)',
        black20: 'rgba(0, 0, 0, 0.2)',
        black30: 'rgba(0, 0, 0, 0.3)',
        black40: 'rgba(0, 0, 0, 0.4)',
        black50: 'rgba(0, 0, 0, 0.5)',
        black60: 'rgba(0, 0, 0, 0.6)',
        black70: 'rgba(0, 0, 0, 0.7)',
        black80: 'rgba(0, 0, 0, 0.8)',
        black90: 'rgba(0, 0, 0, 0.9)',
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
