/**
 * Pure words shared by the find reply and the record tool: the list joiner, the sign-in line and the
 * problem name for an own-evidence read that failed. No database, no imports.
 */
export const EVIDENCE_NOT_READ = 'evidence not read';

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". Pure. */
export function listWords(items: string[], max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** Unlinked, a program whose tier bar the repo read alone does not clear: the one change that settles it. */
export const CONFIRM_LIVE = 'Link GitHub so EarnKit can confirm your product is live.';

/** The one line that offers the link. Pure. */
export const signInLine = (link: string) => `Sign in once at ${link} so I remember you across agents.`;
