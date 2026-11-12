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

/** L38-4 (v6.1.18): the users bar reads "real users", the one wording of the users gap. */
const CONFIRM: Record<'used' | 'live' | 'building', string> = { used: 'of real users', live: 'that your product is live', building: 'that your project has code' };

/** Unlinked, a program whose tier bar the repo read alone does not clear: what is missing, naming the bar (R3b). It is
 *  one of the program's gaps; the sign-in that settles it is asked once, in the reply's closing (v6.1.14). Pure. */
export const confirmLine = (min: 'used' | 'live' | 'building') => `proof ${CONFIRM[min]}.`;

/** Linked, with no tier of the builder's own yet (a private repo, a failed read, the 24-hour window): the bar's line,
 *  since the builder has already signed in (v6.1.8 final fix, I2). Pure. */
export const PROOF_READING = 'Your proof is still being read; ask again in a minute.';
/** Linked, with no project in the record matching the find (I2 nuance, v6.1.9): the bar's line names the step that
 *  lets EarnKit read the proof. Pure. */
export const ADD_PROJECT = 'Add this project to your record so EarnKit can read its proof.';
/** L36-7 (v6.1.18): a usage bar with no record project says the bar first, then the record step. Pure. */
export const ADD_PROJECT_USED = (users: number): string =>
  `Needs about ${users} outside users in 90 days; I count 0 so far. Add this project to your record and I read its proof.`;
/** Whether a gap's words are a linked bar line (PROOF_READING, ADD_PROJECT or ADD_PROJECT_USED) without its full stop. Pure. */
export const isProofReadingWhat = (what: string): boolean =>
  `${what}.` === PROOF_READING || `${what}.` === ADD_PROJECT || /^Needs about [\d,]+ outside users in 90 days; I count 0 so far\. Add this project to your record and I read its proof$/.test(what);

/** Whether a gap's words are a confirmLine without its full stop (the unlinked tier gap). Pure. */
export const isConfirmWhat = (what: string): boolean => confirmBar(what) !== null;
/** The bar a confirmLine's words name (without its full stop), null for any other words. Pure. */
export const confirmBar = (what: string): ProofBar | null => (Object.keys(CONFIRM) as ProofBar[]).find((k) => confirmLine(k) === `${what}.`) ?? null;
export type ProofBar = keyof typeof CONFIRM;

/**
 * L38 big 1 (v6.1.18 Task 10): a sign-in is said only when the reply's one action needs it, and then inside that
 * action's line, first: the repo check a program's proof waits on ("Sign in at {link} so I can check the repo, then
 * ..."). With no link to give (linkOf failed, or after the account was deleted) the same words without one. No sign-in
 * sentence promises to remember the builder. Pure.
 */
export const signInCheck = (link: string | null): string => (link ? `Sign in at ${link} so I can check the repo` : 'Sign in so I can check the repo');
/** A sentence's first letter lowered (never the pronoun "I"), so an action reads after "then". Pure. */
export const lowerFirst = (x: string): string => (/^I\b/.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1));
/** L38 big 1: the sign-in first, then the action it waits on, as one sentence ("..., then say yes and I draft it."). Pure. */
export const signInThen = (signIn: string, action: string): string => `${signIn}, then ${lowerFirst(action)}`;
/** L38 big 1: the one action of a proof that is the only step left: sign in, and EarnKit reads it again. Pure. */
export const signInLookAgain = (link: string | null): string => signInThen(signInCheck(link), 'I look again.');

/** The first find after a link (security M2): the account this agent now writes to, and where to undo it. Pure. */
export const linkedNoticeLine = (login: string) => `This agent is now linked to GitHub account ${login}. Unlink any time at earnkit.com/me.`;

/** The first find after the builder unlinked this agent on /me (v6.1.7 B10); it carries the sign-in link when there is one. Pure. */
export const unlinkedNoticeLine = (link: string | null) =>
  link ? `This agent was unlinked from your account. Sign in once at ${link} to link it again.` : 'This agent was unlinked from your account.';

/** The first call after the builder deleted their account on /me, from an agent that was linked to it (v6.1.8 C51). Pure. */
export const DELETED_NOTICE = 'Your record was deleted at earnkit.com/me; this agent is unlinked.';
