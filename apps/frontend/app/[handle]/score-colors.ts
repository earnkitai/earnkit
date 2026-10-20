import { THEME } from '../../lib/earnkit/theme';

/**
 * profile-whoop v2 (v3: on the flat black THEME, lib/earnkit/theme.ts): the profile's accent palette.
 * Scoring and clarity: one score (Shipping, the hero ring in SCORE_COLORS.total), so the hue families
 * are for the facts around it: `ship` (going live, commits), `weeks` (the grid, streaks) and `wins`
 * (program wins). Each keeps its gradient (`from` to `to`) and `text`, the one solid color it is set
 * in (4.5:1 or more on the page and the surface, tested). Owner: kept on purpose to make the profile fun
 * and encouraging; the one place the site has more than one hue. UpdateCard's chip dot reads `to` from here.
 */
export const PART_COLORS = {
  ship: { from: '#3B82F6', to: '#22D3EE', text: '#67E8F9' }, // blue to cyan
  weeks: { from: '#D946EF', to: '#F472B6', text: '#F9A8D4' }, // magenta to pink
  wins: { from: '#F59E0B', to: '#FB923C', text: '#FCD34D' }, // amber to orange
} as const;
export type PartLabel = keyof typeof PART_COLORS;
export type Hue = { from: string; to: string; text?: string };

/** A flat block that opens with a hairline (Panel.tsx SURFACE); kept for the profile's callers. */
export { SURFACE } from '../components/common/Panel';

export const SCORE_COLORS = {
  /** The hero ring: white to the accent blue. */
  total: { from: '#FFFFFF', to: THEME.accent } as Hue,
  /** A ring's empty track: thin and dim. */
  track: THEME.track,
  /** The page behind everything (black). */
  page: THEME.page,
  /** A flat surface; both stops are the same colour so the ring's backdrop stays flat. */
  surfaceTop: THEME.surfaceTop,
  surface: THEME.surface,
  /** Text: primary, and the muted grey for secondary lines and labels. */
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
