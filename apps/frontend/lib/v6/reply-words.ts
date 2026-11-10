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

const CONFIRM: Record<'used' | 'live' | 'building', string> = { used: 'real people use it', live: 'your product is live', building: 'your project has code' };

/** Unlinked, a program whose tier bar the repo read alone does not clear: the one step that settles it, naming the bar
 *  (R3b); in a find it stands alone after the program's gaps (v6.1.8, C57). Pure. */
export const confirmLine = (min: 'used' | 'live' | 'building') => `Sign in once so EarnKit can confirm ${CONFIRM[min]}.`;

/** Whether a gap's words are a confirmLine without its full stop (the unlinked tier gap). Pure. */
export const isConfirmWhat = (what: string): boolean => (Object.keys(CONFIRM) as (keyof typeof CONFIRM)[]).some((k) => confirmLine(k) === `${what}.`);

/** The one line that offers the link (the record tool and find's open list). Pure. */
export const signInLine = (link: string) => `Sign in once at ${link} so I remember you across agents.`;

/** Unlinked find (R5a): the second sentence of the closing block; saying yes stays the one action. With no repo read
 *  (R19) it promises only to remember. Pure. */
export const signInSentence = (link: string, repoRead: boolean) =>
  repoRead ? `Sign in once at ${link} and I read your repo for proof and remember you.` : `Sign in once at ${link} and I remember you across agents.`;

/** The first find after a link (security M2): the account this agent now writes to, and where to undo it. Pure. */
export const linkedNoticeLine = (login: string) => `This agent is now linked to GitHub account ${login}. Unlink any time at earnkit.com/me.`;

/** The first find after the builder unlinked this agent on /me (v6.1.7 B10); it carries the sign-in link when there is one. Pure. */
export const unlinkedNoticeLine = (link: string | null) =>
  link ? `This agent was unlinked from your account. Sign in once at ${link} to link it again.` : 'This agent was unlinked from your account.';
