import { z } from 'zod';
import { yesNo } from './yes-no';
import { hasRealUse, oddsRank, rowOdds } from './match';
import { NotFoundError, alsoProgramFacts, getProgram, getProgramRow, isOpen, listPrograms } from './programs';
import { guideText, programGuide } from './guide';
import {
  RecordSubmissionInput,
  recordSubmission,
  answersOf,
  enteredProgramIds,
  hasProgramEntry,
  openEntries,
  ownEntryWallet,
  startEntry,
  submittedEntry,
  launchEntry,
  type EntryDeps,
} from './projects';
import { EntryError, githubRepo, givenWallet, isWalletAddress, normalizeRepoUrl, presentYourEntries } from './campaigns';
import { signToEnter } from './entry-proof';
import { confirmTable, enteredText, noCoinYet, prizeOf, todoOf, type EnteredText } from './entry-text';
import { proposeToken, repoNameOf, titleCase, tokensFunTickerCheck, type TickerCheck } from './token-proposal';
import { DECLINES_MAX, declines, firstReplyShown, offerIdentity, offerKey, readOffer, readShownOffer, recordDecline, saveOffer, type Offered } from './token-offers';
import { earnkitCampaignRows, yourCampaignEntries } from './leaderboard';
import {
  checkPrograms,
  rememberWallets,
  rememberedWallet,
  localRepoContracts,
  readFitRepos,
  setFitRepos,
  setWorkingOn,
  markFreshOffer,
  readBuild,
  rememberWallet,
  saveBuild,
  type StoredBuild,
} from './installations';
import { recordShown, saveEntryScore } from './match-loop';
import { repoKey, repoKey as saidKeyOf } from './answer-bank';
import { outcomeQuestion, outcomeToAsk } from './outcomes';
import { wonSource } from './stats';
import { EMAIL_SHARED_NOTE, EMAIL_SIGN_IN, WHICH_EMAIL, askWeeklyEmail, cleanEmail, entryEmail, saveWeeklyEmail } from './digest';
import { TellInput, emptyMemory, hiddenIds, hiddenPrograms, memoryKey, readMemory, saidKey, tell, type BuilderMemory, type MemoryKey, type SaidRepo } from './builder-memory';
import { fitRepoOf, newProgramOf, openCuratedRows, repoCanWin, sinceLine, sinceYouLastChecked, takeDeadlineLine, type DeadlineEntry, type FitRepo } from './alerts';
import {
  GitHubError,
  MatchProjectsInput,
  LocalReposInput,
  reportedGithubUser,
  reportedRepos,
  cachedRepoChains,
  cachedRepoAddresses,
  checkEligibility,
  matchProjects,
  type MatchDeps,
} from './match-projects';
import { alsoQualifies, alsoText, type AlsoRow } from './also-qualifies';
import {
  bonusLine,
  bonusProgramIds,
  closesInDays,
  enterableWithoutRepo,
  layout,
  leadRow,
  qualifies,
  enteredIds,
  submitStep,
  submitStepLine,
  usersAsk,
  presentFirstMessage,
  programUpdates,
  freshLead,
  type FirstMessage,
  type FreshOn,
  type RepoFit,
  type YourRepos,
} from './present';
import {
  ProjectInfo,
  rememberedWalletQuestion,
  prepareSubmission,
} from './submission';
import { OWNERSHIP_FILE } from './ownership';
import { DEPLOY_LINES, DEPLOY_PENDING, deployChainOn, deployChains, deployEnabled, deployForBuilder, deployOffLine, deployOffNote, deployedLine, initcode, settlePendingDeploy, type DeployChainName, type DeployDeps, type DeployInput } from './deploy';
import { decodeAbiParameters, isHex, keccak256, type Abi } from 'viem';
import {
  CANT_PUSH_RETRY_NOTE,
  STILL_CHECKING_LAUNCH,
  LaunchTokenInput,
  editsOf,
  SKIPPED_ENTRY,
  confirmToken,
  hasBuilderBonus,
  launchReplyMs,
  launchToken,
  pendingOutcome,
  submissionToken,
  tokenProposalBlock,
  type TokenFlowDeps,
} from './token-launch';
import { RAW_CAP, canonicalBuilderUrl, cleanProject, quoted } from './untrusted-text';
import { pagesLinkOf } from './pages-link';
import { proveRepo, proveRepoByBranch, repoSignedIn, tokenLineFor, type ProvenRepo } from './token-gate';
import { PUSH_DONE_NOTE, PUSH_REFUSED_NOTE, branchToRemove, checkProofBranch, proofBranchFor, pushRefused } from './proof-branch';
import { READY_TO_SUBMIT, confirmDecision, confirmOffer, proofLineWaiting, signInLine, walletQuestion, NO_TOKEN_HERE, NO_WALLET_HINT, TOKEN_ERROR_CONFIRM } from './confirm';
import { HOST_LINES, HOST_ZONE, UPLOAD_NOTE, hostSignInLine, issueUpload, liveLine, refreshSiteExpiry } from './hosting';
import { r2Enabled } from './r2';
import { EARNKIT_ORGS } from './earnkit-orgs';
import {
  BENCH_BUILD_ID,
  BUILD_CHAT_ONLY,
  benchStarter,
  buildCheck,
  buildFix,
  buildKit,
  benchBuildingLine,
  buildingLine,
  freshPick,
  publicTestWallet,
  twistQuestion,
  type BuildFields,
  type FreshPick,
} from './fresh-build';
import { callerLogin, createVerifyLink, entryVerifyLink, githubVerifyEnabled, installationLogin, loginBasisFor, noteLineIssued, provenOwnerLogin, verifiedEntryIds } from './github-verify';
import { appTokenFor, githubAppEnabled, hasAppProof } from './github-app';
import { PROOF_LINE_PREFIX, SIGN_IN_FIRST, WALLET_CHANGED } from './token-gate';
import { kitReplyNote, submitKit, type SubmitKit } from './submit-kit';
import {
  WALLET_KEY,
  applicationOf,
  bankFill,
  coachFields,
  coachIntro,
  derivedDescription,
  derivedProfile,
  draftTable,
  fixesLine,
  askableKeys,
  PLAIN_NOTE,
  preSubmitCheck,
  questionsFor,
  type Fix,
} from './coach';
import { LIVE_FAILED_LINE, addressesFrom, contractMissingLine, entryVerified, liveCheckDetail, liveErrorLine, rpcFor, type CheckDeps, type Verified } from './verify';
import { noteEvent } from './events';
import { benchEnabled, builderScoreEnabled, raisingEnabled } from './builder-score-flag';
import { hideUpdate, postUpdate, setUpdates } from './updates';
import { enqueueDiscovery, localGitInput } from './discovery';
import { benchIdentity, benchProject, identityInput, noteIdentity, projectKeyOf } from './identity-input';
import { CONFIRMING_REFRESH_MS, REPO_KEY, confirmingFast, dropMainProject, fillGithubUser, mainProjectOf, setMainProject } from './main-project';
import { BENCH_MOVE_UP_NOTE, benchAsked, benchFind, benchMoveUp, keepBenchMatch, keptBenchMatch } from './bench-find';
import { REPLY_WAIT_MS, ReplyLate, inTime } from './reply-wait';
import { setRaising } from './raising';
import { SEND_LINK_NOTE, scoreReply } from './score-tool';
import { EARN_NOTE, MOVE_UP_NOTE, chooseStep, placeBuild, newsOpener, stepKey, whereYouStand, type EarnLine, type MoveUp, type StandView } from './where-you-stand';
import { confirmYes, earnPrize, earnWhen, hostFor, moneyFallback, standBase, startRefresh, takeNews, takePageReady, type Seen } from './stand-view';
import { COUNT_LINES, moveUpNo, moveUpYes, stepFor } from './make-countable';
import { attributionFor, chainOf } from './attribution';
import type { ReaderDeps } from './source-readers';
import { SKIPPED_LINE, cardYes } from './share';
import { SHARED_PROFILE_NOTE, ensureProfile, setFallback, setHidden } from './profiles';
import { verifiedProject } from './builder-score';
import { COIN_NOTE, COIN_PROGRAM, builtLiveAnswer, coinLine, coinNo, coinOfferable, coinOpen, coinPitchAllowed, coinYes, offerCoin, showBuiltLive } from './coin-moments';
import { sql } from './db';
import { projectKey, readBank, saveApplication, saveBank } from './answer-bank';
import { PROBATION_LINES, onProbation } from './page-joins';
import { JOIN_TEXT, answerJoin, joinQuestion, answerPickup, askJoin, offerPickup, pendingJoinOf, type PickupDeps } from './identity';
import type { FieldKind } from './program-file';
import type { ProgramRow } from './programs';
import { RateLimitError, enforce } from './rate-limit';
import { roundPools as readRoundPools, type RoundPool } from './bonus-rounds';
import { LAUNCHING, NOT_LAUNCHED_YET, REPO_HAS_TOKEN, launchClaimedAt, repoCoinPrograms, tokenLaunchesAvailable, type TokenOutcome } from './tokens';

/** Who is calling: the installation behind the MCP connection. */
export type ToolContext = {
  /** v2.8.1 §E18: the installation the tools act as (a linked installation's group root). */
  installationId: number;
  /** v2.8.1 §E18: the token's own installation (the pickup offer's); defaults to installationId. */
  ownInstallationId?: number;
  /**
   * v2.8.1 §E17: the token's installation came from a hosted agent client: saved answers are reused
   * only after a yes/no that names them, and the remembered wallet is never suggested.
   */
  sharedClient?: boolean;
  /**
   * v2.9 B9, Rulings G6/G7: on a shared client, the GitHub-verified login this call is from
   * (github-verify.ts callerLogin), set by the tool that reads it; never set by the MCP route.
   */
  verifiedLogin?: string | null;
  /** Test injection only: the pickup's proof line reads. */
  pickupDeps?: PickupDeps;
  /** Test and e2e injection only; never set by the MCP route. */
  tokenDeps?: TokenFlowDeps;
  /** Test and e2e injection only; never set by the MCP route. */
  entryDeps?: EntryDeps;
  /**
   * Test seam: the open rounds' builder bonus pools and token counts, by program id (null: the
   * program's round froze); defaults to bonus-rounds.ts roundPools.
   */
  roundPools?: (programIds: string[]) => Promise<Map<string, RoundPool | null>>;
  /** Ruling 25: the program each normalized repo's coin is entered in; defaults to repoCoinPrograms. */
  repoCoins?: (repoKeys: string[]) => Promise<Map<string, { program_id: string; title: string }>>;
  /** Test and e2e injection only; never set by the MCP route. */
  matchProjects?: (
    input: z.infer<typeof MatchProjectsInput>,
    deps?: Pick<MatchDeps, 'appToken'>,
  ) => Promise<Exclude<YourRepos, { error: string }>>;
  /** v2.9 A5: test injection only: the link probe, getCode and cache for the entry checks. */
  verifyDeps?: CheckDeps;
  /** v2.10 item 13: test injection only: the deployer's chain, price and proof reads. */
  deployDeps?: DeployDeps;
  /**
   * v2.11 T7: test injection only: the no-repo lead's switches (deploys on a chain, hosting) and the
   * starter registry; each defaults to the real one (freshSwitches).
   */
  freshDeps?: Partial<Pick<FreshOn, 'deployOn' | 'hostOn' | 'starters'>>;
  /** v2.12.1 T8: test injection only: the on-demand refresh's readers (person-score.ts refreshPerson). */
  readerDeps?: ReaderDeps;
  /** v2.13.1 O1: test injection only: the proof branch's GitHub reads (proof-branch.ts checkProofBranch). */
  proofBranchFetch?: typeof fetch;
  /**
   * v2.13.4 R7: the caller's own installation joined this page by R1 under 24 hours ago: it may only post
   * updates (page-joins.ts). Set by the builder tools (withProbation); never by the MCP route.
   */
  probation?: boolean;
};

/** v2.13.4 R7: the context with `probation` filled (Bench only). Never throws (R8: a failed read is probation). */
export async function withProbation(ctx: ToolContext): Promise<ToolContext> {
  if (!benchEnabled() || ctx.probation !== undefined) return ctx;
  const own = ctx.ownInstallationId ?? ctx.installationId;
  // v2.13.4 R8 (2): fails CLOSED: a failed read counts as probation.
  return { ...ctx, probation: own !== ctx.installationId && (await onProbation(own).catch(() => true)) };
}

/** v2.13.4 R7: a write refused on probation: one line, then one question whose yes is this week's update. */
async function probationReply(ctx: ToolContext, kind: 'main' | 'write'): Promise<Reply> {
  const main = await mainProjectOf(ctx.installationId).catch(() => null);
  return { show_to_builder: PROBATION_LINES[kind], ...(main && { move_up: { kind: 'post_update', project_key: main, agent_note: BENCH_MOVE_UP_NOTE } }) };
}

/**
 * v2.11 T7: the no-repo lead's switches. Deploys on a chain need the deployer key, the chain in
 * DEPLOY_CHAINS (deployChainOn, v2.10.3: a chain left out is never offered) and the chain's RPC;
 * hosting needs R2. Production has neither on 2026-10-10, so no fresh lead is
 * offered until the owner turns both on. A chat-only or shared client gets the chat-only lead (a
 * shared client never gets the build path, Ruling S6).
 */
export function freshSwitches(ctx: Pick<ToolContext, 'freshDeps' | 'sharedClient'>, agentCanBuild: boolean): FreshOn {
  const d = ctx.freshDeps ?? {};
  return {
    deployOn: d.deployOn ?? ((c) => deployChainOn(c) && rpcFor(c) !== null),
    hostOn: d.hostOn ?? r2Enabled(),
    canBuild: agentCanBuild && !ctx.sharedClient,
    ...(d.starters && { starters: d.starters }),
  };
}

/**
 * v2.9 A5: one entry step's link and contract checks (one ENTRY_BUDGET), or undefined for an
 * EarnKit campaign (checked at entry its own way) or when there is no live link to check and no
 * required item filled from live_url. The live link is the answer to that item, else the
 * project's. Never throws.
 */
async function entryChecks(
  program: ProgramRow,
  project: { live_url?: string; repo_url?: string; contracts?: string[] } | undefined,
  answers: Record<string, string>,
  ctx: ToolContext,
): Promise<Verified | undefined> {
  if (program.campaign) return undefined;
  const liveUrl = entryLiveUrl(program, project, answers);
  // A live link given to a program that doesn't ask for one is still checked (live_verified).
  if (!liveUrl && !program.submission_requirements.some((r) => r.required && r.project_field === 'live_url')) return undefined;
  const needsContract = program.needs_contract ?? null;
  try {
    // Stored contracts: the project info's, the ones local_repos reported for this repo, then the
    // candidates matching found in the repo's files (Pre-flight P4, cache only).
    const repoUrl = project?.repo_url ?? answers.repo_url;
    // Review M4 (G7): on a shared client local_repos is whoever reported last, so it is never read.
    const reported = needsContract && !ctx.sharedClient ? await localRepoContracts(ctx.installationId, repoUrl) : [];
    // v2.10 fix round 1 (I2): an App-read private repo's addresses only for the installation that proved it.
    const inFiles = needsContract ? await cachedRepoAddresses(repoUrl, appViewer(ctx)) : [];
    const stored = [...(project?.contracts ?? []), ...reported, ...inFiles];
    const addresses = needsContract ? addressesFrom({ answers, liveUrl, chain: needsContract, stored }) : [];
    return await entryVerified({ liveUrl, needsContract, addresses }, ctx.verifyDeps);
  } catch (err) {
    console.error('[verify] entry', err instanceof Error ? err.name : 'error');
    return { live: false, contract: null, needsContract };
  }
}

/** v2.9 A5: the live link an entry gives: the answer to the item filled from live_url, else the project's. Pure. */
function entryLiveUrl(program: ProgramRow, project: { live_url?: string } | undefined, answers: Record<string, string>): string | null {
  const req = program.submission_requirements.find((r) => r.required && r.project_field === 'live_url');
  return (req && answers[req.key]?.trim()) || project?.live_url?.trim() || null;
}

/** v2.9 A5: the one fix line a failed check adds (never blocking), or null. Pure. */
function checkFix(v: Verified | undefined, liveGiven: boolean): Fix | null {
  if (!v || !liveGiven) return null;
  // v2.10 item 14: a link that loads an error page says what it shows.
  if (!v.live) return { key: 'live_url', rule: 'unverified', for: 'builder', text: v.liveError ? liveErrorLine(v.liveError) : LIVE_FAILED_LINE };
  // Ruling G15: only a real "no code" answer says not found; a check that couldn't run says nothing.
  if (v.needsContract && v.contract === false)
    return { key: 'live_url', rule: 'unverified', for: 'builder', text: contractMissingLine(v.needsContract) };
  return null;
}

/**
 * v2.8.1 §E17 (T6 carry): this installation's remembered wallet, never on a hosted agent
 * (shared_client): one registration may serve many builders, so the wallet is asked instead.
 */
const walletMemory = (ctx: ToolContext) => (ctx.sharedClient ? Promise.resolve(null) : rememberedWallet(ctx.installationId));

/**
 * The wallet this entry already holds, never on a hosted agent (shared_client): a name-keyed entry
 * there may be another user's, so its wallet is neither shown nor suggested.
 */
const entryWallet = (ctx: ToolContext, k: Parameters<typeof ownEntryWallet>[0]) =>
  ctx.sharedClient ? Promise.resolve(null) : ownEntryWallet(k);

/**
 * The open rounds' builder bonus pools so far and their token counts, by program id, in one grouped
 * read (Ruling 3; the bonus ledger; v2.10 item 1).
 */
export const roundPools = (programIds: string[]): Promise<Map<string, RoundPool | null>> => readRoundPools(programIds);

/** One batched pool read per reply; it never fails the tool: on any error, no pools. */
async function poolsOf(read: (ids: string[]) => Promise<Map<string, RoundPool | null>>, ids: string[]) {
  if (ids.length === 0) return new Map<string, RoundPool | null>();
  try {
    return await read(ids);
  } catch (err) {
    console.error('[list_programs] builder bonus pools:', err);
    return new Map<string, RoundPool | null>();
  }
}

/** Ruling 25: one read of where the builder's matched repos already have a coin; never fails the tool. */
async function repoCoinsOf(
  read: (keys: string[]) => Promise<Map<string, { program_id: string; title: string }>>,
  repos: YourRepos | null,
) {
  const keys = repos && 'fits' in repos ? [...new Set(repos.fits.flatMap((f) => (f.repo_url ? [normalizeRepoUrl(f.repo_url)] : [])))] : [];
  if (keys.length === 0) return new Map<string, { program_id: string; title: string }>();
  try {
    return await read(keys);
  } catch (err) {
    console.error('[list_programs] repo coins:', err);
    return new Map<string, { program_id: string; title: string }>();
  }
}

/** v2.9 A2: repos shown per program in `matches`; an any_chain program (a16z) shows one. */
const MATCHES_PER_PROGRAM = 3;

/**
 * v2.9 A2: list_programs' `matches`, per repo and program, at most 3 repos per program (1 for an
 * any_chain program). Programs keep the order the fits give. v2.10.1 B2: each row carries its odds
 * (match.ts rowOdds), its low-odds reason and the repo's traction (real use: transactions, a live
 * link, commits), and the repos rank by odds, then traction, then the product score; the polish-only
 * product score is no longer shown, so a starter's README never reads as more than a product's users.
 * Pure.
 */
export function matchRows(fits: RepoFit[], oneRepo: Set<string>) {
  type Row = ReturnType<typeof row>;
  const byProgram = new Map<string, { row: Row; score: number; used: boolean }[]>();
  const row = (f: RepoFit, v: RepoFit['verdicts'][number]) => {
    const odds = rowOdds(f.product, v, f.facts?.chains ?? {});
    return {
      repo: f.repo,
      repo_url: f.repo_url,
      program_id: v.program_id,
      status: v.status,
      missing: v.missing,
      effort: v.effort,
      odds: odds.odds,
      ...(odds.low_reason && { low_reason: odds.low_reason }),
      traction: f.product?.traction ?? 0,
    };
  };
  for (const f of fits)
    for (const v of f.verdicts) {
      const list = byProgram.get(v.program_id) ?? [];
      list.push({ row: row(f, v), score: f.product?.score ?? -1, used: f.facts ? hasRealUse(f.facts) : false });
      byProgram.set(v.program_id, list);
    }
  return [...byProgram].flatMap(([id, list]) =>
    list
      // v2.11 8a (S5): odds (good, unknown, low), then real use (measured or claimed), then traction.
      .sort((a, b) => oddsRank(a.row.odds) - oddsRank(b.row.odds) || Number(b.used) - Number(a.used) || b.row.traction - a.row.traction || b.score - a.score)
      .slice(0, oneRepo.has(id) ? 1 : MATCHES_PER_PROGRAM)
      .map((x) => x.row),
  );
}

const ProgramId = z.object({ program_id: z.string() }).strict();

const GetProgramInput = ProgramId.extend({
  /** "owner/repo" or a github.com link: adds an eligibility check for that repo. */
  repo: z.string().optional(),
}).strict();

/**
 * v2.8 Ruling 7 (plan): what the agent can do. `browser` (default false): it drives the builder's
 * own logged-in browser. `can_push` (default true): it can push to the repo; false means no token
 * launch is attempted.
 */
const AgentInput = z.object({ browser: z.boolean().optional(), can_push: z.boolean().optional() }).strict();

const PrepareSubmissionInput = ProgramId.extend({
  project: ProjectInfo.optional(),
  answers: z.record(z.string(), z.string()).optional(),
  agent: AgentInput.optional(),
  /**
   * v2.8 Part D: true once the builder has answered this program's questions, so the coach asks
   * once per program (at most 3 questions for the first, 1 after) and never a second round.
   */
  coach_asked: z.boolean().optional(),
  /**
   * v2.9 C12, Ruling 8: the builder has no live link and the project builds to static files: the
   * reply's `host` carries the sign-in link, an upload URL, or why not.
   */
  host: z.boolean().optional(),
  /** v2.10 item 15 (Ruling G9): the code a shared client's builder pasted, so their deadline line shows. */
  signed_in: z.string().max(40).optional(),
}).strict();

/** v2.8 Ruling 1 (plan): the confirmation step's input. */
const ConfirmEntryInput = z
  .object({
    program_id: z.string(),
    project: ProjectInfo.extend({ name: z.string().max(RAW_CAP).trim().min(1) }),
    answers: z.record(z.string(), z.string()),
    decision: z.enum(['go', 'skip']).optional(),
    builder_confirmed: z.literal(true).optional(),
    token: z.object({ name: z.string().max(200).optional(), symbol: z.string().max(20).optional() }).strict().optional(),
    wallet: z.string().optional(),
    agent: AgentInput.optional(),
    /** v2.8.1 fix round 1: checking back after "launching": a read, never a launch. */
    check_back: z.boolean().optional(),
    /** v2.9 B9 (Ruling G9): the code a shared client's builder pasted after signing in with GitHub. */
    signed_in: z.string().max(40).optional(),
  })
  .strict();

/**
 * v2.8 Part C: what the confirmation offer and decision read about a program and repo. `coinIn`
 * (Ruling 5 (plan)): the other program this repo's one token is entered in; a failed read never
 * fails the tool (no offer change).
 */
async function offerFacts(
  program: ProgramRow,
  repoUrl: string | null | undefined,
  ctx: ToolContext,
  /** Ruling G12: whose declines count (declineLogin); null (a shared client without a login): none. */
  login: string | null = declineLogin(ctx),
) {
  const key = repoUrl ? normalizeRepoUrl(repoUrl) : null;
  let coinIn: string | null = null;
  // v2.9 B10: the repo's token is already this program's (launched from the first reply's offer).
  let tokenHere = false;
  if (key) {
    const coins = await (ctx.repoCoins ?? repoCoinPrograms)([key]).catch((err: unknown) => {
      console.error('[confirm] repo token lookup', err instanceof Error ? err.name : 'error');
      return new Map<string, { program_id: string; title: string }>();
    });
    const coin = coins.get(key);
    if (coin && coin.program_id !== program.id) coinIn = coin.title;
    tokenHere = coin?.program_id === program.id;
  }
  // v2.9 B10: how often the builder said skip to this repo's token offer. A failed read counts none.
  const declined = repoUrl && login !== null ? await declineCount(ctx.installationId, repoUrl, login) : 0;
  // Ruling G14 (M1): the first reply offered this repo's token for this program: the flow said "40%".
  const firstShown = repoUrl
    ? await firstReplyShown(ctx.installationId, program.id, offerKey(repoUrl, '')).catch(() => false)
    : false;
  return {
    hasBonus: hasBuilderBonus(program),
    coinIn,
    tokenHere,
    /** v2.9 B10 (Pre-flight P21): a token offer was skipped once: the next one is said without "40%". */
    declinedOnce: declined >= 1,
    /** Ruling G14 (M1): the first reply's offer for this repo and program was shown. */
    firstShown,
    /** Pre-flight P23: skipped twice: this repo is tokens off (no offer; "go" gets the kit). */
    declinedOut: declined >= DECLINES_MAX,
    policyOff: program.token_policy === 'off',
    available: (ctx.tokenDeps?.available ?? tokenLaunchesAvailable)(),
  };
}

/**
 * Ruling G12: the builder a token decline belongs to: '' off shared clients; on a shared client the
 * verified login of the pasted code (memoryKey), else null: nothing is recorded or read, so one
 * user's skips never stop another's offer.
 */
const declineLogin = (ctx: ToolContext, verifiedLogin?: string | null): string | null =>
  memoryKey({ ...ctx, verifiedLogin: verifiedLogin ?? ctx.verifiedLogin })?.login ?? null;

/**
 * Ruling G12: records a skip once per offer shown (offerIdentity), for this builder (declineLogin);
 * nothing on a shared client without a verified login. Returns the count, or null when not recorded.
 */
async function declineOffer(ctx: ToolContext, login: string | null, programId: string, repoUrl: string, name: string): Promise<number | null> {
  if (login === null) return null;
  const offer = await offerIdentity(ctx.installationId, programId, offerKey(repoUrl, name));
  return recordDecline(ctx.installationId, repoKey({ url: repoUrl, name }), new Date(), { login, offer });
}

/** v2.9 B10: the decline count for a repo (token_declines, keyed by repoKey); a failed read is 0. */
async function declineCount(installationId: number, repoUrl: string, login: string): Promise<number> {
  const key = repoKey({ url: repoUrl, name: '' });
  try {
    return (await declines(installationId, [key], login)).get(key) ?? 0;
  } catch (err) {
    console.error('[token] declines', err instanceof Error ? err.name : 'error');
    return 0;
  }
}

/**
 * v2.8.1 §A2: the token the confirmation offer names: the builder's own name and ticker when the
 * agent passed both, else EarnKit's proposal (the project name, else the repo name). Null when there
 * is nothing to name it from. The launch re-checks the ticker before it deploys (C6).
 */
async function offerProposal(
  projectName: string | undefined,
  repoUrl: string | null,
  edit: { name?: string; symbol?: string } | undefined,
  shown: Offered | null,
  ctx: ToolContext,
): Promise<(Offered & { taken?: string }) | null> {
  // Fix round 1: the pair shown last (else EarnKit's proposal), with the agent's valid edits merged
  // field by field, the same way the launch reads them (editsOf). An edited ticker already used on
  // tokens.fun is never shown: the next free suggestion is, marked `taken`.
  const edits = edit ? editsOf(edit) : {};
  const named = projectName?.trim() || titleCase(repoNameOf(repoUrl ?? undefined) ?? '');
  const check = ctx.tokenDeps?.check ?? tokensFunTickerCheck;
  const base = shown ?? (named ? await proposeToken(named, check, repoUrl ?? undefined) : null);
  const name = edits.name ?? base?.name;
  if (!name) return null;
  if (edits.symbol && (await check(edits.symbol)) === false) {
    const next = await proposeToken(named || name, async (c) => (c === edits.symbol ? false : check(c)), repoUrl ?? undefined);
    return { name, symbol: next.symbol, taken: edits.symbol };
  }
  const symbol = edits.symbol ?? base?.symbol;
  return symbol ? { name, symbol } : null;
}

/** Fix round 1: stores the pair a Yes line shows; a failed write only means "go" shows it again. */
async function rememberOffer(ctx: ToolContext, programId: string, key: string, o: Offered, wallet: string | null = null) {
  try {
    // Fix round 2 (I-a): the wallet on the same confirm line, so a launch by project_id uses only it.
    await saveOffer(ctx.installationId, programId, key, o, false, wallet);
  } catch (err) {
    console.error('[confirm] offer save', err instanceof Error ? err.name : 'error');
  }
}

/**
 * Final review I3: the other program this entry's repo token is entered in, or null (no repo, no
 * token, or the token is this program's). A failed read logs the error class and is null.
 */
async function tokenElsewhere(parsed: z.infer<typeof RecordSubmissionInput>, ctx: ToolContext): Promise<string | null> {
  const repoUrl = parsed.project.repo_url ?? answersOf(parsed.submission_data).repo_url ?? null;
  if (!repoUrl) return null;
  const key = normalizeRepoUrl(repoUrl);
  const coins = await (ctx.repoCoins ?? repoCoinPrograms)([key]).catch((err: unknown) => {
    console.error('[record] repo token lookup', err instanceof Error ? err.name : 'error');
    return new Map<string, { program_id: string; title: string }>();
  });
  const coin = coins.get(key);
  return coin && coin.program_id !== parsed.program_id ? coin.title : null;
}

/**
 * v2.8 Ruling 29 (plan): "Also qualifies", right after record_submission records the entry.
 * Chains come from the repo-facts cache for this repo when present, else the entered program's
 * own chains (the repo was just entered there). Never fails the reply: on error the caller logs
 * `[also_qualifies]` with the error class and the whole section is left out.
 */
async function alsoQualifiesBlock(
  parsed: z.infer<typeof RecordSubmissionInput>,
  ctx: ToolContext,
  /** v2.9 A5: the entry's live link loaded in this step's check (live_verified). */
  liveVerified: boolean,
): Promise<{ rows: AlsoRow[]; text: string | null }> {
  const repoUrl = parsed.project.repo_url ?? null;
  const name = parsed.project.name;
  const key = projectKey({ repo_url: repoUrl, name });
  const full = repoUrl ? githubRepo(repoUrl) : null;
  const [program, programs, enteredIds, bank, cached, told] = await Promise.all([
    getProgramRow(parsed.program_id),
    alsoProgramFacts(),
    enteredProgramIds(ctx.installationId, { repoUrl, name }),
    readBank(ctx.installationId, key),
    full ? cachedRepoChains(`${full.owner}/${full.repo}`, appViewer(ctx)) : Promise.resolve(null),
    memoryOf(memoryKey(ctx), 'also_qualifies'),
  ]);
  // v2.9 T12 (G15 M1): what the builder said about this repo; a chain they said is testnet only
  // (and never said is on mainnet) fits nothing here.
  const said = told.repos.get(saidKeyOf({ url: repoUrl, name })) ?? null;
  const testnetOnly = (c: SaidRepo['testnet'][number]) => Boolean(said?.testnet.includes(c) && !said.mainnet.includes(c));
  const rows = alsoQualifies({
    enteredProgramId: parsed.program_id,
    chains: (cached ?? program.chains).filter((c) => !testnetOnly(c)),
    canWin: await alsoCanWin(ctx, saidKeyOf({ url: repoUrl, name }), said, liveVerified),
    programs,
    enteredIds,
    bank,
    answers: answersOf(parsed.submission_data),
    // Final review I1: fields the project info fills (repo, live link, name) are not "left".
    project: parsed.project,
    // Review fix round 1, item 3: the live-product gate reads the project's own live link.
    // v2.9 A5: only a live link that loaded from here (live_verified) counts as a live product.
    hasLiveProduct: liveVerified,
    now: new Date(),
    // v2.9 A3: never a program the builder is not interested in, or applied to outside EarnKit.
    hidden: hiddenPrograms(
      told,
      programs.map((p) => ({ id: p.id, starts_at: p.starts_at ?? null, ends_at: p.ends_at, opened_at: p.opened_at ?? null })),
    ),
  });
  // v2.10 item 1: no bonus sentences here (the reply's one bonus line is enteredText's).
  return { rows, text: alsoText(rows) };
}

/**
 * v2.9 T12 (G15 M1): Also qualifies keeps only programs the entered repo could really win. With the
 * repo remembered from list_programs (installations.fit_repos, never on a shared client): the alert
 * precision rule (alerts.ts repoCanWin) over what the builder says now, with this step's live check.
 * Without it: a "needs a live product" program only when the builder said the repo has users (its
 * row otherwise still needs real users). A failed read keeps that fallback.
 */
async function alsoCanWin(
  ctx: ToolContext,
  key: string,
  said: SaidRepo | null,
  liveVerified: boolean,
): Promise<(p: { id: string; tag: string | null }) => boolean> {
  const fallback = (p: { tag: string | null }) => p.tag !== 'needs a live product' || said?.has_users === true;
  if (!remembers(ctx)) return fallback;
  try {
    const [fits, rows] = await Promise.all([readFitRepos(ctx.installationId), openCuratedRows()]);
    const fit = fits.find((r) => r.key.toLowerCase() === key);
    if (!fit) return fallback;
    const repo: FitRepo = { ...fit, said: said ?? fit.said, live_verified: fit.live_verified || liveVerified };
    const programs = new Map(rows.map((r) => [r.id, newProgramOf(r)]));
    return (p) => {
      const np = programs.get(p.id);
      return np !== undefined && repoCanWin(np, repo);
    };
  } catch (err) {
    console.error('[also_qualifies] fit', err instanceof Error ? err.name : 'error');
    return fallback;
  }
}

/** The agent's note with the token line: commit it with the next push, before the builder confirms. */
const TOKEN_LINE_NOTE = 'Commit this line to earnkit.txt at the repo root with your next push, before the builder confirms.';

/** The first line of confirm_entry's reply once the entry is confirmed, before the kit. Pure. */
function tokenLine(token: TokenOutcome | null, fallback: string) {
  // Final review M8: the ticker, when known, so the builder recognizes and shares their token.
  if (token?.status === 'launched' && token.tokens_fun)
    // v2.8.1 §F19: no "40%" after the launch; the Yes line said it.
    return `Your token${token.symbol ? ` $${token.symbol}` : ''} is live: ${token.tokens_fun.replace(/^https?:\/\//, '')}.`;
  if (token?.status === 'pending') return token.note ?? LAUNCHING;
  return token?.note ?? fallback;
}

/**
 * v2.8 Part D, Ruling 6 (plan): the answer bank's fill for this installation and project. A field
 * the project info fills (its repo, its live link) is never overwritten from the bank. A failed read
 * never fails the tool and logs the error class only (the bank is private).
 */
async function bankedAnswers(
  installationId: number,
  program: ProgramRow,
  project: { name?: string; repo_url?: string; [k: string]: unknown } | undefined,
  repoUrl: string | null | undefined,
  answers: Record<string, string>,
  shared = false,
) {
  const name = project?.name?.trim() || titleCase(repoNameOf(repoUrl ?? undefined) ?? '');
  const none = {} as Record<string, string>;
  if (!name && !repoUrl) return { answers, from_bank: none, suggested: none, first: true, key: null, name };
  const key = projectKey({ repo_url: repoUrl, name });
  let bank = new Map<FieldKind, string>();
  try {
    bank = await readBank(installationId, key);
  } catch (err) {
    console.error('[coach] bank read', err instanceof Error ? err.name : 'error');
  }
  const own = (f: string | undefined) => (f && typeof project?.[f] === 'string' ? String(project[f]).trim() : '');
  const reqs = program.submission_requirements.filter((r) => !own(r.project_field));
  // v2.8.1 §E17: on a hosted agent, nothing from the bank is used without a yes/no that names it.
  const filled = bankFill(reqs, answers, bank, { confirmAll: shared });
  // C15: still the project's first program while the bank filled none of what the coach would ask.
  const first = !askableKeys(program.submission_requirements, answers).some((k) => k in filled.from_bank || k in filled.suggested);
  return { ...filled, first, key, name };
}

/** v2.8 Part D: what the agent does with the coach's guidance. */
const COACH_NOTE =
  "Draft every field from the repo, onchain data and the builder's answers, using each field's judges, pattern and limit. " +
  'Make each of coach.judging visible in the field that fits it. When two fields share a kind, write a distinct answer for each. ' +
  "Never answer a field marked builder_only yourself: only the builder's own words go there. " +
  "Re-angle answers from the bank to this program's judges. Then call again with all answers.";
const QUESTIONS_NOTE =
  "Show show_to_builder as written and wait for the answers. Put each answer under the question's keys (a question can cover several; split the answer). " +
  "When a question offers saved details and the builder says yes, use its suggested values. Then pass coach_asked: true (the coach asks once per program). " +
  COACH_NOTE;
const DRAFT_NOTE = 'The table is the draft; when the builder says "show all", show every answer in full.';
const AGENT_FIXES_NOTE =
  'Before showing show_to_builder, make every agent_fixes change yourself (trim to the limit, add the link you know) and call again.';
const FIXES_NOTE = 'If the builder gives what a fix asks for, add it to that answer and call again.';

/**
 * v2.10 item 11: while a description field isn't plain words (a not_plain fix), the confirmation is
 * refused with the agent's fixes and note only: nothing is recorded or launched, and the builder
 * sees nothing. Null when every description field is plain. Pure.
 */
export function plainRefusal(fixes: Fix[]): { ready: false; agent_fixes: Fix[]; agent_note: string } | null {
  if (!fixes.some((f) => f.rule === 'not_plain')) return null;
  return { ready: false, agent_fixes: fixes.filter((f) => f.for === 'agent'), agent_note: PLAIN_NOTE };
}

/** v2.8.1 §C11: what the agent does with the wallet answer from the coach's round. */
const WALLET_ANSWER_NOTE =
  `Put the wallet the builder gives under answers.${WALLET_KEY} (a 0x address); if they have none yet, leave it out. ` +
  'When they say yes to the offer, pass shown_wallet as wallet.';

/** Every coach note for the agent (the copy review scans them). */
export const COACH_NOTES = { COACH_NOTE, QUESTIONS_NOTE, DRAFT_NOTE, AGENT_FIXES_NOTE, FIXES_NOTE, WALLET_ANSWER_NOTE };

/**
 * v2.8.1 §C11: whether the coach's round asks for the wallet: only when this entry would get a
 * token (a repo, an agent that can push, tokens on for the program and available, the repo's
 * token not entered elsewhere) and no wallet is known: none given, none on this entry, none
 * remembered. Returns what the question says (the builder bonus or not), or null. A failed read
 * never fails the tool (no wallet question).
 */
async function walletToAsk(
  program: ProgramRow,
  repoUrl: string | null | undefined,
  canPush: boolean,
  given: string | null,
  remembered: string | null,
  name: string | undefined,
  ctx: ToolContext,
): Promise<{ hasBonus: boolean } | null> {
  if (program.campaign || !repoUrl || !canPush || given || remembered) return null;
  try {
    // v2.12.1 T10 (spec 3b): the wallet is asked only for the token's fees and bonus: only where the token is pitched.
    if (!(await tokenPitch(ctx, program.id, repoUrl))) return null;
    const facts = await offerFacts(program, repoUrl, ctx);
    if (facts.coinIn || facts.policyOff || !facts.available || facts.declinedOut || facts.tokenHere) return null;
    const stored = await entryWallet(ctx, {
      programId: program.id,
      installationId: ctx.installationId,
      repoUrl,
      name: name?.trim() || titleCase(repoNameOf(repoUrl) ?? ''),
    });
    return stored ? null : { hasBonus: facts.hasBonus };
  } catch (err) {
    console.error('[coach] wallet ask', err instanceof Error ? err.name : 'error');
    return null;
  }
}

const ListProgramsInput = z
  .object({
    // v2.8.1 §B6 (fix round 2): never refused; read by canBuild, reportedGithubUser, reportedRepos.
    agent_can_build: z.unknown().optional(),
    github_user: z.unknown().optional(),
    repos: z.unknown().optional(),
    local_repos: LocalReposInput.optional(),
    // v2.12 spec 3: read leniently by discovery.ts localGitInput; never refused. v2.12.1: still
    // accepted (folded into identity), no longer listed.
    local_git: z.unknown().optional(),
    // v2.12.1 spec "1. Connect": what the agent can already see, read leniently by identity-input.ts
    // identityInput; never refused, a clue only (never proof, never a merge). Ignored with the flag off.
    identity: z.unknown().optional(),
    // v2.8.1 §B6: anything else than a 0x address is ignored with WALLET_IGNORED, never an error.
    wallet: z.unknown().optional(),
    // v2.9 B9 (Ruling G9): the code a shared client's builder pasted after signing in; never refused.
    signed_in: z.unknown().optional(),
    // v2.10 item 2: "show more": today's tables instead of the one lead line.
    more: z.boolean().optional(),
    // v2.13.3 (1): an older agent's live link for its project; read only under the Bench (benchIdentity).
    live_url: z.unknown().optional(),
  })
  .strict();

/**
 * v2.8.1 §B6 (fix round 2): agent_can_build as an agent gives it: a boolean, "true"/"false",
 * "yes"/"no" or 1/0; anything else is ignored (the default, true). Pure; exported for tests.
 */
export function canBuild(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === 1) return v === 1;
  const t = typeof v === 'string' ? v.trim().toLowerCase() : null;
  if (t === 'false' || t === 'no' || t === '0') return false;
  return true;
}

/** v2.8.1 §B6: list_programs' note when the wallet given isn't a 0x address. */
export const WALLET_IGNORED =
  'The wallet given is not a 0x address, so it was ignored. Pass a 0x wallet (40 hex characters) to show its wins, or leave it out.';

/**
 * v2.8.1 §B6: list_programs' input. Never fails on what an agent reports about the builder's repos
 * (match-projects.ts ReportedRepoInput) or a wallet that isn't 0x (dropped, with a note). Exported for tests.
 */
export function listProgramsInput(input: unknown) {
  const { wallet, agent_can_build, github_user, repos, signed_in, local_git, identity, live_url, ...rest } = ListProgramsInput.parse(input ?? {});
  const repoList = reportedRepos(repos);
  const localGit = localGitInput(local_git);
  const given = identityInput(identity, localGit);
  // v2.13 spec "2a": the one project the agent is in (identity.project, else an old agent's first).
  // v2.13.3 (1): under the Bench the older fields fill what identity doesn't carry (never dropped).
  const bench = benchEnabled()
    ? benchIdentity({
        identity: given, project: benchProject(identity), local_git: localGit, github_user, repos, live_url,
        local_repos: (input as { local_repos?: unknown } | null)?.local_repos,
      })
    : { identity: given, project: benchProject(identity) };
  const walletGiven = typeof wallet === 'string' && wallet.trim() !== '' ? wallet.trim() : null;
  const valid = walletGiven && /^0x[0-9a-fA-F]{40}$/.test(walletGiven) ? walletGiven : null;
  return {
    ...rest,
    agent_can_build: canBuild(agent_can_build),
    github_user: reportedGithubUser(github_user),
    repos: repoList.length ? repoList : undefined,
    wallet: valid ?? undefined, walletNote: wallet != null && wallet !== '' && !valid ? WALLET_IGNORED : null,
    signed_in: typeof signed_in === 'string' ? signed_in : undefined,
    local_git: localGit,
    identity: bench.identity,
    project: bench.project };
}

/**
 * v2.10 Ruling H10 (I1): what the agent does with the short first reply. A yes to the lead's "Want me
 * to finish it?" prepares lead.program_id with lead.repo; the tables (more: true) only when the
 * builder asks to see more, "Want the 3 easiest?" included.
 */
export const LEAD_NOTE =
  'A yes to "Want me to finish it?" means start preparing lead.program_id with lead.repo (call prepare). ' +
  'When lead.step is "submit", the entry is already recorded and only the builder can submit it on the program\'s site: ' +
  'never prepare it again; once they say they submitted, call tell with submitted: { program_id: lead.program_id }; on no, say nothing more about it until they bring it up. ' +
  'Call find again with more: true only when the builder asks to see more programs, or says yes to "Want the 3 easiest?".';

/** v2.11 T7 (spec 1): what the agent does with a yes to the fresh lead ("Want me to build it?"). */
export const BUILD_NOTE =
  'A yes to "Want me to build it?" means call prepare with build: { start: true, program_id: build_offer.program_id } (and the same program_id at the top). ' +
  'EarnKit then asks the builder one question before any work starts. Never start building before that.';

/** v2.11 T7: the chat-only lead's yes ("Want the plan?"): this client can't build, so the plan is how to get it built. */
export const PLAN_NOTE =
  'This client can\'t build or deploy. A yes to "Want the plan?" means tell the builder, short and in your words: ' +
  'add EarnKit to a coding agent and ask it to build for the program the lead line names; ' +
  'that agent builds it, and EarnKit deploys and hosts it. Never name a product or say you built anything.';

/** v2.10.1 fix round 1 (C1): what the agent does with the users question. */
export const USERS_NOTE =
  'The reply asks whether this repo has real users or revenue. Pass the builder\'s answer, never your guess: ' +
  'call tell with repo_facts: [{ repo: users_question.repo, has_users: true or false }].';

/** v2.8.1 §E18: what the agent does with list_programs' pick_up offer. */
export const PICKUP_NOTE =
  'Ask the builder pick_up.question once, as written, before anything else. On yes, call tell with pickup: "yes"; ' +
  'on no, with answer "no". Never answer it for them.';
/** v2.8.1 §E18: the builder's lines for the pickup answer. */
export const PICKUP_TEXT = {
  linked: 'Done. Your earlier entries, saved answers and alerts are here now.',
  declined: 'Okay. Your earlier entries stay where they are.',
  none: 'There is nothing to pick up right now.',
  proof: 'One step first: I need to add a short proof line to your repo, then your earlier entries come over.',
  unreadable: "EarnKit couldn't read your repo on GitHub right now. Try again in a minute.",
  unclear: 'Pick up your earlier entries? Yes or no.',
  /** v2.9 B9: followed by the one-time sign-in link. */
  signIn: 'Or one click to prove the repo is yours, then your earlier entries come over:',
} as const;

/** v2.8.1 §E18: a yes or a no as an agent passes it; null when it is neither. Pure; exported for tests. */
export { yesNo };

/** v2.8 Ruling 30 (plan): what the agent does with ask_outcome. v2.9 A3: the answer goes to tell_earnkit. */
export const ASK_OUTCOME_NOTE =
  'Results for this entry were due. After showing show_to_builder, ask the builder this question once, as written. ' +
  'Then call tell with program_status: this program_id and project_id, their result (won, placed or lost), ' +
  "and prize_usd if they won money. If they don't know yet, call nothing.";

/** v2.8 Ruling C21: the note when the builder's own outcome was saved. */
export const OUTCOME_SAVED_NOTE = "Saved as the builder's own report. It never shows publicly or counts; only published results do.";
/** v2.9 B9: confirm_entry's note with the sign-in line (spec wording). */
export const SIGN_IN_NOTE =
  'Show the line. When the builder says they signed in, call confirm again with yes: true.';
/** v2.9 B9 (Ruling G9): on a shared client the sign-in page gives the builder a code for the agent. */
export const SIGN_IN_CODE_NOTE =
  'The page gives the builder a code: pass it as signed_in on this and later calls (find, prepare, confirm, tell). ' +
  'It acts as the builder for 24 hours: never repeat it in your replies.';
/** v2.9 B9: the proof-line miss's way out for an agent that can't push, with sign-in on. */
export const CANT_PUSH_SIGN_IN_NOTE =
  "If you can't push to this repo, call confirm again with agent: { can_push: false }: the builder gets a one-click GitHub sign-in instead.";
/** v2.9 B9: after a proof-line miss, the sign-in is the other way. */
export const SIGN_IN_OR_NOTE =
  'Or show the sign-in line; when the builder says they signed in, call confirm again with yes: true.';
/** v2.9 C12: the agent's note with the hosting sign-in line. */
export const HOST_SIGN_IN_NOTE =
  'Show host.show_to_builder. When the builder says they signed in, call prepare again with host: true for the upload URL.';

/**
 * v2.9 C12, Ruling 8: prepare_submission's `host` block: the builder's sign-in line, the one-time
 * upload URL (for the agent only; never in builder text), or a plain reason. Never fails the tool.
 * The proof reads go through `ctx.deployDeps.gate` (tests).
 */
async function hostBlock(
  ctx: ToolContext,
  repoUrl: string | undefined,
  name: string | undefined,
  /** v2.11 T9: the build path's proof of this repo on this call (token-gate.ts proveRepo). */
  proven: ProvenRepo | null = null,
): Promise<Record<string, string>> {
  // v2.11 T9 (decision 2): off a shared client hosting needs no GitHub sign-in (issueUpload's
  // proof-line gate); a shared client still does (issueUpload refuses there without it).
  if (!r2Enabled()) return { unavailable: HOST_LINES.unavailable };
  const gh = repoUrl ? githubRepo(repoUrl) : null;
  if (!gh) return { unavailable: HOST_LINES.noRepo };
  const project = name?.trim() || titleCase(gh.repo);
  try {
    const offer = await issueUpload(
      { installationId: ctx.installationId, repoKey: `${gh.owner}/${gh.repo}`, project, proven },
      new Date(),
      { gate: ctx.deployDeps?.gate },
    );
    if ('sign_in_url' in offer)
      return { ...offer, show_to_builder: hostSignInLine(project, offer.sign_in_url), agent_note: HOST_SIGN_IN_NOTE };
    if ('upload_url' in offer) return { ...offer, agent_note: UPLOAD_NOTE };
    return offer;
  } catch (err) {
    console.error('[prepare_submission] host', err instanceof Error ? err.name : 'error');
    return { unavailable: HOST_LINES.unavailable };
  }
}

/** Ruling 10: an entry was recorded for this repo: its hosted site's expiry moves. Never fails the tool. */
const siteExpiryAfterEntry = (repoUrl: string | null | undefined, where: string) =>
  repoUrl
    ? refreshSiteExpiry(repoUrl).catch((err: unknown) => console.error(`[${where}] site expiry`, err instanceof Error ? err.name : 'error'))
    : Promise.resolve();

/** v2.9 A3: tell_earnkit's note to the agent. */
export const TELL_SAVED_NOTE = 'Saved. The next find uses it; nothing to show the builder.';
/** Ruling G6: what the builder sees when a shared (hosted) agent keeps nothing. */
export const NOTED_FOR_NOW = 'Noted for now.';
/** Ruling G6: tell_earnkit's note on a shared client. */
export const TELL_SHARED_NOTE =
  'Show show_to_builder. This agent serves many builders, so EarnKit keeps no program or repo statements here; ' +
  'pass them again when they matter.';

/**
 * v2.9 A3: the builder's memory (Ruling G6: none on a shared client, memoryKey null); a failed read
 * is an empty memory, never a failed tool.
 */
/**
 * v2.9 E19, Ruling 13 (Pre-flight P16): the weekly email question, added to the reply of a call that
 * recorded an entry, once per installation and only while the email is on. Ruling G21: on a shared
 * client once per verified login (the pasted `signed_in` code), and never without one. `email`: the
 * entry's email answer; on a shared client only one this builder typed in this entry (never a saved
 * one the coach offered back, `reused`), so the question names it. Never fails the tool.
 */
async function withEmailQuestion<T extends { show_to_builder: string; agent_note?: string }>(
  ctx: ToolContext,
  reply: T,
  email: string | null,
  reused: boolean,
  signedIn: string | undefined,
): Promise<T> {
  const shared = Boolean(ctx.sharedClient);
  const login = shared ? await sharedLogin(ctx, signedIn, 'weekly email') : null;
  const q = await askWeeklyEmail(ctx.installationId, { shared, email: shared && reused ? null : email, login });
  if (!q) return reply;
  return {
    ...reply,
    show_to_builder: `${reply.show_to_builder}\n\n${q.question}`,
    agent_note: reply.agent_note ? `${reply.agent_note} ${q.agent_note}` : q.agent_note,
  };
}

/** Pre-flight P16: the email saved in this project's answer bank (a shared client's may be another builder's). */
async function bankedEmail(installationId: number, key: string): Promise<string | null> {
  try {
    const contact = (await readBank(installationId, key)).get('contact');
    const slots: unknown = contact ? JSON.parse(contact) : null;
    return slots && typeof slots === 'object' ? cleanEmail((slots as Record<string, unknown>).email) : null;
  } catch {
    return null;
  }
}

const memoryOf = (key: MemoryKey | null, where: string): Promise<BuilderMemory> =>
  key === null
    ? Promise.resolve(emptyMemory())
    : readMemory(key).catch((err: unknown) => {
        console.error(`[${where}] builder memory`, err instanceof Error ? err.name : 'error');
        return emptyMemory();
      });

/** Alerts never fail a tool: on any error the reply goes out without them. */
async function alertsFor(
  installationId: number,
  opts: { offer?: boolean; otherWins?: string[] } = {},
) {
  try {
    return await sinceYouLastChecked(installationId, opts);
  } catch (err) {
    console.error('[alerts]', err);
    return { lines: opts.otherWins ?? [], scheduleNote: null, entries: [] as DeadlineEntry[] };
  }
}

/**
 * Ruling G7: whether this call may show what the installation remembers (entries, standings,
 * alerts, the outcome question, remembered repos). Never on a shared client, where one hosted
 * installation serves many builders (a GitHub-verified login there sees only its own entries, see
 * sharedLogin). Entries are still recorded.
 */
const remembers = (ctx: Pick<ToolContext, 'sharedClient'>) => !ctx.sharedClient;

/**
 * v2.10 fix round 1 (I2): who reads a cached App-read repo row: this installation, and on a shared
 * client only the caller's verified login (none without one).
 */
const appViewer = (ctx: Pick<ToolContext, 'installationId' | 'sharedClient' | 'verifiedLogin'>) => ({
  installationId: ctx.installationId,
  login: ctx.sharedClient ? (ctx.verifiedLogin ?? null) : undefined,
});

/**
 * v2.9 B9, Rulings G6, G7, G9: on a shared client with GitHub sign-in on, the verified login of the
 * code the builder pasted (`signed_in`, callerLogin), else null. Never fails the tool.
 */
async function sharedLogin(ctx: Pick<ToolContext, 'installationId' | 'sharedClient'>, signedIn: string | undefined, where: string): Promise<string | null> {
  if (!ctx.sharedClient || !githubVerifyEnabled() || !signedIn) return null;
  return callerLogin(ctx.installationId, signedIn).catch((err: unknown) => {
    console.error(`[${where}] verified login`, err instanceof Error ? err.name : 'error');
    return null;
  });
}

/**
 * v2.10 item 15 (Ruling G7, Review Focus 5): a shared client's entries for the deadline line: only
 * the ones the verified login signed in for; none without a login. Never fails the tool.
 */
async function loginDeadlineEntries(installationId: number, login: string | null): Promise<DeadlineEntry[]> {
  if (!login) return [];
  try {
    const ids = await verifiedEntryIds(installationId, login);
    if (ids.length === 0) return [];
    return (await openEntries(installationId, ids)).map((e) => ({ id: e.id, title: e.title, ends_at: e.ends_at, submitted: e.submitted }));
  } catch (err) {
    console.error('[deadline] login entries', err instanceof Error ? err.name : 'error');
    return [];
  }
}

/**
 * v2.10 item 15 (R12): the deadline line, first in show_to_builder (once per entry per UTC day).
 * A reply with no show_to_builder is left as it is (nothing is marked shown).
 */
async function withDeadline<T extends object>(installationId: number, result: T, entries: DeadlineEntry[]): Promise<T> {
  const shown = (result as { show_to_builder?: unknown }).show_to_builder;
  if (typeof shown !== 'string' || entries.length === 0) return result;
  const line = await takeDeadlineLine(installationId, entries);
  return line ? { ...result, show_to_builder: shown ? `${line}\n\n${shown}` : line } : result;
}

/**
 * v2.4 §4: a builder tool's reply opens with "Since you last checked" when there's news (Ruling G7:
 * not on a shared client). v2.10 item 15: show_to_builder starts with the deadline line, from the
 * entries the alerts already read; on a shared client only for the entries of the login the pasted
 * code (`signedIn`) verified, and none without one.
 */
async function withAlerts<T extends object>(ctx: Pick<ToolContext, 'installationId' | 'sharedClient'>, result: T, signedIn?: string) {
  if (!remembers(ctx)) {
    const login = await sharedLogin(ctx, signedIn, 'deadline');
    return withDeadline(ctx.installationId, result, await loginDeadlineEntries(ctx.installationId, login));
  }
  const a = await alertsFor(ctx.installationId);
  const line = sinceLine(a.lines);
  return withDeadline(ctx.installationId, { ...(line && { since_you_last_checked: line }), ...result }, a.entries);
}

/** v2.9 B10: the builder line when the builder said skip to a token launch (confirm with project_id and skip_token). */
export const NO_TOKEN_FOR_NOW = 'No token for now.';

/** v2.12.1 T10: what the first reply's bonus line is checked as: a program entry (never the coin program's, never a build's). */
const FIRST_REPLY_ENTRY = 'first-reply-program-entry';

/** v2.10 item 4: launch_token's offer, called directly (the alias routes it to confirm). */
const OFFER_GONE = 'Pass project_id: the token is offered once, at confirmation (call confirm with program_id, project and answers).';

/** Campaigns (v2.4): a valid wallet answer or null (still missing); the one rule, isWalletAddress. */
const validWallet = (w: string | undefined) =>
  w && isWalletAddress(w.trim()) ? w.trim() : null;

const GITHUB_LIMITED =
  'Too many GitHub repo checks from this agent (30 an hour), so none were run this time.';

/**
 * v2.8.1 T7 (audit J1): the line before the coach's questions when the program needs a repo and the
 * builder has none: what is needed, and the best program they can enter without one.
 */
async function needsRepoLine(program: { id: string; title: string }): Promise<string> {
  const open = await listPrograms().catch(() => []);
  // v2.12 spec 9: as find, only programs an agent can complete with the score flag on.
  const alt = enterableWithoutRepo(builderScoreEnabled() ? open.filter((p) => p.agent_completable !== false) : open, program.id);
  const head = `${program.title} needs a public repo with your project's code.`;
  return alt ? `${head} No repo yet? ${alt.title} doesn't need one: say the word and I'll start there.` : head;
}

/**
 * v2.12.1 T10 (spec 3b): the build path's entry: this installation's build names this program and
 * (when one is given) this repo. Its repo key (owner/repo, lowercase), the coin_moments key of the
 * built_live moment; null for any other entry, with the flag off, or on a shared client.
 */
async function buildEntryKey(ctx: ToolContext, programId: string, repoUrl: string | null | undefined): Promise<string | null> {
  if (ctx.sharedClient || !builderScoreEnabled()) return null;
  const b = await readBuild(ctx.installationId);
  if (!b?.repo_url || b.program_id !== programId) return null;
  if (repoUrl && normalizeRepoUrl(repoUrl) !== normalizeRepoUrl(b.repo_url)) return null;
  const gh = githubRepo(b.repo_url);
  return gh ? `${gh.owner}/${gh.repo}`.toLowerCase() : null;
}

/**
 * v2.12.1 T10 (spec 3b, replacing v2.12's score-20 gate): whether this entry's token may be
 * pitched, asked a wallet for or launched (coin-moments.ts coinPitchAllowed). Flag off: always
 * (v2.11, no read), except an earnkit-coin entry (never). On: the coin program's own entry and the build path's entry at its built_live
 * moment only; a failed read is no (fail strict). Every pitch and launch path calls this one.
 */
async function tokenPitch(ctx: ToolContext, programId: string, repoUrl: string | null | undefined, projectId?: number): Promise<boolean> {
  // v2.12.1 T12 fix round 1: a coin entry made while the flag was on waits for the flag; with it off
  // nothing pitches or launches it (production never makes one, so flag off stays v2.11 for every
  // real program).
  if (!builderScoreEnabled()) return programId !== COIN_PROGRAM;
  try {
    const key = await buildEntryKey(ctx, programId, repoUrl);
    return await coinPitchAllowed(ctx.installationId, {
      program_id: programId, build: key !== null, ...(key && { project_key: key }), ...(projectId !== undefined && { project_id: projectId }),
    });
  } catch (err) {
    console.error('[coin] pitch', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/**
 * v2.12 spec 7 (R22), v2.12.1 T10: a new token for this entry is not pitched here (tokenPitch).
 * False for an entry not this installation's, one with a token, a skipped one or an EarnKit
 * campaign entry (exempt, controller ruling).
 */
async function tokenHeld(ctx: ToolContext, projectId: number): Promise<boolean> {
  const entry = await launchEntry(ctx.installationId, projectId);
  if (!entry || entry.token_url || entry.confirm_choice === 'skip') return false;
  if ((await getProgramRow(entry.program_id)).campaign) return false;
  return !(await tokenPitch(ctx, entry.program_id, entry.repo_url, entry.id));
}

/**
 * v2.12.1 T10 (spec 3b): find's step with the coin moments. The reply that reports a project's first
 * 5 people (the last look saw fewer) offers its coin in place of the step; else a project with people
 * and no coin gets it when no bigger step exists (chooseStep's order). The moment is recorded with
 * the offer (offerCoin: at most once per project); an offer that can't be made leaves the step as it
 * was. The line is offerCoin's, with the wallet shown (or asked after the yes).
 */
async function coinStep(id: number, seen: Seen | null, view0: Omit<StandView, 'step' | 'news'>, agentCanBuild: boolean, deps: { check?: TickerCheck } = {}): Promise<MoveUp | null> {
  const host = hostFor(agentCanBuild);
  const candidates = view0.projects.filter((p) => p.shipped && p.people > 0 && !p.has_coin);
  if (seen?.at) {
    const five = candidates.find((p) => (seen.people?.[p.key] ?? 0) < 5 && p.people >= 5);
    const offer = five ? await offerCoin(id, five.key, 'first_five', deps) : null;
    if (five && offer) return { kind: 'coin', project_key: five.key, line: offer.line };
  }
  const coinKeys = new Set<string>();
  // chooseStep takes the first eligible one in the projects' order: none is read past it.
  for (const p of candidates) {
    if (view0.declined?.includes(stepKey('coin', p.key)) || !(await coinOfferable(id, p.key))) continue;
    coinKeys.add(p.key);
    break;
  }
  let step = chooseStep(view0, { coin: (k) => coinKeys.has(k), build: null, host });
  if (step?.kind === 'coin' && step.project_key) {
    const offer = await offerCoin(id, step.project_key, 'has_people', deps);
    if (offer) return { ...step, line: offer.line };
    step = chooseStep(view0, { coin: () => false, build: null, host });
  }
  return step;
}

/**
 * v2.12.1 T8 (spec 2, 4): find's reply with the score flag on. The person's view (stand-view.ts),
 * up to 3 programs their projects qualify for, the one step up, any news since they last looked,
 * and the one-time "Your page is ready". One question per reply: a pending join (or an outcome
 * question) is asked first and the step waits a reply; an entry waiting on the builder's own
 * submission asks that instead of a step. Never fails on its own reads: a failed view read falls
 * back to an empty view.
 */
async function standFind(
  ctx: ToolContext,
  a: {
    first: FirstMessage;
    cards: FirstMessage['cards'];
    repos: YourRepos | null;
    myEntries: NonNullable<FirstMessage['entries']>;
    lastCheck: Date | null;
    pickup: { question: string } | null;
    ask: { project_id: number; program_id: string; name: string; program_title: string } | null;
    alerts: { lines: string[]; scheduleNote: string | null };
    agentCanBuild: boolean;
    walletNote: string | null;
    programs: { id: string; title: string; summary: string; deadline: unknown; tag: string | null; verified_at: Date | null; any_chain?: boolean }[];
    hide: Set<string>;
  },
): Promise<Reply> {
  const id = ctx.installationId;
  const now = a.first.now;
  const m = { cards: a.cards, repos: a.repos, entries: a.myEntries, now };
  const entered = enteredIds(m);
  const read = await standBase(id, { fresh: ctx.freshDeps }).catch((err: unknown) => {
    console.error('[list_programs] stand', err instanceof Error ? err.name : 'error');
    return null;
  });
  const base = read?.base ?? { standing: { ranked: false, rank: 0, total: 0 }, claimed: false, handle: null, claimLink: null, projects: [] };
  // Ways to earn: the programs a project qualifies for (good odds, never an investment or one that
  // needs new work), not entered, at most 3, each under the project that fits it best.
  const rows = layout(m, entered).rows.filter((r) => qualifies(r) && !r.card.sponsored && !entered.has(r.card.id)).slice(0, 3);
  const keyOf = (k: string) => base.projects.find((p) => p.key.toLowerCase() === k.toLowerCase())?.key ?? k;
  const earn: EarnLine[] = rows.map((r) => ({ program_id: r.card.id, project: keyOf(r.key ?? r.repo), title: r.card.title, prize: earnPrize(r.card), when: earnWhen(r.card) }));
  // One question per reply: a join (or the outcome question) first; an entry waiting on their submission next.
  const held = Boolean(a.pickup || a.ask);
  const submit = held ? undefined : submitStep(m);
  const due = [...(a.first.deadline ? [a.first.deadline] : []), ...(submit ? [submitStepLine(submit)] : [])];
  // Money in every reply: with no program to name, the fresh build fills the earn part (or is the step).
  const lead = earn.length === 0 ? freshLead({ ...a.first, holdQuestion: held || Boolean(submit) }) : undefined;
  // Fix round 1: every reply has a way to earn. No program fits and no build lead: a project that could
  // win once people use it, else an open-all-year program, else a fresh build (stand-view.ts moneyFallback).
  const fallback =
    earn.length === 0 && !lead && due.length === 0
      ? moneyFallback({
          cards: a.cards, entered, hidden: a.hide, now, projects: base.projects, users: usersAsk(m, undefined), fresh: a.first.fresh,
          repoTrouble: Boolean(a.repos && ('error' in a.repos || a.repos.unseen?.length)),
        })
      : { money: null, pick: null };
  const pick = lead ?? fallback.pick ?? undefined;
  const view0: Omit<StandView, 'step' | 'news'> = { ...base, earn, fresh: null, due, money: fallback.money };
  // v2.12.1 T10 (spec 3b): the coin as the reply's one yes, only at its moments, and only when nothing
  // else asks. Never fails the tool (no coin on an error).
  const step0 = held || submit ? null : await coinStep(id, read?.seen ?? null, view0, a.agentCanBuild, { check: ctx.tokenDeps?.check }).catch((err: unknown) => {
    console.error('[list_programs] coin', err instanceof Error ? err.name : 'error');
    return chooseStep(view0, { coin: () => false, build: null, host: hostFor(a.agentCanBuild) });
  });
  // Fix round 2: a build is the step only when nothing else asks (never a second question).
  const { step, fresh } = placeBuild(pick ? { title: pick.card.title, prize: prizeOf(pick.card).split(' × ')[0], canBuild: pick.canBuild } : null, step0, held || Boolean(submit));
  // News and the page-ready line open the reply ("Since you last checked"); the card is asked only
  // when nothing else in the reply asks. Never fails the tool.
  const asks = held || Boolean(submit) || Boolean(step?.line.includes('?'));
  const news = read
    ? await takeNews(id, read.seen, base, now, !asks).catch((err: unknown) => {
        console.error('[list_programs] news', err instanceof Error ? err.name : 'error');
        return null;
      })
    : null;
  const ready = read
    ? await takePageReady(id, { lastCheck: a.lastCheck, created_at: read.created_at, page_ready_shown_at: read.page_ready_shown_at, claimed: base.claimed, link: base.claimLink, projects: base.projects.length }).catch(
        (err: unknown) => {
          console.error('[list_programs] page ready', err instanceof Error ? err.name : 'error');
          return null;
        },
      )
    : null;
  const claim = base.claimLink;
  // The link shows once: in the page-ready line when there is one.
  const view: StandView = { ...view0, claimLink: ready ? null : base.claimLink, fresh, step, news };
  const opener = newsOpener(a.alerts.lines, [news, ready].filter((x): x is string => Boolean(x)));
  const shown = [opener, whereYouStand(view), a.pickup?.question].filter(Boolean).join('\n\n');
  if (pick?.canBuild)
    await markFreshOffer(id, now).catch((err: unknown) => console.error('[list_programs] fresh offer', err instanceof Error ? err.name : 'error'));
  await recordShown(
    id,
    rows.flatMap((r) =>
      r.key && r.row
        ? [{ program_id: r.card.id, repo_key: r.key, status: r.v.status, product_score: r.product_score, row_level: r.row.level, traction: r.product_score === null ? null : r.traction }]
        : [],
    ),
  ).catch((err: unknown) => console.error('[list_programs] match shown', err instanceof Error ? err.name : 'error'));
  const asked = step && step.kind !== 'send_link' && step.kind !== 'build' ? step : null;
  const upNote = asked?.kind === 'coin' ? COIN_NOTE : MOVE_UP_NOTE;
  return {
    show_to_builder: shown,
    note: ['Show show_to_builder to the builder exactly as written.', EARN_NOTE, step?.kind === 'send_link' ? SEND_LINK_NOTE : null].filter(Boolean).join(' '),
    ...(a.pickup && { pick_up: { question: a.pickup.question, agent_note: PICKUP_NOTE } }),
    ...(earn[0] && !submit && { lead: { program_id: earn[0].program_id, repo: rows[0].repo } }),
    ...(submit && { lead: { program_id: submit.card.id, step: 'submit', ...(submit.entry.id !== undefined && { project_id: submit.entry.id }) } }),
    ...(asked && { move_up: { kind: asked.kind, project_key: asked.project_key, agent_note: upNote } }),
    ...(pick && { build_offer: { program_id: pick.card.id, starter_id: pick.starter.id, agent_note: pick.canBuild ? BUILD_NOTE : PLAN_NOTE } }),
    ...((ready || view.claimLink) && claim && { claim: { link: claim } }),
    ...(a.walletNote && { wallet_note: a.walletNote }),
    ...(a.alerts.scheduleNote && { schedule_daily_check: a.alerts.scheduleNote }),
    ...(a.ask && {
      ask_outcome: { project_id: a.ask.project_id, program_id: a.ask.program_id, question: outcomeQuestion(a.ask.name, a.ask.program_title), agent_note: ASK_OUTCOME_NOTE },
    }),
    matches:
      a.repos && 'fits' in a.repos
        ? matchRows(a.repos.fits, new Set(a.programs.filter((p) => p.any_chain).map((p) => p.id))).filter((r) => !a.hide.has(r.program_id))
        : [],
    working_on: a.first.workingOn,
    programs: a.programs.map((p) => ({ id: p.id, title: p.title, summary: p.summary, deadline: p.deadline, tag: p.tag, verified_at: p.verified_at?.toISOString().slice(0, 10) ?? null })),
  };
}

/**
 * v2.10 item 4: the v2.9 tool handlers, unchanged except their agent notes. The 4 builder tools
 * (`tools` below) dispatch to them; tests call them directly.
 */
export const handlers = {
  // One answer to "what can I earn?": the builder's projects first, then what's worth building,
  // opening with what changed since their last check.
  list_programs: async (input: unknown, ctx: ToolContext) => {
    const { agent_can_build, github_user, repos, local_repos, wallet, walletNote, signed_in, more, identity, project } = listProgramsInput(input);
    // v2.12.1 (plan S10): with the score flag on, people join only on proven ties (identity.ts
    // joinOnProvenTie), so find never offers a pickup and what the agent reports is only a clue.
    const scoring = builderScoreEnabled() && !ctx.sharedClient;
    // v2.8.1 §E18: earlier installations of the builder this call names (its GitHub user, the owners
    // of the repos it reports, its wallet), never what this installation remembers; read before this
    // call's details are saved. Never fails the tool.
    // Fix rounds 1, 2: in its place, each group of a pending join (another agent proved its GitHub or
    // X) sees that one yes first, once (identity.ts askJoin).
    // v2.13.4 R7: on probation, find writes nothing to the page (no join answered, no identity, no proof).
    const join = scoring && !ctx.probation
      ? await askJoin(ctx.installationId).catch((err: unknown) => {
          console.error('[list_programs] join', err instanceof Error ? err.name : 'error');
          return null;
        })
      : null;
    const pickup = join
      ? { question: join.question, entries: 0 }
      : !scoring && (github_user || repos?.length || local_repos?.length || wallet)
        ? await offerPickup(ctx.ownInstallationId ?? ctx.installationId, {
            github_users: [
              github_user,
              ...(repos ?? []).map((r) => githubRepo(r)?.owner),
              ...(local_repos ?? []).map((r) => (r.url ? githubRepo(r.url)?.owner : undefined)),
            ],
            wallet: wallet ?? null,
          }, ctx.pickupDeps).catch((err: unknown) => {
            console.error('[list_programs] pickup', err instanceof Error ? err.name : 'error');
            return null;
          })
        : null;
    if (wallet && !ctx.probation) await rememberWallets(ctx.installationId, [wallet]);
    // v2.12 spec 1, 3: the public profile (made on the first find; named by the first remembered
    // wallet until a login is proven) and its clues. Never fails the tool and never waits on a read.
    // A shared group gets none (R2).
    let profiled = false as boolean;
    /** v2.13.4 R7: this agent on probation named another project; it stays and the reply says why. */
    let holdMain = false as boolean;
    // v2.12.1 T8 (spec 2): the person's own public data is re-read inside this call, within its
    // budget, in parallel with the reads below (stand-view.ts startRefresh). Never fails the tool.
    const start = Date.now();
    const refresh: { started: { within: (capMs?: number) => Promise<void> } | null; proofCheck?: Promise<boolean> } = { started: null };
    if (scoring)
      await (async () => {
        const now = new Date();
        const made = await ensureProfile(ctx.installationId, now);
        if (!made) return;
        profiled = true;
        if (made.created || wallet) await setFallback(ctx.installationId, {});
        if (benchEnabled() && ctx.probation) {
          // v2.13.4 R7: a newcomer on probation reads the page as it is: no main project, identity or
          // proof writes, no proof check. Naming another project is refused in one line (the reply's ask
          // is this week's update).
          const current = await mainProjectOf(ctx.installationId);
          if (project && (!current || current.toLowerCase() !== projectKeyOf(project).toLowerCase())) holdMain = true;
          refresh.started = startRefresh(ctx.installationId, { now, start, reader: ctx.readerDeps });
          return;
        }
        if (benchEnabled()) {
          // v2.13 R1: the one project only; only its sources proposed and github_user filled (B3).
          // v2.13.1 O2 (B6): a different project replaces it until it is Bench-confirmed; after that it is
          // set once (B2) and a different project is stored in identity only.
          const main = project ? await setMainProject(ctx.installationId, project) : null;
          const isMain = Boolean(project && main && main.key.toLowerCase() === projectKeyOf(project).toLowerCase());
          if (isMain && project?.repo) await fillGithubUser(ctx.installationId, project.repo, identity.github_login);
          await noteIdentity(ctx.installationId, { ...identity, projects: project ? [project] : [] }, now, { propose: isMain });
          // B4: the refresh may check the proof every minute in the hour after the line was issued.
          const fast = await confirmingFast(ctx.installationId, now);
          refresh.started = startRefresh(ctx.installationId, { now, start, reader: ctx.readerDeps, ...(fast && { minAgeMs: CONFIRMING_REFRESH_MS }) });
          // v2.13.1 O5 fix round 1: the open proof branch's check starts now, beside the refresh and
          // matching, so the three share one REPLY_WAIT_MS (benchFind waits only what is left of it).
          refresh.proofCheck = checkProofBranch(ctx.installationId, now, { ghFetch: ctx.proofBranchFetch ?? ctx.readerDeps?.ghFetch });
          await enqueueDiscovery(ctx.installationId, 'first_find');
          return;
        }
        await noteIdentity(ctx.installationId, identity, now);
        await enqueueDiscovery(ctx.installationId, 'first_find');
        refresh.started = startRefresh(ctx.installationId, { now, start, reader: ctx.readerDeps });
      })().catch((err: unknown) => console.error('[list_programs] profile', err instanceof Error ? err.name : 'error'));
    // v2.9 B9, Rulings G6, G7, G9: on a shared client, the GitHub-verified login of the pasted code.
    const login = await sharedLogin(ctx, signed_in, 'list_programs');
    const [memory, openPrograms, campaigns, told] = await Promise.all([
      checkPrograms(ctx.installationId, ctx.probation ? {} : { github_user, repos, local_repos }),
      listPrograms(),
      earnkitCampaignRows(ctx.installationId),
      // v2.9 A3: what the builder told EarnKit, read once per call (G6: a shared client's verified login's).
      memoryOf(memoryKey({ ...ctx, verifiedLogin: login }), 'list_programs'),
    ]);
    // v2.12 spec 9 (R21): with the score flag on, only programs an agent can complete for the builder.
    const programs = builderScoreEnabled() ? openPrograms.filter((p) => p.agent_completable !== false) : openPrograms;
    const hidden = hiddenPrograms(told, programs);
    const hide = hiddenIds(hidden);
    const { lastCheck } = memory;
    // Ruling G7: a shared client shows nothing the installation remembers (another builder's).
    const own = remembers(ctx);
    // v2.9 B9 (G7): a verified login there sees only the entries it signed in for.
    const loginEntries = !own && login ? await verifiedEntryIds(ctx.installationId, login).catch(() => []) : null;
    const workingOn = own ? memory.working_on : [];
    // Remembered from an earlier call when not given now (G7: a verified login is its own GitHub user).
    // v2.12.2: with the score flag on, else the login the agent reported (identity), so a program can
    // be tied to one of their repos (a fit only: it confirms nothing).
    const reported = scoring && own && !github_user && !repos?.length && !memory.github_user ? identity.github_login : null;
    const user =
      github_user ?? (repos?.length ? undefined : own ? (memory.github_user ?? reported ?? undefined) : (login ?? undefined));
    // v2.12.2: matching that only rides on the reported login (the agent asked for nothing) is quiet:
    // its failure is never shown, and it counts as "repos given" only when it found some.
    const quiet = reported !== null && user === reported;
    let repoList = repos?.length
      ? repos
      : github_user || !own
        ? undefined
        : (memory.repos ?? undefined);
    let local = local_repos?.length
      ? local_repos
      : own
        ? (memory.local_repos ?? undefined)
        : undefined;
    // v2.13 spec "Program matching uses the one project only": under the Bench flag the matcher gets
    // the one project's repo (set at the first find, else the project this call names) and nothing else.
    const bench = scoring && profiled && benchEnabled();
    if (bench) {
      const main = (await mainProjectOf(ctx.installationId).catch(() => null))?.toLowerCase() ?? null;
      const one = main && REPO_KEY.test(main) ? main : (reportedRepos(project?.repo ? [project.repo] : [])[0] ?? null);
      repoList = one ? [one] : undefined;
      local = undefined;
    }
    const matchUser = bench ? undefined : user;
    // Ruling 11 (plan): a GitHub user or repo list, given now or remembered, turns off "You could".
    // Local repos count too (fix round 1, Minor 5): the spec's gate is "no repos are reported or
    // found", and a repo the agent reported is a repo reported, matching error or not.
    let githubGiven = Boolean((matchUser && !quiet) || repoList?.length || local?.length);
    // EarnKit campaigns are their own table (campaigns), not program cards (v2.4 §1).
    const cards = programs.filter((p) => !p.earnkit_campaign).map((p) => ({
      ...p,
      is_new: lastCheck !== null && p.opened_at !== null && p.opened_at > lastCheck,
      closes_in_days: closesInDays(p.ends_at),
    }));

    let yourRepos: YourRepos | null = null;
    if (matchUser || repoList?.length || local?.length) {
      try {
        // Reading GitHub is limited per installation. Reported local repos alone read no GitHub, but
        // their links and contracts are still checked under LIST_BUDGET (review M3: no per-install limit yet).
        if (matchUser || repoList?.length)
          await enforce('githubMatching', ctx.installationId, GITHUB_LIMITED);
        // v2.10 item 7b (R9): a named repo GitHub won't show is read through the read-only App when
        // this builder proved it there (G7, G10: on a shared client only the caller's own proof).
        const appOn = githubAppEnabled();
        const appLogin = ctx.sharedClient ? login : undefined;
        const matchDeps: Pick<MatchDeps, 'appToken' | 'verified'> = {
          ...(appOn ? { appToken: (n: string) => appTokenFor({ installationId: ctx.installationId, login: appLogin, repoKey: n.toLowerCase() }) } : {}),
          // v2.12 spec 7: odds from the person's verified users and money, when their public score has them.
          ...(profiled ? { verified: (k: string) => verifiedProject(ctx.installationId, k) } : {}),
        };
        const matching = (ctx.matchProjects ?? matchProjects)(
          MatchProjectsInput.parse({
            github_user: matchUser,
            repos: repoList,
            local_repos: local,
            // v2.9 A3: applied before the checks, so a claimed live link is checked (Pre-flight P15).
            ...(told.repos.size > 0 && { said: Object.fromEntries(told.repos) }),
          }),
          matchDeps,
        );
        // v2.13.1 O5 N1: under the Bench the reply waits for matching at most REPLY_WAIT_MS from the
        // start of the call (ReplyLate: no fits this reply; the repo's facts are cached for the next).
        // O5 fix round 1: every finished match of the one project is kept, so a reply cut short shows the
        // last one (under an hour old); a late GitHubError or RateLimitError is logged once.
        const mainKey = bench ? (repoList?.[0] ?? null) : null;
        if (mainKey && !ctx.probation) void matching.then((m) => keepBenchMatch(ctx.installationId, mainKey, m, new Date()), () => undefined);
        const lateError = (err: unknown) => {
          if (err instanceof GitHubError || err instanceof RateLimitError) console.error('[list_programs] late matching', err.name);
        };
        type Matched = Awaited<typeof matching>;
        const matched: Matched = bench
          ? await inTime<Matched>(matching, start + REPLY_WAIT_MS - Date.now(), lateError).catch(async (err: unknown) => {
              const kept = err instanceof ReplyLate && mainKey ? await keptBenchMatch(ctx.installationId, mainKey, new Date()) : null;
              if (kept) return kept as Matched;
              throw err;
            })
          : await matching;
        // v2.10 item 7b: with the App on, the first repo EarnKit can't see gets its "allow read
        // access" link (an `app` nonce, R8); the reply shows only that one.
        const [first, ...restUnseen] = matched.unseen ?? [];
        const link =
          appOn && first && !ctx.probation // v2.13.4 R8 (6): no App verify link on probation
            ? await createVerifyLink({ installationId: ctx.installationId, projectId: null, repoKey: first.full_name, purpose: 'app' }).catch(
                (err: unknown) => {
                  console.error('[list_programs] app link', err instanceof Error ? err.name : 'error');
                  return null;
                },
              )
            : null;
        yourRepos = first ? { ...matched, unseen: [{ ...first, link }, ...restUnseen] } : matched;
        // Final fix I2 (ledger c1): with the App on and no can't-see link in the reply (one link, one
        // ask), the first private repo matched from the local view with no App proof yet gets the link
        // on its own line, once.
        if (appOn && !first && matched.fromLocal?.length && !ctx.probation) {
          let localLink: { full_name: string; link: string } | null = null;
          for (const l of matched.fromLocal) {
            if (await hasAppProof({ installationId: ctx.installationId, login: appLogin, repoKey: l.full_name })) continue;
            const made = await createVerifyLink({ installationId: ctx.installationId, projectId: null, repoKey: l.full_name, purpose: 'app' }).catch(
              (err: unknown) => {
                console.error('[list_programs] app link', err instanceof Error ? err.name : 'error');
                return null;
              },
            );
            if (made) localLink = { full_name: l.full_name, link: made };
            break;
          }
          if (localLink) {
            const at = localLink;
            yourRepos = { ...matched, fromLocal: matched.fromLocal.map((l) => (l.full_name === at.full_name ? { ...l, link: at.link } : l)) };
          }
        }
      } catch (err) {
        if (err instanceof ReplyLate) yourRepos = null;
        else if (quiet && matchUser) console.error('[list_programs] reported login matching', err instanceof Error ? err.name : 'error');
        else if (err instanceof GitHubError || err instanceof RateLimitError)
          yourRepos = { error: err.message };
        else console.error('[list_programs] matching failed:', err);
      }
      // A reported login with no repos found reads as no repos given ("You could" stays).
      if (quiet && matchUser) {
        if (yourRepos && 'checked' in yourRepos && yourRepos.checked > 0) githubGiven = true;
        else yourRepos = null;
      }
    }
    // v2.9 A7: the builder's best owned repos that fit something, for new program alerts (no GitHub
    // call there). Never fails the tool; a failed match leaves the last ones. Ruling G7: not on a
    // shared client (one installation serves many builders, and its alerts are off).
    if (own && !ctx.probation && yourRepos && 'fits' in yourRepos) {
      const fitRepos = yourRepos.fits
        .map((f) => fitRepoOf(f, (f.key && told.repos.get(f.key)) || null))
        .filter((r): r is FitRepo => r !== null);
      await setFitRepos(ctx.installationId, fitRepos).catch((err: unknown) =>
        console.error('[list_programs] fit repos', err instanceof Error ? err.name : 'error'),
      );
    }

    // The builder's campaign entries: rank (or the sponsor campaign's state), prize once paid.
    const yourEntries = own
      ? await yourCampaignEntries(ctx.installationId)
      : loginEntries?.length
        ? await yourCampaignEntries(ctx.installationId, loginEntries)
        : [];
    // EarnKit campaign standings are in the campaigns table; only sponsor entries get a section.
    const entries = presentYourEntries(
      yourEntries.filter((e) => e.campaign.kind === 'sponsor'),
      lastCheck,
    );
    // EarnKit wins come from the alerts engine (shown once); sponsor wins from here, placed right
    // after them (money first). Read last, so nothing after it can throw away the news.
    const alerts = own && !ctx.probation
      ? await alertsFor(ctx.installationId, { offer: true, otherWins: entries.wins })
      : { lines: [] as string[], scheduleNote: null };

    // The builder bonus pools: one read, only for provable programs the message shows. v2.10 item 2:
    // only with "show more" (the short reply has no bonus line).
    const pools = more
      ? await poolsOf(ctx.roundPools ?? roundPools, bonusProgramIds({ cards, repos: yourRepos }))
      : new Map<string, RoundPool | null>();
    const withPools = cards.map((c) => ({
      ...c,
      bonus_pool_wei: pools.get(c.id)?.wei ?? null,
      bonus_tokens: pools.get(c.id)?.tokens ?? 0,
      bonus_closed: pools.has(c.id) && pools.get(c.id) === null,
    }));
    const repoCoins = await repoCoinsOf(ctx.repoCoins ?? repoCoinPrograms, yourRepos);
    // v2.8.1 §B9: "Your entries" and the "entered" marks; never fails the tool (none on an error).
    const myEntries = !own && !loginEntries?.length ? [] : await openEntries(ctx.installationId, loginEntries ?? undefined).catch((err: unknown) => {
      console.error('[list_programs] entries', err instanceof Error ? err.name : 'error');
      return [];
    });

    const first: FirstMessage = {
      alerts: alerts.lines,
      updates: programUpdates(cards, lastCheck === null),
      campaigns,
      cards: withPools,
      repos: yourRepos,
      githubGiven,
      workingOn,
      agentCanBuild: agent_can_build,
      sponsorEntries: entries.section,
      now: new Date(),
      repoCoins,
      entries: myEntries,
      hidden,
      // v2.9 E20: "Builders using EarnKit won $X" (announced prizes only), absent at 0.
      wonUsd: await wonSource.read(),
      // v2.10 item 15 (R12, Pre-flight P19): after "Your entries"; the same entries (a shared
      // client's only for its verified login, none without one).
      deadline: ctx.probation ? null : await takeDeadlineLine(ctx.installationId, myEntries),
      more: more === true,
      // v2.11 T7: the no-repo lead's switches; off (no pick) unless deploys and hosting are on.
      fresh: freshSwitches(ctx, agent_can_build),
    };
    // v2.8 Ruling 30 (plan): at most one entry per call whose results were due; asked once. Read
    // after every other read (review minor 11), so nothing after marking it asked can lose the
    // question. Never fails the tool (the entry is then asked on a later call). v2.10 Ruling H10
    // (I3): one question per reply, pickup first, then this one, then the lead's: with a pickup it
    // waits (not read, so not marked asked).
    const ask = pickup || ctx.probation || (!own && !loginEntries?.length) ? null : await outcomeToAsk(ctx.installationId, undefined, loginEntries ?? undefined).catch((err: unknown) => {
      console.error('[list_programs] outcome ask', err instanceof Error ? err.name : 'error');
      return null;
    });
    first.holdQuestion = Boolean(pickup || ask);
    // v2.12 final review (T9), v2.12.1 T10: no builder bonus line where no token is pitched (it is
    // funded by a token). The first reply offers program entries, never the coin program or a build's
    // own entry, so with the flag on there is none. Flag off: true without a read (v2.11).
    first.noBonus = !(await coinPitchAllowed(ctx.installationId, { program_id: FIRST_REPLY_ENTRY, build: false }).catch(() => false));
    // v2.12.1 T8 (spec 2): with the score flag on, the three-part reply (where you stand, ways to
    // earn right now, how to move up) replaces the short v2.11 reply. "Show more" (more: true) keeps
    // the v2.11 tables, now without v2.12's second line and consent line. Flag off: everything below
    // is v2.11, byte for byte.
    if (scoring && profiled && !more) {
      // v2.13.1 O5 N1: under the Bench the reply waits for the refresh at most REPLY_WAIT_MS (it runs on).
      await refresh.started?.within(benchEnabled() ? REPLY_WAIT_MS : undefined);
      const shownCards = withPools.filter((c) => !hide.has(c.id));
      if (!benchEnabled())
        return standFind(ctx, {
          first, cards: shownCards, repos: yourRepos, myEntries, lastCheck, pickup, ask,
          alerts, agentCanBuild: agent_can_build, walletNote, programs, hide,
        });
      // v2.13 T8: the Bench's three parts (bench-find.ts), with what standFind's reply also carries.
      const r = await benchFind(ctx, {
        start, proofCheck: refresh.proofCheck, first, cards: shownCards, repos: yourRepos, myEntries, pickup, ask, alerts, agentCanBuild: agent_can_build, hide, project,
        notice: holdMain ? PROBATION_LINES.main.split('\n')[0] : null,
      });
      const offer = r.build_offer as { program_id: string; starter_id: string; can_build: boolean } | undefined;
      return {
        ...r,
        // v2.13.1 O2: no separate note under the Bench (move_up is the one route for the yes).
        ...(offer && { build_offer: { program_id: offer.program_id, starter_id: offer.starter_id } }),
        ...(pickup && { pick_up: { question: pickup.question, agent_note: PICKUP_NOTE } }),
        ...(walletNote && { wallet_note: walletNote }),
        ...(ask && { ask_outcome: { project_id: ask.project_id, program_id: ask.program_id, question: outcomeQuestion(ask.name, ask.program_title), agent_note: ASK_OUTCOME_NOTE } }),
        matches:
          yourRepos && 'fits' in yourRepos
            ? matchRows(yourRepos.fits, new Set(programs.filter((p) => p.any_chain).map((p) => p.id))).filter((x) => !hide.has(x.program_id))
            : [],
        working_on: first.workingOn,
        programs: programs.map((p) => ({ id: p.id, title: p.title, summary: p.summary, deadline: p.deadline, tag: p.tag, verified_at: p.verified_at?.toISOString().slice(0, 10) ?? null })),
      };
    }
    // v2.10 item 5: no token offer here; the token is pitched once, at confirmation.
    const show_to_builder = presentFirstMessage(first);
    // v2.11 T7: the no-repo lead the reply shows, if any (presentFirstMessage's own rule), for
    // build_offer. The first build lead shown off a shared client starts the v2.11 metric
    // (fresh_offer_at, set once). Never fails the tool.
    const fresh = freshLead(first);
    if (fresh?.canBuild && own)
      await markFreshOffer(ctx.installationId, first.now).catch((err: unknown) =>
        console.error('[list_programs] fresh offer', err instanceof Error ? err.name : 'error'),
      );
    // v2.9 A8: what matching showed (the matched rows on screen, one per program), for the outcome
    // loop. Never fails the tool. Ruling G7: not on a shared client (its repo keys and scores may be
    // another builder's) until memoryKey names a verified builder.
    // v2.10 item 2: the short reply shows only its lead row (leadRow), "show more" every matched row.
    const shownLayout = { cards: withPools.filter((c) => !hide.has(c.id)), repos: yourRepos, entries: myEntries, now: first.now };
    // Ruling H10 (I1): the lead the short reply asks about, for the agent's yes.
    // v2.10.1 B1: an entry not submitted yet leads instead (submitStep), as in presentFirstMessage.
    const step = more || first.holdQuestion ? undefined : submitStep(shownLayout);
    const leadFit = more || first.holdQuestion || step ? undefined : leadRow(shownLayout);
    // v2.10.1 fix round 1 (C1): a product EarnKit can't measure, ranked above the lead, is asked about users instead.
    const usersQ = more || first.holdQuestion || step ? undefined : usersAsk(shownLayout, leadFit);
    const lead = usersQ ? undefined : leadFit;
    const onScreen = !own ? [] : more ? layout(shownLayout).rows : [lead].filter((r) => r !== undefined);
    await recordShown(
      ctx.installationId,
      onScreen.flatMap((r) =>
        r.key && r.row
          ? [{ program_id: r.card.id, repo_key: r.key, status: r.v.status, product_score: r.product_score, row_level: r.row.level, traction: r.product_score === null ? null : r.traction }]
          : [],
      ),
    ).catch((err: unknown) => console.error('[list_programs] match shown', err instanceof Error ? err.name : 'error'));

    const shown = show_to_builder;
    return {
      show_to_builder: pickup ? [pickup.question, shown].filter(Boolean).join('\n\n') : shown,
      ...(pickup && { pick_up: { question: pickup.question, agent_note: PICKUP_NOTE } }),
      note:
        'Show show_to_builder to the builder exactly as written. ' +
        (!own && (user || repoList?.length || local?.length)
          ? 'This agent serves many builders, so pass their repos again on each call. '
          : (user && !quiet) || repoList?.length
          ? 'EarnKit remembers their GitHub username or repos for next time. '
          : local?.length
            ? 'EarnKit remembers the repos you reported for next time. '
            : "Next time, pass local_repos: read the builder's local git remotes and report each repo the builder wrote; skip clones of other people's code and EarnKit's kits. Never ask for a GitHub username first. ") +
        'Program facts were checked against their sources on verified_at; within 7 days, no need to re-read them.' +
        (more ? '' : ` ${LEAD_NOTE}`),
      // Ruling H10 (I1): what the lead line offers; a yes to it starts that program's preparation.
      ...(lead && { lead: { program_id: lead.card.id, repo: lead.repo } }),
      // v2.10.1 B1: the entry is recorded; the builder's submission on the program's site is the only step left.
      ...(step && { lead: { program_id: step.card.id, step: 'submit', ...(step.entry.id !== undefined && { project_id: step.entry.id }) } }),
      ...(usersQ && { users_question: { repo: usersQ.key ?? usersQ.repo, agent_note: USERS_NOTE } }),
      // v2.11 T7: what the fresh lead offers; a yes starts the build path (or, chat-only, the plan).
      ...(fresh && {
        build_offer: { program_id: fresh.card.id, starter_id: fresh.starter.id, agent_note: fresh.canBuild ? BUILD_NOTE : PLAN_NOTE },
      }),
      ...(walletNote && { wallet_note: walletNote }),
      ...(alerts.scheduleNote && { schedule_daily_check: alerts.scheduleNote }),
      ...(ask && {
        ask_outcome: {
          project_id: ask.project_id,
          program_id: ask.program_id,
          question: outcomeQuestion(ask.name, ask.program_title),
          agent_note: ASK_OUTCOME_NOTE,
        },
      }),
      // For planning: what each repo still needs, per program. Details: get_program.
      matches:
        yourRepos && 'fits' in yourRepos
          ? matchRows(yourRepos.fits, new Set(programs.filter((p) => p.any_chain).map((p) => p.id))).filter(
              (r) => !hide.has(r.program_id),
            )
          : [],
      working_on: workingOn,
      programs: programs.map((p) => ({
        id: p.id,
        title: p.title,
        summary: p.summary,
        deadline: p.deadline,
        tag: p.tag,
        verified_at: p.verified_at?.toISOString().slice(0, 10) ?? null,
      })),
    };
  },

  get_program: async (input: unknown, ctx: ToolContext) => {
    const { program_id, repo } = GetProgramInput.parse(input);
    const program = await getProgram(program_id);
    if (!repo) return withAlerts(ctx, program);
    // Eligibility dry run for one repo: pass/fail plus what's missing.
    try {
      await enforce('githubMatching', ctx.installationId, GITHUB_LIMITED);
      return withAlerts(ctx, {
        ...program,
        eligibility: await checkEligibility(repo, program_id),
      });
    } catch (err) {
      if (!(err instanceof GitHubError || err instanceof RateLimitError))
        throw err;
      return withAlerts(ctx, {
        ...program,
        eligibility: { error: err.message },
      });
    }
  },

  // v2.11 T10: `join` (the build path only, from prepare): the live and deployed lines go before the
  // confirm line in one reply, with the build's wallet; no guide (the builder said yes to the lead).
  prepare_submission: async (input: unknown, ctx: ToolContext, join?: BuildJoin) => {
    const { program_id, agent, coach_asked, host, signed_in, ...known } = PrepareSubmissionInput.parse(input);
    const program = await getProgramRow(program_id);
    const hosting = host ? await hostBlock(ctx, known.project?.repo_url ?? known.answers?.repo_url, known.project?.name) : null;
    // Campaign entries reach the sponsor: check the name and description now, as record_submission will.
    if (program.campaign && known.project)
      known.project = cleanProject(known.project);
    const open = isOpen(program);
    // Remember it, so list_programs leads with "You're working on". v2.10 item 3: the first prepare
    // for a curated program shows its guide before the coach questions: on a non-shared client when
    // this call added the program and there is no entry for it yet (Pre-flight P23); on a shared
    // client (R13: working_on is installation-wide) while the coach hasn't asked.
    const added = open ? await setWorkingOn(ctx.installationId, program_id, true) : false;
    const curated = program.source === 'file' && !program.campaign;
    const firstPrepare =
      open && curated && (ctx.sharedClient ? !coach_asked : added && !(await hasProgramEntry(ctx.installationId, program_id)));
    // The guide's parts: what won, what it wants, best bet. No bonus line here: the confirm line says
    // the bonus when this entry can earn it (a repo's token entered elsewhere can't).
    const guide = firstPrepare && !join ? guideText(programGuide(program, null)) : null;
    const lead = join ? join.lead.join('\n') : null;
    const withGuide = <T extends { show_to_builder: string }>(r: T): T =>
      guide ? { ...r, show_to_builder: `${guide}\n\n${r.show_to_builder}` } : r;
    // This installation's last wallet (Ruling 10 (plan)). Campaign entries: asked about in full and
    // never prefilled (I8: a hosted client sharing one registration shares this memory). Other
    // programs: shown short on the confirmation offer's wallet line.
    const remembered = await walletMemory(ctx);
    // Ruling 22: outside campaigns a wallet the builder gave is valid or the call fails.
    const given = program.campaign
      ? validWallet(known.answers?.payout_wallet)
      : givenWallet(known.answers?.payout_wallet);
    const ask = program.campaign
      ? rememberedWalletQuestion(
          program.submission_requirements,
          known.answers,
          remembered,
        )
      : { wallet: null, note: null };
    // v2.8 Part D, Ruling 6 (plan): outside campaigns, the answer bank fills what this project
    // already answered for another program (never a field the agent or the project info gave).
    const banked = program.campaign
      ? null
      : await bankedAnswers(ctx.installationId, program, known.project, known.project?.repo_url ?? known.answers?.repo_url, known.answers ?? {}, ctx.sharedClient);
    if (banked) known.answers = banked.answers;
    // v2.7 §3, Ruling 15 (plan): readiness first. While required items are missing, the screen
    // leads with them and there is no token offer, wallet or ticker check yet.
    const prep = prepareSubmission(program.submission_requirements, known);
    // v2.9 A5: once the draft is ready, this step's link and contract checks. A failed check never
    // blocks the screen or the offer: it is one fix line, and the entry reads not ready (missing).
    const verified = open && prep.ready ? await entryChecks(program, known.project, known.answers ?? {}, ctx) : undefined;
    const checkedPrep = verified ? prepareSubmission(program.submission_requirements, { ...known, verified }) : prep;
    const failedCheck = checkFix(verified, entryLiveUrl(program, known.project, known.answers ?? {}) !== null);
    // C5: as short to-dos (the program's `todo`, else the label normalized); an item given but
    // invalid says "(check it)", its problem is in missing[].problem for the agent.
    const reqs = new Map(program.submission_requirements.map((r) => [r.key, r]));
    const missing = prep.ready
      ? []
      : prep.missing
          .filter((m) => m.required)
          .map((m) => todoOf(reqs.get(m.key) ?? { label: m.label }, Boolean(m.problem)));
    const repoUrl = known.project?.repo_url ?? known.answers?.repo_url;
    // The proposed token; its creator wallet is the entry's payout wallet when there is one.
    // No token block on a closed program (v2.4 §6, audit C22).
    // v2.12.1 T10 (spec 3b): with the score flag on, a token only where it is pitched (campaigns aside).
    const belowScore = open && prep.ready && !program.campaign ? !(await tokenPitch(ctx, program_id, repoUrl)) : false;
    const token = open && prep.ready && !belowScore
      ? await tokenProposalBlock({
          program,
          projectName: known.project?.name,
          // Campaigns: only a payout wallet given in this call (never the remembered one, which
          // is asked about, not assumed); without one the block asks the builder for the fee
          // wallet. Other programs (v2.6 §3): the wallet given now, else the remembered one.
          creatorWallet: program.campaign ? given : (join?.wallet ?? given ?? remembered),
          // The earnkit.txt token line is bound to this agent and the repo; shown only in this reply.
          installationId: ctx.installationId,
          repoUrl,
          liveUrl: known.project?.live_url ?? known.answers?.live_url,
        },
        // T7 (journey test): the same ticker check and availability as the rest of the flow
        // (injected in tests; the defaults otherwise, as before).
        { check: ctx.tokenDeps?.check, available: ctx.tokenDeps?.available })
      : null;
    // v2.11 T9 R4 (b): the token block's notes carry the earnkit.txt line for this repo.
    if (token && repoUrl) await noteLineIssued(ctx.installationId, repoUrl);
    const payoutWallet = given;
    const sign_to_enter = signToEnter(
      program_id,
      repoUrl,
      payoutWallet,
      known.answers?.contracts,
    );
    // v2.4 §2: the one confirmation the builder sees, prize first. Campaigns: the token is one row.
    const table = confirmTable({
      // Fix round 1 (Minor 6): the repo name, as the token is named, before "Your project".
      project: known.project?.name?.trim() || titleCase(repoNameOf(repoUrl) ?? '') || 'Your project',
      programTitle:
        program.campaign?.kind === 'sponsor'
          ? quoted(program.title)
          : program.title,
      campaign: program.campaign,
      prize: program.summary.split(' · ')[0],
      endsAt: program.ends_at,
      payoutWallet,
      missing,
      askWallet: ask.wallet,
      token: token
        ? {
            symbol: token.proposed.symbol,
            name: token.proposed.name,
            wallet: token.creator_wallet,
            hasBonus: token.has_bonus,
            coinIn: token.repo_coin_program,
          }
        : null,
    });
    if (program.campaign)
      return withAlerts(ctx, {
        program_id,
        ...(!open && { warning: 'This program is closed or past its deadline.' }),
        show_to_builder: table,
        ...prep,
        ...(ask.note && { payout_wallet_note: ask.note }),
        // v2.8 Ruling 23 (plan): how_to_submit and sign_to_enter only while the campaign is open.
        ...(open && {
          how_to_submit:
            'This is an EarnKit campaign: confirm is the entry; there is no other site. ' +
            `Commit ${OWNERSHIP_FILE} at the repo root (default branch) with the line "payout_wallet: <the payout wallet>" ` +
            "in one commit, together with the token line if the builder keeps the token. Contracts count when they were deployed from the payout wallet, or from your own wallet if you pass deployer_signature: that wallet's EIP-191 signature (personal_sign) of sign_to_enter, which names this program, the repo, the payout wallet and the contracts (it appears once all are known; a changed contract list needs a new signature).",
          ...(sign_to_enter && { sign_to_enter }),
        }),
        ...(token && { token }),
        ...(hosting && { host: hosting }),
      }, signed_in);

    // v2.8 Part D, Ruling 26 (plan): the coach. Every answer so far (the agent's draft, the bank and
    // the project info); then at most 3 questions (1 once the project has banked answers) for what
    // only the builder can say. While there are questions, they are the whole screen.
    const values: Record<string, string> = {
      ...(known.answers ?? {}),
      ...Object.fromEntries(prep.complete.map((c) => [c.key, c.value])),
    };
    const coach = {
      fields: coachFields(program.submission_requirements),
      facts: {
        chains: program.chains,
        live_url: known.project?.live_url ?? null,
        repo_url: repoUrl ?? null,
      },
      // C13: the program's judging criteria, for the agent to draft toward (never keyword-checked).
      judging: (program.judging?.criteria ?? []).map((c) => c.text),
      from_bank: banked?.from_bank ?? {},
    };
    const coachQuestions = (wallet: { hasBonus: boolean } | null) =>
      questionsFor({
        reqs: program.submission_requirements,
        answers: values,
        first: banked?.first ?? true,
        project: banked?.name,
        suggested: banked?.suggested,
        wallet,
        shared: ctx.sharedClient,
      });
    let questions = open && !coach_asked ? coachQuestions(null) : [];
    // v2.8.1 §C11: with a round to ask anyway, the wallet is asked in it, so the confirmation is a
    // single yes; only when this entry would get a token and no wallet is known (given, this entry's
    // own, or remembered). The answer comes back as answers.payout_wallet (the wallet given).
    const askWallet = questions.length > 0 ? await walletToAsk(program, repoUrl, agent?.can_push !== false || githubVerifyEnabled(), given, remembered, known.project?.name, ctx) : null;
    if (askWallet) questions = coachQuestions(askWallet);
    const intro = coachIntro(program.title, questions);
    // v2.8.1 T7 (audit J1): a builder with no repo who picks a program that needs one hears it with
    // the questions, never only after answering them, and gets a program they can enter as they are.
    const repoFirst = intro && program.needs_repo && !repoUrl ? await needsRepoLine(program) : null;
    if (intro)
      return withAlerts(ctx, withGuide({
        program_id,
        show_to_builder: [lead, repoFirst, intro].filter(Boolean).join('\n\n'),
        questions,
        coach,
        ready: false,
        missing: checkedPrep.missing,
        agent_note: askWallet ? `${QUESTIONS_NOTE} ${WALLET_ANSWER_NOTE}` : QUESTIONS_NOTE,
        ...(hosting && { host: hosting }),
      }), signed_in);

    // v2.8 Part C, Ruling 4 (plan): other programs. Once ready, the draft, the check's fixes and the
    // confirmation offer (the builder bonus comes with a token) close the screen; the kit comes only
    // from confirm_entry, so no submission link, prefilled link or paste list here.
    const canPush = agent?.can_push !== false;
    const facts = open && prep.ready ? await offerFacts(program, repoUrl, ctx) : null;
    // Fix round 1 (item 1): the wallet this entry already holds comes first; a "go" without a
    // wallet launches to it, so it is the one shown.
    const stored = given || join || !facts
      ? null
      : await entryWallet(ctx, {
          programId: program.id,
          installationId: ctx.installationId,
          repoUrl: repoUrl ?? null,
          name: known.project?.name?.trim() || titleCase(repoNameOf(repoUrl) ?? ''),
        });
    const offerWallet = join?.wallet ?? given ?? stored ?? remembered;
    // Fix round 1 (§A2): the pair the Yes line shows is stored; the one shown before wins (stable).
    const shownKey = offerKey(repoUrl ?? null, known.project?.name?.trim() || titleCase(repoNameOf(repoUrl) ?? ''));
    // v2.10 fix round 1 (I2): a stored pair means the confirm line was shown already in this flow,
    // so it is said again without the earnings part ("40%" once).
    const shownBefore = facts && token ? await readOffer(ctx.installationId, program.id, shownKey).catch(() => null) : null;
    const shownPair: Offered | null = facts && token ? (shownBefore ?? { name: token.proposed.name, symbol: token.proposed.symbol }) : null;
    // v2.9 B9: with GitHub sign-in on, an agent that can't push still offers the token.
    const signIn = githubVerifyEnabled();
    // v2.9 B10: no token offer once the repo's token is this program's, or after two skips (P23).
    const prepTokensOff = facts !== null && (facts.policyOff || !facts.available || facts.declinedOut || facts.tokenHere || belowScore);
    if (shownPair && facts && !facts.coinIn && (canPush || signIn) && !prepTokensOff)
      await rememberOffer(ctx, program.id, shownKey, shownPair, offerWallet ?? null);
    const offer = facts
      ? confirmOffer({
          hasBonus: facts.hasBonus,
          coinIn: facts.coinIn,
          canPush,
          signIn,
          wallet: offerWallet,
          tokensOff: prepTokensOff,
          belowScore,
          proposal: shownPair,
          // v2.9 B10 (P21): the first reply's offer was skipped: no "40%" a second time.
          again: shownBefore !== null || facts.declinedOnce || facts.firstShown,
        })
      : null;
    const offersToken = facts !== null && !facts.coinIn && (canPush || signIn) && !prepTokensOff;
    // v2.12.1 T10 (spec 3b): built through EarnKit, the reply that confirms the app is live asks the
    // coin as its one yes ("It's live. Want to launch a coin for it?"), the wallet shown, in place of
    // the v2.11 confirm line. Flag off (or no token here): the v2.11 line as before.
    const builtCoin = Boolean(join && !join.noLive && builderScoreEnabled() && offersToken && offer && offer !== READY_TO_SUBMIT);
    const pitch = builtCoin ? coinLine('built_live', known.project?.name?.trim() || 'it', offerWallet ?? null, shownPair) : offer;
    // Fix round 1 (minor): the built_live moment is recorded when its line is shown (here), with its wallet.
    if (builtCoin) {
      const built = await buildEntryKey(ctx, program_id, repoUrl).catch(() => null);
      if (built)
        await showBuiltLive(ctx.installationId, built, offerWallet ?? null).catch((err: unknown) =>
          console.error('[prepare] coin moment', err instanceof Error ? err.name : 'error'),
        );
    }
    // Ruling 25 (plan) / Part C: the token line, once the repo is known, for the agent to push with
    // its work before the builder confirms (an agent that can't push gets none).
    // v2.13.1 O1 fix rounds 1 and 2 (rulings): under the Bench a coin's repo is proven by a proof branch, never a line.
    const branchProven = benchEnabled() && !ctx.sharedClient;
    const line = repoUrl && canPush && !branchProven && program.token_policy !== 'off' && !prepTokensOff ? tokenLineFor(ctx.installationId, repoUrl) : null;
    // v2.11 T9 R4 (b): when this installation was first shown the line for this repo.
    if (line && repoUrl) await noteLineIssued(ctx.installationId, repoUrl);
    // Part D.4: the check before submitting, never blocking; shown with the draft once ready.
    const checked = prep.ready
      ? preSubmitCheck({
          reqs: program.submission_requirements,
          answers: values,
          judging: program.judging ?? null,
          knownLinks: [repoUrl ?? '', known.project?.live_url ?? ''],
        })
      : [];
    const fixes = [...(failedCheck ? [failedCheck] : []), ...checked.filter((f) => f.for === 'builder')];
    const agent_fixes = checked.filter((f) => f.for === 'agent');
    const show_to_builder = lead && prep.ready
      ? [lead, fixesLine(fixes), pitch].filter((x): x is string => Boolean(x)).join('\n')
      : lead
        ? `${lead}\n\n${table}`
        : prep.ready
      ? [
          draftTable(program.submission_requirements, values),
          fixesLine(fixes),
          offer ? (offer.endsWith(READY_TO_SUBMIT) ? offer : `Ready. ${offer}`) : null,
        ]
          .filter((x): x is string => Boolean(x))
          .join('\n\n')
      : table;
    // v2.11 T10: on the build path earnkit.txt already holds the line (the build's proof), and there is no table.
    const notes = [
      line && !join && TOKEN_LINE_NOTE,
      ...(prep.ready ? [agent_fixes.length > 0 && AGENT_FIXES_NOTE, join ? (builtCoin ? BUILD_COIN_NOTE : belowScore ? BUILD_ENTRY_NO_TOKEN_NOTE : BUILD_ENTRY_NOTE) : DRAFT_NOTE, fixes.length > 0 && FIXES_NOTE] : [COACH_NOTE]),
    ].filter(Boolean);
    return withAlerts(ctx, withGuide({
      program_id,
      ...(!open && { warning: 'This program is closed or past its deadline.' }),
      show_to_builder,
      // Ready: the fixes, and what came from the bank (for the agent to re-angle); else the guidance.
      ...(prep.ready
        ? {
            fixes,
            ...(agent_fixes.length > 0 && { agent_fixes }),
            ...(Object.keys(coach.from_bank).length > 0 && { from_bank: coach.from_bank }),
          }
        : { coach }),
      // Review Minor 7: the final values are the kit's job (confirm_entry); this is the draft check.
      // v2.9 A5: readiness and missing items include this step's checks.
      ...checkedPrep,
      complete: checkedPrep.complete.map((c) => ({ key: c.key, label: c.label, filled_from: c.filled_from })),
      ...(token && {
        token: {
          proposed: shownPair ? { ...token.proposed, ...shownPair } : token.proposed,
          chain: token.chain,
          creator_wallet: token.creator_wallet,
          has_bonus: token.has_bonus,
          repo_coin_program: facts?.coinIn ?? null,
        },
      }),
      // Ruling 30: the wallet the builder sees on the offer's wallet line, to echo as confirm_entry's
      // wallet once they say yes. confirm_entry never reads the remembered wallet itself.
      ...(offersToken && offerWallet && { shown_wallet: offerWallet }),
      ...(line && { token_line: line }),
      ...(notes.length > 0 && { agent_note: notes.join(' ') }),
      ...(join && { entry: { project: known.project ?? {}, answers: known.answers ?? {} } }),
      ...(hosting && { host: hosting }),
    }), signed_in);
  },

  // v2.8 Part C, Rulings 1, 4, 5 and 7 (plan): the confirmation step. Without the builder's yes it
  // returns the offer; on "go" the token launches; the submit kit comes only from here.
  confirm_entry: async (input: unknown, ctx: ToolContext) => {
    // v2.8.1 §A5: the reply comes within 50 s; a deploy still running then answers "launching".
    const deadline = Date.now() + launchReplyMs();
    const i = ConfirmEntryInput.parse(input);
    const program = await getProgramRow(i.program_id);
    if (program.campaign) throw new EntryError('EarnKit campaigns are entered in one step.');
    if (!isOpen(program)) throw new EntryError('This program is closed or past its deadline.');
    // Ruling 22: a wallet given is valid or the call fails (a typo never falls back to another).
    const given = givenWallet(i.wallet);
    // v2.8.1 §C11: the wallet from the coach's round, only ever shown (the offer's wallet line, the
    // wallet question): a "go" launches to the wallet passed with it (Ruling C12), never to this.
    const answered = givenWallet(i.answers[WALLET_KEY]);
    const repoUrl = i.project.repo_url ?? i.answers.repo_url ?? null;
    // v2.8 Part D: the bank fills what the draft showed from it, so the kit and the snapshot match it.
    const banked = await bankedAnswers(ctx.installationId, program, i.project, repoUrl, i.answers, ctx.sharedClient);
    const answers = banked.answers;
    // Every answer (the agent's, the bank's, plus what the project info fills), in the form's order.
    const filled = prepareSubmission(program.submission_requirements, {
      project: { ...i.project, ...(repoUrl && { repo_url: repoUrl }) },
      answers,
    });
    const values = Object.fromEntries(filled.complete.map((c) => [c.key, c.value]));
    // v2.9 A5: this step's link and contract checks: stored on the entry, read for completeness,
    // and a failed one is one fix line (never blocking).
    const verified = await entryChecks(program, i.project, answers, ctx);
    const failedCheck = checkFix(verified, entryLiveUrl(program, i.project, answers) !== null);
    // Part D.4: the check before submitting, run before the decision; never blocking.
    const fixes = [
      ...(failedCheck ? [failedCheck] : []),
      ...preSubmitCheck({
        reqs: program.submission_requirements,
        answers: values,
        judging: program.judging ?? null,
        knownLinks: [repoUrl ?? '', i.project.live_url ?? ''],
      }),
    ];
    const canPush = i.agent?.can_push !== false;
    // v2.9 B9: with GitHub sign-in on, an agent that can't push still offers and launches the token.
    const signIn = githubVerifyEnabled();
    // Ruling G12: whose token declines count (a shared client: the pasted code's login, else none).
    const declinedBy = declineLogin(ctx, ctx.sharedClient ? await sharedLogin(ctx, i.signed_in, 'confirm_entry') : undefined);
    const facts = await offerFacts(program, repoUrl, ctx, declinedBy);
    // v2.12.1 T10 (spec 3b): with the score flag on, no token unless it is pitched here: a yes records only.
    const belowScore = !(await tokenPitch(ctx, program.id, repoUrl));
    const decision = confirmDecision({
      confirmed: i.builder_confirmed === true,
      decision: i.decision,
      coinIn: facts.coinIn,
      canPush,
      hasRepo: Boolean(repoUrl),
      // Pre-flight P23: skipped twice, the repo is tokens off ("go" gets the kit, no token).
      policyOff: facts.policyOff || facts.declinedOut,
      available: facts.available,
      signIn,
      belowScore,
    });
    // v2.9 B10: the offer is "Ready to submit?" alone once the repo's token is this program's.
    const tokensOff = facts.policyOff || !facts.available || facts.declinedOut || facts.tokenHere || belowScore;
    const offersToken = !facts.coinIn && (canPush || signIn) && !tokensOff;
    if (decision.kind === 'offer') {
      // Fix round 1 (item 1): the entry's own wallet first (a "go" without a wallet uses it), then
      // the remembered one; whichever is shown comes back as shown_wallet.
      const stored = given ?? answered
        ? null
        : await entryWallet(ctx, { programId: program.id, installationId: ctx.installationId, repoUrl, name: i.project.name });
      const wallet = given ?? answered ?? stored ?? (await walletMemory(ctx));
      // v2.8.1 §A2: the Yes line names the token that launches: the builder's own edit, else EarnKit's proposal.
      const key = offerKey(repoUrl, i.project.name);
      const shown = offersToken ? await readOffer(ctx.installationId, program.id, key).catch(() => null) : null;
      const proposal = offersToken ? await offerProposal(i.project.name, repoUrl, i.token, shown, ctx) : null;
      const pair = proposal && { name: proposal.name, symbol: proposal.symbol };
      if (pair) await rememberOffer(ctx, program.id, key, pair, offersToken ? (wallet ?? null) : null);
      return {
        show_to_builder:
          (proposal?.taken ? `$${proposal.taken} is taken. ` : '') +
          confirmOffer({ hasBonus: facts.hasBonus, coinIn: facts.coinIn, canPush, signIn, wallet, tokensOff, belowScore, proposal: pair, again: Boolean(proposal?.taken) || shown !== null || facts.declinedOnce || facts.firstShown }),
        ...(offersToken && wallet && { shown_wallet: wallet }),
        ...(pair && { token: { proposed: pair } }),
        agent_note:
          'Show show_to_builder as written. When the builder says yes, call confirm again with yes: true' +
          (offersToken ? ' and wallet: shown_wallet (or the wallet they name instead)' : '') +
          (proposal ? ', and token: token.proposed (the name and ticker the builder saw)' : '') +
          '; when they say skip the token, skip_token: true.',
      };
    }

    // v2.10 item 11: a "go" or "skip" waits until every description field is plain words.
    const unplain = plainRefusal(fixes);
    if (unplain) return unplain;

    // Each confirmation may read GitHub and tokens.fun: bounded per hour, like record_submission.
    await enforce('entryChecks', ctx.installationId, 'This agent has checked 60 entries in the last hour.');
    const entry = await startEntry({
      program,
      installationId: ctx.installationId,
      project: i.project,
      answers,
      choice: decision.kind === 'skip' ? 'skip' : 'go',
      now: new Date(),
      verified,
      // A new entry counts against the 20 a day (Ruling 1 (plan)); an update never does.
      charge: () => enforce('recordSubmission', ctx.installationId, 'This agent has recorded 20 submissions today, the daily limit.'),
    });
    await siteExpiryAfterEntry(repoUrl, 'confirm_entry');
    // v2.9 B10: a skip to the token offer counts toward the repo's two (then never offered again).
    if (decision.kind === 'skip' && offersToken && repoUrl && !entry.token_url)
      await declineOffer(ctx, declinedBy, program.id, repoUrl, i.project.name).catch((err: unknown) =>
        console.error('[confirm_entry] decline', err instanceof Error ? err.name : 'error'),
      );
    // v2.12.1 T10 (spec 3b): the build entry's answer to its built_live coin, for the weekly metric
    // (a yes with the token: accepted; skip: declined, one of the two). Never fails the confirmation.
    if (offersToken && builderScoreEnabled() && (decision.kind === 'skip' || ((decision.kind === 'launch' || decision.kind === 'sign_in') && entry.confirm_choice === 'go'))) {
      const built = await buildEntryKey(ctx, program.id, repoUrl).catch(() => null);
      if (built)
        await builtLiveAnswer(ctx.installationId, built, decision.kind === 'skip' ? 'no' : 'yes', entry.id).catch((err: unknown) =>
          console.error('[confirm_entry] coin answer', err instanceof Error ? err.name : 'error'),
        );
    }
    // v2.9 A8: the entry's product score as matching showed it, for the program's match floor. Never
    // fails the confirmation. Ruling G7: not on a shared client (nothing is recorded there).
    if (remembers(ctx))
      await saveEntryScore(entry.id, ctx.installationId, repoKey({ url: repoUrl, name: i.project.name })).catch((err: unknown) =>
      console.error('[confirm_entry] product score', entry.id, err instanceof Error ? err.name : 'error'),
    );

    // Part D.5, Ruling 6 (plan): the final answers and the check on the entry, and the answer bank
    // for this project's next program. Neither ever fails the confirmation; errors log the class only.
    try {
      await saveApplication(ctx.installationId, entry.id, applicationOf(program.submission_requirements, values, fixes, new Date()));
    } catch (err) {
      console.error('[coach] application', entry.id, err instanceof Error ? err.name : 'error');
    }
    if (banked.key)
      try {
        await saveBank(ctx.installationId, banked.key, program.id, program.submission_requirements, values);
      } catch (err) {
        console.error('[coach] bank save', entry.id, err instanceof Error ? err.name : 'error');
      }

    // Fix round 1 (§A2): the Yes line (again), for a "go" that would launch a pair the builder didn't
    // see; `taken`: the ticker shown before, now taken. No kit, nothing launched. Final fix wave (M8):
    // `again` only when a Yes line was shown before; a first offer (the draft had none) names the 40%.
    const reoffer = async (projectId: number, proposal: Offered, taken: string | null, again = true) => {
      const wallet =
        given ??
        answered ??
        (await entryWallet(ctx, { programId: program.id, installationId: ctx.installationId, repoUrl, name: i.project.name })) ??
        (await walletMemory(ctx));
      await rememberOffer(ctx, program.id, offerKey(repoUrl, i.project.name), proposal, wallet ?? null);
      const offer = confirmOffer({ hasBonus: facts.hasBonus, coinIn: null, canPush, signIn, wallet, proposal, belowScore, again: again || facts.declinedOnce || facts.firstShown });
      return {
        project_id: projectId,
        token: { status: 'skipped' as const, fixable: true, proposed: proposal },
        show_to_builder: taken ? `$${taken} is taken. ${offer}` : offer,
        ...(wallet && { shown_wallet: wallet }),
        agent_note:
          'Nothing launched: the builder has not seen this token yet. Show show_to_builder as written; when the builder says yes, ' +
          'call confirm again with yes: true, wallet: shown_wallet (or the wallet they name), and token: token.proposed.',
      };
    };

    let token: TokenOutcome | null = null;
    if (entry.token_url)
      // v2.8.1 §A1, §A5: launching (the next call has the result), or stuck past 10 minutes.
      token = entry.token_url === 'pending'
        ? pendingOutcome(entry.token_claimed_at, entry.token_settled)
        : { status: 'launched', tokens_fun: entry.token_url, note: 'This entry already has its token.' };
    else if ((decision.kind === 'launch' || decision.kind === 'sign_in') && entry.confirm_choice === 'go') {
      // Fix round 1 (§A2): "go" launches exactly the pair the Yes line showed. With no pair stored, or
      // an agent asking for another name or ticker, the Yes line is shown (again) first: nothing
      // launches that the builder didn't see. A check-back is a read and skips this.
      const key = offerKey(repoUrl, i.project.name);
      const shown = i.check_back ? null : await readOffer(ctx.installationId, program.id, key).catch(() => null);
      const asked = i.token ? editsOf(i.token) : {};
      const differs = shown && ((asked.name !== undefined && asked.name !== shown.name) || (asked.symbol !== undefined && asked.symbol !== shown.symbol));
      if (!i.check_back && (!shown || differs)) {
        const proposal = await offerProposal(i.project.name, repoUrl, i.token, shown, ctx);
        if (proposal) {
          const pair = { name: proposal.name, symbol: proposal.symbol };
          return reoffer(entry.id, pair, proposal.taken ?? null, shown != null);
        }
      }
      token = await confirmToken(
        {
          projectId: entry.id,
          installationId: ctx.installationId,
          token: shown ?? i.token,
          wallet: given,
          deadline,
          checkBack: i.check_back === true,
          // Rulings G8, G9: on a shared client only the sign-in of the code this builder pasted counts.
          verifiedLogin: ctx.sharedClient ? await sharedLogin(ctx, i.signed_in, 'confirm_entry') : undefined,
        },
        ctx.tokenDeps,
      );
      // Fix round 1: the shown ticker was taken since: the next suggestion, as a new Yes line.
      if (token.ticker_taken && token.symbol) {
        const next = { name: token.name ?? shown?.name ?? i.project.name, symbol: token.symbol };
        return reoffer(entry.id, next, token.ticker_taken);
      }
      // v2.9 B9: the GitHub sign-in link, for an agent that can't push, after a proof-line miss
      // (Pre-flight P10), or when only a sign-in proves the launch (G10: a shared client; G11: the
      // wallet changed since the sign-in). Bound to this entry, its repo, and the wallet and ticker
      // of this "go" (G11; the flow asked for a wallet before the gate, so `given` is set).
      const stop = token.fixable === true && (token.proof_line === true || token.sign_in_needed !== undefined);
      const symbol = token.symbol ?? shown?.symbol ?? null;
      const link =
        stop && signIn && repoUrl && given && (decision.kind === 'sign_in' || entry.proof_line_missed || token.sign_in_needed)
          ? await createVerifyLink({
              installationId: ctx.installationId,
              projectId: entry.id,
              repoKey: repoKey({ url: repoUrl, name: i.project.name }),
              purpose: 'entry',
              wallet: given,
              symbol,
            })
          : null;
      const signLine =
        link &&
        (token.sign_in_needed === 'wallet_changed' ? `${WALLET_CHANGED} Sign in again: ${link}` : signInLine(i.project.name, symbol, link));
      // The first "go" of an agent that can't push: the sign-in line, no kit yet.
      const signNote = ctx.sharedClient ? `${SIGN_IN_NOTE} ${SIGN_IN_CODE_NOTE}` : SIGN_IN_NOTE;
      if (signLine && !entry.proof_line_missed)
        return {
          project_id: entry.id,
          token: { ...token, fixable: true, sign_in: link, agent_note: signNote },
          show_to_builder: signLine,
          agent_note: signNote,
        };
      // Ruling C24, v2.8.1 §A3: never a dead end. The proof line still isn't on the repo after an
      // earlier "go" stopped on it: the entry records without a token, the kit comes back, and the
      // builder reads exactly what the token waits on (never "open this in another agent": this
      // agent can push). The launch stays open: "go" again launches it. v2.9 B9 (P10): with sign-in
      // on, the link comes too (alone for an agent that can't push).
      if (stop && entry.proof_line_missed) {
        const pushNote = token.agent_note?.replace(CANT_PUSH_RETRY_NOTE, '').trim();
        const agentNote = signLine ? (canPush ? `${pushNote ? `${pushNote} ` : ''}${SIGN_IN_OR_NOTE}` : signNote) : pushNote;
        token = {
          status: 'skipped',
          note: signLine
            ? canPush && token.proof_line
              ? `${proofLineWaiting(token.proof_branch)}\n${signLine}`
              : signLine
            : proofLineWaiting(token.proof_branch),
          ...(link && { sign_in: link }),
          ...(agentNote && { agent_note: agentNote }),
        };
      }
      // Fixable (no wallet, a ticker, the proof line, a transient read): no kit; fix it and confirm again.
      else if (token.fixable) {
        // Fix round 2: no wallet passed with this "go": nothing launched. The entry's stored wallet,
        // else the remembered one, is suggested as a question, never used unseen.
        const remembered = token.no_wallet
          ? (answered ??
            (await entryWallet(ctx, { programId: program.id, installationId: ctx.installationId, repoUrl, name: i.project.name })) ??
            (await walletMemory(ctx)))
          : null;
        // v2.9 B9: with sign-in on, an agent that can't push gets the sign-in line, not a record without a token.
        const pushNote = signIn && token.proof_line ? token.agent_note?.replace(CANT_PUSH_RETRY_NOTE, CANT_PUSH_SIGN_IN_NOTE) : token.agent_note;
        const agentNote = remembered ? 'Pass shown_wallet as wallet once the builder confirms it.' : pushNote;
        return {
          project_id: entry.id,
          token,
          show_to_builder: token.no_wallet
            ? remembered
              ? walletQuestion(remembered, facts.hasBonus)
              : NO_WALLET_HINT
            : token.note || TOKEN_ERROR_CONFIRM,
          ...(token.no_wallet && remembered && { shown_wallet: remembered }),
          agent_note: `${agentNote ? `${agentNote} ` : ''}The submit kit comes only in confirm's reply, once this is fixed.`,
        };
      }
    } else if (decision.kind === 'launch' && entry.confirm_choice === 'skip')
      token = { status: 'skipped', note: SKIPPED_ENTRY };

    // v2.8.1 §A5: the deploy runs on past the reply time: "launching", no kit yet; the agent calls
    // again shortly and that call returns the token's link with the kit.
    if (token?.launching)
      return {
        project_id: entry.id,
        token,
        show_to_builder: token.note ?? LAUNCHING,
        agent_note: `${token.agent_note ?? ''} The submit kit comes with that reply.`.trim(),
      };

    // v2.12 spec 7 (R22): under the pitch score the token was never offered, so nothing is said about it.
    const skipLine = belowScore ? '' : facts.hasBonus ? 'No token, no builder bonus.' : 'No token.';
    const first =
      decision.kind === 'skip' && !entry.token_url
        ? skipLine
        : tokenLine(token, decision.kind === 'record_only' ? decision.note : skipLine);
    // Ruling C9: an incomplete entry still gets its token; the kit names what is missing first and
    // marks each missing (or invalid) required answer as a blank, never dropping it.
    const kit: SubmitKit = submitKit(
      program,
      values,
      { browser: i.agent?.browser === true },
      { problems: filled.missing.filter((m) => m.problem).map((m) => m.key) },
    );
    // v2.9 E19 (Ruling 13): the weekly email question, last, once per installation.
    const email = entryEmail(program.submission_requirements, values);
    return withEmailQuestion(
      ctx,
      {
        project_id: entry.id,
        ...(token && { token }),
        kit,
        // v2.8.1 §C13: a repo whose token is in another program: the kit alone (no bonus note here).
        show_to_builder: first ? `${first}\n\n${kit.show_to_builder}` : kit.show_to_builder,
        // Part E, Rulings 7, 27, 28 (plan): how this kit is used (the agent's, never the builder's).
        // v2.9 F25: the kit rules that left confirm_entry's description are here.
        agent_note: kitReplyNote(kit, program),
      },
      email,
      Object.values(banked.suggested).some((v) => cleanEmail(v) === email),
      i.signed_in,
    );
  },

  record_submission: async (input: unknown, ctx: ToolContext) => {
    // v2.8.1 §A5: the reply comes within 50 s; a deploy still running then answers "launching".
    const deadline = Date.now() + launchReplyMs();
    const parsed = RecordSubmissionInput.parse(input);
    const program = await getProgramRow(parsed.program_id);
    // v2.10 item 11, Pre-flight P32: an EarnKit campaign is confirmed here (one step), so its
    // description fields get confirm_entry's plain-words check before anything is read or recorded.
    if (program.campaign) {
      const filled = prepareSubmission(program.submission_requirements, { project: parsed.project, answers: answersOf(parsed.submission_data) });
      const values = Object.fromEntries(filled.complete.map((c) => [c.key, c.value]));
      const plain = preSubmitCheck({ reqs: program.submission_requirements, answers: values, judging: null }).filter((f) => f.rule === 'not_plain');
      const unplain = plainRefusal(plain);
      if (unplain) return unplain;
    }
    // Every attempt reads GitHub, Base and the explorer, and (v2.5 §3, external programs) the
    // submission proof page: bounded per hour. Only a recorded entry uses one of the 20 a day
    // (v2.4 §2).
    await enforce(
      'entryChecks',
      ctx.installationId,
      'This agent has checked 60 entries in the last hour.',
    );
    // v2.9 A5: this step's link and contract checks, stored on the entry and read for completeness.
    const verified = await entryChecks(program, parsed.project, answersOf(parsed.submission_data), ctx);
    const result = await recordSubmission(parsed, ctx.installationId, {
      program,
      verified,
      // v2.9 B9 (fix round 2): a shared client keeps a wallet on an entry only once the gate passed.
      keepWallet: !ctx.sharedClient,
      ...ctx.entryDeps,
      charge: () =>
        enforce(
          'recordSubmission',
          ctx.installationId,
          'This agent has recorded 20 submissions today, the daily limit.',
        ),
    });
    await setWorkingOn(ctx.installationId, parsed.program_id, false);
    await siteExpiryAfterEntry(parsed.project.repo_url ?? answersOf(parsed.submission_data).repo_url, 'record_submission');
    // The token never fails the submission: it is recorded either way. Fix round 1 (I1): an
    // updated entry that already has its coin keeps it (no second launch, no refusal shown).
    // v2.8 Ruling 1 (plan): an entry that passed the confirmation step had its token decided there;
    // no token flow runs here, the row's token is reported.
    const confirmed = 'confirm_choice' in result ? result.confirm_choice : null;
    const hasCoin = 'coin_url' in result && Boolean(result.coin_url);
    // Final review I3: a confirmed "go" with no token, whose repo's one token is entered in another
    // program (Ruling 5 (plan)): no token here by design, said as the confirmation said it.
    const countsIn = confirmed === 'go' && !hasCoin ? await tokenElsewhere(parsed, ctx) : null;
    const token: TokenOutcome = 'coin_url' in result && result.coin_url
      ? result.coin_url === 'pending'
        ? // v2.8.1 §A1: launching, or stuck past 10 minutes (the cron has alerted the owner).
          // Fix round 1 (Minor 8): read again; a launch that settled since is reported as it is.
          (({ token_url, claimedAt, settled, note }) =>
            token_url === 'pending'
              ? pendingOutcome(claimedAt, settled)
              : token_url
                ? ({ status: 'launched', tokens_fun: token_url } satisfies TokenOutcome)
                : ({ status: 'failed', note: note ?? NOT_LAUNCHED_YET } satisfies TokenOutcome))(await launchClaimedAt(result.project_id))
        : { status: 'launched', tokens_fun: result.coin_url, note: 'This entry already has its token.' }
      : confirmed
        ? {
            status: 'skipped',
            note:
              confirmed === 'skip'
                ? SKIPPED_ENTRY
                : countsIn
                  ? // v2.10 item 1: no second bonus form ("rides on") in the reply.
                    `${REPO_HAS_TOKEN}.`
                  : "This entry's token isn't launched.",
          }
        : await submissionToken(
      {
        projectId: result.project_id,
        installationId: ctx.installationId,
        choice: parsed.token,
        confirmed: parsed.builder_confirmed === true,
        // Ruling 22: the wallet given with this entry goes straight to the token flow (recordSubmission
        // validated it). Ruling 30: it is the only wallet from this call; the remembered one is never
        // read here (the agent echoes prepare_submission's shown_wallet). None: no coin yet.
        givenWallet: 'campaign_entry' in result ? null : (parsed.payout_wallet?.trim() || null),
        checkBack: parsed.check_back === true,
        // Rulings G9, G10: on a shared client only the sign-in of the code this builder pasted counts.
        verifiedLogin: ctx.sharedClient ? await sharedLogin(ctx, parsed.signed_in, 'record_submission') : undefined,
      },
      ctx.tokenDeps,
      deadline,
    );
    // v2.9 E19 (Ruling 13): the weekly email question, last, once per installation. P16: on a shared
    // client an address the answer bank holds for this project is never named (it may be another builder's).
    const askEmail = async <T extends { show_to_builder: string; agent_note?: string }>(reply: T) => {
      if (!('project_id' in result)) return reply;
      const submitted = answersOf(parsed.submission_data);
      const email = entryEmail(program.submission_requirements, submitted);
      const reused =
        Boolean(ctx.sharedClient && email) &&
        (await bankedEmail(ctx.installationId, projectKey({ repo_url: parsed.project.repo_url ?? submitted.repo_url, name: parsed.project.name }))) === email;
      return withEmailQuestion(ctx, reply, email, reused, parsed.signed_in);
    };
    // Campaign entries carry their own table (enteredTable).
    if ('show_to_builder' in result && result.show_to_builder)
      return withAlerts(ctx, await askEmail({ ...result, show_to_builder: result.show_to_builder, token }), parsed.signed_in);
    // v2.6 §3: outside campaigns, the reply the builder sees: the coin, then the bonus round.
    // Ruling 29: the round's end as the first message shows it.
    const endsLabel = result.bonus_round?.ends_label ?? null;
    const repoHeld = 'repo_held' in result && result.repo_held === true;
    // M1: a held repo can't get a coin here, so never ask the agent to launch one.
    const tokenOut = repoHeld && token.no_wallet
      ? { status: token.status, note: 'No token: another entry of this repo in this program already has its token (one token per repo).' }
      : token.no_wallet
        ? // Ruling 31's split here too: plain note, the instruction (noCoinYet) for the agent.
          { ...token, note: 'No token yet: no wallet was given.', agent_note: noCoinYet(endsLabel) }
        : token;
    // Skipped: the builder said no, the program has no coins, or (Ruling 25) the repo has its coin.
    const skipped =
      parsed.token === 'skip' ||
      confirmed === 'skip' ||
      countsIn !== null ||
      result.token_policy === 'off' ||
      Boolean(token.note?.startsWith(REPO_HAS_TOKEN));
    const coin: EnteredText['coin'] =
      token.status === 'launched' && token.tokens_fun
        ? { status: 'launched', url: token.tokens_fun }
        : token.no_wallet
          ? { status: 'no_wallet' }
          : skipped
            ? { status: 'skipped' }
            : token.status === 'pending'
              ? { status: 'pending', stuck: !token.launching }
              : {
                  status: 'other',
                  ...(token.needs && { needs: token.needs }),
                  // Fix round 1 (Minor 12): the reply time ran out before the deploy: said as such.
                  ...(token.note === STILL_CHECKING_LAUNCH && { note: token.note }),
                };
    let bonus: EnteredText['bonus'] = null;
    // v2.12 final review (T9), v2.12.1 T10: no bonus line where no token is pitched, unless their token is live.
    if (result.bonus_round && coin.status !== 'skipped' && (coin.status === 'launched' || (await tokenPitch(ctx, parsed.program_id, parsed.project.repo_url ?? answersOf(parsed.submission_data).repo_url)))) {
      const pool = (await poolsOf(ctx.roundPools ?? roundPools, [parsed.program_id])).get(parsed.program_id);
      // v2.10 item 1: the one bonus line (no board link); null: the round froze (I2), so none.
      const line = bonusLine(pool);
      if (line) bonus = { line, join: 'bonus_join' in result ? result.bonus_join : null };
    }
    const also = await alsoQualifiesBlock(parsed, ctx, verified?.live === true).catch((err: unknown) => {
      console.error('[also_qualifies]', err instanceof Error ? err.name : 'error');
      return null;
    });
    const show_to_builder =
      enteredText({ programTitle: result.program_title, coin, bonus, repoHeld, countsIn }) + (also?.text ? `\n\n${also.text}` : '');
    return withAlerts(
      ctx,
      await askEmail({
        ...result,
        token: tokenOut,
        show_to_builder,
        ...(also?.rows.length && { also_qualifies: also.rows }),
      }),
      parsed.signed_in,
    );
  },

  // v2.8 Ruling C21: the builder's own answer to ask_outcome's question, for their own entry only
  // (another installation's is NotFoundError). Kept apart so list_programs stays read-only.
  // v2.8.1 §E18: the builder's yes or no to list_programs' "Pick up your N earlier entries?".
  pick_up_entries: async (input: unknown, ctx: ToolContext) => {
    const answer = yesNo((input as { answer?: unknown } | null)?.answer);
    // v2.12.1 fix round 1: with the score flag on, the same yes answers a pending join first.
    const join = builderScoreEnabled() && !ctx.sharedClient ? await pendingJoinOf(ctx.installationId) : null;
    if (join && answer === null)
      return { show_to_builder: joinQuestion(join.tie, join.side), agent_note: 'Ask the builder, then call tell with pickup: "yes" or "no".' };
    if (join && answer !== null) {
      const r = await answerJoin(ctx.installationId, answer);
      const here = join.side === 'joiner';
      if (r === 'linked') return { show_to_builder: here ? JOIN_TEXT.linkedHere : JOIN_TEXT.linked, agent_note: 'Call find again to show their page.' };
      if (r === 'waiting') return { show_to_builder: here ? JOIN_TEXT.waitingHere : JOIN_TEXT.waiting };
      if (r === 'declined') return { show_to_builder: here ? JOIN_TEXT.declinedHere : JOIN_TEXT.declined };
      if (r === 'refused') return { show_to_builder: JOIN_TEXT.refused, agent_note: 'On a yes, call find. Don\'t show this note.' };
      if (r === 'expired') return { show_to_builder: JOIN_TEXT.expired, agent_note: 'On a yes, call find. Don\'t show this note.' };
    }
    if (answer === null)
      return { show_to_builder: PICKUP_TEXT.unclear, agent_note: 'Ask the builder, then pass answer "yes" or "no".' };
    const r = await answerPickup(ctx.ownInstallationId ?? ctx.installationId, answer, ctx.pickupDeps);
    if (r.status === 'linked')
      return {
        show_to_builder: PICKUP_TEXT.linked,
        entries: r.entries,
        agent_note: 'Call find again to show their entries.',
      };
    if (r.status === 'declined') return { show_to_builder: PICKUP_TEXT.declined };
    if (r.status === 'none') return { show_to_builder: PICKUP_TEXT.none };
    if (r.unreadable)
      return { show_to_builder: PICKUP_TEXT.unreadable, agent_note: 'Call tell with pickup: "yes" again in a minute.' };
    return {
      show_to_builder: r.sign_in ? `${PICKUP_TEXT.proof}\n${PICKUP_TEXT.signIn} ${r.sign_in}` : PICKUP_TEXT.proof,
      ...(r.sign_in && { sign_in: r.sign_in }),
      agent_note:
        `Write the line "${r.line}" to earnkit.txt at the root of ${r.repo} (keep any lines already there) and push it ` +
        'yourself, to any branch; never ask the builder to edit files. Then call tell with pickup: "yes" again. ' +
        (r.sign_in
          ? 'If you can\'t push, the builder signs in with the link instead; when they say they signed in, call tell with pickup: "yes" again.'
          : "If you can't push, give the builder the line and where it goes."),
    };
  },

  // v2.9 A3: what the builder told EarnKit (programs: applied, not interested, their own outcomes;
  // repos: chains, live link, users, not theirs). It replaced report_outcome; list_programs stays read-only.
  // Ruling G6: on a shared client nothing about programs or repos is kept (memoryKey null).
  tell_earnkit: async (input: unknown, ctx: ToolContext) => {
    // v2.9 B9 (G6, G9): on a shared client, statements are kept only under the verified login of
    // the code the builder pasted.
    const told = TellInput.safeParse(input);
    const weekly = told.success ? told.data.weekly_email : undefined;
    // v2.9 E19 (Ruling 13): the weekly email answer alone stores no program or repo statement.
    const onlyEmail = weekly !== undefined && !told.data?.program_status?.length && !told.data?.repo_facts?.length;
    const login = told.success ? await sharedLogin(ctx, told.data.signed_in, 'tell_earnkit') : null;
    const key = memoryKey({ ...ctx, verifiedLogin: login });
    const { saved, outcomes } = onlyEmail
      ? { saved: [] as string[], outcomes: 0 }
      : await tell(ctx.installationId, input as Parameters<typeof tell>[1], undefined, key);
    // Ruling G21: only the caller's own subscription (a shared client's verified login; none without a code).
    const mail = weekly ? await saveWeeklyEmail(ctx.installationId, weekly, { shared: Boolean(ctx.sharedClient), login }) : null;
    if (mail?.saved) saved.push(`weekly email: ${weekly!.answer === 'yes' ? 'on' : 'off'}`);
    const mailNote =
      mail?.show_to_builder === WHICH_EMAIL
        ? "Ask the builder which email to use, then call tell again with weekly_email: { answer: 'yes', email }."
        : mail?.show_to_builder === EMAIL_SIGN_IN
          ? EMAIL_SHARED_NOTE
          : null;
    const show = [!onlyEmail && key === null ? NOTED_FOR_NOW : null, mail?.show_to_builder ?? null].filter(Boolean).join(' ');
    const note = onlyEmail ? 'Show show_to_builder.' : key === null ? TELL_SHARED_NOTE : TELL_SAVED_NOTE;
    return {
      ...(show && { show_to_builder: show }),
      saved,
      agent_note: [note, outcomes > 0 ? OUTCOME_SAVED_NOTE : null, mailNote].filter(Boolean).join(' '),
    };
  },

  launch_token: async (input: unknown, ctx: ToolContext) => {
    const parsed = LaunchTokenInput.parse(input);
    // v2.10 item 4: the v2.9 first reply's offer path is gone (no reply makes that offer since item 5);
    // an old launch_token call with an offer reaches confirm through its alias (aliases.ts).
    if (parsed.offer) throw new EntryError(OFFER_GONE);
    // v2.12.1 T10: no new token where none is pitched (tokenPitch; campaigns aside). T12 fix round 1:
    // flag off too, where only an earnkit-coin entry (made while it was on) is held; every real
    // program's entry launches as in v2.11.
    if (parsed.project_id !== undefined && !parsed.check_back && (await tokenHeld(ctx, parsed.project_id)))
      return withAlerts(ctx, { status: 'skipped', project_id: parsed.project_id, note: NO_TOKEN_HERE, show_to_builder: NO_TOKEN_HERE }, parsed.signed_in);
    const out = await launchToken(
      parsed,
      ctx.installationId,
      ctx.tokenDeps,
      // v2.8.1 §A5: the reply comes within 50 s; a deploy still running then answers "launching".
      Date.now() + launchReplyMs(),
      // Rulings G8, G9: on a shared client only the sign-in of the code this builder pasted counts.
      ctx.sharedClient ? await sharedLogin(ctx, parsed.signed_in, 'launch_token') : undefined,
    );
    // v2.9 B9: the proof line isn't there: with sign-in on, the one-time link proves the repo instead.
    // Ruling G10: on a shared client only the sign-in proves it; G11: the wallet changed since it.
    const stopped = [PROOF_LINE_PREFIX, SIGN_IN_FIRST, WALLET_CHANGED].some((p) => out.note?.startsWith(p));
    const signIn =
      out.status === 'gate_failed' && stopped && githubVerifyEnabled() && parsed.project_id !== undefined
        ? await entryVerifyLink(ctx.installationId, parsed.project_id)
        : null;
    return withAlerts(
      ctx,
      signIn
        ? {
            ...out,
            sign_in: signIn.link,
            sign_in_line: out.note?.startsWith(WALLET_CHANGED)
              ? `${WALLET_CHANGED} Sign in again: ${signIn.link}`
              : signInLine(signIn.name, out.symbol ?? null, signIn.link),
            agent_note:
              `${out.agent_note ? `${out.agent_note} ` : ''}If you can't push, show sign_in_line instead; ` +
              'when the builder says they signed in, call confirm again with project_id and yes: true' +
              (ctx.sharedClient ? ' with signed_in: the code the sign-in page gave them.' : '.'),
          }
        : out,
      parsed.signed_in,
    );
  },
} satisfies Record<
  string,
  (input: unknown, ctx: ToolContext) => Promise<unknown>
>;

/**
 * v2.10 item 4 (R15, R16): the 4 builder tools' inputs. Strict at the top; the nested project and
 * answers are checked by the handler each call reaches, so an old call and its new form fail alike.
 */
export const FindInput = ListProgramsInput.extend({
  /** One program: its details and, for a curated program, its guide in show_to_builder. */
  program_id: z.string().optional(),
  /** "owner/repo" or a github.com link: with program_id, the eligibility check for that repo. */
  repo: z.string().optional(),
}).strict();

/**
 * v2.10 item 13: the builder's compiled artifact for EarnKit to deploy (the agent compiles; EarnKit
 * never builds code). Pre-flight P9: `owner_wallet` is the wallet that should own it (else the
 * remembered one on a non-shared client, else the reply asks).
 */
export const DeployField = z
  .object({
    chain: z.enum(['arc', 'base']),
    bytecode: z.string().regex(/^0x[0-9a-fA-F]+$/).max(2 + 2 * 49_152),
    abi: z.array(z.object({ type: z.string() }).passthrough()).max(500),
    constructor_args: z.array(z.unknown()).max(50).optional(),
    owner_wallet: z.string().max(100).optional(),
  })
  .strict();

/** prepare: prepare_submission's input plus `deploy` (Pre-flight P9: stripped before the strict handler). */
export const PrepareInput = PrepareSubmissionInput.extend({
  deploy: DeployField.optional(),
  // v2.12.1 T9 fix round 2: a tip jar from the move-up yes: only the deploy, never the program's
  // draft, guide, "working on" or token offer (it must not nudge the builder toward the grant).
  tips: z.literal(true).optional(),
}).strict();
/** T9 fix round 2: `tips` without `deploy`. */
export const TIPS_NEEDS_DEPLOY_NOTE = "tips: true is only for the tip jar's deploy: pass deploy too. Don't show this note.";

/** v2.10 item 13: asked when no owner wallet is known. */
export const deployWalletLine = (name: string) => `Send me the wallet that should own ${name}.`;

/**
 * v2.10 item 13: prepare's deploy step. The builder's line (the deployed line, or why not) goes at the
 * end of show_to_builder; the reply's `deploy` carries the address for the agent's `contracts`, so
 * it never appears in a description field. Never throws.
 */
async function deployStep(
  d: z.infer<typeof DeployField>,
  prep: { project?: { name?: string; repo_url?: string }; answers?: Record<string, string>; signed_in?: string },
  ctx: ToolContext,
  /**
   * v2.11 T9: the build path's starter (the deployed event names it only for its own bytecode), the
   * line's pusher it already read, and its `built` event, written once every cap passed.
   */
  build: { starter?: { id: string; bytecode_hash: string | null }; lineOwner?: string | null; beforeSend?: () => Promise<void> } = {},
): Promise<{ line: string; deploy: Reply; agent_note?: string }> {
  const shared = ctx.sharedClient === true;
  // v2.10.3: a chain left out of DEPLOY_CHAINS is refused first, before the wallet ask or any read.
  if (!deployChains().includes(d.chain)) {
    const line = deployChains().length ? deployOffLine(d.chain) : DEPLOY_LINES.off;
    return { line, deploy: { unavailable: line }, agent_note: deployOffNote(d.chain) };
  }
  // Final fix M3: a shared client deploys only with GitHub sign-in on (its limits and proof need the
  // caller's own login, never the repo key or the agent-wide proof).
  if (shared && !githubVerifyEnabled())
    return { line: DEPLOY_LINES.off, deploy: { unavailable: DEPLOY_LINES.off }, agent_note: 'Deploys on this client need GitHub sign-in, which is off right now.' };
  const repoUrl = prep.project?.repo_url ?? prep.answers?.repo_url;
  const gh = repoUrl ? githubRepo(repoUrl) : null;
  const name = prep.project?.name?.trim() || gh?.repo || 'your contract';
  if (!gh) return { line: DEPLOY_LINES.notYours, deploy: { refused: DEPLOY_LINES.notYours }, agent_note: 'Pass the project repo_url (its GitHub repo) to deploy.' };
  const given = d.owner_wallet?.trim();
  const wallet = given && isWalletAddress(given) ? given : given ? null : await walletMemory(ctx).catch(() => null);
  if (!wallet) {
    const line = deployWalletLine(name);
    return { line, deploy: { needs_wallet: line }, agent_note: 'Pass deploy.owner_wallet with the wallet the builder sends.' };
  }
  // v2.11 T8: never a public test wallet (anvil or Hardhat accounts 0 to 9; the starter's artifact.mjs
  // list): anyone holds its key, so anyone could take what the contract sends its owner.
  if (publicTestWallet(wallet)) {
    const line = deployWalletLine(name);
    return {
      line,
      deploy: { needs_wallet: line },
      agent_note: 'That wallet is a public test account (anvil or Hardhat): anyone can spend from it. Pass deploy.owner_wallet with the builder\'s own wallet.',
    };
  }
  // Fix round 1 (I6): a shared client's caller login; else the installation's verified login (limits only).
  let login: string | null;
  try {
    // Final fix M3: callerLogin directly (sharedLogin swallows a failed read), so N6 holds here too.
    login = shared
      ? await (ctx.deployDeps?.callerLogin ?? callerLogin)(ctx.installationId, prep.signed_in)
      : await (ctx.deployDeps?.installationLogin ?? installationLogin)(ctx.installationId);
  } catch (err) {
    // Fix round 2 (N6): no login read, no deploy (never a fresh per-installation key).
    console.error('[prepare] deploy login', err instanceof Error ? err.name : 'error');
    return { line: DEPLOY_LINES.lowBalance, deploy: { unavailable: DEPLOY_LINES.lowBalance }, agent_note: "EarnKit couldn't check the builder's sign-in right now. Try later." };
  }
  const input: DeployInput = {
    chain: d.chain,
    bytecode: d.bytecode as `0x${string}`,
    abi: d.abi as unknown as DeployInput['abi'],
    ...(d.constructor_args && { constructor_args: d.constructor_args }),
  };
  const out = await deployForBuilder(
    { installationId: ctx.installationId, login, shared, repoKey: `${gh.owner}/${gh.repo}`, projectName: name, builderWallet: wallet as `0x${string}`, input, ...build },
    ctx.deployDeps,
  );
  if (out.status === 'deployed')
    return {
      line: out.show_to_builder,
      deploy: { address: out.address, chain: d.chain, owner_ok: out.owner_ok },
      agent_note: 'Add deploy.address to contracts; never put it in a description.',
    };
  return { line: out.show_to_builder, deploy: { [out.status]: out.show_to_builder }, ...(out.agent_note && { agent_note: out.agent_note }) };
}

// ---- v2.11 T8 (spec 3, plan S6 and S7): the build path's first two prepare calls ----

/** Plan S7: prepare's `build`, strict. A yes to the fresh lead (start); the fields written from the twist; the deploy-and-host call's mark. */
const BuildStart = z.strictObject({ start: z.literal(true), program_id: z.string().min(1).max(200) });
const BuildTwist = z.strictObject({
  program_id: z.string().min(1).max(200),
  // The real limits are buildCheck's, so a long field is an agent note, not a schema error.
  twist: z.string().max(2000),
  name: z.string().max(2000),
  description: z.string().max(2000),
  feature: z.string().max(2000),
  for_whom: z.string().max(2000),
  wallet: z.string().max(200).optional(),
  repo_url: z.string().max(500).optional(),
});
const BuildMark = z.strictObject({ program_id: z.string().min(1).max(200) });
const TWIST_KEYS = ['twist', 'name', 'description', 'feature', 'for_whom', 'wallet', 'repo_url'];

/** Every build refusal: an agent note only, nothing for the builder (plan 8.3). */
const buildRefusal = (agent_note: string) => ({ show_to_builder: '', agent_note });
const zodNote = (err: z.ZodError) =>
  `${err.issues.map((i) => `build${i.path.length ? `.${i.path.join('.')}` : ''}: ${i.message}${'keys' in i ? ` (${(i.keys as string[]).join(', ')})` : ''}`).join('; ')}. Don't show this to the builder.`;

/** Plan 8.5: a shared client never gets the build path (Ruling S6). */
export const BUILD_SHARED_NOTE =
  "This agent serves many builders, so it can't build or deploy for one. Show show_to_builder as written; never start building.";
/** The twist reply's note: what the agent sends next. */
export const twistNote = (walletKnown: boolean) =>
  "Show show_to_builder as written and wait for the builder's answer. Then call prepare with build: { program_id, twist (their words), name, description, feature, for_whom (\"for ...\")" +
  (walletKnown
    ? ' }. EarnKit uses the wallet they gave before; add build.wallet only if they name another.'
    : ", wallet (the one they give; never make one up; if they have none, help them create one on their own machine, EarnKit never sees the key) }.") +
  ' You write name, description and feature from the twist: the name and the description each use a word of it, and the feature is theirs, never the kit\'s default. Never start building before that call passes.';
export const BUILD_NOT_STARTED =
  "Call prepare with build: { start: true, program_id } first: EarnKit asks the builder one question before any work starts. Don't show this to the builder.";
export const buildRefused = (programId: string) =>
  `EarnKit can't start a build for ${programId} right now: it isn't open for a fresh build here, or deploys or hosting are off. ` +
  "Don't build. Tell the builder in one short line in your words, and call find for what is open. Don't show this note.";
export const WALLET_NEEDED_NOTE =
  "Pass build.wallet: the wallet the builder gives for this build. Never make one up; if they have none, help them create one on their own machine (EarnKit never sees the key). Don't show this to the builder.";
export const KIT_NOTE =
  'Show show_to_builder as written, then build from kit (never show it to the builder), step by step in kit.order: ' +
  'github_user to find first, then copy the starter and fill its twist slots, create the repo, commit with earnkit.txt and push at once, then call prepare as kit.next says.';

/**
 * The program as a fresh build would offer it right now (freshPick on that one program: open,
 * curated, Easy or Medium, a tested starter on a chain EarnKit deploys to with hosting on, not
 * hidden or entered), or null. Fail closed: deploys off, or hosting off for a starter with no GitHub
 * Pages fallback, means null. `anyDeploy` (T9): as if deploys were on, to name the starter's chain
 * when they are off.
 */
async function buildPick(programId: string, ctx: ToolContext, o: { anyDeploy?: boolean } = {}): Promise<Pick<FreshPick, 'starter'> | null> {
  // v2.13.1 O2 (B1): under the Bench, the starter build with no program (bench-find.ts withNoProgram).
  if (programId === BENCH_BUILD_ID) {
    if (!benchEnabled()) return null;
    const on = freshSwitches(ctx, true);
    const starter = benchStarter(new Date(), { deployOn: o.anyDeploy ? () => true : on.deployOn, hostOn: on.hostOn, ...(on.starters && { starters: on.starters }) });
    return starter ? { starter } : null;
  }
  const programs = await listPrograms();
  const card = programs.find((p) => p.id === programId && !p.earnkit_campaign);
  if (!card) return null;
  const told = await memoryOf(memoryKey(ctx), 'prepare');
  const hidden = hiddenIds(hiddenPrograms(told, programs));
  const entered = new Set((await hasProgramEntry(ctx.installationId, programId)) ? [programId] : []);
  const on = freshSwitches(ctx, true);
  const deployOn = o.anyDeploy ? () => true : on.deployOn;
  return freshPick([card], new Date(), { hidden, entered, deployOn, hostOn: on.hostOn, ...(on.starters && { starters: on.starters }) }) ?? null;
}

/** The wallet a build may use without asking: valid, never a public test wallet, never on a shared client. */
const buildWallet = (w: string | null | undefined) => (w && isWalletAddress(w) && !publicTestWallet(w) ? w.toLowerCase() : null);

/**
 * v2.11 T8 (spec 3): the yes to the fresh lead. Asks the one twist question (with "Add the wallet
 * that should own it." when no wallet is known, decision 5) and stores the build (S6). Nothing is
 * built before the builder answers.
 */
async function buildStart(programId: string, ctx: ToolContext) {
  // Review M3: fail closed first; a shared client hears "add EarnKit to a coding agent" only when a
  // build would be offered at all.
  const pick = await buildPick(programId, ctx);
  if (!pick) return buildRefusal(buildRefused(programId));
  if (ctx.sharedClient) return { show_to_builder: BUILD_CHAT_ONLY, agent_note: BUILD_SHARED_NOTE };
  const known = buildWallet(await walletMemory(ctx).catch(() => null));
  await saveBuild(ctx.installationId, { program_id: programId, starter_id: pick.starter.id, started_at: new Date().toISOString() });
  return {
    program_id: programId,
    // v2.13.1 O5 N7: under the Bench the wallet line has a way out for a builder with none.
    show_to_builder: twistQuestion(known !== null, benchEnabled()),
    build: { program_id: programId, starter_id: pick.starter.id, step: 'twist' },
    agent_note: twistNote(known !== null),
  };
}

/** v2.12.1 T9: the attribution line a build kit carries (flag on, a chain EarnKit knows), else none. */
async function kitAttribution(id: number, chain: string) {
  const c = chainOf(chain);
  if (!builderScoreEnabled() || !c) return undefined;
  return (await attributionFor(id, c).catch(() => null)) ?? undefined;
}

/**
 * v2.11 T8 (spec 3): the agent's build fields from the builder's twist. The server checks them
 * (buildCheck: plain words, the twist in the name, the description and the feature, a real wallet,
 * never a public test one), then remembers the wallet (off a shared client), stores the build and
 * returns the building line and the kit. Every refusal is an agent note only. The same fields sent
 * again (say, with repo_url for the proof line) show the builder nothing new.
 */
async function buildTwist(b: z.infer<typeof BuildTwist>, ctx: ToolContext) {
  if (ctx.sharedClient) {
    const pick = await buildPick(b.program_id, ctx);
    return pick ? { show_to_builder: BUILD_CHAT_ONLY, agent_note: BUILD_SHARED_NOTE } : buildRefusal(buildRefused(b.program_id));
  }
  const stored = await readBuild(ctx.installationId);
  if (!stored || stored.program_id !== b.program_id) return buildRefusal(BUILD_NOT_STARTED);
  const pick = await buildPick(b.program_id, ctx);
  if (!pick) return buildRefusal(buildRefused(b.program_id));
  // Review M1: a valid wallet is kept with the build before the other checks, so a retry after an
  // unrelated refusal never needs it again. It is remembered as the payout wallet only on a pass.
  const keep = buildWallet(b.wallet?.trim());
  if (keep && stored.wallet !== keep) {
    stored.wallet = keep;
    await saveBuild(ctx.installationId, stored);
  }
  const fields: BuildFields = { twist: b.twist, name: b.name, description: b.description, feature: b.feature, for_whom: b.for_whom, ...(b.wallet !== undefined && { wallet: b.wallet }) };
  const problem = buildCheck(fields, pick.starter);
  if (problem) return buildRefusal(problem);
  let repoUrl: string | undefined;
  if (b.repo_url !== undefined) {
    const gh = githubRepo(b.repo_url.trim());
    if (!gh) return buildRefusal(buildFix('repo_url', 'the github.com link of the public repo'));
    if ((EARNKIT_ORGS as readonly string[]).includes(gh.owner.toLowerCase()))
      return buildRefusal(buildFix('repo_url', "the builder's own repo, never EarnKit's kit"));
    repoUrl = `https://github.com/${gh.owner}/${gh.repo}`;
  }
  const given = b.wallet?.trim();
  const wallet = given ? given.toLowerCase() : (buildWallet(stored.wallet) ?? buildWallet(await walletMemory(ctx).catch(() => null)));
  if (!wallet) return buildRefusal(WALLET_NEEDED_NOTE);
  const next: StoredBuild = {
    program_id: stored.program_id,
    starter_id: pick.starter.id,
    started_at: stored.started_at,
    wallet,
    twist: b.twist.trim(),
    name: b.name.trim(),
    description: b.description.trim(),
    feature: b.feature.trim(),
    for_whom: b.for_whom.trim(),
    ...((repoUrl ?? stored.repo_url) && { repo_url: repoUrl ?? stored.repo_url }),
  };
  const shownBefore = (['wallet', 'twist', 'name', 'description', 'feature', 'for_whom'] as const).every((k) => stored[k] === next[k]);
  // Final fix M7: a wallet kept with the build across a refusal (review M1) is remembered once the twist passes, as if given now.
  const remember = given || (stored.wallet && stored.wallet === wallet ? wallet : undefined);
  if (remember) await rememberWallet(ctx.installationId, remember);
  await saveBuild(ctx.installationId, next);
  // v2.13.1 O2 fix round 1 (fresh-build ruling): under the Bench the kit carries a proof branch, never an earnkit.txt line.
  const bench = benchEnabled();
  if (next.repo_url && !bench) await noteLineIssued(ctx.installationId, next.repo_url);
  const branch = bench && next.repo_url ? await buildBranch(ctx, next.repo_url) : null;
  return {
    program_id: next.program_id,
    // v2.13.1 O5 N12: under the Bench, no chain name and the builder's "my" said back as "your".
    show_to_builder: shownBefore ? '' : bench ? benchBuildingLine(next.name!, pick.starter, next.for_whom!) : buildingLine(next.name!, pick.starter.what, next.for_whom!),
    build: { program_id: next.program_id, starter_id: pick.starter.id, step: 'build' },
    kit: buildKit(
      pick.starter, next.repo_url && !bench ? tokenLineFor(ctx.installationId, next.repo_url) : null, { ...fields, wallet }, Boolean(next.repo_url),
      // v2.12.1 T9 (spec 3): every app built through EarnKit carries the attribution line from the start.
      await kitAttribution(ctx.installationId, pick.starter.chain),
      ...(bench ? [{ proof: branch && 'proof' in branch ? branch.proof : null }] : []),
    ),
    agent_note: bench ? KIT_NOTE_BENCH : KIT_NOTE,
  };
}

/** v2.13.1 O2 fix round 1 (fresh-build ruling): the kit note under the Bench (a proof branch, no earnkit.txt). */
export const KIT_NOTE_BENCH =
  'Show show_to_builder as written, then build from kit (never show it to the builder), step by step in kit.order: ' +
  'github_user to find first, then copy the starter and fill its twist slots, create the repo, commit and push at once, push the proof branch, then call prepare as kit.next says.';
/** The build's deploy call before its proof branch showed: push it, then call again. */
export const buildBranchNote = (push: string) =>
  `Push the proof branch first: ${push} (in the repo's folder; a branch at the current commit, no file). Then call this again. Don't show this to the builder.`;
export const BUILD_BRANCH_TAKEN_NOTE = "That repo is already on the Bench under another account, so EarnKit won't deploy it. Use a new repo under the builder's own account. Don't show this to the builder.";
export const BUILD_BRANCH_WAIT_NOTE = "EarnKit can't check the repo right now, so it can't deploy. Don't deploy; tell the builder in one short line to try again later.";

/** v2.13.1 O2 fix round 1: the proof branch for a build's new repo (the agent can build: it is building). */
async function buildBranch(ctx: ToolContext, repoUrl: string, o: { deploy?: boolean } = {}): Promise<{ proof: { branch: string; push: string; remove: string } } | { note: string }> {
  const gh = githubRepo(repoUrl);
  if (!gh) return { note: BUILD_BRANCH_WAIT_NOTE };
  // v2.13.1 O3: at the deploy step a code that expired during the build gets a fresh one (within the daily cap).
  const state = await proofBranchFor(ctx.installationId, `${gh.owner}/${gh.repo}`, new Date(), { canBuild: true, buildDeploy: o.deploy, newRepo: true }).catch(() => null);
  if (state?.kind === 'checking') return { proof: { branch: state.proof.branch, push: state.proof.push, remove: state.proof.remove } };
  return { note: state?.kind === 'taken' ? BUILD_BRANCH_TAKEN_NOTE : BUILD_BRANCH_WAIT_NOTE };
}

/**
 * v2.13.1 O2 fix round 1 (fresh-build ruling): under the Bench, the build's repo proven by its proof
 * branch (checked now, once a minute at most), else the reply that asks for it. Never a line.
 */
async function buildProofByBranch(ctx: ToolContext, repo: string, repoKey: string): Promise<{ proven: ProvenRepo } | { reply: Reply }> {
  const now = new Date();
  await checkProofBranch(ctx.installationId, now, { key: repoKey, ghFetch: ctx.proofBranchFetch ?? ctx.readerDeps?.ghFetch });
  const proven = await proveRepoByBranch({ installationId: ctx.installationId, repoUrl: repo });
  if (proven) return { proven };
  const b = await buildBranch(ctx, repo, { deploy: true });
  return { reply: 'proof' in b ? { ...buildRefusal(buildBranchNote(b.proof.push)), proof: b.proof } : buildRefusal(b.note) };
}

// ---- v2.11 T9 (spec 4, decision 2, plan S9 to S11): deploy and host in one call, with no click ----

/** Agent notes on the build path's deploy-and-host call (never shown to the builder). */
export const BUILD_NOT_READY =
  "Call prepare with the build fields from the builder's twist first (build: { program_id, twist, name, description, feature, for_whom, wallet }): " +
  "EarnKit deploys only a checked build. Don't show this to the builder.";
export const BUILD_DEPLOYS_OFF_NOTE =
  "Deploys are off, so EarnKit can't deploy or host this build now. Show show_to_builder as written; don't deploy it anywhere else.";
export const buildOwnerNote = (field: string, wallet: string) =>
  `deploy.${field} must be the build's wallet, ${wallet}: the builder owns the contract from the first block. ` +
  "Rebuild the artifact for that wallet (scripts/artifact.mjs) and call again. Don't show this to the builder.";
export const buildChainNote = (chain: string) => `deploy.chain must be '${chain}', the starter's chain. Don't show this to the builder.`;
export const buildProofNote = (line: string | null) =>
  line
    ? `The repo's earnkit.txt (repo root, default branch) doesn't have this agent's line yet: "${line}". Commit and push it, then call this again. Don't show this to the builder.`
    : "EarnKit can't make the earnkit.txt line right now, so it can't deploy. Don't deploy; tell the builder in one short line to try again later.";
export const BUILD_UPLOAD_NOTE =
  'Put deploy.address into the site as BUILD.md says, zip site_dir and POST it to host.upload_url within 15 minutes (Content-Type application/zip). ' +
  "Don't show the upload's show_to_builder: the next reply says it. Then call prepare with program_id, project { name, description, repo_url, live_url: the upload's url } and build: { program_id }. " +
  'If the link expires, call prepare with program_id, project { name, repo_url } and host: true for a new one; never deploy again.';
/** Security fix N1: the build path deploys the starter's own compiled contract, unchanged. */
export const BUILD_BYTECODE_NOTE =
  "deploy.bytecode must be the starter's own contract exactly as forge build compiles it from the kit (artifact.json's bytecode), with nothing changed or added: " +
  "the twist goes in the constructor arguments and the site. Don't show this to the builder.";
export const buildArgsNote = (types: readonly string[]) =>
  `deploy.constructor_args must be exactly ${types.length} values (${types.join(', ')}), as scripts/artifact.mjs writes them. Don't show this to the builder.`;

/**
 * Security fixes M3, N1: the build path's artifact is the starter's own: its exact bytecode
 * (`bytecode_hash`), followed by exactly the constructor arguments ABI-encoded with the starter's own
 * constructor types (never the agent's ABI), the first being the build's wallet. Returns the ABI to
 * deploy with (the starter's constructor), or the agent note.
 */
function starterArtifact(
  starter: { contract: { owner_arg: boolean; bytecode_hash: string | null; constructor_types: readonly string[] }; chain: string },
  d: z.infer<typeof DeployField>,
  wallet: string,
): { abi: z.infer<typeof DeployField>['abi'] } | { note: string } {
  const c = starter.contract;
  if (!c.bytecode_hash || !isHex(d.bytecode, { strict: true }) || keccak256(d.bytecode as `0x${string}`) !== c.bytecode_hash.toLowerCase()) return { note: BUILD_BYTECODE_NOTE };
  const inputs = c.constructor_types.map((type, i) => ({ name: `arg${i}`, type }));
  const abi = [{ type: 'constructor', inputs, stateMutability: 'nonpayable' }, ...d.abi.filter((x) => x.type !== 'constructor')];
  const args = d.constructor_args ?? [];
  if (args.length !== inputs.length) return { note: buildArgsNote(c.constructor_types) };
  let decoded: readonly unknown[];
  try {
    const data = initcode({ chain: d.chain, bytecode: d.bytecode as `0x${string}`, abi: abi as unknown as Abi, constructor_args: args });
    decoded = decodeAbiParameters(inputs, `0x${data.slice(d.bytecode.length)}`);
  } catch {
    return { note: buildArgsNote(c.constructor_types) };
  }
  if (c.owner_arg && String(decoded[0]).toLowerCase() !== wallet) return { note: buildOwnerNote('constructor_args[0]', wallet) };
  return { abi };
}

/** Final fix M8: the build's deploy is sent but unconfirmed; the same call made again settles it. */
export const BUILD_PENDING_NOTE =
  'Show show_to_builder as written. In a few minutes make this same prepare call again, deploy and all: EarnKit reads the receipt then and goes on from there; it never deploys twice. Never deploy it anywhere else.';
/** Security fix M6: deployed, but the build's wallet doesn't own it, so nothing is hosted. */
export const BUILD_NOT_OWNED_NOTE =
  "The builder's wallet doesn't own this contract (owner() isn't their wallet), so EarnKit won't host its site. Don't build a site for it; tell the builder in one short line. Don't show this note.";
/**
 * Plan S10: EarnKit hosting is off or refused; the agent publishes the site on GitHub Pages (free).
 * Final fix I3: GitHub serves a branch only from `/` or `/docs` (REST "Create a GitHub Pages site":
 * POST repos/{owner}/{repo}/pages, source.branch, source.path), so the starter's site_dir goes to the
 * root of a gh-pages branch, served at https://<owner>.github.io/<repo>/ (pagesLinkOf). Final fix I2:
 * a site that never loads still gets the deployed line within 15 minutes (buildJoin without live_url).
 */
export const BUILD_PAGES_NOTE =
  "EarnKit can't host this site right now. Put deploy.address into the site as BUILD.md says, commit and push it, then publish host.site_dir on GitHub Pages from the builder's public repo; " +
  'it is free and needs nothing from the builder. Push the contents of host.site_dir to the root of a gh-pages branch: ' +
  '`git subtree push --prefix <host.site_dir> origin gh-pages` (without git subtree: `git push origin "$(git commit-tree HEAD:<host.site_dir> -m site)":refs/heads/gh-pages`). ' +
  "Then turn Pages on for that branch: `gh api -X POST repos/<owner>/<repo>/pages -f 'source[branch]=gh-pages' -f 'source[path]=/'` (a 409 means it is already on). " +
  "Once https://<owner>.github.io/<repo>/ loads, call prepare with program_id, project { name, description, repo_url, live_url: that link } and build: { program_id }. " +
  "If it doesn't load within 15 minutes, make that call without live_url. Don't show this note or the reason.";

/** v2.11 T10 (spec 5): the deploy reply's line waits, so the builder hears it once with the live link and the confirm line. */
export const BUILD_HOLD_NOTE =
  'Show the builder nothing yet: the reply after the live link says the deployed line with the live line and the confirm line, in one reply. ' +
  "If the site isn't live within 15 minutes, call prepare with program_id, project { name, repo_url } and build: { program_id }, without live_url, and show its show_to_builder as written.";
/**
 * v2.11 T10 (T9 concerns 2 and 3): no proven owner on the build path. The proof is the owner's own
 * fresh push (find's github_user, a normal push within 10 minutes of the repo or a new commit), so
 * the agent retries with a fresh push before telling the builder anything.
 */
export const BUILD_OWNER_NOTE =
  "EarnKit deploys from the earnkit.txt line only for the repo owner's own account: the builder's GitHub login passed to find as github_user, " +
  'and their own push of the line, a normal push within 10 minutes of creating the repo or of a new commit. ' +
  "Check find got github_user (never guess it), then make a fresh commit (any small change, earnkit.txt kept) and push it now from the builder's own account, never a force push, and call this again. " +
  "If it is still refused, tell the builder in one short line that EarnKit couldn't confirm the repo is theirs. Don't show this note.";
/** v2.11 T10: the joined reply's note: confirm with the entry drafted from the build. */
export const BUILD_ENTRY_NOTE =
  'Show show_to_builder as written. The entry is drafted from the build (entry). When the builder says yes, call confirm with program_id, ' +
  'project: entry.project, answers: entry.answers, yes: true, wallet: shown_wallet and token: { name, symbol } of token.proposed; when they say skip the token, skip_token: true instead of yes.';

/**
 * v2.12.1 T10 (spec 3b): BUILD_ENTRY_NOTE when the live reply asks the coin (the built_live moment):
 * a yes enters the build's program with the coin, a no enters it without one.
 */
export const BUILD_COIN_NOTE =
  'Show show_to_builder as written. The entry is drafted from the build (entry). When the builder says yes, call confirm with program_id, ' +
  'project: entry.project, answers: entry.answers, yes: true, wallet: shown_wallet and token: { name, symbol } of token.proposed; when they say no, skip_token: true instead of yes.';

/** v2.12 spec 7 (R22), v2.12.1 T10: BUILD_ENTRY_NOTE where no token is pitched: no token to name or skip. */
export const BUILD_ENTRY_NO_TOKEN_NOTE =
  'Show show_to_builder as written. The entry is drafted from the build (entry). When the builder says yes, call confirm with program_id, ' +
  'project: entry.project, answers: entry.answers and yes: true.';

export { githubPagesOwner, pagesLinkOf } from './pages-link';
export { buildStepLine } from './where-you-stand';

/**
 * Plan S11: the `built` event, once per installation, repo and program
 * (`built:<installation>:<repo_key>:<program_id>`, security fix M4): written on the build path once
 * the repo passed the earnkit.txt line and every deploy cap passed, just before the send. Proof: the
 * repo link. The twist and the starter go in detail; the wallet is the build's; the login only when
 * the owner pushed the line (proofLineLogin).
 */
const builtEvent = (ctx: ToolContext, b: StoredBuild & { wallet: string }, repoKey: string, lineOwner: string | null) =>
  noteEvent('built', async () => {
    const who = await loginBasisFor(ctx.installationId, repoKey, { lineOwner });
    return {
      type: 'built',
      // Security fix M4: per installation, so another installation on the same repo never takes it first.
      dedupe_key: `built:${ctx.installationId}:${repoKey}:${b.program_id}`,
      installation_id: ctx.installationId,
      repo_key: repoKey,
      program_id: b.program_id,
      wallet: b.wallet,
      proof_url: `https://github.com/${repoKey}`,
      ...(who && { github_login: who.login, login_basis: who.basis }),
      detail: { starter: b.starter_id, ...(b.twist && { twist: b.twist }) },
    };
  });

/**
 * Plan S10, security fix I2: the GitHub Pages fallback went live. Only for the build's own repo
 * (`installations.build.repo_url`, saved on the deploy call after its earnkit.txt line passed), with a
 * contract EarnKit deployed for this installation and that repo, and only for that repo's own Pages
 * link (pagesLinkOf) whose probe passes (verify.ts liveCheckDetail, cached). It writes `hosted` with
 * `detail.host = 'github_pages'`, key `hosted:gh:<installation>:<repo_key>:<link>`, so no one can take
 * another builder's record first. All of it runs only while the event log is on.
 */
const pagesHostedEvent = (ctx: ToolContext, programId: string, repoKey: string, liveUrl: string) =>
  noteEvent('hosted', async () => {
    const link = pagesLinkOf(repoKey, liveUrl);
    if (!link) return null;
    const [deployed] = await sql()`
      SELECT 1 FROM contract_deploys WHERE installation_id = ${ctx.installationId} AND repo_key = ${repoKey} AND status = 'deployed' LIMIT 1`;
    if (!deployed) return null;
    if ((await liveCheckDetail(link, ctx.verifyDeps ?? {})).ok !== true) return null;
    const who = await loginBasisFor(ctx.installationId, repoKey);
    return {
      type: 'hosted',
      dedupe_key: `hosted:gh:${ctx.installationId}:${repoKey}:${link}`,
      installation_id: ctx.installationId,
      repo_key: repoKey,
      program_id: programId,
      proof_url: link,
      ...(who && { github_login: who.login, login_basis: who.basis }),
      detail: { host: 'github_pages' },
    };
  });

/**
 * v2.11 T10 (spec 5): what prepare_submission takes from the build path: the lines that go before
 * the confirm line (the live line, then the deployed line) and the build's wallet, the one the
 * confirm line shows and the token's fees go to.
 */
export type BuildJoin = { lead: string[]; wallet: string; noLive?: true };

/** Final fix I2: the call after the deploy came with no live link that loads; the entry waits for one. */
export const BUILD_NO_LIVE_NOTE =
  "The site isn't live yet, so the entry has no live link. Publish it as the deploy reply's note said and call this again with live_url once it loads; " +
  "never put any other link in live_deployment_url. Don't show this note.";

/**
 * v2.11 T10 (T9 concern 6): the live line for the build's own live link, or null. EarnKit hosting:
 * this installation's live site for the repo (`PodTips is live: podtips-jenil04.earnkit.com`). GitHub
 * Pages: the repo's own Pages link (pagesLinkOf) whose probe passes (`PodTips is live:
 * jenil04.github.io/podtips`). Anything else is never called live.
 */
async function buildLiveLine(ctx: ToolContext, name: string, repoKey: string, live: string): Promise<string | null> {
  const canonical = canonicalBuilderUrl(live).url;
  if (!canonical) return null;
  const u = new URL(canonical);
  const [site] = await sql()<{ slug: string }[]>`
    SELECT slug FROM hosted_sites WHERE installation_id = ${ctx.installationId} AND repo_key = ${repoKey} AND status = 'live' LIMIT 1`;
  if (site && u.hostname === `${site.slug}.${HOST_ZONE}` && u.pathname === '/' && !u.search && !u.hash) return liveLine(name, site.slug);
  const pages = pagesLinkOf(repoKey, canonical);
  if (!pages || (await liveCheckDetail(pages, ctx.verifyDeps ?? {})).ok !== true) return null;
  return pagesLiveLine(name, pages);
}

/** v2.11 T10: v2.9's live line for a GitHub Pages link: `PodTips is live: jenil04.github.io/podtips`. Pure. */
export function pagesLiveLine(project: string, link: string): string {
  const u = new URL(link);
  return `${project} is live: ${u.hostname}${u.pathname.replace(/\/$/, '')}`;
}

/**
 * v2.11 T10 (spec 5): the call after the live link, once EarnKit deployed the build's contract for
 * this installation and repo. The entry is drafted from the build: the build's repo, the live link,
 * the twist description (unless the agent wrote one), the deployed contract, and the public profile
 * from the proven repo owner (coach.ts derivedProfile; never invented), so Arc asks no coach
 * question. prepare_submission then puts the live line and the deployed line before the confirm
 * line, with the build's wallet, in one reply. Null (prepare's usual path) before the deploy.
 */
async function buildJoin(
  ctx: ToolContext,
  b: StoredBuild & { wallet: string; repo_url: string },
  repoKey: string,
  live: string | undefined,
  rest: Record<string, unknown>,
): Promise<{ rest: Record<string, unknown>; join: BuildJoin } | null> {
  const [d] = await sql()<{ address: string; chain: DeployChainName; owner_ok: boolean | null }[]>`
    SELECT address, chain, owner_ok FROM contract_deploys
    WHERE installation_id = ${ctx.installationId} AND repo_key = ${repoKey} AND status = 'deployed' AND address IS NOT NULL
    ORDER BY id DESC LIMIT 1`;
  if (!d) return null;
  const name = b.name!;
  const liveText = live ? await buildLiveLine(ctx, name, repoKey, live) : null;
  const program = await getProgramRow(b.program_id);
  const given = (rest.project ?? {}) as Record<string, unknown>;
  const others = (Array.isArray(given.contracts) ? given.contracts : []).filter((c): c is string => typeof c === 'string' && c.toLowerCase() !== d.address.toLowerCase());
  const project = {
    ...given,
    name: typeof given.name === 'string' && given.name.trim() ? given.name : name,
    description: typeof given.description === 'string' && given.description.trim() ? given.description : b.description,
    repo_url: b.repo_url,
    contracts: [d.address, ...others].slice(0, 2),
  };
  const answers = { ...((rest.answers ?? {}) as Record<string, string>) };
  const who = await loginBasisFor(ctx.installationId, repoKey).catch(() => null);
  Object.assign(answers, derivedDescription(program.submission_requirements, answers, project.description));
  Object.assign(answers, derivedProfile(program.submission_requirements, answers, who?.login ?? null));
  return {
    rest: { ...rest, project, answers },
    join: {
      lead: [liveText, deployedLine(name, d.chain, d.address, d.owner_ok === true)].filter((x): x is string => Boolean(x)),
      wallet: b.wallet,
      ...(!liveText && { noLive: true as const }),
    },
  };
}

/**
 * v2.11 T9 (spec 4): the build path's mark (`build: { program_id }`). Fails closed (review T8 M5):
 * never on a shared client, only for this installation's checked build of the same program.
 * - With `deploy` (the deploy-and-host call): deploys off is v2.10's "Deploys are off right now."
 *   with nothing deployed, hosted or logged. Else the program must still be a fresh pick, the
 *   artifact on the starter's chain, its owner (owner_wallet if sent, and constructor_args[0] when
 *   the starter takes the owner there) the build's wallet, and the repo's earnkit.txt line in place.
 *   Then `built` (S11), the capped v2.10 deploy with the build's wallet as owner, and, once it is
 *   deployed, the one-use upload URL (no click off a shared client, S9) or the GitHub Pages note
 *   (S10). T10: while the site goes up the builder sees nothing (the deployed line waits); a refusal
 *   or a contract the wallet doesn't own shows v2.10's line.
 * - Without `deploy` (the next call, with the live link): a GitHub Pages link that loads writes its
 *   `hosted` event (S10); then prepare's usual path, without `build`, and once the contract is
 *   deployed (T10, buildJoin) with the entry drafted from the build and the live, deployed and
 *   confirm lines in one reply.
 */
async function buildShip(programId: string, rest: Record<string, unknown>, ctx: ToolContext): Promise<{ reply: Reply } | { rest: Record<string, unknown>; join?: BuildJoin }> {
  if (ctx.sharedClient) {
    const pick = await buildPick(programId, ctx);
    return { reply: pick ? { show_to_builder: BUILD_CHAT_ONLY, agent_note: BUILD_SHARED_NOTE } : buildRefusal(buildRefused(programId)) };
  }
  const stored = await readBuild(ctx.installationId);
  const wallet = buildWallet(stored?.wallet);
  if (!stored || stored.program_id !== programId || !stored.name || !wallet) return { reply: buildRefusal(BUILD_NOT_READY) };
  const { deploy, ...prep } = PrepareInput.parse(rest);
  const repoUrl = prep.project?.repo_url ?? prep.answers?.repo_url ?? stored.repo_url;
  const gh = repoUrl ? githubRepo(repoUrl) : null;
  if (!deploy) {
    // Security fix I2: only the build's own repo, never one this call names.
    const own = stored.repo_url ? githubRepo(stored.repo_url) : null;
    const live = prep.project?.live_url ?? prep.answers?.live_url;
    if (programId === BENCH_BUILD_ID) return { reply: await benchBuildLive(ctx, { ...stored, wallet }, own, live) };
    if (!own) return { rest };
    const ownKey = `${own.owner}/${own.repo}`.toLowerCase();
    if (live) await pagesHostedEvent(ctx, programId, ownKey, live);
    // v2.13.1 O2 (B4): the live link is the build's last step; find no longer says "Building".
    if (live && benchEnabled()) await saveBuild(ctx.installationId, { ...stored, done_at: new Date().toISOString() });
    return (await buildJoin(ctx, { ...stored, wallet, repo_url: stored.repo_url! }, ownKey, live, rest)) ?? { rest };
  }
  const any = await buildPick(programId, ctx, { anyDeploy: true });
  if (!any) return { reply: buildRefusal(buildRefused(programId)) };
  const starter = any.starter;
  // v2.10.3: with deploys on, a starter chain left out of DEPLOY_CHAINS is refused as deployStep does
  // ("Deploys on Arc are off right now."), before the build is checked, logged or anything is read.
  if (deployEnabled() && !deployChains().includes(starter.chain)) {
    const line = deployChains().length ? deployOffLine(starter.chain) : DEPLOY_LINES.off;
    return { reply: { program_id: programId, show_to_builder: line, deploy: { unavailable: line }, agent_note: deployOffNote(starter.chain) } };
  }
  if (!freshSwitches(ctx, true).deployOn(starter.chain))
    return { reply: { program_id: programId, show_to_builder: DEPLOY_LINES.off, deploy: { unavailable: DEPLOY_LINES.off }, agent_note: BUILD_DEPLOYS_OFF_NOTE } };
  if (!(await buildPick(programId, ctx))) return { reply: buildRefusal(buildRefused(programId)) };
  if (deploy.chain !== starter.chain) return { reply: buildRefusal(buildChainNote(starter.chain)) };
  // Review T8 M5: the build's wallet is the owner; a different one the agent sends is refused.
  if (deploy.owner_wallet !== undefined && deploy.owner_wallet.trim().toLowerCase() !== wallet) return { reply: buildRefusal(buildOwnerNote('owner_wallet', wallet)) };
  const artifact = starterArtifact(starter, deploy, wallet);
  if ('note' in artifact) return { reply: buildRefusal(artifact.note) };
  if (!gh) return { reply: buildRefusal(buildFix('repo_url', "the github.com link of the builder's public repo, in project.repo_url")) };
  if ((EARNKIT_ORGS as readonly string[]).includes(gh.owner.toLowerCase()))
    return { reply: buildRefusal(buildFix('repo_url', "the builder's own repo, never EarnKit's kit")) };
  const repo = `https://github.com/${gh.owner}/${gh.repo}`;
  const repoKey = `${gh.owner}/${gh.repo}`.toLowerCase();
  let proven: ProvenRepo | null;
  if (benchEnabled()) {
    const byBranch = await buildProofByBranch(ctx, repo, repoKey);
    if ('reply' in byBranch) return byBranch;
    proven = byBranch.proven;
  } else {
    proven = await proveRepo({ installationId: ctx.installationId, repoUrl: repo }, ctx.deployDeps?.gate);
    if (!proven) {
      await noteLineIssued(ctx.installationId, repo);
      return { reply: buildRefusal(buildProofNote(tokenLineFor(ctx.installationId, repo))) };
    }
  }
  // Security fix R3: with no sign-in, only the repo owner's own proven account deploys (deploy.ts checks it again).
  if (!(await repoSignedIn({ installationId: ctx.installationId, repoKey }, ctx.deployDeps?.gate)) && !(await provenOwnerLogin(ctx.installationId, repoKey, proven.lineOwner)))
    return { reply: buildRefusal(BUILD_OWNER_NOTE) };
  const build = { ...stored, wallet, repo_url: repo };
  if (stored.repo_url !== repo) await saveBuild(ctx.installationId, build);
  // Final fix M8: a deploy of this build still unconfirmed from an earlier call is settled from its
  // receipt (read-only), never sent again; the call then goes on as if it had just deployed.
  const pending = await settlePendingDeploy(
    { installationId: ctx.installationId, repoKey, chain: starter.chain, projectName: stored.name, starterId: starter.id, wallet },
    ctx.deployDeps,
  );
  const step = pending
    ? pending.status === 'deployed'
      ? { line: pending.show_to_builder, deploy: { address: pending.address, chain: starter.chain, owner_ok: pending.owner_ok } as Reply, agent_note: 'Add deploy.address to contracts; never put it in a description.' }
      : { line: pending.show_to_builder, deploy: { [pending.status]: pending.show_to_builder } as Reply, ...(pending.agent_note && { agent_note: pending.agent_note }) }
    : await deployStep({ ...deploy, abi: artifact.abi, owner_wallet: wallet }, { project: { name: stored.name, repo_url: repo } }, ctx, {
        starter: { id: starter.id, bytecode_hash: starter.contract.bytecode_hash },
        lineOwner: proven.lineOwner,
        beforeSend: () => builtEvent(ctx, build, repoKey, proven.lineOwner),
      });
  const out = step.deploy as { address?: unknown; owner_ok?: unknown };
  const deployed = typeof out.address === 'string';
  // v2.13 T8 (spec "2b"): under the Bench flag the build becomes the one project (set once, plan B2),
  // once its contract is deployed. Never fails the build.
  if (deployed && benchEnabled()) {
    await setMainProject(ctx.installationId, { name: build.name ?? repoKey.split('/')[1], what: build.description ?? null, repo: repoKey, live_url: null, package: null, contracts: [] }).catch(() => undefined);
    // v2.13.1 O2 fix round 1 (fresh-build ruling): the branch proved it, so it is on the Bench today.
    await (await import('./person-score')).rescorePerson(ctx.installationId, new Date()).catch(() => undefined);
  }
  const remove = deployed && benchEnabled() ? await branchToRemove(ctx.installationId, new Date()).catch(() => null) : null;
  // Security fix M6: a site only for a contract the builder's wallet owns.
  const owned = deployed && out.owner_ok === true;
  const hosting = owned ? await hostBlock(ctx, repo, stored.name, proven) : null;
  const upload = hosting && 'upload_url' in hosting ? { upload_url: hosting.upload_url, expires_at: hosting.expires_at } : null;
  const host = hosting ? (upload ?? { github_pages: true, site_dir: starter.site_dir }) : null;
  // Final fix M8: still unconfirmed: the same call again settles it (the explorer note isn't the build's way on).
  const note =
    step.line === DEPLOY_PENDING
      ? BUILD_PENDING_NOTE
      : [step.agent_note, hosting ? `${BUILD_HOLD_NOTE} ${upload ? BUILD_UPLOAD_NOTE : BUILD_PAGES_NOTE}` : deployed ? BUILD_NOT_OWNED_NOTE : null, remove?.agent_note].filter(Boolean).join(' ');
  return {
    reply: {
      program_id: programId,
      // T10 (spec 5): while the site goes up the deployed line waits for the joined reply.
      show_to_builder: hosting ? '' : step.line,
      deploy: step.deploy,
      build: { program_id: programId, starter_id: starter.id, step: deployed ? 'host' : 'deploy' },
      ...(host && { host }),
      ...(note && { agent_note: note }),
    },
  };
}

/** v2.13.1 O2 (B1): the note with the no-program build's live reply. */
export const BENCH_BUILD_LIVE_NOTE = "Show show_to_builder as written. It enters no program; call find for where they stand. Don't show this note.";
export const BENCH_BUILD_NOT_LIVE_NOTE =
  "The live link doesn't load yet (or isn't the build's own site). Send project.live_url again once it loads. Don't show this to the builder.";

/**
 * v2.13.1 O2 (B1): the call after the live link for the build with no program: the live and deployed
 * lines, nothing entered (the build is already the one project, set on its deploy). Done once the link
 * loads (done_at): find no longer says "Building".
 */
async function benchBuildLive(ctx: ToolContext, b: StoredBuild & { wallet: string }, own: { owner: string; repo: string } | null, live: string | undefined): Promise<Reply> {
  if (!own || !live) return buildRefusal(BENCH_BUILD_NOT_LIVE_NOTE);
  const key = `${own.owner}/${own.repo}`.toLowerCase();
  const [d] = await sql()<{ address: string; chain: DeployChainName; owner_ok: boolean | null }[]>`
    SELECT address, chain, owner_ok FROM contract_deploys
    WHERE installation_id = ${ctx.installationId} AND repo_key = ${key} AND status = 'deployed' AND address IS NOT NULL
    ORDER BY id DESC LIMIT 1`;
  if (!d) return buildRefusal(BUILD_NOT_READY);
  await pagesHostedEvent(ctx, BENCH_BUILD_ID, key, live);
  const liveText = await buildLiveLine(ctx, b.name!, key, live);
  if (!liveText) return buildRefusal(BENCH_BUILD_NOT_LIVE_NOTE);
  await saveBuild(ctx.installationId, { ...b, done_at: new Date().toISOString() });
  return { show_to_builder: [liveText, deployedLine(b.name!, d.chain, d.address, d.owner_ok === true)].join('\n'), agent_note: BENCH_BUILD_LIVE_NOTE };
}

/**
 * Plan S7: prepare with `build`. The start and twist calls carry only `build` (and the same
 * program_id at the top, which the MCP schema requires); the mark (`{ program_id }`) is buildShip's:
 * the deploy-and-host call, or the call after it that goes on to prepare's usual path. Returns the
 * reply, or the input without `build` for the usual path.
 */
async function prepareBuild(input: Record<string, unknown>, ctx: ToolContext): Promise<{ reply: Reply } | { rest: Record<string, unknown>; join?: BuildJoin }> {
  const { build, ...rest } = input;
  const b = build && typeof build === 'object' && !Array.isArray(build) ? (build as Record<string, unknown>) : null;
  if (!b) return { reply: buildRefusal("build: an object, as find's build_offer says. Don't show this to the builder.") };
  const isStart = 'start' in b;
  const isTwist = !isStart && TWIST_KEYS.some((k) => k in b);
  const parsed = (isStart ? BuildStart : isTwist ? BuildTwist : BuildMark).safeParse(b);
  if (!parsed.success) return { reply: buildRefusal(zodNote(parsed.error)) };
  const programId = parsed.data.program_id;
  if (rest.program_id !== undefined && rest.program_id !== programId)
    return { reply: buildRefusal(`program_id at the top must equal build.program_id (${programId}). Don't show this to the builder.`) };
  if (!isStart && !isTwist) return buildShip(programId, { ...rest, program_id: programId }, ctx);
  const extra = Object.keys(rest).filter((k) => k !== 'program_id');
  if (extra.length > 0)
    return { reply: buildRefusal(`Send only build (and program_id) on this call, not ${extra.join(', ')}. Don't show this to the builder.`) };
  return { reply: (isStart ? await buildStart(programId, ctx) : await buildTwist(parsed.data as z.infer<typeof BuildTwist>, ctx)) as Reply };
}

const Loose = z.record(z.string(), z.unknown());

export const ConfirmInput = z
  .object({
    program_id: z.string().optional(),
    /** An existing entry's token (as launch_token): launch it, or check a pending launch. */
    project_id: z.number().int().positive().optional(),
    project: Loose.optional(),
    answers: Loose.optional(),
    /** The builder said yes: the entry is submitted and the token launches. */
    yes: z.literal(true).optional(),
    /** The builder said skip the token: the entry is submitted without one. */
    skip_token: z.literal(true).optional(),
    /** Checking back after "launching": a read, never a launch. */
    check: z.boolean().optional(),
    token: z.object({ name: z.string().max(200).optional(), symbol: z.string().max(20).optional() }).strict().optional(),
    wallet: z.string().optional(),
    agent: AgentInput.optional(),
    signed_in: z.string().max(40).optional(),
    image_data: z.string().optional(),
    image_url: z.string().optional(),
    builder_x: z.string().optional(),
    /** EarnKit campaigns (and the builder bonus's contract check). */
    contracts: z.array(z.string()).max(5).optional(),
    deployer_signature: z.string().optional(),
    /** Pre-flight P15: the builder already submitted on the program's site (v2.9 record_submission with both flags). */
    submitted: z.object({ external_submission_url: z.string().optional() }).strict().optional(),
  })
  .strict()
  .refine((c) => c.program_id !== undefined || c.project_id !== undefined, {
    message: 'Pass program_id (with project and answers), or project_id for an entry already made.',
  });

export const TellToolInput = z
  .object({
    submitted: z
      .object({
        program_id: z.string(),
        external_submission_url: z.string().optional(),
        /** Required on a shared client (R16): the entry, as confirm returned it. */
        project_id: z.number().int().positive().optional(),
        /** Pre-flight P15: an old "I submitted" call's own project and answers, for an entry not made yet. */
        project: Loose.optional(),
        submission_data: Loose.optional(),
      })
      .strict()
      .optional(),
    pickup: z.enum(['yes', 'no']).optional(),
    // v2.12 spec 8 (EARNKIT_BUILDER_SCORE on): "hide" or "show".
    profile: z.enum(['hide', 'show']).optional(),
    // v2.12.1 T12: kept and ignored. v2.12's tell took the X handle the builder confirmed; an agent
    // that kept that schema (the flag was on briefly in production) must not get a parse error.
    x_handle: z.string().max(20).optional(),
    // v2.12.1 T8: the builder's answer to "Want a card to share it?" ("skip" is one word).
    card: z.enum(['yes', 'skip']).optional(),
    // v2.12.1 T8: the builder's yes or no to "How to move up" (find's or score's move_up).
    move_up: z
      .object({
        kind: z.string().max(20).optional(),
        project_key: z.string().max(300).nullable().optional(),
        answer: z.enum(['yes', 'no']),
        // v2.12.1 T9: a go_live yes again, with the GitHub Pages link once it loads.
        live_url: z.string().max(300).optional(),
      })
      .strict()
      .optional(),
    // v2.12.1 T10 (spec 3b): the builder's yes or no to a coin offer, with the wallet they gave.
    // v2.13 T9: or { raising } (Bench flag only; the MCP schema lists it only then).
    coin: z
      .object({
        project_key: z.string().max(300).optional(),
        answer: z.enum(['yes', 'no']).optional(),
        wallet: z.string().max(100).optional(),
        raising: z.boolean().optional(),
      })
      .strict()
      .refine((c) => c.answer !== undefined || c.raising !== undefined, { message: 'Pass answer, or raising.' })
      .optional(),
    // v2.13: this week's update (or hide one week), and the weekly-posting yes. Flag off: not listed in the MCP schema.
    update: z.object({ text: z.string().max(2000).optional(), hide: z.string().max(20).optional() }).strict().optional(),
    updates: z.object({ on: z.boolean(), scheduled: z.boolean().optional() }).strict().optional(),
    // v2.13.1 O5 N2: the agent's push of the proof branch (false: GitHub refused it). Flag off: not listed in the MCP schema.
    proof: z.object({ pushed: z.boolean() }).strict().optional(),
    // Read by tell_earnkit (builder-memory.ts TellInput).
    program_status: z.unknown().optional(),
    repo_facts: z.unknown().optional(),
    weekly_email: z.unknown().optional(),
    signed_in: z.string().max(40).optional(),
  })
  .strict();

type Reply = Record<string, unknown>;

const defined = (o: Reply): Reply => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** v2.12.1 T10: a coin wallet that isn't a 0x address. */
export const COIN_WALLET_NOTE = "wallet must be the 0x address the builder gave; ask them for it and call tell with coin again. Don't show this note.";

/**
 * v2.12.1 T10 (spec 3b): the builder's answer to a coin offer (tell coin, or move_up with kind
 * coin). Only an offer EarnKit made and the builder hasn't answered (coin-moments.ts coinYes and
 * coinNo check it); anything else is "Okay." with nothing changed. A yes returns the entry the
 * agent confirms by project_id (the usual token steps follow); a no is never offered again.
 */
async function coinAnswer(ctx: ToolContext, c: { project_key: string; answer: 'yes' | 'no'; wallet?: string }): Promise<Reply> {
  const id = ctx.installationId;
  if (c.answer === 'no') {
    await coinNo(id, c.project_key);
    return { show_to_builder: COUNT_LINES.noted };
  }
  if (c.wallet !== undefined && !isWalletAddress(c.wallet.trim())) return { show_to_builder: '', agent_note: COIN_WALLET_NOTE };
  const r = await coinYes(id, c.project_key, c.wallet ?? null, { check: ctx.tokenDeps?.check });
  return 'project_id' in r ? { show_to_builder: '', ...r } : r;
}

/** Fix round 1: a thrown issueUpload, told apart from "no proof yet" (that one gets the proof line). */
const GO_LIVE_FAILED = 'The hosting check failed.';
/** v2.12.1 T9 (ruling S15): the go_live yes, in plain words. "Live" is said only by the reply that saw it load. */
export const GO_LIVE_LINES = {
  onIt: "On it. I'll send you the link when it's live.",
  cant: (name: string) => `I can't put ${name} online right now.`,
} as const;
const goLiveAgain = (key: string, extra = '') =>
  `call tell with move_up: { kind: 'go_live', project_key: '${key}', answer: 'yes'${extra} } again`;
export const goLiveUploadNote = () =>
  'Build the app to static files (index.html at the top), zip that folder and POST it to host.upload_url within 15 minutes (Content-Type application/zip). ' +
  "Show the upload reply's show_to_builder as written: it is the live link. If the upload is refused, tell the builder in one short line that you couldn't put it online. Don't show this note.";
export const goLiveLineNote = (key: string, line: string) =>
  `Commit earnkit.txt at the root of the repo ${key} (default branch) with the line "${line}" and push it from the builder's own account, then ${goLiveAgain(key)}. ` +
  "If this note comes back after you pushed it, tell the builder in one short line that you couldn't put it online. Don't show this note.";
export const goLiveSignInNote = (key: string) => `Show show_to_builder. When the builder says they signed in, ${goLiveAgain(key)}.`;
export const goLivePagesNote = (key: string) =>
  `EarnKit hosting is off, so publish the app on GitHub Pages from the builder's public repo ${key}; it is free and needs nothing from the builder. ` +
  'Build it to static files and push that folder to the root of a gh-pages branch (`git subtree push --prefix <folder> origin gh-pages`), ' +
  "then turn Pages on: `gh api -X POST repos/<owner>/<repo>/pages -f 'source[branch]=gh-pages' -f 'source[path]=/'` (a 409 means it is already on). " +
  `Once https://<owner>.github.io/<repo>/ loads, ${goLiveAgain(key, ", live_url: that link")}: EarnKit checks it loads and tells the builder. ` +
  "If it doesn't load within 15 minutes, tell the builder in one short line that you couldn't put it online. Don't show this note.";
export const GO_LIVE_NOT_YET_NOTE =
  "The link doesn't load yet. Wait a minute and call again with it; after 15 minutes, tell the builder in one short line that you couldn't put it online. Don't show this note.";
export const goLiveWrongLinkNote = (key: string) =>
  `live_url must be this repo's own GitHub Pages link, https://<owner>.github.io/<repo>/ for ${key}. Don't show this note.`;

/**
 * v2.12.1 T9 (ruling S15): the yes to "Want me to put <app> online?": the named app goes online
 * through EarnKit hosting, the v2.11 path: with hosting on, a one-use upload URL (issueUpload: the
 * GitHub sign-in or the earnkit.txt proof line shows the repo is theirs); off, the GitHub Pages
 * fallback, and EarnKit says it is live only once the repo's own Pages link loads. Anything else is
 * an honest "I can't put it online right now."
 */
async function goLiveYes(ctx: ToolContext, key: string, liveUrl: string | undefined): Promise<Reply> {
  const id = ctx.installationId;
  const [p] = await sql()<{ name: string }[]>`SELECT name FROM builder_projects WHERE builder_id = ${id} AND project_key = ${key}`;
  const gh = githubRepo(`https://github.com/${key}`);
  if (!p || !gh) return { show_to_builder: COUNT_LINES.noted };
  const repoKey = `${gh.owner}/${gh.repo}`;
  if (liveUrl !== undefined) {
    const link = pagesLinkOf(repoKey, liveUrl.trim());
    if (!link) return { show_to_builder: '', agent_note: goLiveWrongLinkNote(repoKey) };
    if ((await liveCheckDetail(link, ctx.verifyDeps ?? {})).ok !== true) return { show_to_builder: '', agent_note: GO_LIVE_NOT_YET_NOTE };
    // Shown from now on (not yet confirmed, read like any reported site); the next reply re-reads it.
    const added = await sql()`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${id}, 'site', ${link}, ${key}, 'agent')
      ON CONFLICT (builder_id, kind, ref) DO NOTHING RETURNING id`;
    // A new site: the next reply re-reads the person (once; a repeat yes reads nothing more).
    if (added.length > 0) await sql()`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${id}`;
    return { show_to_builder: pagesLiveLine(p.name, link) };
  }
  if (!r2Enabled()) return { show_to_builder: GO_LIVE_LINES.onIt, agent_note: goLivePagesNote(repoKey) };
  const offer = await issueUpload({ installationId: id, repoKey, project: p.name }, new Date(), { gate: ctx.deployDeps?.gate }).catch((err: unknown) => {
    console.error('[tell] go_live', err instanceof Error ? err.name : 'error');
    return { unavailable: GO_LIVE_FAILED };
  });
  if ('upload_url' in offer) return { show_to_builder: GO_LIVE_LINES.onIt, host: offer, agent_note: goLiveUploadNote() };
  if ('sign_in_url' in offer) return { show_to_builder: hostSignInLine(p.name, offer.sign_in_url), agent_note: goLiveSignInNote(repoKey) };
  // No sign-in and no proof line yet: the line first (once pushed, the yes again gets the upload URL).
  const repoUrl = `https://github.com/${repoKey}`;
  const line = offer.unavailable === HOST_LINES.unavailable ? tokenLineFor(id, repoUrl) : null;
  if (line) {
    await noteLineIssued(id, repoUrl);
    return { show_to_builder: '', agent_note: goLiveLineNote(repoKey, line) };
  }
  return { show_to_builder: GO_LIVE_LINES.cant(p.name), agent_note: `Why, for you only: ${offer.unavailable} Don't show this note.` };
}

/**
 * v2.12.1 T8, T9: the builder's answer to "How to move up". The step is the server's own
 * (stand-view.ts currentStep); the agent's kind is never trusted, and a yes to a step that is no
 * longer the current one (or another project's) changes nothing. A no keeps that step away for 30
 * days. `confirm` re-issues the link that shows the work is theirs (confirmYes); `go_live` puts the
 * app online (goLiveYes); count_past, tag_future and payment are make-countable.ts's; a coin offer
 * (kind coin, still open) is coinAnswer's.
 */
async function moveUpAnswer(ctx: ToolContext, m: { kind?: string; project_key?: string | null; answer: 'yes' | 'no'; live_url?: string }): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  // T10: a coin offer is answered as offered (the offer's own moment, which may not be chooseStep's
  // step now: a countable or first-5 reply); coinOpen means EarnKit made it and it is unanswered.
  if (m.kind === 'coin' && m.project_key && (await coinOpen(id, m.project_key))) return coinAnswer(ctx, { project_key: m.project_key, answer: m.answer });
  // v2.13 T8: under the Bench flag, the ask its last reply stored. go_live and coin yeses are answered
  // here (goLiveYes, coinAnswer); every other answer is bench-find.ts benchMoveUp's.
  if (benchEnabled()) {
    const asked = m.answer === 'yes' ? await benchAsked(id, m) : null;
    if (asked?.kind === 'go_live' && asked.key) return goLiveYes(ctx, asked.key, m.live_url);
    if (asked?.kind === 'coin' && asked.key) return coinAnswer(ctx, { project_key: asked.key, answer: 'yes' });
    return benchMoveUp(ctx, m);
  }
  if (m.answer === 'no') return moveUpNo(id, now, m.project_key, ctx.freshDeps);
  const step = await stepFor(id, m.project_key, ctx.freshDeps);
  if (!step) return { show_to_builder: COUNT_LINES.noted };
  switch (step.kind) {
    case 'confirm':
      return confirmYes(id, now);
    case 'go_live':
      return goLiveYes(ctx, step.project_key!, m.live_url);
    case 'count_past':
    case 'tag_future':
    case 'payment':
      return defined({ ...(await moveUpYes(id, m.project_key ?? null, now, { reader: ctx.readerDeps, fresh: ctx.freshDeps, step })) });
    case 'coin':
      return coinAnswer(ctx, { project_key: step.project_key!, answer: 'yes' });
    default:
      return { show_to_builder: COUNT_LINES.noted };
  }
}

/** find with program_id and repo: the eligibility check as one plain line, or null. Pure; exported for tests. */
export function eligibilityLine(repo: string, e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const name = repo.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/(\.git)?\/?$/, '');
  if ('error' in e) return typeof e.error === 'string' ? e.error : null;
  const { status, note } = e as { status?: string; note?: string | null };
  const said = note ? note.replace(/\.$/, '') : null;
  if (status === 'likely') return said ? `${name} fits: ${said}.` : `${name} fits.`;
  if (status === 'after_step') return `${name} fits after one step${said ? `: ${said}` : ''}.`;
  if (status === 'no') return `${name} doesn't fit yet${said ? `: ${said}` : ''}.`;
  return null;
}

/** R16: a shared client's "I submitted" without the entry's project_id: nothing is written. */
export const SUBMITTED_SHARED_NOTE =
  "Nothing saved: this agent serves many builders, so pass signed_in (the code from the builder's GitHub sign-in) and the entry's project_id (from confirm's reply) with submitted.";

/** tell's `submitted` (R16): the entry and its saved answers, then record_submission with builder_submitted. */
async function markSubmitted(s: NonNullable<z.infer<typeof TellToolInput>['submitted']>, signedIn: string | undefined, ctx: ToolContext) {
  const done = defined({ external_submission_url: s.external_submission_url, builder_submitted: true, signed_in: signedIn });
  const noted = { show_to_builder: NOTED_FOR_NOW, agent_note: SUBMITTED_SHARED_NOTE };
  // Rulings G7, G9 (fix round 1, I2): on a shared client only an entry the pasted code's verified
  // login signed in for, named by its project_id; anything else is noted and nothing is written or read.
  if (ctx.sharedClient) {
    const login = s.project_id === undefined ? null : await sharedLogin(ctx, signedIn, 'tell');
    const ids = login ? await verifiedEntryIds(ctx.installationId, login).catch(() => [] as number[]) : [];
    if (!ids.includes(s.project_id!)) return noted;
    const entry = await submittedEntry(ctx.installationId, s.program_id, s.project_id, ids);
    if (!entry) return noted;
    return handlers.record_submission({ program_id: s.program_id, project: entry.project, submission_data: entry.answers, ...done }, ctx);
  }
  // Pre-flight P15: an old call's own project and answers (record_submission finds or makes its entry).
  if (s.project_id === undefined && s.project)
    return handlers.record_submission({ program_id: s.program_id, project: s.project, submission_data: s.submission_data ?? {}, ...done }, ctx);
  const entry = await submittedEntry(ctx.installationId, s.program_id, s.project_id);
  if (!entry)
    throw new NotFoundError(
      s.project_id ? `No entry ${s.project_id} in ${s.program_id} for this agent.` : `No entry in ${s.program_id} for this agent yet: call confirm first.`,
    );
  return handlers.record_submission({ program_id: s.program_id, project: entry.project, submission_data: entry.answers, ...done }, ctx);
}

/** Several tell parts at once: their replies in order, show_to_builder lines joined. */
function joinReplies(replies: Reply[]): Reply {
  if (replies.length === 1) return replies[0];
  const shown = replies.map((r) => r.show_to_builder).filter((v): v is string => typeof v === 'string' && v !== '');
  const notes = replies.map((r) => r.agent_note).filter((v): v is string => typeof v === 'string' && v !== '');
  const schedule = replies.find((r) => typeof r.schedule_weekly_update === 'string')?.schedule_weekly_update;
  return {
    ...Object.assign({}, ...replies),
    ...(shown.length > 0 && { show_to_builder: shown.join('\n') }),
    ...(notes.length > 0 && { agent_note: notes.join(' ') }),
    ...(schedule !== undefined && { schedule_weekly_update: schedule }),
  };
}

/** Fix round 2 (Minor): confirm with submitted that recorded nothing yet. */
export const SUBMITTED_AGAIN_NOTE =
  'The builder already submitted on the program site, and that is not saved yet: send submitted again on your next confirm call for this entry.';

/** record_submission's entered line without its token sentence ("Your token: …", "Your token is launching."). Pure; exported for tests. */
export function withoutTokenLine(text: unknown): unknown {
  if (typeof text !== 'string') return text;
  return text.replace(/ Your token(:| is| isn't| didn't)[^\n]*?\.(?=\n|$|;)/, '').replace(/; it joins the builder bonus once it is\./, '.');
}

type ConfirmArgs = z.infer<typeof ConfirmInput>;

/** Fix round 2 (I-b): a shared client's confirm by project_id without the entry's verified login. */
export const CONFIRM_SHARED_NOTE =
  "Nothing done: this agent serves many builders, so pass signed_in (the code from the builder's GitHub sign-in) with this entry's project_id.";

/** Fix round 2 (I-a): the agent's note when a launch by project_id was not what the confirm line showed. */
export const PROJECT_REOFFER_NOTE =
  'Nothing launched: this token or wallet is not what the confirm line showed the builder. Show show_to_builder as written; ' +
  'when the builder says yes, call confirm again with this project_id, yes: true, wallet: shown_wallet (or the wallet they name) and token: token.proposed.';

/**
 * v2.10 item 4, fix round 2: `confirm` with `project_id` (v2.9 launch_token).
 * - I-b (Rulings G7, G9): on a shared client only an entry the pasted code's verified login signed in
 *   for; anything else is noted, and nothing of the entry is changed (links, completeness) or read
 *   (its token status).
 * - I-a (Ruling G13, §A2): a launch takes exactly the name, ticker and wallet the entry's confirm line
 *   showed (token_offers); another pair or wallet, or none shown, is the confirm line again and
 *   nothing launches. A check, an entry with its token (or pending), a skipped entry (refused by
 *   launch_token) and a dormant EarnKit campaign entry (v2.9 one step) go straight to launch_token.
 */
async function confirmByProjectId(c: ConfirmArgs & { project_id: number }, ctx: ToolContext) {
  if (ctx.sharedClient) {
    const login = await sharedLogin(ctx, c.signed_in, 'confirm');
    const ids = login ? await verifiedEntryIds(ctx.installationId, login).catch(() => [] as number[]) : [];
    if (!ids.includes(c.project_id)) return { show_to_builder: NOTED_FOR_NOW, agent_note: CONFIRM_SHARED_NOTE };
  }
  if (c.skip_token) return { status: 'skipped', note: NO_TOKEN_FOR_NOW, show_to_builder: NO_TOKEN_FOR_NOW };
  const image = defined({ image_data: c.image_data, image_url: c.image_url, builder_x: c.builder_x });
  const launch = (pair: { name?: string; symbol?: string }) =>
    handlers.launch_token(
      defined({
        project_id: c.project_id,
        builder_confirmed: c.yes || c.check ? true : undefined,
        check_back: c.check || undefined,
        creator_wallet: c.wallet,
        ...pair,
        ...image,
        live_url: c.project?.live_url,
        repo_url: c.project?.repo_url,
        agent: c.agent,
        signed_in: c.signed_in,
      }),
      ctx,
    );
  const entry = c.yes && !c.check ? await launchEntry(ctx.installationId, c.project_id) : null;
  // Not this installation's (launch_token says so), a read, a token already there, or a skipped entry.
  if (!entry || entry.token_url || entry.confirm_choice === 'skip') return launch(c.token ?? {});
  const program = await getProgramRow(entry.program_id);
  if (program.campaign) return launch(c.token ?? {});
  // v2.12.1 T10 (spec 3b): where no token is pitched (fail strict) nothing launches: the entry's confirmation without a token.
  if (!(await tokenPitch(ctx, entry.program_id, entry.repo_url, entry.id))) {
    if (!isOpen(program)) return { status: 'skipped' as const, note: NO_TOKEN_HERE, show_to_builder: NO_TOKEN_HERE };
    const saved = await submittedEntry(ctx.installationId, program.id, entry.id);
    return handlers.confirm_entry(
      defined({
        program_id: program.id,
        project: saved?.project ?? { name: entry.name, ...(entry.repo_url && { repo_url: entry.repo_url }) },
        answers: answersOf(saved?.answers ?? {}),
        wallet: c.wallet,
        agent: c.agent,
        signed_in: c.signed_in,
        builder_confirmed: true,
        decision: 'go' as const,
      }),
      ctx,
    );
  }
  const shown = await readShownOffer(ctx.installationId, program.id, offerKey(entry.repo_url, entry.name)).catch(() => null);
  const asked = editsOf(c.token ?? {});
  const samePair = shown !== null && (asked.name === undefined || asked.name === shown.name) && (asked.symbol === undefined || asked.symbol === shown.symbol);
  // The wallet that would launch: the one named with this yes, else the entry's own (launchToken's order).
  const wallet = (c.wallet ?? entry.wallet)?.toLowerCase() ?? null;
  const sameWallet = shown?.wallet ? wallet === shown.wallet : Boolean(c.wallet);
  if (samePair && sameWallet) return launch({ name: shown.name, symbol: shown.symbol });
  if (!isOpen(program))
    return { status: 'skipped' as const, note: 'Nothing launched: this token was not offered yet.', agent_note: 'The program is closed, so this token is not offered again.' };
  // The confirm line again (confirm_entry's offer: no builder_confirmed, so nothing is recorded); it stores what it shows.
  const saved = await submittedEntry(ctx.installationId, program.id, entry.id);
  const offer = (await handlers.confirm_entry(
    defined({
      program_id: program.id,
      project: saved?.project ?? { name: entry.name, ...(entry.repo_url && { repo_url: entry.repo_url }) },
      answers: answersOf(saved?.answers ?? {}),
      token: c.token,
      wallet: c.wallet,
      agent: c.agent,
      signed_in: c.signed_in,
    }),
    ctx,
  )) as Reply;
  return { ...offer, project_id: entry.id, token: { status: 'skipped', fixable: true, ...(offer.token as object | undefined) }, agent_note: PROJECT_REOFFER_NOTE };
}

/** v2.11 T10: the agent's note when a yes on the build path named a wallet the confirm line didn't show. */
export const BUILD_WALLET_NOTE =
  'Nothing launched: this wallet is not the one the confirm line showed the builder. Show show_to_builder as written; ' +
  'when the builder says yes, call confirm again with yes: true, wallet: shown_wallet and token: token.proposed.';

/**
 * v2.11 T10 (plan 10.3, Review Focus 5): on the build path a yes launches only to the wallet the
 * confirm line showed (the build's wallet first). A yes naming another wallet gets the confirm line
 * again, showing that wallet, and nothing is recorded or launched; the builder's next yes covers it.
 * Null: not this build's entry, or the wallet shown, so confirm goes on as usual. Owner ruling on
 * final fix M4: another wallet is allowed, never unseen: it is shown first, and only a yes to the
 * line that showed it launches to it.
 */
async function buildWalletAgain(c: ConfirmArgs & { program_id: string; wallet: string }, ctx: ToolContext): Promise<Reply | null> {
  const build = await readBuild(ctx.installationId);
  const repoUrl = c.project?.repo_url ?? c.answers?.repo_url;
  const name = c.project?.name;
  if (!build?.repo_url || build.program_id !== c.program_id || typeof repoUrl !== 'string' || typeof name !== 'string') return null;
  if (normalizeRepoUrl(repoUrl) !== normalizeRepoUrl(build.repo_url)) return null;
  const shown = await readShownOffer(ctx.installationId, c.program_id, offerKey(repoUrl, name)).catch(() => null);
  if (shown?.wallet && shown.wallet === c.wallet.trim().toLowerCase()) return null;
  const offer = (await handlers.confirm_entry(
    defined({ program_id: c.program_id, project: c.project, answers: c.answers, token: c.token, wallet: c.wallet, agent: c.agent, signed_in: c.signed_in }),
    ctx,
  )) as Reply;
  return { ...offer, agent_note: BUILD_WALLET_NOTE };
}

/** A guide's text without its builder bonus section (guide.ts guideText: sections joined by a blank line). Pure. */
export const withoutBonusLine = (text: string) =>
  text.split('\n\n').filter((s) => !s.startsWith('Builder bonus:')).join('\n\n');

/** The agent tools (v2.10 item 4): the MCP server forwards each call here; each dispatches to `handlers`. */
export const tools = {
  // What can I earn (list_programs), or one program and its guide (get_program).
  find: async (input: unknown, ctx0: ToolContext) => {
    const ctx = await withProbation(ctx0);
    const { program_id, repo, ...parsed } = FindInput.parse(input ?? {});
    // v2.13.3 (1): local_repos as the agent sent it (list_programs reads it again), so a live link the
    // matcher drops (a placeholder host such as earnkit.com) still reaches the Bench's identity.
    const raw = (input as { local_repos?: unknown } | null)?.local_repos;
    const rest = raw === undefined ? parsed : { ...parsed, local_repos: raw as typeof parsed.local_repos };
    if (program_id === undefined)
      return handlers.list_programs(repo !== undefined && rest.repos === undefined ? { ...rest, repos: [repo] } : rest, ctx);
    const r = (await handlers.get_program(defined({ program_id, repo }), ctx)) as Reply & { guide?: { text?: string }; eligibility?: unknown };
    let guide = r.guide?.text;
    if (!guide) return r;
    // v2.12 final review (T9), v2.12.1 T10: no builder bonus line where no token is pitched (funded by
    // a token). A guide is a program's, read before any entry: never the build's moment (nothing is recorded).
    if (!(await coinPitchAllowed(ctx.installationId, { program_id, build: false }).catch(() => false))) {
      guide = withoutBonusLine(guide);
      r.guide = { ...r.guide, text: guide };
    }
    const line = repo ? eligibilityLine(repo, r.eligibility) : null;
    return { ...r, show_to_builder: line ? `${guide}\n\n${line}` : guide };
  },

  // v2.10 item 13: with `deploy`, EarnKit deploys the builder's contract after the prepare step.
  // Task 11 fix (journey 11.0): the deploy runs first and its address joins this draft's contracts,
  // so the reply's contract check sees it (item 13: "goes straight into the A5 check") and never says
  // "No contract found" next to the deployed line. The program is read first, so an unknown one
  // spends nothing; a draft that fails after a deploy still returns the deploy.
  prepare: async (input: unknown, ctx0: ToolContext) => {
    // v2.13.4 R7: entries, builds, deploys and hosting are writes a newcomer on probation can't make.
    const ctx = await withProbation(ctx0);
    if (ctx.probation) return probationReply(ctx, 'write');
    // v2.11 T8: the build path (plan S7).
    let join: BuildJoin | undefined;
    if (input && typeof input === 'object' && 'build' in input) {
      const b = await prepareBuild(input as Record<string, unknown>, ctx);
      if ('reply' in b) return b.reply;
      input = b.rest;
      join = b.join;
    }
    const { deploy, tips, ...prep } = PrepareInput.parse(input);
    if (tips) {
      // Fix round 2 (ruling): the tip jar's deploy alone; the program only carries it.
      if (!deploy) return { program_id: prep.program_id, show_to_builder: '', agent_note: TIPS_NEEDS_DEPLOY_NOTE };
      await getProgramRow(prep.program_id);
      const step = await deployStep(deploy, prep, ctx);
      return { program_id: prep.program_id, show_to_builder: step.line, deploy: step.deploy, ...(step.agent_note && { agent_note: step.agent_note }) };
    }
    if (!deploy) {
      const r = (await handlers.prepare_submission(prep, ctx, join)) as Reply;
      return join?.noLive ? { ...r, agent_note: [r.agent_note, BUILD_NO_LIVE_NOTE].filter(Boolean).join(' ') } : r;
    }
    await getProgramRow(prep.program_id);
    const step = await deployStep(deploy, prep, ctx);
    const address = (step.deploy as { address?: string }).address;
    const drafted = address ? { ...prep, project: { ...prep.project, contracts: [address, ...(prep.project?.contracts ?? []).filter((c) => c.toLowerCase() !== address.toLowerCase())].slice(0, 2) } } : prep;
    let r: Reply;
    try {
      r = (await handlers.prepare_submission(drafted, ctx)) as Reply;
    } catch (err) {
      if (!address) throw err;
      const why = err instanceof Error ? err.message : 'error';
      return { program_id: prep.program_id, show_to_builder: step.line, deploy: step.deploy, agent_note: `${step.agent_note ?? ''} The draft failed: ${why} Call prepare again without deploy.`.trim() };
    }
    const shown = typeof r.show_to_builder === 'string' && r.show_to_builder ? `${r.show_to_builder}\n\n${step.line}` : step.line;
    const note = [r.agent_note, step.agent_note].filter((n) => typeof n === 'string' && n).join(' ');
    return { ...r, show_to_builder: shown, deploy: step.deploy, ...(note && { agent_note: note }) };
  },

  // R15: the builder's yes (or skip the token) to the confirm line; or an entry's token (project_id).
  confirm: async (input: unknown, ctx0: ToolContext) => {
    // v2.13.4 R7: entries and every coin launch are writes a newcomer on probation can't make.
    const ctx = await withProbation(ctx0);
    if (ctx.probation) return probationReply(ctx, 'write');
    const c = ConfirmInput.parse(input);
    const tokenEdits = c.token ?? {};
    const image = defined({ image_data: c.image_data, image_url: c.image_url, builder_x: c.builder_x });
    if (c.program_id === undefined) return confirmByProjectId(c as ConfirmArgs & { project_id: number }, ctx);
    const program = await getProgramRow(c.program_id);
    // An EarnKit campaign is entered in one step (record_submission).
    if (program.campaign)
      return handlers.record_submission(
        defined({
          program_id: c.program_id,
          project: c.project,
          submission_data: c.answers ?? {},
          token: c.skip_token ? 'skip' : c.token || Object.keys(image).length > 0 ? { ...tokenEdits, ...image } : undefined,
          builder_confirmed: c.yes,
          payout_wallet: c.wallet,
          contracts: c.contracts,
          deployer_signature: c.deployer_signature,
          check_back: c.check || undefined,
          signed_in: c.signed_in,
          ...(c.submitted && { builder_submitted: true, external_submission_url: c.submitted.external_submission_url }),
        }),
        ctx,
      );
    // v2.11 T10: the build path launches only to the wallet its confirm line showed (owner ruling on
    // final fix M4: another wallet is shown first, never refused, never launched to unseen).
    if (c.yes && !c.check && c.wallet !== undefined && !ctx.sharedClient) {
      const again = await buildWalletAgain(c as ConfirmArgs & { program_id: string; wallet: string }, ctx);
      if (again) return again;
    }
    const confirmed = (await handlers.confirm_entry(
      defined({
        program_id: c.program_id,
        project: c.project,
        answers: c.answers,
        token: c.token,
        wallet: c.wallet,
        agent: c.agent,
        signed_in: c.signed_in,
        builder_confirmed: c.yes || c.skip_token ? true : undefined,
        decision: c.skip_token ? 'skip' : c.yes ? 'go' : undefined,
        check_back: c.check || undefined,
      }),
      ctx,
    )) as Reply;
    // Pre-flight P15b (fix round 1, C1): "already submitted" follows the confirmation, never replaces
    // it. Only once confirm_entry recorded the entry and returned its kit (the builder's yes or skip
    // to the confirm line they saw, the plain-words check passed) is it marked submitted.
    if (!c.submitted) return confirmed;
    // Fix round 2 (Minor): launching, a fixable stop or the confirm line again: not marked yet, so say
    // to send it again.
    if (!('kit' in confirmed) || typeof confirmed.project_id !== 'number')
      return { ...confirmed, agent_note: [confirmed.agent_note, SUBMITTED_AGAIN_NOTE].filter(Boolean).join(' ') };
    const marked = (await markSubmitted({ program_id: c.program_id, project_id: confirmed.project_id, external_submission_url: c.submitted.external_submission_url }, c.signed_in, ctx)) as Reply;
    // The confirmation's reply (its kit and token) wins; the submitted mark adds its lines, without a
    // second token line (the confirmation's said it).
    const joined = joinReplies([confirmed, { ...marked, show_to_builder: withoutTokenLine(marked.show_to_builder) }]);
    return { ...joined, ...confirmed, show_to_builder: joined.show_to_builder, agent_note: joined.agent_note };
  },

  // R16: what the builder said: pickup, then "I submitted", then statements; replies joined.
  tell: async (input: unknown, ctx0: ToolContext) => {
    // v2.12.1 T8: x_handle is no longer taken with the flag on (the page's handle is the X claim's);
    // it is ignored, as with the flag off (v2.11).
    const ctx = await withProbation(ctx0);
    const { pickup, submitted, signed_in, profile, x_handle, card, move_up, coin, update, updates, proof, ...rest } = TellToolInput.parse(input ?? {});
    void x_handle;
    const statements = defined(rest);
    // v2.13.4 R7: on probation the only write is posting an update (updates.ts refuses one over another
    // installation's); a move_up answer goes to benchMoveUp, which allows only the week's update. Every
    // other part is refused in one line and one question (not_mine: the project line).
    if (ctx.probation) {
      const out: Reply[] = [];
      if (update?.text !== undefined) out.push(await postUpdate(ctx.installationId, update.text, new Date(), ctx.ownInstallationId ?? ctx.installationId, { probation: true }));
      if (move_up) out.push(await benchMoveUp(ctx, move_up)); // never the coin or go-live yes (moveUpAnswer)
      const facts = TellInput.safeParse(defined({ ...statements, signed_in }));
      const notMine = facts.success && (facts.data.repo_facts ?? []).some((f) => f.not_mine === true);
      const refused = Boolean(pickup !== undefined || submitted || profile || card || coin || updates || proof || update?.hide !== undefined || Object.keys(statements).length > 0);
      if (!refused && out.length > 0) return joinReplies(out);
      // R8 (8): one reply, one question, last: what was done (each reply's first line, its question
      // dropped), then the refusal's line and question.
      const refusal = await probationReply(ctx, notMine ? 'main' : 'write');
      const done = out.map((r) => String(r.show_to_builder ?? '').split('\n').filter((l) => l && !l.includes('?')).join('\n')).filter(Boolean);
      const notes = out.map((r) => r.agent_note).filter((n): n is string => typeof n === 'string' && n.length > 0);
      return { ...refusal, show_to_builder: [...done, refusal.show_to_builder].join('\n'), ...(notes.length && { agent_note: notes.join(' ') }) };
    }
    const replies: Reply[] = [];
    // v2.12 spec 8: "hide" and "show". v2.12.1 T8: the card and the move-up answers. Flag off: ignored (v2.11).
    if (builderScoreEnabled() && ctx.sharedClient && (profile || card || move_up || coin || update || updates || proof))
      replies.push({ show_to_builder: '', agent_note: SHARED_PROFILE_NOTE });
    else if (builderScoreEnabled()) {
      if (profile) replies.push({ show_to_builder: await setHidden(ctx.installationId, profile === 'hide') });
      if (card === 'yes') replies.push(await cardYes(ctx.installationId));
      if (card === 'skip') replies.push({ show_to_builder: SKIPPED_LINE });
      if (move_up) replies.push(await moveUpAnswer(ctx, move_up));
      // v2.13 T9: coin { raising } turns the page's raising line on or off (Bench flag and EARNKIT_RAISING only).
      if (coin)
        replies.push(
          coin.raising !== undefined && raisingEnabled()
            ? await setRaising(ctx.installationId, coin.raising)
            : coin.answer && coin.project_key
              ? await coinAnswer(ctx, { project_key: coin.project_key, answer: coin.answer, wallet: coin.wallet })
              : { show_to_builder: COUNT_LINES.noted },
        );
      // v2.13 spec 3: the ship log (ctx.installationId is already the group root).
      if (benchEnabled() && (update || updates)) {
        const now = new Date();
        if (update?.text !== undefined) replies.push(await postUpdate(ctx.installationId, update.text, now, ctx.ownInstallationId ?? ctx.installationId));
        if (update?.hide !== undefined) replies.push(await hideUpdate(ctx.installationId, update.hide));
        if (updates) replies.push(await setUpdates(ctx.installationId, updates, now));
      }
      // v2.13.1 O5 N2: a refused push ends the proof branch's wait at once (the next find says it plainly).
      if (benchEnabled() && proof)
        replies.push({
          show_to_builder: '',
          agent_note: !proof.pushed && (await pushRefused(ctx.installationId, new Date()).catch(() => false)) ? PUSH_REFUSED_NOTE : PUSH_DONE_NOTE,
        });
    }
    // v2.13.1 O2 (B6): "not mine" on the one project, while it isn't Bench-confirmed, clears it. Fix
    // round 1 (minor): only for input tell_earnkit's own schema (TellInput) accepts.
    const facts = benchEnabled() && !ctx.sharedClient && statements.repo_facts !== undefined ? TellInput.safeParse(defined({ ...statements, signed_in })) : null;
    for (const f of facts?.success ? (facts.data.repo_facts ?? []) : [])
      if (f.not_mine === true) {
        await dropMainProject(ctx.installationId, saidKey(f.repo)).catch((err: unknown) =>
          console.error('[tell] not mine', err instanceof Error ? err.name : 'error'),
        );
      }
    if (pickup !== undefined) replies.push((await handlers.pick_up_entries({ answer: pickup }, ctx)) as Reply);
    if (submitted) replies.push((await markSubmitted(submitted, signed_in, ctx)) as Reply);
    if (Object.keys(statements).length > 0 || replies.length === 0)
      replies.push((await handlers.tell_earnkit(defined({ ...statements, signed_in }), ctx)) as Reply);
    return joinReplies(replies);
  },

  // v2.12 spec 7: the builder's score (registered in mcp.ts only while EARNKIT_BUILDER_SCORE=on).
  score: async (_input: unknown, ctx0: ToolContext) => {
    // v2.12.1 fix rounds 1, 2: a pending join's one yes is asked once (pick_up, answered through tell).
    // T8: it is the reply's one question, last; the step up waits a reply.
    const ctx = await withProbation(ctx0);
    const join = builderScoreEnabled() && !ctx.sharedClient && !ctx.probation ? await askJoin(ctx.installationId) : null;
    const scored = await scoreReply(ctx, new Date(), { hold: Boolean(join), reader: ctx.readerDeps, fresh: freshSwitches(ctx, true) });
    // v2.13.1 O2: under the Bench, build_offer carries no note (move_up is the one route).
    const offer = scored.build_offer;
    const reply = offer
      ? benchEnabled()
        ? { ...scored, build_offer: { program_id: offer.program_id, starter_id: offer.starter_id } }
        : { ...scored, build_offer: { ...offer, agent_note: offer.can_build ? BUILD_NOTE : PLAN_NOTE } }
      : scored;
    if (!join) return reply;
    const { question } = join;
    return { ...reply, show_to_builder: [reply.show_to_builder, question].filter(Boolean).join('\n\n'), pick_up: { question, agent_note: PICKUP_NOTE } };
  },

} satisfies Record<string, (input: unknown, ctx: ToolContext) => Promise<unknown>>;

export type ToolName = keyof typeof tools;
export const isToolName = (name: string): name is ToolName => Object.hasOwn(tools, name);
