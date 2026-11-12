/**
 * Pure words shared by the find reply and the record tool: the list joiner, the sign-in line and the
 * problem name for an own-evidence read that failed. No database, no imports.
 */
export const EVIDENCE_NOT_READ = 'evidence not read';
/** The problem a linked find carries when the record holds projects and none is this one (v6.1.8 C41). */
export const NO_RECORD_PROJECT = 'no record project matched';

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". Pure. */
export function listWords(items: string[], max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

const CONFIRM: Record<'used' | 'live' | 'building', string> = { used: 'real people use it', live: 'your product is live', building: 'your project has code' };

/** Unlinked, a program whose tier bar the repo read alone does not clear: what is missing, naming the bar (R3b). It is
 *  one of the program's gaps; the sign-in that settles it is asked once, in the reply's closing (v6.1.14). Pure. */
export const confirmLine = (min: 'used' | 'live' | 'building') => `proof that ${CONFIRM[min]}.`;

/** Linked, with no tier of the builder's own yet (a private repo, a failed read, the 24-hour window): the bar's line,
 *  since the builder has already signed in (v6.1.8 final fix, I2). Pure. */
export const PROOF_READING = 'Your proof is still being read; ask again in a minute.';
/** Linked, with no project in the record matching the find (I2 nuance, v6.1.9): the bar's line names the step that
 *  lets EarnKit read the proof. Pure. */
export const ADD_PROJECT = 'Add this project to your record so EarnKit can read its proof.';
/** Whether a gap's words are a linked bar line (PROOF_READING or ADD_PROJECT) without its full stop. Pure. */
export const isProofReadingWhat = (what: string): boolean => `${what}.` === PROOF_READING || `${what}.` === ADD_PROJECT;

/** Whether a gap's words are a confirmLine without its full stop (the unlinked tier gap). Pure. */
export const isConfirmWhat = (what: string): boolean => confirmBar(what) !== null;
/** The bar a confirmLine's words name (without its full stop), null for any other words. Pure. */
export const confirmBar = (what: string): ProofBar | null => (Object.keys(CONFIRM) as ProofBar[]).find((k) => confirmLine(k) === `${what}.`) ?? null;
export type ProofBar = keyof typeof CONFIRM;

/** L1j-6 (v6.1.17): what the sign-in checks, by the bar the proof gap names: never a bare "that". */
const CHECKS: Record<ProofBar, string> = { used: 'your users', live: 'your product is live', building: 'your project has code' };

/** The one line that offers the link (the record tool and find's open list). Pure. */
export const signInLine = (link: string) => `Sign in once at ${link} so I remember you across agents.`;

/** Unlinked find (R5a): the sign-in sentence of the closing block; saying yes stays the one action. With a proof gap
 *  shown (`proof`, v6.1.14) it is the one sign-in ask: after a repo read it names what it checks by the gap's bar (L1j-6,
 *  v6.1.17: "I check your users", never a bare "that"; `true` reads as the users bar), else it promises only to remember
 *  (R19). With no link to give (`link` null: linkOf failed, or after the account was deleted), only the proof shape is
 *  said, linkless: "Sign in once and I check your users." or "Sign in once and I remember you." (fix round 1). Pure. */
export function signInSentence(link: string | null, repoRead: boolean, proof: boolean | ProofBar = false): string {
  const checks = CHECKS[proof === true || proof === false ? 'used' : proof];
  if (link === null) return repoRead ? `Sign in once and I check ${checks}.` : 'Sign in once and I remember you.';
  if (proof) return repoRead ? `Sign in once at ${link} and I check ${checks} and remember you.` : `Sign in once at ${link} and I remember you.`;
  return repoRead ? `Sign in once at ${link} and I read your repo for proof and remember you.` : `Sign in once at ${link} and I remember you across agents.`;
}

/** The first find after a link (security M2): the account this agent now writes to, and where to undo it. Pure. */
export const linkedNoticeLine = (login: string) => `This agent is now linked to GitHub account ${login}. Unlink any time at earnkit.com/me.`;

/** The first find after the builder unlinked this agent on /me (v6.1.7 B10); it carries the sign-in link when there is one. Pure. */
export const unlinkedNoticeLine = (link: string | null) =>
  link ? `This agent was unlinked from your account. Sign in once at ${link} to link it again.` : 'This agent was unlinked from your account.';

/** The first call after the builder deleted their account on /me, from an agent that was linked to it (v6.1.8 C51). Pure. */
export const DELETED_NOTICE = 'Your record was deleted at earnkit.com/me; this agent is unlinked.';
