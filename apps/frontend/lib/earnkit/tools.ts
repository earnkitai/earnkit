import { tellBuilderCode } from './used-by';
import type { ProofFetch } from './outcome-proof';
import { newsPost, outcomePost } from './post-reply';
import { hasEntry } from './post-moments';
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
  startEntry,
  submittedEntry,
  type EntryDeps,
} from './projects';
import { EntryError, githubRepo, givenWallet, isWalletAddress, normalizeRepoUrl, presentYourEntries } from './campaigns';
import { signToEnter } from './entry-proof';
import { NO_COIN_YET, confirmTable, enteredText, todoOf, withClosesIn, type EnteredText } from './entry-text';
import { hoursLeft } from './deadline';
import { repoNameOf, titleCase } from './token-proposal';
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
import { outcomeLine, outcomeToAsk, type OutcomeAsk } from './outcomes';
import { SHIP_LOG_NOTE, shipLogBlock, shipLogFacts } from './ship-log-facts';
import { draftApplication } from './draft-application';
import { wonSource } from './stats';
import { WHICH_EMAIL, saveWeeklyEmail } from './digest';
import { TellInput, emptyMemory, factsAck, hiddenIds, hiddenPrograms, memoryKey, readMemory, saidKey, tell, type BuilderMemory, type MemoryKey, type SaidRepo } from './builder-memory';
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
  closesInDays,
  enterableWithoutRepo,
  layout,
  leadRow,
  submitStep,
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
  STILL_CHECKING_LAUNCH,
  SKIPPED_ENTRY,
  pendingOutcome,
  type TokenFlowDeps,
} from './token-launch';
import { RAW_CAP, canonicalBuilderUrl, cleanProject, quoted } from './untrusted-text';
import { pagesLinkOf } from './pages-link';
import { proveRepo, type ProvenRepo } from './token-gate';
import { heldByOther, installLink } from './repo-proof';
import { READY_TO_SUBMIT, confirmDecision } from './confirm';
import { HOST_LINES, HOST_ZONE, UPLOAD_NOTE, hostSignInLine, issueUpload, liveLine, refreshSiteExpiry } from './hosting';
import { r2Enabled } from './r2';
import { EARNKIT_ORGS } from './earnkit-orgs';
import { earnkitOwnRepo } from './own-brand';
import {
  BUILD_CHAT_ONLY,
  buildCheck,
  buildFix,
  buildKit,
  buildingLine,
  freshPick,
  publicTestWallet,
  twistQuestion,
  type BuildFields,
  type FreshPick,
} from './fresh-build';
import { createVerifyLink, githubVerifyEnabled, installationLogin, loginBasisFor, pageHandle } from './github-verify';
import { appTokenFor, githubAppEnabled, hasAppProof } from './github-app';
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
import { hideUpdate, postUpdate, setShipTitles } from './updates';
import { enqueueDiscovery, localGitInput } from './discovery';
import { benchIdentity, benchProject, identityInput, noteIdentity, projectKeyOf } from './identity-input';
import { REPO_KEY, dropMainProject, fillGithubUser, mainProjectOf, setMainProject } from './main-project';
import { APPLY_OUTCOME_NOTE, BENCH_OUTCOME_NOTE, benchFind, benchMoveUp, draftAnswered, pathTrack, readySent, readyTracked, type ReadyAnswers, submitAsked, recordApplyYes, keepBenchMatch, legacyCoinAnswer, tokenAsk, tokenExisting, keptBenchMatch, mainProjectName, mainProjectNameFor, rankAnswer, rememberProjectName, signedOutNow } from './bench-find';
import { CHAIN_EXPLAINED, CHAIN_NAMES, type Chain } from './chains';
import { provenWallet } from './wallet-proof';
import { walletChangeReply } from './wallet-offer';
import { REPLY_WAIT_MS, ReplyLate, inTime } from './reply-wait';
import { scoreReply } from './score-tool';
import { aboutFacts, replyFacts, type ReplyFacts } from './reply-facts';
import { agentReach } from './agent-reach';
import { ANSWER_FIRST_NOTE, NOTED_LINE } from './stand-text';
import { ANSWERED_FIRST, MENTOR_NOTE, PATH_ANSWER_FIRST, trackLead } from './conversation';
import { readyTrackLead } from './ready-copy';
import { startRefresh } from './stand-view';
import { attributionFor, chainOf } from './attribution';
import type { ReaderDeps } from './source-readers';
import { SKIPPED_LINE, cardYes } from './share';
import { SHARED_PROFILE_NOTE, deleteAsk, ensureProfile, setFallback, setHidden } from './profiles';
import { xSignInEnabled } from './builder-score-flag';
import { sql } from './db';
import { API_CONTENT } from './api-program-text';
import { hiddenFor } from './api-stale';
import { STRIPE_DISCONNECTED, STRIPE_NEVER_KEY, STRIPE_NOT_CONNECTED, STRIPE_NO_LINK, stripeConnectLine, stripeDraftNote } from './bench-reply';
import { disconnectStripe, stripeLink, takeStripeDraftLink } from './stripe';
import { projectKey, readBank, saveApplication, saveBank } from './answer-bank';
import { rootOf } from './identity';
import { READY_ANSWERS, type FieldKind } from './program-file';
import type { ProgramRow } from './programs';
import { RateLimitError, enforce } from './rate-limit';
import { SIGN_IN_NOTES, bindFromPaste } from './x-link';
import { LAUNCHING, NOT_LAUNCHED_YET, REPO_HAS_TOKEN, launchClaimedAt, repoCoinPrograms, tokenLaunchesAvailable, type TokenOutcome } from './tokens';

/** Who is calling: the installation behind the MCP connection. */
export type ToolContext = {
  /** v2.8.1 §E18: the installation the tools act as (a linked installation's group root). */
  installationId: number;
  /** v2.8.1 §E18: the token's own installation; defaults to installationId. */
  ownInstallationId?: number;
  /**
   * v2.8.1 §E17: the token's installation came from a hosted agent client: saved answers are reused
   * only after a yes/no that names them, and the remembered wallet is never suggested.
   */
  sharedClient?: boolean;
  /** Test and e2e injection only; never set by the MCP route. */
  tokenDeps?: TokenFlowDeps;
  /** Test and e2e injection only; never set by the MCP route. */
  entryDeps?: EntryDeps;
  /** v4.2 Task 4 (F7): set by tell submitted: the existing entry record_submission updates (never a second row). */
  entryId?: number;
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
  /** Proof ruling: test injection only: the fetch that reads an outcome's proof page or X oEmbed (outcome-proof.ts). */
  proofFetch?: ProofFetch;
  /** v2.12.1 T8: test injection only: the on-demand refresh's readers (person-score.ts refreshPerson). */
  readerDeps?: ReaderDeps;
  /** v3.1 Task 7: test injection only: the fetch the background Builder Codes check reads GitHub with. */
  codesFetch?: typeof fetch;
  /** v4.0: test injection only: the builder token launch's tokens.fun fetch and ticker check ("launch my token"). */
  builderTokenDeps?: { fetch?: typeof fetch; check?: (symbol: string) => Promise<boolean | null>; isToken?: (address: string) => Promise<boolean | null> };
};

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
const walletMemory = async (ctx: ToolContext) =>
  ctx.sharedClient ? null : ((await provenWallet(ctx.installationId)) ?? (await rememberedWallet(ctx.installationId)));
/** Campaign entries' remembered wallet question names the last entry's wallet only (rememberedWalletQuestion's note). */
const lastEntryWallet = (ctx: ToolContext) => (ctx.sharedClient ? Promise.resolve(null) : rememberedWallet(ctx.installationId));

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
  return {
    coinIn,
    tokenHere,
    policyOff: program.token_policy === 'off',
    available: (ctx.tokenDeps?.available ?? tokenLaunchesAvailable)(),
  };
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

/** Every coach note for the agent (the copy review scans them). */
export const COACH_NOTES = { COACH_NOTE, QUESTIONS_NOTE, DRAFT_NOTE, AGENT_FIXES_NOTE, FIXES_NOTE };

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
    // identityInput; never refused, a clue only (never proof, never a merge).
    identity: z.unknown().optional(),
    // v2.8.1 §B6: anything else than a 0x address is ignored with WALLET_IGNORED, never an error.
    wallet: z.unknown().optional(),
    // v2.10 item 2: "show more": today's tables instead of the one lead line.
    more: z.boolean().optional(),
    // v2.13.3 (1): an older agent's live link for its project; read only under the Bench (benchIdentity).
    live_url: z.unknown().optional(),
    // v4.8 Task 1: a direct question (mcp.ts find), and a program the builder named; read by the Bench (benchFind).
    ask: z.enum(['standing', 'programs']).optional(),
    program: z.string().max(100).optional(),
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
 * (match-projects.ts ReportedRepoInput) or a wallet that isn't 0x (dropped, with a note). `shared`: the
 * caller is a shared client. Exported for tests.
 */
export function listProgramsInput(input: unknown, o: { shared?: boolean } = {}) {
  const { wallet, agent_can_build, github_user, repos, local_git, identity, live_url, ...rest } = ListProgramsInput.parse(input ?? {});
  const repoList = reportedRepos(repos);
  const localGit = localGitInput(local_git);
  const given = identityInput(identity, localGit);
  // v2.13 spec "2a": the one project the agent is in (identity.project, else an old agent's first).
  // v2.13.3 (1), v2.14 A24: the older fields (github_user, repos, local_repos, live_url) are mapped once
  // into identity for every non-shared caller (never dropped); a shared client's are never read into it.
  const bench = !o.shared
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

/** v2.8.1 §E18: a yes or a no as an agent passes it; null when it is neither. Pure; exported for tests. */
export { yesNo };

/** v2.8 Ruling 30 (plan): what the agent does with ask_outcome. v2.9 A3: the answer goes to tell_earnkit. */
export const ASK_OUTCOME_NOTE =
  'Results for this entry were due. After showing show_to_builder, ask the builder this question once, as written. ' +
  'Then call tell with program_status: this program_id and project_id, their result (won, placed or lost), ' +
  "and prize_usd if they won money. If they don't know yet, call nothing. For accepted, funded or won, open a public page that shows it (the program's X post or results page) and pass its link as proof_url.";

/** v3 Stage 2: ask_outcome's note for an application (no entry) on the short reply. */
export const APPLY_ASK_OUTCOME_NOTE =
  "An application's deadline passed 14 days ago. After showing show_to_builder, ask the builder this question once, as written. " +
  "Then call tell with program_status: this program_id and their status (applied, accepted, funded or rejected). If they don't know yet, call nothing. For accepted, funded or won, open a public page that shows it (the program's X post or results page) and pass its link as proof_url.";

/** v3 Stage 2: ask_outcome's fields; an application's question names no entry (no project_id). Pure. */
const askOutcome = (ask: OutcomeAsk, agent_note: string) => ({
  ...(ask.project_id !== null && { project_id: ask.project_id }),
  program_id: ask.program_id,
  question: outcomeLine(ask),
  agent_note,
});

/** v2.8 Ruling C21: the note when the builder's own outcome was saved. */
export const OUTCOME_SAVED_NOTE = "Saved as the builder's own report. It never shows publicly or counts; only published results do.";
/** v2.9 B9: confirm_entry's note with the sign-in line (spec wording). */
export const SIGN_IN_NOTE =
  'Show the line. When the builder says they signed in, call confirm again with yes: true.';
/** v2.9 C12: the agent's note with the hosting sign-in line. */
export const HOST_SIGN_IN_NOTE =
  'Show host.show_to_builder. When the builder says they signed in, call prepare again with host: true for the upload URL.';

/**
 * v2.9 C12, Ruling 8: prepare_submission's `host` block: the builder's sign-in line, the one-time
 * upload URL (for the agent only; never in builder text), or a plain reason. Never fails the tool.
 * v2.14 spec 2: the repo is proven by the read-only App (hosting.ts issueUpload).
 */
async function hostBlock(
  ctx: ToolContext,
  repoUrl: string | undefined,
  name: string | undefined,
  /** v2.11 T9: the build path's proof of this repo on this call (token-gate.ts proveRepo). */
  proven: ProvenRepo | null = null,
): Promise<Record<string, string>> {
  // v2.14 spec 2: issueUpload proves the repo with the read-only App (a shared client is not hosted).
  if (!r2Enabled()) return { unavailable: HOST_LINES.unavailable };
  const gh = repoUrl ? githubRepo(repoUrl) : null;
  if (!gh) return { unavailable: HOST_LINES.noRepo };
  const project = name?.trim() || titleCase(gh.repo);
  try {
    const offer = await issueUpload({ installationId: ctx.installationId, repoKey: `${gh.owner}/${gh.repo}`, project, proven }, new Date());
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
 * installation serves many builders. Entries are still recorded.
 */
const remembers = (ctx: Pick<ToolContext, 'sharedClient'>) => !ctx.sharedClient;

/**
 * v2.10 fix round 1 (I2): who reads a cached App-read repo row: this installation, and on a shared
 * client no one (null: it has no verified caller).
 */
const appViewer = (ctx: Pick<ToolContext, 'installationId' | 'sharedClient'>) => ({
  installationId: ctx.installationId,
  login: ctx.sharedClient ? null : undefined,
});

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
 * entries the alerts already read; none on a shared client (no verified caller there).
 */
async function withAlerts<T extends object>(ctx: Pick<ToolContext, 'installationId' | 'sharedClient'>, result: T) {
  if (!remembers(ctx)) return result;
  const a = await alertsFor(ctx.installationId);
  const line = sinceLine(a.lines);
  return withDeadline(ctx.installationId, { ...(line && { since_you_last_checked: line }), ...result }, a.entries);
}

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
  // v2.12 spec 9: as find, only programs an agent can complete (v3 Stage 2: and open now, never upcoming).
  const alt = enterableWithoutRepo(open.filter((p) => p.agent_completable !== false && p.status !== 'upcoming'), program.id);
  const head = `${program.title} needs a public repo with your project's code.`;
  return alt ? `${head} No repo yet? ${alt.title} doesn't need one: say the word and I'll start there.` : head;
}

/**
 * v2.10 item 4: the v2.9 tool handlers, unchanged except their agent notes. The 4 builder tools
 * (`tools` below) dispatch to them; tests call them directly.
 */
export const handlers = {
  // One answer to "what can I earn?": the builder's projects first, then what's worth building,
  // opening with what changed since their last check.
  list_programs: async (input: unknown, ctx: ToolContext) => {
    const { agent_can_build, github_user, repos, local_repos, wallet, walletNote, more, identity, project, ask: question, program: named } = listProgramsInput(input, { shared: Boolean(ctx.sharedClient) });
    // v2.14: an installation joins a page only by signing in with its X (x-install.ts attachToX), so find
    // never asks anyone to join and what the agent reports is only a clue. A shared client has no page (R2).
    const scoring = !ctx.sharedClient;
    if (wallet) await rememberWallets(ctx.installationId, [wallet]);
    // v2.12 spec 1, 3: the public profile (made on the first find; named by the first remembered
    // wallet until a login is proven) and its clues. Never fails the tool and never waits on a read.
    // A shared group gets none (R2).
    let profiled = false as boolean;
    // v2.12.1 T8 (spec 2): the person's own public data is re-read inside this call, within its
    // budget, in parallel with the reads below (stand-view.ts startRefresh). Never fails the tool.
    const start = Date.now();
    const refresh: { started: { within: (capMs?: number) => Promise<void> } | null } = { started: null };
    if (scoring)
      await (async () => {
        const now = new Date();
        const made = await ensureProfile(ctx.installationId, now);
        if (!made) return;
        profiled = true;
        if (made.created || wallet) await setFallback(ctx.installationId, {});
        // v2.13 R1: the one project only; only its sources proposed and github_user filled (B3).
        // v2.13.1 O2 (B6): a different project replaces it until it is Bench-confirmed; after that it is
        // set once (B2) and a different project is stored in identity only.
        const main = project ? await setMainProject(ctx.installationId, project) : null;
        const isMain = Boolean(project && main && main.key.toLowerCase() === projectKeyOf(project).toLowerCase());
        if (isMain && project?.repo) await fillGithubUser(ctx.installationId, project.repo, identity.github_login);
        await noteIdentity(ctx.installationId, { ...identity, projects: project ? [project] : [] }, now, { propose: isMain });
        refresh.started = startRefresh(ctx.installationId, { now, start, reader: ctx.readerDeps });
        await enqueueDiscovery(ctx.installationId, 'first_find');
      })().catch((err: unknown) => console.error('[list_programs] profile', err instanceof Error ? err.name : 'error'));
    const [memory, openPrograms, campaigns, told] = await Promise.all([
      checkPrograms(ctx.installationId, { github_user, repos, local_repos }),
      // v4.9 final fix: a stale API program this builder is connected to stays in their list (api-stale.ts).
      listPrograms({ for: ctx.installationId }),
      earnkitCampaignRows(ctx.installationId),
      // v2.9 A3: what the builder told EarnKit, read once per call (G6: none on a shared client).
      memoryOf(memoryKey(ctx), 'list_programs'),
    ]);
    // v2.12 spec 9 (R21): only programs an agent can complete for the builder. v3 Stage 2: an upcoming
    // program is never matched, offered or entered; it only feeds the Bench's one upcoming line.
    const programs = openPrograms.filter((p) => p.agent_completable !== false && p.status !== 'upcoming');
    const upcoming = openPrograms.filter((p) => p.status === 'upcoming' && !p.earnkit_campaign);
    const hidden = hiddenPrograms(told, programs);
    const hide = hiddenIds(hidden);
    const { lastCheck } = memory;
    // Ruling G7: a shared client shows nothing the installation remembers (another builder's).
    const own = remembers(ctx);
    const workingOn = own ? memory.working_on : [];
    // Remembered from an earlier call when not given now (G7: never on a shared client).
    // v2.12.2: else the login the agent reported (identity), so a program can
    // be tied to one of their repos (a fit only: it confirms nothing).
    const reported = scoring && own && !github_user && !repos?.length && !memory.github_user ? identity.github_login : null;
    const user =
      github_user ?? (repos?.length ? undefined : own ? (memory.github_user ?? reported ?? undefined) : undefined);
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
    // v2.13 spec "Program matching uses the one project only": the matcher gets the one project's repo
    // (set at the first find, else the project this call names) and nothing else.
    const bench = scoring && profiled;
    /** v3.1 F1: the one project when it is an EarnKit repo this builder proved with the App (the owner's own). */
    let ownEarnkit: string[] | undefined;
    if (bench) {
      const main = (await mainProjectOf(ctx.installationId).catch(() => null))?.toLowerCase() ?? null;
      const one = main && REPO_KEY.test(main) ? main : (reportedRepos(project?.repo ? [project.repo] : [])[0] ?? null);
      repoList = one ? [one] : undefined;
      local = undefined;
      if (one && (await earnkitOwnRepo(ctx.installationId, `https://github.com/${one}`))) ownEarnkit = [one.toLowerCase()];
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
        // this builder proved it there (G7, G10: on a shared client none, null: no verified caller).
        const appOn = githubAppEnabled();
        const appLogin = ctx.sharedClient ? null : undefined;
        // R16b: odds no longer read the person's counted users and money (no longer counted); matching's own reads decide.
        const matchDeps: Pick<MatchDeps, 'appToken' | 'ownEarnkit'> = {
          ...(appOn ? { appToken: (n: string) => appTokenFor({ installationId: ctx.installationId, login: appLogin, repoKey: n.toLowerCase() }) } : {}),
          ...(ownEarnkit && { ownEarnkit }),
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
        // v2.13.1 O5 N1: on the Bench the reply waits for matching at most REPLY_WAIT_MS from the
        // start of the call (ReplyLate: no fits this reply; the repo's facts are cached for the next).
        // O5 fix round 1: every finished match of the one project is kept, so a reply cut short shows the
        // last one (under an hour old); a late GitHubError or RateLimitError is logged once.
        const mainKey = bench ? (repoList?.[0] ?? null) : null;
        if (mainKey) void matching.then((m) => keepBenchMatch(ctx.installationId, mainKey, m, new Date()), () => undefined);
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
        // Final fix 7 (preflight S7): an App link needs the person's page, so a caller with no handle (anonymous
        // or shared) is never sent to createVerifyLink, which would refuse and log an expected case as an error.
        const linkable = appOn && (first || matched.fromLocal?.length) ? Boolean(await pageHandle(ctx.installationId)) : false;
        const link =
          linkable && first
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
        if (linkable && !first && matched.fromLocal?.length) {
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
    if (own && yourRepos && 'fits' in yourRepos) {
      const fitRepos = yourRepos.fits
        .map((f) => fitRepoOf(f, (f.key && told.repos.get(f.key)) || null))
        .filter((r): r is FitRepo => r !== null);
      await setFitRepos(ctx.installationId, fitRepos).catch((err: unknown) =>
        console.error('[list_programs] fit repos', err instanceof Error ? err.name : 'error'),
      );
    }

    // The builder's campaign entries: rank (or the sponsor campaign's state), prize once paid.
    const yourEntries = own ? await yourCampaignEntries(ctx.installationId) : [];
    // EarnKit campaign standings are in the campaigns table; only sponsor entries get a section.
    const entries = presentYourEntries(
      yourEntries.filter((e) => e.campaign.kind === 'sponsor'),
      lastCheck,
    );
    // EarnKit wins come from the alerts engine (shown once); sponsor wins from here, placed right
    // after them (money first). Read last, so nothing after it can throw away the news.
    const alerts = own
      ? await alertsFor(ctx.installationId, { offer: true, otherWins: entries.wins })
      : { lines: [] as string[], scheduleNote: null };

    const withPools = cards;
    // v2.8.1 §B9: "Your entries" and the "entered" marks; never fails the tool (none on an error).
    const myEntries = !own ? [] : await openEntries(ctx.installationId).catch((err: unknown) => {
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
      entries: myEntries,
      hidden,
      // v2.9 E20: "Builders using EarnKit won $X" (announced prizes only), absent at 0.
      wonUsd: await wonSource.read(),
      // v2.10 item 15 (R12, Pre-flight P19): after "Your entries"; the same entries (a shared
      // client's only for its verified login, none without one).
      deadline: await takeDeadlineLine(ctx.installationId, myEntries),
      more: more === true,
      // v2.11 T7: the no-repo lead's switches; off (no pick) unless deploys and hosting are on.
      // v3.1 (spec 3.4): find offers no build (no build_offer); the no-repo reply names open programs instead.
      fresh: undefined,
      // v3.1 cold read: "<Project> doesn't fit an open program yet." names the builder's own project.
      projectName: own ? await mainProjectName(ctx.installationId).catch(() => null) : null,
    };
    // v2.8 Ruling 30 (plan): at most one entry per call whose results were due; asked once. Read
    // after every other read (review minor 11), so nothing after marking it asked can lose the
    // question. Never fails the tool (the entry is then asked on a later call). v2.10 Ruling H10
    // (I3): one question per reply: this one, then the lead's.
    // v2.14 T9 fix round 1: signed out, the sign-in question wins; the results question is not used up (outcomeToAsk
    // marks it asked) until the first reply after the bind.
    // v3 Stage 1: an anonymous hosted installation (no page, no X) always reads as signed out: the Bench's
    // signed-out reply is the only reply (the sign-in link and its one question).
    // Only with X sign-in on (as signedOutNow), and only when the caller's own installation is unbound.
    const hostedAnon = Boolean(ctx.sharedClient) && !more && xSignInEnabled() && Boolean(process.env.EARNKIT_AUTH_SECRET)
      && (await sql()<{ x: string | null }[]>`SELECT x_user_id AS x FROM installations WHERE id = ${ctx.ownInstallationId ?? ctx.installationId}`)[0]?.x == null;
    const signedOut = hostedAnon ? true : scoring && profiled && !more
      ? await signedOutNow(ctx.installationId, ctx.ownInstallationId ?? ctx.installationId).catch(() => true)
      : false;
    const ask = signedOut || !own ? null : await outcomeToAsk(ctx.installationId).catch((err: unknown) => {
      console.error('[list_programs] outcome ask', err instanceof Error ? err.name : 'error');
      return null;
    });
    first.holdQuestion = Boolean(ask);
    // v2.12.1 T8 (spec 2): the Bench's three-part reply (where you stand, ways to get funded, how to
    // move up) replaces the short v2.11 reply. "Show more" (more: true) and a shared client keep the
    // v2.11 tables.
    // v4.3 Task 2: "show more" for a ranked builder is the same Bench reply with the full program table (benchFind
    // answers null in any other state, which keeps the v2.11 tables below).
    if ((scoring && profiled) || hostedAnon) {
      // A wallet the builder named ("add my wallet") that isn't their proven one: its signing link, never the status.
      // Only with a link (a page signed in with X); else the wallet only shows its wins, as before.
      if (scoring && profiled && !more && wallet && wallet.toLowerCase() !== (await provenWallet(ctx.installationId))?.toLowerCase()) {
        const change = await walletChangeReply(ctx.installationId, new Date());
        if (change.move_up) return change;
      }
      // v2.13.1 O5 N1: the reply waits for the refresh at most REPLY_WAIT_MS (it runs on).
      await refresh.started?.within(REPLY_WAIT_MS);
      const shownCards = withPools.filter((c) => !hide.has(c.id));
      // v2.13 T8: the Bench's three parts (bench-find.ts).
      const r = await benchFind(ctx, {
        // v4.3 Task 2: signedOut was not read for "show more"; benchFind reads it then.
        start, first, cards: shownCards, repos: yourRepos, myEntries, ask, alerts, hide, project, signedOut: more ? undefined : signedOut,
        localRepos: local_repos?.length ? local_repos : own ? (memory.local_repos ?? undefined) : undefined,
        upcoming: upcoming.filter((c) => !hide.has(c.id)),
        more: more === true,
        ...(question && { question }), ...(named && { named }),
      });
      if (r) return {
        ...r,
        ...(walletNote && { wallet_note: walletNote }),
        // v2.14 A17: the question is show_to_builder's last line, so the note only routes the answer.
        ...(ask && { ask_outcome: askOutcome(ask, ask.kind === 'apply' ? APPLY_OUTCOME_NOTE : BENCH_OUTCOME_NOTE) }),
        matches:
          yourRepos && 'fits' in yourRepos
            ? matchRows(yourRepos.fits, new Set(programs.filter((p) => p.any_chain).map((p) => p.id))).filter((x) => !hide.has(x.program_id))
            : [],
        working_on: first.workingOn,
        // v4.8.2 Task 3 (R4): closes_in and the summary in hours under 48 hours (agentPrograms).
        programs: agentPrograms(programs, first.now),
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
      show_to_builder: shown,
      note:
        `${ANSWER_FIRST_NOTE} ` +
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
      ...(ask && { ask_outcome: askOutcome(ask, ask.kind === 'apply' ? APPLY_ASK_OUTCOME_NOTE : ASK_OUTCOME_NOTE) }),
      // For planning: what each repo still needs, per program. Details: get_program.
      matches:
        yourRepos && 'fits' in yourRepos
          ? matchRows(yourRepos.fits, new Set(programs.filter((p) => p.any_chain).map((p) => p.id))).filter(
              (r) => !hide.has(r.program_id),
            )
          : [],
      working_on: workingOn,
      // v4.8.2 Task 3 (R4): closes_in and the summary in hours under 48 hours (agentPrograms).
      programs: agentPrograms(programs, first.now),
    };
  },

  get_program: async (input: unknown, ctx: ToolContext) => {
    const { program_id, repo } = GetProgramInput.parse(input);
    // v4.8.2 Task 3 (R4): closes_in beside the ISO deadline (no summary here; the guide header says the hours itself).
    const program = await getProgram(program_id).then((p) => ({ ...p, closes_in: agentClosesIn(p, new Date()) }));
    // v4.9 final fix (ruling 6): a stale API program reads only for a builder who entered, applied to or drafted it.
    if (await hiddenFor(await getProgramRow(program_id), ctx.installationId)) throw new NotFoundError(`No program with id "${program_id}". Call find for current ids.`);
    if (!repo) return withAlerts(ctx, program);
    // Eligibility dry run for one repo: pass/fail plus what's missing.
    try {
      await enforce('githubMatching', ctx.installationId, GITHUB_LIMITED);
      // v4.2 Task 10 (G3): what the builder told about this repo (has users, a live link) counts, as in the lists (none on a shared client).
      const full = githubRepo(repo.includes('://') ? repo : `https://github.com/${repo}`);
      const told = full ? (await memoryOf(memoryKey(ctx), 'get_program').catch(() => null))?.repos.get(saidKeyOf({ url: `https://github.com/${full.owner}/${full.repo}`, name: full.repo })) : undefined;
      return withAlerts(ctx, {
        ...program,
        eligibility: await checkEligibility(repo, program_id, {}, told),
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
    const { program_id, agent: _agent, coach_asked, host, ...known } = PrepareSubmissionInput.parse(input);
    const program = await getProgramRow(program_id);
    // v3.1 R15: an unlisted program is refused on every prepare path (the build, deploy and host ones too), never "closed".
    // v4.9 final fix (ruling 6): a stale API program is unlisted too, unless this builder entered, applied to or drafted it.
    if (await hiddenFor(program, ctx.installationId)) throw new NotFoundError(`No program with id "${program_id}". Call find for current ids.`);
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
    // v4.9 final fix (F1): an api program is curated too (the same guide and draft path).
    const curated = (program.source === 'file' || program.source === 'api') && !program.campaign;
    const firstPrepare =
      open && curated && (ctx.sharedClient ? !coach_asked : added && !(await hasProgramEntry(ctx.installationId, program_id)));
    // The guide's parts: what won, what it wants, best bet. No bonus line here: the confirm line says
    // the bonus when this entry can earn it (a repo's token entered elsewhere can't).
    const guide = firstPrepare && !join ? guideText(programGuide(program, new Date(), { hours: true })) : null;
    const lead = join ? join.lead.join('\n') : null;
    const withGuide = <T extends { show_to_builder: string }>(r: T): T =>
      guide ? { ...r, show_to_builder: `${guide}\n\n${r.show_to_builder}` } : r;
    // This installation's last wallet (Ruling 10 (plan)). Campaign entries: asked about in full and
    // never prefilled (I8: a hosted client sharing one registration shares this memory). Other
    // programs: shown short on the confirmation offer's wallet line.
    // v3.1 wallet proof: outside campaigns the proven wallet (the builder's own signature) comes first.
    const remembered = program.campaign ? await lastEntryWallet(ctx) : await walletMemory(ctx);
    // v3.1 wallet proof: a campaign's payout wallet is the proven one when the builder gave none (their signature named
    // it their reward wallet, so it is never asked again; I8's shared-memory worry is about remembered wallets only).
    const proven = program.campaign && !ctx.sharedClient && !known.answers?.payout_wallet?.trim() && program.submission_requirements.some((r) => r.key === 'payout_wallet')
      ? await provenWallet(ctx.installationId)
      : null;
    if (proven) known.answers = { ...(known.answers ?? {}), payout_wallet: proven };
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
    // v4.0 Task 11: no entry gets a token (the per-project offers are retired; builder tokens replaced them).
    const payoutWallet = given;
    const sign_to_enter = signToEnter(
      program_id,
      repoUrl,
      payoutWallet,
      known.answers?.contracts,
    );
    // v2.4 §2: the one confirmation the builder sees, prize first.
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
      token: null,
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
            "in one commit. Contracts count when they were deployed from the payout wallet, or from your own wallet if you pass deployer_signature: that wallet's EIP-191 signature (personal_sign) of sign_to_enter, which names this program, the repo, the payout wallet and the contracts (it appears once all are known; a changed contract list needs a new signature).",
          ...(sign_to_enter && { sign_to_enter }),
        }),
        ...(hosting && { host: hosting }),
      });

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
    const coachQuestions = (wallet: boolean) =>
      questionsFor({
        reqs: program.submission_requirements,
        answers: values,
        first: banked?.first ?? true,
        project: banked?.name,
        suggested: banked?.suggested,
        wallet,
        shared: ctx.sharedClient,
      });
    // v4.0 Task 11: no entry gets a token, so the coach's round never asks for a fee wallet (v2.8.1 §C11 retired).
    const questions = open && !coach_asked ? coachQuestions(false) : [];
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
        agent_note: QUESTIONS_NOTE,
        ...(hosting && { host: hosting }),
      }));

    // v2.8 Part C, Ruling 4 (plan): other programs. Once ready, the draft, the check's fixes and the
    // confirmation offer (the builder bonus comes with a token) close the screen; the kit comes only
    // from confirm_entry, so no submission link, prefilled link or paste list here.
    // v4.0 Task 11: no token offer: a ready draft on an open program ends "Ready to submit?".
    const offer = open && prep.ready ? READY_TO_SUBMIT : null;
    const pitch = offer;
    // v2.14 spec 2: no token line: a token's repo is checked at confirm by the gate (the read-only App).
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
    // v3 Stage 2 (spec 5.3): the ready draft opens with the builder's ship log facts (statements, never a question). Off a
    // shared client only (its installation serves many builders); a failed read is no block.
    const shipLog = prep.ready && !lead && !ctx.sharedClient
      ? await shipLogFacts(ctx.installationId, new Date()).catch((err: unknown) => {
          console.error('[prepare_submission] ship log', err instanceof Error ? err.name : 'error');
          return null;
        })
      : null;
    const show_to_builder = lead && prep.ready
      ? [lead, fixesLine(fixes), pitch].filter((x): x is string => Boolean(x)).join('\n')
      : lead
        ? `${lead}\n\n${table}`
        : prep.ready
      ? [
          shipLog ? shipLogBlock(shipLog).join('\n') : null,
          draftTable(program.submission_requirements, values),
          fixesLine(fixes),
          offer ? (offer.endsWith(READY_TO_SUBMIT) ? offer : `Ready. ${offer}`) : null,
        ]
          .filter((x): x is string => Boolean(x))
          .join('\n\n')
      : table;
    // v2.11 T10: on the build path earnkit.txt already holds the line (the build's proof), and there is no table.
    const notes = [
      ...(prep.ready ? [agent_fixes.length > 0 && AGENT_FIXES_NOTE, join ? BUILD_ENTRY_NO_TOKEN_NOTE : DRAFT_NOTE, fixes.length > 0 && FIXES_NOTE] : [COACH_NOTE]),
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
      ...(notes.length > 0 && { agent_note: `${notes.join(' ')}${shipLog ? SHIP_LOG_NOTE : ''}` }),
      ...(shipLog && { ship_log: shipLog }),
      ...(join && { entry: { project: known.project ?? {}, answers: known.answers ?? {} } }),
      ...(hosting && { host: hosting }),
    }));
  },

  // v2.8 Part C, Rulings 1, 4, 5 and 7 (plan): the confirmation step. Without the builder's yes it
  // returns the offer; on "go" the token launches; the submit kit comes only from here.
  confirm_entry: async (input: unknown, ctx: ToolContext) => {
    const i = ConfirmEntryInput.parse(input);
    const program = await getProgramRow(i.program_id);
    if (program.campaign) throw new EntryError('EarnKit campaigns are entered in one step.');
    if (!isOpen(program)) throw new EntryError('This program is closed or past its deadline.');
    // Ruling 22: a wallet given is valid or the call fails (a typo never falls back to another), the coach's round's too.
    givenWallet(i.wallet);
    givenWallet(i.answers[WALLET_KEY]);
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
    const facts = await offerFacts(program, repoUrl, ctx);
    // v4.0 Task 11: no entry gets a token (the per-project offers are retired): a yes records the entry, never a launch.
    const decision = confirmDecision({
      confirmed: i.builder_confirmed === true,
      decision: i.decision,
      coinIn: facts.coinIn,
      canPush: i.agent?.can_push !== false,
      hasRepo: Boolean(repoUrl),
      policyOff: facts.policyOff,
      available: facts.available,
      signIn: githubAppEnabled(),
      belowScore: true,
    });
    if (decision.kind === 'offer')
      return {
        show_to_builder: READY_TO_SUBMIT,
        agent_note: 'Show show_to_builder as written. When the builder says yes, call confirm again with yes: true.',
      };

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

    // An entry made before v4.0 Task 11 keeps reporting its token; nothing launches here any more.
    const token: TokenOutcome | null = entry.token_url
      ? entry.token_url === 'pending'
        ? pendingOutcome(entry.token_claimed_at, entry.token_settled)
        : { status: 'launched', tokens_fun: entry.token_url, note: 'This entry already has its token.' }
      : null;

    // v2.8.1 §A5: the deploy runs on past the reply time: "launching", no kit yet; the agent calls
    // again shortly and that call returns the token's link with the kit.
    if (token?.launching)
      return {
        project_id: entry.id,
        token,
        show_to_builder: token.note ?? LAUNCHING,
        agent_note: `${token.agent_note ?? ''} The submit kit comes with that reply.`.trim(),
      };

    // v2.12 spec 7 (R22), v4.0 Task 11: no token is offered, so nothing is said about it.
    const skipLine = '';
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
    // v3 Stage 1 (spec 5.4): the weekly email question moved to the first yes after activation (bench-find.ts).
    return {
      project_id: entry.id,
      ...(token && { token }),
      kit,
      // v2.8.1 §C13: a repo whose token is in another program: the kit alone (no bonus note here).
      show_to_builder: first ? `${first}\n\n${kit.show_to_builder}` : kit.show_to_builder,
      // Part E, Rulings 7, 27, 28 (plan): how this kit is used (the agent's, never the builder's).
      // v2.9 F25: the kit rules that left confirm_entry's description are here.
      agent_note: kitReplyNote(kit, program),
    };
  },

  record_submission: async (input: unknown, ctx: ToolContext) => {
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
      ...(ctx.entryId !== undefined && { entryId: ctx.entryId }),
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
        : // v4.0 Task 11: no entry gets a token any more (the per-project offers are retired).
          { status: 'skipped', note: "This entry's token isn't launched." };
    // Campaign entries carry their own table (enteredTable).
    if ('show_to_builder' in result && result.show_to_builder)
      return withAlerts(ctx, { ...result, show_to_builder: result.show_to_builder, token });
    // v2.6 §3: outside campaigns, the reply the builder sees: the coin.
    const tokenOut = token.no_wallet
      ? // Ruling 31's split here too: plain note, the instruction (NO_COIN_YET) for the agent.
        { ...token, note: 'No token yet: no wallet was given.', agent_note: NO_COIN_YET }
      : token;
    // Skipped: the builder said no, the program has no coins, or (Ruling 25) the repo has its coin.
    const skipped =
      // v4.0 Task 11: no entry gets a token, so a skipped one says nothing about it.
      token.status === 'skipped' ||
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
    const also = await alsoQualifiesBlock(parsed, ctx, verified?.live === true).catch((err: unknown) => {
      console.error('[also_qualifies]', err instanceof Error ? err.name : 'error');
      return null;
    });
    const show_to_builder =
      enteredText({ programTitle: result.program_title, coin, countsIn }) + (also?.text ? `\n\n${also.text}` : '');
    return withAlerts(ctx, {
      ...result,
      token: tokenOut,
      show_to_builder,
      ...(also?.rows.length && { also_qualifies: also.rows }),
    });
  },

  // v2.9 A3: what the builder told EarnKit (programs: applied, not interested, their own outcomes;
  // repos: chains, live link, users, not theirs). It replaced report_outcome; list_programs stays read-only.
  // Ruling G6: on a shared client nothing about programs or repos is kept (memoryKey null).
  tell_earnkit: async (input: unknown, ctx: ToolContext) => {
    const told = TellInput.safeParse(input);
    const weekly = told.success ? told.data.weekly_email : undefined;
    // v2.9 E19 (Ruling 13): the weekly email answer alone stores no program or repo statement.
    const onlyEmail = weekly !== undefined && !told.data?.program_status?.length && !told.data?.repo_facts?.length;
    const key = memoryKey(ctx);
    const { saved, outcomes } = onlyEmail
      ? { saved: [] as string[], outcomes: 0 }
      : await tell(ctx.installationId, input as Parameters<typeof tell>[1], undefined, key);
    // Ruling G21: only the caller's own subscription (none on a shared client).
    // v3.1 answerable replies (spec 3): a yes without an address is "Done" only when an address is already on file
    // (saveWeeklyEmail); else the address is asked for, and an agent that can schedule may offer the check-in instead.
    const noAddress = weekly?.answer === 'yes' && weekly.email === undefined && !ctx.sharedClient;
    const mail = !weekly ? null : await saveWeeklyEmail(ctx.installationId, weekly, { shared: Boolean(ctx.sharedClient), login: null });
    if (mail?.saved) saved.push(`weekly email: ${weekly!.answer === 'yes' ? 'on' : 'off'}`);
    const mailNote =
      mail?.show_to_builder === WHICH_EMAIL
        ? "Ask the builder which email to use, then call tell again with weekly_email: { answer: 'yes', email }." +
          ((noAddress && (await checkinOpen(ctx))) ? ` ${CHECKIN_INSTEAD_NOTE}` : '')
        : null;
    // v3.1 cold read (bug 2): what they said about their repos is acknowledged in one short line, never nothing.
    const ack = !onlyEmail && key !== null && told.success && told.data.repo_facts?.length ? factsAck(told.data.repo_facts) : null;
    const show = [!onlyEmail && key === null ? NOTED_FOR_NOW : null, ack, mail?.show_to_builder ?? null].filter(Boolean).join(' ');
    const note = onlyEmail ? 'Show show_to_builder.' : key === null ? TELL_SHARED_NOTE : ack ? 'Saved. Show show_to_builder; the next find uses it.' : TELL_SAVED_NOTE;
    return {
      ...(show && { show_to_builder: show }),
      saved,
      agent_note: [note, outcomes > 0 ? OUTCOME_SAVED_NOTE : null, mailNote].filter(Boolean).join(' '),
    };
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
  prep: { project?: { name?: string; repo_url?: string }; answers?: Record<string, string> },
  ctx: ToolContext,
  /**
   * v2.11 T9: the build path's starter (the deployed event names it only for its own bytecode) and its
   * `built` event, written once every cap passed.
   */
  build: { starter?: { id: string; bytecode_hash: string | null }; beforeSend?: () => Promise<void> } = {},
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
  // Fix round 1 (I6): the installation's verified login (limits only); a shared client has none (v2.14 final fix:
  // its pasted sign-in code is gone, and deployForBuilder refuses it: no person, no proof).
  let login: string | null;
  try {
    login = shared ? null : await (ctx.deployDeps?.installationLogin ?? installationLogin)(ctx.installationId);
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

/**
 * The program as a fresh build would offer it right now (freshPick on that one program: open,
 * curated, Easy or Medium, a tested starter on a chain EarnKit deploys to with hosting on, not
 * hidden or entered), or null. Fail closed: deploys off, or hosting off for a starter with no GitHub
 * Pages fallback, means null. `anyDeploy` (T9): as if deploys were on, to name the starter's chain
 * when they are off.
 */
async function buildPick(programId: string, ctx: ToolContext, o: { anyDeploy?: boolean } = {}): Promise<Pick<FreshPick, 'starter'> | null> {
  // v3 Stage 2: never an upcoming program.
  const programs = (await listPrograms({ for: ctx.installationId })).filter((p) => p.status !== 'upcoming');
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
    // v2.13.1 O5 N7: the wallet line has a way out for a builder with none.
    show_to_builder: twistQuestion(known !== null),
    build: { program_id: programId, starter_id: pick.starter.id, step: 'twist' },
    agent_note: twistNote(known !== null),
  };
}

/** v2.12.1 T9: the attribution line a build kit carries (a chain EarnKit knows), else none. */
async function kitAttribution(id: number, chain: string) {
  const c = chainOf(chain);
  if (!c) return undefined;
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
  return {
    program_id: next.program_id,
    // v2.13.1 O5 N12: no chain name and the builder's "my" said back as "your".
    show_to_builder: shownBefore ? '' : buildingLine(next.name!, pick.starter, next.for_whom!),
    build: { program_id: next.program_id, starter_id: pick.starter.id, step: 'build' },
    kit: buildKit(
      pick.starter, { ...fields, wallet },
      // v2.12.1 T9 (spec 3): every app built through EarnKit carries the attribution line from the start.
      await kitAttribution(ctx.installationId, pick.starter.chain),
    ),
    agent_note: KIT_NOTE_BENCH,
  };
}

/** v2.13.1 O2, v2.14 spec 2: the kit note (no proof branch, no earnkit.txt: the repo is proven by the read-only App). */
export const KIT_NOTE_BENCH =
  'Show show_to_builder as written, then build from kit (never show it to the builder), step by step in kit.order: ' +
  'github_user to find first, then copy the starter and fill its twist slots, create the repo, commit and push at once, then call prepare as kit.next says.';
/** v2.14 spec 2: the build's deploy call before its repo is proven: the builder installs the read-only App (the link), then the agent calls again. */
export const buildInstallNote = (link: string) =>
  `EarnKit deploys once the repo is proven: the builder installs the read-only EarnKit app on it (one click): ${link} ` +
  "Show that link in one short line, and call this again once they say it's installed.";
export const BUILD_BRANCH_TAKEN_NOTE = "That repo is already on the leaderboard under another account, so EarnKit won't deploy it. Use a new repo under the builder's own account. Don't show this to the builder.";
/** v2.14 spec 2: the repo isn't proven and no install link can be made yet (the App is off, or the person has no page). */
export const BUILD_NOT_PROVEN_NOTE =
  "EarnKit deploys only a repo proven with the read-only EarnKit app, and this one isn't yet. Call find, which gives the builder the next step. Don't deploy it anywhere else. Don't show this note.";

/**
 * v2.14 spec 2: the build's repo proven by the read-only App (token-gate.ts proveRepo), else the reply that
 * asks for the install (its link), or says another person holds it.
 */
async function buildProof(ctx: ToolContext, repo: string, repoKey: string): Promise<{ proven: ProvenRepo } | { reply: Reply }> {
  const proven = await proveRepo({ installationId: ctx.installationId, repoUrl: repo });
  if (proven) return { proven };
  const root = await rootOf(ctx.installationId);
  if (await heldByOther(root, repoKey).catch(() => false)) return { reply: buildRefusal(BUILD_BRANCH_TAKEN_NOTE) };
  const link = await installLink(root, repoKey, new Date());
  return { reply: buildRefusal(link ? buildInstallNote(link) : BUILD_NOT_PROVEN_NOTE) };
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
/** v2.11 T10, v4.0 Task 11: the joined reply's note: the entry drafted from the build, never a token to name or skip. */
export const BUILD_ENTRY_NO_TOKEN_NOTE =
  'Show show_to_builder as written. The entry is drafted from the build (entry). When the builder says yes, call confirm with program_id, ' +
  'project: entry.project, answers: entry.answers and yes: true.';

export { githubPagesOwner, pagesLinkOf } from './pages-link';

/**
 * Plan S11: the `built` event, once per installation, repo and program
 * (`built:<installation>:<repo_key>:<program_id>`, security fix M4): written on the build path once
 * the repo passed the earnkit.txt line and every deploy cap passed, just before the send. Proof: the
 * repo link. The twist and the starter go in detail; the wallet is the build's; the login only when
 * the owner pushed the line (proofLineLogin).
 */
const builtEvent = (ctx: ToolContext, b: StoredBuild & { wallet: string }, repoKey: string) =>
  noteEvent('built', async () => {
    const who = await loginBasisFor(ctx.installationId, repoKey);
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
    if (!own) return { rest };
    const ownKey = `${own.owner}/${own.repo}`.toLowerCase();
    if (live) await pagesHostedEvent(ctx, programId, ownKey, live);
    // v2.13.1 O2 (B4): the live link is the build's last step; find no longer says "Building".
    if (live) await saveBuild(ctx.installationId, { ...stored, done_at: new Date().toISOString() });
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
  const byApp = await buildProof(ctx, repo, repoKey);
  if ('reply' in byApp) return byApp;
  const proven: ProvenRepo = byApp.proven;
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
        beforeSend: () => builtEvent(ctx, build, repoKey),
      });
  const out = step.deploy as { address?: unknown; owner_ok?: unknown };
  const deployed = typeof out.address === 'string';
  // v2.13 T8 (spec "2b"): the build becomes the one project (set once, plan B2), once its contract is
  // deployed. Never fails the build.
  if (deployed) {
    await setMainProject(ctx.installationId, { name: build.name ?? repoKey.split('/')[1], what: build.description ?? null, repo: repoKey, live_url: null, package: null, contracts: [] }).catch(() => undefined);
    // v2.14: the App proved it, so it is on the Bench today.
    await (await import('./person-score')).rescorePerson(ctx.installationId, new Date()).catch(() => undefined);
  }
  // Security fix M6: a site only for a contract the builder's wallet owns.
  const owned = deployed && out.owner_ok === true;
  const hosting = owned ? await hostBlock(ctx, repo, stored.name, proven) : null;
  const upload = hosting && 'upload_url' in hosting ? { upload_url: hosting.upload_url, expires_at: hosting.expires_at } : null;
  const host = hosting ? (upload ?? { github_pages: true, site_dir: starter.site_dir }) : null;
  // Final fix M8: still unconfirmed: the same call again settles it (the explorer note isn't the build's way on).
  const note =
    step.line === DEPLOY_PENDING
      ? BUILD_PENDING_NOTE
      : [step.agent_note, hosting ? `${BUILD_HOLD_NOTE} ${upload ? BUILD_UPLOAD_NOTE : BUILD_PAGES_NOTE}` : deployed ? BUILD_NOT_OWNED_NOTE : null].filter(Boolean).join(' ');
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

/** v4.6 Task 3: tell { stripe }. connect: the ask's link line, fresh (plain words when the link can't be made); disconnect: the key row and the stored figures are deleted. */
async function stripeReply(builderId: number, what: 'connect' | 'disconnect', now: Date): Promise<Reply> {
  if (what === 'connect') {
    const link = stripeLink(builderId, now);
    return { show_to_builder: link ? stripeConnectLine(link) : STRIPE_NO_LINK, agent_note: STRIPE_NEVER_KEY };
  }
  const had = await disconnectStripe(builderId);
  // The stored figures go with the key: a disconnected builder's drafts stop showing Stripe revenue at once.
  await sql()`DELETE FROM stripe_revenue WHERE builder_id = ${builderId}`;
  return { show_to_builder: had ? STRIPE_DISCONNECTED : STRIPE_NOT_CONNECTED };
}

/** v3.1 Used by: tell builder_code's replies (one short sentence each). */
export const BUILDER_CODE_SAVED = 'Saved. Your Builder Code counts once its payout wallet is one you proved.';
export const BUILDER_CODE_INVALID = 'That is not a Builder Code: lowercase letters, digits and underscores only.';

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
    // v2.12 spec 8: "hide" or "show".
    profile: z.enum(['hide', 'show', 'delete']).optional(),
    // v2.12.1 T12: kept and ignored. v2.12's tell took the X handle the builder confirmed; an agent
    // that kept that schema (the flag was on briefly in production) must not get a parse error.
    x_handle: z.string().max(20).optional(),
    // v2.12.1 T8: the builder's answer to "Want a card to share it?" ("skip" is one word).
    card: z.enum(['yes', 'skip']).optional(),
    // v2.12.1 T8: the builder's yes or no to the reply's question (find's or score's move_up).
    move_up: z
      .object({
        kind: z.string().max(20).optional(),
        project_key: z.string().max(300).nullable().optional(),
        // v4.8 Task 3 fix round 1 (2): 'sent' only when the builder says the application is in (the submit ask).
        // v4.10 Task 4 (R8): 'skip' with `skip`, the ready set's numbers to leave out (1-based).
        answer: z.enum(['yes', 'no', 'sent', 'skip']),
        // v4.10 final fix (M3): up to 10, so "skip 1 2 3 4" or a repeated number is filtered server side, never refused.
        skip: z.array(z.number().int()).max(10).optional(),
        // v4.10 Task 4 (R8): "sent" for only some of the ready set's open pages (their program ids).
        sent_ids: z.array(z.string().max(200)).max(3).optional(),
        // v2.12.1 T9: a go_live yes again, with the GitHub Pages link once it loads.
        live_url: z.string().max(300).optional(),
        // v4.8 Task 2 fix round 3: the builder's reply to a draft's blanks (bench-find.ts draftYes; never stored).
        blanks: z.string().max(2000).optional(),
        // v4.10 final fix (I1): the builder's one reply to the ready set's ask, split by field kind (bench-find.ts readyBank).
        answers: READY_ANSWERS.optional(),
      })
      .strict()
      .optional(),
    // v2.12.1 T10 (spec 3b): the builder's yes or no to a coin offer, with the wallet they gave.
    // v2.13 T9: or { raising } (the MCP schema lists it only while EARNKIT_RAISING is on).
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
    // Scoring and clarity R8: the builder asked about a token. Only then is the coin or community-round line
    // offered (bench-find.ts tokenAsk); find and score never offer it. v4.4: { existing } names the token the builder
    // already has (bench-find.ts tokenExisting); any string is taken, and one that isn't an address is the not-a-token line.
    token: z.union([z.literal('ask'), z.object({ existing: z.string().max(100) }).strict()]).optional(),
    // Launch ready L2: the repo the builder wants ranked instead (owner/repo or its GitHub URL; bench-find.ts rankAnswer).
    main_project: z.string().max(300).optional(),
    // v3.1 wallet proof: the builder wants their rewards sent to another wallet (or to add one): a fresh signing link.
    wallet: z.string().max(100).optional(),
    // v4.6 Task 3: connect (a fresh read-only link) or disconnect Stripe, any time.
    stripe: z.enum(['connect', 'disconnect']).optional(),
    // v3.1 Used by: a Base Builder Code the builder named, a candidate until the registry pays a wallet they proved.
    builder_code: z.string().max(100).optional(),
    // v2.13: this week's update (or hide one week), and the weekly-posting yes.
    update: z.object({ text: z.string().max(2000).optional(), hide: z.string().max(20).optional() }).strict().optional(),
    // v2.14 spec 3 (A12): titles on or off for a private repo's log; an older agent's { on, scheduled } is answered, nothing changes.
    updates: z.object({ titles: z.boolean().optional(), on: z.unknown().optional(), scheduled: z.unknown().optional() }).optional(),
    // Read by tell_earnkit (builder-memory.ts TellInput).
    program_status: z.unknown().optional(),
    repo_facts: z.unknown().optional(),
    weekly_email: z.unknown().optional(),
  })
  .strict();

type Reply = Record<string, unknown>;

const defined = (o: Reply): Reply => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * v2.12.1 T8, T9: the builder's answer to the reply's question. The step is the server's own (the ask the
 * last Bench reply stored); the agent's kind is never trusted, and a yes to a step that is no longer the
 * current one (or another project's) changes nothing (bench-find.ts benchMoveUp).
 */
const moveUpAnswer = (ctx: ToolContext, m: { kind?: string; project_key?: string | null; answer: 'yes' | 'no' | 'skip'; skip?: number[]; live_url?: string; blanks?: string; answers?: ReadyAnswers }): Promise<Reply> => benchMoveUp(ctx, m);

/**
 * v3.1 cold read (owner-approved): a program that wants a chain the project has no code for, in plain words: "Circle
 * wants apps that settle on Arc, Circle's chain. VaultPilot has no Arc code yet." Null when `note` is not the matcher's
 * "no <chain> code found in this repo". Pure.
 */
export function chainFitLine(note: string | null | undefined, org: string | null | undefined, name: string): string | null {
  const m = /^no (.+) code found in this repo\.?$/i.exec(note ?? '');
  if (!m) return null;
  const ids = m[1].split(/\s+or\s+/).map((c) => c.trim().toLowerCase()).filter((c): c is Chain => Object.hasOwn(CHAIN_NAMES, c));
  if (ids.length === 0) return null;
  const who = org?.replace(/\s*\([^)]*\)/g, '').trim() || 'This program';
  const names = ids.map((c) => CHAIN_NAMES[c]).join(' or ');
  const wants = ids.length === 1 ? (ids[0] === 'arc' ? `apps that settle on ${CHAIN_EXPLAINED.arc}` : `apps on ${CHAIN_EXPLAINED[ids[0]]}`) : `apps on ${names}`;
  return `${who} wants ${wants}. ${name} has no ${names} code yet.`;
}

/** find with program_id and repo: the eligibility check as one plain line, or null. Pure; exported for tests. */
export function eligibilityLine(repo: string, e: unknown, o: { org?: string | null; name?: string | null } = {}): string | null {
  if (!e || typeof e !== 'object') return null;
  const name = repo.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/(\.git)?\/?$/, '');
  if ('error' in e) return typeof e.error === 'string' ? e.error : null;
  const { status, note } = e as { status?: string; note?: string | null };
  // v3.1 cold read: never "no arc code found in this repo".
  const chainLine = status === 'no' ? chainFitLine(note, o.org, o.name ?? name) : null;
  if (chainLine) return chainLine;
  const said = note ? note.replace(/\.$/, '').replace(/^confirm: /, 'confirm ') : null;
  if (status === 'likely') return said ? `${name} fits: ${said}.` : `${name} fits.`;
  if (status === 'after_step') return `${name} fits after one step${said ? `: ${said}` : ''}.`;
  if (status === 'no') return `${name} doesn't fit yet${said ? `: ${said}` : ''}.`;
  return null;
}

/** R16: a shared client's "I submitted": nothing is written (v2.14 final fix: no caller can be verified there). */
export const SUBMITTED_SHARED_NOTE =
  "Nothing saved: this agent serves many builders, so EarnKit can't tell whose entry this is. The builder can mark it submitted on the program's site.";

/** tell's `submitted` (R16): the entry and its saved answers, then record_submission with builder_submitted. */
async function markSubmitted(s: NonNullable<z.infer<typeof TellToolInput>['submitted']>, ctx: ToolContext) {
  const done = defined({ external_submission_url: s.external_submission_url, builder_submitted: true });
  // Rulings G7, G9 (fix round 1, I2): on a shared client nothing is written or read (no verified caller).
  if (ctx.sharedClient) return { show_to_builder: NOTED_FOR_NOW, agent_note: SUBMITTED_SHARED_NOTE };
  // Pre-flight P15: an old call's own project and answers (record_submission finds or makes its entry).
  if (s.project_id === undefined && s.project) {
    // v4.2 Task 4 (F7): an old call carries a project, maybe without the repo the confirmed entry has. Only a call with no
    // repo falls back to the name, and only when exactly one entry of that name exists in this program (a call with a repo
    // is matched by that repo in ownEntry; two same-named entries are ambiguous), so no second row is made and no other
    // project's entry is marked.
    const nm = typeof s.project.name === 'string' ? s.project.name : '';
    const named = s.project.repo_url
      ? []
      : await sql()<{ id: number }[]>`
          SELECT id FROM projects WHERE installation_id = ${ctx.installationId} AND program_id = ${s.program_id}
            AND payout_wallet IS NULL AND lower(name) = lower(${nm}) LIMIT 2`;
    return handlers.record_submission({ program_id: s.program_id, project: s.project, submission_data: s.submission_data ?? {}, ...done }, named.length === 1 ? { ...ctx, entryId: named[0].id } : ctx);
  }
  const entry = await submittedEntry(ctx.installationId, s.program_id, s.project_id);
  if (!entry && s.project_id === undefined) return appliedOutside(s.program_id, ctx);
  if (!entry) throw new NotFoundError(`No entry ${s.project_id} in ${s.program_id} for this agent.`);
  return handlers.record_submission({ program_id: s.program_id, project: entry.project, submission_data: entry.answers, ...done }, { ...ctx, entryId: entry.id });
}

/** GTM W2: "I sent it" for a drafted application (no entry here): saved as applied, the program's outcome asked later. */
export const appliedLine = (title: string) => `Saved: you applied to the ${title.replace(/^the\s+/i, '')}.`;
/**
 * GTM W2 (2026-10-23): tell submitted with no EarnKit entry (prepare only drafts, the builder sends the form): recorded as
 * an application sent outside EarnKit (tell_earnkit program_status applied), never an error. Unknown program: its error.
 */
async function appliedOutside(programId: string, ctx: ToolContext): Promise<Reply> {
  const r = (await handlers.tell_earnkit({ program_status: [{ program_id: programId, status: 'applied' }] }, ctx)) as Reply;
  const [g] = await sql()<{ title: string }[]>`SELECT title FROM programs WHERE id = ${programId}`.catch(() => []);
  return { ...r, show_to_builder: g ? appliedLine(g.title) : 'Saved.', agent_note: "Show show_to_builder as written. Don't show this note." };
}

/** Several tell parts at once: their replies in order, show_to_builder lines joined. */
function joinReplies(replies: Reply[]): Reply {
  if (replies.length === 1) return replies[0];
  const shown = replies.map((r) => r.show_to_builder).filter((v): v is string => typeof v === 'string' && v !== '');
  const notes = replies.map((r) => r.agent_note).filter((v): v is string => typeof v === 'string' && v !== '');
  return {
    ...Object.assign({}, ...replies),
    ...(shown.length > 0 && { show_to_builder: shown.join('\n') }),
    ...(notes.length > 0 && { agent_note: notes.join(' ') }),
  };
}

/** A guide's text without its builder bonus section (guide.ts guideText: sections joined by a blank line). Pure. */
export const withoutBonusLine = (text: string) =>
  text.split('\n\n').filter((s) => !s.startsWith('Builder bonus:')).join('\n\n');

/** find without the paste code: list_programs, or one program and its guide (get_program). */
async function findReply(input: unknown, ctx: ToolContext): Promise<Reply> {
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
  // v2.12 final review (T9), v4.0 Task 11: no builder bonus line (funded by a token no entry gets any more).
  guide = withoutBonusLine(guide);
  r.guide = { ...r.guide, text: guide };
  // Security review: never on a shared client (one agent, many builders), and only for the builder's own one project.
  const named = repo && !ctx.sharedClient ? await mainProjectNameFor(ctx.installationId, repo) : null;
  const line = repo ? eligibilityLine(repo, r.eligibility, { org: typeof r.organizer === 'string' ? r.organizer : null, name: named }) : null;
  return { ...r, show_to_builder: line ? `${guide}\n\n${line}` : guide };
}

/**
 * v3.1 (spec 3.2, 3.4): a curated program's prepare with a host, deploy or build step: the step runs (the deploy first,
 * its address joining the draft's contracts), then the draft (draft-application.ts) with the build's lead lines and the
 * deployed line before it (the draft's own last line stays last) and the host block beside it. Never the confirm line: the builder sends the form. A
 * draft that fails after a deploy still returns the deploy.
 */
async function draftWithSteps(
  prep: Omit<z.infer<typeof PrepareInput>, 'deploy' | 'tips'>,
  deploy: z.infer<typeof PrepareInput>['deploy'],
  program: ProgramRow,
  ctx: ToolContext,
  join?: BuildJoin,
): Promise<Reply> {
  const step = deploy ? await deployStep(deploy, prep, ctx) : null;
  const address = (step?.deploy as { address?: string } | undefined)?.address;
  const project = address
    ? { ...prep.project, contracts: [address, ...(prep.project?.contracts ?? []).filter((c) => c.toLowerCase() !== address.toLowerCase())].slice(0, 2) }
    : prep.project;
  const host = prep.host ? await hostBlock(ctx, project?.repo_url ?? prep.answers?.repo_url, project?.name) : null;
  let r: Reply;
  try {
    r = await draftApplication({ program_id: prep.program_id, project, answers: prep.answers }, ctx, program);
  } catch (err) {
    if (!step || !address) throw err;
    const why = err instanceof Error ? err.message : 'error';
    return { program_id: prep.program_id, show_to_builder: step.line, deploy: step.deploy, agent_note: `${step.agent_note ?? ''} The draft failed: ${why} Call prepare again without deploy.`.trim() };
  }
  const shown = [join?.lead.join('\n'), step?.line, r.show_to_builder].filter((x): x is string => typeof x === 'string' && x.length > 0).join('\n\n');
  // v4.7 T3: the Stripe ask left find's reply order: it rides on the shown draft (`draft`, never the first call's
  // requirements) for a program that wants revenue (program file wants_revenue), once a person (stripe.ts
  // takeStripeDraftLink: stripe_asked); never on a shared client or the build path (a fresh build has no revenue yet).
  // v4.7 T3 fix round 1: a shown draft is a draft in the builder's hands (apply_yes), so find never offers to draft it
  // again (bench-find.ts recordApplyYes, the apply yes's own record); not on a shared client (one client, many builders).
  if (r.draft && !ctx.sharedClient) await recordApplyYes(ctx.installationId, prep.program_id, new Date());
  const stripeUrl = r.draft && !join && !ctx.sharedClient && program.wants_revenue === true ? await takeStripeDraftLink(ctx.installationId, new Date()) : null;
  const note = [r.agent_note, step?.agent_note, join?.noLive && BUILD_NO_LIVE_NOTE, stripeUrl && stripeDraftNote(stripeUrl)]
    .filter((x): x is string => typeof x === 'string' && x.length > 0).join(' ');
  return { ...r, show_to_builder: shown, ...(step && { deploy: step.deploy }), ...(host && { host }), ...(note && { agent_note: note }) };
}

/**
 * v3.1 answerable replies (spec section 1): find's and score's facts (reply-facts.ts), and the answer-first note when the
 * reply has none yet (a program guide). Pure.
 */
export function withFacts<T extends object>(reply: T, facts: ReplyFacts): T {
  const r = reply as T & { note?: unknown; agent_note?: unknown };
  // v4.8 Task 1: a path reply's mentor note asks the agent to reword it, so the "exactly as written" note never joins it.
  // v4.8 Task 2 fix round 3 (2): it gets a short answer-first sentence that fits the mentor note instead, so a question
  // asked mid-path is still answered first.
  if (typeof r.note === 'string' && r.note.endsWith(MENTOR_NOTE))
    // v4.8 Task 5 fix round 1 (8): a reply that opens with the answer (ANSWERED_FIRST) never gets a second answer-first note.
    return { ...reply, facts, ...(!r.note.startsWith(PATH_ANSWER_FIRST) && !r.note.startsWith(ANSWERED_FIRST) && { note: `${PATH_ANSWER_FIRST} ${r.note}` }) } as T;
  const noted = [r.note, r.agent_note].some((n) => typeof n === 'string' && (n.includes(ANSWER_FIRST_NOTE) || n.includes(ANSWERED_FIRST) || n.endsWith(MENTOR_NOTE)));
  return { ...reply, facts, ...(!noted && { note: typeof r.note === 'string' && r.note ? `${ANSWER_FIRST_NOTE} ${r.note}` : ANSWER_FIRST_NOTE }) } as T;
}

/**
 * v3.1 answerable replies (spec 3): on a client that can schedule, with the Monday check-in never answered, a weekly email
 * yes without an address may become the check-in instead (still one question).
 */
export const CHECKIN_INSTEAD_NOTE =
  "You can schedule tasks, so you may ask instead: \"Want me to check in here every Monday?\" (one question, not both); a yes or no to it: call tell with move_up: { kind: 'checkin', project_key: null, answer }.";
async function checkinOpen(ctx: ToolContext): Promise<boolean> {
  try {
    const own = ctx.ownInstallationId ?? ctx.installationId;
    if (!(await agentReach(own, ctx.installationId)).schedules) return false;
    const [r] = await sql()<{ c: unknown }[]>`SELECT standing_seen->'checkin' AS c FROM builder_profiles WHERE builder_id = ${ctx.installationId}`;
    return Boolean(r) && (r.c === null || r.c === undefined);
  } catch {
    return false;
  }
}

/**
 * v4.8.2 Task 3 (R4): find's `programs` as the agent gets them: each with `closes_in` (hoursLeft words under 48 hours,
 * else null) and its summary's close part in those hours ("· closes in 14 hours"), never the program-zone day an agent
 * might repeat to a builder elsewhere; `deadline` stays ISO for the agent's own math. Pure; exported for tests.
 */
export const agentPrograms = (
  programs: { id: string; title: string; summary: string; deadline: string; ends_at: Date | null; tag: string | null; verified_at: Date | null; api_content?: typeof API_CONTENT }[],
  now: Date,
) =>
  programs.map((p) => {
    const { summary, closes_in } = withClosesIn(p, now);
    return {
      id: p.id,
      title: p.title,
      summary,
      deadline: p.deadline,
      closes_in,
      tag: p.tag,
      verified_at: p.verified_at?.toISOString().slice(0, 10) ?? null,
      // v4.9 Task 2 fix round 2: an API program's card keeps its written-by envelope (api-program-text.ts).
      ...(p.api_content && { api_content: p.api_content }),
    };
  });

/** v4.9 Task 2 fix round 2: the program a prepare call is about (top level, or the build path's). Pure. */
const prepareProgramId = (input: unknown): string | null => {
  const o = (input ?? {}) as { program_id?: unknown; build?: { program_id?: unknown } };
  const id = o.program_id ?? o.build?.program_id;
  return typeof id === 'string' ? id : null;
};

/** v4.9 Task 2 fix round 2: an API program's prepare reply (the coach's questions and lines) carries its envelope. */
async function withApiContent<R extends object>(reply: R, programId: string | null): Promise<R> {
  if (!programId) return reply;
  const [row] = await sql()<{ source: string }[]>`SELECT source FROM programs WHERE id = ${programId}`.catch(() => []);
  return row?.source === 'api' ? { ...reply, api_content: API_CONTENT } : reply;
}

/** v4.8.2 Task 3 (R4): get_program's closes_in from its deadline (ISO, or "rolling"); fix 1: null unless open (upcoming, closed). Pure. */
const agentClosesIn = (p: { open: boolean; deadline: string }, now: Date) => (!p.open || p.deadline === 'rolling' ? null : hoursLeft(p.deadline, now));

/** prepare's own work (tools.prepare adds an API program's envelope). */
async function prepareTool(input: unknown, ctx: ToolContext): Promise<Reply> {
  // v2.11 T8: the build path (plan S7).
  let join: BuildJoin | undefined;
  const build = Boolean(input && typeof input === 'object' && 'build' in input);
  if (build) {
    const b = await prepareBuild(input as Record<string, unknown>, ctx);
    if ('reply' in b) return b.reply;
    input = b.rest;
    join = b.join;
  }
  const { deploy, tips, ...prep } = PrepareInput.parse(input);
  // v3.1 cold read (one name everywhere): the name the builder's project goes by here is remembered for every reply.
  if (!ctx.sharedClient) await rememberProjectName(ctx.installationId, prep.project, new Date());
  // v4.8 Task 2 fix round 3: the path's draft finished with the builder's answers (coach_asked): its blanks are answered.
  if (prep.coach_asked === true && !ctx.sharedClient) await draftAnswered(ctx.installationId, prep.program_id);
  // v3.1 (spec 3.2, 3.4), "Apply with this page": a curated program is drafted, never entered here (R15: unlisted
  // refused). A host, deploy or build step runs first and its lines join the draft; never the confirm line.
  if (!tips) {
    const program = await getProgramRow(prep.program_id);
    // v4.9 final fix (F1): an api program takes the same draft path (tools.prepare adds its envelope).
    if ((program.source === 'file' || program.source === 'api') && !program.campaign) return draftWithSteps(prep, deploy, program, ctx, join);
  }
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
}

/** The agent tools (v2.10 item 4): the MCP server forwards each call here; each dispatches to `handlers`. */
export const tools = {
  // What can I earn (list_programs), or one program and its guide (get_program).
  find: async (input: unknown, ctx0: ToolContext) => {
    // v2.14 T5 (A6): the fallback link's paste code binds this installation first, so this reply is already the
    // person's. v3 Stage 1: this holds for a hosted client too (its token is one builder's), so the code is read.
    const { sign_in_code, ...unsigned } = (input ?? {}) as Record<string, unknown>;
    input = unsigned;
    let signInNote: string | null = null;
    if (sign_in_code !== undefined) {
      const own = ctx0.ownInstallationId ?? ctx0.installationId;
      const b = await bindFromPaste(own, sign_in_code, new Date());
      if (b.ok) ctx0 = { ...ctx0, installationId: b.root, ownInstallationId: own, sharedClient: false };
      signInNote = b.ok ? SIGN_IN_NOTES.bound : SIGN_IN_NOTES.bad;
    }
    const reply = withFacts(await findReply(input, ctx0), await replyFacts(ctx0));
    return signInNote ? { ...reply, sign_in_note: signInNote } : reply;
  },

  // v2.10 item 13: with `deploy`, EarnKit deploys the builder's contract after the prepare step.
  // Task 11 fix (journey 11.0): the deploy runs first and its address joins this draft's contracts,
  // so the reply's contract check sees it (item 13: "goes straight into the A5 check") and never says
  // "No contract found" next to the deployed line. The program is read first, so an unknown one
  // spends nothing; a draft that fails after a deploy still returns the deploy.
  // Fix round 3: the program the reply is about (the build path's pick), else the one the input names.
  prepare: async (input: unknown, ctx: ToolContext) => {
    const reply = await prepareTool(input, ctx);
    const picked = (reply as { program_id?: unknown }).program_id;
    return withApiContent(reply, typeof picked === 'string' ? picked : prepareProgramId(input));
  },

  // R16: what the builder said: "I submitted", then statements; replies joined.
  tell: async (input: unknown, ctx: ToolContext) => {
    // v2.12.1 T8: x_handle is no longer taken with the flag on (the page's handle is the X claim's);
    // it is ignored.
    const { submitted, profile, x_handle, card, move_up, coin, token, update, updates, main_project, wallet, builder_code, stripe, ...rest } = TellToolInput.parse(input ?? {});
    void x_handle;
    const statements = defined(rest);
    const replies: Reply[] = [];
    // v4.8 Task 3 (fix round 1, 2): move_up answer 'sent' to the path's submit ask is the application told as applied
    // (program_status applied). A plain yes is never "sent" (benchMoveUp asks for it again); 'sent' to any other ask is "Okay.".
    const sentFor = move_up?.answer === 'sent' && !ctx.sharedClient ? await submitAsked(ctx.installationId, move_up).catch(() => null) : null;
    if (sentFor) statements.program_status = [...(Array.isArray(statements.program_status) ? statements.program_status : []), { program_id: sentFor, status: 'applied' }];
    // v4.10 Task 4 (R8): 'sent' to the ready ask: every open page of the set (or only sent_ids) told as applied.
    // Fix 1 (M2): also to Base's re-check ask (the yes's move_up while its codes wait); readySent checks the stored ask.
    const readyFor = move_up?.answer === 'sent' && !sentFor && (move_up.kind === 'ready' || move_up.kind === 'qualify') && !ctx.sharedClient ? await readySent(ctx.installationId, move_up).catch(() => null) : null;
    if (readyFor) statements.program_status = [...(Array.isArray(statements.program_status) ? statements.program_status : []), ...readyFor.map((program_id) => ({ program_id, status: 'applied' }))];
    // v2.12 spec 8: "hide" and "show". v2.12.1 T8: the card and the move-up answers.
    if (ctx.sharedClient && (profile || card || move_up || coin || token || update || updates || main_project || wallet || builder_code || stripe))
      replies.push({ show_to_builder: '', agent_note: SHARED_PROFILE_NOTE });
    else {
      // Owner ruling 2026-10-24: "delete my data" is only offered a hidden page.
      if (profile === 'delete') replies.push(await deleteAsk(ctx.installationId));
      else if (profile) replies.push({ show_to_builder: await setHidden(ctx.installationId, profile === 'hide') });
      if (card === 'yes') replies.push(await cardYes(ctx.installationId, ctx.ownInstallationId ?? ctx.installationId));
      if (card === 'skip') replies.push({ show_to_builder: SKIPPED_LINE });
      if (move_up?.answer === 'sent') {
        if (!sentFor && !readyFor) replies.push({ show_to_builder: NOTED_LINE });
      } else if (move_up) {
        const { sent_ids: _ids, ...answer } = move_up;
        replies.push(await moveUpAnswer(ctx, { ...answer, answer: move_up.answer }));
      }
      // Launch ready L2: the repo to rank instead (only one this person proved with the App).
      if (main_project) replies.push(await rankAnswer(ctx, saidKey(main_project)));
      // v3.1 wallet proof: a fresh signing link; the wallet proven with it becomes the reward recipient.
      // Any value: agents send the address the builder named as often as 'change'.
      if (wallet?.trim()) replies.push(await walletChangeReply(ctx.installationId, new Date()));
      // v4.6 Task 3: Stripe connect (a fresh link) or disconnect (the key row and the figures are deleted). No key or account id in any reply.
      if (stripe) replies.push(await stripeReply(ctx.installationId, stripe, new Date()));
      // v3.1 Used by (security review): a code they named is only a candidate; it counts once Base's registry pays a
      // wallet they proved (used-by.ts verifyCodes, daily).
      if (builder_code !== undefined)
        replies.push({ show_to_builder: (await tellBuilderCode(ctx.installationId, builder_code.trim())) ? BUILDER_CODE_SAVED : BUILDER_CODE_INVALID });
      // v4.0 Task 11 fix round 1: an older agent's token 'ask' answers the builder token's status, never launches
      // (tokenAsk); coin { answer } (the retired per-project offer) launches or declines only when the stored ask is
      // the builder token's offer (legacyCoinAnswer), else "Okay."; coin { raising } changes nothing.
      // v4.2 final review 7: beside a move_up answer, the token is answered as a statement (one question per reply).
      if (token === 'ask') replies.push(await tokenAsk(ctx, { statement: Boolean(move_up) }));
      // v4.4: the builder already has a token: recorded, and the offer ends forever.
      else if (token) replies.push(await tokenExisting(ctx, token.existing));
      if (coin) replies.push((coin.answer && (await legacyCoinAnswer(ctx, coin.answer))) || { show_to_builder: NOTED_LINE });
      // v2.13 spec 3: the ship log (ctx.installationId is already the group root).
      if (update || updates) {
        const now = new Date();
        if (update?.text !== undefined) {
          const posted = await postUpdate(ctx.installationId, update.text, now, ctx.ownInstallationId ?? ctx.installationId);
          // v3.1 one-tap posts (design 6): the builder's news, posted to the page, becomes their post for X when it can be drafted.
          const news = posted.show_to_builder && !posted.agent_note ? await newsPost(ctx.installationId, update.text, now) : null;
          replies.push(news ?? posted);
        }
        if (update?.hide !== undefined) replies.push(await hideUpdate(ctx.installationId, update.hide));
        if (updates) replies.push(await setShipTitles(ctx.installationId, updates, now));
      }
    }
    // v2.13.1 O2 (B6): "not mine" on the one project, while it isn't Bench-confirmed, clears it. Fix
    // round 1 (minor): only for input tell_earnkit's own schema (TellInput) accepts.
    const facts = !ctx.sharedClient && statements.repo_facts !== undefined ? TellInput.safeParse(defined({ ...statements })) : null;
    for (const f of facts?.success ? (facts.data.repo_facts ?? []) : [])
      if (f.not_mine === true) {
        await dropMainProject(ctx.installationId, saidKey(f.repo)).catch((err: unknown) =>
          console.error('[tell] not mine', err instanceof Error ? err.name : 'error'),
        );
      }
    if (submitted) replies.push((await markSubmitted(submitted, ctx)) as Reply);
    // v3.1 one-tap posts (owner ruling 3): an accepted, funded or won outcome is drafted as a post only with the proof
    // link the agent checked, for a program the builder had an entry or application in before this tell (read first, as
    // the tell itself stores the status); without the link, the builder is asked for it. The first such outcome only;
    // a self-report never becomes a post or a card on its own.
    const told = !ctx.sharedClient && statements.program_status !== undefined ? TellInput.safeParse(defined({ ...statements })) : null;
    const outcome = told?.success ? told.data.program_status?.find((x) => x.status === 'accepted' || x.status === 'funded' || x.status === 'won') : undefined;
    const entered = outcome ? await hasEntry(ctx.installationId, outcome.program_id) : false;
    if (Object.keys(statements).length > 0 || replies.length === 0)
      replies.push((await handlers.tell_earnkit(defined({ ...statements }), ctx)) as Reply);
    if (outcome) {
      const r = await outcomePost(ctx.installationId, { program_id: outcome.program_id, status: outcome.status as 'accepted' | 'funded' | 'won', proof_url: outcome.proof_url }, { entered, proofFetch: ctx.proofFetch }, new Date());
      if (r) {
        // The reply now shows something: the saved note's "nothing to show" no longer holds.
        for (const x of replies) if (typeof x.agent_note === 'string') x.agent_note = x.agent_note.replace(TELL_SAVED_NOTE, 'Saved.');
        replies.push(r);
      }
    }
    // v4.8 Task 3: "sent" for the path's program (told applied, or submitted): the path moves to track and the same reply
    // acknowledges it (with the program file's odds), then hooks the next program (find, run here: one reply).
    if (!ctx.sharedClient) {
      const applied = [
        ...(told?.success ? (told.data.program_status ?? []).filter((x) => x.status === 'applied').map((x) => x.program_id) : []),
        ...(submitted ? [submitted.program_id] : []),
      ];
      // v4.10 Task 4: the ready set's pages told sent leave it (readyTracked), then the same acknowledgement and find.
      if (readyFor) await readyTracked(ctx.installationId, readyFor, new Date());
      const track = readyFor ? { program_id: readyFor[0], odds: null } : applied.length > 0 ? await pathTrack(ctx.installationId, applied, new Date()) : null;
      if (track) {
        const next = withFacts(await findReply({}, ctx), await replyFacts(ctx));
        const shown = typeof next.show_to_builder === 'string' ? next.show_to_builder : '';
        const lead = readyFor ? readyTrackLead(readyFor.length) : trackLead(track.odds, shown !== '' && String(next.note ?? '').endsWith(MENTOR_NOTE));
        // Fix round 1 (3): every other reply of this tell is kept, first; the path reply goes last, so its easy reply
        // ends the message. The plain save's "nothing to show" note and the applied-outside line ("Saved: you applied
        // to ...", which the tracking line says) are dropped.
        const saved = replies.flatMap((r) => (Array.isArray(r.saved) ? r.saved : []));
        const others = replies
          .filter((r) => !(typeof r.show_to_builder === 'string' && r.show_to_builder.startsWith('Saved: you applied to ')))
          .map((r) => {
            const { saved: _s, agent_note, ...rest } = r;
            const note = typeof agent_note === 'string' ? agent_note.replace(TELL_SAVED_NOTE, '').trim() : '';
            return { ...rest, ...(note && { agent_note: note }) };
          })
          .filter((r) => Object.entries(r).some(([k, v]) => !(k === 'show_to_builder' && v === '')));
        const path: Reply = { ...next, show_to_builder: shown ? `${lead}\n\n${shown}` : lead };
        return { ...joinReplies([...others, path]), saved };
      }
    }
    // v4.8 Task 4 fix round 1 (1, 3): a reply that hands off to the path (then_find: the setup-done line before B's second
    // message, the ok to re-check the code, the help with a gap step) is followed by find's reply, run here, so the
    // builder never sees an empty reply and the message ends in find's one easy reply. The other replies come first.
    // v4.8 re-review blocker 1: then_find may carry find's input ({ ask: 'programs' }: the "more" answer).
    const handOff = ctx.sharedClient ? -1 : replies.findIndex((r) => r.then_find === true || (typeof r.then_find === 'object' && r.then_find !== null));
    if (handOff >= 0) {
      const findArgs = typeof replies[handOff].then_find === 'object' ? (replies[handOff].then_find as Record<string, unknown>) : {};
      const next = withFacts(await findReply(findArgs, ctx), await replyFacts(ctx));
      const shown = typeof next.show_to_builder === 'string' ? next.show_to_builder : '';
      const { then_find: _t, show_to_builder: lead, ...hand } = replies[handOff];
      const others = replies.filter((_, i) => i !== handOff).map(({ then_find: _x, ...r }) => r)
        .filter((r) => Object.entries(r).some(([k, v]) => !(k === 'show_to_builder' && v === '')));
      const first = typeof lead === 'string' && lead ? lead : '';
      const path: Reply = { ...hand, ...next, ...(typeof hand.agent_note === 'string' && { agent_note: hand.agent_note }), show_to_builder: [first, shown].filter(Boolean).join('\n\n') };
      return joinReplies([...others, path]);
    }
    // v4.2 Task 3 (F10): a question asked mid-setup arrives with the next ask (a move_up answer or token 'ask'); give the
    // agent the about facts to answer it (small: about only, never the builder's own data here).
    const joined = joinReplies(replies);
    return !ctx.sharedClient && (move_up || token === 'ask') ? withFacts(joined, { about: aboutFacts() }) : joined;
  },

  // v2.12 spec 7: the builder's score.
  score: async (_input: unknown, ctx: ToolContext) => withFacts(await scoreReply(ctx, new Date(), { reader: ctx.readerDeps }), await replyFacts(ctx)),

} satisfies Record<string, (input: unknown, ctx: ToolContext) => Promise<unknown>>;

export type ToolName = keyof typeof tools;
export const isToolName = (name: string): name is ToolName => Object.hasOwn(tools, name);
