import { THEME } from '../../lib/earnkit/theme';

/**
 * profile-whoop v2 (v4: on the deep-blue THEME, lib/earnkit/theme.ts): the profile's premium palette. Each score keeps one hue family everywhere it
 * shows: its ring's gradient (`from` to `to`, along the stroke), its soft glow, and `text`, the one
 * solid color its label is set in (4.5:1 or more on the page and the card surface, tested). The total
 * is white to soft grey: it is the sum, not a fifth score.
 */
export const PART_COLORS = {
  Shipped: { from: '#3B82F6', to: '#22D3EE', text: '#67E8F9' }, // blue to cyan (v4: a brighter start, so it reads on navy)
  Used: { from: '#818CF8', to: '#A78BFA', text: '#C4B5FD' }, // indigo to violet
  Earned: { from: '#F59E0B', to: '#FB923C', text: '#FCD34D' }, // amber to orange
  Consistency: { from: '#D946EF', to: '#F472B6', text: '#F9A8D4' }, // magenta to pink
} as const;
export type PartLabel = keyof typeof PART_COLORS;
export type Hue = { from: string; to: string; text?: string };

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
 * One plain sentence per score, from the published formula (lib/earnkit/score-v2.ts). Never a
 * promise: what counts, not what it predicts.
 */
export const PART_WORDS: Record<PartLabel, string> = {
  Shipped: 'Projects confirmed live. The first one counts most.',
  Used: 'Other people using what you shipped, newest use counting most.',
  Earned: 'Fees and prizes your project has earned.',
  Consistency: 'Weeks with shipped code, recent weeks counting most.',
};

/**
 * profile-whoop v2 (the feed): which score a fact chip speaks to, so the premium pages tint it in
 * that score's hue. A ship (live, commits) is Shipped; people are Used; money and wins are Earned;
 * streaks and weeks are Consistency; anything else (the Community round chip) stays neutral. Pure.
 */
export function chipHue(chip: string): PartLabel | null {
  if (/^(Went live|Live)$|\bcommits?$/.test(chip)) return 'Shipped';
  if (/^\+\d[\d,]* (person|people)$|\b(person uses|people use) it$/.test(chip)) return 'Used';
  if (/ earned$|^Won /.test(chip)) return 'Earned';
  if (/\bweeks? in a row$|\bweeks? shipping$|^Started tracking$/.test(chip)) return 'Consistency';
  return null;
}

