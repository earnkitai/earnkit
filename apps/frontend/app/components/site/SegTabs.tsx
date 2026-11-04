/**
 * The agent tabs as a pill rail that wraps onto more rows instead of scrolling, so every agent's full name shows
 * at every width; the 26px radius stays concentric with the tabs on two rows and reads as a pill on one. Every tab
 * is 44px tall on a phone, 38px from md; the current one is a white pill.
 */
const TONES = {
  /** Inside the install sheet (a panel): the rail is the page colour. */
  sheet: { rail: 'bg-s-page', idle: 'text-s-muted hover:text-s-text', on: 'bg-s-light text-s-ink' },
  /** On a light card (the docs install card): the rail is the light inner tile, idle tabs ink-muted. */
  light: { rail: 'bg-s-light-inner', idle: 'text-s-ink-muted hover:text-s-ink', on: 'bg-s-light text-s-ink' },
} as const;

export type SegTone = keyof typeof TONES;

/** The rail's classes. */
export function segRail(tone: SegTone): string {
  return `flex max-w-full flex-wrap gap-1 rounded-[26px] p-1 ${TONES[tone].rail}`;
}

/** One tab's classes, current or not. */
export function segTab(tone: SegTone, on: boolean): string {
  const t = TONES[tone];
  return `inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-[18px] text-sm font-semibold motion-safe:transition-colors md:min-h-[38px] ${
    on ? t.on : t.idle
  }`;
}
