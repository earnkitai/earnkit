/**
 * profile-whoop: each score keeps one color everywhere it shows (its ring, its label mark, the
 * grid for Consistency). All are brand tokens (DESIGN.md) and read 4.5:1 or more on the panel.
 * The total is white: it is the sum, not a fifth score.
 */
export const PART_COLORS = {
  Shipped: '#579DFF', // ek-blue-bright
  Used: '#9B6BFF', // ek-score-purple
  Earned: '#FC9E19', // ek-amber
  Consistency: '#D76CEF', // ek-pink
} as const;
export type PartLabel = keyof typeof PART_COLORS;

export const SCORE_COLORS = {
  total: '#F6F9FE', // ek-white
  /** The ring's empty track: the panel lifted a little. */
  track: 'rgba(163, 197, 254, 0.10)',
  /** The profile panel (ek-navy-deep). */
  panel: '#0F1839',
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
