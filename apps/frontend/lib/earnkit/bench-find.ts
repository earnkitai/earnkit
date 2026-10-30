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
import { grantOf, qualifyOffer } from './base-qualify';
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
import { byDeadline, byRelevance, canApply, enteredIds, fullProgramTable, layout, noFitLine, submitStep, submitStepLine, type Card, type FirstMessage, type RepoFit, type YourRepos } from './present';
import type { ReaderDeps } from './source-readers';
import { NO_USERS_YET, creditsMainnet, type Detection } from './match';
import { refKey, reportedName } from './project-name';
import { noteIdentity, projectKeyOf, type IdentityProject } from './identity-input';
import type { ToolContext } from './tools';
import { CHAIN_NAMES, type Chain } from './chains';
import {
  APPLY_WINDOW_DAYS, ASKS_HINT, withWhy, BASE_START_ASK, CHECKIN_ASK, CHECKIN_WHY, askWhy, bestFitWhy, closestWhy, CHECKIN_ON, NEXT_STEP_LATER, SHIP_ASK_DAYS, NEXT_STEP_ASK, STALE_WEEKS, STATE_COPY, TEMPLATE_NOTICE, TITLES_ASK, TITLES_NO_LINE, awardAmount, baseStartSteps, benchReply, NO_GITHUB_HINT, builtWith, liveNoGithub, namesAccount, benchStepKey, qualifySteps, rankedState, replyState, stateAsk, standingLine, walletOffer, walletSetupAsk, welcomeFits,
  TOKEN_NO_LINE, STRIPE_NEVER_KEY, STRIPE_NO_LINK, stripeConnectLine, QUALIFY_HELP_ASK_ONE, QUALIFY_CODES_CHECK_NOTE, QUALIFY_CODES_NOTE, qualifyCodesYes, type AlsoOpen,
  type ApplyPick, type FitBar, fitBar, keyName, type QualifyOffer, type QualifyStep, type BenchAskKind, type BenchProject, type BenchView, type BestFit, type ConnectOffer, type FundLine, type MomentView, type OpenGrant, type Variant,
} from './bench-reply';
import { liveSite, type LiveSite } from './live-check';
import { EXISTING_NOT_TOKEN, TOKEN_OFFER, TOKEN_OFFER_QUESTION, TOKEN_ON_ITS_WAY, WALLET_SETUP_SKIPPED, existingTokenLine, setupTokenOffer, displayName, firstName, isStep2, setupDoneReply, type ProgramRow, type SetupOutcome } from './bench-reply';
import { targetIn, weeklyTarget } from './weekly-target';
import { APPROVED_LINE, SHARE_NOTE, answerShare, lastWeekOf, markOffered, momentDue, momentSummary, momentPlace, momentReady, openShare, takeMoment, weekNumber } from './weekly-moment';
import { isoWeekOf } from './weeks';
import { weekCommunityUsd } from './community';
import { streaksFor } from './streak';
import { personal, readStanding, standingLeads, standingParagraph, streakOnly, type Standing } from './standing';
import { OUTCOME_SHARE_NOTE, claimNudge, outcomeShareLine, pickNudge, type NudgePick } from './nudges';
import {
  CONNECT_DONE, CONNECT_NOTE, CONNECT_RETRY, answerConnect, backfillComplete, closeConnect, connectApplyAsk, connectDue, connectWeeks, openConnect,
  type ConnectBest,
} from './connect-moment';
import { POST_NOTE, eventPost, redraftAnswer, weeklyPost } from './post-reply';
import { EMAIL_NOTE, WHICH_EMAIL, askWeeklyEmail, digestEnabled, saveWeeklyEmail } from './digest';
import { pagePath } from './reserved-routes';
import { prizeOf, shortWallet, siteUrl, upToCell } from './entry-text';
import { programKind } from './site-copy';
import { BASE_GRANTS_ID } from './builder-code';
import { appProvenRepo, builderCodesKnown, builderCodesWords, codesSettled, refreshBuilderCodes } from './builder-codes-check';
import { WALLET_NOTE, type WalletAnswer, answerWallet, takeWalletAsk, takeWalletNotice, tokenOffered, walletChangeReply, walletOfferDue, walletSetupDue, walletSetupNote, takeTokenOffer, tokenOfferDue } from './wallet-offer';
import { builderToken, builderTokensOn, declineBuilderToken, launchBuilderToken, recordExistingToken, reopenDeclinedToken, tradeUrl, type LaunchResult } from './builder-token';
import { TOKEN_EXPLAINER, TOKEN_OFF, tokenAnswerFor, tokenAnswerState, tokenAnswerText } from './token-answers';
import { provenWallet } from './wallet-proof';
import { stripeLink } from './stripe';
import { agentReach, rememberNoFolder, type AgentReach } from './agent-reach';
import { DECLINE_MS, draftedRecently } from './policy-constants';
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
 * v4.7.1 T1: CHECK_FITS_NOTE for the ranked check_fits ask ("Want me to check what Kit would need for Arc Microgrants?"):
 * also read that program's requirements and list what the project would need. Pure.
 */
export const checkNeedsNote = (program: string) =>
  `${CHECK_FITS_NOTE.slice(0, -" Don't show this note.".length)} Then read ${program}'s requirements (its program page or the source find links) and list, in short plain lines, what the project would need to meet each one. ` +
  "Never tell them they qualify or that an application was sent. Don't show this note.";
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
    /** v3.1 one-tap posts (kind 'post'): the post's code, its head line and its moment (post-reply.ts). */
    code?: string; head?: string; moment?: unknown;
    /** v4.0 Task 8 fix round 1 (kind 'outcome_share'): the outcome post's short link. */
    link?: string;
    /** v3.1 wallet proof (kind 'wallet'): when the step was asked (ISO); its yes checks for a wallet proven since. */
    at?: string;
    /** v4.4 (kind 'token'): the offer that followed setup step 3's sign; its answer is the setup-done reply. */
    setup?: boolean;
  };
  /** v4.6 Task 3: when the Stripe ask was shown (once) and when a broken connection was re-offered (once). */
  stripe_asked?: string;
  stripe_reoffered?: string;
  /** Fix round 1: when the qualify steps were given ({ [lowercase project key]: iso }); held back DECLINE_MS. */
  qualify_given?: Record<string, string>;
  /** v3 Stage 2: the programs the apply step was shown for ({ [program_id]: iso }): asked once a program. */
  apply_asked?: Record<string, string>;
  /** v4.7 T3: the programs with a draft in the builder's hands ({ [program_id]: iso }: a yes to drafting, or prepare showed one): not asked again for DECLINE_MS. */
  apply_yes?: Record<string, string>;
  /** v4.7 T3 fix round 2 (R12): the apply ask's showings with no answer since ({ [program_id]: n }); reset by a yes or no. */
  apply_unanswered?: Record<string, number>;
  /** v4.7 T3 fix round 2 (R12): the programs set aside for silence ({ [program_id]: iso }), beside their declined key. */
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
  /** v4.7 T4: the setup-done reply's first-run line (ASKS_HINT) was said (once). */
  asks_hint?: string;
  /** v4.7.1 T1: the ranked check_fits ask was asked (once a person, takeOnce). */
  check_fits_asked?: string;
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
  const [p] = await sql()<{ main: string | null; seen: unknown; identity: unknown }[]>`
    SELECT main_project_key AS main, standing_seen AS seen, identity FROM builder_profiles WHERE builder_id = ${id}`.catch(
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
};

/** Test only: resolves when every running Builder Codes check has finished. */
export { codesSettled };
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
    if (done) {
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
  // Launch ready L5: the weekly target, the ship step's points line lead (ranks only, never another builder's name).
  const aim = ranked ? await targetIn(id, read.parts, now) : null;
  const target = aim ? weeklyTarget(aim) : null;
  // v3.1 (spec 3.2): the apply candidates: a fit closing within APPLY_WINDOW_DAYS (deadline order), else the rolling fits
  // (byRelevance), none the builder told EarnKit about. The first is the Best fit, the reply's money line.
  // v3.1 cold read: long shots never lead and a program that takes a company is never offered unprompted: only real fits
  // are the money line, the fund lines and the apply step (long shots stay in the "What can I earn?" table).
  const realFits = o.fits.filter(realFit);
  const open = ranked && project && !taken && !held
    ? ((await bestApplies(id, (o.applies ?? o.fits.slice(0, 3)).filter(realFit), read.seen, o.skip, now)) ?? [])
    : [];
  // v3.1 Task 7: Base Builder Grants' Builder Codes answer (the stored one; a check for the draft starts in the background).
  const codes = open[0]?.program_id === BASE_GRANTS_ID && project ? await codesFor(id, project.key, now, o.codesFetch) : null;
  const bestOf = (f: Fit, c: string | null): BestFit =>
    ({ program_id: f.program_id, title: f.title, amount: f.amount, when: f.when, why: f.why, codes: c, ...(f.bar && { bar: f.bar }) });
  const best: BestFit | null = open[0] ? bestOf(open[0], codes) : null;
  // v4.7 T3 (money first; fix round 1, R8 and R11): the open fits not applied to and not drafted (a yes to drafting,
  // apply_yes, holds DECLINE_MS). While one is left, the reply's ask is its apply: only setup step 3, connect and an
  // owning nudge go ahead of it; the hot and other event posts, the Monday moment, non-owning nudges and every quieter
  // ask wait (each unclaimed) until none is left.
  // Fix round 2 (R12): an apply ask shown APPLY_UNANSWERED_MAX times with no answer stands aside as a no would (declined
  // for DECLINE_MS, marked apply_silent), so money first never starves the other asks; it comes back after DECLINE_MS.
  const silent = new Set(open.filter((f) => (read.seen.apply_unanswered?.[f.program_id] ?? 0) >= APPLY_UNANSWERED_MAX).map((f) => f.program_id));
  if (silent.size > 0) await standAside(id, [...silent], now);
  const unapplied = open.filter((f) => !draftedRecently(read.seen, f.program_id, now) && !silent.has(f.program_id));
  const moneyFirst = unapplied.length > 0;
  // v4.7.1 T1 (money always shows): ranked with no unapplied fit, the open grants closing soonest lead the reply.
  const openNow = ranked && project && !taken && !held && !moneyFirst ? openNowGrants(o.cards, now, o.skip) : [];
  // v3 Stage 1 (spec 5.1): the connect weeks, once a person, before (and in place of) this reply's weekly moment.
  // Task 16: the Best fit rides on the offer, so its yes offers to draft it.
  const connect = rankedFree && !more && project && handle && !held ? await connectMoment(id, project.key, now, open[0] ?? null) : null;
  // v3.1 one-tap posts (design 6 ruling): went live or won, for 48 hours, before the apply step (a stale launch post is worthless).
  const hot = rankedFree && !more && project && handle && !held && !connect && !moneyFirst ? await eventPost(id, handle, now, { hot: true }) : null;
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
  const peek = !nudgeOk ? null : standIn ? o.nudge! : await pickNudge(id, now, { project: project!.name, best: best && realFit(best) ? best.title : null });
  const askMoment = !standIn && !moneyFirst && peek?.ask && peek.line ? await weeklyMoment(o.own, id, project!.key, handle!, row?.commit_weeks ?? [], now) : null;
  const owns = standIn || Boolean(peek?.ask && peek.line && !askMoment && (await claimNudge(id, now, peek.keep)));
  const apply = !owns && !askMoment && !walletSetup && !connect && !hot && moneyFirst ? await claimApply(id, read.seen, unapplied, now) : null;
  // Launch ready L6: the weekly moment, once a week per installation, never over a held question. v4.7 T3: never over money.
  const moment = askMoment ?? (!owns && !peek?.ask && rankedFree && !more && project && handle && !held && !connect && !hot && !apply && !moneyFirst ? await weeklyMoment(o.own, id, project.key, handle, row?.commit_weeks ?? [], now) : null);
  // v3.1 one-tap posts: the share slot between Mondays: an event's post (an announced win, going live, the coin's intro).
  const event = hot ?? (!owns && rankedFree && !more && project && handle && !held && !connect && !apply && !moment && !moneyFirst ? await eventPost(id, handle, now, { hot: false }) : null);
  // v4.7 T3 (money first): an unapplied fit asked once already (claimApply asks once a program) is asked again, never
  // claimed, in place of everything that waits above.
  const again = !apply && !owns && !walletSetup && !connect && moneyFirst ? applyPickOf(unapplied[0]) : null;
  // 2026-10-22: then a private repo's titles question (once a person), then, with no fit, Base's grant steps.
  const quiet = !owns && rankedFree && project !== null && !held && !connect && !apply && !again && !moment && !event;
  // v3.1 wallet proof: the optional wallet step, once a person, in the first quiet reply after setup (never with another
  // question); claimed below only once this reply carries it.
  // 2026-10-23 Base onboarding: after the GitHub no, the walk-through offer once (Base Builder Grants open: its last
  // step drafts that application), then the wallet step once. v4.7 T3 fix round 2: never ahead of money: githubNo needs
  // the no-GitHub path (no project, or a link-only one: not ranked) and `open` (so moneyFirst) needs a ranked reply.
  const baseAsk = githubNo && handle !== null && !read.seen.base_asked && !read.seen.base_walk && baseGrantOpen(o.cards, now, o.skip) && (await takeBaseAsk(id, now));
  // GTM W2: the Monday check-in, once, on a client that can schedule, in the first quiet reply after setup.
  const reach = o.reach ?? (await agentReach(o.own, id));
  // v4.7.1 T1: Base's grant steps are read here (no claim), so a still-due qualify keeps its place and check_fits waits.
  const qualifyDue = quiet && realFits.length === 0
    ? await qualifyOffer(id, project.key, { cards: o.cards, skip: o.skip, seen: read.seen, now, declineMs: DECLINE_MS, codesFetch: o.codesFetch, known: o.known })
    : null;
  // v4.7.1 T1: no fit and no qualify due: what the project would need for the first open grant, once a person, ahead of
  // the check-in, wallet, token, new-repo, titles and ship asks (standing_seen.check_fits_asked). Never Base's grant:
  // with no qualify due, its own steps were given, declined or told already.
  const needFor = openNow.find((g) => g.id !== BASE_GRANTS_ID) ?? null;
  const checkFits = quiet && !more && !qualifyDue && realFits.length === 0 && needFor && !read.seen.check_fits_asked
    && (await takeOnce(id, 'check_fits_asked', now)) ? needFor.title : null;
  const checkin = quiet && !more && !checkFits && handle !== null && reach.schedules && !read.seen.checkin && checkinAskDue(read.seen, now) && (await takeCheckinAsk(id, now));
  const wallet = ((quiet && !checkin && !checkFits) || (githubNo && !baseAsk)) && !more && handle !== null ? await walletOfferDue(id, now) : null;
  // 2026-10-23: a main project with no commits in STALE_WEEKS: one light nudge, claimed once.
  // Fix round: never within NEW_REPO_GRACE_DAYS of connecting it (its weeks may not be read yet).
  // v4.2 Task 6 (F11): the one-time token offer for an earlier builder, in a quiet reply (never beside another question,
  // never during setup: step 3 is not due); claimed below only once this reply carries it.
  const tokenOffer = quiet && !more && !checkFits && !checkin && !wallet && !walletSetup && handle !== null && (await tokenOfferDue(id));
  // v4.7 T3: the Stripe ask left the reply order: it rides on a draft for a program that wants revenue (tools.ts prepare).
  const newRepo = quiet && !more && !checkFits && !checkin && !wallet && !tokenOffer && handle !== null && !read.seen.new_repo_asked && staleRepo(row?.commit_weeks ?? [], now)
    && !(await connectedSince(id, project.key, now)) && (await takeOnce(id, 'new_repo_asked', now));
  const titles = quiet && !more && !checkFits && !checkin && !wallet && !tokenOffer && !newRepo && handle !== null && (await titlesAskDue(id, project.key, now)) && (await takeTitlesAsk(id, now));
  const qualify = !checkin && !wallet && !tokenOffer && !newRepo && !titles ? qualifyDue : null;
  const link = state === 'signed_out' ? signIn : noCode ? pick : state === 'ranked' ? null : install;

  let fund: FundLine[] = [];
  // O2 fix round 1 (ruling 3): a repo another person holds is never offered a program for it. R12: only programs the
  // matcher fits, each with its deadline (Task 16: the reply names the first, after the Best fit).
  if (project && !taken) fund = realFits.slice(0, 3).map((f) => ({ kind: 'fits', title: f.title, amount: f.amount, when: f.when, ...(f.bar && { bar: f.bar }) }));


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
  const asks = { state, variant, project, link, handle, share: Boolean(moment), connect, noGithub, walletSetup, apply: apply ?? again, titles, qualify, checkFits, post: event, githubNo, baseAsk, newRepo, tokenOffer, checkin, shipAsked, appDone, liveTool, walk, hosted: reach.hosted };
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
  // v4.7 T3 fix round 2 (R12): an apply ask shown (never an owning nudge's) counts one unanswered showing for its program.
  if (finalAsk.kind === 'apply' && !held && !nudgeAsk && asks.apply) await countApplyShown(id, asks.apply.program_id);
  if (finalAsk.kind === 'ship' && !held) await sql()`
    UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('ship_asked', ${now.toISOString()}::text)
    WHERE builder_id = ${id}`.catch(logged('ship asked'));
  // Only the ask shown is answerable: a held question clears the stored one. (The share offer stays open all week in
  // standing_seen.share_open, weeklyMoment.)
  // v3.1 one-tap posts: an event's post stored its own ask (post-reply.ts: the moment, so a yes redrafts it).
  const stored = held || finalAsk.kind === 'post' || finalAsk.kind === 'none' ? null : {
    kind: finalAsk.kind, key: finalAsk.project_key,
    ...(asks.apply && finalAsk.kind === 'apply' && { program_id: asks.apply.program_id, ...(asks.apply.repo && { repo: asks.apply.repo }) }),
    ...(nudgeAsk?.kind === 'apply' && { program_id: nudgeAsk.program_id }),
    ...(nudgeAsk?.kind === 'outcome_share' && { link: nudgeAsk.link }),
    // v4.3: the first step and the name the question used, so its yes is answered as asked (Builder Codes: added here;
    // fix round 1: a hosted agent was asked for the steps, so its yes is qualifySteps; codes_missing picks the note).
    ...(qualify && finalAsk.kind === 'qualify' && {
      program_id: qualify.program_id,
      qualify: { grant: qualify.grant, steps: qualify.steps, first: qualify.steps[0], name: project?.name ?? '', hosted: reach.hosted, codes_missing: qualify.missing.includes('codes') },
    }),
    ...((finalAsk.kind === 'wallet' || finalAsk.kind === 'wallet_setup') && { at: now.toISOString() }),
    // v4.7.1 T1: the open grant the ranked check_fits ask named, so its yes reads that program's requirements.
    ...(finalAsk.kind === 'check_fits' && checkFits && { program: checkFits }),
  };
  if (finalAsk.kind !== 'post') await sql()`
    UPDATE builder_profiles SET standing_seen = CASE WHEN ${stored === null} THEN COALESCE(standing_seen, '{}'::jsonb) - 'bench_ask'
      ELSE COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(stored as never)}::jsonb) END
    WHERE builder_id = ${id}`.catch(logged('ask'));

  // 2026-10-23 (owner): a program that isn't open is never a reply line (nothing to do with it); it shows once it opens.

  // v4.0 Task 8: a nudge with no question of its own (the milestone, the Friday line) leads a ranked reply beside its
  // ask, claimed now; never over the Monday block, a post offer or connect. Fix round 1 (ruling 4): the closing nudge
  // drops only its own program's deadline line.
  // v4.7 T3 fix round 1 (R8): while money first applies, a non-owning nudge waits (unclaimed): nothing leads the money.
  const nudge = owns ? peek
    : nudgeOk && !moneyFirst && peek && !peek.ask && !['share', 'post', 'connect', 'wallet_setup'].includes(finalAsk.kind) && (await claimNudge(id, now, peek.keep)) ? peek
    : null;
  // A congratulation this week (no line) counts as the week's nudge: claimed whenever it comes up.
  if (peek && !peek.line && nudgeOk) await claimNudge(id, now, peek.keep);
  const due = nudge?.kind === 'closing' && nudge.title ? o.due.filter((l) => !l.startsWith(`${nudge.title} closes `)) : o.due;

  // v4.7 final review: the money line and the lead (view.best) name the program the apply ask asks: money first may ask a
  // fit after open[0] (open[0] drafted already, or asked once), never two programs in one reply.
  const askedId = finalAsk.kind === 'apply' ? finalAsk.program_id : undefined;
  const asked = askedId && askedId !== best?.program_id ? open.find((f) => f.program_id === askedId) : undefined;
  const shownBest = asked ? bestOf(asked, asked.program_id === BASE_GRANTS_ID && project ? await codesFor(id, project.key, now, o.codesFetch) : null) : best;
  const view: BenchView = {
    state, variant, project, rank: ranked ? read.ranks.bench : null, streak, target, earned: earned?.paid_usd ?? 0, handle, link, fund, due,
    nudge: nudge?.line ?? null, nudgeOwns: owns,
    // GTM W2 (value before the ask): the open grant also leads step 2 (no project, or a repo not counted yet).
    noGithub, ask: finalAsk, held, best: shownBest && realFit(shownBest) ? shownBest : null, connect, moment, open: state !== 'ranked' ? openGrant(o.cards, now, o.skip) : null, qualify, post: event,
    also: qualify && finalAsk.kind === 'qualify' ? alsoOpen(o.cards, now, o.skip, qualify.program_id) : [],
    openNow: openNow.map(({ id: _id, ...g }) => g),
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
    const standKey = standingLine(project.name, view.rank, streak, view.earned ?? 0);
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
    const nags = !held && !owns && view.nagShown && ['ship', 'none'].includes(finalAsk.kind);
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
    : finalAsk.kind === 'outcome_share' ? OUTCOME_SHARE_NOTE : finalAsk.kind === 'check_fits' ? CHECK_FITS_ASK_NOTE : BENCH_MOVE_UP_NOTE;
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
 * v4.7.1 T1: the ranked reply's open grants with no unapplied fit (bench-reply.ts openNowLine): alsoOpen's grants
 * (none excluded), soonest deadline first, rolling ones last (byRelevance among equals), up to two. Pure.
 */
export function openNowGrants(cards: Card[], now: Date, skip: Set<string>): (AlsoOpen & { id: string })[] {
  const at = (c: Card) => (fundWhen(c) === 'rolling' || !c.ends_at ? Infinity : new Date(c.ends_at).getTime());
  return cards
    .filter((c) => programKind(c).startsWith('grant') && showable(c, now, skip))
    .sort((a, b) => at(a) - at(b) || byRelevance(a, b))
    .slice(0, 2)
    .map((c) => ({ id: c.id, title: c.title, amount: upToCell(prizeOf(c)), when: fundWhen(c) }));
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
async function takeOnce(id: number, key: 'base_asked' | 'new_repo_asked' | 'welcomed' | 'setup_done' | 'asks_hint' | 'check_fits_asked', now: Date): Promise<boolean> {
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
 * v3 Stage 2: the apply ask: the first of `open` never asked before (standing_seen.apply_asked, set here in one guarded
 * UPDATE: asked once a program). `when`: the deadline's day ("Nov 18"), null when rolling. Null otherwise. Never throws.
 */
async function claimApply(id: number, seen: Seen, open: Fit[], now: Date): Promise<(ApplyPick & { repo?: string }) | null> {
  const pick = open.find((f) => !seen.apply_asked?.[f.program_id]);
  if (!pick || !(await takeApplyAsk(id, pick.program_id, now))) return null;
  return applyPickOf(pick);
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
/** v4.7 T3 fix round 2 (R12): unanswered showings of one program's apply ask before it stands aside. */
export const APPLY_UNANSWERED_MAX = 3;
/** R12: one more unanswered showing of `programId`'s apply ask (standing_seen.apply_unanswered). Never throws. */
async function countApplyShown(id: number, programId: string): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{apply_unanswered}',
      COALESCE(standing_seen->'apply_unanswered', '{}'::jsonb)
        || jsonb_build_object(${programId}::text, COALESCE((standing_seen->'apply_unanswered'->>${programId})::int, 0) + 1))
    WHERE builder_id = ${id}`.catch(logged('apply shown'));
}
/** R12: the apply ask for `programId` was answered: its count goes. Never throws. */
async function resetApplyShown(id: number, programId: string): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{apply_unanswered}', (standing_seen->'apply_unanswered') - ${programId}::text)
    WHERE builder_id = ${id} AND standing_seen->'apply_unanswered' ? ${programId}`.catch(logged('apply answered'));
}
/**
 * R12: programs whose apply ask went unanswered APPLY_UNANSWERED_MAX times stand aside as a no would: declined
 * ('apply:<id>', DECLINE_MS, the no's own key), marked apply_silent (silence, not a no), their counts cleared. Never throws.
 */
async function standAside(id: number, programIds: string[], now: Date): Promise<void> {
  const at = now.toISOString();
  const declined = Object.fromEntries(programIds.map((p) => [benchStepKey('apply', p), at]));
  const silent = Object.fromEntries(programIds.map((p) => [p, at]));
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(jsonb_set(jsonb_set(COALESCE(standing_seen, '{}'::jsonb),
        '{declined}', COALESCE(standing_seen->'declined', '{}'::jsonb) || ${sql().json(declined as never)}::jsonb),
        '{apply_silent}', COALESCE(standing_seen->'apply_silent', '{}'::jsonb) || ${sql().json(silent as never)}::jsonb),
        '{apply_unanswered}', COALESCE(standing_seen->'apply_unanswered', '{}'::jsonb) - ${programIds}::text[])
    WHERE builder_id = ${id}`.catch(logged('apply aside'));
}
/** The apply ask's pick for a fit: its deadline's day ("Nov 18"), null when rolling. Pure. */
const applyPickOf = (f: Fit): ApplyPick & { repo?: string } =>
  ({ program_id: f.program_id, title: f.title, amount: f.amount, when: f.ends_at ? f.when.replace(/^closes /, '') : null, ...(f.repo && { repo: f.repo }) });
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
  const { view, fields } = await benchView({
    id, now, read, own, signedOut, personal: await personal(ctx).catch(() => false), name, fits, applies, nudge, cards: a.cards, upcoming: a.upcoming ?? [], skip, held, due, live,
    codesFetch: ctx.codesFetch, known, more: a.more,
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
  const news = view.rank ? recorded : null;
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
    show_to_builder: [signedIn, walletNews, opener, benchReply(view)].filter(Boolean).join('\n\n'),
    // O5 (P8): the earn note names lead.program_id, so only with a lead.
    note: [ANSWER_FIRST_NOTE, lead ? EARN_NOTE : null].filter(Boolean).join(' '),
    ...fields,
    // v4.2 Task 4 (F6): the lead is the money line's program (view.best, the applyCandidates pick), never a second rule.
    ...(leadFit && !submit && !taken && { lead: leadOf(view.best?.program_id ?? leadFit.program_id, leadFit) }),
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
  const { view, fields, stand } = await benchView({
    id, now, read, own, signedOut: await signedOutNow(id, own).catch(() => true), personal: await personal(ctx).catch(() => false), name: null, fits, applies, cards: shown, upcoming, skip, held: null,
    due: [], live, codesFetch: ctx.codesFetch, alwaysStanding: true,
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
    show_to_builder: [view.standingLed ? fields.standing : null, signedIn, walletNews, benchReply(view)].filter(Boolean).join('\n\n'),
    ...fields,
    note: [ANSWER_FIRST_NOTE, leadFit && view.variant !== 'taken' ? EARN_NOTE : null].filter(Boolean).join(' '),
    ...(leadFit && view.variant !== 'taken' && { lead: { program_id: view.best?.program_id ?? leadFit.program_id } }),
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
 * The builder's yes or no to the Bench's question (tools.ts moveUpAnswer routes it here). Only the ask stored with the last reply is answered; anything else is
 * "Okay." with nothing changed. A no is noted (standing_seen.declined) and clears the ask; the next reply asks its state's step again.
 */
export async function benchMoveUp(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'tokenDeps' | 'builderTokenDeps'>, m: { kind?: string; project_key?: string | null; answer: 'yes' | 'no'; live_url?: string; via?: 'coin' }): Promise<Reply> {
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
  // v4.7 T3 fix round 2 (R12): a yes or no to the apply ask answers it: its unanswered showings start again.
  if (asked.kind === 'apply' && asked.program_id) await resetApplyShown(id, asked.program_id);
  if (asked.kind === 'wallet') return afterStep3(id, await answerWallet(id, m.answer, now), now, ctx.ownInstallationId ?? id);
  if (asked.kind === 'wallet_setup') return afterStep3(id, await setupAnswer(ctx, id, m.answer, now), now, ctx.ownInstallationId ?? id);
  if (m.answer === 'no') {
    await sql()`
      UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
        COALESCE(standing_seen->'declined', '{}'::jsonb) || jsonb_build_object(${benchStepKey(asked.kind, asked.kind === 'apply' ? (asked.program_id ?? null) : asked.key)}::text, ${now.toISOString()}::text)) - 'bench_ask'
      WHERE builder_id = ${id}`.catch(logged('decline'));
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
      if (!asked.qualify?.steps?.length || !asked.key) return okay;
      await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{qualify_given}',
          COALESCE(standing_seen->'qualify_given', '{}'::jsonb) || jsonb_build_object(${asked.key.toLowerCase()}::text, ${now.toISOString()}::text))
        WHERE builder_id = ${id}`.catch(logged('qualify given'));
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
      // v4.2 (setup done, final review 3's own kind): the yes is find run again, to check which programs fit. v4.7.1 T1:
      // the ranked ask named an open grant (asked.program): the note adds reading its requirements.
      return { show_to_builder: '', agent_note: asked.program ? checkNeedsNote(asked.program) : CHECK_FITS_NOTE };
    case 'closest':
      // v4.2 (setup done, final review 3's own kind): the closest program's one step, never a draft.
      if (!asked.program || !asked.step) return okay;
      return {
        show_to_builder: `Your next step toward ${asked.program}: ${asked.step}.\n\n${QUALIFY_HELP_ASK_ONE}`,
        agent_note: (await agentReach(ctx.ownInstallationId ?? id, id)).hosted ? QUALIFY_STEPS_NOTE_HOSTED : QUALIFY_STEPS_NOTE,
      };
    case 'new_repo':
      return { show_to_builder: '', agent_note: NEW_REPO_YES_NOTE };
    case 'post':
      // v3.1 one-tap posts: a different version of the post (the next shape; the builder asked, so the asked limit holds).
      return (await redraftAnswer(id, asked as Parameters<typeof redraftAnswer>[1], now)) ?? okay;
    case 'outcome_share':
      // v4.0 Task 8 fix round 1: the yes to the accepted nudge's "Want to share it?": its post's one-tap link.
      return typeof asked.link === 'string' && /^https:\/\//.test(asked.link) ? { show_to_builder: outcomeShareLine(asked.link) } : okay;
    case 'apply': {
      // v4.2 Task 5: the closing-soon nudge's yes ("Your draft is ready. Want to send it?"): the entry's ready kit with its link.
      const ready = asked.program_id ? await readyDraft(id, asked.program_id).catch(() => null) : null;
      if (ready) return ready;
      // v3 Stage 2: prepare drafts the entry; the lead names the program (and the repo find matched). v4.7 T3: the yes is
      // kept (apply_yes), so money first never asks to draft it again.
      if (asked.program_id) await recordApplyYes(id, asked.program_id, now);
      return asked.program_id
        ? { show_to_builder: '', agent_note: APPLY_YES_NOTE(asked.program_id), lead: { program_id: asked.program_id, ...(asked.repo && { repo: asked.repo }) } }
        : okay;
    }
    default:
      // A retired ask (OLD_ASKS): nothing to do; the next reply asks the state's step.
      return okay;
  }
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
type SetupDone = { show_to_builder: string; move_up?: { kind: 'apply' | 'closest' | 'check_fits' | 'checkin'; project_key: string | null; agent_note: string; why?: string }; program_id?: string };
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
    const reply = (hint: string | null) =>
      setupDoneReply(settled.first, settled.outcome, setupRows(rows), noFitLine(g.name), { trade, closest, check: check ? (g.name ?? 'your project') : null, noAsk: !best && !closest && !check, hint });
    // Final review 6: claimed last, once the reply is built (a failure above leaves it for the next reply).
    if (!(await takeOnce(id, 'setup_done', now))) return null;
    // v4.7 T4: the first-run line, once (standing_seen.asks_hint), claimed with the reply that says it.
    const show = reply(!g.seen.asks_hint && (await takeOnce(id, 'asks_hint', now)) ? ASKS_HINT : null);
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
  if (asked?.kind === 'token' || (asked?.kind === 'wallet_setup' && (await tokenOffered(ctx.installationId))))
    return benchMoveUp(ctx, { kind: 'token', project_key: null, answer, via: 'coin' });
  return null;
}
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
