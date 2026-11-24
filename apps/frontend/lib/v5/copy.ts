/**
 * v3.8 E14: the builder lines that v3.8's copy pass rewrites (plan 23.4, the delegable asks of 23.3 rule 4), in one
 * table, so a later change can swap the table behind a flag without touching the tools. `COPY_V37` is every line
 * exactly as it was: moving a line here changes no string (the frozen-string tests are the check). Read with `copy()`
 * at call time, never at import, so the table in use can depend on the request. Pure constants and templates.
 */
export const COPY_V37 = {
  // find.ts
  /** The open list's closing, no project (`OPEN_ASK`). */
  openAsk: 'Tell me what you build, or its repo link, and I match it.',
  /** The same with only a project name. */
  describeName: (name: string): string => `Tell me what ${name} does in a line, or its repo link, and I match it.`,
  /** One open online program, no project (`NO_PROJECT_ONE`). */
  noProjectOne: 'Tell me what you build, or its repo link, and I check the fit.',
  /** A closed program's own reply, not sent here (`CLOSED_ONE`), and with a project (`CLOSED_PROJECT_ONE`). */
  closedOne: 'It is closed; say its name again when it reopens, or tell me about your project and I find what is open.',
  closedProjectOne: 'It is closed; say its name again when it reopens, or ask me what is open for this project.',
  /** The not-your-repo gate's closing with nothing to draft (`SAY_WHICH_REPO`). */
  sayWhichRepo: 'Say which repo is yours.',
  // reply.ts
  /** The one-program ask when the row lists several rules (`RULES_ACTION`). */
  rulesAction: 'Say yes if all of that is you and I draft it.',
  /** The users question and a change in one yes (`doUsersClosing`). */
  doUsersClosing: (verb: string, title: string): string => `Nothing is ready yet. Do real people use it? Say yes and I ${verb}, then apply to ${title}.`,
  /** The users question, unlinked (`USERS_UNLINKED`, `USERS_UNLINKED_APPLY`, `usersUnlinkedAt`). */
  usersUnlinked: 'Do real people use it? Say yes, sign in, and I check.',
  usersUnlinkedApply: 'Do real people use it? Say yes, sign in, and I apply.',
  usersUnlinkedAt: (link: string, then: 'check' | 'apply'): string => `Do real people use it? Say yes, sign in at ${link}, and I ${then}.`,
  /** The users question, linked: a check follows, or the yes makes the program ready. */
  usersCheck: 'Do real people use it? Say yes and I check.',
  usersApply: 'Do real people use it? Say yes and I apply.',
  /** The demo video step's closing (`DEMO_CLOSING`). */
  demoClosing: 'Send me the demo video link and I fill it in.',
  /** The started question's closing (`STARTED_CLOSING`). */
  startedClosing: 'Tell me when you started and I check it.',
  /** The sent question's Say, one form and several. */
  sentSay: 'Say sent and I note it.',
  sentManySay: 'Say which you sent and I note them.',
  /** The results question for a program past its results date (`outcomeLines`); `due` is `dayWords`. */
  outcomeAsk: (title: string, due: string): string => `Results for ${title} were due ${due}. Did you hear back?`,
  /** The whole reply when nothing fits (`nothingFits`). */
  nothingFits: (name?: string | null): string => `Nothing fits${name ? ` ${name}` : ''} yet. Tell me more about it, or its repo link, and I look again.`,
  // track.ts and ledger.ts
  /** A join with no repo known. */
  joinRepoAsk: 'Tell me the repo link and I join them.',
  /** gap_done with no item on a named program (`WHICH_CHANGE_ON`), and with none named (`WHICH_CHANGE`). */
  whichChangeOn: (title: string): string => `Which change did you finish on ${title}?`,
  whichChange: 'Which change did you finish? Say the program and the change.',
  /** gap_done on a code item with no repo to check. */
  tellWhenLive: 'Tracked. Tell me when it is live and I look again.',
  /** A skip of a program already skipped. */
  alreadySkipped: 'Already skipped.',
  /** A win recorded (`wonText` is the amount in the one money format). */
  won: (wonText: string, title: string): string => `Tracked: ${wonText} from ${title}.`,
  /** A win with no amount above 0 (`WHOLE_DOLLARS`). */
  wholeDollars: 'Tell me how much you won.',
  /** gap_done on the rules a Next line named (`NEXT_NOTED`). */
  nextNoted: 'Noted; I apply now.',
  /** What the next ready program still needs from the record (`NEXT_LACKS`). */
  nextLacks: (l: { title: string; needs: string[] }): string => `${l.title} is next; it needs ${l.needs.slice(0, 2).join(' and ')} first.`,
  // lib/v6/record-tool.ts and lib/v6/screen-tool.ts
  /** record set, unlinked with a sign-in link. */
  notSavedSignIn: (link: string): string => `Not saved. Sign in once at ${link}, then tell me again.`,
  /** A queued screen: how many, the program, how many were already queued, then the results promise. */
  screenQueued: (applicants: string, title: string, already: number, promise: string): string =>
    `Queued ${applicants} for ${title}${already > 0 ? `; ${already} already queued` : ''}. ${promise}`,
};

export type CopyTable = typeof COPY_V37;

/** The copy table in use. One table today; read at call time. */
export const copy = (): CopyTable => COPY_V37;
