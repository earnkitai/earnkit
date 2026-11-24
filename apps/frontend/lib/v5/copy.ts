/**
 * v3.8 E14: the builder lines that v3.8's copy pass rewrites (plan 23.4, the delegable asks of 23.3 rule 4), in one
 * table, so a later change can swap the table behind a flag without touching the tools. `COPY_V37` is every line
 * exactly as it was: moving a line here changes no string (the frozen-string tests are the check). Read with `copy()`
 * at call time, never at import, so the table in use can depend on the request. Pure constants and templates.
 *
 * v3.8 E15: `COPY_V38` is the new copy (plan 23.3 to 23.5), used when `copy_v38` is on. It never asks the builder for
 * what EarnKit or their agent can find: the agent notes (`...Note` keys, empty in `COPY_V37` so main's notes are
 * unchanged) tell the agent to find it and to ask only when it is not public.
 */
import { flagOn } from './flags';

export const COPY_V37 = {
  // find.ts
  /** The open list's closing, no project (`OPEN_ASK`). */
  openAsk: 'Tell me what you build, or its repo link, and I match it.',
  /** The same, signed in (v3.8 E15: main has one line for both). */
  openAskLinked: 'Tell me what you build, or its repo link, and I match it.',
  /** v3.8 E15: the agent's part of the open and no-project closings (main: none). */
  openNote: '',
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
  /** The users lookup closing on one program (`usersLookup`): `question` is the users-and-rule question's rule part. */
  usersLookup: (o: { rule: string | null; linked: boolean; link: string | null; then: string }): string =>
    `${o.rule ? `Do real people use it, and ${o.rule}?` : 'Do real people use it?'} ${o.linked ? `Say yes and I ${o.then}.` : `Say yes, sign in${o.link ? ` at ${o.link}` : ''}, and I ${o.then}.`}`,
  /** The agent note's lead on the users question. */
  usersNoteLead: '"Do real people use it" is a question, not work: ask the builder once.',
  /** v3.8 E15: the one-program reply's users note lead (main: none). */
  usersOneNote: '',
  /** The users question, linked: a check follows, or the yes makes the program ready. */
  usersCheck: 'Do real people use it? Say yes and I check.',
  usersApply: 'Do real people use it? Say yes and I apply.',
  /** The demo video step's closing (`DEMO_CLOSING`). */
  demoClosing: 'Send me the demo video link and I fill it in.',
  /** The agent note on a demo video gap (`DEMO_NOTE`). */
  demoNote: 'A demo video gap takes a link: when the builder sends it, pass it as project.demo_url and call find again.',
  /** The started question's closing (`STARTED_CLOSING`) and its agent note. */
  startedClosing: 'Tell me when you started and I check it.',
  startedNote: '"Tell me when you started this" is a question, not work: ask the builder once; pass first_commit_at in the project next time, or, when they started after the program\'s start, call track with gap_done and that gap\'s item. Never invent the date.',
  /** The sent question's Say, one form and several. */
  sentSay: 'Say sent and I note it.',
  sentManySay: 'Say which you sent and I note them.',
  /** The no-project open list's one closing Say that carries the sent answer and the action. */
  sentOr: (n: number, action: string): string => `Say ${n === 1 ? 'sent' : 'which you sent'}, or ${action}`,
  /** The results question for a program past its results date (`outcomeLines`); `due` is `dayWords`. */
  outcomeAsk: (title: string, due: string): string => `Results for ${title} were due ${due}. Did you hear back?`,
  /** The agent note on the results questions. */
  outcomeNote: (titles: string[]): string => `The reply asks how each went: ${titles.join(', ')}. Pass each answer to track (won with amount_usd, rejected or no_result).`,
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
  tellWhenLiveNote: 'When the builder says it is live, call find again with its repo or live link.',
  /** A skip of a program already skipped. */
  alreadySkipped: 'Already skipped.',
  /** A win recorded (`wonText` is the amount in the one money format). */
  won: (wonText: string, title: string): string => `Tracked: ${wonText} from ${title}.`,
  /** A win with no amount above 0 (`WHOLE_DOLLARS`). */
  wholeDollars: 'Tell me how much you won.',
  /** v3.8 E15: its agent note (main: none). */
  wholeDollarsNote: '',
  /** track: the agent's amount arguments were malformed (`TELL_AMOUNT`) or unreadable (`AMOUNT_UNREAD`). */
  tellAmount: 'Tell me the amount.',
  amountUnread: 'Tell me the amount as a number, like 5000 for $5,000.',
  /** A win under one dollar, in US dollars or another currency (`underADollarLine`). */
  underADollar: (currency: string): string =>
    currency.trim().toUpperCase() === 'USD' ? 'Tell me the amount, 1 dollar or more.' : 'That amount is too small to record. Tell me the amount and its currency.',
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

/** v3.8 E15: the words every v3.8 users line carries, for the line checks that read the users question. */
export const USERS_V38 = /I'll check whether real people use it/;

export type CopyTable = typeof COPY_V37;

const FIND_IT = 'Ask the builder only when it is not public.';

/**
 * v3.8 E15: the new copy (plan 23.3 style rules, 23.4 before and after, 23.5 next ideal state). Short, plain, one next
 * step, no semicolons or dashes, and no ask for anything EarnKit or the agent can find or decide. Each delegable ask's
 * fix is pinned by `copy-v38.test.ts`.
 */
export const COPY_V38: CopyTable = {
  // Ask 1: what you build or its repo link. Signed out the one ask is sign-in, signed in the agent passes the project.
  openAsk: "Sign in and I'll look at what you build and show you what you can apply to.",
  openAskLinked: "Next I'll check the project you're in and show you what fits.",
  openNote: 'Call find with the project you are in: its repo_url and every fact you can read. Ask the builder what they build only when no project is open.',
  // Ask 2: a project name with no repo.
  describeName: (name: string) => `Next I'll read ${name} and show you what fits.`,
  // Ask 3: one program with no project.
  noProjectOne: "Next I'll check your project against it and tell you if it fits.",
  // Ask 4: say its name again when it reopens.
  closedOne: "It's closed. If it reopens, it'll show up in your list again.",
  closedProjectOne: "It's closed. If it reopens, it'll show up in your list again.",
  // Ask 5: which repo is yours (the signed-in account's repos are readable).
  sayWhichRepo: "I'll use a repo your signed-in account owns instead.",
  rulesAction: "If all of that's true for you, say yes and I'll draft it.",
  // Ask 6: do real people use it, signed in. Ask 7: the same signed out, where the one ask is sign-in.
  doUsersClosing: (verb: string, title: string) => `Nothing is ready yet. Say yes and I'll ${verb}, check it has real users, then apply to ${title}.`,
  usersUnlinked: "Sign in and I'll check whether real people use it.",
  usersUnlinkedApply: "Sign in and I'll check whether real people use it, then apply if they do.",
  usersUnlinkedAt: (link: string, then: 'check' | 'apply') => `Sign in here: ${link}. Then I'll check whether real people use it${then === 'apply' ? ', and apply if they do' : ''}.`,
  usersLookup: (o) => {
    const rule = o.rule ? ` ${o.rule.charAt(0).toUpperCase()}${o.rule.slice(1)}? Say yes and I'll ${o.then}.` : '';
    if (!o.linked) return o.link ? `Sign in here: ${o.link}. Then I'll check whether real people use it.${rule}` : `Sign in and I'll check whether real people use it.${rule}`;
    return rule ? `I'll check whether real people use it.${rule}` : `I'll check whether real people use it, then ${o.then === 'check' ? 'look again' : o.then} if they do.`;
  },
  usersNoteLead: 'Real users: check them yourself from what you can read (the live site, public analytics, on-chain activity, downloads, dependents). When you see real use, call find again with users: true. Ask the builder only if none of that is readable.',
  usersOneNote: 'Real users: check them yourself from what you can read (the live site, public analytics, on-chain activity, downloads, dependents). When you see real use, call find again with users: true. Ask the builder only if none of that is readable.',
  usersCheck: "I'll check whether real people use it.",
  usersApply: "I'll check whether real people use it, then apply if they do.",
  // Ask 8: the demo video link.
  demoClosing: "I'll look for a public demo video and add it.",
  demoNote: `A demo video gap: find a public demo video (the README, the project site, YouTube, X), pass it as project.demo_url and call find again. ${FIND_IT}`,
  // Ask 9: when you started.
  startedClosing: "I'll check when you started from the repo's first commit.",
  startedNote: `The started question is yours: read the repo's first commit date and pass first_commit_at in the project, or, when it is after the program's start, call track with gap_done and that gap's item. Never invent the date. Ask the builder only when there is no repo.`,
  // Not delegable (only the builder knows whether they pressed submit), reworded: 23.7 bans "Say sent".
  sentSay: "Say yes if it went and I'll mark it sent.",
  sentManySay: "Say which went and I'll mark them sent.",
  sentOr: (n: number, action: string) => `Say ${n === 1 ? 'yes if it went' : 'which went'}, or ${action}`,
  // Ask 10: did you hear back.
  outcomeAsk: (title: string, due: string) => `${title} was due to announce results ${due}. I'll check for them.`,
  outcomeNote: (titles: string[]) => `Check each program's results page or announcement: ${titles.join(', ')}. Call track won with the amount, rejected or no_result for each. ${FIND_IT}`,
  // Ask 11: more about it, or its repo link.
  nothingFits: (name?: string | null) => `Nothing fits${name ? ` ${name}` : ''} yet. I'll show you new programs as they open.`,
  // Ask 12: the repo link to join a project.
  joinRepoAsk: "I'll find the repo and join them.",
  // Ask 13: which change did you finish (the agent has the items).
  whichChangeOn: (title: string) => `I'll match that to the right step on ${title}.`,
  whichChange: "I'll match that to the right program and step.",
  // Ask 14: tell me when it is live.
  tellWhenLive: "Tracked. I'll look for it live next time.",
  tellWhenLiveNote: `Find the live link yourself (the repo's homepage, README or deploy) and call find again with it. ${FIND_IT}`,
  alreadySkipped: "That one's already skipped. Say unskip if you want it back.",
  won: (wonText: string, title: string) => `${title} paid ${wonText}. It's on your record.`,
  // Ask 15: how much you won (public in the announcement).
  wholeDollars: "I'll find the amount on their announcement, then record the win.",
  wholeDollarsNote: `Find the amount on the program's announcement or winners page and call track won again with it. ${FIND_IT}`,
  tellAmount: "I couldn't read that amount. I'll check it against their announcement, then record the win.",
  amountUnread: "I couldn't read that amount. I'll check it against their announcement, then record the win.",
  underADollar: () => "That's under a dollar. I'll check the amount against their announcement before I record it.",
  nextNoted: 'Got it. Sending it now.',
  nextLacks: (l: { title: string; needs: string[] }) => `${l.title} is next. It still needs ${l.needs.slice(0, 2).join(' and ')} from you.`,
  notSavedSignIn: (link: string) => `I couldn't save that yet. Sign in once here: ${link}. Then tell me again and it'll stick.`,
  screenQueued: (applicants: string, title: string, already: number, promise: string) =>
    `${applicants.startsWith('1 ') ? 'Got' : 'Got all'} ${applicants} for ${title}${already > 0 ? `, ${already} were already queued` : ''}. ${promise} Ask me any time to see how far it's got.`,
};

/** The copy table in use: `COPY_V38` with `copy_v38` on, else main's. Read at call time. */
export const copy = (): CopyTable => (flagOn('copy_v38') ? COPY_V38 : COPY_V37);
