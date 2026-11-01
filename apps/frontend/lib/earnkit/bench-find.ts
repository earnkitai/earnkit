import { sql } from './db';
import { noteEvent } from './events';
import { enqueueDiscovery } from './discovery';
import { ensureProfile } from './profiles';
import { getProgramRow, listPrograms } from './programs';
import { SENT_ASK, submitKit } from './submit-kit';
import { isRealAnswer } from './submission';
import { openEntries } from './projects';
import { hiddenIds, hiddenPrograms, readMemory } from './builder-memory';
import { recordShown } from './match-loop';
import { REPO_KEY, benchConfirmedSql, rankRepo } from './main-project';
import { installLink, pickLink, proveCovered, repoProof } from './repo-proof';
import { REPLY_WAIT_MS, settleWithin } from './reply-wait';
import { rankLines, type RankLines } from './bench-rank';
import { readFitRepos } from './installations';
import { UPDATE_LINES, setShipTitles, takeTitlesAsk, titlesAskDue } from './updates';
import { grantOf, liveOrUsersKnown, qualifyOffer } from './base-qualify';
import { earnedUsd } from './earned';
import { NEEDS_LIVE_PRODUCT } from './guide';
import { signInLink } from './x-link';
import { xSignInEnabled } from './builder-score-flag';
import { outcomeLine } from './outcomes';
import { ANSWER_FIRST_NOTE, EARN_NOTE, NOTED_LINE, newsOpener } from './stand-text';
import {
  FITS_MAX, fundWhen, scoreFits, showable, standBase, startRefresh, takeNews,
  type Seen as StandSeen, type StandBase,
} from './stand-view';
import { moneyText, openMoneyUsd, usdCompact } from './pool';
import { byDeadline, byRelevance, canApply, enteredIds, fullProgramTable, layout, noFitLine, submitStep, submitStepLine, type Card, type FirstMessage, type RepoFit, type YourRepos } from './present';
import type { ReaderDeps } from './source-readers';
import { NO_USERS_YET, creditsMainnet, type Detection } from './match';
import { refKey, reportedName } from './project-name';
import { noteIdentity, projectKeyOf, type IdentityProject } from './identity-input';
import type { ToolContext } from './tools';
import { CHAIN_NAMES, type Chain } from './chains';
import {
  APPLY_WINDOW_DAYS, withWhy, BASE_START_ASK, CHECKIN_ASK, CHECKIN_WHY, askWhy, bestFitWhy, closestWhy, CHECKIN_ON, NEXT_STEP_LATER, SHIP_ASK_DAYS, NEXT_STEP_ASK, STALE_WEEKS, STATE_COPY, TEMPLATE_NOTICE, TITLES_ASK, TITLES_NO_LINE, awardAmount, baseStartSteps, benchReply, NO_GITHUB_HINT, builtWith, liveNoGithub, namesAccount, benchStepKey, qualifySteps, rankedState, replyState, stateAsk, standingLine, walletOffer, walletSetupAsk, welcomeFits,
  TOKEN_NO_LINE, STRIPE_NEVER_KEY, needsWhy, qualifyGap, qualifyGapSteps, STRIPE_NO_LINK, stripeConnectLine, QUALIFY_HELP_ASK_ONE, QUALIFY_CODES_CHECK_NOTE, QUALIFY_CODES_NOTE, qualifyCodesYes, type AlsoOpen,
  type FitBar, fitBar, keyName, type QualifyOffer, type QualifyStep, type BenchAskKind, type BenchProject, type BenchView, type BestFit, type ConnectOffer, type FundLine, type MomentView, type OpenGrant, type Variant,
} from './bench-reply';
import { liveSite, type LiveSite } from './live-check';
import { MORE_NOTE, NAME_NOTE, EXISTING_NOT_TOKEN, TOKEN_OFFER, TOKEN_OFFER_QUESTION, TOKEN_ON_ITS_WAY, WALLET_SETUP_SKIPPED, existingTokenLine, setupTokenOffer, displayName, firstName, isStep2, setupDoneLead, setupDoneReply, type ProgramRow, type SetupOutcome } from './bench-reply';
import { targetIn, weeklyTarget } from './weekly-target';
import { APPROVED_LINE, SHARE_NOTE, answerShare, lastWeekOf, markOffered, momentDue, momentSummary, momentPlace, momentReady, openShare, takeMoment, weekNumber } from './weekly-moment';
import { isoWeekOf } from './weeks';
import { weekCommunityUsd } from './community';
import { streakOfBuilder, streaksFor } from './streak';
import { publicRow } from './builder-score';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { personal, readStanding, standingLeads, standingParagraph, streakOnly, toldAppliedSql, type Standing } from './standing';
import { OUTCOME_SHARE_NOTE, claimNudge, outcomeShareLine, pickNudge, type NudgePick } from './nudges';
import {
  CONNECT_DONE, CONNECT_NOTE, CONNECT_RETRY, answerConnect, backfillComplete, closeConnect, connectApplyAsk, connectDue, connectWeeks, openConnect,
  type ConnectBest,
} from './connect-moment';
import { POST_NOTE, eventPost, redraftAnswer, weeklyPost } from './post-reply';
import { EMAIL_NOTE, WHICH_EMAIL, askWeeklyEmail, digestEnabled, saveWeeklyEmail } from './digest';
import { pagePath, pageUrl } from './reserved-routes';
import { rankWords } from './rank';
import { prizeOf, shortWallet, siteUrl, upToCell } from './entry-text';
import { programKind } from './site-copy';
import { BASE_GRANTS_ID } from './builder-code';
import { appProvenRepo, builderCodesKnown, builderCodesWords, checkBuilderCodes, codesSettled, refreshBuilderCodes, storedBuilderCode } from './builder-codes-check';
import { projectKey, readBank } from './answer-bank';
import { bankFill } from './coach';
import type { SubmissionRequirement } from './program-file';
import { WALLET_NOTE, type WalletAnswer, answerWallet, takeWalletAsk, takeWalletNotice, tokenOffered, walletChangeReply, walletOfferDue, walletSetupDue, walletSetupNote, takeTokenOffer, tokenOfferDue } from './wallet-offer';
import { builderToken, builderTokensOn, declineBuilderToken, launchBuilderToken, recordExistingToken, reopenDeclinedToken, tradeUrl, type LaunchResult } from './builder-token';
import { TOKEN_EXPLAINER, TOKEN_OFF, tokenAnswerFor, tokenAnswerState, tokenAnswerText } from './token-answers';
import { provenWallet } from './wallet-proof';
import { stripeLink } from './stripe';
import { agentReach, rememberNoFolder, type AgentReach } from './agent-reach';
import { DECLINE_MS, draftedRecently } from './policy-constants';
import { closeDay, programZone, zoneAbbr } from './deadline';
import type { ProgramRow as ProgramFileRow } from './programs';
import {
  MENTOR_NOTE, OLDER_SAID, OPENER_NOTE, SESSION_MS, bestMove, connectedLine, pickHook, investorLater, noFitWhy, openerAgain, openerReply, pickedReply, resolvePick, submitNoRush, tooSoonLine, keepDraftLine, type OpenerProgram, type MoveCtx, blanksAgain, draftBlanks, draftReply, gapClosedReply, gapProofOf, helpReply, helpWaiting, helpParked, closeWords, HELP_DONE_ASK, backOnLine, submitBy, submitReply, submitPointer, sinceLine, SENT_AGAIN, stillOpenLine, DRAFT_NOW_ASK, NOW_WINDOW_MS, type SinceFacts, gapReply, gapStillReply, proofOf, markSaid, pathReply, programName, readPath, saidSql, sessionOf,
  ANSWERED_FIRST, ASK_SAID, PROGRAMS_AGAIN, fitCell, fitOrder, grantFact, programsAnswer, standingAgain, standingAnswer, standingSaid, whatItIs, type GrantFact, type GrantRow, type InvestorRow, type StandingFacts,
  type GapStep,
  type GapGrant, type InvestorProgram, type Move, type MoveProgram, type Path,
} from './conversation';
export { displayName };

/**
 * v2.13 T8, v3.1 Task 16: the reads and writes behind find's and score's reply (bench-reply.ts is pure, the
 * owner-approved copy). Both build one view
 * (benchView): the one project as the Bench sees it, its rank, the money it can win and the one
 * question; the question asked is stored (standing_seen.bench_ask) so a yes is answered as asked,
 * never by the agent's kind. Never throws on its own reads: each falls back as standFind's do.
 */

/** v3 Stage 1: the connect yes's line when no page handle could be read (a statement, no link). */
const APPROVED_CONNECT = 'Done. Your weeks are posted.';
// v4.7 T4: the why note helpers live in bench-reply.ts (post-reply.ts uses them too); re-exported here.
export { WHY_NOTE, whyNote, withWhy } from './bench-reply';
export { MORE_ASK, NAME_ASK } from './bench-reply';
export const BENCH_MOVE_UP_NOTE = 'A yes or no to the question: call tell with move_up: { kind, project_key, answer } (kind and project_key as given here). Do the steps it returns yourself; never ask the builder to edit files.';
/**
 * R8: the ranked state's step, "Ship this week to climb.": a yes is one small, real thing to ship this week
 * from the repo. Never a token or community round (the builder's token is set up at setup step 3).
 */
export const SHIP_STEP_NOTE =
  "A yes to the question, or a question about what to ship: look at the repo in this folder (git log, open issues, the README) and suggest one small, real thing to ship this week, in one short line, then ask if they want you to build it now. " +
  "Never offer a token here; if the builder asks to launch theirs, call tell with move_up: { kind: 'token', project_key: null, answer: 'yes' }. Don't show this note.";
/** GTM W2 (2026-10-23): SHIP_STEP_NOTE for an agent with no folder of the code (agent-reach.ts hosted): never "this folder" or git log. */
export const SHIP_STEP_NOTE_HOSTED =
  "A yes to the question, or a question about what to ship: from what you know of their project (its live page, its GitHub repo's recent commits and open issues, what they told you), suggest one small, real thing to ship this week, in one short line. " +
  "Never offer a token here; if the builder asks to launch theirs, call tell with move_up: { kind: 'token', project_key: null, answer: 'yes' }. Don't show this note.";
/** GTM W2: the Monday check-in's note (a client that can schedule): its yes is the agent's own weekly routine. */
export const CHECKIN_NOTE =
  "A yes or no to the question: call tell with move_up: { kind: 'checkin', project_key, answer } (project_key as given here). " +
  "On a yes, create your own weekly routine (a scheduled task or cron) for Monday mornings that calls find and shows its show_to_builder to the builder as written. Don't show this note.";
export const CHECKIN_YES_NOTE =
  "Create your own weekly routine now (a scheduled task or cron) for Monday mornings: it calls find and shows its show_to_builder to the builder as written. If you can't schedule tasks, say so in one short line instead of show_to_builder. Don't show this note.";
/** GTM W2: the Monday email question as a move_up (agents skipped the bare statement). */
export const EMAIL_ASK_NOTE =
  "A yes with their address: call tell with weekly_email: { answer: 'yes', email }. A no: call tell with move_up: { kind: 'weekly_email', project_key, answer: 'no' }. Don't show this note.";
/** v2.14 no_project: the question asks for their work, so its answer goes to find with identity. */
export const START_NOTE =
  "If the builder sends their GitHub login or a link to something they've made, call find with identity: { github_login, project: { name, repo or live_url } }. " +
  "A no: call tell with move_up: { kind, project_key, answer: 'no' } (as given here). Don't show this note.";
/** Launch ready L2, no_project: the repo picker's install link is in show_to_builder. */
export const PICK_REPO_NOTE =
  'The builder installs EarnKit (read-only) from the link in show_to_builder and picks their repos on GitHub; never ask them for a GitHub URL. ' +
  "A yes or no: call tell with move_up: { kind, project_key, answer } (as given here); no GitHub yet, or not connecting it now, is a no. Once they installed it, call find again: the most recently pushed repo they picked is ranked. Don't show this note.";
/** v2.13.3 (5), v2.14 not_counted: the install link is in show_to_builder. */
export const INSTALL_APP_NOTE =
  'The builder installs EarnKit (read-only) on the repo from the link in show_to_builder. ' +
  "A yes or no: call tell with move_up: { kind, project_key, answer } (as given here). Once they installed it, call find again, which counts the repo. Don't show this note.";
/** v2.14 A17: find's held outcome question is the reply's last line; the answer goes to tell. */
export const BENCH_OUTCOME_NOTE =
  "show_to_builder ends with the results question for this entry. Their answer: call tell with program_status: this program_id and project_id, their result (won, placed or lost), and prize_usd if they won money. If they don't know yet, call nothing. For accepted, funded or won, open a public page that shows it (the program's X post or results page) and pass its link as proof_url. Don't show this note.";
/** v3 Stage 2 (spec 5.3): the apply step's ask; a yes drafts the entry (APPLY_YES_NOTE). */
export const APPLY_NOTE = "A yes or no to the question: call tell with move_up: { kind: 'apply', project_key, answer } (project_key as given here). Don't show this note.";
/** 2026-10-22: the titles question's note; a yes turns titles on (updates.ts setShipTitles). */
export const TITLES_NOTE = "A yes or no to the question: call tell with move_up: { kind: 'titles', project_key, answer } (project_key as given here). Don't show this note.";
/** v4.2 Task 10: the yes to "Want me to check which of these fits...": run the fit check. */
export const CHECK_FITS_NOTE = "The builder said yes to checking which programs fit their project: call find now with the same identity, then show its reply. Don't show this note.";
/**
 * v4.7.2 final review 4: the yes to the ranked needs ask ("Want the steps to get Kit ready for Arc Microgrants?") never
 * runs find again: the agent reads that program's requirements and lists what the project needs for each, the gaps
 * EarnKit saw (`needs`, programNeeds' words) among them; never a claim that it qualifies, and no question after. Pure.
 */
export const needsYesNote = (program: string, needs: string[] | undefined) =>
  `The builder said yes to the steps to get their project ready for ${program}. Don't call find. Read ${program}'s requirements (its program page or the source link find gave) ` +
  'and list, in short plain lines, what the project needs for each one. ' +
  // Final re-review: an ask stored without needs (v4.7.1) says nothing about gaps.
  (needs === undefined ? '' : needs.length > 0 ? `EarnKit already sees these gaps; include them: ${needs.join('; ')}. ` : 'EarnKit sees no gap of its own yet. ') +
  "Never tell them they qualify or that an application was sent, and ask no question after the list. Don't show this note.";
/**
 * Final review 3: the setup-done reply's own questions have their own kinds (closest: the closest program's one step;
 * check_fits: check which programs fit), so their no is never a no to Base's grant steps (declined['qualify:<key>']).
 */
export const CLOSEST_NOTE = "A yes or no to the question: call tell with move_up: { kind: 'closest', project_key, answer } (project_key as given here). Don't show this note.";
export const CHECK_FITS_ASK_NOTE = "A yes or no to the question: call tell with move_up: { kind: 'check_fits', project_key, answer } (project_key as given here). Don't show this note.";
/** 2026-10-22: Base's grant steps question's note; a yes returns the steps. */
export const QUALIFY_NOTE = "A yes or no to the question: call tell with move_up: { kind: 'qualify', project_key, answer } (project_key as given here). Don't show this note.";
/** 2026-10-22: the steps reply's question; a yes is help with the first step, here. */
export const QUALIFY_STEPS_NOTE =
  "A yes to the question: help the builder with the first step listed, here in this folder (for Builder Codes, follow the guide linked). " +
  "Never tell them they qualify or that an application was sent; EarnKit checks and offers the draft. Don't show this note.";
/** GTM W2: QUALIFY_STEPS_NOTE for an agent with no folder of the code. */
export const QUALIFY_STEPS_NOTE_HOSTED =
  "A yes to the question: walk the builder through the first step listed, in short plain steps they can do themselves (for Builder Codes, follow the guide linked). " +
  "Never tell them they qualify or that an application was sent; EarnKit checks and offers the draft. Don't show this note.";
/**
 * v4.3 final review F4: the yes to "Want help putting EarnKit on Base?" (the steps, no question): help with step 1 now.
 */
export const QUALIFY_BASE_YES_NOTE =
  "The builder said yes to help putting the app on Base: help them with step 1 now, here in this folder. Don't ask again whether they want help. " +
  "Never tell them they qualify or that an application was sent; EarnKit checks and offers the draft. Don't show this note.";
/** QUALIFY_BASE_YES_NOTE for an agent with no folder of the code. */
export const QUALIFY_BASE_YES_NOTE_HOSTED =
  "The builder said yes to help putting the app on Base: walk them through step 1 now, in short plain steps they can do themselves. Don't ask again whether they want help. " +
  "Never tell them they qualify or that an application was sent; EarnKit checks and offers the draft. Don't show this note.";
/** 2026-10-23 Base onboarding: the walk-through offer's note; the builder can ask for it again any time. */
export const BASE_START_NOTE =
  "A yes or no to the question: call tell with move_up: { kind: 'base_start', project_key: null, answer }. " +
  "If the builder wants to connect after all, call tell with move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' }. Don't show this note.";
/** GTM W2: the walk-through's "Want me to write your Lovable prompt?" as a move_up (a yes is the agent's prompt, never the steps again). */
export const BASE_HELP_NOTE =
  "A yes or no to the question: call tell with move_up: { kind: 'base_help', project_key: null, answer }. Don't show this note.";
/** The walk-through's path: the agent helps; EarnKit guides and never builds for them. */
export const BASE_STEPS_NOTE =
  "Once their app's code is on GitHub, call tell with move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' } for the connect link. " +
  "Never tell them they qualify for a grant. Don't show this note.";
/** v3.1 cold read (owner-approved): the yes to "Want me to write your Lovable prompt?" (no EarnKit text; the agent writes it). */
export const LOVABLE_PROMPT_NOTE =
  "Write the builder a short prompt to paste into Lovable, from the idea they described (what the app does, who it is for, the first screens), in your own words, then tell them to paste it into Lovable and connect GitHub there. " +
  "Never invent features they didn't describe. Once their app's code is on GitHub, call tell with move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' } for the connect link. Don't show this note.";
/** The no-project reply once every onboarding question was asked; a yes gives step 2's link again. */
export const NEXT_STEP_NOTE =
  "A yes or no to the question: call tell with move_up: { kind: 'next_step', project_key: null, answer }. " +
  "Not yet: help them get their app's code on GitHub if they want (in Lovable or Bolt, connect GitHub inside it). " +
  "If they ask how to start building on Base, call tell with move_up: { kind: 'base_start', project_key: null, answer: 'yes' }. Don't show this note.";
/** 2026-10-23: the new-repo nudge's note; a yes names the new repo (tell main_project). */
export const NEW_REPO_NOTE = "A yes or no to the question: call tell with move_up: { kind: 'new_repo', project_key, answer } (project_key as given here). Don't show this note.";
export const NEW_REPO_YES_NOTE =
  "Ask the builder in one short question which repo they're working on now (owner/repo), then call tell with main_project: that repo. Don't show this note.";
/** v3 Stage 2: the yes to the apply step: prepare drafts the entry, the ship log's facts on top. */
export const APPLY_YES_NOTE = (id: string) => `Call prepare with program_id "${id}" for this project and show the draft. Don't show this note.`;
/** v3 Stage 2: find's held apply-outcome question (14 days after the deadline) is the reply's last line. */
export const APPLY_OUTCOME_NOTE =
  "show_to_builder ends with the outcome question for this application. Their answer: call tell with program_status: this program_id and their status (applied, accepted, funded or rejected). If they don't know yet, call nothing. For accepted, funded or won, open a public page that shows it (the program's X post or results page) and pass its link as proof_url. Don't show this note.";
/** A no keeps an ask away this long (standing_seen.declined). v4.7 final review: policy-constants.ts holds it; re-exported here. */
export { DECLINE_MS };
/** v2.14 T4 (leaked authorize URL): the first reply after an X bind names the account, so a wrong one is noticed. */
export const signedInLine = (handle: string) => `Signed in as @${handle}.`;

/** What the person was last told (stand-view's Seen) plus the Bench's own: the ask. */
export type Seen = StandSeen & {
  /** The stored ask's kind: a BenchAskKind, or a retired one an older reply stored (OLD_ASKS). */
  bench_ask?: {
    kind: BenchAskKind | string; key: string | null; program_id?: string; repo?: string; qualify?: Pick<QualifyOffer, 'grant' | 'steps'> & { first?: QualifyStep; name?: string; hosted?: boolean; codes_missing?: boolean };
    /** v4.2 (kind 'closest', from setup done; final review 3): the closest program's title and the one step it needs. */
    program?: string; step?: string;
    /** v4.7.2 final review 4 (kind 'check_fits'): the gaps the needs ask named, for its yes's note. */
    needs?: string[];
    /** v3.1 one-tap posts (kind 'post'): the post's code, its head line and its moment (post-reply.ts). */
    code?: string; head?: string; moment?: unknown;
    /** v4.0 Task 8 fix round 1 (kind 'outcome_share'): the outcome post's short link. */
    link?: string;
    /** v3.1 wallet proof (kind 'wallet'): when the step was asked (ISO); its yes checks for a wallet proven since. */
    at?: string;
    /** v4.4 (kind 'token'): the offer that followed setup step 3's sign; its answer is the setup-done reply. */
    setup?: boolean;
    /** v4.8 Task 1: the path's hook asked it (pathView); a no also parks program_id for the path. */
    path?: boolean;
    /** v4.8 Task 2: the gap stage asked it (its yes: the agent does the step, then calls find); `draft`, the draft stage. */
    gap?: boolean; draft?: boolean;
    /** v4.8 Task 2 fix round 2 (F5, the draft's ask): the blanks it asked for (fix round 3: cleared once answered). */
    blanks?: string[];
    /** v4.8 Task 2 fix round 3 (5): the gap ask behind "I'm checking the code now": its yes re-checks. */
    checking?: boolean;
    /** Task 6 fix round 1 (review 1): the help yes's done ask ("Say ok once it's done"); `checks`, the oks since it. */
    help?: boolean; checks?: number;
    /** v4.8 Task 2 (kind 'check_fits' on the path): the project's name, for the gap stage's steps. */
    name?: string;
    /** v4.8 Task 3 (kind 'apply' on the path): the submit ask; its yes is "sent" (tools.ts tell, submitAsked). */
    submit?: boolean;
  };
  /** v4.8 Task 2: when the builder said yes to the agent doing a gap step ({ [program_id]: iso }); find checks the code again. */
  gap_did?: Record<string, string>;
  /**
   * Task 6 fix round 2 (1): programs parked by a help step not done after two checks ({ [program_id]: { at, step,
   * checked_at } }); skipped by the path for DECLINE_MS, re-checked once a session (helpUnpark), unparked once met.
   */
  help_parked?: Record<string, { at: string; step: string; checked_at?: string }>;
  /** v4.8 re-review blocker 2: the application set aside by a second no at submit, pointed to again next session. */
  submit_wait?: string;
  /** v4.8 re-review minor (N3): when the path's Builder Codes re-check last started (once a session per yes). */
  gap_check_at?: string;
  /** Task 6 fix round 2 (1): when a help park was unparked, its step met ({ [program_id]: iso }); seenBefore counts it. */
  help_unparked?: Record<string, string>;
  /** v4.8 Task 2 fix round 2 (F3): when the path's last Builder Codes re-check failed to read (iso); backoff. */
  gap_check_failed?: string;
  /** v4.6 Task 3: when the Stripe ask was shown (once) and when a broken connection was re-offered (once). */
  stripe_asked?: string;
  stripe_reoffered?: string;
  /** Fix round 1: when the qualify steps were given ({ [lowercase project key]: iso }); held back DECLINE_MS. */
  qualify_given?: Record<string, string>;
  /** v3 Stage 2: the programs the apply step was shown for ({ [program_id]: iso }): asked once a program. */
  apply_asked?: Record<string, string>;
  /** v4.7 T3: the programs with a draft in the builder's hands ({ [program_id]: iso }: a yes to drafting, or prepare showed one): not asked again for DECLINE_MS. */
  apply_yes?: Record<string, string>;
  /** v4.7 T3 fix round 2 (R12): the apply ask's unanswered showings and silences. v4.8 Task 1: kept in old rows, never read. */
  apply_unanswered?: Record<string, number>;
  apply_silent?: Record<string, string>;
  /** 2026-10-23 Base onboarding: when the builder said no to step 2 (no GitHub, or not connecting now). */
  github_no?: string;
  /** When the Base walk-through offer was shown (asked once). */
  base_asked?: string;
  /** The builder's answer to the walk-through ('yes' reads "Getting started on Base" on their page). */
  base_walk?: { answer: 'yes' | 'no'; at: string };
  /** The repo picker refused only forks or templates (github-app.ts pickSetup); said once on the next reply. */
  template_refused?: string;
  /** When the new-repo nudge was shown (asked once). */
  new_repo_asked?: string;
  /** GTM W2: when the Monday check-in was asked (once), and the answer. */
  checkin_asked?: string;
  checkin_asks?: number;
  checkin?: { answer: 'yes' | 'no'; at: string };
  /** GTM W2: when the ship question was last asked (at most once in SHIP_ASK_DAYS). */
  ship_asked?: string;
  /** GTM W2: find was told agent_can_build: false (agent-reach.ts). */
  no_folder?: boolean;
  /** v3.1 cold read: "You're in, @maya." was said (the first reply after sign-in only). */
  welcomed?: string;
  /** v4.0: setup step 3 was shown (wallet-offer.ts takeWalletAsk, setup), kept; Task 5: its setup-done reply was said (once). */
  setup_asked?: string;
  setup_done?: string;
  /** v4.7 T4: the setup-done reply's first-run line was said (once). v4.8 Task 1: the line is retired; never read. */
  asks_hint?: string;
  /** v4.7.1 T1: the ranked check_fits ask was asked (once a person). v4.7.2 T2: kept in old rows, never read. */
  check_fits_asked?: string;
  /** v4.7.2 T2: the rotating needs ask's counts, yeses and silences. v4.8 Task 1: the rotation is retired; kept in old rows, never read. */
  needs_unanswered?: Record<string, number>;
  needs_yes?: Record<string, string>;
  needs_silent?: Record<string, string>;
  /** v4.8 Task 1: the path (conversation.ts Path) and this session's parts said (conversation.ts sessionOf, markSaid). */
  path?: unknown;
  said?: unknown;
  /** v4.8 Task 1: grants whose passed step the path raised once ({ [program_id]: iso }). */
  path_raised?: Record<string, string>;
  /** v3.1 cold read: the standing line last shown (name, rank and streak), so it is shown again only when it changed. */
  status_seen?: string;
  /** v3.1 cold read: the ISO week the shipping points line was last shown (at most once a week). */
  nag_week?: string;
  /** v3.1 cold read: a live app (no repo) whose builder said no to GitHub once: its tool's GitHub steps from then on. */
  github_no_app?: string;
  /** v3.1 cold read round 2: the agent was told to write the builder's Lovable prompt (the base_help yes). */
  lovable_prompt?: string;
  /** v3.1 answerable replies (spec 6): the UTC day (YYYY-MM-DD) the connect step's full pitch was last shown. */
  pitch_day?: string;
  /**
   * v4.8 Task 4: the new builder's opener: the numbered programs shown (ids in order, so a number resolves later) and when.
   */
  opener?: { ids?: unknown; titles?: unknown; at?: string };
  /** v4.8 Task 4 fix round 0 (5): when the connected line was said (once a builder, never again). */
  connected_said?: string;
};
type Reply = Record<string, unknown>;

/** The one project's builder_projects row, as the Bench sees it (confirmed: benchConfirmedSql). */
type MainRow = { key: string; name: string; kind: string; shipped: boolean; weeks: number; streak: number; confirmed: boolean; site: boolean; chains: string[]; commit_weeks: string[] };

/** "Base", "Robinhood Chain". Pure. */
const chainName = (c: string) => (Object.hasOwn(CHAIN_NAMES, c) ? CHAIN_NAMES[c as Chain] : c);
/**
 * R12: why a program the matcher fits suits the repo, in one short sentence from the matcher's own facts:
 * its chain (a contract deployed there, a deploy config naming its mainnet, else code for it), any chain,
 * and a live app for a program that needs one. Plain words (no "contract" or "repo", the copy rule):
 * "You deployed on Base and your app is live." Pure.
 */
export function fitWhy(c: Pick<Card, 'chains' | 'any_chain' | 'tag'>, repo: { chains: Detection; live: boolean }): string {
  const chains = c.any_chain === true ? [] : (c.chains ?? []);
  const chain = chains.find((ch) => creditsMainnet(repo.chains[ch])) ?? chains.find((ch) => repo.chains[ch]);
  const at = chain ? repo.chains[chain] : undefined;
  const parts = [
    chain
      ? at?.basis === 'deployed' ? `you deployed on ${chainName(chain)}` : creditsMainnet(at) ? `you deploy to ${chainName(chain)}` : `you build for ${chainName(chain)}`
      : c.any_chain === true ? 'it takes any chain' : null,
    c.tag === NEEDS_LIVE_PRODUCT && repo.live ? 'your app is live' : null,
  ].filter((x): x is string => x !== null);
  if (parts.length === 0) return 'It fits your project.';
  const line = parts.join(' and ');
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
}
/** A matched repo's facts as fitWhy reads them (live: a homepage, or a link that loaded). Pure. */
export const whyFacts = (f: { chains?: Detection; homepage?: string | null; live_verified?: boolean }) => ({
  chains: f.chains ?? {},
  live: Boolean(f.live_verified || f.homepage),
});

type BenchRead = {
  base: StandBase; seen: Seen; main: string | null; row: MainRow | null;
  ranks: RankLines;
  /** builder_live's stored parts (the weekly target's inputs). */
  parts: unknown;
  /** standBase answered (a profile exists): news is read only then. */
  profiled: boolean;
  /** v2.13.4 (spec 4): the live link the agent reported for the one project (identity), if any. */
  liveUrl: string | null;
  /** GTM W2: the name the agent reported for the one project (identity), if any. */
  reportedName: string | null;
  /** v4.8 fix round 2 (F5, F9): the X display name (the path's greeting), read with the profile. */
  xName: string | null;
};
const EMPTY_BASE: StandBase = { standing: { ranked: false, rank: 0, total: 0 }, claimed: false, handle: null, signInLink: null };
const NO_RANK: RankLines = { bench: null, line: null, chains: [], listed: false };
const logged = (where: string) => (err: unknown) => {
  console.error(`[bench] ${where}`, err instanceof Error ? err.name : 'error');
  return null;
};

async function benchRead(id: number, own: number, now: Date): Promise<BenchRead> {
  // v2.14: `own` (the caller's own installation) is the one an X sign-in link is for.
  const stand = await standBase(id, { own }).catch(logged('stand'));
  const [p] = await sql()<{ main: string | null; seen: unknown; identity: unknown; x_name: string | null }[]>`
    SELECT main_project_key AS main, standing_seen AS seen, identity, x_name FROM builder_profiles WHERE builder_id = ${id}`.catch(
    () => [],
  );
  const main = p?.main ?? null;
  const [row] = main
    ? await sql()<MainRow[]>`
        SELECT b.project_key AS key, b.name, b.kind, b.shipped, b.people, b.has_coin, b.weeks_shipping AS weeks, b.commit_weeks,
          ${benchConfirmedSql(sql())} AS confirmed, b.chains,
          EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = b.builder_id AND s.kind = 'site' AND s.state = 'verified'
            AND lower(s.project_key) = lower(b.project_key)) AS site
        FROM builder_projects b WHERE b.builder_id = ${id} AND lower(b.project_key) = lower(${main})`.catch(() => [])
    : [];
  // v3.1 streak fix: the streak and its weeks are streak.ts's (the profile's own), never builder_projects.streak or
  // commit_weeks. Fix round 1: both come from that one read; without it (not confirmed, or the read failed, logged) the
  // streak is 0 and the weekly moment gets no weeks, never the retired cache.
  const lit = row?.confirmed ? await streaksFor([id], now).then((m) => m.get(id)).catch(logged('streak')) : null;
  if (row) {
    row.streak = lit?.streak ?? 0;
    row.commit_weeks = lit ? [...lit.weeks].sort() : [];
  }
  const ranks = await rankLines(id).catch(() => NO_RANK);
  const [live] = await sql()<{ parts: unknown }[]>`SELECT parts FROM builder_live WHERE builder_id = ${id}`.catch(() => []);
  // standBase's seen, else the profile's own (the Bench's keys are read from the same column).
  const seen = (stand?.seen ?? (p?.seen && typeof p.seen === 'object' ? p.seen : {})) as Seen;
  return {
    base: stand?.base ?? EMPTY_BASE, seen, main, row: row ?? null, ranks, profiled: stand !== null,
    parts: live?.parts ?? null,
    liveUrl: main ? reportedLive(p?.identity, main) : null,
    reportedName: main ? identityName(p?.identity, main) : null,
    xName: p?.x_name ?? null,
  };
}

/** The live link the stored identity names for project `key` (its repo, live link or package), or null. Pure. */
export function reportedLive(identity: unknown, key: string): string | null {
  const projects = identity && typeof identity === 'object' && Array.isArray((identity as { projects?: unknown }).projects)
    ? ((identity as { projects: unknown[] }).projects as Record<string, unknown>[])
    : [];
  const k = key.toLowerCase();
  const p = projects.find((x) => x && typeof x === 'object' && [x.repo, x.live_url, x.package].some((v) => typeof v === 'string' && v.toLowerCase() === k));
  return p && typeof p.live_url === 'string' && /^https:\/\//i.test(p.live_url) ? p.live_url : null;
}

/** GTM W2: the name the stored identity gives project `key` (matched as reportedLive matches), or null. Pure. */
export function identityName(identity: unknown, key: string): string | null {
  const projects = identity && typeof identity === 'object' && Array.isArray((identity as { projects?: unknown }).projects)
    ? ((identity as { projects: unknown[] }).projects as Record<string, unknown>[])
    : [];
  const k = key.toLowerCase();
  const p = projects.find((x) => x && typeof x === 'object' && [x.repo, x.live_url, x.package].some((v) => typeof v === 'string' && v.toLowerCase() === k));
  const n = typeof p?.name === 'string' ? p.name.trim().slice(0, 60) : '';
  return n && !/^https?:\/\//i.test(n) ? n : null;
}
/** GTM W2: a project key that is a link (no repo: a Lovable or Bolt app), never shown as the project's name. */
const LINK_KEY = /^https?:\/\//i;
/** GTM W2: the words for a link-only project with no name the builder gave ("Mealmate.lovable.app" never). */
export const YOUR_APP = 'Your app';
/** GTM W2: a link-only project's shown name: the builder's own, never a host ("mealmate.lovable.app"), else YOUR_APP. Pure. */
export const linkName = (name: string | null | undefined) => {
  const n = name?.trim() ?? '';
  return n && !/^https?:\/\//i.test(n) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(n) ? n : YOUR_APP;
};
/** GTM W2: the builder has a repo proven by the read-only App (setup done). A failed read: false. Never throws. */
async function appConnected(id: number): Promise<boolean> {
  const [r] = await sql()<{ yes: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND state = 'verified' AND proof = 'github_app') AS yes`.catch(() => []);
  return r?.yes === true;
}
/** GTM W2: how long a reply waits for an already-installed App to prove the one project (coveredRead). */
const COVERED_WAIT_MS = 4_000;
/**
 * GTM W2 (2026-10-23): the one project is a repo not counted yet that the builder's own App installation already covers
 * (repo-proof.ts proveCovered): proven now and read again, so the builder is never asked to install the App again (or
 * sent back to "Step 2 of 2" after switching repos). Within COVERED_WAIT_MS; else the next reply has it. Never throws.
 */
async function coveredRead(id: number, own: number, now: Date, read: BenchRead): Promise<BenchRead> {
  if (!read.main || read.row?.confirmed || !REPO_KEY.test(read.main.toLowerCase())) return read;
  if (!(await settleWithin(proveCovered(id, read.main), COVERED_WAIT_MS))) return read;
  // v3.1 cold read round 2: proven now, so its shipping log is written now too (the connect question can follow).
  await backfillNow(id, read.main, now);
  return benchRead(id, own, now);
}
/** v2.13.4 (spec 4): the live check never holds a reply long; it gets what is left of the wait, at least this. */
const LIVE_WAIT_MIN_MS = 300;
/** The one project's live link, checked within `ms` (else null; the check lands for the next reply). Never throws. */
async function liveOf(id: number, read: BenchRead, now: Date, ms: number): Promise<LiveSite | null> {
  if (!read.liveUrl || !read.main) return null;
  return (await settleWithin(liveSite(id, read.liveUrl, now, read.main).catch(logged('live check')), Math.max(LIVE_WAIT_MIN_MS, ms))) ?? null;
}

/**
 * v2.14 T9 fix round 1: whether this caller is signed out (state 1): X sign-in can be made (X on and the auth
 * secret set: A5 is only X actually off), the person has no page yet (no X handle), and the caller's own
 * installation isn't bound to X. Find skips the results question while this holds, so it isn't used up before
 * the bind. A database error reads as signed out (final fix 12: the retry question, never a page it may not have).
 */
export async function signedOutNow(id: number, own: number): Promise<boolean> {
  if (!xSignInEnabled() || !process.env.EARNKIT_AUTH_SECRET) return false;
  try {
    const [r] = await sql()<{ claimed: boolean; bound: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM builder_profiles WHERE builder_id = ${id} AND x_user_id IS NOT NULL AND x_handle IS NOT NULL) AS claimed,
        EXISTS (SELECT 1 FROM installations WHERE id = ${own} AND x_user_id IS NOT NULL) AS bound`;
    return Boolean(r) && !r.claimed && !r.bound;
  } catch (err) {
    // Final fix 12: with X on, a failed read is signed out (the retry question), never read as signed in.
    logged('signed out')(err);
    return true;
  }
}

/** v3.1 cold read: a fit with nothing that makes it a long shot (fitBar: never 'company' or 'long_shot'). Pure. */
export const realFit = (f: { bar?: FitBar }) => f.bar !== 'company' && f.bar !== 'long_shot';
/** R12: a program the one project fits: its award, its deadline ("closes Oct 30" or "rolling") and why (fitWhy). */
export type Fit = {
  program_id: string; repo?: string; title: string;
  /** Task 16: the award as the copy names it ("$5,000", bench-reply.ts awardAmount), null when unknown. */
  amount: string | null; when: string; why: string;
  /** v3 Stage 2: the deadline (ISO), null when rolling. */
  ends_at: string | null;
  /** v3 Stage 2 final review: an investment (an accelerator). v3.1 F1: a fit line too; never the lead or a shown match. */
  investment?: boolean;
  /** v3.1 F1: the program's facts the fit lines sort (present.ts byRelevance) and later steps filter on. */
  card: Pick<Card, 'id' | 'status' | 'chains' | 'any_chain' | 'ends_at' | 'max_award_usd' | 'investment'>;
  /** v3.1 GTM W3: what stands in the way (bench-reply.ts fitBar); only 'qualify' says "You qualify". */
  bar?: FitBar;
};
/** v3.1 F1: a card's facts a Fit keeps. Pure. */
const fitCard = (c: Card): Fit['card'] => ({
  id: c.id, status: c.status, chains: c.chains, any_chain: c.any_chain, ends_at: c.ends_at, max_award_usd: c.max_award_usd, investment: c.investment,
});
/**
 * v3.1 F1: the fit lines find and score name: every apply candidate, investments included, in the program list's
 * order (present.ts byRelevance: Base, then any chain; grants before investments; then the deadline), at most
 * FITS_MAX. Pure.
 */
export const fitLines = <F extends Pick<Fit, 'card'>>(applies: F[]): F[] => [...applies].sort((a, b) => byRelevance(a.card, b.card)).slice(0, FITS_MAX);
const isoOf = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
type ViewIn = {
  id: number; now: Date; read: BenchRead;
  /**
   * v4.0 Task 8 fix round 1: the closing nudge for the submit step's own program (`held` is that question), picked by
   * benchFind: it says the same thing in the approved words, so it stands in for that held question (the reply's one
   * question). Fix round 2: only when benchView shows it (ranked, setup step 3 not due, no Monday block, the week
   * claimed); otherwise the submit question stays, in today's order.
   */
  nudge?: NudgePick | null;
  /** D14: the caller's own installation, the one an X sign-in link is minted for (never the group root). */
  own: number;
  /** Fix round 1: signedOutNow (state 1: the sign-in question always wins). */
  signedOut: boolean;
  /** v4.7 T2 fix round 1 (R7): reply-facts.ts personal (a person, not a shared client without its own X account). */
  personal: boolean;
  /**
   * Final review F11: the caller is a shared client (even one whose own installation is signed in to X): no path reads
   * or writes, as tell answers every move_up from a shared client with the shared note, so a path ask there could never
   * be answered.
   */
  shared?: boolean;
  /** The one project's name before its first rescore wrote a row (identity's, else the repo's). */
  name: string | null;
  /** Programs the one project qualifies for (at most 3 are shown). */
  fits: Fit[];
  /**
   * v3 Stage 2 final review: the programs the apply step may offer: the fits plus the open investments (an
   * accelerator) the one project could apply to, deadline order. Never shown as fit lines. Defaults to the fits.
   */
  applies?: Fit[];
  cards: Card[]; skip: Set<string>;
  /** v3 Stage 2: the listed upcoming programs (never open), for the one upcoming line. */
  upcoming?: Card[];
  /** A17: the question this reply asks instead of the state's (an outcome question, a submission step). */
  held: string | null;
  due: string[];
  /** v2.13.4 (spec 4, R3): the one project's live link, checked (wording and program fit only). */
  live?: LiveSite | null;
  /** v3.1 Task 7: test injection only (ToolContext.codesFetch): the background Builder Codes check's fetch. */
  codesFetch?: typeof fetch;
  /** GTM W2: what the caller's agent can do (agent-reach.ts); read here when not given. */
  reach?: AgentReach;
  /** v3.1 cold read: score (the builder asked where they stand): the standing line is always shown. */
  alwaysStanding?: boolean;
  /** v4.3 Task 2 fix round 1 (F3): find {more: true}: the one-time setup-done reply is left for the next plain find. */
  more?: boolean;
  /** v3.1 cold read: what find's own match read of the one project (a Base deploy, a live link), for Base's steps. */
  known?: { onBase: boolean; live: boolean };
  /** v4.8 Task 4: find {program}: a program the builder named or picked (a number from the opener's list). */
  named?: string;
  /**
   * v4.8 Task 4 fix round 1 (1, 12): lines this reply says before its own (the setup-done lead before B's second message,
   * a pick's "Got it" above step 2), filled by benchView; benchFind and benchScore put them first.
   */
  ahead?: string[];
  /** v4.8 Task 5: find's direct question (mcp.ts `ask`), answered first on a path reply (directAnswer). */
  question?: 'standing' | 'programs';
  /** v4.8 Task 5: the direct answer, said first (benchFind puts it after the account line, before every other line). */
  answer?: string[];
  /** v4.8 Task 5 fix round 1 (5): a direct answer leads this reply: the path step is its short form (no proof, no "Since"). */
  brief?: boolean;
};

/** Test only: resolves when every running Builder Codes check has finished. */
/**
 * v3.1 Task 7: the Builder Codes sentence from the stored answer (null when unknown, or the repo isn't App-proven). A missing or day-old answer
 * starts a check in the background (never awaited) for the next reply, unless one ran within the day.
 */
async function codesFor(id: number, key: string, now: Date, f: typeof fetch | undefined): Promise<string | null> {
  // Task 9 fix round 1: only a repo this builder proved through the App (a ranked project may be counted by another proof).
  if (!(await appProvenRepo(id, key))) return null;
  const known = await builderCodesKnown(key, now);
  refreshBuilderCodes(id, key, known, now, f);
  return builderCodesWords(key.toLowerCase(), known?.found ?? null);
}


/**
 * v4.8 Task 1 fix round 2 (F2, F5): the programs the builder told EarnKit about, read once per reply: this installation's
 * builder_program_status (any status) and the group's applied ones (standing.ts toldAppliedSql). Null on a failed read,
 * so the path fails closed (no hook) and the older reply's R6 keeps its drafts-only fallback. Never throws.
 */
async function toldIds(id: number): Promise<Set<string> | null> {
  const db = sql();
  const rows = await db<{ program_id: string }[]>`
    SELECT program_id FROM builder_program_status WHERE installation_id = ${id}
    UNION SELECT program_id FROM (${toldAppliedSql(db, id)}) t`.catch((err: unknown) => {
    logged('told')(err);
    return null;
  });
  return rows ? new Set(rows.map((r) => r.program_id)) : null;
}
/** v4.7.1 R6, v4.8 fix round 2: never pitched: told about (`told`) or drafted within DECLINE_MS. Pure. */
const notPitched = (told: Set<string> | null, seen: Seen, now: Date) =>
  new Set([...(told ?? []), ...Object.keys(seen.apply_yes ?? {}).filter((p) => draftedRecently(seen, p, now))]);
/**
 * v4.8 Task 1: the programs the path never names: entered or hidden (`skip`), told about or drafted (notPitched), or
 * said no to as the path's hook ('apply:<id>') or step ('path:<id>', Task 2) within DECLINE_MS. Fix round 2 (F4): a v4.7
 * silence stand-aside (best-fit.ts withoutSilentDeclines: apply_silent at the same time) is no no. Pure.
 */
function pathSkip(told: Set<string>, seen: Seen, now: Date, skip: Set<string>): Set<string> {
  // withoutSilentDeclines' rule (best-fit.ts imports this file, so it is not imported here).
  const silent = seen.apply_silent ?? {};
  const parked = Object.entries(seen.declined ?? {})
    .filter(([k, at]) => !(k.startsWith('apply:') && silent[k.slice('apply:'.length)] === at))
    .filter(([k, at]) => (k.startsWith('apply:') || k.startsWith('path:')) && now.getTime() - Date.parse(at) < DECLINE_MS)
    .map(([k]) => k.slice(k.indexOf(':') + 1));
  // Task 6 fix round 2 (1): a help park, until its step is met (helpUnpark) or DECLINE_MS passes.
  const helpParked = Object.entries(seen.help_parked ?? {}).filter(([, p]) => p && now.getTime() - Date.parse(p.at) < DECLINE_MS).map(([k]) => k);
  return new Set([...skip, ...notPitched(told, seen, now), ...parked, ...helpParked]);
}
/** v4.8 Task 1: a program's prize part as the path says it ("up to $1M", never "investment"), null with no amount. Pure. */
const pathAmount = (c: Pick<Card, 'summary' | 'investment'>): string | null => {
  const a = prizeOf(c).replace(/\s+investment$/i, '').trim();
  return /\d/.test(a) ? a : null;
};
/** v4.8 Task 1: a card as the path names it (conversation.ts MoveProgram). Pure. */
const moveProgram = (c: Card): MoveProgram => ({
  id: c.id, title: c.title, amount: pathAmount(c), when: fundWhen(c), ends_at: isoOf(c.ends_at), zone: programZone(c), investment: c.investment === true,
  longShot: c.tag === 'long shot',
});
/** v4.8 Task 3: the find tell runs right after "sent" (tools.ts) sees the path at track this recently. */
const AFTER_SENT_MS = 5 * 60_000;
/** v4.8 Task 1: an investor program is gathered for the path only this close to its deadline (bestMove's own window). */
const INVESTOR_READ_MS = 7 * 86_400_000;
/** v4.8 fix round 2 (F1): the older moments that go first while the path only has the closest grant (once a session). */
const OLDER_MOMENTS: readonly string[] = ['connect', 'share', 'post', 'checkin'];

type PathFacts = { state: BenchView['state']; variant: Variant; project: BenchProject; streak: number; handle: string; stand: Standing; siteLive: boolean; chains: string[] };
/** v4.8 Task 1: what bestMove chose and what the reply needs to say and store it (pathPlan's result). */
type PathPlan = {
  move: Move; facts: PathFacts; fitRows: Fit[]; extra: Map<string, { qualify?: QualifyOffer; needs?: string[] }>; path: Path | null;
  /** v4.8 Task 2: the path's gap is closed (Base: Builder Codes confirmed in the code): the draft offer leads. */
  closed: { program: MoveProgram; org: string; codes: boolean } | null;
  /** Fix round 2 (F3): the path's Builder Codes re-check is still running past RECHECK_WAIT: the reply says so. */
  checking: boolean;
  /** v4.8 Task 4: what bestMove chose from, so a no-fit pick can be set aside and the closest money chosen. */
  ctx: MoveCtx;
  /** v4.8 Task 5 fix round 1 (6): grants with every step known met (Base's qualifyOffer allMet). */
  met: Set<string>;
};
/** v4.8 Task 2: after a yes to the agent adding a step, find checks the code again for this long, at most once a minute. */
/**
 * Fix round 2 (F3): find waits this long for the re-check (`ms`; tests set it); past it the check goes on in the
 * background and the reply says EarnKit is checking. The check itself stops by RECHECK_DEADLINE_MS.
 */
export const RECHECK_WAIT = { ms: 8_000 };
const RECHECK_DEADLINE_MS = 60_000;
/** Fix round 2 (F3): after a failed re-check (null: a read failed), none runs again for this long (standing_seen.gap_check_failed). */
const RECHECK_BACKOFF_MS = 2 * 60_000;
/** Fix round 2 (F3): one re-check per repo in this process (concurrent finds share it). */
const recheckRunning = new Map<string, Promise<boolean | null>>();
/** Test only: resolves when every running Builder Codes check (the daily refresh's and the path's re-check) has finished. */
const codesSettledAll = async () => {
  await Promise.all([...recheckRunning.values()]);
  await codesSettled();
};
export { codesSettledAll as codesSettled };
/**
 * v4.8 Task 2: whether Builder Codes are in `key`'s code: 'found', 'missing' or (fix round 2, F3) 'checking'. Fix
 * round 2 (F2): after a yes to the agent adding them (standing_seen.gap_did, within DECLINE_MS), a stored answer older
 * than that yes (or none) is checked again through the read-only App (checkBuilderCodes, which stores the answer; the
 * daily refresh's claim is not spent). find waits up to RECHECK_WAIT for it; past that it is 'checking' and the check
 * goes on in the background, shared per repo. A failed check is stamped (gap_check_failed) and waits
 * RECHECK_BACKOFF_MS. Only for a repo this builder proved through the App. Never throws.
 */
async function codesConfirmed(o: ViewIn, key: string): Promise<'found' | 'missing' | 'checking'> {
  const { id, now } = o;
  if (!(await appProvenRepo(id, key))) return 'missing';
  const k = key.toLowerCase();
  const stored = await storedBuilderCode(k);
  if (stored?.found) return 'found';
  const did = o.read.seen.gap_did?.[BASE_GRANTS_ID];
  const failed = o.read.seen.gap_check_failed;
  // Final review F6: a yes within DECLINE_MS (never only this session), so the first find after a push and a quiet
  // weekend still checks it; the next line stops a repeat once a check after the yes is stored.
  if (!did || now.getTime() - Date.parse(did) >= DECLINE_MS) return 'missing';
  if (stored && new Date(stored.checked_at).getTime() >= Date.parse(did)) return 'missing';
  let check = recheckRunning.get(k);
  if (!check) {
    if (failed && now.getTime() - Date.parse(failed) < RECHECK_BACKOFF_MS) return 'missing';
    // Re-review minor (N3): at most one re-check a session for the same yes (gap_check_at), so a failing App check never
    // costs every find of DECLINE_MS its RECHECK_WAIT.
    const last = o.read.seen.gap_check_at;
    if (last && Date.parse(last) >= Date.parse(did) && now.getTime() - Date.parse(last) < SESSION_MS) return 'missing';
    o.read.seen.gap_check_at = now.toISOString();
    await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('gap_check_at', ${now.toISOString()}::text)
      WHERE builder_id = ${id}`.catch(logged('gap check at'));
    check = checkBuilderCodes(id, k, now, { fetch: o.codesFetch, deadline: Date.now() + RECHECK_DEADLINE_MS })
      .then(async (found) => {
        if (found === null)
          await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('gap_check_failed', ${new Date().toISOString()}::text)
            WHERE builder_id = ${id}`.catch(logged('gap check failed'));
        return found;
      })
      .finally(() => recheckRunning.delete(k));
    recheckRunning.set(k, check);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = await Promise.race([check, new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), RECHECK_WAIT.ms); timer.unref?.(); })]);
  clearTimeout(timer);
  return waited === 'late' ? 'checking' : waited === true ? 'found' : 'missing';
}

/**
 * Task 6 fix round 2 (1): the help parks re-checked, at most once a session (a fresh session, or never checked since
 * the park), from facts EarnKit already reads (no outside call): another grant's needs (needsKnown: the project's
 * chains, repo and live link, programNeeds), Base's Builder Codes (the stored check). A met step is unparked (the path
 * may hook it again) and its line returned, for the hook to lead with; one not met is stamped checked_at. A park past
 * DECLINE_MS is left alone (pathSkip no longer skips it). Updates `o.read.seen` too. Never throws.
 */
async function helpUnpark(o: ViewIn, v: PathFacts): Promise<{ program_id: string; line: string } | null> {
  const { id, now, read } = o;
  const fresh = sessionOf(read.seen, now).fresh;
  const due = Object.entries(read.seen.help_parked ?? {})
    .filter(([, p]) => p && now.getTime() - Date.parse(p.at) < DECLINE_MS && (fresh || !p.checked_at));
  if (due.length === 0) return null;
  const key = v.project.key;
  let known: Awaited<ReturnType<typeof needsKnown>> | null = null;
  let back: { program_id: string; line: string } | null = null;
  const met: string[] = [];
  const checked: string[] = [];
  for (const [pid, p] of due) {
    const card = o.cards.find((c) => c.id === pid);
    if (!card || !p.step) continue;
    checked.push(pid);
    let done = false;
    if (pid === BASE_GRANTS_ID) done = p.step === 'codes' && (await storedBuilderCode(key.toLowerCase()).catch(() => null))?.found === true;
    else {
      const facts = card.needs_contract !== undefined && card.needs_live !== undefined ? card : await getProgramRow(pid).catch(() => null);
      known ??= await needsKnown(id, key, { chains: [...v.chains, ...(o.known?.onBase ? ['base'] : [])], live: v.project.live || v.siteLive || o.known?.live === true });
      done = facts !== null && !programNeeds(facts, known).includes(p.step);
    }
    if (!done) continue;
    met.push(pid);
    back ??= { program_id: pid, line: backOnLine(p.step, card.title) };
  }
  if (checked.length === 0) return null;
  const next = { ...(read.seen.help_parked ?? {}) };
  for (const pid of checked) if (next[pid]) next[pid] = { ...next[pid], checked_at: now.toISOString() };
  for (const pid of met) delete next[pid];
  read.seen.help_parked = next;
  const unparked = { ...(read.seen.help_unparked ?? {}), ...Object.fromEntries(met.map((pid) => [pid, now.toISOString()])) };
  read.seen.help_unparked = unparked;
  // The check is this session's (said kept alive, its parts as they are), so a reply that says nothing new never makes
  // the next find look like a new session and check again.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('help_parked', ${sql().json(next as never)}::jsonb, 'help_unparked', ${sql().json(unparked as never)}::jsonb, 'said', ${saidSql([], now)})
    WHERE builder_id = ${id}`.catch(logged('help unpark'));
  return back;
}

/**
 * v4.8 Task 1: the path's facts for a ranked builder (reads only): the real fits, each open grant's gaps (Base from
 * base-qualify.ts qualifyOffer, another from programNeeds against needsKnown, read once a project: F5), the investor
 * programs closing within a week (odds left null until Task 3 reads them: F5), what to skip (`told`: toldIds), and
 * bestMove's choice. Never throws on its own reads.
 */
async function pathPlan(o: ViewIn, v: PathFacts, told: Set<string>, w: { wide?: boolean } = {}): Promise<PathPlan> {
  const { id, now, read } = o;
  // v4.8 Task 5 fix round 1 (6): `wide` (the programs answer only): every grant not applied to, entered or hidden gets
  // its gaps (drafted, parked by a no, Base's steps given or passed alike); never a move made from it, never a re-check.
  const seen: Seen = w.wide ? { ...read.seen, qualify_given: {} } : read.seen;
  const key = v.project.key;
  const recent = (at: string | undefined) => Boolean(at && now.getTime() - Date.parse(at) < DECLINE_MS);
  const skip = w.wide ? new Set([...told, ...o.skip]) : pathSkip(told, seen, now, o.skip);
  const metIds = new Set<string>();
  const cardOf = new Map(o.cards.map((c) => [c.id, c]));
  const fitRows = (o.applies ?? o.fits).filter((f) => realFit(f) && f.investment !== true);
  const fits: MoveProgram[] = fitRows.map((f) => {
    const c = cardOf.get(f.program_id);
    return c ? moveProgram(c) : { id: f.program_id, title: f.title, amount: f.amount, when: f.when, ends_at: f.ends_at, zone: 'UTC', investment: false };
  });
  const fitIds = new Set(fits.map((f) => f.id));
  const t = now.getTime();
  const investors: InvestorProgram[] = o.cards
    .filter((c) => c.investment === true && !skip.has(c.id) && showable({ ...c, investment: false }, now, skip)
      && c.ends_at && new Date(c.ends_at).getTime() > t && new Date(c.ends_at).getTime() - t <= INVESTOR_READ_MS)
    .map((c) => ({ ...moveProgram(c), odds: null }));
  // The gap engine: each open grant the project doesn't fit, with what it needs.
  const extra = new Map<string, { qualify?: QualifyOffer; needs?: string[] }>();
  const grantCards = o.cards.filter((c) => !fitIds.has(c.id) && !skip.has(c.id) && c.investment !== true && programKind(c).startsWith('grant') && showable(c, now, skip));
  const others = grantCards.filter((c) => c.id !== BASE_GRANTS_ID);
  const known = others.length > 0
    ? await needsKnown(id, key, { chains: [...v.chains, ...(o.known?.onBase ? ['base'] : [])], live: v.project.live || v.siteLive || o.known?.live === true })
    : null;
  const path = readPath(seen);
  // v4.8 Task 2: the program the builder is closing a gap on (gap), or was offered the draft of once its gap closed
  // (draft, not drafted yet): its closure is checked on every find.
  const closing = !w.wide && path?.program_id && (path.stage === 'gap' || (path.stage === 'draft' && !skip.has(path.program_id))) ? path.program_id : null;
  let closed: PathPlan['closed'] = null;
  let checking = false;
  const grants = (await Promise.all(grantCards.map(async (c): Promise<GapGrant | null> => {
    if (c.id === BASE_GRANTS_ID) {
      // A no to Base's steps (declined 'qualify:<key>') is a passed step, raised once when it is the one gap.
      const noKey = benchStepKey('qualify', key);
      const passed = recent(seen.declined?.[noKey]);
      const { [noKey]: _no, ...declined } = seen.declined ?? {};
      // Task 2: on Base's gap, the steps given (qualify_given) never hide it: the path tracks its gaps until closed.
      const { [key.toLowerCase()]: _given, ...given } = seen.qualify_given ?? {};
      const onIt = closing === c.id;
      const codes = onIt ? await codesConfirmed(o, key) : 'missing';
      if (codes === 'checking') checking = true;
      // Fix round 2 (F6): only a read that found every step met closes the gap (allMet); a failed read never does.
      let met = false;
      const offer = await qualifyOffer(id, key, { cards: o.cards, skip, seen: { ...seen, declined, ...(onIt && { qualify_given: given }) }, now, declineMs: DECLINE_MS, codesFetch: o.codesFetch, known: o.known, allMet: () => { met = true; } });
      if (met && !offer) metIds.add(c.id);
      if (onIt && codes === 'found' && met) closed = { program: moveProgram(c), org: grantOf(c)?.org ?? programName(c.title), codes: true };
      if (!offer || offer.steps.length === 0) return null;
      extra.set(c.id, { qualify: offer });
      // Fix round 1 (R1): a one-step only when that step is one the agent can do in the repo (Builder Codes).
      const doable = offer.steps.length === 1 && offer.steps[0] === 'codes';
      return { ...moveProgram(c), gaps: offer.steps, gap: qualifyGap(v.project.name, offer), passed, passedAt: passed ? seen.declined![noKey] : null, doable };
    }
    // Final review 9's rule: the facts from the Card, else the program row. Fix round 3: a failed row read is unknown, never
    // "no gap" (the grant is no move), so only a known read lets a grant be an apply-now move.
    const facts = c.needs_contract !== undefined && c.needs_live !== undefined ? c : await getProgramRow(c.id).catch(() => null);
    if (!facts || !known) return null;
    const needs = programNeeds(facts, known);
    extra.set(c.id, { needs });
    // Task 2: the path's grant with no gap left: closed.
    if (closing === c.id && needs.length === 0) closed = { program: moveProgram(c), org: programName(c.title), codes: false };
    // programNeeds' gaps (a chain's mainnet, a public repo, a live link) are never steps the agent does in the repo, so
    // never a one-step (fix round 1, R1). None: it can apply now (bestMove names it only when closing within 48 hours).
    const noAt = seen.declined?.[benchStepKey('needs', c.id)];
    return { ...moveProgram(c), gaps: needs, gap: needs.length > 0 ? needsWhy(v.project.name, c.title, needs) : '', passed: recent(noAt), passedAt: recent(noAt) ? noAt : null, doable: false };
  }))).filter((g): g is GapGrant => g !== null);
  // Fix round 1 (1): a grant raised in this session stays the move while the path is on it (its pointer answers).
  const live = !sessionOf(seen, now).fresh;
  const raisedNow = new Set(Object.entries(seen.path_raised ?? {}).filter(([, at]) => live && now.getTime() - Date.parse(at) < SESSION_MS).map(([k]) => k));
  const ctx: MoveCtx = { now, fits, grants, investors, skip, raised: new Set(Object.keys(seen.path_raised ?? {})), raisedNow, path };
  return { move: bestMove(ctx), facts: v, fitRows, extra, path, closed, checking, ctx, met: metIds };
}

/**
 * v4.8 Task 1: the path's reply for a plan bestMove filled (pathReply's hook). Its question is stored as the existing
 * asks (a fit or investor program: 'apply', whose yes drafts it; Base's gap: 'qualify'; another grant's: 'check_fits'),
 * so tell's yes and no work today. Fix round 2 (F5): the path, the session's parts said, the stored ask and a raised
 * passed step are one UPDATE. Never throws on its own writes.
 */
async function pathCommit(
  o: ViewIn, plan: PathPlan & { move: Exclude<Move, { kind: 'quiet' }> }, since: string | null = null,
  /** v4.8 Task 4: a sentence before the hook in its paragraph (it greets no one then), and the steps ask (never "Go?"). */
  pre: { inline?: string | null; steps?: boolean; keep?: boolean } = {},
): Promise<{ view: BenchView; fields: Reply; stand: Standing }> {
  const { id, now, read } = o;
  const { move, facts: v, fitRows, extra, path } = plan;
  const key = v.project.key;
  // F9: greeted by the X name's first word, else no name (never the handle). Task 3: the first hook after "sent" (the
  // path at track) follows the tracking line in the same reply, so it greets no one.
  const afterSent = path?.stage === 'track' && now.getTime() - Date.parse(path.at) < AFTER_SENT_MS;
  // Final review F4: greeted once a session (GREET_SAID), so a hand-off (a park, a no) never greets mid-reply.
  const session = sessionOf(read.seen, now);
  const first = !afterSent && !pre.inline ? greetingOf(read.xName, session.said) : null;
  // Fix round 1 (8): a hook that asked for the steps keeps asking for them on its pointer (Path.steps).
  const steps = pre.steps === true || (path?.steps === true && path.program_id === move.program.id);
  // Task 2 (F3, as before v4.8): what the caller's agent can do (agent-reach.ts); a hosted one does no step itself.
  const hosted = (o.reach ?? (await agentReach(o.own, id))).hosted;
  // Task 6 fix round 1 (review 4): Base's remaining steps, for its fact when the streak and live were said this session.
  const baseSteps = move.program.id === BASE_GRANTS_ID ? (extra.get(move.program.id)?.qualify?.steps ?? null) : null;
  const out0 = pathReply({ now, first, project: { name: v.project.name, live: v.project.live || v.siteLive }, streak: v.streak, move, said: session.said, hosted, steps, brief: o.brief === true, baseSteps });
  const out = first && out0.show_to_builder.startsWith(`${first}, `) ? { ...out0, said: [...out0.said, GREET_SAID] } : out0;
  const fit = fitRows.find((f) => f.program_id === out.program_id);
  const more = extra.get(out.program_id);
  // `path`: a no to it also parks the program for the path ('path:<id>', DECLINE_MS): never asked again this session.
  // The hook asked "Want the steps?", so its yes is the gap stage's steps (Task 2), for either agent. Fix round 2 (F10):
  // its "Go?" (one step a local agent can do) is stored as the gap ask, so its yes is the agent doing it.
  const stored: Record<string, unknown> = out.reply === 'start'
    ? { kind: 'apply', key, program_id: out.program_id, path: true, ...(fit?.repo && { repo: fit.repo }) }
    : more?.qualify
      ? {
          kind: 'qualify', key, program_id: out.program_id, program: move.program.title, path: true, ...(out.reply === 'go' && { gap: true }),
          qualify: { grant: more.qualify.grant, steps: more.qualify.steps, first: more.qualify.steps[0], name: v.project.name, hosted, codes_missing: more.qualify.missing.includes('codes') },
        }
      : { kind: 'check_fits', key, program: move.program.title, program_id: out.program_id, needs: more?.needs ?? [], name: v.project.name, path: true };
  // Task 2: a builder past the hook on this program keeps their stage (the hook's words again are its pointer).
  const nextPath: Path = {
    stage: path && path.program_id === out.program_id && path.stage !== 'hook' ? path.stage : out.stage, program_id: out.program_id, at: now.toISOString(),
    // v4.8 Task 4: the closest money offered for a pick that doesn't fit stays the path's program (`keep`), as a pick.
    ...(((path?.picked && path.program_id === out.program_id) || pre.keep) && { picked: true as const }),
    ...(steps && out.reply === 'steps' && { steps: true as const }),
  };
  // Task 5 fix round 1 (5): the brief pointer never says the passed-step line, so it raises nothing (said later in full).
  const raise = move.kind === 'closest' && move.raise && out.said.length > 0 && !o.brief;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
      || jsonb_build_object('path', ${sql().json(nextPath as never)}::jsonb, 'bench_ask', ${sql().json(stored as never)}::jsonb, 'said', ${saidSql(out.said, now)})
      || CASE WHEN ${raise} THEN jsonb_build_object('path_raised', COALESCE(standing_seen->'path_raised', '{}'::jsonb)
           || jsonb_build_object(${out.program_id}::text, ${now.toISOString()}::text)) ELSE '{}'::jsonb END
    WHERE builder_id = ${id}`.catch(logged('path'));
  // v3.1 Task 7, kept: hooking Base's grant as a fit starts its Builder Codes check in the background (for the draft).
  if (out.program_id === BASE_GRANTS_ID && out.reply === 'start') await codesFor(id, key, now, o.codesFetch);
  const kind = stored.kind as BenchAskKind;
  const note = kind === 'apply' ? APPLY_NOTE : kind === 'qualify' ? QUALIFY_NOTE : CHECK_FITS_ASK_NOTE;
  const view: BenchView = {
    state: v.state, variant: v.variant, project: v.project, rank: read.ranks.bench, streak: v.streak, target: null, handle: v.handle, link: null,
    fund: [], due: [], ask: { kind, project_key: key, line: '', program_id: out.program_id }, held: null,
    path: withSince(since, pre.inline ? `${pre.inline} ${out.show_to_builder}` : out.show_to_builder), pathLead: out.reply === 'start' ? { program_id: out.program_id, ...(fit?.repo && { repo: fit.repo }) } : null,
  };
  const rankLines = [read.ranks.bench, ...read.ranks.chains.map((c) => c.line)].filter((x): x is string => Boolean(x));
  const fields: Reply = {
    move_up: { kind, project_key: key, agent_note: note },
    ...(rankLines.length > 0 && { rank_lines: rankLines }),
    ...standingFields(v.stand),
  };
  return { view, fields, stand: v.stand };
}

/** Final review F4: the session key a greeting ("Jenil, ") is said under: once a session. */
const GREET_SAID = 'greet';
/** Final review F4: the X name's first word to greet with, unless greeted this session; null with no name (F9). Pure. */
const greetingOf = (xName: string | null, said: ReadonlySet<string>) => {
  if (!xName || said.has(GREET_SAID)) return null;
  const f = firstName(xName, null);
  return f && f !== 'there' ? f : null;
};

/** v4.8 Task 3: a fresh session's "Since {day}: ..." line before the step's own words (one paragraph). Pure. */
const withSince = (since: string | null, show: string) => (since ? `${since}\n\n${show}` : show);

/**
 * v4.8 Task 3 fix round 1 (5): the builder met `programId` before: on the stored path, the stored ask, asked to apply,
 * drafted, raised, given its steps (Base) or said no to. Pure.
 */
function seenBefore(seen: Seen, programId: string, key: string): boolean {
  const path = readPath(seen);
  const declined = Object.keys(seen.declined ?? {});
  return path?.program_id === programId || seen.bench_ask?.program_id === programId
    || Boolean(seen.apply_asked?.[programId] || seen.apply_yes?.[programId] || seen.path_raised?.[programId])
    || Boolean(seen.help_parked?.[programId] || seen.help_unparked?.[programId])
    || declined.some((k) => k === `apply:${programId}` || k === `path:${programId}` || k === `needs:${programId}`)
    || (programId === BASE_GRANTS_ID && (declined.includes(benchStepKey('qualify', key)) || Boolean(seen.qualify_given?.[key.toLowerCase()])));
}

/**
 * v4.8 Task 3: what changed since the last session, for a fresh one only (sessionOf; the last session is
 * standing_seen.said.at), from stored facts: the streak then (streak.ts over the stored weeks, as of that day; only across
 * an ISO week, as a streak moves by weeks) and now; the last public daily score on or before that day (builder_scores,
 * this calibration, from that day or the one before, so a stale row never stands for then) and the page's score now;
 * the path's program opened since and new to this builder (programs.opened_at, seenBefore); it closing within 48 hours
 * (submitBy's words), when the step's own words don't say so (`saysClose`). Fix round 1: results announced since are
 * not repeated here (find's alerts opener, "Since you last checked: ...", already leads with them). A side not stored leaves that part out. Null when nothing changed or it isn't a new session. Never throws.
 */
async function sinceFor(o: ViewIn, v: Pick<PathFacts, 'streak' | 'stand' | 'project'>, focus: { program: MoveProgram; saysClose: boolean } | null): Promise<string | null> {
  const { id, now, read } = o;
  // Task 5 fix round 1 (5): never after a direct answer (it says the facts; the step stays short).
  if (o.brief || !sessionOf(read.seen, now).fresh) return null;
  const at = (read.seen.said as { at?: unknown } | undefined)?.at;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  const last = new Date(at);
  const day = last.toISOString().slice(0, 10);
  const quiet = <T,>(what: string, fallback: T) => (err: unknown) => {
    logged(what)(err);
    return fallback;
  };
  const [then, before, opened] = await Promise.all([
    isoWeekOf(last) !== isoWeekOf(now) ? streaksFor([id], last).then((m) => m.get(id)?.streak ?? null).catch(quiet('since streak', null)) : Promise.resolve(null),
    v.stand.score !== null
      ? sql()<{ score: number }[]>`SELECT s.score FROM builder_scores s WHERE s.builder_id = ${id} AND s.day <= ${day}::date AND s.day >= ${day}::date - 1
          AND s.calibration = ${LIVE_CALIBRATION_V2} AND s.ranked AND ${publicRow()}
          AND EXISTS (SELECT 1 FROM builder_live l WHERE l.builder_id = ${id} AND l.calibration = s.calibration)
          ORDER BY s.day DESC LIMIT 1`.catch(quiet('since score', []))
      : Promise.resolve([]),
    focus ? sql()<{ opened_at: Date | null }[]>`SELECT opened_at FROM programs WHERE id = ${focus.program.id}`.catch(quiet('since opened', [])) : Promise.resolve([]),
  ]);
  const f = focus?.program;
  const facts: SinceFacts = {
    last: at,
    streak: then !== null ? { before: then, now: v.streak } : null,
    score: before[0] && v.stand.score !== null ? { before: Number(before[0].score), now: v.stand.score } : null,
    // Fix round 1 (5): "opened" only for a program new to this builder: opened after the last session and never on their
    // path, asked, drafted, raised or said no to (a reopened program they're on is no news; opened_at alone resets).
    opened: f && opened[0]?.opened_at && new Date(opened[0].opened_at).getTime() > last.getTime() && !seenBefore(read.seen, f.id, v.project.key) ? [programName(f.title)] : [],
    // Fix round 1 (6): the close as the submit step says it ("tomorrow 11:59 PM PT"), in the program's zone.
    closing: f && !focus.saysClose && f.ends_at && f.when !== 'rolling' && Date.parse(f.ends_at) > now.getTime() && Date.parse(f.ends_at) - now.getTime() <= NOW_WINDOW_MS
      ? { program: programName(f.title), when: submitBy(f.ends_at, f.zone, now, zoneAbbr(f.zone)) } : null,
  };
  return sinceLine(facts, now);
}

/**
 * v4.8 Task 3: the program the path waits at submit for ("sent" not said yet): still open, never told about (any
 * status), entered, hidden or parked (a no within DECLINE_MS). Null otherwise (the path moves on). Pure.
 */
function submitWaiting(o: ViewIn, told: Set<string>): Card | null {
  const path = readPath(o.read.seen);
  // Re-review blocker 2: an application set aside by a second no (submit_wait) waits too, from the next session.
  const pid = path?.stage === 'submit' && path.program_id ? path.program_id : o.read.seen.submit_wait ?? null;
  if (!pid) return null;
  const session = sessionOf(o.read.seen, o.now);
  if (!session.fresh && session.said.has(`submit_skip:${pid}`)) return null;
  // Drafted is no reason here (the draft is the point), so apply_yes is left out of the skip.
  if (pathSkip(told, { ...o.read.seen, apply_yes: {} }, o.now, o.skip).has(pid)) return null;
  const c = o.cards.find((x) => x.id === pid);
  if (!c || (c.ends_at && new Date(c.ends_at).getTime() <= o.now.getTime())) return null;
  return c;
}

/**
 * v4.8 Task 3: a find while the path waits at submit: one line that points back, never the full draft again
 * (conversation.ts submitPointer: "Your {program} application is ready to submit, closes {when}. Reply "sent" once it's
 * in."). The submit ask is stored again (a no parks it, a yes is "sent"). One UPDATE. Never throws on its own writes.
 */
async function pathSubmitCommit(o: ViewIn, v: PathFacts, card: Card, since: string | null): Promise<{ view: BenchView; fields: Reply; stand: Standing }> {
  const { id, now, read } = o;
  const key = v.project.key;
  const stored = { kind: 'apply', key, program_id: card.id, path: true, submit: true };
  const nextPath: Path = { stage: 'submit', program_id: card.id, at: now.toISOString() };
  await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) - 'submit_wait')
      || jsonb_build_object('path', ${sql().json(nextPath as never)}::jsonb, 'bench_ask', ${sql().json(stored as never)}::jsonb, 'said', ${saidSql([`submit:${card.id}`], now)})
    WHERE builder_id = ${id}`.catch(logged('path submit'));
  const view: BenchView = {
    state: v.state, variant: v.variant, project: v.project, rank: read.ranks.bench, streak: v.streak, target: null, handle: v.handle, link: null,
    fund: [], due: [], ask: { kind: 'apply', project_key: key, line: '', program_id: card.id }, held: null,
    path: withSince(since, submitPointer(moveProgram(card), now)), pathLead: { program_id: card.id }, pathNote: SENT_NOTE.replace(/ Don't show this note\.$/, ''),
  };
  const rankLines = [read.ranks.bench, ...read.ranks.chains.map((c) => c.line)].filter((x): x is string => Boolean(x));
  return { view, fields: { move_up: { kind: 'apply', project_key: key, agent_note: SENT_NOTE }, ...(rankLines.length > 0 && { rank_lines: rankLines }), ...standingFields(v.stand) }, stand: v.stand };
}

/**
 * Fix round 1 (T2-4): a find while the path is at `gap` on the program bestMove kept (the steps already given):
 * conversation.ts gapStillReply, "Still on {program}: {first remaining step}. {proof} Want me to do it now?" (the help
 * ask for a hosted agent or a step it can't do). The gap ask is stored again (gap: true, path), so a yes is the step and
 * a no parks the program; the session is kept alive. Null with no remaining step known (the hook answers). One UPDATE.
 */
async function pathGapCommit(o: ViewIn, plan: PathPlan & { move: Exclude<Move, { kind: 'quiet' }> }, since: string | null = null): Promise<{ view: BenchView; fields: Reply; stand: Standing } | null> {
  const { id, now, read } = o;
  const { move, facts: v, extra } = plan;
  const key = v.project.key;
  const pid = move.program.id;
  const more = extra.get(pid);
  const hosted = (o.reach ?? (await agentReach(o.own, id))).hosted;
  const stored: NonNullable<Seen['bench_ask']> = more?.qualify
    ? {
        kind: 'qualify', key, program_id: pid, program: move.program.title, path: true, gap: true,
        qualify: { grant: more.qualify.grant, steps: more.qualify.steps, first: more.qualify.steps[0], name: v.project.name, hosted, codes_missing: more.qualify.missing.includes('codes') },
      }
    : { kind: 'check_fits', key, program_id: pid, program: move.program.title, needs: more?.needs ?? [], name: v.project.name, path: true, gap: true };
  const { title, steps } = await gapStepsOf(stored);
  if (steps.length === 0) return null;
  // Task 6 fix round 1 (review 1): after the help yes ("Say ok once it's done"), the done ask stays (final review F3: an
  // ok not done is parked by benchView before this runs).
  const helping = read.seen.bench_ask?.help === true && read.seen.bench_ask.program_id === pid ? read.seen.bench_ask : null;
  if (helping) Object.assign(stored, { help: true, checking: true, checks: helping.checks ?? 0 });
  const session = sessionOf(read.seen, now);
  const said = session.said;
  // Final review F5: a fresh session with nothing new to lead ("Since") says the money once, then the step.
  const money = session.fresh && !since && !o.brief && !said.has(`money:${pid}`);
  const greet = money ? greetingOf(read.xName, said) : null;
  const p = move.program;
  const closes = p.ends_at !== null && p.when !== 'rolling' ? closeWords(p.ends_at, p.zone, now) : null;
  // Task 6 fix round 1 (review 4): one proof a session per fact.
  const proof = o.brief || (helping && !money) ? null : gapProofOf({ name: v.project.name, live: v.project.live || v.siteLive }, v.streak, more?.qualify ? more.qualify.steps : null, said);
  const still = gapStillReply(title, steps, hosted, proof?.line ?? null, money ? { first: greet, amount: p.amount, closes } : null);
  // Final review F3 (the parked T4 copy): while the agent helps, a find never says the step again (a fresh session's
  // money line aside); the done ask stays the one easy reply.
  const out = !helping ? still
    : money ? { show_to_builder: `${still.show_to_builder.replace(/ Want (?:help with it|me to do it) now\?$/, '')} ${HELP_DONE_ASK}`, reply: 'help' as const }
      : { show_to_builder: helpWaiting(title), reply: 'help' as const };
  const keys = [...(proof?.keys ?? []), ...(money ? [`money:${pid}`] : []), ...(greet ? [GREET_SAID] : [])];
  const nextPath: Path = { stage: 'gap', program_id: pid, at: now.toISOString(), ...(plan.path?.picked && { picked: true as const }) };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
      || jsonb_build_object('path', ${sql().json(nextPath as never)}::jsonb, 'bench_ask', ${sql().json(stored as never)}::jsonb, 'said', ${saidSql(keys, now)})
    WHERE builder_id = ${id}`.catch(logged('path gap'));
  const kind = stored.kind as BenchAskKind;
  const note = kind === 'qualify' ? QUALIFY_NOTE : CHECK_FITS_ASK_NOTE;
  const view: BenchView = {
    state: v.state, variant: v.variant, project: v.project, rank: read.ranks.bench, streak: v.streak, target: null, handle: v.handle, link: null,
    fund: [], due: [], ask: { kind, project_key: key, line: '', program_id: pid }, held: null, path: withSince(since, out.show_to_builder), pathLead: null,
  };
  const rankLines = [read.ranks.bench, ...read.ranks.chains.map((c) => c.line)].filter((x): x is string => Boolean(x));
  return { view, fields: { move_up: { kind, project_key: key, agent_note: note }, ...(rankLines.length > 0 && { rank_lines: rankLines }), ...standingFields(v.stand) }, stand: v.stand };
}

/** Fix round 2 (F3): the reply while the Builder Codes re-check goes on in the background. */
export const CHECKING_LINE = "I'm checking the code now. Give it a minute, then say ok.";
export const CHECKING_NOTE = "When they say ok, call tell with move_up: { kind: 'qualify', project_key, answer: 'yes' } (a no: answer 'no'), then follow its note (EarnKit is reading their code on GitHub). Don't show this note.";
/** Fix round 2 (F3): the path reply while the re-check runs: nothing stored but the session kept alive. */
async function pathCheckingView(o: ViewIn, plan: PathPlan): Promise<{ view: BenchView; fields: Reply; stand: Standing }> {
  const { id, now, read } = o;
  const v = plan.facts;
  const key = v.project.key;
  // Fix round 3 (5): its own ask (the gap ask, `checking`): a no parks Base, an ok (a yes) re-checks.
  const q = plan.extra.get(BASE_GRANTS_ID)?.qualify;
  const stored = {
    kind: 'qualify', key, program_id: BASE_GRANTS_ID, path: true, gap: true, checking: true,
    ...(q && { qualify: { grant: q.grant, steps: q.steps, first: q.steps[0], name: v.project.name, codes_missing: q.missing.includes('codes') } }),
  };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
      || jsonb_build_object('bench_ask', ${sql().json(stored as never)}::jsonb, 'said', ${saidSql([], now)})
    WHERE builder_id = ${id}`.catch(logged('path checking'));
  const view: BenchView = {
    state: v.state, variant: v.variant, project: v.project, rank: read.ranks.bench, streak: v.streak, target: null, handle: v.handle, link: null,
    fund: [], due: [], ask: { kind: 'qualify', project_key: key, line: '', program_id: BASE_GRANTS_ID }, held: null, path: CHECKING_LINE, pathLead: null, pathNote: CHECKING_NOTE.replace(/ Don't show this note\.$/, ''),
  };
  return { view, fields: { move_up: { kind: 'qualify', project_key: key, agent_note: QUALIFY_NOTE }, ...standingFields(v.stand) }, stand: v.stand };
}

/**
 * v4.8 Task 2: the reply once the path's gap is closed (conversation.ts gapClosedReply: Base, "Builder Codes are in. You
 * now meet Base's first requirement. Want me to draft the Base application next?"). The path moves to `draft`; the
 * question is stored as the apply ask (path), so a yes is the draft and a no parks the program. Said once a session;
 * again, the hook's one-line pointer. One UPDATE. Never throws on its own writes.
 */
async function pathClosedCommit(o: ViewIn, plan: PathPlan & { closed: NonNullable<PathPlan['closed']> }, since: string | null = null): Promise<{ view: BenchView; fields: Reply; stand: Standing }> {
  const { id, now, read } = o;
  const { closed, facts: v } = plan;
  const key = v.project.key;
  const pid = closed.program.id;
  const saidKey = `closed:${pid}`;
  const again = sessionOf(read.seen, now).said.has(saidKey);
  // Fix round 1 (T2-6): one proof line (Base closed: every step met, so live on Base).
  // Task 6 fix round 1 (review 4): one proof a session per fact.
  const proofOut = o.brief ? null : gapProofOf({ name: v.project.name, live: v.project.live || v.siteLive }, v.streak, closed.program.id === BASE_GRANTS_ID ? [] : null, sessionOf(read.seen, now).said);
  const proof = proofOut?.line ?? null;
  // Task 3: a fresh session with something changed (target A, "Two days later"): what changed, the program still open
  // and its gap closed, then the draft offer.
  const show = since ? `${since} ${stillOpenLine(closed.program.title, closed.codes)}\n\n${DRAFT_NOW_ASK}`
    : again ? `Your ${programName(closed.program.title)} application is still the next move. Want me to start?` : gapClosedReply({ org: closed.org, title: closed.program.title, codes: closed.codes, proof });
  const stored = { kind: 'apply', key, program_id: pid, path: true };
  const nextPath: Path = { stage: 'draft', program_id: pid, at: now.toISOString(), ...(plan.path?.picked && plan.path.program_id === pid && { picked: true as const }) };
  await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) - 'gap_did')
      || jsonb_build_object('path', ${sql().json(nextPath as never)}::jsonb, 'bench_ask', ${sql().json(stored as never)}::jsonb, 'said', ${saidSql(again ? [] : [saidKey, ...(since ? [] : (proofOut?.keys ?? []))], now)})
    WHERE builder_id = ${id}`.catch(logged('path closed'));
  const view: BenchView = {
    state: v.state, variant: v.variant, project: v.project, rank: read.ranks.bench, streak: v.streak, target: null, handle: v.handle, link: null,
    fund: [], due: [], ask: { kind: 'apply', project_key: key, line: '', program_id: pid }, held: null, path: show, pathLead: { program_id: pid },
  };
  const rankLines = [read.ranks.bench, ...read.ranks.chains.map((c) => c.line)].filter((x): x is string => Boolean(x));
  return { view, fields: { move_up: { kind: 'apply', project_key: key, agent_note: APPLY_NOTE }, ...(rankLines.length > 0 && { rank_lines: rankLines }), ...standingFields(v.stand) }, stand: v.stand };
}

/*
 * v4.8 Task 4: the new builder (target conversation B): the opener before GitHub is connected, the pick, and the first
 * reply after connecting (conversation.ts openerReply, pickedReply, connectedLine, noFitWhy).
 */
/** The opener's money for a program: "$5K to $100K" with a stated minimum below the top, else pathAmount's. Pure. */
const openerAmount = (c: Card): string | null =>
  c.min_award_usd && c.max_award_usd && c.min_award_usd < c.max_award_usd ? `${usdCompact(c.min_award_usd)} to ${usdCompact(c.max_award_usd)}` : pathAmount(c);
const openerProgram = (c: Card): OpenerProgram => ({ id: c.id, title: c.title, amount: openerAmount(c), when: fundWhen(c), investment: c.investment === true });
/**
 * The opener's programs, from the live cards (fix round 0 (1), target B's order): 1. Base Builder Grants (the closest
 * money, the grant the signed-out reply already named), or with it closed or not shown, the best rolling grant (the most
 * money among the rolling ones); 2. the largest other open grant by money; 3. the soonest-closing open investor
 * program. Each is skipped when there is none, so fewer than 3 are numbered as they come. Never an entered or hidden
 * program (`skip`), a sponsor's or an EarnKit campaign (showable). Pure.
 */
export function openerPrograms(cards: Card[], now: Date, skip: Set<string>): OpenerProgram[] {
  const grants = cards
    .filter((c) => c.investment !== true && programKind(c).startsWith('grant') && showable(c, now, skip) && (c.max_award_usd ?? 0) > 0)
    .sort((a, b) => (b.max_award_usd ?? 0) - (a.max_award_usd ?? 0) || byRelevance(a, b));
  const top = grants.find((c) => c.id === BASE_GRANTS_ID) ?? grants.find((c) => fundWhen(c) === 'rolling');
  const rolling = grants.find((c) => c !== top);
  const investor = cards
    .filter((c) => c.investment === true && showable({ ...c, investment: false }, now, skip))
    .sort((a, b) => closeAt(a) - closeAt(b) || byRelevance(a, b))[0];
  return [top, rolling, investor].filter((c): c is Card => Boolean(c)).map(openerProgram);
}
/**
 * The opener's stored list (standing_seen.opener: ids and titles, in the order shown), so a number resolves to what the
 * builder saw; a list stored without titles takes them from the cards (null when one is gone). Null when none. Pure.
 */
function openerShown(seen: Seen, cards: Card[]): Pick<OpenerProgram, 'id' | 'title'>[] | null {
  const ids = seen.opener?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string')) return null;
  const titles = seen.opener?.titles;
  if (Array.isArray(titles) && titles.length === ids.length && titles.every((x) => typeof x === 'string'))
    return (ids as string[]).map((id, i) => ({ id, title: (titles as string[])[i] }));
  const list = (ids as string[]).map((id) => cards.find((c) => c.id === id));
  return list.every((c): c is Card => Boolean(c)) ? list.map((c) => ({ id: c.id, title: c.title })) : null;
}
/** The opener record stored with a list shown (fix round 1 (5): titles too, so a closed pick can still be named). */
const openerRecord = (programs: OpenerProgram[], now: Date) => ({ ids: programs.map((p) => p.id), titles: programs.map((p) => p.title), at: now.toISOString() });
type Pick_ = { id: string; title: string } | { gone: string; applied: boolean } | 'outside' | null;
/**
 * find {program} against the opener's list: a program shown and still open to them (its id and title), `gone` (fix round
 * 1 (5): closed, not shown to them now, or told applied: one line and the list again), 'outside' (a number past the
 * list, no list kept) or null (nothing named, or a name not on it). Taken only until the connected line is said, and
 * (fix round 1 (4)) never over a path past the hook on another program unless the list was shown after that path moved.
 * A pick stores the path's program at `hook`, picked. Never throws.
 */
async function takePick(o: ViewIn): Promise<Pick_> {
  const seen = o.read.seen;
  if (!o.named?.trim() || !o.personal || o.shared || !seen.opener || seen.connected_said) return null;
  const list = openerShown(seen, o.cards);
  if (!list) return 'outside';
  const hit = resolvePick(o.named, list);
  if (hit === null || hit === 'outside') return hit;
  const title = list.find((p) => p.id === hit)!.title;
  const path = readPath(seen);
  const shownAt = Date.parse(seen.opener.at ?? '');
  if (path && path.stage !== 'hook' && path.program_id !== hit && !(shownAt > Date.parse(path.at))) return null;
  const card = o.cards.find((c) => c.id === hit);
  const told = (await toldIds(o.id)) ?? new Set<string>();
  if (told.has(hit)) return { gone: title, applied: true };
  if (!card || !showable({ ...card, investment: false }, o.now, o.skip)) return { gone: title, applied: false };
  // Final review 9 (the parked T4 item): the same program picked again keeps its stage (a lazy "1" again after connecting).
  if (path && path.program_id === hit && path.stage !== 'hook') return { id: hit, title };
  const next: Path = { stage: 'hook', program_id: hit, at: o.now.toISOString(), picked: true };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('path', ${sql().json(next as never)}::jsonb)
    WHERE builder_id = ${o.id}`.catch(logged('pick'));
  // This reply reads the pick too.
  seen.path = next;
  return { id: hit, title };
}
/**
 * v4.8 last ruling 1: a program's name after the programs answer (said this session) on a ranked page: the path's
 * program, picked. It is an explicit choice, so it clears that program's own no (and, for Base's grant, its passed
 * steps), never another's. Null when no list was given this session or nothing open matches. Never throws.
 */
async function takeListPick(o: ViewIn): Promise<{ id: string; title: string } | null> {
  const seen = o.read.seen;
  if (!o.named?.trim() || !o.personal || o.shared) return null;
  if (![...sessionOf(seen, o.now).said].some((k) => k.startsWith('ask:programs:'))) return null;
  const told = (await toldIds(o.id)) ?? new Set<string>();
  const list = o.cards.filter((c) => !told.has(c.id) && showable({ ...c, investment: false }, o.now, new Set())).map((c) => ({ id: c.id, title: c.title }));
  const hit = resolvePick(o.named, list);
  if (hit === null || hit === 'outside') return null;
  const title = list.find((p) => p.id === hit)!.title;
  const drop = Object.keys(seen.declined ?? {}).filter((k) => k === `apply:${hit}` || k === `path:${hit}` || k === `needs:${hit}`
    || (hit === BASE_GRANTS_ID && k.startsWith('qualify:')));
  const declined = Object.fromEntries(Object.entries(seen.declined ?? {}).filter(([k]) => !drop.includes(k)));
  const parked = Object.fromEntries(Object.entries(seen.help_parked ?? {}).filter(([k]) => k !== hit));
  const next: Path = { stage: 'hook', program_id: hit, at: o.now.toISOString(), picked: true };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('path', ${sql().json(next as never)}::jsonb,
      'declined', ${sql().json(declined as never)}::jsonb, 'help_parked', ${sql().json(parked as never)}::jsonb)
    WHERE builder_id = ${o.id}`.catch(logged('list pick'));
  // This reply reads the pick too.
  Object.assign(seen, { path: next, declined, help_parked: parked });
  return { id: hit, title };
}
/** Fix round 1 (5): the one line for a pick no longer open to them. Pure. */
const pickGoneLine = (title: string, applied: boolean) => (applied ? `You've already applied to ${programName(title)}.` : `${programName(title)} isn't open now.`);
/**
 * The signed-out reply (target B's opener): the opener once a session (its list stored), a pick's "Got it", a pick no
 * longer open (its line, then the list again, fresh and stored), or the list again in one short line (a number outside
 * it, a name not on it, or the opener said already this session). One link, the sign-in link the signed-out reply
 * already uses. Null with no program to number (the setup reply answers). The sign-in step stays the stored ask. One
 * UPDATE. Never throws on its own writes.
 */
async function openerView(o: ViewIn, link: string, pick: Pick_, stand: Standing): Promise<{ view: BenchView; fields: Reply; stand: Standing } | null> {
  const { id, now, read } = o;
  // Fix round 1 (5): never a program they told EarnKit they applied to.
  const told = (await toldIds(id)) ?? new Set<string>();
  const programs = openerPrograms(o.cards, now, new Set([...o.skip, ...told]));
  if (programs.length === 0) return null;
  const said = sessionOf(read.seen, now).said;
  const shown = openerShown(read.seen, o.cards);
  let show: string;
  let opener: Record<string, unknown> | null = null;
  if (pick && typeof pick === 'object' && 'id' in pick) show = pickedReply(pick.title, link, false);
  else if (pick && typeof pick === 'object') {
    show = `${pickGoneLine(pick.gone, pick.applied)} ${openerAgain(programs, link, false)}`;
    opener = openerRecord(programs, now);
  } else if (shown && (pick === 'outside' || o.named?.trim() || said.has('opener'))) show = openerAgain(shown, link, false);
  else {
    show = openerReply({ total: moneyText(openMoneyUsd(o.cards, now)), programs, link, github: false });
    opener = openerRecord(programs, now);
  }
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
      || CASE WHEN ${opener !== null} THEN jsonb_build_object('opener', ${sql().json((opener ?? {}) as never)}::jsonb) ELSE '{}'::jsonb END
      || jsonb_build_object('said', ${saidSql(opener && !(pick && typeof pick === 'object') ? ['opener'] : [], now)}, 'bench_ask', ${sql().json({ kind: 'sign_in', key: null } as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('opener'));
  const view: BenchView = {
    state: 'signed_out', variant: null, project: null, rank: null, streak: stand.streak, target: null, handle: null, link,
    fund: [], due: [], ask: { kind: 'sign_in', project_key: null, line: '' }, held: null, path: show, pathLead: null, pathNote: OPENER_NOTE,
  };
  // The sign-in step stays the stored ask (a "done" or yes to connecting is tell's sign_in, as before).
  return { view, fields: { move_up: { kind: 'sign_in', project_key: null, agent_note: BENCH_MOVE_UP_NOTE }, ...standingFields(stand) }, stand };
}
/**
 * Why the pick isn't the hook, in one line (conversation.ts noFitWhy), from facts EarnKit holds: the path's gaps for
 * that grant (Base's sentence; another grant's programNeeds), else its one chain the project isn't on. Null when none is
 * known (the sentence is left out). Pure.
 */
function pickWhy(plan: PathPlan, cards: Card[], pick: string, known: ViewIn['known']): string | null {
  const v = plan.facts;
  const g = plan.ctx.grants.find((x) => x.id === pick);
  const c = cards.find((x) => x.id === pick);
  const title = c?.title ?? g?.title;
  if (!title) return null;
  // Task 5 fix round 1 (1): the one fact rule the programs answer's fit cell reads (cardFact, conversation.ts grantFact).
  const mine = myChains(v, known);
  const f = c ? cardFact(c, g?.gaps ?? null, mine) : grantFact(g?.gaps ?? null, [], mine, chainName);
  if (f.kind === 'steps') return noFitWhy(title, g?.id === BASE_GRANTS_ID ? { name: v.project.name, gap: g.gap } : { name: v.project.name, needs: f.gaps });
  if (f.kind === 'chain') return noFitWhy(title, { name: v.project.name, chain: f.chain });
  return null;
}
/**
 * The first path reply after connecting, for a builder who saw the opener (target B's second message, once): the
 * connected line, then the pick's fit. The pick bestMove keeps (a fit, the investor program, a grant on the path) is
 * hooked as always; a pick that is no move gets why (pickWhy, when known) and the closest money: the closest grant
 * with its gap, asked "Want the steps?" (else the path's next move). No pick: the path's move. Null with nothing to
 * hook (the line waits). Never throws on its own writes.
 */
async function connectedCommit(o: ViewIn, plan: PathPlan): Promise<{ view: BenchView; fields: Reply; stand: Standing } | null> {
  const { id, now, read } = o;
  const v = plan.facts;
  const pick = plan.path?.picked && plan.path.stage === 'hook' ? plan.path.program_id : null;
  const st = read.base.standing;
  // Task 5 fix round 1 (2): a rank only inside the leaderboard's pool (rankLines' listed), as the page pill.
  const line = connectedLine({ page: pageUrl(v.handle), score: v.stand.score, rank: st.ranked && read.ranks.listed ? { n: st.rank, m: st.total } : null });
  let commit: () => Promise<{ view: BenchView; fields: Reply; stand: Standing }>;
  if (!pick) {
    if (plan.move.kind === 'quiet') return null;
    const move = plan.move;
    commit = () => pathCommit(o, { ...plan, move }, line);
  } else {
    // Fix round 1 (2): the pick whenever it is a move on its own; else the real top move (fits kept, investors left out).
    const h = pickHook(plan.ctx, pick);
    if (!h) return null;
    // Fix round 0 (7): a picked investor program outside the path's window: why it waits, before the closest money.
    const card = o.cards.find((c) => c.id === pick);
    const later = !h.pick && card?.investment === true && !plan.ctx.investors.some((p) => p.id === pick) ? investorLater(card.title) : null;
    commit = h.pick
      ? () => pathCommit(o, { ...plan, move: h.move }, line, { keep: true })
      : () => pathCommit(o, { ...plan, move: h.move }, line, { inline: later ?? pickWhy(plan, o.cards, pick, o.known), steps: h.steps, keep: true });
  }
  // Fix round 0 (5): once a builder (standing_seen.connected_said, claimed in one guarded UPDATE before it is shown), so
  // it never repeats, whatever later rewrites the opener record.
  const [claimed] = await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connected_said', ${now.toISOString()}::text)
    WHERE builder_id = ${id} AND NOT COALESCE(standing_seen ? 'connected_said', false) RETURNING 1`.catch((err: unknown) => {
    logged('connected said')(err);
    return [];
  });
  if (!claimed) return null;
  return commit();
}

/**
 * v4.8 Task 5: find's direct question answered (target conversation C), from stored facts only, or its one pointer
 * line when this session already answered it (standing_seen.said `ask:<question>`). Standing: the page's score and
 * rank ("#N of M builders so far", rank.ts rankWords, the pill's own standing), the streak, the live link, the page.
 * Programs: the open grants not applied to or entered (applied: anything told to EarnKit), each with its fit from the
 * path's facts (a real fit, the gap engine's steps, else "Not yet"), then the open investor programs apart (never a fit,
 * never summed), soonest first, with what each is (the program file's first sentence). Null without a question.
 */
async function directAnswer(o: ViewIn, v: PathFacts, told: Set<string>): Promise<{ text: string; key: string } | null> {
  const q = o.question;
  if (!q) return null;
  const { now, read } = o;
  const said = sessionOf(read.seen, now).said;
  if (q === 'standing') {
    const f: StandingFacts = {
      // Fix round 1 (2): a rank only inside the leaderboard's pool (rankLines' listed, the page pill's own rule).
      score: v.stand.score, rank: v.stand.score !== null && read.ranks.listed ? rankWords(read.base.standing) : null, streak: v.streak,
      // Fix round 1 (10): "live at" only from a link EarnKit checked (live-check.ts, this reply's read of it).
      liveAt: v.siteLive && read.liveUrl ? linkHost(read.liveUrl) : null, page: pageUrl(v.handle),
    };
    const key = ASK_SAID(q, standingSaid(f));
    return { key, text: said.has(key) ? standingAgain(f) : standingAnswer(f) };
  }
  // Fix round 1 (6): the wide plan reads every grant not applied to (drafted and parked ones too), never a move.
  const p = await pathPlan(o, v, told, { wide: true });
  const applied = new Set([...told, ...o.skip]);
  const fitIds = new Set(p.fitRows.map((f) => f.program_id));
  const gapsOf = new Map(p.ctx.grants.map((g) => [g.id, g.gaps]));
  const mine = myChains(v, o.known);
  const factOf = (c: Card): GrantFact => draftedRecently(read.seen, c.id, now) ? { kind: 'drafted' } : p.met.has(c.id) ? { kind: 'met' } : cardFact(c, gapsOf.get(c.id) ?? null, mine);
  const grants = o.cards
    .filter((c) => c.investment !== true && programKind(c).startsWith('grant') && showable(c, now, applied))
    .map((c) => ({ c, fits: fitIds.has(c.id), fact: factOf(c) }))
    .sort((a, b) => fitOrder(a.fits, a.fact) - fitOrder(b.fits, b.fact) || byRelevance(a.c, b.c));
  const rows: GrantRow[] = grants.map(({ c, fits, fact }) => ({ title: c.title, amount: pathAmount(c), when: fundWhen(c), fit: fitCell(fits, fact) }));
  const invCards = o.cards
    .filter((c) => c.investment === true && showable({ ...c, investment: false }, now, applied))
    .sort((a, b) => closeAt(a) - closeAt(b) || byRelevance(a, b));
  const investors: InvestorRow[] = await Promise.all(invCards.map(async (c) => ({
    title: c.title, amount: pathAmount(c), when: fundWhen(c),
    what: whatItIs((await getProgramRow(c.id).catch(() => null))?.description),
  })));
  // Fix round 1 (3): what the list said (each program and its fit), so a changed list is answered in full again.
  const key = ASK_SAID(q, listHash([...rows.map((r, i) => `${grants[i].c.id}=${r.fit}`), ...invCards.map((c) => c.id)].join(',')));
  return { key, text: said.has(key) ? PROGRAMS_AGAIN : programsAnswer(rows, investors) };
}
/** A short stable hash of what a list said (FNV-1a, base 36), for its repeat key. Pure. */
const listHash = (x: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
};
/** The project's chains as the path reads them (its row's, plus Base from this reply's own read). Pure. */
const myChains = (v: Pick<PathFacts, 'chains'>, known: ViewIn['known']) =>
  new Set([...v.chains, ...(known?.onBase ? ['base'] : [])].map((x) => x.toLowerCase()));
/** Fix round 1 (1): a grant card's fact (conversation.ts grantFact): its gaps, else its one chain, else none or unknown. Pure. */
const cardFact = (c: Card, gaps: readonly string[] | null, mine: ReadonlySet<string>): GrantFact =>
  grantFact(gaps, c.any_chain ? [] : (c.chains ?? []), mine, chainName);
/** A live link's host as a person says it ("earnkit.com"); null when it isn't a link. Pure. */
const linkHost = (url: string): string | null => {
  try {
    return new URL(url).host.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
};

/**
 * The one view find and score share (F19), in one of the four states (R16a): the project, the rank and streak, the
 * money (the Best fit, the fits, backing, the upcoming program; the signed-out reply's open grant), the one link and the
 * one next step (with the connect offer or the weekly moment it needs), stored for its yes, and the fields every Bench
 * reply carries: move_up, rank_lines, streak.
 */
async function benchView(o: ViewIn): Promise<{ view: BenchView; fields: Reply; stand: Standing }> {
  const { id, now, read } = o;
  const row = read.row;
  // v2.13.4: a live link that loads counts as live for wording and fit (R3), and names the project as its site does.
  const siteLive = o.live?.ok === true;
  const title = o.live?.ok ? o.live.title : null;
  // v3.1 GTM W3 (one name per project): the name the builder gave (this call's, else the stored identity's) wins over
  // the row's (written at the last rescore) and over the key's last part (never "Mealmate.lovable.app" for MealMate).
  const given = o.name ?? (row || read.main ? await reportedName(id, row?.key ?? read.main!, true) : null);
  const project: BenchProject | null = row
    ? { key: row.key, name: LINK_KEY.test(row.key) ? linkName(given ?? read.reportedName ?? row.name) : displayName(given ?? row.name, row.key, title), confirmed: row.confirmed, live: (row.shipped && row.kind === 'app') || row.site || siteLive, weeks: row.weeks }
    : read.main
      ? {
          key: read.main,
          // GTM W2: a link-only project is named as the builder named it, never by its link's host.
          name: LINK_KEY.test(read.main) ? linkName(given ?? read.reportedName) : displayName(given ?? read.reportedName ?? keyName(read.main), read.main, title),
          confirmed: false, live: siteLive, weeks: 0,
        }
      : null;
  // v2.14 spec 2: a repo-key project that isn't confirmed: is it proven (the read-only App), held by another
  // person, or a copy?
  const isRepo = Boolean(project && REPO_KEY.test(project.key.toLowerCase()));
  const proof = project && !project.confirmed && isRepo ? await repoProof(id, project.key).catch(logged('repo proof')) : null;
  const taken = Boolean(proof && !proof.ok && proof.why === 'taken');
  // D14: the link is the caller's own installation's (standBase minted it for `own`). Fix round 1: a failed
  // mint is still signed out (a retry question), never read as signed in; A5 is only X actually off.
  const signIn = o.signedOut ? (read.base.signInLink ?? (await signInLink(o.own, now).catch(logged('sign-in link')))) : null;
  const streak = row?.streak ?? 0;
  const state = replyState({ signedIn: !o.signedOut, project, counted: Boolean(project?.confirmed) });
  // Fix round 1 (ruling 4): signed out, the sign-in question always wins over a held one.
  let held = state === 'signed_out' ? null : o.held;
  let variant: Variant = state !== 'not_counted' ? null : taken ? 'taken' : proof && !proof.ok && proof.why === 'copy' ? 'copy' : !isRepo ? 'no_repo' : null;
  const install = state === 'not_counted' && !variant ? await installLink(id, project!.key, now).catch(logged('install link')) : null;
  if (state === 'not_counted' && !variant && !install) variant = 'app_off';
  // 2026-10-23 Base onboarding: a GitHub no is remembered; step 2 (and its link) is never repeated after it.
  // GTM W2: a project named only by its live link (variant no_repo) is on the same no-GitHub path.
  const noCode = state === 'no_project' || variant === 'no_repo';
  // v3.1 cold read: a live app with no repo (Lovable, Bolt) never takes the Base walk-through: after a no it hears its
  // tool's GitHub steps with the connect link (liveTool below), so the link is still made.
  const liveOnly = variant === 'no_repo' && project !== null && LINK_KEY.test(project.key);
  const githubNo = noCode && !liveOnly && Boolean(read.seen.github_no) && !held;
  // Launch ready L2: with no project, the repo picker's install link (GitHub's page picks the repos; S7: a page is needed).
  // v3.1 cold read round 2: after the walk-through: its question until the Lovable prompt is written, then the next step
  // (build it and connect GitHub, with the picker link).
  const walk: 'help' | 'built' | null = githubNo && read.seen.base_walk?.answer === 'yes' ? (read.seen.lovable_prompt ? 'built' : 'help') : null;
  const pick = noCode && (!githubNo || walk === 'built') ? await pickLink(id, now).catch(logged('pick link')) : null;
  // R10: a rank only in the ranked state; never beside "not on the leaderboard" or "isn't counted yet".
  const ranked = rankedState(state);
  const handle = read.base.claimed ? read.base.handle : null;
  // v4.7 T2: where the builder stands, in every reply's fields (the page's score and rank, wins, applications, the
  // earliest fit deadline); a repo another person holds has no fits. Fix round 1 (R7, replyFacts' gate): signed out,
  // or a shared client that is no person, the weeks only and nothing read.
  const stand = state === 'signed_out' || !o.personal
    ? streakOnly(streak)
    : await readStanding(id, { lines: read.ranks, parts: read.parts, streak, fits: (taken ? [] : o.fits).filter(realFit), cards: o.cards, now });
  // v4.8 Task 4: a number or a name from the opener's list (find {program}) is the path's program, in any state; signed
  // out (a person, with the sign-in link), the reply is target B's opener, the pick's "Got it" or the list again.
  const picked = (await takePick(o)) ?? (await takeListPick(o));
  if (state === 'signed_out' && o.personal && signIn) {
    const opener = await openerView(o, signIn, picked, stand);
    if (opener) return opener;
  }
  // Fix round 1 (12): signed in before the code is connected, the pick is said above the step's reply.
  if (picked && typeof picked === 'object' && 'id' in picked && state !== 'signed_out' && state !== 'ranked') o.ahead?.push(`Got it: ${programName(picked.title)}.`);
  // v4.0 Task 5: the first reply after setup step 3 settled (a wallet signed on the page, the agent never told) is the
  // setup-done reply, once, in place of the state's reply (so no other step is claimed unshown).
  if (!o.more && !held && handle !== null && state !== 'signed_out' && read.seen.setup_asked && !read.seen.setup_done) {
    // v4.4 fix round 1: a wallet signed for step 3 (settled 'set': a wallet, no token row) and the offer due: the same
    // setup offer as the tell path (afterStep3), in place of setup done; its answer is the setup-done reply.
    const offer = (await setupOutcome(id))?.outcome === 'set' ? await setupOffer(id, now, await provenWallet(id).catch(() => null)) : null;
    if (offer) {
      const view: BenchView = { state, variant, project, rank: null, streak, target: null, handle, link: null, fund: [], due: [], ask: { kind: 'token', project_key: null, line: '' }, held: null, setupDone: offer.show_to_builder };
      return { view, fields: { move_up: offer.move_up, ...standingFields(stand) }, stand };
    }
    const done = await setupDoneFor(id, now, { fits: taken ? [] : o.fits, skip: o.skip, seen: read.seen, key: project?.key ?? null, name: project?.name ?? null }, o.own);
    // Fix round 1 (1): a pick pending (the opener seen, B's second message not said): the done line, then this reply's
    // path (connectedCommit below), never the setup-done table and another program's draft.
    if (done?.then_find) o.ahead?.push(done.show_to_builder);
    else if (done) {
      const ask: BenchView['ask'] = done.move_up
        ? { kind: 'apply', project_key: done.move_up.project_key, line: '', program_id: done.program_id }
        : { kind: 'none', project_key: null, line: '' };
      const view: BenchView = { state, variant, project, rank: null, streak, target: null, handle, link: null, fund: [], due: [], ask, held: null, setupDone: done.show_to_builder };
      return { view, fields: { ...(done.move_up && { move_up: done.move_up }), ...standingFields(stand) }, stand };
    }
  }
  // v4.0 setup step 3 (v4.4: the wallet only; the token offer follows its sign): once step 2 is done or answered no, in any signed-in
  // state; before every ranked ask, and on the no-GitHub path after the walk-through offer. While it is due, no other
  // ranked offer is opened (each one is claimed when made). Fix round 1: a project not counted yet is "Your code" (the
  // App connected another repo); the no-GitHub path names none.
  const setupLink = !held && handle !== null && state !== 'signed_out' ? await walletSetupDue(id, now) : null;
  const walletSetup = setupLink
    ? { link: setupLink, project: githubNo ? null : ranked ? (project?.name ?? 'Your code') : 'Your code' }
    : null;
  const rankedFree = ranked && !walletSetup;
  // v4.3 final review F3: a "show more" call never claims or opens a one-time offer (connect, an event post, a nudge,
  // the weekly moment, the check-in, the wallet step, the token offer, the new-repo nudge, titles): its question is
  // the qualify, apply or ship ask (or none), and each offer stays due for the next plain find.
  const more = o.more === true;
  // v4.8 Task 1: a ranked builder's reply is the path (conversation.ts pathReply), unless setup step 3 (above, and the
  // setup-done reply), a held submit question or an owning nudge comes first. With no move (bestMove's quiet), the older
  // asks below (connect, the Monday block, posts, check-in, wallet, token, new repo, titles, then the ship line).
  // The path read the programs and had none to name (or parked them), so no older program ask (Base's qualify) is made.
  let pathQuiet = false;
  // Fix round 2 (F1): the path has only the closest grant (bestMove step 4): the older moments go first, once a session.
  let deferred: (PathPlan & { move: Exclude<Move, { kind: 'quiet' }> }) | null = null;
  // Fix round 2 (F5): one nudge pick a reply (re-picked only for a milestone, whose line names the Best fit).
  let nudgeFirst: NudgePick | null | undefined;
  // Fix round 2 (F2, F5): what the builder told EarnKit about, read once; null (a failed read): the path makes no hook.
  const told = ranked && project && !taken ? await toldIds(id) : new Set<string>();
  // A person only (reply-facts.ts personal; v4.7.2 final review 10, R7): a shared client that is no person gets no path
  // and no path reads or writes (standing_seen.path, said, bench_ask).
  if (o.personal && !o.shared && rankedFree && !more && project && !taken && !held && handle !== null) {
    nudgeFirst = await pickNudge(id, now, { project: project.name, best: null });
    if (!(nudgeFirst?.ask && nudgeFirst.line) && told) {
      const facts: PathFacts = { state, variant, project, streak, handle, stand, siteLive, chains: row?.chains ?? [] };
      // Task 5 fix round 1 (5): with a direct question the step is short (no proof, no "Since"): the answer said them.
      if (o.question) o.brief = true;
      // v4.8 Task 5: a direct question (find {ask}) is answered first, then this reply's path step (its words or its
      // pointer), whichever the path gives; the answer is said once a session (again, one pointer line).
      const answered = async <T,>(r: T): Promise<T> => {
        const a = o.question ? await directAnswer(o, facts, told) : null;
        if (a) {
          o.answer?.push(a.text);
          await markSaid(id, [a.key], now);
        }
        return r;
      };
      // Task 3: the path waiting at submit ("sent" not said yet): one line pointing back, never the draft again.
      const waiting = submitWaiting(o, told);
      if (waiting) return answered(await pathSubmitCommit(o, facts, waiting, await sinceFor(o, facts, { program: moveProgram(waiting), saysClose: true })));
      // Task 6 fix round 2 (1): a help park whose step is met since is unparked first; its hook leads with what changed.
      const back = await helpUnpark(o, facts);
      let plan = await pathPlan(o, facts, told);
      // v4.8 Task 4: the first path reply after connecting, for a builder who saw the opener: the profile line and the
      // pick's fit, once (setup step 3, a held question and an owning nudge came first, above).
      if (read.seen.opener && !read.seen.connected_said && (!plan.path || plan.path.stage === 'hook')) {
        const hello = await connectedCommit(o, plan);
        if (hello) return answered(hello);
      }
      let move = plan.move;
      // Final review F3: the ok to a help step ("Say ok once it's done") came back not done (a closed gap and a running
      // re-check answer below): the program waits now (parked, this session's check spent), and the path moves on in the
      // same reply, the park line first. Two turns at most after the help, never the step again.
      const helped = read.seen.bench_ask;
      if (helped?.help === true && (helped.checks ?? 0) > 0 && helped.program_id && !plan.closed && !plan.checking
        && plan.path?.stage === 'gap' && plan.path.program_id === helped.program_id) {
        const parked = await parkHelp(id, helped, now, true);
        read.seen.help_parked = { ...(read.seen.help_parked ?? {}), ...parked.parked };
        read.seen.path = parked.path;
        delete read.seen.bench_ask;
        o.ahead?.push(helpParked(helped.program ?? (move.kind !== 'quiet' && move.program.id === helped.program_id ? move.program.title : helped.qualify?.grant.name ?? 'this program')));
        plan = await pathPlan(o, facts, told);
        move = plan.move;
      }
      // Task 3: a fresh session opens with what changed since the last one (the step's own words say a hook's close).
      const sinceOf = async (program: MoveProgram, saysClose: boolean) => {
        const since = await sinceFor(o, facts, { program, saysClose });
        return back?.program_id === program.id ? [back.line, since].filter(Boolean).join(' ') : since;
      };
      // Fix round 3: an older moment waits for the closest grant only at the hook, never for a builder already on that
      // program (mid-path), and once a session.
      // Fix round 1 (9): a path left at track (no next program at "sent") is no longer mid-path.
      const midPath = move.kind !== 'quiet' && plan.path !== null && ((plan.path.stage !== 'hook' && plan.path.stage !== 'track') || plan.path.program_id === move.program.id);
      // Task 2: the path's gap closed: the draft offer leads (mid-path).
      if (plan.closed) return answered(await pathClosedCommit(o, { ...plan, closed: plan.closed }, await sinceOf(plan.closed.program, false)));
      // Fix round 2 (F3): the re-check runs past its wait: one easy reply, "ok" (the gap ask stays, so a no parks).
      if (plan.checking) return answered(await pathCheckingView(o, plan));
      // Fix round 1 (T2-4): mid-gap on the program bestMove kept: the first remaining step, never "Want the steps?".
      if (move.kind !== 'quiet' && plan.path?.stage === 'gap' && plan.path.program_id === move.program.id) {
        const still = await pathGapCommit(o, { ...plan, move }, await sinceOf(move.program, false));
        if (still) return answered(still);
      }
      // Task 5: with nothing to hook, the answer still goes first, above the older ask that answers below.
      if (move.kind === 'quiet') {
        pathQuiet = true;
        await answered(null);
      }
      // Task 5: a direct question never waits for an older moment: the answer, then the path's step.
      // v4.8.1 fix round 1 (controller ruling): an investor move is the last resort, so it waits like the closest grant.
      else if ((move.kind !== 'closest' && move.kind !== 'investor') || midPath || o.question || sessionOf(read.seen, now).said.has(OLDER_SAID)) {
        // Re-review minor (N4): the builder's pick closes within 48 hours on a step the agent can't do (bestMove drops
        // it): one line saying so, once, before the closer money.
        const pickedId = plan.path?.picked && plan.path.stage === 'hook' ? plan.path.program_id : null;
        const soon = pickedId && pickedId !== move.program.id && !sessionOf(read.seen, now).said.has(`toosoon:${pickedId}`)
          ? plan.ctx.grants.find((g) => g.id === pickedId && !g.doable && g.gaps.length > 0 && !plan.ctx.skip.has(g.id) && g.ends_at
            && Date.parse(g.ends_at) > now.getTime() && Date.parse(g.ends_at) - now.getTime() <= NOW_WINDOW_MS)
          : undefined;
        if (soon) {
          await markSaid(id, [`toosoon:${soon.id}`], now);
          return answered(await pathCommit(o, { ...plan, move }, await sinceOf(move.program, true), { inline: tooSoonLine(soon.title, `${facts.project.name} ${soon.gaps[0]}`) }));
        }
        return answered(await pathCommit(o, { ...plan, move }, await sinceOf(move.program, true)));
      }
      else deferred = { ...plan, move };
    }
  }
  // F1: while the closest grant (or, v4.8.1, an investor program) waits, only an older moment may answer (the quieter asks stay for a quiet path).
  const momentsOnly = deferred !== null;
  // Launch ready L5: the weekly target, the ship step's points line lead (ranks only, never another builder's name).
  const aim = ranked ? await targetIn(id, read.parts, now) : null;
  const target = aim ? weeklyTarget(aim) : null;
  // v3.1 (spec 3.2): the apply candidates: a fit closing within APPLY_WINDOW_DAYS (deadline order), else the rolling fits
  // (byRelevance), none the builder told EarnKit about. The first is the Best fit, the reply's money line.
  // v3.1 cold read: long shots never lead and a program that takes a company is never offered unprompted: only real fits
  // are the money line, the fund lines and the apply step (long shots stay in the "What can I earn?" table).
  const realFits = o.fits.filter(realFit);
  // v4.7.1 fix round 2 (R6), kept in v4.8: a program told applied or drafted is never pitched (the Best fit, the fit lines).
  const noPitch = ranked && project && !taken ? notPitched(told, read.seen, now) : new Set<string>();
  const open = ranked && project && !taken && !held
    ? ((await bestApplies(id, (o.applies ?? o.fits.slice(0, 3)).filter(realFit), read.seen, o.skip, now)) ?? []).filter((f) => !noPitch.has(f.program_id))
    : [];
  // v3.1 Task 7: Base Builder Grants' Builder Codes answer (the stored one; a check for the draft starts in the background).
  const codes = open[0]?.program_id === BASE_GRANTS_ID && project ? await codesFor(id, project.key, now, o.codesFetch) : null;
  const bestOf = (f: Fit, c: string | null): BestFit =>
    ({ program_id: f.program_id, title: f.title, amount: f.amount, when: f.when, why: f.why, codes: c, ...(f.bar && { bar: f.bar }) });
  const best: BestFit | null = open[0] ? bestOf(open[0], codes) : null;
  // v4.8 Task 1: the v4.7 money-first apply loop, the forced open-money paragraph and the rotating needs ask are retired:
  // the path (pathView, above) names the money. A fit drafted or told about is no longer pitched here either.
  // v3 Stage 1 (spec 5.1): the connect weeks, once a person, before (and in place of) this reply's weekly moment.
  // Task 16: the Best fit rides on the offer, so its yes offers to draft it.
  const connect = rankedFree && !more && project && handle && !held ? await connectMoment(id, project.key, now, open[0] ?? null) : null;
  // v3.1 one-tap posts (design 6 ruling): went live or won, for 48 hours, before the apply step (a stale launch post is worthless).
  const hot = rankedFree && !more && project && handle && !held && !connect ? await eventPost(id, handle, now, { hot: true }) : null;
  // v3 Stage 2 (spec 5.3), v3.1 R1: the drafted application, once a program, before (and in place of) the weekly moment.
  // v4.0 Task 8: this week's nudge (at most one), peeked here and claimed only when this reply shows it. It leads a
  // ranked reply only: never setup, the setup-done reply (returned above), a held question, connect, an event post or the Monday block (those lead, and the nudge waits unclaimed).
  // Fix round 1 (ruling 2): a nudge that asks (closing, accepted or funded) owns the reply's one question: no other
  // ask is made, claimed or stored; the Monday block, when it shows, still leads and the nudge waits.
  // Fix round 2: the closing nudge standing in for the submit question keeps that question's place (it held off connect,
  // backing, the coin's wallet and event posts above); it shows only in a ranked reply with setup step 3 not due and no
  // Monday block to show, once its week is claimed. Then the submit question goes; else it stays held.
  const standIn = Boolean(!more && o.nudge && held && state === 'ranked' && project && handle && !(await walletSetupDue(id, now))
    && !(await momentWouldShow(o.own, id, project.key, now)) && (await claimNudge(id, now, o.nudge.keep)));
  if (standIn) held = null;
  const nudgeOk = standIn || Boolean(rankedFree && !more && project && handle && !held && !connect && !hot);
  const peek = !nudgeOk ? null : standIn ? o.nudge!
    : nudgeFirst !== undefined && nudgeFirst?.kind !== 'milestone' ? nudgeFirst
    : await pickNudge(id, now, { project: project!.name, best: best && realFit(best) ? best.title : null });
  const askMoment = !standIn && peek?.ask && peek.line ? await weeklyMoment(o.own, id, project!.key, handle!, row?.commit_weeks ?? [], now) : null;
  const owns = standIn || Boolean(peek?.ask && peek.line && !askMoment && (await claimNudge(id, now, peek.keep)));
  // Launch ready L6: the weekly moment, once a week per installation, never over a held question.
  const moment = askMoment ?? (!owns && !peek?.ask && rankedFree && !more && project && handle && !held && !connect && !hot ? await weeklyMoment(o.own, id, project.key, handle, row?.commit_weeks ?? [], now) : null);
  // v3.1 one-tap posts: the share slot between Mondays: an event's post (an announced win, going live, the coin's intro).
  const event = hot ?? (!owns && rankedFree && !more && project && handle && !held && !connect && !moment ? await eventPost(id, handle, now, { hot: false }) : null);
  // 2026-10-22: then a private repo's titles question (once a person), then, with no fit, Base's grant steps.
  const quiet = !owns && rankedFree && project !== null && !held && !connect && !moment && !event;
  // v3.1 wallet proof: the optional wallet step, once a person, in the first quiet reply after setup (never with another
  // question); claimed below only once this reply carries it.
  // 2026-10-23 Base onboarding: after the GitHub no, the walk-through offer once (Base Builder Grants open: its last
  // step drafts that application), then the wallet step once. v4.7 T3 fix round 2: never ahead of money: githubNo needs
  // the no-GitHub path (no project, or a link-only one: not ranked) and `open` (so moneyFirst) needs a ranked reply.
  const baseAsk = githubNo && handle !== null && !read.seen.base_asked && !read.seen.base_walk && baseGrantOpen(o.cards, now, o.skip) && (await takeBaseAsk(id, now));
  // GTM W2: the Monday check-in, once, on a client that can schedule, in the first quiet reply after setup.
  const reach = o.reach ?? (await agentReach(o.own, id));
  const qualifyIn = { cards: o.cards, skip: o.skip, seen: read.seen, now, declineMs: DECLINE_MS, codesFetch: o.codesFetch, known: o.known };
  const checkin = quiet && !more && handle !== null && reach.schedules && !read.seen.checkin && checkinAskDue(read.seen, now) && (await takeCheckinAsk(id, now));
  const wallet = ((quiet && !checkin && !momentsOnly) || (githubNo && !baseAsk)) && !more && handle !== null ? await walletOfferDue(id, now) : null;
  // 2026-10-23: a main project with no commits in STALE_WEEKS: one light nudge, claimed once.
  // Fix round: never within NEW_REPO_GRACE_DAYS of connecting it (its weeks may not be read yet).
  // v4.2 Task 6 (F11): the one-time token offer for an earlier builder, in a quiet reply (never beside another question,
  // never during setup: step 3 is not due); claimed below only once this reply carries it.
  const tokenOffer = quiet && !momentsOnly && !more && !checkin && !wallet && !walletSetup && handle !== null && (await tokenOfferDue(id));
  // v4.7 T3: the Stripe ask left the reply order: it rides on a draft for a program that wants revenue (tools.ts prepare).
  const newRepo = quiet && !momentsOnly && !more && !checkin && !wallet && !tokenOffer && handle !== null && !read.seen.new_repo_asked && staleRepo(row?.commit_weeks ?? [], now)
    && !(await connectedSince(id, project.key, now)) && (await takeOnce(id, 'new_repo_asked', now));
  const titles = quiet && !momentsOnly && !more && !checkin && !wallet && !tokenOffer && !newRepo && handle !== null && (await titlesAskDue(id, project.key, now)) && (await takeTitlesAsk(id, now));
  const qualify = quiet && !pathQuiet && !momentsOnly && !checkin && !wallet && !tokenOffer && !newRepo && !titles && realFits.length === 0
    ? await qualifyOffer(id, project.key, qualifyIn)
    : null;
  const link = state === 'signed_out' ? signIn : noCode ? pick : state === 'ranked' ? null : install;

  let fund: FundLine[] = [];
  // O2 fix round 1 (ruling 3): a repo another person holds is never offered a program for it. R12: only programs the
  // matcher fits, each with its deadline (Task 16: the reply names the first, after the Best fit).
  if (project && !taken) fund = realFits.filter((f) => !noPitch.has(f.program_id)).slice(0, 3).map((f) => ({ kind: 'fits', title: f.title, amount: f.amount, when: f.when, ...(f.bar && { bar: f.bar }) }));


  // v3 Stage 2 (spec 5.2): Earned (fees claimed plus announced prizes), for the ranked standing line.
  const earned = ranked ? await earnedUsd(id, now).catch(logged('earned')) : null;

  // R8, L5, L6: each state's one next step.
  // GTM W2: the ship question at most once in SHIP_ASK_DAYS (standing_seen.ship_asked).
  const shipAsked = typeof read.seen.ship_asked === 'string' && now.getTime() - Date.parse(read.seen.ship_asked) < SHIP_ASK_DAYS * 86_400_000;
  // GTM W2: a repo not counted yet for a builder who already connected one with the App: one install, never step 2 again.
  const appDone = state === 'not_counted' && install !== null && (await appConnected(id));
  // v3.1 cold read: a live app (Lovable, Bolt) whose builder said no to GitHub once hears its tool's GitHub steps.
  const liveTool = liveOnly && !held && (read.seen.github_no_app || read.seen.github_no) ? { tool: builtWith(project!.key) ?? builtWith(read.liveUrl) } : null;
  // v4.0 (approved copy 2): the Lovable or Bolt hint only without GitHub: said so, a link-only project, or a Lovable or
  // Bolt live link; never assumed (GitHub unknown: no hint).
  const linkOnly = project !== null && LINK_KEY.test(project.key);
  const tool = (project && builtWith(project.key)) ?? builtWith(read.liveUrl);
  const noGithub = Boolean(read.seen.github_no) || linkOnly || tool === 'lovable' || tool === 'bolt';
  // v4.8 re-review blocker 1: the programs answer given (or asked for) this session: the quiet reply offers no "more".
  const listed = o.question === 'programs' || [...sessionOf(read.seen, now).said].some((k) => k.startsWith('ask:programs:'));
  const asks = { state, variant, project, link, handle, share: Boolean(moment), connect, noGithub, walletSetup, titles, qualify, post: event, githubNo, baseAsk, newRepo, tokenOffer, checkin, shipAsked, listed, appDone, liveTool, walk, hosted: reach.hosted };
  const nudgeAsk = owns && peek?.ask ? peek.ask : null;
  let finalAsk: BenchView['ask'] = nudgeAsk
    ? { kind: nudgeAsk.kind, project_key: project!.key, line: '', ...(nudgeAsk.kind === 'apply' && { program_id: nudgeAsk.program_id }) }
    : stateAsk({ ...asks, wallet });
  // Fix round: the wallet step is claimed only when this reply carries it (another reply claimed it first: the ship step).
  if (finalAsk.kind === 'wallet' && !(await takeWalletAsk(id, now))) finalAsk = stateAsk({ ...asks, wallet: null });
  // v4.2 Task 6: the token offer the same way (marks token_offered); it is the stored ask, so a yes or no answers it.
  if (finalAsk.kind === 'token' && !(await takeTokenOffer(id, now))) finalAsk = stateAsk({ ...asks, tokenOffer: false, wallet: null });
  // v4.0: step 3 the same way (another reply claimed it first: this one asks the next step, or nothing).
  if (finalAsk.kind === 'wallet_setup' && !(await takeWalletAsk(id, now, true))) finalAsk = stateAsk({ ...asks, walletSetup: null, wallet: null });
  // Fix round 2 (F1): the closest grant waited for an older moment; with none to show, it is the reply after all. One
  // shown counts for the session (standing_seen.said 'older'), so the next call is the path.
  if (deferred) {
    if (!OLDER_MOMENTS.includes(finalAsk.kind)) return pathCommit(o, deferred, await sinceFor(o, deferred.facts, { program: deferred.move.program, saysClose: true }));
    await markSaid(id, [OLDER_SAID], now);
  }
  if (finalAsk.kind === 'ship' && !held) await sql()`
    UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('ship_asked', ${now.toISOString()}::text)
    WHERE builder_id = ${id}`.catch(logged('ship asked'));
  // Only the ask shown is answerable: a held question clears the stored one. (The share offer stays open all week in
  // standing_seen.share_open, weeklyMoment.)
  // v3.1 one-tap posts: an event's post stored its own ask (post-reply.ts: the moment, so a yes redrafts it).
  const stored = held || finalAsk.kind === 'post' || finalAsk.kind === 'none' ? null : {
    kind: finalAsk.kind, key: finalAsk.project_key,
    ...(nudgeAsk?.kind === 'apply' && { program_id: nudgeAsk.program_id }),
    ...(nudgeAsk?.kind === 'outcome_share' && { link: nudgeAsk.link }),
    // v4.3: the first step and the name the question used, so its yes is answered as asked (Builder Codes: added here;
    // fix round 1: a hosted agent was asked for the steps, so its yes is qualifySteps; codes_missing picks the note).
    ...(qualify && finalAsk.kind === 'qualify' && {
      program_id: qualify.program_id,
      qualify: { grant: qualify.grant, steps: qualify.steps, first: qualify.steps[0], name: project?.name ?? '', hosted: reach.hosted, codes_missing: qualify.missing.includes('codes') },
    }),
    ...((finalAsk.kind === 'wallet' || finalAsk.kind === 'wallet_setup') && { at: now.toISOString() }),
  };
  if (finalAsk.kind !== 'post') await sql()`
    UPDATE builder_profiles SET standing_seen = CASE WHEN ${stored === null} THEN COALESCE(standing_seen, '{}'::jsonb) - 'bench_ask'
      ELSE COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(stored as never)}::jsonb) END
    WHERE builder_id = ${id}`.catch(logged('ask'));

  // 2026-10-23 (owner): a program that isn't open is never a reply line (nothing to do with it); it shows once it opens.

  // v4.0 Task 8: a nudge with no question of its own (the milestone, the Friday line) leads a ranked reply beside its
  // ask, claimed now; never over the Monday block, a post offer or connect. Fix round 1 (ruling 4): the closing nudge
  // drops only its own program's deadline line.
  const nudge = owns ? peek
    : nudgeOk && peek && !peek.ask && !['share', 'post', 'connect', 'wallet_setup'].includes(finalAsk.kind) && (await claimNudge(id, now, peek.keep)) ? peek
    : null;
  // A congratulation this week (no line) counts as the week's nudge: claimed whenever it comes up.
  if (peek && !peek.line && nudgeOk) await claimNudge(id, now, peek.keep);
  const due = nudge?.kind === 'closing' && nudge.title ? o.due.filter((l) => !l.startsWith(`${nudge.title} closes `)) : o.due;

  const shownBest = best;
  const view: BenchView = {
    state, variant, project, rank: ranked ? read.ranks.bench : null, streak, target, earned: earned?.paid_usd ?? 0, handle, link, fund, due,
    nudge: nudge?.line ?? null, nudgeOwns: owns,
    // GTM W2 (value before the ask): the open grant also leads step 2 (no project, or a repo not counted yet).
    noGithub, ask: finalAsk, held, best: shownBest && realFit(shownBest) ? shownBest : null, connect, moment, open: state !== 'ranked' ? openGrant(o.cards, now, o.skip) : null, qualify, post: event,
    also: qualify && finalAsk.kind === 'qualify' ? alsoOpen(o.cards, now, o.skip, qualify.program_id) : [],
  };
  // v3.1 cold read: "You're in, @maya." only on the first reply after sign-in (claimed once, when this reply can say it).
  view.welcome = welcomeFits(view) && !read.seen.welcomed && (await takeOnce(id, 'welcomed', now));
  // v3.1 answerable replies (spec 6): the connect step's full pitch once a UTC day; later the same day, the short one.
  if (!held && isStep2(finalAsk)) {
    const today = now.toISOString().slice(0, 10);
    view.pitched = read.seen.pitch_day === today;
    if (!view.pitched)
      await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('pitch_day', ${today}::text)
        WHERE builder_id = ${id}`.catch(logged('pitch day'));
  }
  // v3.1 cold read: the ranked standing line only when it changed since last shown (score always shows it: the builder
  // asked); the shipping points line at most once an ISO week. Each is remembered only when its reply carries it.
  if (ranked && project) {
    // v4.7.1 T1 fix round 1 (R5): the key holds the score too, so a new score shows the paragraph again (wins, drafts and
    // the next deadline stay out of it, so it never re-shows every day).
    const standKey = `${standingLine(project.name, view.rank, streak, view.earned ?? 0)}${stand.score !== null ? ` · score ${stand.score}` : ''}`;
    // The connect reply says the same facts in its own words ("Kit is on the leaderboard: #1 of 13 builders, ...").
    // v4.7 T3: the apply reply is the money alone (no standing line), so it carries none either.
    const carries = held !== null || !['share', 'post', 'apply'].includes(finalAsk.kind);
    view.standingShown = o.alwaysStanding === true || read.seen.status_seen !== standKey;
    // v4.7.1 T1: the line shown is the standing paragraph; the old standing line stays the change key (stable, no reshow).
    // "No grants won yet." alone is no standing (standingLeads' rule), so that reply says "Kit is on EarnKit." instead.
    view.standingText = standingParagraph(standingLeads(stand) || (stand.wonUsd ?? 0) > 0 ? stand : { ...stand, wonUsd: null });
    const week = isoWeekOf(now);
    view.nagShown = read.seen.nag_week !== week;
    // Fix round 2: an owning nudge's reply shows no points line, so the week's line is not marked shown.
    // v4.7 T3: the apply reply says no ship line, so only the ship and quiet replies mark it.
    const nags = !held && !owns && view.nagShown && ['ship', 'none', 'more'].includes(finalAsk.kind);
    const keep: Record<string, unknown> = {
      ...(carries && { status_seen: standKey }),
      ...(nags && { nag_week: week }),
    };
    if (Object.keys(keep).length > 0)
      await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || ${sql().json(keep as never)}::jsonb
        WHERE builder_id = ${id}`.catch(logged('shown lines'));
  }
  const note = finalAsk.kind === 'ship' ? (reach.hosted ? SHIP_STEP_NOTE_HOSTED : SHIP_STEP_NOTE) : finalAsk.kind === 'checkin' ? CHECKIN_NOTE : finalAsk.kind === 'share' ? SHARE_NOTE : finalAsk.kind === 'connect' ? CONNECT_NOTE : finalAsk.kind === 'apply' ? APPLY_NOTE
    : finalAsk.kind === 'start' ? START_NOTE : finalAsk.kind === 'pick_repo' ? PICK_REPO_NOTE
    : finalAsk.kind === 'install_app' ? INSTALL_APP_NOTE : finalAsk.kind === 'titles' ? TITLES_NOTE : finalAsk.kind === 'qualify' ? QUALIFY_NOTE
    : finalAsk.kind === 'post' ? POST_NOTE : finalAsk.kind === 'wallet' ? WALLET_NOTE : finalAsk.kind === 'token' ? TOKEN_ASK_NOTE : finalAsk.kind === 'wallet_setup' ? walletSetupNote()
    : finalAsk.kind === 'base_start' ? BASE_START_NOTE
    : finalAsk.kind === 'next_step' ? NEXT_STEP_NOTE : finalAsk.kind === 'new_repo' ? NEW_REPO_NOTE
    : finalAsk.kind === 'base_help' ? BASE_HELP_NOTE
    : finalAsk.kind === 'outcome_share' ? OUTCOME_SHARE_NOTE : finalAsk.kind === 'more' ? MORE_NOTE : finalAsk.kind === 'name' ? NAME_NOTE : BENCH_MOVE_UP_NOTE;
  const rankLines = ranked ? [read.ranks.bench, ...read.ranks.chains.map((c) => c.line)].filter((x): x is string => Boolean(x)) : [];
  const fields: Reply = {
    // v4.7 T4: every step with a why carries it (askWhy), so "why?" has EarnKit's own answer.
    ...(!held && finalAsk.kind !== 'none' && { move_up: withWhy({ kind: finalAsk.kind, project_key: finalAsk.project_key, agent_note: note }, askWhy(view)) }),
    ...(rankLines.length > 0 && { rank_lines: rankLines }),
    ...standingFields(stand),
  };
  return { view, fields, stand };
}

/**
 * v4.3: `streak` and the `standing` fact the agent answers "where do I stand" from (no points, no empty rank). v4.7 T2:
 * the whole standing (standing.ts standingParagraph: the page's score and rank, the weeks, wins, applications, the next
 * deadline), in every reply; absent only with nothing to say (a streak-only standing at 0 weeks). Pure.
 */
export function standingFields(s: Standing): { streak: number; standing?: string } {
  const line = standingParagraph(s);
  return { streak: s.streak, ...(line && { standing: line }) };
}

/**
 * Task 16 step 1: the open grant the signed-out reply names ("Base pays up to $5,000 for apps on Base."): the first open,
 * showable program with a known award, by the program list's order (present.ts byRelevance: Base first); its organizer
 * without the parenthesis ("Arc House (Circle)": "Arc House") and its one chain (base-qualify.ts grantOf). Null: none. Pure.
 */
export function openGrant(cards: Card[], now: Date, skip: Set<string>): OpenGrant | null {
  // Fix round 1: a grant (showable already drops investments; checked here too, so "pays" never names one).
  const c = cards.filter((x) => showable(x, now, skip) && x.investment !== true && (x.max_award_usd ?? 0) > 0 && x.organizer?.trim()).sort(byRelevance)[0];
  return c ? grantOf(c) : null;
}

/**
 * v4.3 (owner-approved): the qualify reply's "Also open": up to two other open grants a person could be shown (never an
 * investment, a prize program or hackathon, a sponsor or EarnKit campaign, a hidden program or the qualify program
 * `not`), in byRelevance order; each its title (bench-reply.ts alsoLine cuts it at ':'), the amount cell
 * (upToCell(prizeOf)) and when (fundWhen). Pure.
 */
export function alsoOpen(cards: Card[], now: Date, skip: Set<string>, not: string): AlsoOpen[] {
  return cards
    // Fix round 1 (R2): grants only (site-copy.ts programKind: never an investment, a prize program or a hackathon).
    .filter((c) => c.id !== not && programKind(c).startsWith('grant') && showable(c, now, skip))
    .sort(byRelevance)
    .slice(0, 2)
    .map((c) => ({ title: c.title, amount: upToCell(prizeOf(c)), when: fundWhen(c) }));
}

/**
 * v4.7.2 final review 7: /api/stats open_money_usd for `now`: openMoneyUsd over every active program, read and rounded
 * as stats.ts readStats and statsFrom do. A failed read: `fallback`'s sum. Never throws.
 */
// v4.8 Task 1: no reply reads it now (the forced money paragraph is retired); kept for Task 4's opener total.
export async function openMoneyNow(now: Date, fallback: Card[]): Promise<number> {
  const rows = await sql()<{ max_award_usd: string | number | null; investment: boolean | null; status: string; campaign: unknown; source: string; starts_at: Date | null; ends_at: Date | null }[]>`
    SELECT max_award_usd, investment, status, campaign, source, starts_at, ends_at FROM programs WHERE status = 'active'`.catch((err: unknown) => {
    logged('open money')(err);
    return null;
  });
  if (!rows) return Math.round(openMoneyUsd(fallback, now));
  return Math.round(openMoneyUsd(rows.map((r) => ({ ...r, max_award_usd: r.max_award_usd == null ? null : Number(r.max_award_usd) })), now));
}
/** v4.7.1 T1: a program's close time: rolling or undated last. Pure. */
const closeAt = (c: Card) => (fundWhen(c) === 'rolling' || !c.ends_at ? Infinity : new Date(c.ends_at).getTime());
/**
 * v4.7.2 T1: the soonest-closing open investment (an accelerator) the builder hasn't applied to (v4.8: no reply reads
 * it now; Task 5's investor table may). The filters are showable's, except that an investment is kept; soonest deadline,
 * rolling last, byRelevance among equals. The amount cell keeps its "up to" and drops prizeOf's
 * trailing "investment" (the line adds it once). Null with none. Pure.
 */
export function openNowInvestment(cards: Card[], now: Date, skip: Set<string>): (AlsoOpen & { id: string }) | null {
  const c = cards
    .filter((x) => x.investment === true && showable({ ...x, investment: false }, now, skip))
    .sort((a, b) => closeAt(a) - closeAt(b) || byRelevance(a, b))[0];
  if (!c) return null;
  const amount = prizeOf(c).replace(/\s+investment$/i, '').replace(/^up to\s+/i, 'up to ');
  return { id: c.id, title: c.title, amount, when: fundWhen(c) };
}

/** 2026-10-23 Base onboarding: Base Builder Grants is open and shown (the walk-through's last step drafts it). Pure. */
export const baseGrantOpen = (cards: Card[], now: Date, skip: Set<string>) => cards.some((c) => c.id === BASE_GRANTS_ID && showable(c, now, skip));
/**
 * 2026-10-23: a main project with no commits in the last STALE_WEEKS ISO weeks (this one included), from its lit weeks
 * (streak.ts); no weeks known reads as not stale (never a nudge on a read not done yet). Pure.
 */
export function staleRepo(weeks: string[], now: Date): boolean {
  if (weeks.length === 0) return false;
  const recent = new Set(Array.from({ length: STALE_WEEKS }, (_, k) => isoWeekOf(new Date(now.getTime() - k * 7 * 86_400_000))));
  return !weeks.some((w) => recent.has(w));
}
/** 2026-10-23 fix round: a repo connected this recently is never nudged as old. */
export const NEW_REPO_GRACE_DAYS = 14;
/** Whether the project's repo was proven within NEW_REPO_GRACE_DAYS (its newest verified source). A failed read: true (no nudge). */
async function connectedSince(id: number, key: string, now: Date): Promise<boolean> {
  const [r] = await sql()<{ at: Date | null }[]>`
    SELECT max(verified_at) AS at FROM builder_sources
    WHERE builder_id = ${id} AND kind = 'repo' AND state = 'verified' AND lower(project_key) = lower(${key})`.catch((err: unknown) => {
    logged('connected since')(err);
    return [{ at: now }];
  });
  return Boolean(r?.at) && now.getTime() - new Date(r!.at!).getTime() < NEW_REPO_GRACE_DAYS * 86_400_000;
}
/** A once-guard in standing_seen (`key`: an ISO time), claimed in one guarded UPDATE. Never throws. */
async function takeOnce(id: number, key: 'base_asked' | 'new_repo_asked' | 'welcomed' | 'setup_done', now: Date): Promise<boolean> {
  const [taken] = await sql()`
    UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object(${key}::text, ${now.toISOString()}::text)
    WHERE builder_id = ${id} AND NOT COALESCE(standing_seen ? ${key}, false) RETURNING 1`.catch((err: unknown) => {
    logged(`take ${key}`)(err);
    return [];
  });
  return Boolean(taken);
}
const takeBaseAsk = (id: number, now: Date) => takeOnce(id, 'base_asked', now);
/**
 * v3.2 (2026-10-27): the Monday check-in comes back when it went unanswered (the owner's was asked once and lost): a week
 * after the last ask, at most CHECKIN_MAX_ASKS asks. An answer ends it (standing_seen.checkin). Pure.
 */
export const CHECKIN_MAX_ASKS = 3;
export function checkinAskDue(seen: { checkin_asked?: string; checkin_asks?: number }, now: Date): boolean {
  if (!seen.checkin_asked) return true;
  const asks = seen.checkin_asks ?? 1;
  return asks < CHECKIN_MAX_ASKS && now.getTime() - Date.parse(seen.checkin_asked) >= 7 * 86_400_000;
}
/** Claims this reply's check-in ask (the time and the count), the same test in SQL so two replies never both ask. Never throws. */
async function takeCheckinAsk(id: number, now: Date): Promise<boolean> {
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [taken] = await sql()`
    UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object(
      'checkin_asked', ${now.toISOString()}::text,
      'checkin_asks', CASE WHEN standing_seen ? 'checkin_asked' THEN COALESCE((standing_seen->>'checkin_asks')::int, 1) + 1 ELSE 1 END)
    WHERE builder_id = ${id} AND NOT COALESCE(standing_seen ? 'checkin', false)
      AND (NOT COALESCE(standing_seen ? 'checkin_asked', false)
        OR (standing_seen->>'checkin_asked' <= ${week} AND COALESCE((standing_seen->>'checkin_asks')::int, 1) < ${CHECKIN_MAX_ASKS}))
    RETURNING 1`.catch((err: unknown) => {
    logged('take checkin')(err);
    return [];
  });
  return Boolean(taken);
}
/**
 * 2026-10-23: the one-line notice after the repo picker refused only forks or templates (standing_seen.template_refused,
 * github-app.ts pickSetup), taken once. Never throws.
 */
export async function takeTemplateNotice(id: number): Promise<string | null> {
  const [r] = await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'template_refused'
    WHERE builder_id = ${id} AND COALESCE(standing_seen ? 'template_refused', false) RETURNING 1`.catch((err: unknown) => {
    logged('template notice')(err);
    return [];
  });
  return r ? TEMPLATE_NOTICE : null;
}

/**
 * v3 Stage 2 (spec 5.3), v3.1 (spec 3.2): the programs the apply step may offer, in the order offered: those not entered
 * or hidden (`skip`) nor declined in the last DECLINE_MS (standing_seen.declined, keyed by program); the dated ones
 * closing within APPLY_WINDOW_DAYS whose line says "closes <day>", deadline order (present.ts byDeadline); with none,
 * the rolling ones (no deadline), the program list's order (present.ts byRelevance). Pure.
 */
export function applyCandidates(fits: Fit[], seen: Seen, skip: Set<string>, now: Date): Fit[] {
  const t = now.getTime();
  const ok = fits.filter((f) => {
    const no = seen.declined?.[benchStepKey('apply', f.program_id)];
    return !skip.has(f.program_id) && !(no && t - Date.parse(no) < DECLINE_MS);
  });
  const soon = ok.filter((f) => {
    const end = f.ends_at ? Date.parse(f.ends_at) : NaN;
    return end > t && end - t <= APPLY_WINDOW_DAYS * 86_400_000 && f.when.startsWith('closes ');
  });
  if (soon.length > 0) return soon.sort((a, b) => byDeadline(a.card, b.card));
  return ok.filter((f) => f.ends_at === null).sort((a, b) => byRelevance(a.card, b.card));
}

/** v3 Stage 2: the fits the builder never told EarnKit about (builder_program_status, any status). Null on a read error. Never throws. */
async function openCandidates<F extends Pick<Fit, 'program_id'>>(id: number, fits: F[]): Promise<F[] | null> {
  if (fits.length === 0) return [];
  const told = await sql()<{ program_id: string }[]>`
    SELECT program_id FROM builder_program_status WHERE installation_id = ${id} AND program_id = ANY(${fits.map((f) => f.program_id)}::text[])`.catch(logged('apply told'));
  if (!told) return null;
  const known = new Set(told.map((r) => r.program_id));
  return fits.filter((f) => !known.has(f.program_id));
}

/**
 * v4.7 T3: a draft in the builder's hands for `programId` (a yes to drafting it, or a draft prepare showed), kept in
 * standing_seen.apply_yes, so money first never asks to draft it again; the token offer counts it as the money step
 * (wallet-offer.ts tokenOfferDue). Never throws.
 */
export async function recordApplyYes(id: number, programId: string, now: Date): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{apply_yes}',
      COALESCE(standing_seen->'apply_yes', '{}'::jsonb) || jsonb_build_object(${programId}::text, ${now.toISOString()}::text))
    WHERE builder_id = ${id}`.catch(logged('apply yes'));
}
/**
 * v4.7.2 T2 (exact copy, "Needs why"): what a program needs that EarnKit doesn't know the project has, in this order: on
 * its `needs_contract` chain's mainnet (the project not known on that chain), in a public repo (`needs_repo`, no public
 * verified repo), live at a link (a required submission field filled from live_url, `needs_live` on a Card, no live link
 * known). Pure.
 */
export function programNeeds(
  p: {
    needs_contract?: string | null; needs_repo?: boolean | null; needs_live?: boolean;
    submission_requirements?: { required: boolean; project_field?: string | null }[] | null;
  },
  known: { chains: Set<string>; repo: boolean; live: boolean },
): string[] {
  const out: string[] = [];
  const chain = p.needs_contract?.toLowerCase();
  if (chain && !known.chains.has(chain)) out.push(`on ${chainName(chain)} mainnet`);
  if (p.needs_repo === true && !known.repo) out.push('in a public repo');
  const live = p.needs_live ?? (p.submission_requirements ?? []).some((r) => r.required && r.project_field === 'live_url');
  if (!known.live && live) out.push('live at a link');
  return out;
}
/**
 * v4.7.2 T2: what EarnKit knows of `key`'s project for programNeeds, OR what this reply already knows (`also`: final
 * review 5):
 * - chains: its row's chains or a non-rejected contract the agent reported (onChainKnown's two sources, every chain in
 *   one read)
 * - repo: a verified repo source read public (final review 6: builder_sources.public_at set by the App's read, or its
 *   latest reading saying not private); a private or never-read one never clears "in a public repo"
 * - live: liveOrUsersKnown
 * A failed read is not known. Never throws.
 */
export async function needsKnown(
  id: number, key: string, also: { chains?: string[]; live?: boolean } = {},
): Promise<{ chains: Set<string>; repo: boolean; live: boolean }> {
  const [chains, repo, live] = await Promise.all([
    sql()<{ c: string }[]>`
      SELECT DISTINCT lower(c) AS c FROM (
        SELECT unnest(chains) AS c FROM builder_projects WHERE builder_id = ${id} AND lower(project_key) = lower(${key})
        UNION ALL SELECT split_part(ref, ':', 1) FROM builder_sources WHERE builder_id = ${id} AND lower(project_key) = lower(${key})
          AND kind = 'contract' AND state <> 'rejected' AND ref LIKE '%:%') x`.then((r) => r.map((x) => x.c)).catch(() => [] as string[]),
    sql()<{ yes: boolean }[]>`SELECT EXISTS (SELECT 1 FROM builder_sources b WHERE b.builder_id = ${id} AND lower(b.project_key) = lower(${key})
      AND b.kind = 'repo' AND b.state = 'verified' AND (b.public_at IS NOT NULL
        OR (SELECT r.signals->'private' = 'false'::jsonb FROM source_readings r WHERE r.source_id = b.id AND r.ok ORDER BY r.day DESC LIMIT 1))) AS yes`
      .then((r) => r[0]?.yes === true).catch(() => false),
    also.live === true ? Promise.resolve(true) : liveOrUsersKnown(id, key),
  ]);
  return { chains: new Set([...chains, ...(also.chains ?? []).map((c) => c.toLowerCase())]), repo, live };
}
/** The apply ask for `programId`, claimed once a program (standing_seen.apply_asked, one guarded UPDATE). Never throws. */
async function takeApplyAsk(id: number, programId: string, now: Date): Promise<boolean> {
  const [taken] = await sql()`
    UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{apply_asked}',
      COALESCE(standing_seen->'apply_asked', '{}'::jsonb) || jsonb_build_object(${programId}::text, ${now.toISOString()}::text))
    WHERE builder_id = ${id} AND NOT COALESCE(standing_seen->'apply_asked' ? ${programId}, false) RETURNING 1`.catch((err: unknown) => {
    logged('apply asked')(err);
    return [];
  });
  return Boolean(taken);
}

/**
 * v3 Stage 1 (spec 5.1), Task 16 step 3: the backfilled weeks to confirm, when this person hasn't been offered them
 * (connectDue). v4.2 final review 4: no points are read (the copy never shows them), so no points read can hide the offer. Shown: the offer opens
 * (openConnect) with the Best fit it names (`best`, offered as a draft on the yes). None to confirm once the backfill
 * is complete (backfillComplete): connect_done, never asked; before that, asked again on a later reply. A failed read
 * is no offer, asked again on a later reply. Never throws.
 */
async function connectMoment(id: number, key: string, now: Date, best: Fit | null): Promise<ConnectOffer | null> {
  if (!(await connectDue(id))) return null;
  let weeks = await connectWeeks(id, key, now).catch(logged('connect weeks'));
  if (!weeks) return null;
  // v3.1 cold read round 2: a one project whose log the connect never wrote (the App proved it before it became the one
  // project): written now from its App-proven commits, so the connect question comes before the check-in.
  if (weeks.length === 0 && !(await backfillComplete(id, key, now).catch(() => true))) {
    await backfillNow(id, key, now);
    weeks = (await connectWeeks(id, key, now).catch(logged('connect weeks'))) ?? [];
  }
  if (weeks.length === 0) {
    // v3 final review: closed only once the backfill is complete; until then the offer waits for its rows.
    if (await backfillComplete(id, key, now).catch(logged('connect backfill'))) await closeConnect(id, now);
    return null;
  }
  const mondays = weeks.map((w) => w.monday);
  const pick: ConnectBest | undefined = best
    ? { program_id: best.program_id, title: best.title, amount: best.amount, when: best.ends_at ? best.when.replace(/^closes /, '') : null, ...(best.repo && { repo: best.repo }) }
    : undefined;
  await openConnect(id, { key, weeks: mondays, ...(pick && { best: pick }) });
  return { weeks: weeks.length };
}

export { momentSummary };

/**
 * v4.0 Task 8 fix round 2: whether weeklyMoment would show the Monday block now, without claiming it (its own checks:
 * due this week, last week ready and not approved yet). Never throws (false on an error).
 */
async function momentWouldShow(own: number, id: number, key: string, now: Date): Promise<boolean> {
  if (!(await momentDue(own, now))) return false;
  const last = await lastWeekOf(id, key, now).catch(logged('last week'));
  return Boolean(last && momentReady(last.checked, now) && !last.approved);
}

/**
 * Launch ready L6, Task 16 step 7: the weekly moment (the week's number, weekNumber; where last week
 * left the builder), when this installation hasn't seen this week's
 * moment, the builder had a ranked day last week, and last week's ship log is ready (momentReady: the weekly job wrote
 * it, or its Monday hour passed). Else null, and the week stays unclaimed. Claimed only when shown (takeMoment); the
 * offer then stays open for the week (openShare). v3.1 one-tap posts (design 6): last week's post is drafted when it is
 * worth one (post-reply.ts weeklyPost), else the reply gives the page; no points are shown (owner ruling 5), the yes
 * still earns them (approveWeek). Never throws.
 */
async function weeklyMoment(own: number, id: number, key: string, handle: string, commitWeeks: string[], now: Date): Promise<MomentView | null> {
  if (!(await momentDue(own, now))) return null;
  const last = await lastWeekOf(id, key, now).catch(logged('last week'));
  if (!last || !momentReady(last.checked, now)) return null;
  // v3 Stage 1 fix round 1: a week already confirmed (the connect yes) is never asked about again; the week is claimed.
  if (last.approved) {
    await takeMoment(own, now);
    return null;
  }
  if (!(await takeMoment(own, now))) return null;
  // Owner batch fix wave: the yes binds only to the summary the reply shows (one quoted line, never a question mark or
  // a link, so the reply keeps one question and one link); none shown binds none, and the offer is recorded.
  const shown = momentSummary(last.summary ?? null);
  await openShare(id, { key, week: last.monday, shown_week: isoWeekOf(now), summary: shown });
  if (!shown && last.stored) await markOffered(id, key, last.monday, last.stored);
  const week = weekNumber(commitWeeks, last.monday);
  // v4.0 Task 7: the Monday block's first name and what the community sent (none on a failed read, logged).
  const [post, who, community] = await Promise.all([
    weeklyPost(id, handle, week, now),
    sql()<{ name: string | null }[]>`SELECT x_name AS name FROM builder_profiles WHERE builder_id = ${id}`.catch(logged('moment name')),
    weekCommunityUsd(id, new Date(`${last.monday}T00:00:00Z`), now).catch(logged('community')),
  ]);
  return {
    week, place: momentPlace(last), rank: last.now.rank, summary: shown, post,
    first: firstName(who?.[0]?.name ?? null, handle), score: last.now.score, change: last.before ? last.now.score - last.before.score : null,
    community: community ?? { usd: 0, lastWeekUsd: 0 },
  };
}

/**
 * v2.14 T4 (leaked authorize URL): "Signed in as @<handle>." once, on the first Bench reply after the caller's
 * installation was bound to X (attachToX sets installations.x_signed_in_unseen), so a builder notices a wrong
 * account. Null otherwise. Never throws.
 */
export async function takeSignedIn(own: number, handle: string | null): Promise<string | null> {
  // Final fix 11: cleared only when the line can be shown (a handle), so a reply whose read failed (EMPTY_BASE, no
  // handle) never eats it; the next reply with the page shows it once.
  if (!handle) return null;
  const [r] = await sql()`UPDATE installations SET x_signed_in_unseen = false WHERE id = ${own} AND x_signed_in_unseen RETURNING 1`.catch((err: unknown) => {
    logged('signed in')(err);
    return [];
  });
  return r ? signedInLine(handle) : null;
}

/** Task 16: the account line, unless the reply names the account itself ("You're in, @maya."). Pure. */
const accountLine = (v: BenchView, line: string | null) => (namesAccount(v) ? null : line);

/** O5 fix round 1: a match of the one project is kept this long for a reply that can't wait for it. */
export const BENCH_MATCH_KEEP_MS = 60 * 60_000;
type KeptMatch = { checked: number; scored?: number; fits: RepoFit[] };
/**
 * O5 fix round 1 (N1): the one project's last match (standing_seen.bench_match), written whenever a match
 * finishes, in time or after the reply, so the next reply shows its ways to get funded even when matching
 * a big repo again is cut by the reply's wait. Never throws.
 */
export async function keepBenchMatch(id: number, key: string, m: KeptMatch, now: Date): Promise<void> {
  const kept = { key: key.toLowerCase(), at: now.toISOString(), checked: m.checked, scored: m.scored ?? 0, fits: m.fits };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_match', ${sql().json(kept as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('keep match'));
}
/** The kept match of `key`, under BENCH_MATCH_KEEP_MS old, or null. Never throws. */
export async function keptBenchMatch(id: number, key: string, now: Date): Promise<KeptMatch | null> {
  const [r] = await sql()<{ m: { key?: string; at?: string; checked?: number; scored?: number; fits?: unknown } | null }[]>`
    SELECT standing_seen->'bench_match' AS m FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  const m = r?.m;
  if (!m || m.key !== key.toLowerCase() || typeof m.at !== 'string' || now.getTime() - Date.parse(m.at) >= BENCH_MATCH_KEEP_MS || !Array.isArray(m.fits)) return null;
  return { checked: m.checked ?? 0, scored: m.scored ?? 0, fits: m.fits as KeptMatch['fits'] };
}

/** What find hands benchFind: standFind's arguments, plus the project the agent named. */
export type BenchFindArgs = {
  /** O5 fix round 1: when the call started (Date.now()); every wait ends by start + REPLY_WAIT_MS. */
  start?: number;
  first: FirstMessage;
  cards: FirstMessage['cards'];
  repos: YourRepos | null;
  myEntries: NonNullable<FirstMessage['entries']>;
  /** A results question (an entry's) or, v3 Stage 2, an application's outcome question (kind 'apply', no entry). */
  ask: { kind?: 'results' | 'apply'; project_id: number | null; program_id: string; name: string; program_title: string } | null;
  alerts: { lines: string[] };
  hide: Set<string>;
  project: IdentityProject | null;
  /** Fix round 1: tools.ts's signedOutNow (it skipped the results question while signed out). */
  signedOut?: boolean;
  /** v3 Stage 2: the listed upcoming programs (listPrograms, status 'upcoming'). */
  upcoming?: Card[];
  /** v3.1 cold read: the agent's local_repos report (this call's, else remembered), for what it says of the one project. */
  localRepos?: unknown;
  /**
   * v4.8 Task 1: find's direct question (mcp.ts `ask`: 'standing' or 'programs') and a program the builder named
   * (`program`). Accepted and carried here; Task 5 answers the question and Task 4 stores a named pick. Without them the
   * reply is the path.
   */
  question?: 'standing' | 'programs';
  named?: string;
  /**
   * v4.3 Task 2: the builder asked for the full list (find {more: true}): a ranked reply carries every shown program's
   * table (BenchView.fullTable); any other state answers null before anything is claimed (tools.ts keeps present.ts).
   */
  more?: boolean;
};

/**
 * v3.1 cold read: what the agent's local_repos report says of the one project `main` (owner/repo): a Base mainnet chain
 * or contract reported, a live link. Null when no entry names it. Pure.
 */
export function localReportOf(local: unknown, main: string): { onBase: boolean; live: boolean } | null {
  const list = Array.isArray(local) ? local : [];
  const name = main.toLowerCase().split('/').pop() ?? '';
  const e = list.find((x) => {
    if (!x || typeof x !== 'object') return false;
    const r = x as { url?: unknown; name?: unknown };
    return (typeof r.url === 'string' && refKey(r.url) === main.toLowerCase()) || (typeof r.name === 'string' && r.name.toLowerCase() === name);
  }) as { chains?: unknown; live_url?: unknown } | undefined;
  if (!e) return null;
  const chains = Array.isArray(e.chains) ? e.chains : [];
  const onBase = chains.some((c) => (typeof c === 'string' ? c.toLowerCase() === 'base' : Boolean(c && typeof c === 'object' && (c as { chain?: unknown }).chain === 'base' && (c as { mainnet?: unknown }).mainnet !== false)));
  return { onBase, live: typeof e.live_url === 'string' && /^https:\/\//i.test(e.live_url) };
}

/** v4.2 Task 4 (F6): the lead for a program id; the repo rides only when it is the first fit's own program. Pure. */
const leadOf = (program_id: string, first: Fit): { program_id: string; repo?: string } =>
  program_id === first.program_id ? { program_id, repo: first.repo } : { program_id };

/**
 * find: the three parts in one of the four states (R16a), the one project's proof in the same turn
 * (plan B3) and news since the last look (a statement line above, no link and no question). A results
 * question or a submission step due is the reply's one question (A17). tools.ts adds ask_outcome, matches,
 * programs, working_on and wallet_note. Never a daily-check note.
 */
export async function benchFind(ctx: ToolContext, a: BenchFindArgs): Promise<Reply | null> {
  const id = ctx.installationId;
  const now = a.first.now;
  const own = ctx.ownInstallationId ?? id;
  // v4.3 Task 2: the full list is the Bench's only in the ranked state (signed in, the one project counted); fix round
  // 1 (F4): signed out is read once, and a signed-out "show more" returns before the covered read.
  const signedOut = a.signedOut ?? (await signedOutNow(id, own).catch(() => true));
  if (a.more && signedOut) return null;
  const read = await coveredRead(id, own, now, await benchRead(id, own, now));
  if (a.more && !read.row?.confirmed) return null;
  const live = await liveOf(id, read, now, (a.start ?? Date.now()) + REPLY_WAIT_MS - Date.now());
  const m = { cards: a.cards, repos: a.repos, entries: a.myEntries, now };
  const entered = enteredIds(m);
  const main = read.main?.toLowerCase() ?? null;
  // The money: the programs the one project could apply to (an investment included), deadline order
  // (present.ts byDeadline) for the apply step. v3.1 F1: the fit lines are these same rows in the program list's
  // order (fitLines, as score's); lead and recordShown use the fit lines' grants (never an investment).
  const can = main
    ? layout(m, entered).rows
        // v3 Stage 2: an in-person program is never a fit (a fit is applying from the ship log); it stays on /programs.
        .filter((r) => canApply(r) && !r.card.sponsored && !r.card.in_person && !entered.has(r.card.id) && (r.key ?? r.repo).toLowerCase() === main)
        .sort((a, b) => byDeadline(a.card, b.card))
    : [];
  const facts = new Map((a.repos && 'fits' in a.repos ? a.repos.fits : []).map((f) => [f.repo, f]));
  const fitOf = (r: (typeof can)[number]): Fit => {
    const f = facts.get(r.repo);
    const wf = whyFacts({ chains: f?.facts?.chains, homepage: f?.facts?.homepage, live_verified: f?.live_verified ?? f?.facts?.live_verified });
    const why = fitWhy(r.card, wf);
    return {
      program_id: r.card.id, repo: r.repo, title: r.card.title, amount: awardAmount(r.card), when: fundWhen(r.card), why, ends_at: isoOf(r.card.ends_at),
      investment: r.card.investment === true, card: fitCard(r.card), bar: fitBar(r.card, { live: wf.live, noUsers: r.low_reason === NO_USERS_YET }),
    };
  };
  const shownRows = fitLines(can);
  const fits: Fit[] = shownRows.map(fitOf);
  const rows = shownRows.filter((r) => !r.card.investment);
  const leadFit = fits.find((f) => !f.investment);
  const applies: Fit[] = can.map(fitOf);
  // Fix round 1: signed out, the sign-in question wins; the submission step waits for the bind too.
  const submit = a.ask || signedOut ? undefined : submitStep(m);
  // A17: a results question, else a submission step, is the one question (never a money line).
  // v4.0 Task 8 fix round 1: this week's nudge closing the submit step's own program stands in for its question.
  const closing = !signedOut && !a.ask && submit ? await pickNudge(id, now) : null;
  // Fix round 2: only a candidate; the submit question stays held unless benchView shows the nudge in its place.
  const nudge = closing?.ask?.kind === 'apply' && closing.ask.program_id === submit?.card.id ? closing : null;
  const held = signedOut ? null : a.ask ? outcomeLine(a.ask) : submit ? submitStepLine(submit) : null;
  const due = a.first.deadline ? [a.first.deadline] : [];
  const skip = new Set([...entered, ...a.hide]);
  const name = a.project && projectKeyOf(a.project).toLowerCase() === main ? a.project.name : null;
  // GTM W2: an agent that said it can't build has no folder of the code; remembered so tell's notes fit it too.
  if (a.first.agentCanBuild === false) await rememberNoFolder(id);
  // v3.1 cold read: this match's own read of the one project (a Base deploy, a live link) skips Base's steps it shows met.
  const mine = main ? [...facts.values()].find((f) => (f.key ?? f.repo).toLowerCase() === main) : undefined;
  // The agent's own report of the repo (local_repos: its chains and live link) counts as reported.
  const local = main ? localReportOf(a.localRepos, main) : null;
  const known = mine || local
    ? {
        onBase: creditsMainnet(mine?.facts?.chains?.base) || local?.onBase === true,
        live: Boolean(mine?.live_verified || mine?.facts?.homepage || mine?.facts?.live_verified) || local?.live === true,
      }
    : undefined;
  const ahead: string[] = [];
  const answer: string[] = [];
  const { view, fields, stand } = await benchView({
    id, now, read, own, signedOut, personal: await personal(ctx).catch(() => false), shared: ctx.sharedClient === true, name, fits, applies, nudge, cards: a.cards, upcoming: a.upcoming ?? [], skip, held, due, live,
    codesFetch: ctx.codesFetch, known, more: a.more, named: a.named, ahead, ...(a.question && { question: a.question }), answer,
  });
  // Fix round 1 (R3): never on a nudge-owned reply or step 3 (their question stays last, step 3 word for word).
  // Final review F9: never between a post and its question (benchView opens no post on "show more"; belt and braces).
  if (a.more && view.state === 'ranked' && !view.setupDone && !(view.nudgeOwns && view.nudge) && !['wallet_setup', 'post', 'share'].includes(view.ask.kind))
    view.fullTable = fullProgramTable(m, entered);
  const taken = view.variant === 'taken';
  const lead = Boolean((leadFit && !submit && !taken) || submit);
  // Every reply asks one question now, so news never carries a card offer of its own. R10: the news (a move up
  // the rank) is shown only when the reply itself shows that rank; otherwise it is still recorded, never shown.
  const recorded = read.profiled ? await takeNews(id, read.seen, read.base, now, false).catch(logged('news')) : null;
  // Re-review minor (N2): never rank news at a score of 0 (the standing shows no rank then).
  const news = view.rank && (stand.score ?? 0) > 0 ? recorded : null;
  const opener = newsOpener(a.alerts.lines, news ? [news] : []);
  const signedIn = accountLine(view, await takeSignedIn(own, view.handle));
  // v3.1 wallet proof fix round: a changed reward wallet is said once, on the next reply.
  const walletNews = await takeWalletNotice(id);
  // 2026-10-23: the picker refused only forks or templates: the way out, once (never signed out).
  if (view.state !== 'signed_out') view.notice = await takeTemplateNotice(id);
  await recordShown(
    id,
    rows.flatMap((r) =>
      r.key && r.row
        ? [{ program_id: r.card.id, repo_key: r.key, status: r.v.status, product_score: r.product_score, row_level: r.row.level, traction: r.product_score === null ? null : r.traction }]
        : [],
    ),
  ).catch(logged('match shown'));
  return {
    // The account line (it guards a wrong sign-in) and any news lead.
    // v4.8 Task 5: a direct question's answer first of all, then the reply (its path step last).
    // Fix round 1 (7): the account line (it guards a wrong sign-in) stays first, then the answer.
    show_to_builder: [signedIn, ...answer, walletNews, opener, ...ahead, benchReply(view)].filter(Boolean).join('\n\n'),
    // O5 (P8): the earn note names lead.program_id, so only with a lead. v4.8 Task 1: a path reply carries the mentor
    // note alone (the agent rewords it), and its lead is the hooked program when its yes drafts it.
    // Fix round 1 (8): an answered reply's note says the answer is already first (never a second answer).
    note: view.path ? [answer.length > 0 ? ANSWERED_FIRST : null, view.pathNote, MENTOR_NOTE].filter(Boolean).join(' ') : [answer.length > 0 ? ANSWERED_FIRST : ANSWER_FIRST_NOTE, lead ? EARN_NOTE : null].filter(Boolean).join(' '),
    ...fields,
    // v4.2 Task 4 (F6): the lead is the money line's program (view.best, the applyCandidates pick), never a second rule.
    // v4.8 Task 4: the signed-out opener keeps the lead (the fit the agent prepares), as the setup reply did.
    ...((!view.path || view.state === 'signed_out') && leadFit && !submit && !taken && { lead: leadOf(view.best?.program_id ?? leadFit.program_id, leadFit) }),
    ...(view.pathLead && { lead: view.pathLead }),
    ...(submit && { lead: { program_id: submit.card.id, step: 'submit', ...(submit.entry.id !== undefined && { project_id: submit.entry.id }) } }),
  };
}

/**
 * score on the Bench: the profile (and a discovery run) on the first call, the refresh within
 * its budget, then find's view without a matcher: the one project's fits from what find last saw
 * (stand-view.ts scoreFits, at most 3, R12). One score_viewed event a minute (v2.12). Null without a
 * profile (score-tool.ts answers that).
 */
export async function benchScore(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'tokenDeps' | 'codesFetch' | 'sharedClient'>, now: Date, o: { reader?: ReaderDeps } = {}): Promise<Reply | null> {
  const id = ctx.installationId;
  const made = await ensureProfile(id, now);
  if (!made) return null;
  if (made.created) await enqueueDiscovery(id, 'first_find');
  // O5 N1: the refresh runs on, but the reply waits for it at most REPLY_WAIT_MS.
  const start = Date.now();
  const refresh = startRefresh(id, { now, start, reader: o.reader });
  await refresh.within(REPLY_WAIT_MS);
  // D14: the caller's own installation, as find's.
  const own = ctx.ownInstallationId ?? id;
  const read = await coveredRead(id, own, now, await benchRead(id, own, now));
  const live = await liveOf(id, read, now, start + REPLY_WAIT_MS - Date.now());
  const { applies, cards: shown, upcoming, skip } = await scoreApplies(id, read.main, now);
  const fits: Fit[] = fitLines(applies);
  const leadFit = fits.find((f) => !f.investment);
  const ahead: string[] = [];
  const { view, fields, stand } = await benchView({
    id, now, read, own, signedOut: await signedOutNow(id, own).catch(() => true), personal: await personal(ctx).catch(() => false), shared: ctx.sharedClient === true, name: null, fits, applies, cards: shown, upcoming, skip, held: null,
    due: [], live, codesFetch: ctx.codesFetch, alwaysStanding: true, ahead,
  });
  await noteEvent('score_viewed', () => ({
    type: 'score_viewed',
    dedupe_key: `score_viewed:${id}:${Math.floor(now.getTime() / 60_000)}`,
    installation_id: id,
    detail: { rank: read.base.standing.ranked ? read.base.standing.rank : null, total: read.base.standing.total },
  }));
  const signedIn = accountLine(view, await takeSignedIn(own, view.handle));
  const walletNews = await takeWalletNotice(id);
  if (view.state !== 'signed_out') view.notice = await takeTemplateNotice(id);
  // v4.7 T2: the builder asked where they stand, so the standing is the first paragraph (never signed out, where the
  // sign-in step is the reply, nor setup step 3, said word for word). Fix round 1: only with a score or a streak part
  // (R5), and never over the Monday block or a post offer, which answer it themselves (R4).
  const block = !view.held && ((view.ask.kind === 'share' && view.moment && view.handle) || (view.ask.kind === 'post' && view.post));
  view.standingLed = view.state !== 'signed_out' && !(view.ask.kind === 'wallet_setup' && !view.held) && !block && standingLeads(stand) && Boolean(fields.standing);
  return {
    show_to_builder: [view.standingLed ? fields.standing : null, signedIn, walletNews, ...ahead, benchReply(view)].filter(Boolean).join('\n\n'),
    ...fields,
    note: view.path ? [view.pathNote, MENTOR_NOTE].filter(Boolean).join(' ') : [ANSWER_FIRST_NOTE, leadFit && view.variant !== 'taken' ? EARN_NOTE : null].filter(Boolean).join(' '),
    ...((!view.path || view.state === 'signed_out') && leadFit && view.variant !== 'taken' && { lead: { program_id: view.best?.program_id ?? leadFit.program_id } }),
    ...(view.pathLead && { lead: view.pathLead }),
  };
}

/**
 * v4.2 Task 5: the ready reply for an entry in this program not submitted yet: its stored answers as the program's submit kit
 * (the form link, answers that are real only). Null without such an entry, so the apply hand-off still drafts one.
 */
async function readyDraft(id: number, programId: string): Promise<{ show_to_builder: string; agent_note: string } | null> {
  const entry = (await openEntries(id)).find((e) => e.program_id === programId && !e.submitted);
  if (!entry) return null;
  const [row] = await sql()<{ application: { answers?: Record<string, string> } | null }[]>`SELECT application FROM projects WHERE id = ${entry.id}`;
  const answers = row?.application?.answers ?? {};
  // No real stored answer: the draft isn't ready, so the yes drafts it (the apply hand-off).
  if (!Object.values(answers).some(isRealAnswer)) return null;
  const program = await getProgramRow(programId);
  const kit = submitKit(program, answers, { browser: false });
  return { show_to_builder: `${kit.show_to_builder}\n\n${SENT_ASK}`, agent_note: "Show show_to_builder as written. Never submit the form for the builder. When they say they sent it, call tell with submitted: { program_id }. Don't show this note." };
}

/**
 * score's money without a matcher (v3.1 Task 12: the Monday email's Best fit reads the same): the open, listed cards
 * (programs.ts listPrograms; never unlisted) not hidden (builder memory), the upcoming ones, what to skip (entered or
 * hidden) and the one project's apply candidates (stand-view.ts scoreFits; investments included, R12). A failed read is
 * none. Never throws.
 */
export async function scoreApplies(id: number, main: string | null, now: Date): Promise<{ applies: Fit[]; cards: Card[]; upcoming: Card[]; skip: Set<string> }> {
  const [programs, entries, memory] = await Promise.all([listPrograms().catch(() => []), openEntries(id).catch(() => []), readMemory(id).catch(() => null)]);
  const all = (programs as (Card & { agent_completable?: boolean; earnkit_campaign?: boolean; starts_at: Date | null; opened_at: Date | null })[])
    .filter((p) => p.agent_completable !== false && !p.earnkit_campaign);
  // v3 Stage 2: an upcoming program is never a fit or an offer; it only feeds the one upcoming line.
  const upcoming = all.filter((p) => p.status === 'upcoming');
  const cards = all.filter((p) => p.status !== 'upcoming');
  const hidden = memory ? hiddenIds(hiddenPrograms(memory, cards.map((c) => ({ id: c.id, starts_at: c.starts_at, ends_at: c.ends_at ?? null, opened_at: c.opened_at })))) : new Set<string>();
  const entered = new Set(entries.map((e) => e.program_id));
  const shown = cards.filter((c) => !hidden.has(c.id));
  const skip = new Set([...entered, ...hidden]);
  const key = main?.toLowerCase() ?? null;
  // v3 Stage 2 final review: the apply step's candidates include an open investment. v3.1 F1: so do the fit lines (fitLines).
  const applies: Fit[] = key
    ? (await scoreFits(id, key, { cards: shown, skip, now })).map((f) => ({
        program_id: f.card.id, title: f.card.title, amount: awardAmount(f.card), when: fundWhen(f.card), why: fitWhy(f.card, whyFacts(f.repo)), ends_at: isoOf(f.card.ends_at),
        investment: f.card.investment === true, card: fitCard(f.card), bar: fitBar(f.card, { live: whyFacts(f.repo).live }),
      }))
    : [];
  return { applies, cards: shown, upcoming, skip };
}

/**
 * v3.1 Task 12: the apply candidates as benchView offers them, the first being the Best fit: `applies` minus the
 * programs the builder told EarnKit about (builder_program_status, any status), then applyCandidates. Null on a read
 * error. Never throws.
 */
export async function bestApplies(id: number, applies: Fit[], seen: Seen, skip: Set<string>, now: Date): Promise<Fit[] | null> {
  const told = await openCandidates(id, applies);
  return told === null ? null : applyCandidates(told, seen, skip, now);
}

/** T8 fix round 1: ask kinds a pre-v2.14 reply may have stored (the updates yes and the week's post). */
const RETIRED_ASKS = ['updates', 'post_update'] as const;
/**
 * T9 fix round 1: other retired kinds: a yes clears them and is "Okay.". The build ask and grants (pre-v2.14);
 * R8: the entry, coin, community-round and go-live asks a reply stored before the ranked step became
 * "Ship this week to climb."; v4.0 Task 11: the retired per-project offer's asks (backing, its publish-first and fee
 * wallet questions, the backers post).
 */
const OLD_ASKS = ['build', 'grants', 'grants_later', 'enter', 'coin', 'raise', 'go_live', 'backing', 'coin_publish', 'coin_wallet', 'backers_post'] as const;
/** v2.14 spec 4: the asks answered once (cleared before the yes runs). */
const TAKEN_ONCE: readonly string[] = ['sign_in', 'start', 'pick_repo', 'install_app', 'other_project', 'repo_behind', 'ship', 'suggest', 'apply', 'titles', 'qualify', 'closest', 'check_fits', 'post', 'new_repo', 'outcome_share', 'stripe', ...RETIRED_ASKS, ...OLD_ASKS];
/** Fix round: asks a tell with no `kind` is routed to by the stored question (their own paths below). */
const KINDLESS_ROUTED: readonly string[] = ['pick_repo', 'base_start', 'next_step', 'new_repo', 'base_help', 'checkin', 'wallet_setup', 'token'];

/** The ask stored with the last Bench reply, when the agent's answer names it (kind, if given, and project_key). */
export async function benchAsked(id: number, m: { kind?: string; project_key?: string | null }): Promise<NonNullable<Seen['bench_ask']> | null> {
  const [p] = await sql()<{ ask: Seen['bench_ask'] | null }[]>`SELECT standing_seen->'bench_ask' AS ask FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
    logged('asked')(err);
    return [];
  });
  const asked = p?.ask;
  if (!asked || typeof asked !== 'object' || typeof asked.kind !== 'string') return null;
  if (m.kind !== undefined && m.kind !== asked.kind) return null;
  if ((m.project_key ?? null)?.toLowerCase() !== (asked.key ?? null)?.toLowerCase()) return null;
  return asked;
}

/**
 * Task 16 step 4: the connect yes offers to draft the Best fit its offer named: the apply ask, stored as find's would be
 * (bench_ask, standing_seen.apply_asked: once a program), unless the builder told EarnKit about the program, said no to
 * it within DECLINE_MS, or was asked already. Null otherwise. Never throws.
 */
async function connectApply(id: number, best: ConnectBest, key: string | null, now: Date): Promise<{ line: string; move_up: Reply } | null> {
  const [p] = await sql()<{ seen: Seen | null; key: string | null }[]>`
    SELECT standing_seen AS seen, main_project_key AS key FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
    logged('connect apply')(err);
    return [];
  });
  if (!p) return null;
  const projectKey = key ?? p.key;
  if ((await openCandidates(id, [best]))?.length !== 1) return null;
  const no = p.seen?.declined?.[benchStepKey('apply', best.program_id)];
  if (no && now.getTime() - Date.parse(no) < DECLINE_MS) return null;
  if (!(await takeApplyAsk(id, best.program_id, now))) return null;
  const stored = { kind: 'apply', key: projectKey, program_id: best.program_id, ...(best.repo && { repo: best.repo }) };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(stored as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('connect apply ask'));
  return { line: connectApplyAsk(best.title), move_up: { kind: 'apply', project_key: projectKey, agent_note: APPLY_NOTE } };
}

/**
 * 2026-10-22: after the connect yes, the titles question for the one project (titlesAskDue), claimed once and stored as
 * the Bench's ask, so its yes turns titles on. Null otherwise. Never throws.
 */
async function connectTitles(id: number, key: string | null, now: Date): Promise<Reply | null> {
  const [p] = await sql()<{ key: string | null }[]>`SELECT main_project_key AS key FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
    logged('connect titles')(err);
    return [];
  });
  const projectKey = key ?? p?.key ?? null;
  if (!projectKey || !(await titlesAskDue(id, projectKey, now)) || !(await takeTitlesAsk(id, now))) return null;
  const stored = { kind: 'titles', key: projectKey };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(stored as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('connect titles ask'));
  return { kind: 'titles', project_key: projectKey, agent_note: TITLES_NOTE };
}

/**
 * A no's key in standing_seen.declined: the apply ask's program ('apply:<id>'), v4.7.2 T2: the ranked needs ask's
 * program ('needs:<id>'), else the ask's kind and project ('<kind>:<key>'). Pure.
 */
const declineKeyOf = (asked: NonNullable<Seen['bench_ask']>) =>
  asked.kind === 'apply' ? benchStepKey('apply', asked.program_id ?? null)
    : asked.kind === 'check_fits' && asked.program_id ? benchStepKey('needs', asked.program_id)
    : benchStepKey(asked.kind, asked.key);

/**
 * The builder's yes or no to the Bench's question (tools.ts moveUpAnswer routes it here). Only the ask stored with the last reply is answered; anything else is
 * "Okay." with nothing changed. A no is noted (standing_seen.declined) and clears the ask; the next reply asks its state's step again.
 */
export async function benchMoveUp(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'tokenDeps' | 'builderTokenDeps'> & Partial<Pick<ToolContext, 'sharedClient'>>, m: { kind?: string; project_key?: string | null; answer: 'yes' | 'no'; live_url?: string; via?: 'coin'; blanks?: string }): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  const okay = { show_to_builder: NOTED_LINE };
  // 2026-10-23 fix round: a tell with no kind answers the stored question when it is an onboarding one (so a kindless
  // no to step 2 is remembered and a kindless yes to the walk-through gives the steps).
  // v4.2: only the builder's own move_up {kind:'token', answer:'yes'} reverses a no; a kindless yes riding a stored ask or an old coin yes does not.
  const ownTokenYes = m.kind === 'token' && m.via !== 'coin';
  if (m.kind === undefined) {
    const stored = await benchAsked(id, { project_key: m.project_key });
    if (stored && KINDLESS_ROUTED.includes(stored.kind)) m = { ...m, kind: stored.kind };
  }
  // v3 Stage 1 (spec 5.1): the connect offer is answerable once (standing_seen.connect_open is its guard).
  if (m.kind === 'connect') {
    const r = await answerConnect(id, m.project_key, m.answer, now).catch(logged('answer connect'));
    if (r && r.pending > 0) {
      // An approval threw and the offer reopened: keep the ask so the next yes retries it.
      const [o] = await sql()<{ key: string | null }[]>`SELECT standing_seen->'connect_open'->>'key' AS key FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
        logged('connect key')(err);
        return [];
      });
      const key = o?.key ?? m.project_key ?? null;
      const ask = { kind: 'connect', key };
      await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(ask as never)}::jsonb) WHERE builder_id = ${id}`.catch(logged('keep connect ask'));
      return { show_to_builder: CONNECT_RETRY, move_up: { kind: 'connect', project_key: key, agent_note: CONNECT_NOTE } };
    }
    if (r) await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'connect'`.catch(logged('clear connect ask'));
    if (!r || r.approved === 0) return okay;
    const [p] = await sql()<{ handle: string | null }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
      logged('connect handle')(err);
      return [];
    });
    const done = p?.handle ? CONNECT_DONE(`${siteUrl()}${pagePath(p.handle)}`) : APPROVED_CONNECT;
    // Task 16 step 4: the Best fit the offer named is offered as a draft (the apply ask, once a program), else the email question.
    const apply = r.best && p?.handle ? await connectApply(id, r.best, m.project_key ?? null, now) : null;
    if (apply) return { show_to_builder: [done, apply.line].filter(Boolean).join('\n'), move_up: apply.move_up };
    // 2026-10-22: a private repo with titles off hears the titles question here, once (before the email question).
    const titles = p?.handle ? await connectTitles(id, m.project_key ?? null, now) : null;
    if (titles) return { show_to_builder: [done, TITLES_ASK].filter(Boolean).join('\n'), move_up: titles };
    // The You're live line is a statement, so the email question (when it is asked) is the reply's one question.
    const email = digestEnabled() ? await askWeeklyEmail(id, { shared: false, email: null }).catch(logged('connect email')) : null;
    return { show_to_builder: [done, email?.question].filter(Boolean).join('\n'), ...(email && emailMoveUp(m.project_key ?? null)) };
  }
  // Launch ready L6 (fix round 1): the share offer is answerable all week it was shown, once (standing_seen.share_open).
  if (m.kind === 'share') {
    const r = await answerShare(id, m.project_key, m.answer, now).catch(logged('answer share'));
    if (r === true) {
      await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'share'`.catch(logged('clear share ask'));
      // v3 Stage 1 (spec 5.4): the first yes after activation asks for the address, once (digest_asked_at), as the reply's one question.
      const email = digestEnabled() ? await askWeeklyEmail(id, { shared: false, email: null }).catch(logged('share email')) : null;
      return { show_to_builder: [APPROVED_LINE, email?.question].filter(Boolean).join('\n'), ...(email && emailMoveUp(m.project_key ?? null)) };
    }
    return okay;
  }
  // v3.1 wallet proof fix round: the wallet step is answered from its state (a link given, a wallet proven since), so a
  // "done" after another reply still checks it (wallet-offer.ts answerWallet).
  if (m.kind === 'wallet') return afterStep3(id, await answerWallet(id, m.answer, now), now, ctx.ownInstallationId ?? id);
  // v4.0 setup step 3: "done" is the wallet's yes; v4.4: a no is the wallet skip (a builder shown v4.0's token sentence:
  // the token's no, setupAnswer).
  if (m.kind === 'wallet_setup') return afterStep3(id, await setupAnswer(ctx, id, m.answer, now), now, ctx.ownInstallationId ?? id);
  // v4.0: the builder said no to their token (kept forever), or asked to launch it.
  if (m.kind === 'token') {
    // v4.4: the answer to the offer that followed step 3's sign (the stored ask's setup) is the setup-done reply.
    const t = await takeTokenAsk(id);
    const r = await tokenAnswer(ctx, id, m.answer, now, ownTokenYes);
    if (t?.setup && (await builderToken(id).catch(() => null))) return (await setupDoneFor(id, now, null, ctx.ownInstallationId ?? id)) ?? r;
    return afterStep3(id, r, now, ctx.ownInstallationId ?? id);
  }
  // v4.0 Task 11 fix round 1: an old agent's coin answer is the builder token's only after its offer (legacyCoinAnswer);
  // otherwise the stored-ask path below (an old 'coin' ask is cleared, nothing launched).
  if (m.kind === 'coin') {
    const r = await legacyCoinAnswer(ctx, m.answer);
    if (r) return r;
  }
  // 2026-10-23 Base onboarding: step 2's no is remembered (never repeated) and its yes after a no is the builder asking
  // for the link again; the walk-through is answered by its kind, so the builder can ask for it any time.
  if (m.kind === 'pick_repo') {
    const r = await githubAnswer(id, m.answer, now);
    if (r) return r;
  }
  // GTM W2: an older reply's "Where does <app> live on GitHub?" answered no is the GitHub no too (never "Okay.").
  if (m.kind === 'repo_behind' && m.answer === 'no') {
    const r = await githubAnswer(id, 'no', now);
    if (r) return r;
  }
  if (m.kind === 'base_start') return baseStartAnswer(id, m.answer, now);
  if (m.kind === 'base_help') return baseHelpAnswer(id, m.answer);
  if (m.kind === 'next_step') return restAnswer(id, m.answer, now);
  if (m.kind === 'checkin') return checkinAnswer(id, m.answer, now);
  if (m.kind === 'weekly_email') return emailAnswer(id, m.answer);
  const asked = await benchAsked(id, m);
  if (!asked) return okay;
  if (asked.kind === 'wallet') return afterStep3(id, await answerWallet(id, m.answer, now), now, ctx.ownInstallationId ?? id);
  if (asked.kind === 'wallet_setup') return afterStep3(id, await setupAnswer(ctx, id, m.answer, now), now, ctx.ownInstallationId ?? id);
  if (m.answer === 'no') {
    // Final review F8: at submit a no is "not yet": the stage and its ask stay, and the reply points back to it. Only
    // program_status not_interested (SENT_NOTE: they won't apply) takes it off the path.
    // Re-review blocker 2: the first no says so once ("No rush, it stays ready until ..."); a second no in the session
    // hands off to the next program (find, run in this tell) and the application waits, drafted and never parked
    // (standing_seen.submit_wait), for the next session's opener to point to it again.
    if (asked.path === true && asked.submit === true && asked.program_id) {
      const pid = asked.program_id;
      const [row0] = await sql()<{ seen: Seen | null }[]>`SELECT standing_seen AS seen FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
      if (sessionOf(row0?.seen ?? {}, now).said.has(`submit_no:${pid}`)) {
        await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) - 'bench_ask')
            || jsonb_build_object('submit_wait', ${pid}::text, 'said', ${saidSql([`submit_skip:${pid}`], now)})
          WHERE builder_id = ${id}`.catch(logged('submit wait'));
        // Last ruling 2: the hand-off leads with the kept draft.
        const kept = (await getProgramRow(pid).catch(() => null))?.title;
        return { show_to_builder: kept ? keepDraftLine(kept) : '', then_find: true };
      }
      const row = await getProgramRow(pid).catch(() => null);
      await storeAsk(id, asked);
      await markSaid(id, [`submit_no:${pid}`], now);
      const line = row ? submitNoRush({ when: closeDay(row) ? 'dated' : 'rolling', ends_at: row.ends_at ? new Date(row.ends_at).toISOString() : null, zone: programZone(row) }, now) : SENT_AGAIN;
      return { show_to_builder: line, agent_note: withMentor(SENT_NOTE), move_up: { kind: 'apply', project_key: asked.key, agent_note: SENT_NOTE } };
    }
    // v4.8 Task 1 (Review Focus 2): a no to the path's hook parks its program ('path:<id>') beside the ask's own key.
    const park = asked.path === true && asked.program_id ? { [benchStepKey('path', asked.program_id)]: now.toISOString() } : {};
    const declined = { [declineKeyOf(asked)]: now.toISOString(), ...park };
    await sql()`
      UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
        COALESCE(standing_seen->'declined', '{}'::jsonb) || ${sql().json(declined as never)}::jsonb) - 'bench_ask'
      WHERE builder_id = ${id}`.catch(logged('decline'));
    // Final review F7: a no to a path ask is one line, then find's reply in the same tell (tools.ts runs it: then_find),
    // so the builder's next easy reply is the next program, never a bare "Okay.".
    if (asked.path === true && asked.program_id) {
      const title = asked.program ?? asked.qualify?.grant.name ?? (await getProgramRow(asked.program_id).catch(() => null))?.title ?? null;
      return { show_to_builder: title ? setAsideLine(title) : NOTED_LINE, then_find: true };
    }
    // v4.8 re-review blocker 1: a no to the quiet reply's ship ask is "Okay." then find's reply (its "more" ask), never
    // "Okay." alone.
    if (asked.kind === 'ship' || asked.kind === 'suggest') return { ...okay, then_find: true };
    return asked.kind === 'titles' ? { show_to_builder: TITLES_NO_LINE } : okay;
  }
  // Fix round 1: answered once. The ask is cleared before the yes runs, so a retried yes is "Okay.".
  if (TAKEN_ONCE.includes(asked.kind)) {
    const [taken] = await sql()`
      UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask'
      WHERE builder_id = ${id} AND standing_seen->'bench_ask' = ${sql().json(asked as never)}::jsonb RETURNING 1`.catch((err: unknown) => {
      logged('take ask')(err);
      return [];
    });
    if (!taken) return okay;
  }
  // v2.14 spec 3: the ship log writes itself; a yes to a retired posting ask says so.
  if ((RETIRED_ASKS as readonly string[]).includes(asked.kind)) return { show_to_builder: UPDATE_LINES.auto };
  switch (asked.kind) {
    case 'sign_in':
      return { show_to_builder: '', agent_note: SIGN_IN_YES_NOTE };
    case 'start':
      return { show_to_builder: '', agent_note: START_YES_NOTE };
    case 'pick_repo':
      // v3.1 cold read (bug 1): nothing connected yet is said, never an empty reply; connected: the agent calls find.
      return (await connectNotYet(id, now)) ?? { show_to_builder: '', agent_note: PICK_REPO_YES_NOTE };
    case 'install_app':
      return { show_to_builder: '', agent_note: INSTALL_APP_YES_NOTE };
    case 'other_project':
      return { show_to_builder: '', agent_note: OTHER_PROJECT_NOTE };
    case 'repo_behind':
      return { show_to_builder: '', agent_note: REPO_BEHIND_NOTE };
    case 'ship':
    case 'suggest':
      return asked.key ? { show_to_builder: '', agent_note: (await agentReach(ctx.ownInstallationId ?? id, id)).hosted ? SHIP_NOTE_HOSTED : SHIP_NOTE } : okay;
    case 'titles':
      // 2026-10-22: the titles question's yes turns titles on (the tell updates { titles: true } path).
      return setShipTitles(id, { titles: true }, now);
    case 'stripe': {
      // v4.6 Task 3: the yes sends the link again (a fresh 30-minute token); never a key or an account id.
      const link = stripeLink(id, now);
      return { show_to_builder: link ? stripeConnectLine(link) : STRIPE_NO_LINK, agent_note: STRIPE_NEVER_KEY };
    }
    case 'qualify':
      // 2026-10-22: the steps the question was asked with (the program's rules, the ones not known met). Fix round 1:
      // the yes is remembered (qualify_given), so the next replies move on to the ship step for DECLINE_MS.
      // v4.8 Task 2 fix round 3 (5): the ok to "I'm checking the code now" (it may carry no steps).
      if (asked.path === true && asked.checking === true && asked.program_id) return gapDoYes(ctx, id, asked, now);
      if (!asked.qualify?.steps?.length || !asked.key) return okay;
      await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{qualify_given}',
          COALESCE(standing_seen->'qualify_given', '{}'::jsonb) || jsonb_build_object(${asked.key.toLowerCase()}::text, ${now.toISOString()}::text))
        WHERE builder_id = ${id}`.catch(logged('qualify given'));
      // v4.8 Task 2: the path's gap stage (the hook's yes: the steps; the steps' yes: the agent does the first one).
      if (asked.path === true && asked.program_id) return asked.gap === true ? gapDoYes(ctx, id, asked, now) : gapYes(ctx, id, asked, now);
      // v4.3 (owner-approved): "Want me to add Builder Codes to EarnKit?": its yes is the doing, never another question.
      // Fix round 1 (R1): a hosted agent was asked for the steps (it can't add code), so its yes is the steps reply below.
      if (asked.qualify.first === 'codes' && asked.qualify.name && asked.qualify.hosted !== true)
        return { show_to_builder: qualifyCodesYes(asked.qualify.name, asked.qualify.codes_missing !== false), agent_note: asked.qualify.codes_missing === false ? QUALIFY_CODES_CHECK_NOTE : QUALIFY_CODES_NOTE };
      {
        const hostedNow = (await agentReach(ctx.ownInstallationId ?? id, id)).hosted;
        // Final review F4: "Want help putting EarnKit on Base?" was already a yes to help: the steps, no second question.
        if (asked.qualify.first === 'base' && asked.qualify.name)
          return {
            show_to_builder: qualifySteps(asked.qualify.grant, asked.qualify.steps as QualifyStep[], false),
            agent_note: hostedNow ? QUALIFY_BASE_YES_NOTE_HOSTED : QUALIFY_BASE_YES_NOTE,
          };
        return {
          show_to_builder: qualifySteps(asked.qualify.grant, asked.qualify.steps as QualifyStep[]),
          agent_note: hostedNow ? QUALIFY_STEPS_NOTE_HOSTED : QUALIFY_STEPS_NOTE,
        };
      }
    case 'check_fits':
      // v4.8 Task 2: the path's hook of a grant other than Base's: its yes is the gap stage's steps.
      if (asked.path === true && asked.program_id) return asked.gap === true ? gapDoYes(ctx, id, asked, now) : gapYes(ctx, id, asked, now);
      // v4.2 (setup done, final review 3's own kind): the yes is find run again, to check which programs fit. v4.7.1 T1:
      // the ask named an open grant (asked.program; v4.8: the path's hook of a grant with a gap); final review 4: its
      // note lists the program's needs, with no find again. (v4.8: needs_yes is no longer written or read.)
      return { show_to_builder: '', agent_note: asked.program ? needsYesNote(asked.program, Array.isArray(asked.needs) ? asked.needs : undefined) : CHECK_FITS_NOTE };
    case 'closest':
      // v4.2 (setup done, final review 3's own kind): the closest program's one step, never a draft.
      if (!asked.program || !asked.step) return okay;
      return {
        show_to_builder: `Your next step toward ${asked.program}: ${asked.step}.\n\n${QUALIFY_HELP_ASK_ONE}`,
        agent_note: (await agentReach(ctx.ownInstallationId ?? id, id)).hosted ? QUALIFY_STEPS_NOTE_HOSTED : QUALIFY_STEPS_NOTE,
      };
    case 'new_repo':
      return { show_to_builder: '', agent_note: NEW_REPO_YES_NOTE };
    case 'more':
      // v4.8 re-review blocker 1: "more" is the programs answer (find ask 'programs', run in this tell).
      return { show_to_builder: '', then_find: { ask: 'programs' } };
    case 'post':
      // v3.1 one-tap posts: a different version of the post (the next shape; the builder asked, so the asked limit holds).
      return (await redraftAnswer(id, asked as Parameters<typeof redraftAnswer>[1], now)) ?? okay;
    case 'outcome_share':
      // v4.0 Task 8 fix round 1: the yes to the accepted nudge's "Want to share it?": its post's one-tap link.
      return typeof asked.link === 'string' && /^https:\/\//.test(asked.link) ? { show_to_builder: outcomeShareLine(asked.link) } : okay;
    case 'apply': {
      // v4.8 Task 3 fix round 1 (2): a plain yes or ok to the submit ask is never "sent": the ask again (kept).
      if (asked.path === true && asked.submit === true) {
        await storeAsk(id, asked);
        return { show_to_builder: SENT_AGAIN, agent_note: withMentor(SENT_NOTE), move_up: { kind: 'apply', project_key: asked.key, agent_note: SENT_NOTE } };
      }
      // v4.2 Task 5: the closing-soon nudge's yes ("Your draft is ready. Want to send it?"): the entry's ready kit with its link.
      const ready = asked.program_id ? await readyDraft(id, asked.program_id).catch(() => null) : null;
      if (ready) return ready;
      // v3 Stage 2: prepare drafts the entry; the lead names the program (and the repo find matched). v4.7 T3: the yes is
      // kept (apply_yes), so money first never asks to draft it again.
      if (asked.program_id) await recordApplyYes(id, asked.program_id, now);
      // v4.8 Task 2: the path's "Want me to start?": the draft stage. A yes to the draft's own ask (fix round 2, F5)
      // re-asks its blanks, or with none moves the path to submit; never a second draft.
      if (asked.path === true && asked.draft === true) return draftYes(id, asked, now, m.blanks);
      if (asked.path === true && asked.program_id) return pathDraft(ctx, id, asked, now);
      return asked.program_id
        ? { show_to_builder: '', agent_note: APPLY_YES_NOTE(asked.program_id), lead: { program_id: asked.program_id, ...(asked.repo && { repo: asked.repo }) } }
        : okay;
    }
    default:
      // A retired ask (OLD_ASKS): nothing to do; the next reply asks the state's step.
      return okay;
  }
}

/** v4.8 Task 2: a path reply's agent note: `note` (its own "Don't show this note." dropped), then MENTOR_NOTE. Pure. */
const withMentor = (note: string) =>
  `${note.replace(/\s*Don't show this note\.$/, '').replace(/\s*Never tell them they qualify or that an application was sent\./g, '')} ${MENTOR_NOTE}`;
/** v4.8 Task 4 fix round 0 (8): the Builder Codes yes's one easy reply, once the agent has pushed the change. */
export const PUSHED_ASK = "Say ok once the change is pushed, and I'll check it.";
/** v4.8 Task 2: the gap step's yes for an agent with the code: do the step here, push it, then call find (EarnKit checks it on GitHub). */
export const GAP_DO_NOTE =
  'The builder said yes to the step marked "I can do this": do it now in their code here, show them the change, then commit and push it (EarnKit checks the code on GitHub) and call find. ' +
  'Never tell them they qualify or that an application was sent.';
/** v4.8 Task 2: the gap step's yes for an agent with no folder of the code (agent-reach.ts hosted). */
export const GAP_HELP_NOTE_HOSTED =
  'The builder said yes to help with the first step listed: walk them through it in short plain steps they can do themselves (follow the guide linked). ' +
  "When they say it is done (ok), call tell with move_up: { kind, project_key, answer: 'yes' } (as given in move_up) so EarnKit checks it. " +
  'Never tell them they qualify or that an application was sent.';
/** v4.8 Task 2: the gap step's yes when no step is one the agent can do in the repo (a chain deployment, a sign-in). */
export const GAP_HELP_NOTE =
  'The builder said yes to help with the first step listed: help them with it now, here (follow the guide linked). ' +
  "When they say it is done (ok), call tell with move_up: { kind, project_key, answer: 'yes' } (as given in move_up) so EarnKit checks it. " +
  'Never tell them they qualify or that an application was sent.';
/** v4.8 Task 2: a step programNeeds names ("on Arc mainnet", "in a public repo", "live at a link") as a line. Pure. */
const needStep = (name: string, need: string) => `${need === 'in a public repo' ? 'Put' : 'Get'} ${name} ${need}.`;

/**
 * v4.8 Task 2: the yes to the path's "Want the steps?": the gap stage. Base's steps from the stored offer
 * (bench-reply.ts qualifyGapSteps), another grant's from programNeeds' gaps (stored with the ask) plus its program
 * file's setup. Each step the agent can do is marked, unless the agent is hosted (F3: agent-reach.ts, read now). The
 * path moves to `gap` and the steps' question is stored (gap: true, path), so a yes is the agent doing it and a no parks
 * the program. One UPDATE. Never throws on its own reads and writes.
 */
/**
 * v4.8 Task 2: a path gap ask's program title and steps (Base: qualifyGapSteps of the stored offer; another grant:
 * programNeeds' gaps as lines plus the program file's setup). A failed program read is its needs only. Never throws.
 */
async function gapStepsOf(asked: Pick<NonNullable<Seen['bench_ask']>, 'kind' | 'program_id' | 'program' | 'qualify' | 'needs' | 'name'>): Promise<{ title: string; steps: GapStep[] }> {
  const pid = asked.program_id!;
  if (asked.kind === 'qualify' && asked.qualify?.steps?.length)
    return { title: asked.program ?? asked.qualify.grant.name ?? pid, steps: qualifyGapSteps(asked.qualify.steps as QualifyStep[]) };
  const row = await getProgramRow(pid).catch(() => null);
  const name = asked.name?.trim() || 'your project';
  return {
    title: asked.program ?? row?.title ?? pid,
    // Fix round 2 (F4): only the unmet gaps the hook counted ("N steps away"); the program file's setup items are
    // prerequisites EarnKit can't check, so never steps here.
    steps: (Array.isArray(asked.needs) ? asked.needs : []).map((n) => ({ text: needStep(name, n), doable: false })),
  };
}
/** Fix round 1 (T2-6): the gap reply's proof line on tell (no find read in hand): the streak and live read now. Never throws. */
async function gapProofNow(id: number, asked: NonNullable<Seen['bench_ask']>, now: Date): Promise<{ line: string; keys: string[] } | null> {
  // Task 6 fix round 1 (review 4): one proof a session per fact (this session's parts said).
  const [row] = await sql()<{ seen: Seen | null }[]>`SELECT standing_seen AS seen FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  const said = sessionOf(row?.seen ?? {}, now).said;
  const base = asked.kind === 'qualify' && asked.qualify?.steps?.length ? asked.qualify.steps : null;
  if (base && !base.includes('base')) {
    const b = gapProofOf({ name: '', live: false }, 0, base, said);
    if (b) return b;
  }
  const name = asked.qualify?.name ?? asked.name ?? '';
  const [streak, live] = await Promise.all([streakOfBuilder(id, now).catch(() => 0), asked.key ? liveOrUsersKnown(id, asked.key) : Promise.resolve(false)]);
  return name ? proofOf({ name, live }, streak, false, said) : null;
}

async function gapYes(ctx: Pick<ToolContext, 'ownInstallationId'>, id: number, asked: NonNullable<Seen['bench_ask']>, now: Date): Promise<Reply> {
  const pid = asked.program_id!;
  const hosted = (await agentReach(ctx.ownInstallationId ?? id, id)).hosted;
  const { title, steps } = await gapStepsOf(asked);
  if (steps.length === 0) return { show_to_builder: NOTED_LINE };
  // Final review F3: one step the agent can't do: the yes is the help itself (one turn, never a list of one, then help).
  if (steps.length === 1 && !(steps[0].doable && !hosted)) {
    if (asked.kind === 'qualify' && pid === BASE_GRANTS_ID) await stampGapDid(id, pid, now);
    return helpStart(id, { ...asked, ...(asked.qualify && { qualify: { ...asked.qualify, hosted } }) }, now, hosted);
  }
  const proof = await gapProofNow(id, asked, now);
  const g = gapReply(title, steps, hosted, proof?.line ?? null);
  const stored = { ...asked, gap: true, ...(asked.qualify && { qualify: { ...asked.qualify, hosted } }) };
  const path: Path = { stage: 'gap', program_id: pid, at: now.toISOString() };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
      || jsonb_build_object('path', ${sql().json(path as never)}::jsonb, 'bench_ask', ${sql().json(stored as never)}::jsonb)
      || CASE WHEN ${(proof?.keys.length ?? 0) > 0} THEN jsonb_build_object('said', ${saidSql(proof?.keys ?? [], now)}) ELSE '{}'::jsonb END
    WHERE builder_id = ${id}`.catch(logged('gap'));
  const note = asked.kind === 'qualify' ? QUALIFY_NOTE : CHECK_FITS_ASK_NOTE;
  return { show_to_builder: g.show_to_builder, agent_note: withMentor(note), move_up: { kind: asked.kind, project_key: asked.key, agent_note: note } };
}

/**
 * v4.8 Task 2: the yes to the gap stage's question. An agent with the code and Builder Codes first: it adds them
 * (bench-reply.ts qualifyCodesYes), pushes, then calls find; standing_seen.gap_did is stamped so that find checks the
 * code again (codesConfirmed). Otherwise the agent helps with (or, hosted, walks them through) the first step, then
 * calls find. Never throws on its own writes.
 */
/**
 * Fix round 3 (7): a yes to a step on Base's gap, by either agent, stamps gap_did, so the next find re-checks the code
 * (never waiting for the daily refresh). Fix round 2 (F10): the path moves to gap here too. Never throws.
 */
const stampGapDid = (id: number, pid: string, now: Date) => {
  const path: Path = { stage: 'gap', program_id: pid, at: now.toISOString() };
  return sql()`UPDATE builder_profiles SET standing_seen = (jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{gap_did}',
        COALESCE(standing_seen->'gap_did', '{}'::jsonb) || jsonb_build_object(${pid}::text, ${now.toISOString()}::text)) - 'gap_check_failed')
        || jsonb_build_object('path', ${sql().json(path as never)}::jsonb)
      WHERE builder_id = ${id}`.catch(logged('gap did'));
};
/**
 * Fix round 2 (1): a help step not done: its own park with the step (help_parked), re-checked once a session and
 * unparked once met; the stored ask is cleared. `checked`: it was just checked (final review F3, find's re-check), so
 * this session's re-check is spent. Never throws.
 */
async function parkHelp(id: number, asked: NonNullable<Seen['bench_ask']>, now: Date, checked = false): Promise<{ parked: Record<string, { at: string; step: string; checked_at?: string }>; path: Path }> {
  const step = asked.kind === 'qualify' ? (asked.qualify?.steps?.[0] ?? null) : (Array.isArray(asked.needs) ? asked.needs[0] : null);
  const park = { at: now.toISOString(), step: step ?? '', ...(checked && { checked_at: now.toISOString() }) };
  // The path leaves it (no program), so once the step is met it is hooked again with what changed (helpUnpark).
  const path: Path = { stage: 'hook', program_id: null, at: now.toISOString() };
  await sql()`UPDATE builder_profiles SET standing_seen = (jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{help_parked}',
      COALESCE(standing_seen->'help_parked', '{}'::jsonb) || jsonb_build_object(${asked.program_id!}::text, ${sql().json(park as never)}::jsonb)) - 'bench_ask')
      || jsonb_build_object('path', ${sql().json(path as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('help park'));
  return { parked: { [asked.program_id!]: park }, path };
}

async function gapDoYes(ctx: Pick<ToolContext, 'ownInstallationId'>, id: number, asked: NonNullable<Seen['bench_ask']>, now: Date): Promise<Reply> {
  const hosted = (await agentReach(ctx.ownInstallationId ?? id, id)).hosted;
  const q = asked.qualify;
  const stamp = () => stampGapDid(id, asked.program_id!, now);
  // Task 6 fix round 1 (review 1): an ok to the help yes's "Say ok once it's done": a re-check (find, run in this tell).
  // Final review F3: not done, find parks it there (the program waits) and the path moves on; a second ok here (find
  // never ran in between) parks it too.
  if (asked.help === true) {
    if (asked.kind === 'qualify' && asked.program_id === BASE_GRANTS_ID) await stamp();
    const checks = (asked.checks ?? 0) + 1;
    if (checks >= 2) {
      await parkHelp(id, asked, now);
      return { show_to_builder: helpParked(asked.program ?? asked.qualify?.grant.name ?? 'this program'), then_find: true };
    }
    await storeAsk(id, { ...asked, checks });
    return { show_to_builder: '', then_find: true };
  }
  // Fix round 3 (5): "ok" to "I'm checking the code now": check again on the next find, never add the codes again.
  if (asked.checking === true) {
    await stamp();
    // Task 4 fix round 1 (3): tell runs find here (then_find), so the builder sees its reply, never an empty one.
    return { show_to_builder: '', then_find: true };
  }
  if (asked.kind === 'qualify' && asked.program_id === BASE_GRANTS_ID) await stamp();
  if (!hosted && asked.kind === 'qualify' && q?.name && qualifyGapSteps(q.steps as QualifyStep[]).some((s) => s.doable)) {
    const codesNote = q.codes_missing === false ? QUALIFY_CODES_CHECK_NOTE : QUALIFY_CODES_NOTE;
    // Fix round 0 (8, the merge gate): the reply ends in the path's next easy reply, "ok" once it's pushed, stored as
    // the re-check ask (its yes checks the code again, its no parks Base).
    await storeAsk(id, { ...asked, checking: true });
    return {
      show_to_builder: `${qualifyCodesYes(q.name, q.codes_missing !== false)}\n\n${PUSHED_ASK}`,
      agent_note: withMentor(`${codesNote.replace(/\s*Don't show this note\.$/, '')} ${GAP_DO_NOTE}`),
      // Task 6 fix round 1 (review 5): the stored re-check ask, structured (its ok is this kind's yes).
      move_up: { kind: asked.kind, project_key: asked.key, agent_note: QUALIFY_NOTE },
    };
  }
  return helpStart(id, asked, now, hosted);
}

/**
 * Task 6 fix round 1 (review 1): the help (the agent helps, or walks them through it) gets its own reply, the first
 * step and its guide, then "Say ok once it's done", stored as the re-check ask (help: its ok checks the step again).
 * Final review F3: also the hook's yes when its one step is one the agent can't do (gapYes). The path moves to gap.
 */
async function helpStart(id: number, asked: NonNullable<Seen['bench_ask']>, now: Date, hosted: boolean): Promise<Reply> {
  const path: Path = { stage: 'gap', program_id: asked.program_id!, at: now.toISOString() };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('path', ${sql().json(path as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('gap help'));
  const { steps } = await gapStepsOf(asked);
  const step = steps[0];
  if (!step) return { show_to_builder: '', agent_note: withMentor(hosted ? GAP_HELP_NOTE_HOSTED : GAP_HELP_NOTE), then_find: true };
  await storeAsk(id, { ...asked, gap: true, help: true, checking: true, checks: 0 });
  const note = asked.kind === 'qualify' ? QUALIFY_NOTE : CHECK_FITS_ASK_NOTE;
  return {
    show_to_builder: helpReply(step),
    agent_note: withMentor(hosted ? GAP_HELP_NOTE_HOSTED : GAP_HELP_NOTE),
    move_up: { kind: asked.kind, project_key: asked.key, agent_note: note },
  };
}

/** Final review F1: the stored description of the builder's project (builder_projects.what), or null. Never throws. */
async function projectWhat(id: number, key: string): Promise<string | null> {
  const [r] = await sql()<{ what: string | null }[]>`SELECT what FROM builder_projects WHERE builder_id = ${id} AND lower(project_key) = lower(${key}) LIMIT 1`.catch(() => []);
  return r?.what?.trim() || null;
}
/** Fix round 2 (F7, F8): what every draft note says about the record and the guard. Pure. */
const recordWords = (record: boolean) =>
  record
    ? "from the verified record below (keep every number, date and link exactly)"
    : 'from their commits only: EarnKit has no verified record for them yet, so leave traction out and never invent it';
const DRAFT_GUARD = 'Never tell them they qualify or that an application was sent.';
/** v4.8 Task 2: the draft's agent note, an investor program with no public questions: the short founder brief. Pure. */
export const founderBriefNote = (program: string, key: string | null, o: { record: boolean; what?: boolean } = { record: true }) =>
  `The builder said yes to drafting their ${program} application. Its questions aren't public, so write a short founder brief right under "Here's your draft:": ` +
  (o.record
    ? `${o.what ? '' : `write "What it is" in one sentence, then `}"Who it's for" and "Why now" in one or two sentences each, from their repo README, in the builder's own voice, around the Traction sentence below (keep its facts exactly). ` +
      'Never invent traction, numbers or team. '
    : `what the project does, who it is for, its traction ${recordWords(o.record)}, and why now. `) +
  `Never fill the blanks yourself; once they reply with them, call tell with move_up: { kind: 'apply', project_key: ${JSON.stringify(key)}, answer: 'yes', blanks: their reply }, add them to the brief and show it ready to paste. ${DRAFT_GUARD} ` +
  `A no: call tell with move_up: { kind: 'apply', project_key: ${JSON.stringify(key)}, answer: 'no' }.`;
/**
 * v4.8 Task 2: the draft's agent note for a program with questions: prepare's fields, drafted. Fix round 2 (F1): the
 * fields the agent drafts for the builder to check (`drafted`), what EarnKit fills (`fills`), the blanks asked later
 * (`later`, prepare's own round). Pure.
 */
export const questionsDraftNote = (programId: string, key: string | null, o: { record: boolean; drafted?: string[]; fills?: Record<string, string>; later?: string[] } = { record: true }) =>
  `The builder said yes to drafting this application. First call prepare with program_id "${programId}" for this project and draft an answer to every field it lists ` +
  `${recordWords(o.record)} and their repo, except the blanks this reply names. Put your answers right under "Here's your draft:"${o.record ? ' and keep the facts of its What it is and Traction lines exactly (never invent traction, numbers or team)' : ''}; ` +
  (o.drafted?.length ? `mark these as drafted for them to check: ${o.drafted.join('; ')}. ` : '') +
  (o.fills && Object.keys(o.fills).length > 0 ? `EarnKit already holds these, use them as given: ${Object.entries(o.fills).map(([k, v]) => `${k}: ${v}`).join('; ')}. ` : '') +
  "Never show prepare's own questions and never fill a blank yourself. Contact details are typed when they submit. " +
  `Once they reply with the blanks, call prepare again with every answer and coach_asked: true, and show its draft${o.later?.length ? ` (it asks for the rest: ${o.later.join('; ')})` : ''}. ${DRAFT_GUARD} ` +
  `A no: call tell with move_up: { kind: 'apply', project_key: ${JSON.stringify(key)}, answer: 'no' }.`;

/**
 * v4.8 Task 2: the held answers for a program's fields (conversation.ts draftBlanks' `held`): the answer bank for this
 * project (coach.ts bankFill: filled and suggested) and the builder's X handle; fix round 2 (F1) `fills`, what EarnKit
 * itself fills: the Builder Code confirmed in an App-proven repo, and verified usage (the record's "Used by" line) for a
 * usage field. A failed read holds nothing. Never throws.
 */
async function heldAnswers(id: number, key: string | null, reqs: SubmissionRequirement[], record: string[]): Promise<{ held: Record<string, string>; fills: Record<string, string> }> {
  const [p] = await sql()<{ handle: string | null }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  const name = (await mainProjectName(id).catch(() => null)) ?? (key ? keyName(key) : '');
  const bankKey = key && REPO_KEY.test(key.toLowerCase()) ? projectKey({ repo_url: `https://github.com/${key}`, name }) : name ? projectKey({ name }) : null;
  const bank = bankKey ? await readBank(id, bankKey).catch(() => new Map()) : new Map();
  const filled = bankFill(reqs, {}, bank);
  const handle = p?.handle ? `@${p.handle}` : null;
  const x = handle ? Object.fromEntries(reqs.filter((r) => r.key === 'x_handle' || /\bX \(Twitter\)/.test(r.label)).map((r) => [r.key, handle])) : {};
  const fills: Record<string, string> = {};
  const codeReq = reqs.find((r) => r.required && /builder code/i.test(`${r.key.replace(/_/g, ' ')} ${r.label}`));
  if (codeReq && key && REPO_KEY.test(key.toLowerCase()) && (await appProvenRepo(id, key))) {
    const [c] = await sql()<{ codes: string[] | null }[]>`SELECT codes FROM repo_builder_codes WHERE repo_key = ${key.toLowerCase()} AND found`.catch(() => []);
    if (c?.codes?.[0]) fills[codeReq.key] = c.codes[0];
  }
  // Fix round 3 (4): a payout wallet field is EarnKit's to fill when the builder proved one (their signature).
  const walletReq = reqs.find((r) => r.required && (r.key === 'payout_wallet' || /payout wallet/i.test(r.label)));
  const wallet = walletReq ? await provenWallet(id).catch(() => null) : null;
  if (walletReq && wallet) fills[walletReq.key] = wallet;
  const used = record.find((l) => l.startsWith('Used by '));
  const usage = reqs.find((r) => r.required && r.kind === 'traction');
  if (used && usage) fills[usage.key] = used;
  return { held: { ...filled.suggested, ...filled.answers, ...x, ...fills }, fills };
}

/**
 * v4.8 Task 2: the yes to the path's "Want me to start?" (or the draft offer once a gap closed): the draft stage.
 * "Here's your draft:", the verified record (ship-log-facts.ts shipLogBlock: score, streak, live link, page link,
 * verified usage and revenue under its own rules; none on a shared client) and the blanks only the builder can fill
 * (draftBlanks: at most MAX_BLANKS), asked as one reply. The agent writes the draft (prepare's fields, or the founder
 * brief for an investor program with no public questions). The path moves to `draft`; the draft's ask is stored with
 * its blanks (a no parks the program; a yes re-asks them, or with none moves to submit). Never throws on its own
 * reads and writes.
 */
async function pathDraft(ctx: Partial<Pick<ToolContext, 'sharedClient'>>, id: number, asked: NonNullable<Seen['bench_ask']>, now: Date): Promise<Reply> {
  const pid = asked.program_id!;
  const lead = { program_id: pid, ...(asked.repo && { repo: asked.repo }) };
  const program = await getProgramRow(pid).catch(() => null);
  if (!program) return { show_to_builder: '', agent_note: APPLY_YES_NOTE(pid), lead };
  // ship-log-facts.ts is loaded here (bench-data.ts, which it reads, imports this file).
  const { draftBody, shipLogBlock, shipLogFacts, SHIP_LOG_NOTE } = await import('./ship-log-facts');
  const facts = ctx.sharedClient ? null : await shipLogFacts(id, now).catch(logged('draft record'));
  const record = facts ? shipLogBlock(facts) : [];
  // Final review F1: what the builder sees is target A's draft body (What it is, one Traction sentence, the page), from
  // the same facts; the ship log lines stay the record EarnKit fills its answers from (heldAnswers).
  const what = facts && asked.key ? await projectWhat(id, asked.key) : null;
  const body = facts ? draftBody(facts, what) : [];
  const { held, fills } = await heldAnswers(id, asked.key, program.submission_requirements, record);
  const { brief, blanks, later, drafted } = draftBlanks(program, held);
  const stored = { kind: 'apply', key: asked.key, program_id: pid, path: true, draft: true, blanks, ...(asked.repo && { repo: asked.repo }) };
  const path: Path = { stage: 'draft', program_id: pid, at: now.toISOString() };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
      || jsonb_build_object('path', ${sql().json(path as never)}::jsonb, 'bench_ask', ${sql().json(stored as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('draft'));
  const hasRecord = record.length > 0;
  const note = brief
    ? founderBriefNote(programName(program.title), asked.key, { record: hasRecord, what: Boolean(what) })
    : questionsDraftNote(pid, asked.key, { record: hasRecord, drafted, fills, later });
  return {
    show_to_builder: draftReply(body, blanks),
    agent_note: withMentor(`${note}${hasRecord ? SHIP_LOG_NOTE : ''}`),
    move_up: { kind: 'apply', project_key: asked.key, agent_note: APPLY_NOTE },
    lead,
  };
}

/**
 * Fix round 3 (1): the path's draft for `programId` was finished with the builder's answers (prepare with
 * coach_asked): its stored blanks are cleared, so a yes after them moves on instead of re-asking. Never throws.
 */
export async function draftAnswered(id: number, programId: string): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{bench_ask,blanks}', '[]'::jsonb)
    WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'program_id' = ${programId} AND standing_seen->'bench_ask'->>'draft' = 'true'
      AND standing_seen->'path'->>'stage' = 'draft' AND standing_seen->'path'->>'program_id' = ${programId}`.catch(logged('draft answered'));
}

/**
 * Fix round 2 (F5): a yes to the draft's own ask. Its blanks still empty (a bare "ok"): "I need {blanks}. Reply with
 * both and I'll finish it." and the ask stays (a no still parks). v4.8 Task 3: a yes carrying their answers (fix round 3, 1) or
 * a yes with no blanks left is the submit stage (pathSubmit): the path moves to `submit` and the reply is the link, the
 * deadline and "sent". Never throws on its own writes.
 */
async function draftYes(id: number, asked: NonNullable<Seen['bench_ask']>, now: Date, answers?: string): Promise<Reply> {
  const blanks = Array.isArray(asked.blanks) ? asked.blanks.filter((b): b is string => typeof b === 'string') : [];
  // Fix round 3 (1): the yes carries their answers: the blanks are answered (the text is never stored), and the agent
  // finishes the draft with them; Task 3: the same reply is the submit stage (target A, "just me, nothing raised").
  if (blanks.length > 0 && answers?.trim())
    return pathSubmit(id, asked, now, "The builder answered the blanks: add their words to the draft as they gave them (for a program with fields, call prepare again with every answer and coach_asked: true) and show it finished, ready to paste, above this line. Never submit it for them. Don't show this note.");
  // A bare yes with no answers given yet: re-ask them.
  if (blanks.length > 0) {
    await storeAsk(id, asked);
    return { show_to_builder: blanksAgain(blanks), agent_note: withMentor("Their answers to the blanks: add them to the draft and finish it as the draft's note said. Don't show this note."), move_up: { kind: 'apply', project_key: asked.key, agent_note: APPLY_NOTE } };
  }
  return pathSubmit(id, asked, now, "Show the finished draft ready to paste above this line. Never submit it for them. Don't show this note.");
}

/**
 * v4.8 Task 3: how "sent" is told. The submit ask is stored as an apply ask (`submit`); fix round 1 (2): only move_up
 * answer 'sent' (tools.ts tell, submitAsked) or program_status applied records it, never a plain yes.
 */
export const SENT_NOTE = "Only when they say the application is in (\"sent\", \"submitted\", \"done, it's in\"), call tell with move_up: { kind: 'apply', project_key, answer: 'sent' } (or program_status: [{ program_id, status: 'applied' }], program_id as given here). A plain ok or yes is not sent: answer 'yes'. A no or 'not yet': answer 'no' (EarnKit keeps it ready). Only if they say they won't apply, call tell with program_status: [{ program_id, status: 'not_interested' }]. Don't show this note.";
/** Final review F7: the one line before the next program when the builder says no to a path ask. Pure. */
export const setAsideLine = (title: string) => `No problem, I'll set ${programName(title)} aside.`;
/** v4.8 Task 3: the contact fields a program's form asks for at submit ("your email"), never a draft blank (ruling T2-1). Pure. */
const contactFields = (reqs: readonly SubmissionRequirement[] | null | undefined) =>
  (reqs ?? []).filter((r) => r.required && r.kind === 'contact').map((r) => r.todo ?? r.label.toLowerCase());
/** v4.8 Task 3: a dated program's submit-by words in its own zone (conversation.ts submitBy), null for a rolling one. Pure. */
const submitByOf = (p: Pick<ProgramFileRow, 'summary' | 'tz' | 'ends_at'>, now: Date) => {
  if (!closeDay(p) || !p.ends_at) return null;
  const zone = programZone(p);
  return submitBy(new Date(p.ends_at).toISOString(), zone, now, zoneAbbr(zone));
};
/**
 * v4.8 Task 3: the submit stage (conversation.ts submitReply: "Done, it's ready to paste. Submit at {link} before
 * {deadline}." then the form's contact fields and SENT_ASK). The path moves to `submit`, and its question is stored as
 * the submit ask (kind apply, `submit`), so a no parks the program and a yes is "sent". One UPDATE. Never throws.
 */
async function pathSubmit(id: number, asked: NonNullable<Seen['bench_ask']>, now: Date, note: string): Promise<Reply> {
  const program = await getProgramRow(asked.program_id!).catch(() => null);
  const path: Path = { stage: 'submit', program_id: asked.program_id!, at: now.toISOString() };
  const stored = { kind: 'apply', key: asked.key, program_id: asked.program_id, path: true, submit: true };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
      || jsonb_build_object('path', ${sql().json(path as never)}::jsonb, 'bench_ask', ${sql().json(stored as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('draft submit'));
  const show = submitReply({ link: program?.submission_url ?? null, by: program ? submitByOf(program, now) : null, contacts: contactFields(program?.submission_requirements) });
  return {
    show_to_builder: show,
    agent_note: withMentor(`${note.replace(/\s*Don't show this note\.$/, '')} ${SENT_NOTE}`),
    move_up: { kind: 'apply', project_key: asked.key, agent_note: SENT_NOTE },
    lead: { program_id: asked.program_id, step: 'submit' },
  };
}

/**
 * v4.8 Task 3: the program a 'sent' answer to the stored submit ask is for (tools.ts tell records it applied), or null
 * when the stored ask is not the path's submit ask. Never throws.
 */
export async function submitAsked(id: number, m: { kind?: string; project_key?: string | null }): Promise<string | null> {
  const asked = await benchAsked(id, { ...m, kind: m.kind ?? 'apply' });
  return asked?.kind === 'apply' && asked.path === true && asked.submit === true && asked.program_id ? asked.program_id : null;
}

/**
 * v4.8 Task 3: "sent" for the path's program (tell program_status applied, already stored): the path moves to `track`
 * and the reply's lead is conversation.ts trackLead (TRACK_ACK and the program file's odds, difficulty_override.basis).
 * Null when none of `programIds` is the path's program at draft or submit (another tell). The next find then hooks the
 * next bestMove program (the applied one is told, so never again). Never throws.
 */
export async function pathTrack(id: number, programIds: readonly string[], now: Date): Promise<{ program_id: string; odds: string | null } | null> {
  const [p] = await sql()<{ seen: Seen | null }[]>`SELECT standing_seen AS seen FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
    logged('path track')(err);
    return [];
  });
  const path = readPath(p?.seen);
  // Only with the draft in their hands (draft or submit): any other tell stays a plain save (no find run inside it).
  if (!path?.program_id || !programIds.includes(path.program_id) || (path.stage !== 'draft' && path.stage !== 'submit')) return null;
  const next: Path = { stage: 'track', program_id: path.program_id, at: now.toISOString() };
  await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) - 'bench_ask') || jsonb_build_object('path', ${sql().json(next as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('path track'));
  const row = await getProgramRow(path.program_id).catch(() => null);
  const odds = row?.difficulty_override && 'basis' in row.difficulty_override && typeof row.difficulty_override.basis === 'string' ? row.difficulty_override.basis : null;
  return { program_id: path.program_id, odds };
}

/** Stores `ask` as the Bench's question (its yes or no is answered as asked). */
async function storeAsk(id: number, ask: Record<string, unknown>): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(ask as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('store ask'));
}

/**
 * 2026-10-23 Base onboarding (fix round: the same gate as find, baseGrantOpen over score's cards and skip, so a hidden
 * or entered Base Builder Grants is never offered). Null on a read error. Never throws.
 */
async function baseOpenFor(id: number, now: Date): Promise<boolean> {
  return (await baseGrantFor(id, now)) !== null;
}
/** v3.1 cold read: Base Builder Grants' grant (baseOpenFor's gate), for the walk-through's head; null when not open. Never throws. */
async function baseGrantFor(id: number, now: Date): Promise<OpenGrant | null> {
  const { cards, skip } = await scoreApplies(id, null, now).catch((err: unknown) => {
    logged('base open')(err);
    return { cards: [] as Card[], skip: new Set<string>() };
  });
  if (!baseGrantOpen(cards, now, skip)) return null;
  const card = cards.find((c) => c.id === BASE_GRANTS_ID);
  return card ? grantOf(card) : null;
}
/** The resting question in its own reply, stored as the Bench's ask. */
async function restStep(id: number): Promise<Reply> {
  await storeAsk(id, { kind: 'next_step', key: null });
  return { show_to_builder: NEXT_STEP_ASK, move_up: { kind: 'next_step', project_key: null, agent_note: NEXT_STEP_NOTE } };
}

/**
 * 2026-10-23 Base onboarding: after the GitHub no, the next question in its own reply: the Base walk-through (once, Base
 * Builder Grants open and shown), else the optional wallet step (once), else the resting question (fix round 7). Never throws.
 */
async function afterGithubNo(id: number, now: Date): Promise<Reply> {
  const [p] = await sql()<{ asked: boolean; walk: boolean }[]>`
    SELECT COALESCE(standing_seen ? 'base_asked', false) AS asked, COALESCE(standing_seen ? 'base_walk', false) AS walk FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
    logged('after no')(err);
    return [];
  });
  if (p && !p.asked && !p.walk && (await baseOpenFor(id, now)) && (await takeBaseAsk(id, now))) {
    await storeAsk(id, { kind: 'base_start', key: null });
    return { show_to_builder: BASE_START_ASK, move_up: { kind: 'base_start', project_key: null, agent_note: BASE_START_NOTE } };
  }
  return (await walletStep(id, now)) ?? restStep(id);
}
/**
 * The wallet step in its own reply (once a person, claimed here). v4.0: setup step 3 (the GitHub no counts as step 2
 * answered), else the older optional step. Null when neither is due. Never throws.
 */
async function walletStep(id: number, now: Date): Promise<Record<string, unknown> | null> {
  const setup = await walletSetupDue(id, now);
  if (setup) {
    if (!(await takeWalletAsk(id, now, true))) return null;
    await storeAsk(id, { kind: 'wallet_setup', key: null, at: now.toISOString() });
    return { show_to_builder: walletSetupAsk(null, setup), move_up: { kind: 'wallet_setup', project_key: null, agent_note: walletSetupNote() } };
  }
  const link = await walletOfferDue(id, now);
  // v4.2 Task 6 (F11): an earlier builder with a wallet and no token row hears the token offer, once.
  if (!link) {
    if (!(await tokenOfferDue(id)) || !(await takeTokenOffer(id, now))) return null;
    await storeAsk(id, { kind: 'token', key: null, at: now.toISOString() });
    return { show_to_builder: TOKEN_OFFER, move_up: { kind: 'token', project_key: null, agent_note: TOKEN_ASK_NOTE } };
  }
  if (!(await takeWalletAsk(id, now))) return null;
  await storeAsk(id, { kind: 'wallet', key: null, at: now.toISOString() });
  return { show_to_builder: walletOffer(link), move_up: { kind: 'wallet', project_key: null, agent_note: WALLET_NOTE } };
}

/** v4.0 "launch my token": each launch result in plain words (never "coin"). */
export { TOKEN_ON_ITS_WAY };
export const TOKEN_STAYS_OFF = TOKEN_OFF;
export const TOKEN_TRY_LATER = "That didn't go through this time. Ask me again in a few minutes.";
export const TOKEN_CANT = "I can't set up a token for this account. Reach out at j@earnkit.com.";
/** v4.0: a launch result's reply line (null: not ready, the caller decides). v4.2: a launch names the trade link. Pure. */
export function tokenLine(r: LaunchResult): string | null {
  switch (r.result) {
    case 'launched': return `Done. Your token is live: ${tradeUrl(r.coin_address)}`;
    // v4.4: a token the builder named (existing) has a row, so its state text is the caller's, as a live one's.
    case 'exists': return r.status === 'declined' ? TOKEN_STAYS_OFF : r.status === 'launched' || r.status === 'existing' ? null : TOKEN_ON_ITS_WAY;
    case 'unknown': return TOKEN_ON_ITS_WAY;
    case 'busy': case 'ticker_check_down': case 'released': return TOKEN_TRY_LATER;
    case 'x_taken': case 'no_ticker': return TOKEN_CANT;
    case 'off': return NOTED_LINE;
    case 'not_ready': return null;
  }
}
/** v4.0 Task 5: the setup-done table's rows: at most 3, as given (the Best fit first); "Up to" the award, "Closes" its day or "Rolling". Pure. */
export const setupRows = (fits: Pick<Fit, 'title' | 'amount' | 'when'>[]): ProgramRow[] =>
  fits.slice(0, 3).map((f) => ({ program: f.title, upTo: f.amount ?? 'Varies', closes: f.when.startsWith('closes ') ? f.when.slice('closes '.length) : 'Rolling' }));
/**
 * v4.0 Task 5: how setup step 3 settled, when it was shown (standing_seen.setup_asked) and its setup-done reply not said
 * yet: a no to the token (builder_tokens declined); a wallet signed (a token row launched: 'launched'; launching or
 * unknown: 'on_its_way' (final review 1: never told as live); else the neutral 'set'); no wallet, no token row and the step ended (skipped). Null: not settled, or a read
 * error. Never throws.
 */
async function setupOutcome(id: number): Promise<{ outcome: SetupOutcome; first: string } | null> {
  const [p] = await sql()<{ asked: boolean; done: boolean; open: boolean; wallet: boolean; token: string | null; name: string | null; handle: string | null }[]>`
    SELECT COALESCE(standing_seen ? 'setup_asked', false) AS asked, COALESCE(standing_seen ? 'setup_done', false) AS done,
      COALESCE(standing_seen ? 'wallet_link_at', false) AS open,
      EXISTS (SELECT 1 FROM person_wallets w WHERE w.builder_id = ${id}) AS wallet,
      (SELECT t.status FROM builder_tokens t WHERE t.builder_id = ${id}) AS token, x_name AS name, x_handle AS handle
    FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
    logged('setup outcome')(err);
    return [];
  });
  if (!p?.asked || p.done) return null;
  const outcome: SetupOutcome | null = p.token === 'declined' ? 'declined'
    : p.wallet ? (p.token === 'launched' ? 'launched' : p.token === 'launching' || p.token === 'unknown' ? 'on_its_way' : p.token === 'existing' ? 'existing' : 'set')
    : !p.open && p.token === null ? 'skipped' : null;
  return outcome ? { outcome, first: firstName(p.name, p.handle) } : null;
}
type SetupDone = {
  show_to_builder: string; move_up?: { kind: 'apply' | 'closest' | 'check_fits' | 'checkin'; project_key: string | null; agent_note: string; why?: string }; program_id?: string;
  /** v4.8 Task 4 fix round 1 (1): only the done line; the reply goes on to find's (tools.ts tell runs it). */
  then_find?: true;
};
/**
 * v4.0 Task 5 (approved copy 4): the setup-done reply, when step 3 settled (setupOutcome), claimed once
 * (takeOnce 'setup_done'; final review 6: after the reply is built, so a failure never loses it). Exported for tests. The rows: the one project's real fits not told about (find's or score's fit lines; without
 * `given`, score's: scoreApplies), the Best fit first (bestApplies' first, as the ranked reply's), at most 3. Its question
 * is the apply ask for the Best fit (stored, so a yes drafts it); no open fit: the no-fit line, no question. Null
 * otherwise. Never throws.
 */
export async function setupDoneFor(
  id: number, now: Date,
  given: { fits: Fit[]; skip: Set<string>; seen: Seen; key: string | null; name: string | null } | null,
  own: number = id,
): Promise<SetupDone | null> {
  try {
    const settled = await setupOutcome(id);
    if (!settled) return null;
    // v4.8 Task 4 fix round 1 (1): a new builder's pick pending (the opener seen, B's second message not said yet): the
    // done line alone, then find's reply (then_find: tell runs find; find's own branch goes on to the path), which is B's
    // second message: the profile line and the pick's fit. Never the programs table or another program's draft.
    const pseen = given?.seen ?? (await sql()<{ seen: Seen | null }[]>`SELECT standing_seen AS seen FROM builder_profiles WHERE builder_id = ${id}`)[0]?.seen ?? {};
    if (pseen.opener && !pseen.connected_said) {
      if (!(await takeOnce(id, 'setup_done', now))) return null;
      const trade = settled.outcome === 'launched' ? await tokenTradeUrl(id) : null;
      return { show_to_builder: setupDoneLead(settled.first, settled.outcome, false, trade), then_find: true };
    }
    let g = given;
    let open: Awaited<ReturnType<typeof scoreApplies>> | null = null;
    if (!g) {
      const [p] = await sql()<{ seen: Seen | null; key: string | null }[]>`
        SELECT standing_seen AS seen, main_project_key AS key FROM builder_profiles WHERE builder_id = ${id}`;
      open = await scoreApplies(id, p?.key ?? null, now);
      g = { fits: fitLines(open.applies), skip: open.skip, seen: p?.seen ?? {}, key: p?.key ?? null, name: p?.key ? await reportedName(id, p.key, true).catch(() => null) : null };
    }
    const real = (await openCandidates(id, g.fits.filter(realFit))) ?? [];
    const best = applyCandidates(real, g.seen, g.skip, now)[0] ?? real[0];
    // v4.2 (F3): the real fits (best first) as before; with none, the long shots (the fit's own bar, nearest first), then
    // every other open program: the ones not told about, then investments, then those already told, so "doesn't fit" is
    // said only when nothing is open.
    const longShots = (await openCandidates(id, g.fits.filter((f) => !realFit(f)).sort((a, b) => Number(a.bar === 'company') - Number(b.bar === 'company')))) ?? [];
    let rows: Pick<Fit, 'title' | 'amount' | 'when'>[] = best ? [best, ...real.filter((f) => f !== best)] : longShots;
    let closest: { program: string; step: string } | null = null;
    let closestId: string | null = null;
    let check = false;
    // Fits are known once the project was matched (find stores its repo); a long-shot or no-fit answer is then true, not a gap.
    const known = given !== null || (g.key !== null && ((await keptBenchMatch(id, g.key, now)) !== null || (await readFitRepos(id).catch(() => [])).some((f) => f.key.toLowerCase() === g!.key!.toLowerCase())));
    if (!best) {
      open ??= await scoreApplies(id, g.key, now);
      const listed = new Set(longShots.map((f) => f.program_id));
      const others = open.cards.filter((c) => !open!.skip.has(c.id) && !g.skip.has(c.id) && !listed.has(c.id));
      const notToldIds = new Set(((await openCandidates(id, others.map((c) => ({ program_id: c.id })))) ?? []).map((c) => c.program_id));
      const grants = others.filter((c) => notToldIds.has(c.id) && c.investment !== true).sort(byRelevance);
      const investments = others.filter((c) => notToldIds.has(c.id) && c.investment === true).sort(byRelevance);
      const alreadyTold = others.filter((c) => !notToldIds.has(c.id)).sort(byRelevance);
      const extra = [...grants, ...investments, ...alreadyTold];
      // Grants first, then investments and company programs (each group keeps its order).
      const companyIds = new Set(g.fits.filter((f) => f.bar === 'company' || f.investment).map((f) => f.program_id));
      const listedRows = [...longShots.map((f) => ({ title: f.title, amount: f.amount, when: f.when, later: companyIds.has(f.program_id) })),
        ...extra.map((c) => ({ title: c.title, amount: awardAmount(c), when: fundWhen(c), later: c.investment === true }))];
      rows = [...listedRows.filter((r) => !r.later), ...listedRows.filter((r) => r.later)];
      // Task 10 (G1): the closest is a grant the fit check itself called a long shot, never an investment or a company-only
      // program, and never a guess: with no fits computed at all (nothing matched yet) the question is the fit check.
      const shot = (await openCandidates(id, g.fits.filter((f) => f.bar === 'long_shot' && !f.investment))) ?? [];
      if (shot[0]) { closest = { program: shot[0].title, step: closestStep(shot[0].bar, g.key) }; closestId = shot[0].program_id; }
      else if (!g.key) {
        // No project yet: the first grant (a told one too), whose one step is the code connected.
        const grant = [...grants, ...alreadyTold.filter((c) => c.investment !== true)][0];
        if (grant) { closest = { program: grant.title, step: closestStep(undefined, null) }; closestId = grant.id; }
      } else if (!known && grants.length > 0) check = true;
    }
    const trade = settled.outcome === 'launched' ? await tokenTradeUrl(id) : null;
    const reply = () =>
      setupDoneReply(settled.first, settled.outcome, setupRows(rows), noFitLine(g.name), { trade, closest, check: check ? (g.name ?? 'your project') : null, noAsk: !best && !closest && !check });
    // Final review 6: claimed last, once the reply is built (a failure above leaves it for the next reply).
    if (!(await takeOnce(id, 'setup_done', now))) return null;
    // v4.8 Task 1: the first-run line (ASKS_HINT) is retired; standing_seen.asks_hint in old rows is never read.
    const show = reply();
    if (!best && check) {
      await storeAsk(id, { kind: 'check_fits', key: g.key });
      return { show_to_builder: show, move_up: { kind: 'check_fits', project_key: g.key, agent_note: CHECK_FITS_ASK_NOTE } };
    }
    if (!best && !closest) {
      await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id}`.catch(logged('setup done ask'));
      // Matched and nothing fits: the Monday check-in when it is due and the agent can schedule, else no question.
      if (rows.length > 0 && (await agentReach(own, id)).schedules && g.seen.checkin === undefined && checkinAskDue(g.seen, now) && (await takeCheckinAsk(id, now))) {
        await storeAsk(id, { kind: 'checkin', key: g.key });
        // v4.7 T4: the check-in's why, the paragraph just before its question.
        return { show_to_builder: `${show}\n\n${CHECKIN_WHY}\n\n${CHECKIN_ASK}`, move_up: withWhy({ kind: 'checkin' as const, project_key: g.key, agent_note: CHECKIN_NOTE }, CHECKIN_WHY) };
      }
      return { show_to_builder: show };
    }
    if (!best && closest && closestId) {
      // The closest program is a long shot: a yes gives the step it needs (the qualify flow), never a draft.
      await storeAsk(id, { kind: 'closest', key: g.key, program_id: closestId, program: closest.program, step: closest.step });
      return { show_to_builder: show, move_up: withWhy({ kind: 'closest' as const, project_key: g.key, agent_note: CLOSEST_NOTE }, closestWhy(closest.program, closest.step)), program_id: closestId };
    }
    await takeApplyAsk(id, best!.program_id, now);
    await storeAsk(id, { kind: 'apply', key: g.key, program_id: best!.program_id, ...(best!.repo && { repo: best!.repo }) });
    return { show_to_builder: show, move_up: withWhy({ kind: 'apply' as const, project_key: g.key, agent_note: APPLY_NOTE }, bestFitWhy(best!.title)), program_id: best!.program_id };
  } catch (err) {
    logged('setup done')(err);
    return null;
  }
}
/** v4.2 (F3): the one step a closest program needs, from the fit's bar (a company program, a long shot) or, without one, the project. Pure. */
export const closestStep = (bar: FitBar | undefined, key: string | null): string =>
  bar === 'company' ? 'a full-time team'
    : bar === 'long_shot' || key ? 'more shipped work first'
    : 'your code connected';
/**
 * The trade link of the token this setup's sign launched (Task 1's justLaunched: its row began after step 3 was asked),
 * null otherwise (an older token gets the approved lead). Never throws.
 */
async function tokenTradeUrl(id: number): Promise<string | null> {
  try {
    const [t] = await sql()<{ addr: string | null; fresh: boolean }[]>`
      SELECT t.coin_address AS addr, t.created_at >= (p.standing_seen->>'setup_asked')::timestamptz AS fresh
      FROM builder_tokens t JOIN builder_profiles p ON p.builder_id = t.builder_id
      WHERE t.builder_id = ${id} AND t.status = 'launched'`;
    return t?.addr && t.fresh ? tradeUrl(t.addr) : null;
  } catch {
    return null;
  }
}
/**
 * v4.0 Task 5: a step 3 answer whose reply is the skip line or the token no's: the setup-done reply in its place, once
 * (setupDoneFor); any other reply as it is. Never throws.
 */
async function afterStep3(id: number, answer: WalletAnswer, now: Date, own: number = id): Promise<Reply> {
  // v4.2 (F4): a wallet signed while step 3 is open is the setup-done reply too (one message, not two). Final review 5:
  // answerWallet's typed `signed`, never its copy; the flags are internal and never reach the reply.
  const { signed, wallet, step3, ...r } = answer;
  if (r.show_to_builder !== WALLET_SETUP_SKIPPED && r.show_to_builder !== TOKEN_NO_LINE && !signed) return r;
  // v4.4: the wallet signed for step 3 and the one token offer is due (tokens on, no row, never offered, never an owner
  // test installation): the done line and the offer, stored as the token ask with `setup`, so its answer (yes or no)
  // is the setup-done reply (benchMoveUp). A builder shown v4.0's token sentence (token_offered) is never offered again.
  const offer = signed && step3 ? await setupOffer(id, now, wallet ?? null) : null;
  return offer ?? (await setupDoneFor(id, now, null, own)) ?? r;
}
/**
 * v4.4: the one token offer that follows setup step 3's sign (afterStep3 on the tell path, benchView on find), when due
 * (tokenOfferDue) and claimed here (takeTokenOffer): the done line and the offer, stored as the token ask with `setup`.
 * Null otherwise. Never throws.
 */
async function setupOffer(id: number, now: Date, wallet: string | null): Promise<{ show_to_builder: string; move_up: { kind: 'token'; project_key: null; agent_note: string } } | null> {
  if (!wallet || !(await tokenOfferDue(id)) || !(await takeTokenOffer(id, now))) return null;
  await storeAsk(id, { kind: 'token', key: null, at: now.toISOString(), setup: true });
  return { show_to_builder: setupTokenOffer(shortWallet(wallet)), move_up: { kind: 'token', project_key: null, agent_note: TOKEN_ASK_NOTE } };
}
/**
 * v4.0 setup step 3's answer (its kind, or a kindless tell its stored ask names): "done" is the wallet's yes. v4.4: a no
 * is the wallet skip (step 3 asks for the wallet only), except for a builder shown v4.0's token sentence
 * (standing_seen.token_offered, kept for builders mid-flow) with no token row yet: a no to the token (that copy's "Just
 * say no"; the wallet step stays open). Never throws.
 */
async function setupAnswer(ctx: Pick<ToolContext, 'builderTokenDeps'>, id: number, answer: 'yes' | 'no', now: Date): Promise<Reply> {
  if (answer === 'yes') return answerWallet(id, 'yes', now);
  const token = (await tokenOffered(id)) && (await builderToken(id).catch(() => null)) === null;
  return token ? tokenAnswer(ctx, id, 'no', now) : answerWallet(id, 'no', now);
}
/** v4.0 Task 11 fix round 1: the stored ask that a builder's yes to the token launches (kind 'token'). */
export const TOKEN_ASK_NOTE = "A yes or no to the question: call tell with move_up: { kind: 'token', project_key: null, answer }. If they already have a token, call tell with token: { existing: '<its address>' } (ask for the address if they didn't give it). Don't show this note.";
/**
 * v4.4: clears a stored token ask (kind 'token') and says whether it was the setup offer's (`setup`, the offer that
 * followed step 3's sign). Null: no token ask was stored, or a database error (logged). Never throws.
 */
async function takeTokenAsk(id: number): Promise<{ setup: boolean } | null> {
  const [t] = await sql()<{ setup: boolean }[]>`
    UPDATE builder_profiles p SET standing_seen = p.standing_seen - 'bench_ask'
    FROM (SELECT standing_seen->'bench_ask' AS ask FROM builder_profiles WHERE builder_id = ${id} FOR UPDATE) o
    WHERE p.builder_id = ${id} AND o.ask->>'kind' = 'token' RETURNING COALESCE((o.ask->>'setup')::boolean, false) AS setup`.catch((err: unknown) => {
    logged('clear token ask')(err);
    return [];
  });
  return t ?? null;
}
/**
 * v4.4: tell token { existing }: the builder already has a token. Recorded (recordExistingToken: status 'existing', the
 * offer ends forever): the recorded line, and when it answers the setup offer (the stored ask's setup), that line then
 * the setup-done reply (outcome 'existing'). Not a token on Base (or not an address): its line, and the stored ask
 * stays, so the next answer (another address, or "skip": the token's no) still answers it. A
 * token already launching, launched or unknown: its state, unchanged. Never throws.
 */
export async function tokenExisting(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'builderTokenDeps'>, address: string): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  try {
    const r = await recordExistingToken(id, address, { isToken: ctx.builderTokenDeps?.isToken });
    if (r === 'not_token') {
      const asked = (await benchAsked(id, {}))?.kind === 'token';
      return { show_to_builder: EXISTING_NOT_TOKEN, ...(asked && { move_up: { kind: 'token', project_key: null, agent_note: TOKEN_ASK_NOTE } }) };
    }
    if (r === 'no_x') return { show_to_builder: TOKEN_CANT };
    const t = await takeTokenAsk(id);
    if (r === 'has_token') return { show_to_builder: await tokenAnswerFor(id, now) };
    const line = existingTokenLine(shortWallet(address.trim().toLowerCase()));
    const done = t?.setup ? await setupDoneFor(id, now, null, ctx.ownInstallationId ?? id) : null;
    return done ? { ...done, show_to_builder: `${line}\n\n${done.show_to_builder}` } : { show_to_builder: line };
  } catch (err) {
    logged('token existing')(err);
    return { show_to_builder: TOKEN_TRY_LATER };
  }
}
/**
 * v4.2 Task 1: tell token 'ask' ANSWERS the builder's token question and never launches one (only the builder's own
 * yes, tell move_up kind 'token', does): live (the trade link and what it earns), kept off, on its way, or no token yet
 * (what it is, and how it goes live). Setup step 3 due and not yet shown: step 3's reply. Task 6: an earlier builder
 * due the legacy offer hears the explainer and the offer question, stored as the ask. Otherwise it adds no question of
 * its own and (final review 2) clears the stored ask, except an open step 3's, which keeps its one question. Tokens off
 * with no row: "Okay.". Never throws.
 */
export async function tokenAsk(ctx: Pick<ToolContext, 'installationId'>, o: { statement?: boolean } = {}): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  try {
    // Final review 7: beside a move_up answer (the same tell), that reply owns the one question: the token is answered as
    // a statement, nothing claimed, stored or cleared (an open step 3's "Rather skip it?" left out).
    if (o.statement) {
      if (!builderTokensOn() && !(await builderToken(id))) return { show_to_builder: NOTED_LINE };
      const state = await tokenAnswerState(id, now);
      return { show_to_builder: state.walletStepOpen && state.token?.status !== 'existing' ? TOKEN_EXPLAINER : tokenAnswerText(state) };
    }
    if (!(await builderToken(id)) && (await walletSetupDue(id, now))) {
      const step = await walletStep(id, now);
      if (step) return step as Reply;
    }
    if (!builderTokensOn() && !(await builderToken(id))) return { show_to_builder: NOTED_LINE };
    // v4.2 Task 6: an earlier builder (a wallet, no token row, never offered) hears the explainer and the offer, once; the offer is the
    // stored ask, so a following yes or no answers it. Otherwise the state's text alone. v4.7 T3: the builder asked, so
    // the offer needs no application first (tokenOfferDue asked).
    const offer = (await tokenOfferDue(id, { asked: true })) && (await takeTokenOffer(id, now));
    if (!offer) {
      const state = await tokenAnswerState(id, now);
      // Final review 2: this answer asks nothing, so only the ask it shows is answerable: none. The stored ask is
      // cleared (a later kindless yes can't answer an older question), except an open step 3's, which stays the one
      // question ("Done?") the builder still owes.
      if (!state.walletStepOpen) await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id}`.catch(logged('token ask clear'));
      return { show_to_builder: tokenAnswerText(state) };
    }
    await storeAsk(id, { kind: 'token', key: null, at: now.toISOString() });
    return { show_to_builder: await tokenAnswerFor(id, now, { offerQuestion: TOKEN_OFFER_QUESTION }), move_up: { kind: 'token', project_key: null, agent_note: TOKEN_ASK_NOTE } };
  } catch (err) {
    logged('token ask')(err);
    return { show_to_builder: NOTED_LINE };
  }
}
/**
 * v4.0 Task 11 fix round 1: an old agent's coin answer (tell coin { answer }, move_up kind 'coin') launches or declines
 * the builder token only when the stored ask is its offer: setup step 3 with the token sentence (wallet_setup and
 * token_offered) or the token offer (kind 'token'). Null otherwise: nothing changes. Never throws.
 */
export async function legacyCoinAnswer(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'tokenDeps' | 'builderTokenDeps'>, answer: 'yes' | 'no'): Promise<Reply | null> {
  const asked = await benchAsked(ctx.installationId, {});
  if (asked?.kind === 'token') return benchMoveUp(ctx, { kind: 'token', project_key: null, answer, via: 'coin' });
  if (asked?.kind === 'wallet_setup' && (await tokenOffered(ctx.installationId))) {
    // v4.7.1 T2: a no is still the token's no. A yes to v4.0's step 3 sentence launches nothing and offers nothing (the
    // token_offered mark it needs also ends tokenOfferDue): it ends the old sentence, the ask cleared, no question.
    if (answer === 'no') return benchMoveUp(ctx, { kind: 'token', project_key: null, answer, via: 'coin' });
    await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${ctx.installationId} AND standing_seen->'bench_ask'->>'kind' = 'wallet_setup'`.catch(logged('legacy token yes'));
    return { show_to_builder: LEGACY_SETUP_DONE };
  }
  return null;
}
/** v4.7.1 T2: the legacy yes to v4.0's step 3 sentence: a statement, no question. */
const LEGACY_SETUP_DONE = 'Your setup is done.';
/**
 * v4.0: tell move_up kind 'token'. A no is kept forever (declineBuilderToken; a token already on its way or live is
 * unchanged, and said so). A yes launches it now (launchBuilderToken, idempotent); without a reward wallet yet, the
 * wallet link (walletChangeReply). Never throws.
 */
async function tokenAnswer(ctx: Pick<ToolContext, 'builderTokenDeps'>, id: number, answer: 'yes' | 'no', now: Date, ownYes = false): Promise<Reply> {
  try {
    if (answer === 'no') {
      const r = await declineBuilderToken(id);
      // A stale token ask must not carry a later bare yes back over this no.
      await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'token'`.catch(logged('clear token ask'));
      return { show_to_builder: r === 'launched' || r === 'existing' ? await tokenAnswerFor(id, now) : r === 'launching' || r === 'unknown' ? TOKEN_ON_ITS_WAY : TOKEN_NO_LINE };
    }
    // Final review 1: the yes is what token_offered records (the legacy offer's show never sets it). v4.7 T3: with
    // token_yes, a launch this yes starts and drops, or one waiting on a wallet proven later, is launched by the hourly
    // retry (the proof itself never launches).
    if (builderTokensOn()) await markTokenYes(id, now);
    // v4.2: the builder's own yes after a no reopens it (only the builder's own yes; see ownYes).
    const reopened = ownYes && builderTokensOn() && (await reopenDeclinedToken(id));
    const r = await launchBuilderToken(id, ctx.builderTokenDeps ?? {});
    // The relaunch cannot go on (lasting): the no is put back rather than left as no row.
    if (reopened && (r.result === 'x_taken' || r.result === 'no_ticker')) await declineBuilderToken(id);
    if (r.result === 'launched' || r.result === 'exists') {
      const t = await builderToken(id);
      if (t) return { show_to_builder: await tokenAnswerFor(id, now, { justLaunched: r.result === 'launched' }) };
    }
    const line = tokenLine(r);
    if (line) return { show_to_builder: line };
    if (!(await provenWallet(id))) return walletChangeReply(id, now);
    return { show_to_builder: TOKEN_TRY_LATER };
  } catch (err) {
    logged('token answer')(err);
    return { show_to_builder: TOKEN_TRY_LATER };
  }
}

/**
 * Final review 1: the builder's yes to their token (standing_seen.token_offered; token_skipped, a wallet skip's mark,
 * cleared). v4.7 T3: and token_yes, the only mark the hourly retry launches on (v4.0's step-3 sentence also set
 * token_offered, without a yes). Never throws.
 */
async function markTokenYes(id: number, now: Date): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) - 'token_skipped')
      || jsonb_build_object('token_offered', COALESCE(standing_seen->>'token_offered', ${now.toISOString()}::text),
        'token_yes', COALESCE(standing_seen->>'token_yes', ${now.toISOString()}::text))
    WHERE builder_id = ${id}`.catch(logged('token yes'));
}

/** GTM W2: a one project with a repo key (a link-only project, a Lovable or Bolt app, has none). Pure. */
const hasRepo = (main: string | null) => main !== null && !LINK_KEY.test(main);
/** No project yet: whether one exists and whether the GitHub no is held. Null on a read error. */
async function noProjectState(id: number): Promise<{ main: string | null; no: boolean } | null> {
  const [p] = await sql()<{ main: string | null; no: boolean }[]>`
    SELECT main_project_key AS main, COALESCE(standing_seen ? 'github_no', false) AS no FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
    logged('github answer')(err);
    return [];
  });
  return p ?? null;
}
/** The builder will connect after all: the GitHub no cleared, step 2 with a fresh link, stored as the ask. Never throws. */
async function connectAfterAll(id: number, now: Date): Promise<Reply> {
  const link = await pickLink(id, now).catch(logged('pick link'));
  if (!link) return { show_to_builder: NOTED_LINE };
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'github_no' WHERE builder_id = ${id}`.catch(logged('github yes'));
  await storeAsk(id, { kind: 'pick_repo', key: null });
  // v4.0: the builder said no to GitHub before this yes, so step 2 carries the Lovable or Bolt hint.
  return { show_to_builder: STATE_COPY.no_project.ask(link, true), move_up: { kind: 'pick_repo', project_key: null, agent_note: PICK_REPO_NOTE } };
}

/**
 * 2026-10-23 Base onboarding: the answer to step 2 for a builder with no project. A no is remembered
 * (standing_seen.github_no) and its reply is the next question (afterGithubNo). A yes after that no is the builder
 * asking to connect after all (connectAfterAll). Null: not this case (a project exists, or a yes with no no before it:
 * the stored ask's own path). Never throws.
 */
async function githubAnswer(id: number, answer: 'yes' | 'no', now: Date): Promise<Reply | null> {
  const p = await noProjectState(id);
  // GTM W2: a project named only by its live link (no repo) is on the no-GitHub path too.
  if (!p || hasRepo(p.main)) return null;
  // v3.1 cold read: a live app (Lovable, Bolt): its tool's GitHub steps, never the Base walk-through.
  if (answer === 'no' && p.main !== null && LINK_KEY.test(p.main)) return liveNoAnswer(id, p.main, now);
  if (answer === 'no') {
    await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('github_no', ${now.toISOString()}::text))
        - (CASE WHEN standing_seen->'bench_ask'->>'kind' = 'pick_repo' THEN 'bench_ask' ELSE '' END)
      WHERE builder_id = ${id}`.catch(logged('github no'));
    return afterGithubNo(id, now);
  }
  return p.no ? connectAfterAll(id, now) : null;
}

/** v3.1 cold read: a live app's shown name (the builder's own, else "your app"). Never throws. */
async function liveName(id: number, key: string): Promise<string> {
  const n = linkName(await reportedName(id, key));
  return n === YOUR_APP ? 'your app' : n;
}
/**
 * v3.1 cold read (owner-approved): the no to the connect step for a live app with no repo. The first no: how its tool
 * (Lovable, Bolt, else both) puts the code on GitHub, with the connect link and "Done?", stored as the connect step
 * (standing_seen.github_no_app: every later reply shows it). A later no: "No rush." with the way back. Never throws.
 */
async function liveNoAnswer(id: number, key: string, now: Date): Promise<Reply> {
  const [taken] = await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('github_no_app', ${now.toISOString()}::text)
    WHERE builder_id = ${id} AND NOT COALESCE(standing_seen ? 'github_no_app', false) RETURNING 1`.catch((err: unknown) => {
    logged('live no')(err);
    return [];
  });
  if (!taken) {
    await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'pick_repo'`.catch(logged('live no ask'));
    return { show_to_builder: NEXT_STEP_LATER };
  }
  const link = await pickLink(id, now).catch(logged('pick link'));
  if (!link) return { show_to_builder: NEXT_STEP_LATER };
  await storeAsk(id, { kind: 'pick_repo', key: null });
  return { show_to_builder: liveNoGithub(builtWith(key), await liveName(id, key), link), move_up: { kind: 'pick_repo', project_key: null, agent_note: PICK_REPO_NOTE } };
}
/** v3.1 cold read: "I don't see your code on GitHub yet." for a connect yes with nothing connected. */
export const NOT_ON_GITHUB_YET = "I don't see your code on GitHub yet.";
/**
 * v3.1 cold read (bug 1): a yes to the connect step ("done") with no repo connected through the App yet: never an empty
 * reply. The connect step again with a fresh link (a live app: its tool's GitHub steps), stored as the ask. Null when a
 * repo is connected (the agent calls find, PICK_REPO_YES_NOTE). Never throws.
 */
async function connectNotYet(id: number, now: Date): Promise<Reply | null> {
  if (await appConnected(id)) return null;
  const p = await noProjectState(id);
  if (!p || hasRepo(p.main)) return null;
  const link = await pickLink(id, now).catch(logged('pick link'));
  if (!link) return null;
  await storeAsk(id, { kind: 'pick_repo', key: null });
  const line = p.main !== null && LINK_KEY.test(p.main)
    ? `${NOT_ON_GITHUB_YET} ${liveNoGithub(builtWith(p.main), await liveName(id, p.main), link)}`
    : `${NOT_ON_GITHUB_YET} Once it's there, connect it here: ${link}\n${p.no ? `${NO_GITHUB_HINT}\n` : ''}Done?`;
  return { show_to_builder: line, move_up: { kind: 'pick_repo', project_key: null, agent_note: PICK_REPO_NOTE } };
}

/**
 * 2026-10-23 fix round: the answer to the resting question ("Is your app's code on GitHub yet?"). A yes is step 2 again
 * (connectAfterAll); a no keeps resting ("Okay."). Answered once a stored ask (a project already: "Okay."). Never throws.
 */
async function restAnswer(id: number, answer: 'yes' | 'no', now: Date): Promise<Reply> {
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask'
    WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'next_step'`.catch(logged('rest answer'));
  const p = await noProjectState(id);
  if (!p || hasRepo(p.main)) return { show_to_builder: NOTED_LINE };
  // GTM W2: a no is a plain "later" with the way back, never "Okay.".
  if (answer === 'no') return { show_to_builder: NEXT_STEP_LATER };
  return connectAfterAll(id, now);
}

/**
 * 2026-10-23 Base onboarding: the answer to the walk-through (asked once, or asked for by the builder). A yes, with Base
 * Builder Grants open and shown (find's gate), is the steps and is remembered (standing_seen.base_walk; the page then
 * reads "Getting started on Base"); not open: "Okay." and nothing saved (fix round 3). A no is remembered and followed by
 * the optional wallet step when due, else "Okay.". Never throws.
 */
async function baseStartAnswer(id: number, answer: 'yes' | 'no', now: Date): Promise<Reply> {
  // GTM W2: a yes right after the steps were given ("yes, help with step 1", the stored ask base_help) moves on to
  // step 1's help, never the same block; asked again later, the steps are given again.
  if (answer === 'yes') {
    const [w] = await sql()<{ ask: string | null }[]>`SELECT standing_seen->'bench_ask'->>'kind' AS ask FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
    if (w?.ask === 'base_help') return baseHelpAnswer(id, 'yes');
  }
  const grant = answer === 'yes' ? await baseGrantFor(id, now) : null;
  if (answer === 'yes' && !grant) return { show_to_builder: NOTED_LINE };
  await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb)
      || jsonb_build_object('base_walk', jsonb_build_object('answer', ${answer}::text, 'at', ${now.toISOString()}::text), 'base_asked', COALESCE(standing_seen->'base_asked', to_jsonb(${now.toISOString()}::text))))
      - (CASE WHEN standing_seen->'bench_ask'->>'kind' = 'base_start' THEN 'bench_ask' ELSE '' END)
    WHERE builder_id = ${id}`.catch(logged('base walk'));
  (await import('./profile-cache')).profileChanged();
  if (answer === 'no') return (await walletStep(id, now)) ?? { show_to_builder: NEXT_STEP_LATER };
  // GTM W2, v3.1 cold read: its question ("Want me to write your Lovable prompt?") is a move_up, so the yes moves on
  // (baseHelpAnswer: the agent writes the prompt); the block is never repeated on that yes.
  await storeAsk(id, { kind: 'base_help', key: null });
  return { show_to_builder: baseStartSteps(grant!), agent_note: BASE_STEPS_NOTE, move_up: { kind: 'base_help', project_key: null, agent_note: BASE_HELP_NOTE } };
}

/**
 * GTM W2, v3.1 cold read (owner-approved): the answer to "Want me to write your Lovable prompt?" after the Base path. A
 * yes: no text of EarnKit's own; the agent writes a short Lovable prompt from the idea the builder described
 * (LOVABLE_PROMPT_NOTE), and the resting question is stored for later. A no is "later". Never throws.
 */
async function baseHelpAnswer(id: number, answer: 'yes' | 'no'): Promise<Reply> {
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask'
    WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'base_help'`.catch(logged('base help'));
  if (answer === 'no') return { show_to_builder: NEXT_STEP_LATER };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('lovable_prompt', ${new Date().toISOString()}::text)
    WHERE builder_id = ${id}`.catch(logged('lovable prompt'));
  return { show_to_builder: '', agent_note: LOVABLE_PROMPT_NOTE };
}

/**
 * GTM W2: the answer to the Monday check-in (asked once). Remembered (standing_seen.checkin); a yes tells the agent to set
 * its own weekly routine that calls find. Never throws.
 */
async function checkinAnswer(id: number, answer: 'yes' | 'no', now: Date): Promise<Reply> {
  await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb)
      || jsonb_build_object('checkin', jsonb_build_object('answer', ${answer}::text, 'at', ${now.toISOString()}::text)))
      - (CASE WHEN standing_seen->'bench_ask'->>'kind' = 'checkin' THEN 'bench_ask' ELSE '' END)
    WHERE builder_id = ${id}`.catch(logged('checkin'));
  return answer === 'yes' ? { show_to_builder: CHECKIN_ON, agent_note: CHECKIN_YES_NOTE } : { show_to_builder: NOTED_LINE };
}

/** GTM W2: the Monday email question's move_up (a yes carries the address to tell weekly_email; a no comes here). Pure. */
const emailMoveUp = (key: string | null) => ({ move_up: { kind: 'weekly_email', project_key: key, agent_note: EMAIL_ASK_NOTE } });
/** GTM W2: a yes or no to the email question by move_up: a no is saved (never asked again); a yes asks which address. */
async function emailAnswer(id: number, answer: 'yes' | 'no'): Promise<Reply> {
  if (answer === 'yes') return { show_to_builder: WHICH_EMAIL, agent_note: EMAIL_NOTE };
  return saveWeeklyEmail(id, { answer: 'no' }, { shared: false }).catch((err: unknown) => {
    logged('email no')(err);
    return { show_to_builder: NOTED_LINE };
  });
}

/**
 * v3.1 cold read round 2: the one project's shipping log written now from its App-proven commits (week-facts.ts
 * backfillOnConnect, the connect's own backfill), within the reply's wait; the hourly catch-up finishes what this
 * leaves. For a project made the one project after its App proof (a repo switch), whose log the connect never wrote. Never throws.
 */
async function backfillNow(id: number, key: string, now: Date): Promise<void> {
  await settleWithin(
    import('./week-facts').then((w) => w.backfillOnConnect(id, key, now, { deadline: Date.now() + REPLY_WAIT_MS })).catch(logged('backfill now')),
    REPLY_WAIT_MS,
  );
}

/** Launch ready L2: tell main_project's lines (the builder named the repo to rank instead). */
export const RANK_LINES = {
  set: (key: string) => `EarnKit now ranks github.com/${key}.`,
  same: (key: string) => `EarnKit already ranks github.com/${key}.`,
  notProven: (key: string) => `github.com/${key} isn't connected yet.`,
  install: (key: string, link: string) => `github.com/${key} isn't connected yet. Install the read-only EarnKit app on it (one click): ${link}\nWant me to rank it once that's done?`,
} as const;
export const RANK_SET_NOTE = "Call find to show where they stand now. Don't show this note.";
export const RANK_INSTALL_NOTE =
  "Once the builder has installed EarnKit on it from the link, call tell with main_project again. Don't show this note.";

/**
 * Launch ready L2: tell main_project. The one project moves to `repo` when this person proved it with the App
 * (main-project.ts rankRepo), and they are rescored at once; otherwise that repo's own install link (S7: only
 * with a page) is offered, and nothing changes.
 */
export async function rankAnswer(ctx: Pick<ToolContext, 'installationId'>, key: string): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  let r = await rankRepo(id, key);
  // GTM W2: the App already installed on that repo (an earlier pick covered it): proven now, never asked to install again.
  if (r === 'not_proven' && (await settleWithin(proveCovered(id, key), REPLY_WAIT_MS))) r = await rankRepo(id, key);
  if (r === 'same') return { show_to_builder: RANK_LINES.same(key) };
  if (r === 'set') {
    await (await import('./person-score')).rescorePerson(id, now).catch(logged('rank rescore'));
    // v3.1 cold read round 2: a repo the App proved before it was the one project: its log is written now, so the
    // connect question comes in the next reply (Kai: switched to VaultPilot after the picker).
    await backfillNow(id, key, now);
    (await import('./profile-cache')).profileChanged();
    return { show_to_builder: RANK_LINES.set(key), agent_note: RANK_SET_NOTE };
  }
  // Fix round 1 (M5): that repo's own install link (its setup proves exactly it), never the picker's.
  const link = REPO_KEY.test(key) ? await installLink(id, key, now).catch(logged('install link')) : null;
  return link ? { show_to_builder: RANK_LINES.install(key, link), agent_note: RANK_INSTALL_NOTE } : { show_to_builder: RANK_LINES.notProven(key) };
}

/** v2.14 signed_out: the yes to "Want me to put your work on the Bench once you're in?". */
export const SIGN_IN_YES_NOTE =
  "If show_to_builder had no sign-in link, call find again for it. When the builder has signed in with X from the link, they get a code: call find with sign_in_code set to it. Don't show this note.";
/** v2.14 not_counted, no repo named: the yes to "Where does <project> live on GitHub?" names it. */
export const REPO_BEHIND_NOTE =
  "Ask the builder in one short question for the GitHub repo behind their project, then call find with identity.project: { name, repo, live_url }. Don't show this note.";
/** Owner ruling A (v2.13.3): the yes to "What's your GitHub, or a link to something you've made?". */
export const START_YES_NOTE =
  "Ask the builder in one short question for their GitHub login or a link to something they've made, then call find with identity: { github_login, project: { name, repo or live_url } }. Don't show this note.";
/** Launch ready L2: the yes to "Want me to rank it once that's done?" (the repo picker). */
export const PICK_REPO_YES_NOTE =
  "Call find now: its show_to_builder is what the builder sees next (show_to_builder here is empty on purpose). Don't show this note.";
/** v2.13.3 (5): the yes to the install ask. */
export const INSTALL_APP_YES_NOTE =
  "Once the builder has installed EarnKit on the repo from the link, call find again. Don't show this note.";
/** v2.13.1 O2 fix round 1 (ruling 3): taken or a copy: the yes to "Want to use a different project?". */
export const OTHER_PROJECT_NOTE =
  "Ask the builder in one short question which project is theirs (a repo under their own GitHub account), then call find with identity.project: that project. Don't show this note.";
/** GTM W2: SHIP_NOTE for an agent with no folder of the code (agent-reach.ts hosted). */
export const SHIP_NOTE_HOSTED =
  "From what you know of their project (its live page, its GitHub repo's recent commits and open issues, what they told you), suggest one small thing to ship this week, in one short line. Don't show this note.";
/** O5 N5, R8: the yes to "Ship this week to climb." (or app_off's "Want me to suggest one small thing to ship ..."). */
export const SHIP_NOTE =
  "Look at the project in this folder (git log, open issues, the README) and suggest one small thing to ship this week, in one short line, then ask if they want you to build it now. Don't show this note.";

/**
 * v3.1 cold read (one name everywhere): the builder's one project as replies name it: the name they gave (reportedName),
 * else the row's or the repo's own (displayName); a live link's host never. Null without a project. Never throws.
 */
/**
 * v3.1 cold read (security review): the one project's name for a reply about `repo` only: null unless the builder's one
 * project is that repo (refKey match), so another project's name is never used. Callers skip it on a shared client.
 * Never throws.
 */
export async function mainProjectNameFor(id: number, repo: string): Promise<string | null> {
  const [p] = await sql()<{ main: string | null }[]>`SELECT main_project_key AS main FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  if (!p?.main || refKey(p.main) !== refKey(repo)) return null;
  return mainProjectName(id).catch(() => null);
}
export async function mainProjectName(id: number): Promise<string | null> {
  const [p] = await sql()<{ main: string | null; name: string | null }[]>`
    SELECT b.main_project_key AS main, r.name FROM builder_profiles b
    LEFT JOIN builder_projects r ON r.builder_id = b.builder_id AND lower(r.project_key) = lower(b.main_project_key)
    WHERE b.builder_id = ${id}`.catch(() => []);
  if (!p?.main) return null;
  const given = await reportedName(id, p.main, true);
  if (LINK_KEY.test(p.main)) {
    const n = linkName(given);
    return n === YOUR_APP ? null : n;
  }
  return displayName(given ?? p.name ?? keyName(p.main), p.main, null);
}

/**
 * v3.1 cold read (one name everywhere): a project name the builder gave in another call (prepare's project, the agent
 * reporting what the builder said) is remembered on the stored identity when it names their one project (by its repo
 * or live link), so every later reply uses it. Nothing for a shared client. Never throws.
 */
export async function rememberProjectName(id: number, p: { name?: unknown; repo_url?: unknown; live_url?: unknown } | undefined, now: Date): Promise<void> {
  try {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name || /^https?:\/\//i.test(name)) return;
    const [b] = await sql()<{ main: string | null }[]>`SELECT main_project_key AS main FROM builder_profiles WHERE builder_id = ${id}`;
    const main = b?.main;
    if (!main) return;
    const refs = [p?.repo_url, p?.live_url].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    const k = refKey(main);
    if (!refs.some((r) => refKey(r) === k)) return;
    const repo = refs.find((r) => /github\.com\//i.test(r)) ?? (REPO_KEY.test(main.toLowerCase()) ? `https://github.com/${main}` : null);
    const live = refs.find((r) => !/github\.com\//i.test(r)) ?? (LINK_KEY.test(main) ? main : null);
    await noteIdentity(id, { github_login: null, wallets: [], projects: [{ name, what: null, repo, live_url: live, package: null, contracts: [] }] }, now, { propose: false });
  } catch (err) {
    logged('remember name')(err);
  }
}
