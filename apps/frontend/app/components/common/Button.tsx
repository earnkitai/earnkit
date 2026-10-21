/**
 * v3 (spec 5.8): the site's two buttons, for links and buttons alike. Pills, 48px tall, one type size.
 * Primary: Base blue with white text, the accent on hover. Secondary: a strong hairline, the chip tint on hover.
 */
export const BTN_PRIMARY =
  'inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-ek-brand px-6 font-funnel-sans text-base font-medium text-ek-text motion-safe:transition-colors hover:bg-ek-accent';
export const BTN_SECONDARY =
  'inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-ek-line-strong px-6 font-funnel-sans text-base font-medium text-ek-text motion-safe:transition-colors hover:bg-ek-chip';
/**
 * Task 7: a link inside running text (the terms, the Docs contact line): underlined, white, and a 44px hit area from an
 * invisible box above and below the words, so the line's own height stays the paragraph's.
 */
export const INLINE_LINK = "relative text-ek-text underline underline-offset-4 after:absolute after:-inset-y-3 after:inset-x-0 after:content-['']";
/** A quiet text link beside a section title ("See all"): the accent, 44px tall, underlined on hover. */
export const TEXT_LINK = 'inline-flex min-h-11 items-center font-funnel-sans text-base font-medium text-ek-accent underline-offset-4 hover:underline';
