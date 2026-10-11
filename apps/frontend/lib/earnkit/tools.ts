import { z } from 'zod';
import { yesNo } from './aliases';
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
import { confirmTable, enteredText, noCoinYet, todoOf, type EnteredText } from './entry-text';
import { proposeToken, repoNameOf, titleCase, tokensFunTickerCheck } from './token-proposal';
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
} from './installations';
import { recordShown, saveEntryScore } from './match-loop';
import { repoKey, repoKey as saidKeyOf } from './answer-bank';
import { outcomeQuestion, outcomeToAsk } from './outcomes';
import { wonSource } from './stats';
import { EMAIL_SHARED_NOTE, EMAIL_SIGN_IN, WHICH_EMAIL, askWeeklyEmail, cleanEmail, entryEmail, saveWeeklyEmail } from './digest';
import { TellInput, emptyMemory, hiddenIds, hiddenPrograms, memoryKey, readMemory, tell, type BuilderMemory, type MemoryKey, type SaidRepo } from './builder-memory';
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
import { SPONSOR_NOT_OPEN, escrowEnabled } from './escrow';
import { createSponsorDraft, prepareAward, sponsorStatus } from './sponsor';
import { AwardPicks, DraftInput, SponsorError } from './sponsor-rules';
import {
  ProjectInfo,
  rememberedWalletQuestion,
  prepareSubmission,
} from './submission';
import { OWNERSHIP_FILE } from './ownership';
import { DEPLOY_LINES, deployChains, deployEnabled, deployForBuilder, deployOffLine, deployOffNote, type DeployDeps, type DeployInput } from './deploy';
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
import { RAW_CAP, cleanProject, quoted } from './untrusted-text';
import { tokenLineFor } from './token-gate';
import { READY_TO_SUBMIT, confirmDecision, confirmOffer, proofLineWaiting, signInLine, walletQuestion, NO_WALLET_HINT, TOKEN_ERROR_CONFIRM } from './confirm';
import { HOST_LINES, UPLOAD_NOTE, hostSignInLine, issueUpload, refreshSiteExpiry } from './hosting';
import { r2Enabled } from './r2';
import { callerLogin, createVerifyLink, entryVerifyLink, githubVerifyEnabled, installationLogin, verifiedEntryIds } from './github-verify';
import { appTokenFor, githubAppEnabled, hasAppProof } from './github-app';
import { PROOF_LINE_PREFIX, SIGN_IN_FIRST, WALLET_CHANGED } from './token-gate';
import { kitReplyNote, submitKit, type SubmitKit } from './submit-kit';
import {
  WALLET_KEY,
  applicationOf,
  bankFill,
  coachFields,
  coachIntro,
  draftTable,
  fixesLine,
  askableKeys,
  PLAIN_NOTE,
  preSubmitCheck,
  questionsFor,
  type Fix,
} from './coach';
import { LIVE_FAILED_LINE, addressesFrom, contractMissingLine, entryVerified, liveErrorLine, rpcFor, type CheckDeps, type Verified } from './verify';
import { projectKey, readBank, saveApplication, saveBank } from './answer-bank';
import { answerPickup, offerPickup, type PickupDeps } from './identity';
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
};

/**
 * v2.11 T7: the no-repo lead's switches. Deploys on a chain need the deployer key (deployEnabled)
 * and the chain's RPC; hosting needs R2. Production has neither on 2026-10-10, so no fresh lead is
 * offered until the owner turns both on. A chat-only or shared client gets the chat-only lead (a
 * shared client never gets the build path, Ruling S6).
 */
function freshSwitches(ctx: Pick<ToolContext, 'freshDeps' | 'sharedClient'>, agentCanBuild: boolean): FreshOn {
  const d = ctx.freshDeps ?? {};
  return {
    deployOn: d.deployOn ?? ((c) => deployEnabled() && rpcFor(c) !== null),
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
    // v2.8.1 §B6: anything else than a 0x address is ignored with WALLET_IGNORED, never an error.
    wallet: z.unknown().optional(),
    // v2.9 B9 (Ruling G9): the code a shared client's builder pasted after signing in; never refused.
    signed_in: z.unknown().optional(),
    // v2.10 item 2: "show more": today's tables instead of the one lead line.
    more: z.boolean().optional(),
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
  const { wallet, agent_can_build, github_user, repos, signed_in, ...rest } = ListProgramsInput.parse(input ?? {});
  const repoList = reportedRepos(repos);
  const given = typeof wallet === 'string' && wallet.trim() !== '' ? wallet.trim() : null;
  const valid = given && /^0x[0-9a-fA-F]{40}$/.test(given) ? given : null;
  return {
    ...rest,
    agent_can_build: canBuild(agent_can_build),
    github_user: reportedGithubUser(github_user),
    repos: repoList.length ? repoList : undefined,
    wallet: valid ?? undefined, walletNote: wallet != null && wallet !== '' && !valid ? WALLET_IGNORED : null,
    signed_in: typeof signed_in === 'string' ? signed_in : undefined };
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
  'A yes to "Want me to build it?" means call prepare with build: { start: true, program_id: build_offer.program_id }. ' +
  'EarnKit then asks the builder one question before any work starts. Never start building before that.';

/** v2.11 T7: the chat-only lead's yes ("Want the plan?"): this client can't build, so the plan is how to get it built. */
export const PLAN_NOTE =
  'This client can\'t build or deploy. A yes to "Want the plan?" means tell the builder, short and in your words: ' +
  'add EarnKit to a coding agent (Claude Code, Cursor or Codex) and ask it to build for this program; ' +
  'that agent builds it, and EarnKit deploys and hosts it. Never say you built anything.';

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
 */
async function hostBlock(ctx: ToolContext, repoUrl: string | undefined, name: string | undefined): Promise<Record<string, string>> {
  if (!r2Enabled() || !githubVerifyEnabled()) return { unavailable: HOST_LINES.unavailable };
  const gh = repoUrl ? githubRepo(repoUrl) : null;
  if (!gh) return { unavailable: HOST_LINES.noRepo };
  const project = name?.trim() || titleCase(gh.repo);
  try {
    const offer = await issueUpload({ installationId: ctx.installationId, repoKey: `${gh.owner}/${gh.repo}`, project });
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

const Ref = z.string().regex(/^0x[0-9a-f]{64}$/, 'the ref from create');
export const SponsorCampaignInput = z.discriminatedUnion('action', [
  DraftInput.extend({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('status'), ref: Ref }).strict(),
  z
    .object({
      action: z.literal('award'),
      ref: Ref,
      ...AwardPicks,
    })
    .strict(),
]);

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
  const alt = enterableWithoutRepo(await listPrograms().catch(() => []), program.id);
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
    const { agent_can_build, github_user, repos, local_repos, wallet, walletNote, signed_in, more } = listProgramsInput(input);
    // v2.8.1 §E18: earlier installations of the builder this call names (its GitHub user, the owners
    // of the repos it reports, its wallet), never what this installation remembers; read before this
    // call's details are saved. Never fails the tool.
    const pickup =
      github_user || repos?.length || local_repos?.length || wallet
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
    if (wallet) await rememberWallets(ctx.installationId, [wallet]);
    // v2.9 B9, Rulings G6, G7, G9: on a shared client, the GitHub-verified login of the pasted code.
    const login = await sharedLogin(ctx, signed_in, 'list_programs');
    const [memory, programs, campaigns, told] = await Promise.all([
      checkPrograms(ctx.installationId, { github_user, repos, local_repos }),
      listPrograms(),
      earnkitCampaignRows(ctx.installationId),
      // v2.9 A3: what the builder told EarnKit, read once per call (G6: a shared client's verified login's).
      memoryOf(memoryKey({ ...ctx, verifiedLogin: login }), 'list_programs'),
    ]);
    const hidden = hiddenPrograms(told, programs);
    const hide = hiddenIds(hidden);
    const { lastCheck } = memory;
    // Ruling G7: a shared client shows nothing the installation remembers (another builder's).
    const own = remembers(ctx);
    // v2.9 B9 (G7): a verified login there sees only the entries it signed in for.
    const loginEntries = !own && login ? await verifiedEntryIds(ctx.installationId, login).catch(() => []) : null;
    const workingOn = own ? memory.working_on : [];
    // Remembered from an earlier call when not given now (G7: a verified login is its own GitHub user).
    const user =
      github_user ??
      (repos?.length ? undefined : own ? (memory.github_user ?? undefined) : (login ?? undefined));
    const repoList = repos?.length
      ? repos
      : github_user || !own
        ? undefined
        : (memory.repos ?? undefined);
    const local = local_repos?.length
      ? local_repos
      : own
        ? (memory.local_repos ?? undefined)
        : undefined;
    // Ruling 11 (plan): a GitHub user or repo list, given now or remembered, turns off "You could".
    // Local repos count too (fix round 1, Minor 5): the spec's gate is "no repos are reported or
    // found", and a repo the agent reported is a repo reported, matching error or not.
    const githubGiven = Boolean(user || repoList?.length || local?.length);
    // EarnKit campaigns are their own table (campaigns), not program cards (v2.4 §1).
    const cards = programs.filter((p) => !p.earnkit_campaign).map((p) => ({
      ...p,
      is_new: lastCheck !== null && p.opened_at !== null && p.opened_at > lastCheck,
      closes_in_days: closesInDays(p.ends_at),
    }));

    let yourRepos: YourRepos | null = null;
    if (user || repoList?.length || local?.length) {
      try {
        // Reading GitHub is limited per installation. Reported local repos alone read no GitHub, but
        // their links and contracts are still checked under LIST_BUDGET (review M3: no per-install limit yet).
        if (user || repoList?.length)
          await enforce('githubMatching', ctx.installationId, GITHUB_LIMITED);
        // v2.10 item 7b (R9): a named repo GitHub won't show is read through the read-only App when
        // this builder proved it there (G7, G10: on a shared client only the caller's own proof).
        const appOn = githubAppEnabled();
        const appLogin = ctx.sharedClient ? login : undefined;
        const matchDeps: Pick<MatchDeps, 'appToken'> = appOn
          ? { appToken: (n) => appTokenFor({ installationId: ctx.installationId, login: appLogin, repoKey: n.toLowerCase() }) }
          : {};
        const matched = await (ctx.matchProjects ?? matchProjects)(
          MatchProjectsInput.parse({
            github_user: user,
            repos: repoList,
            local_repos: local,
            // v2.9 A3: applied before the checks, so a claimed live link is checked (Pre-flight P15).
            ...(told.repos.size > 0 && { said: Object.fromEntries(told.repos) }),
          }),
          matchDeps,
        );
        // v2.10 item 7b: with the App on, the first repo EarnKit can't see gets its "allow read
        // access" link (an `app` nonce, R8); the reply shows only that one.
        const [first, ...restUnseen] = matched.unseen ?? [];
        const link =
          appOn && first
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
        if (appOn && !first && matched.fromLocal?.length) {
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
        if (err instanceof GitHubError || err instanceof RateLimitError)
          yourRepos = { error: err.message };
        else console.error('[list_programs] matching failed:', err);
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
    const alerts = own
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
      deadline: await takeDeadlineLine(ctx.installationId, myEntries),
      more: more === true,
      // v2.11 T7: the no-repo lead's switches; off (no pick) unless deploys and hosting are on.
      fresh: freshSwitches(ctx, agent_can_build),
    };
    // v2.8 Ruling 30 (plan): at most one entry per call whose results were due; asked once. Read
    // after every other read (review minor 11), so nothing after marking it asked can lose the
    // question. Never fails the tool (the entry is then asked on a later call). v2.10 Ruling H10
    // (I3): one question per reply, pickup first, then this one, then the lead's: with a pickup it
    // waits (not read, so not marked asked).
    const ask = pickup || (!own && !loginEntries?.length) ? null : await outcomeToAsk(ctx.installationId, undefined, loginEntries ?? undefined).catch((err: unknown) => {
      console.error('[list_programs] outcome ask', err instanceof Error ? err.name : 'error');
      return null;
    });
    first.holdQuestion = Boolean(pickup || ask);
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

    return {
      show_to_builder: pickup ? [pickup.question, show_to_builder].filter(Boolean).join('\n\n') : show_to_builder,
      ...(pickup && { pick_up: { question: pickup.question, agent_note: PICKUP_NOTE } }),
      note:
        'Show show_to_builder to the builder exactly as written. ' +
        (!own && (user || repoList?.length || local?.length)
          ? 'This agent serves many builders, so pass their repos again on each call. '
          : user || repoList?.length
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

  prepare_submission: async (input: unknown, ctx: ToolContext) => {
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
    const guide = firstPrepare ? guideText(programGuide(program, null)) : null;
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
    const token = open && prep.ready
      ? await tokenProposalBlock({
          program,
          projectName: known.project?.name,
          // Campaigns: only a payout wallet given in this call (never the remembered one, which
          // is asked about, not assumed); without one the block asks the builder for the fee
          // wallet. Other programs (v2.6 §3): the wallet given now, else the remembered one.
          creatorWallet: program.campaign ? given : (given ?? remembered),
          // The earnkit.txt token line is bound to this agent and the repo; shown only in this reply.
          installationId: ctx.installationId,
          repoUrl,
          liveUrl: known.project?.live_url ?? known.answers?.live_url,
        },
        // T7 (journey test): the same ticker check and availability as the rest of the flow
        // (injected in tests; the defaults otherwise, as before).
        { check: ctx.tokenDeps?.check, available: ctx.tokenDeps?.available })
      : null;
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
        show_to_builder: repoFirst ? `${repoFirst}\n\n${intro}` : intro,
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
    const stored = given || !facts
      ? null
      : await entryWallet(ctx, {
          programId: program.id,
          installationId: ctx.installationId,
          repoUrl: repoUrl ?? null,
          name: known.project?.name?.trim() || titleCase(repoNameOf(repoUrl) ?? ''),
        });
    const offerWallet = given ?? stored ?? remembered;
    // Fix round 1 (§A2): the pair the Yes line shows is stored; the one shown before wins (stable).
    const shownKey = offerKey(repoUrl ?? null, known.project?.name?.trim() || titleCase(repoNameOf(repoUrl) ?? ''));
    // v2.10 fix round 1 (I2): a stored pair means the confirm line was shown already in this flow,
    // so it is said again without the earnings part ("40%" once).
    const shownBefore = facts && token ? await readOffer(ctx.installationId, program.id, shownKey).catch(() => null) : null;
    const shownPair: Offered | null = facts && token ? (shownBefore ?? { name: token.proposed.name, symbol: token.proposed.symbol }) : null;
    // v2.9 B9: with GitHub sign-in on, an agent that can't push still offers the token.
    const signIn = githubVerifyEnabled();
    // v2.9 B10: no token offer once the repo's token is this program's, or after two skips (P23).
    const prepTokensOff = facts !== null && (facts.policyOff || !facts.available || facts.declinedOut || facts.tokenHere);
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
          proposal: shownPair,
          // v2.9 B10 (P21): the first reply's offer was skipped: no "40%" a second time.
          again: shownBefore !== null || facts.declinedOnce || facts.firstShown,
        })
      : null;
    const offersToken = facts !== null && !facts.coinIn && (canPush || signIn) && !prepTokensOff;
    // Ruling 25 (plan) / Part C: the token line, once the repo is known, for the agent to push with
    // its work before the builder confirms (an agent that can't push gets none).
    const line = repoUrl && canPush && program.token_policy !== 'off' && !prepTokensOff ? tokenLineFor(ctx.installationId, repoUrl) : null;
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
    const show_to_builder = prep.ready
      ? [
          draftTable(program.submission_requirements, values),
          fixesLine(fixes),
          offer ? (offer.endsWith(READY_TO_SUBMIT) ? offer : `Ready. ${offer}`) : null,
        ]
          .filter((x): x is string => Boolean(x))
          .join('\n\n')
      : table;
    const notes = [
      line && TOKEN_LINE_NOTE,
      ...(prep.ready ? [agent_fixes.length > 0 && AGENT_FIXES_NOTE, DRAFT_NOTE, fixes.length > 0 && FIXES_NOTE] : [COACH_NOTE]),
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
    });
    // v2.9 B10: the offer is "Ready to submit?" alone once the repo's token is this program's.
    const tokensOff = facts.policyOff || !facts.available || facts.declinedOut || facts.tokenHere;
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
          confirmOffer({ hasBonus: facts.hasBonus, coinIn: facts.coinIn, canPush, signIn, wallet, tokensOff, proposal: pair, again: Boolean(proposal?.taken) || shown !== null || facts.declinedOnce || facts.firstShown }),
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
      const offer = confirmOffer({ hasBonus: facts.hasBonus, coinIn: null, canPush, signIn, wallet, proposal, again: again || facts.declinedOnce || facts.firstShown });
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

    const skipLine = facts.hasBonus ? 'No token, no builder bonus.' : 'No token.';
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
    if (result.bonus_round && coin.status !== 'skipped') {
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

// Sponsors: create a campaign (returns a funding link and raw txs), check it (status reads the
// chain for the bound wallet's deposit or award), award it.
async function sponsorCampaign(input: unknown, ctx: ToolContext) {
  // Normally unreachable (the tool isn't registered until the escrow is configured).
  if (!escrowEnabled()) throw new SponsorError(SPONSOR_NOT_OPEN);
  const i = SponsorCampaignInput.parse(
    Object.fromEntries(
      Object.entries(input as object).filter(([, v]) => v !== undefined),
    ),
  );
  if (i.action === 'create') {
    const { action: _a, ...draft } = i;
    // Charged only once the draft (and any replaces) is valid; a replacement has its own cap.
    return createSponsorDraft(draft, ctx.installationId, (replacing) =>
      replacing
        ? enforce(
            'sponsorReplace',
            ctx.installationId,
            'This agent has replaced 10 sponsor drafts today, the daily limit.',
          )
        : enforce(
            'sponsorCreate',
            ctx.installationId,
            'This agent has created 5 sponsor campaigns today, the daily limit.',
          ),
    );
  }
  if (i.action === 'award')
    return prepareAward(i.ref, ctx.installationId, {
      winners: i.winners,
      split: i.split,
    });
  // status reads the chain (and may rescore entries).
  await enforce(
    'chainChecks',
    ctx.installationId,
    'Too many status checks from this agent.',
  );
  return sponsorStatus(i.ref, ctx.installationId);
}

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
export const PrepareInput = PrepareSubmissionInput.extend({ deploy: DeployField.optional() }).strict();

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
    { installationId: ctx.installationId, login, shared, repoKey: `${gh.owner}/${gh.repo}`, projectName: name, builderWallet: wallet as `0x${string}`, input },
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
    // Read by tell_earnkit (builder-memory.ts TellInput).
    program_status: z.unknown().optional(),
    repo_facts: z.unknown().optional(),
    weekly_email: z.unknown().optional(),
    signed_in: z.string().max(40).optional(),
  })
  .strict();

type Reply = Record<string, unknown>;
const defined = (o: Reply): Reply => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

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
  return {
    ...Object.assign({}, ...replies),
    ...(shown.length > 0 && { show_to_builder: shown.join('\n') }),
    ...(notes.length > 0 && { agent_note: notes.join(' ') }),
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

/** The agent tools (v2.10 item 4): the MCP server forwards each call here; each dispatches to `handlers`. */
export const tools = {
  // What can I earn (list_programs), or one program and its guide (get_program).
  find: async (input: unknown, ctx: ToolContext) => {
    const { program_id, repo, ...rest } = FindInput.parse(input ?? {});
    if (program_id === undefined)
      return handlers.list_programs(repo !== undefined && rest.repos === undefined ? { ...rest, repos: [repo] } : rest, ctx);
    const r = (await handlers.get_program(defined({ program_id, repo }), ctx)) as Reply & { guide?: { text?: string }; eligibility?: unknown };
    const guide = r.guide?.text;
    if (!guide) return r;
    const line = repo ? eligibilityLine(repo, r.eligibility) : null;
    return { ...r, show_to_builder: line ? `${guide}\n\n${line}` : guide };
  },

  // v2.10 item 13: with `deploy`, EarnKit deploys the builder's contract after the prepare step.
  // Task 11 fix (journey 11.0): the deploy runs first and its address joins this draft's contracts,
  // so the reply's contract check sees it (item 13: "goes straight into the A5 check") and never says
  // "No contract found" next to the deployed line. The program is read first, so an unknown one
  // spends nothing; a draft that fails after a deploy still returns the deploy.
  prepare: async (input: unknown, ctx: ToolContext) => {
    const { deploy, ...prep } = PrepareInput.parse(input);
    if (!deploy) return handlers.prepare_submission(prep, ctx);
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
  confirm: async (input: unknown, ctx: ToolContext) => {
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
  tell: async (input: unknown, ctx: ToolContext) => {
    const { pickup, submitted, signed_in, ...rest } = TellToolInput.parse(input ?? {});
    const statements = defined(rest);
    const replies: Reply[] = [];
    if (pickup !== undefined) replies.push((await handlers.pick_up_entries({ answer: pickup }, ctx)) as Reply);
    if (submitted) replies.push((await markSubmitted(submitted, signed_in, ctx)) as Reply);
    if (Object.keys(statements).length > 0 || replies.length === 0)
      replies.push((await handlers.tell_earnkit(defined({ ...statements, signed_in }), ctx)) as Reply);
    return joinReplies(replies);
  },

  sponsor_campaign: sponsorCampaign,
} satisfies Record<string, (input: unknown, ctx: ToolContext) => Promise<unknown>>;

export type ToolName = keyof typeof tools;
export const isToolName = (name: string): name is ToolName => Object.hasOwn(tools, name);
