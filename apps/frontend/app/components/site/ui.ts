/**
 * v3.1 site primitives as class strings (the owner-approved canvas; colours only from SITE tokens,
 * lib/v5/site-theme.ts, as Tailwind s-*). Cards carry their fill, radius and text colour; each
 * page adds its own padding and layout. S12: the dim text token never sits on a card (v31-site-tokens.test.ts scans app/).
 */

/** Neutral dark card: the 180deg card gradient, a hairline border that brightens on hover. */
export const CARD_NEUTRAL =
  'rounded-[32px] border border-s-line bg-[linear-gradient(180deg,var(--ek-s-card-top)_0%,var(--ek-s-card-bottom)_100%)] text-s-text motion-safe:transition-colors duration-200 hover:border-s-line-hover';
/** Blue card (profile hero, podium #1, selectors strip): secondary text is s-on-blue-soft. */
export const CARD_BLUE = 'rounded-[36px] bg-s-blue text-s-on-blue';
/** Navy card (score, token, how the week works): secondary text is s-on-navy or s-on-navy-soft. */
export const CARD_NAVY = 'rounded-[36px] bg-s-navy text-s-text';
/** Rust card (streak, podium #3, 404): secondary text is s-rust-sub, accents s-rust-on and s-rust-soft. */
export const CARD_RUST = 'rounded-[36px] bg-s-rust text-s-text';
/** Light card (profile Activity, docs install): ink text; inner tiles are s-light-inner. */
export const CARD_LIGHT = 'rounded-[36px] bg-s-light text-s-ink';
/** Panel (highlights, leaderboard list, docs side nav): secondary text is s-muted. */
export const CARD_PANEL = 'rounded-[36px] bg-s-panel text-s-text';

/** White pill (hero CTA, Share, Back home): ink on white, 44px tall. */
export const PILL_WHITE =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-s-light px-6 text-[15px] font-bold text-s-ink motion-safe:transition-colors duration-200 hover:bg-s-light-hover';
/** Blue pill (the nav's "Add to your agent"): white on blue, 14px/600, 44px tall. */
export const PILL_BLUE =
  'inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-s-blue px-5 text-[14px] font-semibold text-s-on-blue motion-safe:transition-colors duration-200 hover:bg-s-blue-top';

/** Page columns: 1240px (landing, feed) and 1200px (profile, leaderboard, docs, 404); 16px gutters on a phone, 24px from md. */
export const PAGE_COL_WIDE = 'mx-auto w-full max-w-[1240px] px-4 md:px-6';
export const PAGE_COL = 'mx-auto w-full max-w-[1200px] px-4 md:px-6';

/** A page title (72px, 48px on a phone) and a section title (64px, 44px on a phone), in Kaftan Serif. */
export const H1_SITE = 'ek-serif text-[48px] leading-none text-s-text md:text-[72px]';
export const H2_SITE = 'ek-serif text-[44px] leading-none text-s-text md:text-[64px]';

/** A card's radius on the profile: 28px on a phone, the card's 36px from md. */
export const phoneRadius = (card: string): string => card.replace('rounded-[36px]', 'rounded-[28px] md:rounded-[36px]');

/** The metal "Top N%" standing pills (gold top 5%, silver top 10%, bronze top 25%): a 135deg gradient, its ink, a glow and a top shine. */
export const METAL = {
  gold: 'bg-[linear-gradient(135deg,var(--ek-s-gold-top)_0%,var(--ek-s-gold-mid)_45%,var(--ek-s-gold-bottom)_100%)] text-s-gold-ink shadow-[0_4px_16px_var(--ek-s-gold-glow),inset_0_1px_0_var(--ek-s-metal-shine)]',
  silver: 'bg-[linear-gradient(135deg,var(--ek-s-silver-top)_0%,var(--ek-s-silver-mid)_45%,var(--ek-s-silver-bottom)_100%)] text-s-silver-ink shadow-[0_4px_16px_var(--ek-s-silver-glow),inset_0_1px_0_var(--ek-s-metal-shine)]',
  bronze: 'bg-[linear-gradient(135deg,var(--ek-s-bronze-top)_0%,var(--ek-s-bronze-mid)_50%,var(--ek-s-bronze-bottom)_100%)] text-s-bronze-ink shadow-[0_4px_16px_var(--ek-s-bronze-glow),inset_0_1px_0_var(--ek-s-metal-shine)]',
} as const;
