/**
 * v3 (spec 5.8): the site's two buttons, for links and buttons alike. Pills, 48px tall, one type size.
 * Primary: Base blue with white text, the accent on hover. Secondary: a strong hairline, the chip tint on hover.
 */
export const BTN_PRIMARY =
  'inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-ek-brand px-6 font-funnel-sans text-base font-medium text-ek-text motion-safe:transition-colors hover:bg-ek-accent';
export const BTN_SECONDARY =
  'inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-ek-line-strong px-6 font-funnel-sans text-base font-medium text-ek-text motion-safe:transition-colors hover:bg-ek-chip';
/**
 * Task 7: a link inside running text (the terms): underlined, white, and a 44px hit area that never moves the line.
 * Below md the link's own padding makes it 44px (cancelled by margin); from md an invisible box above and below the
 * words does. v3.1 final fix 5: never both, so two links on neighbouring lines never overlap on a phone.
 */
export const INLINE_LINK =
  "relative inline-block -my-3 py-3 text-ek-text underline underline-offset-4 md:my-0 md:py-0 md:after:absolute md:after:-inset-y-3 md:after:inset-x-0 md:after:content-['']";
/** A quiet text link beside a section title ("See all"): the accent, 44px tall, underlined on hover. */
export const TEXT_LINK = 'inline-flex min-h-11 items-center font-funnel-sans text-base font-medium text-ek-accent underline-offset-4 hover:underline';
