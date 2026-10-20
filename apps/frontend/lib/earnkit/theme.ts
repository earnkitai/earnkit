/**
 * v3 (spec 5.8): the site's one set of page tokens (every page, the header and footer, and the brandShell
 * pages: GitHub verify, X sign-in, claim, wallet). React pages read them as CSS variables (--ek-p-*, defined
 * in app/globals.css and tested to match); brand-page.ts inlines them.
 *
 * The flat system: a true black page, white type, one accent (Base blue), hairlines of white at low alpha
 * instead of cards. No gradient, no glow, no shadow: `pageTop` equals `page` and `surfaceTop` equals
 * `surface` so the mirrors that still read two stops draw one flat colour, and `glow` is transparent.
 * Every text colour is 4.5:1 or more on the page, the surface and the raised spot (v3-tokens.test.ts,
 * profile-pages.test.ts 10.5).
 */
export const THEME = {
  /** The page: black. `pageTop` is kept for the mirrors and is the same black. */
  page: '#000000',
  pageTop: '#000000',
  /** The slim top bar's glass. */
  glass: 'rgba(0,0,0,0.85)',
  /** A flat surface where one is still needed (an input, a code block). One colour, no gradient. */
  surfaceTop: '#0E1116',
  surface: '#0E1116',
  /** A raised spot (an avatar, an icon tile). */
  raised: '#161A22',
  /** White at low alpha: hairlines, outlines, chip fills, the ring track. */
  border: 'rgba(255,255,255,0.12)',
  borderStrong: 'rgba(255,255,255,0.24)',
  hairline: 'rgba(255,255,255,0.12)',
  chip: 'rgba(255,255,255,0.06)',
  chipHover: 'rgba(255,255,255,0.12)',
  track: 'rgba(255,255,255,0.10)',
  /** Transparent: nothing glows. Kept so the mirrors stay complete. */
  glow: 'rgba(0,0,0,0)',
  /** Text: primary (white), body, muted. */
  text: '#FFFFFF',
  body: '#C9CDD6',
  muted: '#7E8694',
  /** The one accent as text and as the primary button's hover: a lighter Base blue that reads at 4.5:1 on black. */
  accent: '#3D7BFF',
  /** Base blue: the primary button's fill, selection, dots. A fill, not a text colour (3.7:1 on black). */
  brand: '#0052FF',
} as const;

/** THEME key to CSS variable name: surfaceTop -> --ek-p-surface-top. */
export const themeVar = (k: keyof typeof THEME) => `--ek-p-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
