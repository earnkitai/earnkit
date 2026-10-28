import { sql } from './db';
import { noteEvent } from './events';
import { enqueueDiscovery } from './discovery';
import { ensureProfile } from './profiles';
import { listPrograms } from './programs';
import { openEntries } from './projects';
import { hiddenIds, hiddenPrograms, readMemory } from './builder-memory';
import { recordShown } from './match-loop';
import { REPO_KEY, benchConfirmedSql, rankRepo } from './main-project';
import { installLink, pickLink, proveCovered, repoProof } from './repo-proof';
import { REPLY_WAIT_MS, settleWithin } from './reply-wait';
import { rankLines, type RankLines } from './bench-rank';
import {
  COIN_LAUNCHING, COIN_LIVE, COIN_NOTE, COIN_NO_PUBLIC_NAME, approvedCodeWeek, askedCoinOffer, backingOffer, coinBlocked, coinOpen, coinPreview, coinWalletWaiting, openCoinLine,
} from './coin-moments';
import { UPDATE_LINES, setShipTitles, takeTitlesAsk, titlesAskDue } from './updates';
import { grantOf, qualifyOffer } from './base-qualify';
import { pillCoin, raisingCoin, showRaisingLine } from './raising';
import { backersOfCoin } from './backers';
import { earnedUsd } from './earned';
import { raisingEnabled } from './builder-score-flag';
import { NEEDS_LIVE_PRODUCT } from './guide';
import { signInLink } from './x-link';
import { xSignInEnabled } from './builder-score-flag';
import { outcomeLine } from './outcomes';
import { ANSWER_FIRST_NOTE, EARN_NOTE, NOTED_LINE, newsOpener } from './stand-text';
import {
  FITS_MAX, fundWhen, scoreFits, showable, standBase, startRefresh, takeNews,
  type Seen as StandSeen, type StandBase,
} from './stand-view';
import { byDeadline, byRelevance, canApply, enteredIds, layout, submitStep, submitStepLine, type Card, type FirstMessage, type RepoFit, type YourRepos } from './present';
import type { ReaderDeps } from './source-readers';
import type { TickerCheck } from './token-proposal';
import { NO_USERS_YET, creditsMainnet, type Detection } from './match';
import { refKey, reportedName } from './project-name';
import { noteIdentity, projectKeyOf, type IdentityProject } from './identity-input';
import type { ToolContext } from './tools';
import { CHAIN_NAMES, type Chain } from './chains';
import {
  APPLY_WINDOW_DAYS, BASE_START_ASK, CHECKIN_ON, NEXT_STEP_LATER, SHIP_ASK_DAYS, NEXT_STEP_ASK, STALE_WEEKS, STATE_COPY, TEMPLATE_NOTICE, TITLES_ASK, awardAmount, baseStartSteps, benchReply, COIN_WALLET_REASK, LOVABLE_PROMPT_ASK, NO_GITHUB_HINT, builtWith, liveNoGithub, namesAccount, benchStepKey, qualifySteps, rankedState, replyState, stateAsk, standingLine, walletOffer, walletSetupAsk, welcomeFits,
  TOKEN_NO_LINE,
  type ApplyPick, type FitBar, fitBar, keyName, type QualifyOffer, type QualifyStep, type BenchAskKind, type BenchProject, type BenchView, type BestFit, type ConnectOffer, type FundLine, type MomentView, type OpenGrant, type Variant,
} from './bench-reply';
import { liveSite, type LiveSite } from './live-check';
import { displayName, isStep2 } from './bench-reply';
import { targetIn, weeklyTarget } from './weekly-target';
import { APPROVED_LINE, SHARE_NOTE, answerShare, lastWeekOf, markOffered, momentDue, momentPlace, momentReady, openShare, takeMoment, weekNumber } from './weekly-moment';
import { isoWeekOf } from './weeks';
import { streaksFor } from './streak';
import {
  CONNECT_DONE, CONNECT_NOTE, CONNECT_RETRY, answerConnect, backfillComplete, closeConnect, connectApplyAsk, connectDue, connectWeeks, openConnect, pointsAddedLine,
  type ConnectBest,
} from './connect-moment';
import { connectOfferPoints, pointsTotal } from './points';
import { POST_NOTE, eventPost, redraftAnswer, weekPostReply, weeklyPost } from './post-reply';
import { EMAIL_NOTE, WHICH_EMAIL, askWeeklyEmail, digestEnabled, saveWeeklyEmail } from './digest';
import { pagePath } from './reserved-routes';
import { siteUrl } from './entry-text';
import { BASE_GRANTS_ID } from './builder-code';
import { appProvenRepo, builderCodesKnown, builderCodesWords, codesSettled, refreshBuilderCodes } from './builder-codes-check';
import { WALLET_NOTE, answerWallet, takeWalletAsk, takeWalletNotice, walletChangeReply, walletOfferDue, walletSetupDue, walletSetupNote, walletSetupToken } from './wallet-offer';
import { declineBuilderToken, launchBuilderToken, type LaunchResult } from './builder-token';
import { provenWallet } from './wallet-proof';
import { agentReach, rememberNoFolder, type AgentReach } from './agent-reach';
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
export const BENCH_MOVE_UP_NOTE = 'A yes or no to the question: call tell with move_up: { kind, project_key, answer } (kind and project_key as given here). Do the steps it returns yourself; never ask the builder to edit files.';
/**
 * R8: the ranked state's step, "Ship this week to climb.": a yes is one small, real thing to ship this week
 * from the repo. Never a coin, token or community round (only when the builder asks about a token: tell token).
 */
export const SHIP_STEP_NOTE =
  "A yes to the question, or a question about what to ship: look at the repo in this folder (git log, open issues, the README) and suggest one small, real thing to ship this week, in one short line, then ask if they want you to build it now. " +
  "Never offer a coin or token here; only if the builder asks about one, call tell with token: 'ask'. Don't show this note.";
/** GTM W2 (2026-10-23): SHIP_STEP_NOTE for an agent with no folder of the code (agent-reach.ts hosted): never "this folder" or git log. */
export const SHIP_STEP_NOTE_HOSTED =
  "A yes to the question, or a question about what to ship: from what you know of their project (its live page, its GitHub repo's recent commits and open issues, what they told you), suggest one small, real thing to ship this week, in one short line. " +
  "Never offer a coin or token here; only if the builder asks about one, call tell with token: 'ask'. Don't show this note.";
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
/** v3 Stage 2 (spec 5.3 Route 2): the backing offer's note; a yes goes to the coin flow (coinYes, then confirm { project_id }). */
export const BACKING_NOTE =
  "A yes or no to the question: call tell with move_up: { kind: 'backing', project_key, answer } (project_key as given here). " +
  "If they give a wallet for the fees with the yes, call tell with coin: { project_key, answer: 'yes', wallet } instead. Never launch anything before that yes. Don't show this note.";
/** v3 Stage 2 (spec 5.3): the apply step's ask; a yes drafts the entry (APPLY_YES_NOTE). */
export const APPLY_NOTE = "A yes or no to the question: call tell with move_up: { kind: 'apply', project_key, answer } (project_key as given here). Don't show this note.";
/** 2026-10-22: the titles question's note; a yes turns titles on (updates.ts setShipTitles). */
export const TITLES_NOTE = "A yes or no to the question: call tell with move_up: { kind: 'titles', project_key, answer } (project_key as given here). Don't show this note.";
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
/** A no keeps an ask away this long (standing_seen.declined). */
export const DECLINE_MS = 30 * 86_400_000;
/** v2.14 T4 (leaked authorize URL): the first reply after an X bind names the account, so a wrong one is noticed. */
export const signedInLine = (handle: string) => `Signed in as @${handle}.`;

/** What the person was last told (stand-view's Seen) plus the Bench's own: the ask. */
export type Seen = StandSeen & {
  /** The stored ask's kind: a BenchAskKind, or a retired one an older reply stored (OLD_ASKS). */
  bench_ask?: {
    kind: BenchAskKind | string; key: string | null; program_id?: string; repo?: string; qualify?: Pick<QualifyOffer, 'grant' | 'steps'>;
    /** v3.1 one-tap posts (kind 'post'): the post's code, its head line and its moment (post-reply.ts). */
    code?: string; head?: string; moment?: unknown;
    /** v3.1 wallet proof (kind 'wallet'): when the step was asked (ISO); its yes checks for a wallet proven since. */
    at?: string;
  };
  /** Fix round 1: when the qualify steps were given ({ [lowercase project key]: iso }); held back DECLINE_MS. */
  qualify_given?: Record<string, string>;
  /** v3 Stage 2: the programs the apply step was shown for ({ [program_id]: iso }): asked once a program. */
  apply_asked?: Record<string, string>;
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
  /** v3.1 cold read: the standing line last shown (name, rank and streak), so it is shown again only when it changed. */
  status_seen?: string;
  /** v3.1 cold read: the ISO week the shipping points line was last shown (at most once a week). */
  nag_week?: string;
  /** v3.1 cold read: the backers count last shown (the backing line comes back only when it grows). */
  backers_seen?: number;
  /** v3.1 cold read: a live app (no repo) whose builder said no to GitHub once: its tool's GitHub steps from then on. */
  github_no_app?: string;
  /** v3.1 cold read round 2: the agent was told to write the builder's Lovable prompt (the base_help yes). */
  lovable_prompt?: string;
  /** v3.1 cold read round 2: a coin yes waiting for its fee wallet (coin-moments.ts walletWait). */
  coin_wallet_wait?: string;
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

/** R8: tell token: 'ask' with no confirmed one project and no connect link to give (a statement). */
export const TOKEN_NOT_YET = 'Connect your code on GitHub first, then I can launch a coin for your app.';
/** v3.1 cold read (owner-approved): tell token: 'ask' before the code is connected: the connect link and one question. Pure. */
export const tokenConnectFirst = (name: string, link: string) =>
  `Connect your code first and I can launch a coin for ${name}. You'd keep 40% of its trading fees: ${link}\nDone?`;
/** v3.1 cold read (owner-approved): proven, but no week published yet: a yes publishes the weeks, then the coin offer. Pure. */
export const tokenPublishFirst = (symbol: string) =>
  `Your shipping log goes public first, then $${symbol} launches. You keep 40% of its trading fees. Do both?`;
/** v3.1 cold read: proven, but no week with shipped code to publish yet (honest, no jargon). */
export const TOKEN_NO_WEEK = 'A coin launches after a week of shipped code shows on your page. Ship something this week and ask me again.';
/** v3.1 cold read: proven, weeks shipped, but the shipping log isn't written up yet (the backfill after connecting). */
export const TOKEN_LOG_PENDING = "I'm still writing up your shipping log from your code. Ask me again in an hour and your coin can launch.";
/** R8: tell token: 'ask' when no coin can be offered for the project now and no plainer reason is known. */
export const tokenUnavailable = (name: string) => `A coin can't launch for ${name} right now.`;
export const tokenHasCoin = (name: string) => `${name} already has a coin.`;
/** v3.1 answerable replies (spec 2): a launched coin and its tokens.fun link, the token ask's first line. Pure. */
export const coinLinkLine = (symbol: string, url: string) => `$${symbol} is live: ${url}`;
/** v3.1 cold read (owner-approved): the backers question's answer, then the one post question. Pure. */
export const BACKERS_POST_ASK = 'Want a post about this week?';
export const backersLine = (backers: number, fees: number) =>
  backers === 0
    ? `No backers yet. Backers follow posts about real progress. ${BACKERS_POST_ASK}`
    : `${backers.toLocaleString('en-US')} ${backers === 1 ? 'backer' : 'backers'} and $${fees.toLocaleString('en-US')} in fees to you so far. ${BACKERS_POST_ASK}`;
/** v3 Stage 2 review: kept for older callers; v3.1 cold read: the token ask says TOKEN_NO_WEEK or the publish-first line instead. */
export const BACKING_NOT_YET = TOKEN_NO_WEEK;
/** The agent's note with the line to show backing for an old coin: the yes is tell coin { raising: true }. */
export const RAISE_NOTE = "A yes to the last line: call tell with coin: { raising: true }. Don't show this note.";
/** v3.1 cold read: the publish-first question's note (a yes publishes the weeks, then shows the coin offer; never a launch). */
export const COIN_PUBLISH_NOTE =
  "A yes or no to the question: call tell with move_up: { kind: 'coin_publish', project_key, answer } (project_key as given here). " +
  "A yes publishes their shipping log and then shows the coin offer; never launch anything before the builder says yes to that offer. Don't show this note.";
/** v3.1 cold read: the backers answer's note (a yes drafts a post about this week). */
export const BACKERS_POST_NOTE =
  "A yes or no to the question: call tell with move_up: { kind: 'backers_post', project_key, answer } (project_key as given here). Never post for the builder. Don't show this note.";
/** v3.1 cold read round 2: the fee wallet question's note (the wallet goes to tell coin, never a launch without it). */
export const COIN_WALLET_NOTE =
  "The builder's answer is the 0x wallet the coin's fees go to: call tell with coin: { project_key, answer: 'yes', wallet } (project_key as given here). " +
  "A no: call tell with move_up: { kind: 'coin_wallet', project_key, answer: 'no' }. Never ask them to sign anything here. Don't show this note.";
/** v3.1 cold read round 2: the token ask with no project yet; its question is the walk-through's Lovable prompt. */
export const TOKEN_BUILD_FIRST = "Build your app first and connect it here, then I can launch a coin for it. You'd keep 40% of its trading fees.";
/** v3.1 cold read: the connect-first answer's note. */
export const TOKEN_CONNECT_NOTE =
  "The builder connects their code from the link in show_to_builder. A yes or no: call tell with move_up: { kind, project_key, answer } (as given here). Once they connected it, call tell with token: 'ask' again. Don't show this note.";

/**
 * R8, v3.1 cold read: a builder asking about a coin (tell token: 'ask') always gets a path, never a dead end, never in
 * find's or score's default reply. Not connected: the connect link and what a coin pays (tokenConnectFirst). Connected
 * with a coin: its backers and fees, then a post question (backersLine); launching or live: says so. No coin can launch
 * at all: one honest line why (coin-moments.ts coinBlocked, COIN_NO_PUBLIC_NAME). Proven but no published week with
 * code: the publish-first question (a yes publishes the weeks, then the coin offer: benchMoveUp 'coin_publish'). Else the
 * coin offer (rewrite 4), again even after an earlier no (askedCoinOffer). The yes goes to tell coin as with any coin
 * offer, then confirm { project_id }. Never throws on its own reads.
 */
export async function tokenAsk(id: number, deps: { check?: TickerCheck } = {}): Promise<Reply> {
  const now = new Date();
  const [p] = await sql()<{ main: string | null }[]>`SELECT main_project_key AS main FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  const main = p?.main ?? null;
  const [row] = main
    ? await sql()<{ key: string; name: string; has_coin: boolean; confirmed: boolean }[]>`
        SELECT b.project_key AS key, b.name, b.has_coin, ${benchConfirmedSql(sql())} AS confirmed
        FROM builder_projects b WHERE b.builder_id = ${id} AND lower(b.project_key) = lower(${main})`.catch(() => [])
    : [];
  const given = main ? await reportedName(id, main) : null;
  if (!row?.confirmed && main === null) {
    // v3.1 cold read round 2: no project at all: build first; the one question is the Lovable prompt (no link).
    await storeAsk(id, { kind: 'base_help', key: null });
    return { show_to_builder: `${TOKEN_BUILD_FIRST}\n${LOVABLE_PROMPT_ASK}`, move_up: { kind: 'base_help', project_key: null, agent_note: BASE_HELP_NOTE } };
  }
  if (!row?.confirmed) {
    // Not connected: the connect link (the repo's own install link, else the picker) as the one link and question.
    const repo = main !== null && REPO_KEY.test(main.toLowerCase());
    const link = repo ? await installLink(id, main!, now).catch(logged('token install link')) : await pickLink(id, now).catch(logged('token pick link'));
    if (!link) return { show_to_builder: TOKEN_NOT_YET };
    const name = main ? (LINK_KEY.test(main) ? linkName(given) : displayName(given ?? row?.name ?? keyName(main), main, null)) : YOUR_APP;
    const kind = repo ? 'install_app' : 'pick_repo';
    await storeAsk(id, { kind, key: repo ? main : null });
    return { show_to_builder: tokenConnectFirst(name === YOUR_APP ? 'your app' : name, link), move_up: { kind, project_key: repo ? main : null, agent_note: TOKEN_CONNECT_NOTE } };
  }
  const name = displayName(given ?? row.name, row.key, null);
  const coin = await raisingCoin(id).catch(logged('token coin'));
  if (coin) {
    if (raisingEnabled() && coin.status === 'launched' && !coin.raising) return { show_to_builder: showRaisingLine(coin.symbol), agent_note: RAISE_NOTE };
    // GTM W2, v3.1 cold read: "Did anyone back it?" is answered with the backers and the fees, then one post question.
    // v3.1 answerable replies (spec 2): the live coin and its link lead ("$KIT is live: <tokens.fun>"), the one link.
    if (raisingEnabled() && coin.status === 'launched') {
      const [backers, earned] = await Promise.all([backersOfCoin(coin.coin).catch(() => null), earnedUsd(id).catch(() => null)]);
      if (backers !== null && earned !== null) {
        await storeAsk(id, { kind: 'backers_post', key: row.key });
        return {
          show_to_builder: `${coinLinkLine(coin.symbol, coin.url)}\n${backersLine(backers, Math.round(earned.fees_usd ?? 0))}`,
          move_up: { kind: 'backers_post', project_key: row.key, agent_note: BACKERS_POST_NOTE },
        };
      }
    }
    // Backing off (EARNKIT_RAISING): the page shows no coin, so neither does this line.
    return { show_to_builder: coin.status === 'launched' ? (raisingEnabled() && /^https:\/\//.test(coin.url) ? coinLinkLine(coin.symbol, coin.url) : COIN_LIVE) : COIN_LAUNCHING };
  }
  if (row.has_coin) return { show_to_builder: tokenHasCoin(name) };
  // v3.1 final fix 1 (D1): with EARNKIT_RAISING off confirm isn't registered, so no offer; v3.1 cold read: said plainly.
  const blocked = await coinBlocked(id, row.key);
  if (blocked) return { show_to_builder: blocked };
  if (!(await approvedCodeWeek(id, row.key).catch(() => false))) {
    const open = (await coinOpen(id, row.key).catch(() => false)) ? await openCoinLine(id, row.key, deps).catch(logged('token again')) : null;
    if (open) return { show_to_builder: open.line, coin: { project_key: row.key }, agent_note: COIN_NOTE };
    // Proven, no week published: one yes publishes the shipping log, then the coin offer follows (its own yes launches).
    const weeks = await connectWeeks(id, row.key, now).catch(logged('token weeks'));
    const pair = weeks?.length ? await coinPreview(id, row.key, deps) : null;
    // v3.1 cold read round 2: weeks shipped but not written up yet: written now from the App-proven commits (the
    // connect backfill), so the publish-first question works the same day.
    let open2 = weeks ?? [];
    if (open2.length === 0 && !(await backfillComplete(id, row.key, now).catch(() => true))) {
      await backfillNow(id, row.key, now);
      open2 = (await connectWeeks(id, row.key, now).catch(logged('token weeks'))) ?? [];
    }
    if (!open2.length) return { show_to_builder: (await backfillComplete(id, row.key, now).catch(() => true)) ? TOKEN_NO_WEEK : TOKEN_LOG_PENDING };
    const preview = pair ?? (await coinPreview(id, row.key, deps));
    if (!preview) return { show_to_builder: COIN_NO_PUBLIC_NAME };
    await openConnect(id, { key: row.key, weeks: open2.map((w) => w.monday) });
    await storeAsk(id, { kind: 'coin_publish', key: row.key });
    return { show_to_builder: tokenPublishFirst(preview.symbol), move_up: { kind: 'coin_publish', project_key: row.key, agent_note: COIN_PUBLISH_NOTE } };
  }
  const offer = await askedCoinOffer(id, row.key, deps);
  if (!offer) return { show_to_builder: (await coinPreview(id, row.key, deps)) ? tokenUnavailable(name) : COIN_NO_PUBLIC_NAME };
  return { show_to_builder: offer.line, coin: { project_key: row.key }, agent_note: COIN_NOTE };
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
  /** D14: the caller's own installation, the one an X sign-in link is minted for (never the group root). */
  own: number;
  /** Fix round 1: signedOutNow (state 1: the sign-in question always wins). */
  signedOut: boolean;
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
  /** The tokens.fun ticker check the backing offer's proposal uses (ToolContext.tokenDeps.check). */
  check?: TickerCheck;
  /** When the reply's wait ends (start + REPLY_WAIT_MS); the backing offer waits until then, at least BACKING_WAIT_MIN_MS. */
  deadline?: number;
  /** v3.1 Task 7: test injection only (ToolContext.codesFetch): the background Builder Codes check's fetch. */
  codesFetch?: typeof fetch;
  /** GTM W2: what the caller's agent can do (agent-reach.ts); read here when not given. */
  reach?: AgentReach;
  /** v3.1 cold read: score (the builder asked where they stand): the standing line is always shown. */
  alwaysStanding?: boolean;
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

/** v3 Stage 2 review: the backing offer (its tokens.fun ticker check) never holds a reply long; it gets at least this. */
export const BACKING_WAIT_MIN_MS = 1_000;
/**
 * The backing offer within the reply's wait. Past it, the reply goes on without the offer and the offer is told it is
 * late (set in the timer itself, before the race settles), so its moment is never claimed unshown. Never throws.
 */
async function boundedBacking(id: number, key: string, check: TickerCheck | undefined, deadline: number | undefined) {
  let late = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = Math.max(BACKING_WAIT_MIN_MS, (deadline ?? 0) - Date.now());
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      late = true;
      resolve(null);
    }, wait);
  });
  const offer = backingOffer(id, key, { check, late: () => late }).catch(logged('backing offer'));
  try {
    return await Promise.race([offer, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one view find and score share (F19), in one of the four states (R16a): the project, the rank and streak, the
 * money (the Best fit, the fits, backing, the upcoming program; the signed-out reply's open grant), the one link and the
 * one next step (with the connect offer or the weekly moment it needs), stored for its yes, and the fields every Bench
 * reply carries: move_up, rank_lines, streak.
 */
async function benchView(o: ViewIn): Promise<{ view: BenchView; fields: Reply }> {
  const { id, now, read } = o;
  const row = read.row;
  // v2.13.4: a live link that loads counts as live for wording and fit (R3), and names the project as its site does.
  const siteLive = o.live?.ok === true;
  const title = o.live?.ok ? o.live.title : null;
  // v3.1 GTM W3 (one name per project): the name the builder gave (this call's, else the stored identity's) wins over
  // the row's (written at the last rescore) and over the key's last part (never "Mealmate.lovable.app" for MealMate).
  const given = o.name ?? (row || read.main ? await reportedName(id, row?.key ?? read.main!) : null);
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
  const held = state === 'signed_out' ? null : o.held;
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
  // v4.0 setup step 3 (the wallet, and the token unless they say no): before every ranked ask, and on the no-GitHub path
  // after the walk-through offer. While it is due, no other ranked offer is opened (each one is claimed when made).
  const setupLink = !held && handle !== null && (ranked || githubNo) ? await walletSetupDue(id, now) : null;
  const walletSetup = setupLink
    ? { link: setupLink, project: ranked ? (project?.name ?? 'Your code') : null, token: await walletSetupToken(id) }
    : null;
  const rankedFree = ranked && !walletSetup;
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
  const best: BestFit | null = open[0]
    ? { program_id: open[0].program_id, title: open[0].title, amount: open[0].amount, when: open[0].when, why: open[0].why, codes, ...(open[0].bar && { bar: open[0].bar }) }
    : null;
  // v3 Stage 1 (spec 5.1): the connect weeks, once a person, before (and in place of) this reply's weekly moment.
  // Task 16: the Best fit rides on the offer, so its yes offers to draft it.
  const connect = rankedFree && project && handle && !held ? await connectMoment(id, project.key, now, open[0] ?? null) : null;
  // v3 Stage 2 (spec 5.3 Route 2): the backing offer, once a project, after the first approved week with code (EARNKIT_RAISING on).
  // GTM W2 (owner: no coin launched is the biggest revenue failure): right after connect, before the event post and the apply step.
  const backing = rankedFree && project && handle && !held && !connect ? await boundedBacking(id, project.key, o.check, o.deadline) : null;
  // v3.1 one-tap posts (design 6 ruling): went live or won, for 48 hours, before the apply step (a stale launch post is worthless).
  // v3.1 cold read round 2: a coin yes waiting for its fee wallet asks for it again, before anything else (and never the
  // wallet-proof step meanwhile).
  const coinWallet = Boolean(rankedFree && project && !held && !connect && !backing && (await coinWalletWaiting(id)) !== null);
  const hot = rankedFree && project && handle && !held && !connect && !backing && !coinWallet ? await eventPost(id, handle, now, { hot: true }) : null;
  // v3 Stage 2 (spec 5.3), v3.1 R1: the drafted application, once a program, before (and in place of) the weekly moment.
  const apply = !walletSetup && !connect && !hot && !backing && !coinWallet && open.length > 0 ? await claimApply(id, read.seen, open, now) : null;
  // Launch ready L6: the weekly moment, once a week per installation, never over a held question.
  const moment = rankedFree && project && handle && !held && !connect && !hot && !backing && !coinWallet && !apply ? await weeklyMoment(o.own, id, project.key, handle, row?.commit_weeks ?? [], now) : null;
  // v3.1 one-tap posts: the share slot between Mondays: an event's post (an announced win, going live, the coin's intro).
  const event = hot ?? (rankedFree && project && handle && !held && !connect && !backing && !coinWallet && !apply && !moment ? await eventPost(id, handle, now, { hot: false }) : null);
  // 2026-10-22: then a private repo's titles question (once a person), then, with no fit, Base's grant steps.
  const quiet = rankedFree && project !== null && !held && !connect && !backing && !coinWallet && !apply && !moment && !event;
  // v3.1 wallet proof: the optional wallet step, once a person, in the first quiet reply after setup (never with another
  // question); claimed below only once this reply carries it.
  // 2026-10-23 Base onboarding: after the GitHub no, the walk-through offer once (Base Builder Grants open: its last
  // step drafts that application), then the wallet step once.
  const baseAsk = githubNo && handle !== null && !read.seen.base_asked && !read.seen.base_walk && baseGrantOpen(o.cards, now, o.skip) && (await takeBaseAsk(id, now));
  // GTM W2: the Monday check-in, once, on a client that can schedule, in the first quiet reply after setup.
  const reach = o.reach ?? (await agentReach(o.own, id));
  const checkin = quiet && handle !== null && reach.schedules && !read.seen.checkin && checkinAskDue(read.seen, now) && (await takeCheckinAsk(id, now));
  const wallet = ((quiet && !checkin) || (githubNo && !baseAsk)) && handle !== null ? await walletOfferDue(id, now) : null;
  // 2026-10-23: a main project with no commits in STALE_WEEKS: one light nudge, claimed once.
  // Fix round: never within NEW_REPO_GRACE_DAYS of connecting it (its weeks may not be read yet).
  const newRepo = quiet && !checkin && !wallet && handle !== null && !read.seen.new_repo_asked && staleRepo(row?.commit_weeks ?? [], now)
    && !(await connectedSince(id, project.key, now)) && (await takeOnce(id, 'new_repo_asked', now));
  const titles = quiet && !checkin && !wallet && !newRepo && handle !== null && (await titlesAskDue(id, project.key, now)) && (await takeTitlesAsk(id, now));
  const qualify = quiet && !checkin && !wallet && !newRepo && !titles && realFits.length === 0
    ? await qualifyOffer(id, project.key, { cards: o.cards, skip: o.skip, seen: read.seen, now, declineMs: DECLINE_MS, codesFetch: o.codesFetch, known: o.known })
    : null;
  const link = state === 'signed_out' ? signIn : noCode ? pick : state === 'ranked' ? null : install;

  let fund: FundLine[] = [];
  // O2 fix round 1 (ruling 3): a repo another person holds is never offered a program for it. R12: only programs the
  // matcher fits, each with its deadline (Task 16: the reply names the first, after the Best fit).
  if (project && !taken) fund = realFits.slice(0, 3).map((f) => ({ kind: 'fits', title: f.title, amount: f.amount, when: f.when, ...(f.bar && { bar: f.bar }) }));


  // v3 Stage 2 (spec 5.2): Earned (fees claimed plus announced prizes), for the ranked standing line.
  const earned = ranked ? await earnedUsd(id, now).catch(logged('earned')) : null;
  // v3 Stage 2: backing open on the one project (pillOf: EARNKIT_RAISING on, launched, opened): a statement, never a step,
  // with its backers (backers.ts) and the creator fees claimed (earned.ts fees_usd).
  const pill = ranked && handle ? await pillCoin(id).catch(logged('backing pill')) : null;
  // v3.1 cold read: "Your coin $KIT is live. Your page: ..." only the first time it can be said (right after launch), then only when
  // backers grew since last shown ("2 new backers since you last looked."); the count shown is kept (backers_seen).
  let backersShown: number | null = null;
  if (ranked && handle && pill) {
    const backers = (await backersOfCoin(pill.coin).catch(logged('backers'))) ?? 0;
    const seenB = typeof read.seen.backers_seen === 'number' ? read.seen.backers_seen : null;
    if (seenB === null || backers > seenB) {
      fund = [...fund, { kind: 'backing', backers, earned_usd: Math.round(earned?.fees_usd ?? 0), page: `${siteUrl()}${pagePath(handle)}`, symbol: pill.symbol, ...(seenB !== null && { news: backers - seenB }) }];
      backersShown = backers;
    }
  }

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
  const asks = { state, variant, project, link, handle, share: Boolean(moment), connect, noGithub, walletSetup, backing: backing?.line ?? null, apply, titles, qualify, post: event, githubNo, baseAsk, newRepo, checkin, shipAsked, appDone, liveTool, walk, coinWallet };
  let finalAsk = stateAsk({ ...asks, wallet });
  // Fix round: the wallet step is claimed only when this reply carries it (another reply claimed it first: the ship step).
  if (finalAsk.kind === 'wallet' && !(await takeWalletAsk(id, now))) finalAsk = stateAsk({ ...asks, wallet: null });
  // v4.0: step 3 the same way (another reply claimed it first: this one asks the next step, or nothing).
  if (finalAsk.kind === 'wallet_setup' && !(await takeWalletAsk(id, now, true))) finalAsk = stateAsk({ ...asks, walletSetup: null, wallet: null });
  if (finalAsk.kind === 'ship' && !held) await sql()`
    UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('ship_asked', ${now.toISOString()}::text)
    WHERE builder_id = ${id}`.catch(logged('ship asked'));
  // Only the ask shown is answerable: a held question clears the stored one. (The share offer stays open all week in
  // standing_seen.share_open, weeklyMoment.)
  // v3.1 one-tap posts: an event's post stored its own ask (post-reply.ts: the moment, so a yes redrafts it).
  const stored = held || finalAsk.kind === 'post' || finalAsk.kind === 'none' ? null : {
    kind: finalAsk.kind, key: finalAsk.project_key,
    ...(apply && finalAsk.kind === 'apply' && { program_id: apply.program_id, ...(apply.repo && { repo: apply.repo }) }),
    ...(qualify && finalAsk.kind === 'qualify' && { program_id: qualify.program_id, qualify: { grant: qualify.grant, steps: qualify.steps } }),
    ...((finalAsk.kind === 'wallet' || finalAsk.kind === 'wallet_setup') && { at: now.toISOString() }),
  };
  if (finalAsk.kind !== 'post') await sql()`
    UPDATE builder_profiles SET standing_seen = CASE WHEN ${stored === null} THEN COALESCE(standing_seen, '{}'::jsonb) - 'bench_ask'
      ELSE COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(stored as never)}::jsonb) END
    WHERE builder_id = ${id}`.catch(logged('ask'));

  // 2026-10-23 (owner): a program that isn't open is never a reply line (nothing to do with it); it shows once it opens.

  const view: BenchView = {
    state, variant, project, rank: ranked ? read.ranks.bench : null, streak, target, earned: earned?.paid_usd ?? 0, handle, link, fund, due: o.due,
    // GTM W2 (value before the ask): the open grant also leads step 2 (no project, or a repo not counted yet).
    noGithub, ask: finalAsk, held, best: best && realFit(best) ? best : null, connect, moment, open: state !== 'ranked' ? openGrant(o.cards, now, o.skip) : null, qualify, post: event,
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
    const carries = held !== null || !['share', 'post'].includes(finalAsk.kind);
    view.standingShown = o.alwaysStanding === true || read.seen.status_seen !== standKey;
    const week = isoWeekOf(now);
    view.nagShown = read.seen.nag_week !== week;
    const nags = !held && view.nagShown && ['apply', 'ship', 'qualify', 'none'].includes(finalAsk.kind);
    const keep: Record<string, unknown> = {
      ...(carries && { status_seen: standKey }),
      ...(nags && { nag_week: week }),
      ...(backersShown !== null && { backers_seen: backersShown }),
    };
    if (Object.keys(keep).length > 0)
      await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || ${sql().json(keep as never)}::jsonb
        WHERE builder_id = ${id}`.catch(logged('shown lines'));
  }
  const note = finalAsk.kind === 'ship' ? (reach.hosted ? SHIP_STEP_NOTE_HOSTED : SHIP_STEP_NOTE) : finalAsk.kind === 'checkin' ? CHECKIN_NOTE : finalAsk.kind === 'share' ? SHARE_NOTE : finalAsk.kind === 'connect' ? CONNECT_NOTE : finalAsk.kind === 'backing' ? BACKING_NOTE : finalAsk.kind === 'apply' ? APPLY_NOTE
    : finalAsk.kind === 'start' ? START_NOTE : finalAsk.kind === 'pick_repo' ? PICK_REPO_NOTE
    : finalAsk.kind === 'install_app' ? INSTALL_APP_NOTE : finalAsk.kind === 'titles' ? TITLES_NOTE : finalAsk.kind === 'qualify' ? QUALIFY_NOTE
    : finalAsk.kind === 'post' ? POST_NOTE : finalAsk.kind === 'wallet' ? WALLET_NOTE : finalAsk.kind === 'wallet_setup' ? walletSetupNote(walletSetup?.token === true)
    : finalAsk.kind === 'base_start' ? BASE_START_NOTE
    : finalAsk.kind === 'next_step' ? NEXT_STEP_NOTE : finalAsk.kind === 'new_repo' ? NEW_REPO_NOTE
    : finalAsk.kind === 'base_help' ? BASE_HELP_NOTE : finalAsk.kind === 'coin_wallet' ? COIN_WALLET_NOTE : BENCH_MOVE_UP_NOTE;
  const fields: Reply = {
    ...(!held && finalAsk.kind !== 'none' && { move_up: { kind: finalAsk.kind, project_key: finalAsk.project_key, agent_note: note } }),
    rank_lines: ranked ? [read.ranks.bench, ...read.ranks.chains.map((c) => c.line)].filter((x): x is string => Boolean(x)) : [],
    streak,
    // Owner test 2026-10-23: "how many points do I have" had no fact to answer from (ANSWER_FIRST_NOTE).
    points_total: await pointsTotal(id).catch(() => null),
  };
  return { view, fields };
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
async function takeOnce(id: number, key: 'base_asked' | 'new_repo_asked' | 'welcomed', now: Date): Promise<boolean> {
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
  return { program_id: pick.program_id, title: pick.title, amount: pick.amount, when: pick.ends_at ? pick.when.replace(/^closes /, '') : null, ...(pick.repo && { repo: pick.repo }) };
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
 * v3 Stage 1 (spec 5.1), Task 16 step 3: the backfilled weeks to confirm and the points their yes adds
 * (points.ts connectOfferPoints), when this person hasn't been offered them (connectDue). Shown: the offer opens
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
  const points = await connectOfferPoints(id, mondays).catch(logged('connect points'));
  if (points === null) return null;
  const pick: ConnectBest | undefined = best
    ? { program_id: best.program_id, title: best.title, amount: best.amount, when: best.ends_at ? best.when.replace(/^closes /, '') : null, ...(best.repo && { repo: best.repo }) }
    : undefined;
  await openConnect(id, { key, weeks: mondays, ...(pick && { best: pick }) });
  return { weeks: weeks.length, points };
}

/** Owner batch fix wave: the summary the weekly moment may quote: no question mark and no link (one of each per reply). Pure. */
export const momentSummary = (s: string | null): string | null => (s && !/[?]|https?:\/\//i.test(s) ? s : null);

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
  const post = await weeklyPost(id, handle, week, now);
  return { week, place: momentPlace(last), rank: last.now.rank, summary: shown, post };
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

/**
 * find: the three parts in one of the four states (R16a), the one project's proof in the same turn
 * (plan B3) and news since the last look (a statement line above, no link and no question). A results
 * question or a submission step due is the reply's one question (A17). tools.ts adds ask_outcome, matches,
 * programs, working_on and wallet_note. Never a daily-check note.
 */
export async function benchFind(ctx: ToolContext, a: BenchFindArgs): Promise<Reply> {
  const id = ctx.installationId;
  const now = a.first.now;
  const own = ctx.ownInstallationId ?? id;
  const read = await coveredRead(id, own, now, await benchRead(id, own, now));
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
  const signedOut = a.signedOut ?? (await signedOutNow(id, own).catch(() => true));
  // Fix round 1: signed out, the sign-in question wins; the submission step waits for the bind too.
  const submit = a.ask || signedOut ? undefined : submitStep(m);
  // A17: a results question, else a submission step, is the one question (never a money line).
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
    id, now, read, own, signedOut, name, fits, applies, cards: a.cards, upcoming: a.upcoming ?? [], skip, held, due, live, check: ctx.tokenDeps?.check,
    deadline: (a.start ?? Date.now()) + REPLY_WAIT_MS, codesFetch: ctx.codesFetch, known,
  });
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
    ...(leadFit && !submit && !taken && { lead: { program_id: leadFit.program_id, repo: leadFit.repo } }),
    ...(submit && { lead: { program_id: submit.card.id, step: 'submit', ...(submit.entry.id !== undefined && { project_id: submit.entry.id }) } }),
  };
}

/**
 * score on the Bench: the profile (and a discovery run) on the first call, the refresh within
 * its budget, then find's view without a matcher: the one project's fits from what find last saw
 * (stand-view.ts scoreFits, at most 3, R12). One score_viewed event a minute (v2.12). Null without a
 * profile (score-tool.ts answers that).
 */
export async function benchScore(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'tokenDeps' | 'codesFetch'>, now: Date, o: { reader?: ReaderDeps } = {}): Promise<Reply | null> {
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
  const { view, fields } = await benchView({
    id, now, read, own, signedOut: await signedOutNow(id, own).catch(() => true), name: null, fits, applies, cards: shown, upcoming, skip, held: null,
    due: [], live, check: ctx.tokenDeps?.check, deadline: start + REPLY_WAIT_MS, codesFetch: ctx.codesFetch, alwaysStanding: true,
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
  return {
    show_to_builder: [signedIn, walletNews, benchReply(view)].filter(Boolean).join('\n\n'),
    ...fields,
    note: [ANSWER_FIRST_NOTE, leadFit && view.variant !== 'taken' ? EARN_NOTE : null].filter(Boolean).join(' '),
    ...(leadFit && view.variant !== 'taken' && { lead: { program_id: leadFit.program_id } }),
  };
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
 * "Ship this week to climb." (a token is offered only when the builder asks: tokenAsk).
 */
const OLD_ASKS = ['build', 'grants', 'grants_later', 'enter', 'coin', 'raise', 'go_live'] as const;
/** v2.14 spec 4: the asks answered once (cleared before the yes runs). */
const TAKEN_ONCE: readonly string[] = ['sign_in', 'start', 'pick_repo', 'install_app', 'other_project', 'repo_behind', 'ship', 'suggest', 'apply', 'backing', 'titles', 'qualify', 'post', 'new_repo', ...RETIRED_ASKS, ...OLD_ASKS];
/** Fix round: asks a tell with no `kind` is routed to by the stored question (their own paths below). */
const KINDLESS_ROUTED: readonly string[] = ['pick_repo', 'base_start', 'next_step', 'new_repo', 'base_help', 'checkin'];

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
 * The builder's yes or no to the Bench's question (tools.ts moveUpAnswer routes it here; an open coin
 * offer's answer stays there). Only the ask stored with the last reply is answered; anything else is
 * "Okay." with nothing changed. A no is noted (standing_seen.declined) and clears the ask; the next reply asks its state's step again.
 */
export async function benchMoveUp(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'tokenDeps' | 'builderTokenDeps'>, m: { kind?: string; project_key?: string | null; answer: 'yes' | 'no'; live_url?: string }): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  const okay = { show_to_builder: NOTED_LINE };
  // 2026-10-23 fix round: a tell with no kind answers the stored question when it is an onboarding one (so a kindless
  // no to step 2 is remembered and a kindless yes to the walk-through gives the steps).
  if (m.kind === undefined) {
    const stored = await benchAsked(id, { project_key: m.project_key });
    if (stored && KINDLESS_ROUTED.includes(stored.kind)) m = { ...m, kind: stored.kind };
  }
  // v3 Stage 1 (spec 5.1): the connect offer is answerable once (standing_seen.connect_open is its guard).
  if (m.kind === 'connect') {
    const before = await pointsTotal(id).catch(logged('connect points'));
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
    // Task 16 step 4: the points this yes added (the ledger before and after) and the total.
    const total = await pointsTotal(id).catch(logged('connect points'));
    const added = total !== null && before !== null ? total - before : 0;
    const points = added > 0 && total !== null ? pointsAddedLine(added, total) : null;
    const done = p?.handle ? CONNECT_DONE(`${siteUrl()}${pagePath(p.handle)}`) : APPROVED_CONNECT;
    // GTM W2 (owner: no coin launched is the biggest revenue failure): the weeks just approved prove the builder, so the
    // backing offer comes here, the first reply after it, above the draft (EARNKIT_RAISING on, every coin gate kept).
    const backing = p?.handle ? await connectBacking(ctx, id, m.project_key ?? null) : null;
    if (backing) return { show_to_builder: [done, backing.line, points].filter(Boolean).join('\n'), move_up: backing.move_up };
    // Task 16 step 4: the Best fit the offer named is offered as a draft (the apply ask, once a program), else the email question.
    const apply = r.best && p?.handle ? await connectApply(id, r.best, m.project_key ?? null, now) : null;
    if (apply) return { show_to_builder: [done, apply.line, points].filter(Boolean).join('\n'), move_up: apply.move_up };
    // 2026-10-22: a private repo with titles off hears the titles question here, once (before the email question).
    const titles = p?.handle ? await connectTitles(id, m.project_key ?? null, now) : null;
    if (titles) return { show_to_builder: [done, TITLES_ASK, points].filter(Boolean).join('\n'), move_up: titles };
    // The You're live line is a statement, so the email question (when it is asked) is the reply's one question.
    const email = digestEnabled() ? await askWeeklyEmail(id, { shared: false, email: null }).catch(logged('connect email')) : null;
    return { show_to_builder: [done, email?.question, points].filter(Boolean).join('\n'), ...(email && emailMoveUp(m.project_key ?? null)) };
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
  if (m.kind === 'wallet') return answerWallet(id, m.answer, now);
  // v4.0 setup step 3: "done" is the wallet's yes; a plain no is a no to the token (the copy's "Just say no"), else
  // (no token sentence shown) a skip of the wallet.
  if (m.kind === 'wallet_setup') {
    if (m.answer === 'yes') return answerWallet(id, 'yes', now);
    return (await walletSetupToken(id)) ? tokenAnswer(ctx, id, 'no', now) : answerWallet(id, 'no', now);
  }
  // v4.0: the builder said no to their token (kept forever), or asked to launch it.
  if (m.kind === 'token') return tokenAnswer(ctx, id, m.answer, now);
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
  // v3.1 cold read: the coin ask's publish-first question and the backers answer's post question.
  if (m.kind === 'coin_publish') return coinPublishAnswer(ctx, id, m.project_key ?? null, m.answer, now);
  if (m.kind === 'backers_post') return backersPostAnswer(id, m.answer, now);
  // v3.1 cold read round 2: the fee wallet is given with tell coin; a bare yes asks for it again, a no closes the offer.
  if (m.kind === 'coin_wallet') {
    const key = await coinWalletWaiting(id);
    if (!key) return { show_to_builder: NOTED_LINE };
    if (m.answer === 'no') return (await import('./tools')).coinAnswer(ctx, { project_key: key, answer: 'no' });
    return { show_to_builder: COIN_WALLET_REASK, move_up: { kind: 'coin_wallet', project_key: key, agent_note: COIN_WALLET_NOTE } };
  }
  if (m.kind === 'weekly_email') return emailAnswer(id, m.answer);
  const asked = await benchAsked(id, m);
  if (!asked) return okay;
  if (asked.kind === 'wallet' || asked.kind === 'wallet_setup') return answerWallet(id, m.answer, now);
  // v3 Stage 2 (spec 5.3 Route 2): the backing offer is the coin offer's (coinAnswer): a yes is the coin flow's note
  // (confirm { project_id }), a no is remembered on coin_moments and counts toward DECLINES_MAX. Answered once.
  if (asked.kind === 'backing') {
    const [taken] = await sql()`
      UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask'
      WHERE builder_id = ${id} AND standing_seen->'bench_ask' = ${sql().json(asked as never)}::jsonb RETURNING 1`.catch((err: unknown) => {
      logged('take backing ask')(err);
      return [];
    });
    if (!taken || !asked.key) return okay;
    return (await import('./tools')).coinAnswer(ctx, { project_key: asked.key, answer: m.answer });
  }
  if (m.answer === 'no') {
    await sql()`
      UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
        COALESCE(standing_seen->'declined', '{}'::jsonb) || jsonb_build_object(${benchStepKey(asked.kind, asked.kind === 'apply' ? (asked.program_id ?? null) : asked.key)}::text, ${now.toISOString()}::text)) - 'bench_ask'
      WHERE builder_id = ${id}`.catch(logged('decline'));
    return okay;
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
    case 'qualify':
      // 2026-10-22: the steps the question was asked with (the program's rules, the ones not known met). Fix round 1:
      // the yes is remembered (qualify_given), so the next replies move on to the ship step for DECLINE_MS.
      if (!asked.qualify?.steps?.length || !asked.key) return okay;
      await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{qualify_given}',
          COALESCE(standing_seen->'qualify_given', '{}'::jsonb) || jsonb_build_object(${asked.key.toLowerCase()}::text, ${now.toISOString()}::text))
        WHERE builder_id = ${id}`.catch(logged('qualify given'));
      return {
        show_to_builder: qualifySteps(asked.qualify.grant, asked.qualify.steps as QualifyStep[]),
        agent_note: (await agentReach(ctx.ownInstallationId ?? id, id)).hosted ? QUALIFY_STEPS_NOTE_HOSTED : QUALIFY_STEPS_NOTE,
      };
    case 'new_repo':
      return { show_to_builder: '', agent_note: NEW_REPO_YES_NOTE };
    case 'post':
      // v3.1 one-tap posts: a different version of the post (the next shape; the builder asked, so the asked limit holds).
      return (await redraftAnswer(id, asked as Parameters<typeof redraftAnswer>[1], now)) ?? okay;
    case 'apply':
      // v3 Stage 2: prepare drafts the entry; the lead names the program (and the repo find matched).
      return asked.program_id
        ? { show_to_builder: '', agent_note: APPLY_YES_NOTE(asked.program_id), lead: { program_id: asked.program_id, ...(asked.repo && { repo: asked.repo }) } }
        : okay;
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
    const token = await walletSetupToken(id);
    if (!(await takeWalletAsk(id, now, true))) return null;
    await storeAsk(id, { kind: 'wallet_setup', key: null, at: now.toISOString() });
    return { show_to_builder: walletSetupAsk(null, setup, token), move_up: { kind: 'wallet_setup', project_key: null, agent_note: walletSetupNote(token) } };
  }
  const link = await walletOfferDue(id, now);
  if (!link || !(await takeWalletAsk(id, now))) return null;
  await storeAsk(id, { kind: 'wallet', key: null, at: now.toISOString() });
  return { show_to_builder: walletOffer(link), move_up: { kind: 'wallet', project_key: null, agent_note: WALLET_NOTE } };
}

/** v4.0 "launch my token": each launch result in plain words (never "coin"). */
export const TOKEN_LIVE = 'Done. Your token is live.';
export const TOKEN_ALREADY_LIVE = 'Your token is already live.';
export const TOKEN_ON_ITS_WAY = "Your token is on its way. I'll confirm it here soon.";
export const TOKEN_STAYS_OFF = 'Your token stays off, like you asked.';
export const TOKEN_TRY_LATER = "That didn't go through this time. Ask me again in a few minutes.";
export const TOKEN_CANT = "I can't set up a token for this account. Reach out at j@earnkit.com.";
/** v4.0: a launch result's reply line (null: not ready, the caller decides). Pure. */
export function tokenLine(r: LaunchResult): string | null {
  switch (r.result) {
    case 'launched': return TOKEN_LIVE;
    case 'exists': return r.status === 'launched' ? TOKEN_ALREADY_LIVE : r.status === 'declined' ? TOKEN_STAYS_OFF : TOKEN_ON_ITS_WAY;
    case 'unknown': return TOKEN_ON_ITS_WAY;
    case 'busy': case 'ticker_check_down': case 'released': return TOKEN_TRY_LATER;
    case 'x_taken': case 'no_ticker': return TOKEN_CANT;
    case 'off': return NOTED_LINE;
    case 'not_ready': return null;
  }
}
/**
 * v4.0: tell move_up kind 'token'. A no is kept forever (declineBuilderToken; a token already on its way or live is
 * unchanged, and said so). A yes launches it now (launchBuilderToken, idempotent); without a reward wallet yet, the
 * wallet link (walletChangeReply). Never throws.
 */
async function tokenAnswer(ctx: Pick<ToolContext, 'builderTokenDeps'>, id: number, answer: 'yes' | 'no', now: Date): Promise<Reply> {
  try {
    if (answer === 'no') {
      const r = await declineBuilderToken(id);
      return { show_to_builder: r === 'launched' ? TOKEN_ALREADY_LIVE : r === 'launching' || r === 'unknown' ? TOKEN_ON_ITS_WAY : TOKEN_NO_LINE };
    }
    const r = await launchBuilderToken(id, ctx.builderTokenDeps ?? {});
    const line = tokenLine(r);
    if (line) return { show_to_builder: line };
    if (!(await provenWallet(id))) return walletChangeReply(id, now);
    return { show_to_builder: TOKEN_TRY_LATER };
  } catch (err) {
    logged('token answer')(err);
    return { show_to_builder: TOKEN_TRY_LATER };
  }
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
 * GTM W2: the backing offer in the connect yes's reply (the first reply after the builder is proven with an approved code
 * week), stored as the Bench's ask so its yes is the coin flow's. Null when backingOffer is (every coin gate kept). Never throws.
 */
async function connectBacking(ctx: Pick<ToolContext, 'tokenDeps'>, id: number, key: string | null): Promise<{ line: string; move_up: Reply } | null> {
  const [p] = await sql()<{ key: string | null }[]>`SELECT main_project_key AS key FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  const projectKey = key ?? p?.key ?? null;
  if (!projectKey) return null;
  const offer = await boundedBacking(id, projectKey, ctx.tokenDeps?.check, Date.now() + REPLY_WAIT_MS);
  if (!offer) return null;
  await storeAsk(id, { kind: 'backing', key: projectKey });
  return { line: offer.line, move_up: { kind: 'backing', project_key: projectKey, agent_note: BACKING_NOTE } };
}

/**
 * v3.1 cold read (owner-approved): the yes to "Your shipping log goes public first, then $X launches. ... Do both?": the
 * weeks are published (the connect yes, answerConnect), then the coin offer (rewrite 4) with its own question, so nothing
 * launches before that yes; every coin gate holds (connectBacking, backingOffer). A no, or nothing open: "Okay.". Never throws.
 */
async function coinPublishAnswer(ctx: Pick<ToolContext, 'tokenDeps'>, id: number, key: string | null, answer: 'yes' | 'no', now: Date): Promise<Reply> {
  const asked = await benchAsked(id, { kind: 'coin_publish', project_key: key });
  if (!asked) return { show_to_builder: NOTED_LINE };
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'coin_publish'`.catch(logged('coin publish ask'));
  if (answer === 'no') {
    await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'connect_open' WHERE builder_id = ${id}`.catch(logged('coin publish no'));
    return { show_to_builder: NOTED_LINE };
  }
  const before = await pointsTotal(id).catch(logged('coin publish points'));
  const r = await answerConnect(id, asked.key, 'yes', now).catch(logged('coin publish'));
  if (!r || r.approved === 0) return { show_to_builder: CONNECT_RETRY.replace(/ Want me to try again\?$/, ''), agent_note: "Call tell with token: 'ask' again later. Don't show this note." };
  const [p] = await sql()<{ handle: string | null }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  const total = await pointsTotal(id).catch(logged('coin publish points'));
  const added = total !== null && before !== null ? total - before : 0;
  const points = added > 0 && total !== null ? pointsAddedLine(added, total) : null;
  const done = p?.handle ? CONNECT_DONE(`${siteUrl()}${pagePath(p.handle)}`) : APPROVED_CONNECT;
  const offer = await askedCoinOffer(id, asked.key ?? '', { check: ctx.tokenDeps?.check });
  if (!offer || !asked.key) return { show_to_builder: [done, points].filter(Boolean).join('\n') };
  await storeAsk(id, { kind: 'backing', key: asked.key });
  return { show_to_builder: [done, offer.line, points].filter(Boolean).join('\n'), move_up: { kind: 'backing', project_key: asked.key, agent_note: BACKING_NOTE } };
}

/** v3.1 cold read: a yes to the post question with no week to post: the agent asks for the builder's news (tell update). */
export const BACKERS_NEWS_NOTE =
  "Ask the builder in one short question what they shipped or learned this week, then call tell with update: { text } in their own words. Don't show this note.";
/**
 * v3.1 cold read (owner-approved): the yes to "Want a post about this week?" after the backers answer: last week's post
 * (post-reply.ts weekPostReply, asked by the builder) with its one-tap link, else the agent asks for their news (tell
 * update drafts it as today). A no: "Okay.". Never throws.
 */
async function backersPostAnswer(id: number, answer: 'yes' | 'no', now: Date): Promise<Reply> {
  const [p] = await sql()<{ ask: Seen['bench_ask'] | null }[]>`SELECT standing_seen->'bench_ask' AS ask FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  if (p?.ask?.kind !== 'backers_post') return { show_to_builder: NOTED_LINE };
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'backers_post'`.catch(logged('backers post ask'));
  if (answer === 'no') return { show_to_builder: NOTED_LINE };
  return (await weekPostReply(id, now)) ?? { show_to_builder: '', agent_note: BACKERS_NEWS_NOTE };
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
  const given = await reportedName(id, p.main);
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
