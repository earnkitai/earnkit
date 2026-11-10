/**
 * Site primitives as class strings (colours only from SITE tokens, lib/v5/site-theme.ts, as Tailwind s-*).
 * Cards carry their fill, radius and text colour; each page adds its own padding and layout.
 */

/** Neutral card (the landing's steps, program cards): a soft navy gradient and a hairline; secondary text is s-muted. */
export const CARD_NEUTRAL = 'rounded-[32px] border border-s-step-line bg-gradient-to-br from-s-step-top to-s-step-bottom text-s-text';
/** Blue card (docs: your record): secondary text is s-on-blue-soft. */
export const CARD_BLUE = 'rounded-[36px] bg-s-blue text-s-on-blue';
/** Navy card: secondary text is s-on-navy or s-on-navy-soft. */
export const CARD_NAVY = 'rounded-[36px] bg-s-navy text-s-text';
/** Rust card (404): secondary text is s-rust-sub, accents s-rust-on and s-rust-soft. */
export const CARD_RUST = 'rounded-[36px] bg-s-rust text-s-text';
/** Light card (docs install): ink text; inner tiles are s-light-inner. */
export const CARD_LIGHT = 'rounded-[36px] bg-s-light text-s-ink';
/** Panel (docs side nav, program lists): secondary text is s-muted. */
export const CARD_PANEL = 'rounded-[36px] bg-s-panel text-s-text';

/** White pill (hero CTA, Back home): ink on white, 44px tall. */
export const PILL_WHITE =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-s-light px-6 text-[15px] font-bold text-s-ink motion-safe:transition-colors duration-200 hover:bg-s-light-hover';
/** Blue pill (the nav's "Add to your agent"): white on blue, 14px/600, 44px tall. */
export const PILL_BLUE =
  'inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-s-blue px-5 text-[14px] font-semibold text-s-on-blue motion-safe:transition-colors duration-200 hover:bg-s-blue-top';

/** Page columns: 1240px (landing) and 1200px (programs, docs, terms, 404); 16px gutters on a phone, 24px from md. */
export const PAGE_COL_WIDE = 'mx-auto w-full max-w-[1240px] px-4 md:px-6';
export const PAGE_COL = 'mx-auto w-full max-w-[1200px] px-4 md:px-6';

/** A page title (72px, 48px on a phone) and a section title (64px, 44px on a phone), in Kaftan Serif. */
export const H1_SITE = 'ek-serif text-[48px] leading-none text-s-text md:text-[72px]';
export const H2_SITE = 'ek-serif text-[44px] leading-none text-s-text md:text-[64px]';
