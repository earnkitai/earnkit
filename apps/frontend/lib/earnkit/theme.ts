/**
 * profile-whoop v4: the premium deep-blue theme, one set of tokens for every redesigned page (the
 * profile, the feed, the slim top bar, the footer, and the brandShell pages: GitHub verify, X sign-in,
 * claim, wallet). React pages read them as CSS variables (--ek-p-*, defined in app/globals.css and
 * tested to match); brand-page.ts inlines them. Every text color is 4.5:1 or more on the page and both
 * card stops (profile-pages.test.ts 10.5).
 */
export const THEME = {
  /** The page: deep navy, a touch lighter at the top. */
  page: '#070D24',
  pageTop: '#0A1433',
  /** The slim top bar's glass. */
  glass: 'rgba(7, 13, 36, 0.85)',
  /** A card: a soft navy top-down gradient between these two. */
  surfaceTop: '#111C3D',
  surface: '#0C1530',
  /** A raised spot inside a card (an avatar, an icon tile). */
  raised: '#16224A',
  /** Brand blue (#579DFF) at low alpha: borders, hairlines, chip fills, the glow. */
  border: 'rgba(87, 157, 255, 0.12)',
  borderStrong: 'rgba(87, 157, 255, 0.2)',
  hairline: 'rgba(87, 157, 255, 0.1)',
  chip: 'rgba(87, 157, 255, 0.1)',
  chipHover: 'rgba(87, 157, 255, 0.18)',
  track: 'rgba(163, 197, 254, 0.1)',
  glow: 'rgba(87, 157, 255, 0.16)',
  /** Text: primary, body, muted, and the soft brand blue for a quiet accent. */
  text: '#F5F8FF',
  body: '#C8D4EE',
  muted: '#94A3C4',
  accent: '#A3C5FE',
} as const;

/** THEME key to CSS variable name: surfaceTop -> --ek-p-surface-top. */
export const themeVar = (k: keyof typeof THEME) => `--ek-p-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
