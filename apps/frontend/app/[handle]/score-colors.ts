/**
 * profile-whoop v2: the profile's premium dark palette. Each score keeps one hue family everywhere it
 * shows: its ring's gradient (`from` to `to`, along the stroke), its soft glow, and `text`, the one
 * solid color its label is set in (4.5:1 or more on the page and the card surface, tested). The total
 * is white to soft grey: it is the sum, not a fifth score.
 */
export const PART_COLORS = {
  Shipped: { from: '#2563EB', to: '#22D3EE', text: '#67E8F9' }, // deep blue to cyan
  Used: { from: '#6366F1', to: '#A78BFA', text: '#C4B5FD' }, // indigo to violet
  Earned: { from: '#F59E0B', to: '#FB923C', text: '#FCD34D' }, // amber to orange
  Consistency: { from: '#C026D3', to: '#F472B6', text: '#F9A8D4' }, // magenta to pink
} as const;
export type PartLabel = keyof typeof PART_COLORS;
export type Hue = { from: string; to: string; text?: string };

export const SCORE_COLORS = {
  /** The hero ring: white to soft grey. */
  total: { from: '#FFFFFF', to: '#9CA3AF' } as Hue,
  /** A ring's empty track: thin and dim. */
  track: 'rgba(255, 255, 255, 0.07)',
  /** The page behind everything (near-black). */
  page: '#0B0B0F',
  /** A card surface: a soft top-down gradient between these two. */
  surfaceTop: '#17191F',
  surface: '#111318',
  /** Text: primary, and the muted grey for secondary lines and labels. */
  text: '#F5F6F8',
  muted: '#9BA1AC',
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
