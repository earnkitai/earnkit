import { THEME } from '../../lib/earnkit/theme';

/**
 * profile-whoop v2 (v4: on the deep-blue THEME, lib/earnkit/theme.ts): the profile's premium palette.
 * Scoring and clarity: one score (Shipping, the hero ring in SCORE_COLORS.total), so the hue families
 * are for the facts around it: `ship` (going live, commits), `weeks` (the grid, streaks) and `wins`
 * (program wins). Each keeps its gradient (`from` to `to`) and `text`, the one solid color it is set
 * in (4.5:1 or more on the page and the card surface, tested).
 */
export const PART_COLORS = {
  ship: { from: '#3B82F6', to: '#22D3EE', text: '#67E8F9' }, // blue to cyan
  weeks: { from: '#D946EF', to: '#F472B6', text: '#F9A8D4' }, // magenta to pink
  wins: { from: '#F59E0B', to: '#FB923C', text: '#FCD34D' }, // amber to orange
} as const;
export type PartLabel = keyof typeof PART_COLORS;
export type Hue = { from: string; to: string; text?: string };

/** profile-whoop v2: a dark card surface (hairline border, soft top-down gradient). */
export const SURFACE =
  'rounded-[24px] border border-[var(--ek-p-border)] bg-gradient-to-b from-[var(--ek-p-surface-top)] to-[var(--ek-p-surface)]';

export const SCORE_COLORS = {
  /** The hero ring: white to the soft brand blue. */
  total: { from: '#FFFFFF', to: THEME.accent } as Hue,
  /** A ring's empty track: thin and dim. */
  track: THEME.track,
  /** The page behind everything (deep navy). */
  page: THEME.page,
  /** A card surface: a soft top-down gradient between these two. */
  surfaceTop: THEME.surfaceTop,
  surface: THEME.surface,
  /** Text: primary, and the muted blue-grey for secondary lines and labels. */
  text: THEME.text,
  muted: THEME.muted,
} as const;

/**
 * profile-whoop v2 (the feed): which hue a fact chip takes. A ship (live, commits) is `ship`; streaks
 * and weeks are `weeks`; a win is `wins`; anything else stays neutral. Pure.
 */
export function chipHue(chip: string): PartLabel | null {
  if (/^(Went live|Live)$|\bcommits?$/.test(chip)) return 'ship';
  if (/\bweeks? in a row$|\bweeks? shipping$|^Started tracking$/.test(chip)) return 'weeks';
  if (/^Won /.test(chip)) return 'wins';
  return null;
}
