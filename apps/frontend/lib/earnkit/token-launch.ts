import { z } from 'zod';
import { isWalletAddress, normalizeLiveUrl, normalizeRepoUrl } from './campaigns';
import { sql } from './db';
import { rememberWallet, sharedGroup } from './installations';
import { OWNERSHIP_FILE } from './ownership';
import { bonusOn } from './bonus-rounds';
import type { Chain } from './chains';
import type { SubmissionRequirement, TokenPolicy } from './program-file';
import { answersOf } from './projects';
import { prepareSubmission, type KnownInfo } from './submission';
import type { ProgramRow } from './programs';
import { canonicalBuilderUrl } from './untrusted-text';
import { LIMITS, RateLimitError, enforce, windowStart } from './rate-limit';
import { PROOF_LINE_PREFIX, tokenGate, tokenLineFor, type GateDeps } from './token-gate';
import { logoDefaults, type Logo } from './token-logo';

/**
 * Ruling C24: the agent's way out of the proof-line loop (confirm mode). Agent text, so it names
 * the tool and the field.
 */
export const CANT_PUSH_RETRY_NOTE =
  "If you can't push to this repo, call confirm_entry again with agent: { can_push: false }: the entry records without a token and the kit comes back.";
import { TOKEN_ERROR_CONFIRM } from './confirm';
import { todoOf } from './entry-text';
import {
  cleanTokenName,
  proposeToken,
  repoNameOf,
  tickerProblem,
  titleCase,
  tokensFunTickerCheck,
  type TickerCheck,
} from './token-proposal';
import {
  LaunchError,
  REPO_HAS_TOKEN,
  TOKENS_UNAVAILABLE,
  decodeImage,
  deployToken,
  repoCoinPrograms,
  repoHasTokenNote,
  repoTokenUrl,
  setTokenStatus,
  LAUNCHING,
  LAUNCHING_AGENT,
  LAUNCH_STUCK,
  NOT_LAUNCHED_YET,
  launchStuck,
  launchStuckAgent,
  tokenLaunchesAvailable,
  tryAgainAfter,
  xProfileUrl,
  type TokenOutcome,
  type TokenStatus,
} from './tokens';

/**
 * The token at submission (v2.3): EarnKit proposes a token in prepare_submission, launches it
 * with record_submission once the builder confirmed the summary, and launch_token retries it.
 * Every launch goes through the same rules (decideToken), the gate (tokenGate), then deployToken.
 */

/** The builder's changes to the proposed token, all optional. */
export const TokenChoice = z
  .object({
    name: z.string().max(200).optional(),
    symbol: z.string().max(20).optional(),
    image_url: z
      .string()
      .url()
      .startsWith('https://', 'must start with https://')
      .optional(),
    /** Or the image itself as a data URL (PNG/JPEG/WebP/GIF, up to 1 MB); EarnKit hosts it. */
    image_data: z.string().optional(),
    // Ruling 22: the one wallet rule (isWalletAddress: EIP-55 when it mixes cases), as everywhere.
    creator_wallet: z
      .string()
      .refine(isWalletAddress, 'a 0x wallet address (check it for typos)')
      .optional(),
    builder_x: z.string().trim().min(1).optional(),
  })
  .strict();
type Choice = z.infer<typeof TokenChoice>;

export type TokenBlock = {
  /** v2.7 Ruling 16 (plan): always proposed when a block is returned. */
  /** v2.10 item 12: 'site' (the live site's or repo's logo is tried first), else the generated 'mark'. */
  proposed: { name: string; symbol: string; image: 'agent' | 'site' | 'mark' };
  chain: 'base';
  creator_wallet: string | null;
  policy: 'encouraged' | 'allowed';
  note: string;
  /** v2.6 Ruling 7: bonusOn, active, not opted out, not a campaign (hasBuilderBonus). */
  has_bonus: boolean;
  /**
   * Ruling 25: the program this repo's coin is already entered in (one coin per repo), on a
   * program with a builder bonus: no new coin and no builder bonus here. Null otherwise.
   */
  repo_coin_program: string | null;
};

/**
 * Whether a program's entries can earn the builder bonus (v2.6 §4, Ruling 7 (plan)): `bonusOn`,
 * same name kept for callers. `submission_proof` now only decides how a submission is checked,
 * never whether the program has a bonus.
 */
export const hasBuilderBonus = (program: Pick<ProgramRow, 'status' | 'builder_bonus' | 'campaign'>) =>
  bonusOn(program);

/**
 * Ruling 31: `note` is plain builder text (never a tool, field or file name); `agent_note`, when
 * set, carries the technical instruction for the agent.
 */
export type Decision =
  | { action: 'skip'; note: string; agent_note?: string }
  | { action: 'launch'; name: string; symbol: string }
  | { action: 'refuse'; note: string; agent_note?: string; code?: 'no_wallet' };

export const NO_WALLET = "Not launched: no wallet for the token's fees yet.";
/** v2.7 §4 fix round 1: exported so copy-review.test.ts can scan it. */
export const NO_WALLET_AGENT =
  'Ask the builder for the wallet that receives creator fees and call launch_token with creator_wallet.';
const NEEDS_SYMBOL = "Not launched: the token's name and ticker weren't confirmed yet.";
/** v2.7 §4 fix round 1: exported so copy-review.test.ts can scan it. */
export const NEEDS_SYMBOL_AGENT =
  "Pass token: { name, symbol } exactly as shown to the builder (from prepare_submission's token.proposed), or call launch_token.";

/** C6: the builder's note when the final ticker is already used on tokens.fun. Pure. */
export const tickerTakenNote = (next: string) => `That ticker is taken. Pick another, or say go for $${next}.`;

/**
 * Ruling 31: a name or ticker problem in builder words ("Token name: …", "Ticker: …"), with the
 * field-named original for the agent. Pure; exported for tests.
 */
export function plainProblem(problem: string): { note: string; agent_note: string } {
  const note = problem.replace(/^name:\s*/, 'Token name: ').replace(/^symbol:\s*/, 'Ticker: ');
  return { note, agent_note: problem };
}

/**
 * The builder's name and ticker edits that pass the rules (cleaned name, uppercased ticker), and
 * the first problem, if any. Pure; exported for tests.
 */
export function editsOf(choice: Choice): { name?: string; symbol?: string; problem?: string } {
  const out: { name?: string; symbol?: string; problem?: string } = {};
  if (choice.name !== undefined) {
    const n = cleanTokenName(choice.name);
    if ('problem' in n) out.problem = n.problem;
    else out.name = n.name;
  }
  if (choice.symbol !== undefined) {
    const symbol = choice.symbol.trim().toUpperCase();
    const issue = tickerProblem(symbol);
    if (issue) out.problem ??= issue;
    else out.symbol = symbol;
  }
  return out;
}

/**
 * Whether to launch, and with which name and ticker. Checks, in order: the program's policy, the
 * builder's "no token", an existing token, the builder's confirmation, (with `needsSymbol`) an
 * explicit ticker, the builder's edits, a name and ticker to use (edits over the proposal; the
 * ticker must pass tickerProblem whatever its source), then the creator wallet. Pure; exported
 * for tests.
 */
export function decideToken(a: {
  policy: TokenPolicy;
  choice: 'skip' | Choice | undefined;
  confirmed: boolean;
  existingTokenUrl: string | null;
  proposal: { name?: string | null; symbol?: string | null } | null;
  wallet: string | null;
  /** record_submission: launch only with the ticker the builder confirmed, passed explicitly. */
  needsSymbol?: boolean;
}): Decision {
  if (a.policy === 'off')
    return { action: 'skip', note: "Not launched: this program doesn't allow tokens for entries." };
  if (a.choice === 'skip')
    return { action: 'skip', note: 'Not launched: the builder said no token.', agent_note: 'Call launch_token later if they change their mind.' };
  // A pending claim never gets here (runTokenFlow answers it first, pendingOutcome).
  if (a.existingTokenUrl) return { action: 'refuse', note: `This project already has a token: ${a.existingTokenUrl}` };
  if (!a.confirmed)
    return {
      action: 'skip',
      note: "Not launched: the token wasn't confirmed yet.",
      agent_note: 'Pass builder_confirmed: true once the builder has seen the token row, or call launch_token later.',
    };
  const choice = a.choice ?? {};
  if (a.needsSymbol && !choice.symbol?.trim()) return { action: 'skip', note: NEEDS_SYMBOL, agent_note: NEEDS_SYMBOL_AGENT };
  const edits = editsOf(choice);
  if (edits.problem) return { action: 'refuse', ...plainProblem(edits.problem) };
  const rawName = edits.name ?? a.proposal?.name;
  const symbol = edits.symbol ?? a.proposal?.symbol?.trim().toUpperCase();
  if (!rawName || !symbol)
    return {
      action: 'refuse',
      note: 'Not launched: EarnKit has no proposed token for this project. Pick a name and a ticker (3–6 letters or digits) with the builder.',
      agent_note: 'Pass them as name and symbol.',
    };
  const name = cleanTokenName(rawName);
  if ('problem' in name) return { action: 'refuse', ...plainProblem(name.problem) };
  const tickerIssue = tickerProblem(symbol);
  if (tickerIssue) return { action: 'refuse', ...plainProblem(tickerIssue) };
  if (!a.wallet) return { action: 'refuse', note: NO_WALLET, agent_note: NO_WALLET_AGENT, code: 'no_wallet' };
  return { action: 'launch', name: name.name, symbol };
}

/** What the agent must push before a launch (v2.6 §3: one ticker-free line; the builder edits nothing). */
const ownershipLine = (tokenLine: string | null) =>
  tokenLine
    ? `Write the line "${tokenLine}" to ${OWNERSHIP_FILE} at the repo root (default branch) and push it yourself ` +
      'before record_submission; never ask the builder to edit files. It is for this agent and this repo only; ' +
      'a new ticker needs no new line.'
    : "Pass the project's repo_url to get its earnkit.txt token line.";

/**
 * The `token` block of prepare_submission, or null when the program has no tokens, launches aren't
 * configured, or no name is known yet. v2.10 item 5: no builder text here (no earnings, terms or
 * WETH line): the token is pitched once, in the confirm line (confirm.ts confirmLine), or in an
 * EarnKit campaign's Token row (entry-text.ts tokenRow); the terms are on the entry page and
 * tokens.fun. What the repo needs is in `note`, for the agent.
 */
export async function tokenProposalBlock(
  a: {
    program: ProgramRow;
    projectName?: string;
    creatorWallet: string | null;
    /** The asking agent and the project's repo: the earnkit.txt token line is bound to both. */
    installationId: number;
    repoUrl?: string;
    /** v2.10 item 12: the entry's live link (its logo is tried first at launch). */
    liveUrl?: string | null;
  },
  deps: {
    check?: TickerCheck;
    available?: () => boolean;
    /** The program a normalized repo's coin is entered in (default tokens.ts repoCoinPrograms). */
    repoCoin?: (repoKey: string) => Promise<{ program_id: string; title: string } | null>;
  } = {},
): Promise<TokenBlock | null> {
  const { program } = a;
  if (program.token_policy === 'off') return null;
  if (!(deps.available ?? tokenLaunchesAvailable)()) return null;
  // Ruling 16 (plan): without a project name, the repo name is the name; with neither, nothing to name.
  const projectName = a.projectName?.trim() || titleCase(repoNameOf(a.repoUrl) ?? '');
  if (!projectName) return null;
  const proposal = await proposeToken(projectName, deps.check, a.repoUrl);
  const notes: string[] = [];
  if (proposal.note) notes.push(proposal.note);
  if (!a.creatorWallet) notes.push('Ask the builder for the wallet that receives creator fees.');
  // Ruling 22: outside campaigns the wallet goes to record_submission explicitly.
  if (!program.campaign)
    notes.push("Pass the wallet the builder confirmed (the wallet line) as record_submission's payout_wallet");
  // Shown only to this agent (prepare_submission's reply): its code is useless to anyone else.
  const tokenLine = a.repoUrl ? tokenLineFor(a.installationId, a.repoUrl) : null;
  const hasBonus = hasBuilderBonus(program);
  // Ruling 25: on a program with a builder bonus, a repo whose coin is entered elsewhere gets no
  // new coin (one per repo) and so no bonus here; the row says so. A failed read never fails this.
  const coin =
    hasBonus && a.repoUrl
      ? await (deps.repoCoin ?? defaultRepoCoin)(normalizeRepoUrl(a.repoUrl)).catch((err: unknown) => {
          console.error('[token] repo coin lookup', err);
          return null;
        })
      : null;
  // A coin entered in this same program is this repo's own (Ruling 13b covers a second entry).
  const coinIn = coin && coin.program_id !== program.id ? coin.title : null;
  if (coinIn)
    notes.push(`This repo already has its token, entered in ${coinIn}: don't pass token; this entry gets no new token and no builder bonus`);
  else notes.push(ownershipLine(tokenLine));
  return {
    proposed: { name: proposal.name, symbol: proposal.symbol, image: a.liveUrl ? 'site' : 'mark' },
    chain: 'base',
    creator_wallet: a.creatorWallet,
    policy: program.token_policy,
    has_bonus: hasBonus,
    repo_coin_program: coinIn,
    note: notes.map((n) => (/[.!?]$/.test(n.trim()) ? n.trim() : `${n.trim()}.`)).join(' '),
  };
}

/** The program a normalized repo's coin is entered in, from the database. */
const defaultRepoCoin = async (repoKey: string) => (await repoCoinPrograms([repoKey])).get(repoKey) ?? null;

/** What the flow reads about a project and its program. */
export type FlowProject = {
  id: number;
  name: string;
  repo_url: string | null;
  live_url: string | null;
  /** v2.10 R10: the repo is private (its social preview is never read for the logo). */
  repo_private?: boolean;
  /** Set for campaign entries only: proven by the repo's earnkit.txt at entry. */
  payout_wallet: string | null;
  /** The creator wallet given before (record_submission or a launch); launch_token reuses it. */
  creator_wallet: string | null;
  token_url: string | null;
  token_name: string | null;
  token_symbol: string | null;
  /** v2.8.1 §A1: when the launch claim was taken (token_url 'pending'); null before v2.8.1. */
  token_claimed_at?: Date | null;
  /** The stored token note: on a pending claim, set once the deploy answered without a clear result. */
  token_note?: string | null;
  /** The stored token status (a check-back reads it). */
  token_status?: TokenStatus | null;
  /** v2.8.1 fix round 1: a release the builder hasn't seen yet (after a "launching" reply). */
  token_released_at?: Date | null;
  installation_id: number | null;
  token_policy: TokenPolicy;
  /** The program has a builder bonus (hasBuilderBonus), for launch_token's non-Base note. */
  has_bonus?: boolean;
  /** v2.8 Ruling 3 (plan): the builder's answer at the confirmation step; 'skip' launches nothing. */
  confirm_choice?: 'go' | 'skip' | null;
  /**
   * What entryMissing reads (the v2.7 C7 gate, on bonus eligibility since v2.8 Ruling 2 (plan)).
   * The program's submission requirements (absent: none), whether it is an EarnKit campaign (its
   * entries were checked complete at entry), the stored project fields a requirement can be filled
   * from, and the latest recorded answers.
   */
  requirements?: SubmissionRequirement[];
  campaign?: boolean;
  description?: string | null;
  demo_url?: string | null;
  submission_data?: Record<string, unknown> | null;
  /**
   * v2.9 A5 (Pre-flight P5): the stored link and contract checks (live_verified_at,
   * contract_verified_at; null reads false) for a program whose requirements use live_url; absent
   * otherwise. entryMissing reads it when `known` carries none.
   */
  verified?: KnownInfo['verified'];
};

/**
 * C7: the required items this entry still misses, by key and as a short to-do (todoOf), or [] when
 * it is ready or not gated (an EarnKit campaign, or no requirements read). `known`: what
 * record_submission was just given (what prepare_submission saw); else the stored project and its
 * latest answers (launch_token). Pure; exported for tests.
 */
export function entryMissing(project: FlowProject, known?: KnownInfo): { key: string; todo: string }[] {
  if (project.campaign || !project.requirements?.length) return [];
  const opt = (v: string | null | undefined) => v ?? undefined;
  const info: KnownInfo = known ? { ...known, verified: known.verified ?? project.verified } : {
    verified: project.verified,
    project: {
      name: project.name,
      description: opt(project.description),
      repo_url: opt(project.repo_url),
      live_url: opt(project.live_url),
      demo_url: opt(project.demo_url),
    },
    answers: answersOf(project.submission_data ?? {}),
  };
  const prep = prepareSubmission(project.requirements, info);
  if (prep.ready) return [];
  const reqs = new Map(project.requirements.map((r) => [r.key, r]));
  return prep.missing
    .filter((m) => m.required)
    .map((m) => ({ key: m.key, todo: todoOf(reqs.get(m.key) ?? { label: m.label }, Boolean(m.problem)) }));
}

/** C7: the agent's side of a not-ready skip: which keys, and how the token launches afterwards. Exported for the copy review. */
export const notReadyAgentNote = (keys: string[]) =>
  `Required items are missing (${keys.join(', ')}), so no token was launched. Once the builder has them, ` +
  'call record_submission again with every answer (it updates this entry and launches the token), or ' +
  'launch_token with live_url or repo_url when only a link was missing.';

/** v2.9 A5: an entry's stored checks and its program's contract chain. */
type StoredChecks = { live_verified_at: Date | null; contract_verified_at: Date | null; needs_contract: Chain | null };

/**
 * v2.9 A5 (Pre-flight P5): `verified` from the stored checks, for a program whose requirements
 * fill an item from live_url (null columns read false); others are left as they are. Pure.
 */
export function withStoredChecks(project: FlowProject, c: StoredChecks): FlowProject {
  if (!project.requirements?.some((r) => r.project_field === 'live_url')) return project;
  return {
    ...project,
    verified: { live: c.live_verified_at !== null, contract: c.contract_verified_at !== null, needsContract: c.needs_contract },
  };
}

/** The flow's reads and writes, injectable so tests need no database. */
type FlowStore = {
  load: (projectId: number) => Promise<FlowProject | null>;
  setStatus: typeof setTokenStatus;
  /** Another project's token link (or 'pending') on the same normalized repo, or null. */
  repoToken: (projectId: number, repoKey: string) => Promise<string | null>;
  /** launch_token's link overrides, on a project of this installation with no token yet. */
  updateLinks: (
    projectId: number,
    installationId: number,
    links: { repo_url?: string; live_url?: string },
  ) => Promise<void>;
  /** Keeps the creator wallet on a project with no token yet, and remembers it for the installation. */
  saveCreatorWallet: (projectId: number, installationId: number, wallet: string) => Promise<void>;
  /** v2.8 Ruling 2 (plan), Ruling C8: sets complete_at once (never moved). */
  markComplete: (projectId: number) => Promise<void>;
  /** v2.8.1 fix round 1: the builder has now been told about a background release. */
  markReleaseSeen?: (projectId: number) => Promise<void>;
};

export type TokenFlowDeps = {
  gate?: GateDeps;
  check?: TickerCheck;
  deploy?: typeof deployToken;
  store?: FlowStore;
  /** Counts one launch for the wallet and the installation; throws over LIMITS.tokenLaunchWallet / tokenLaunch. */
  limit?: (installationId: number, wallet: string) => Promise<unknown>;
  /** Whether launches are configured (default: the tokens.fun deploy key is set). */
  available?: () => boolean;
  /** v2.10 item 12: the logo when the agent sent no image (default token-logo.ts launchLogo); null sends the mark. */
  logo?: (a: { liveUrl: string | null; repoUrl: string | null; repoPrivate: boolean }) => Promise<Logo | null>;
};

const dbStore: FlowStore = {
  load: async (projectId) => {
    const [row] = await sql()<(FlowProject & StoredChecks)[]>`
      SELECT p.id, p.name, p.repo_url, p.live_url, p.repo_private, p.payout_wallet, p.creator_wallet, p.token_url, p.token_name,
        p.token_symbol, p.token_claimed_at, p.token_note, p.token_status, p.token_released_at, p.installation_id, pr.token_policy, p.confirm_choice,
        (pr.status = 'active' AND pr.builder_bonus AND pr.campaign IS NULL) AS has_bonus,
        pr.submission_requirements AS requirements, (pr.campaign IS NOT NULL) AS campaign,
        p.description, p.demo_url,
        (SELECT s.submission_data FROM submissions s WHERE s.project_id = p.id ORDER BY s.id DESC LIMIT 1) AS submission_data,
        p.live_verified_at, p.contract_verified_at, pr.needs_contract
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE p.id = ${projectId}`;
    if (!row) return null;
    const { live_verified_at, contract_verified_at, needs_contract, ...project } = row;
    return withStoredChecks(project, { live_verified_at, contract_verified_at, needs_contract });
  },
  setStatus: setTokenStatus,
  repoToken: repoTokenUrl,
  updateLinks: async (projectId, installationId, links) => {
    const live = links.live_url ?? null;
    const repo = links.repo_url ?? null;
    // Campaign entries (payout_wallet set) keep live_key, the normalized live link, in step.
    // A recorded repo never changes (v2.5 Ruling 16): only a missing one is filled in, and an
    // external entry's bonus_repo_key with it.
    // N1 (Ruling 22): a proof that passed without a repo (on the live site) is re-checked once a
    // repo is filled in, so it must then link the repo: cleared here, the daily re-check reads it.
    // v2.6 Ruling 4 (plan): only an entry with a page to re-check (submission_proof_url); one
    // counted on the builder's confirmation alone (basis 'confirmed') has no page and keeps counting.
    await sql()`
      UPDATE projects SET repo_url = COALESCE(repo_url, ${repo}),
        bonus_repo_key = CASE WHEN repo_url IS NULL AND payout_wallet IS NULL AND ${repo}::text IS NOT NULL
          THEN ${repo && normalizeRepoUrl(repo)} ELSE bonus_repo_key END,
        submission_proof_ok_at = CASE WHEN repo_url IS NULL AND ${repo}::text IS NOT NULL AND submission_proof_url IS NOT NULL
          THEN NULL ELSE submission_proof_ok_at END,
        submission_basis = CASE WHEN repo_url IS NULL AND ${repo}::text IS NOT NULL AND submission_proof_url IS NOT NULL
          THEN NULL ELSE submission_basis END,
        submission_proof_checked_at = CASE WHEN repo_url IS NULL AND ${repo}::text IS NOT NULL AND submission_proof_url IS NOT NULL
          THEN NULL ELSE submission_proof_checked_at END,
        -- v2.9 A5: a new live link is unverified until an entry step checks it.
        live_verified_at = CASE WHEN ${live}::text IS NOT NULL AND ${live} IS DISTINCT FROM live_url THEN NULL ELSE live_verified_at END,
        live_url = COALESCE(${live}, live_url),
        live_key = CASE WHEN payout_wallet IS NOT NULL AND ${live}::text IS NOT NULL
          THEN ${live && normalizeLiveUrl(live)} ELSE live_key END
      WHERE id = ${projectId} AND installation_id = ${installationId} AND token_url IS NULL`;
  },
  saveCreatorWallet: async (projectId, installationId, wallet) => {
    const w = wallet.toLowerCase();
    await sql()`
      UPDATE projects SET creator_wallet = ${w}
      WHERE id = ${projectId} AND installation_id = ${installationId} AND token_url IS NULL`;
    // Ruling 10 (plan): also this installation's last wallet, prefilled next time.
    await rememberWallet(installationId, w);
  },
  markComplete: async (projectId) => {
    await sql()`UPDATE projects SET complete_at = COALESCE(complete_at, now()) WHERE id = ${projectId}`;
  },
  markReleaseSeen: async (projectId) => {
    await sql()`UPDATE projects SET token_released_at = NULL WHERE id = ${projectId}`;
  },
};

/**
 * v2.8.1 §A4: 10 launches per creator wallet per UTC day (and, as an abuse floor, per agent). Over
 * either, a LaunchError whose words say when the builder can retry ("Try again after 00:00 UTC.").
 */
export const WALLET_LIMITED = "Your token didn't launch: this wallet reached today's launch limit of 10.";
export const AGENT_LIMITED = "Your token didn't launch: this agent reached today's launch limit of 10.";
/** v2.8.1 §E17: the same refusal for a hosted agent (shared_client), whose floor is LIMITS.tokenLaunchShared. */
export const SHARED_AGENT_LIMITED = `Your token didn't launch: this agent reached today's launch limit of ${LIMITS.tokenLaunchShared.limit}.`;
export const launchLimit = async (installationId: number, wallet: string) => {
  // v2.8.1 §E17 (T2 carry): a hosted agent's one registration may serve many builders, so its
  // per-agent floor is higher; the wallet's 10 stays the real limit. A failed read keeps the low floor.
  const shared = await sharedGroup(installationId).catch(() => false);
  const agent = shared ? 'tokenLaunchShared' : 'tokenLaunch';
  const agentLimited = shared ? SHARED_AGENT_LIMITED : AGENT_LIMITED;
  try {
    // The agent's first, so a refusal there never uses one of the wallet's 10.
    await enforce(agent, installationId, agentLimited);
    await enforce('tokenLaunchWallet', wallet.toLowerCase(), WALLET_LIMITED);
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    const wallet = err.message.startsWith(WALLET_LIMITED);
    // The fixed window's end, exactly (the error's whole seconds would round a minute past it).
    const windowMs = LIMITS[wallet ? 'tokenLaunchWallet' : agent].windowSeconds * 1000;
    const end = new Date(windowStart(new Date(), windowMs).getTime() + windowMs);
    throw new LaunchError(`${wallet ? WALLET_LIMITED : agentLimited} ${tryAgainAfter(end)}`);
  }
};

/** A stored name and ticker that still pass the rules, else null. */
function storedProposal(p: FlowProject) {
  if (!p.token_name || !p.token_symbol || tickerProblem(p.token_symbol)) return null;
  const name = cleanTokenName(p.token_name);
  return 'name' in name ? { name: name.name, symbol: p.token_symbol } : null;
}

/** Ruling 31: tool, field or file names a builder-facing note must never carry. */
export const TECHNICAL_TERMS =
  /\b(launch_token|record_submission|prepare_submission|confirm_entry|tell_earnkit|pick_up_entries|list_programs|get_program|creator_wallet|payout_wallet|repo_url|live_url|image_data|image_url|builder_x|builder_confirmed|builder_submitted|project_id|external_submission_url|token_line)\b|earnkit\.txt/;

/**
 * A LaunchError or RateLimitError as an outcome. Ruling 31: a message naming a field (an image or
 * a lookup problem) reaches the builder in plain words, with the original for the agent.
 */
const notLaunched = (err: unknown): TokenOutcome | null => {
  if (!(err instanceof LaunchError || err instanceof RateLimitError)) return null;
  if (!TECHNICAL_TERMS.test(err.message)) return { status: 'failed', note: err.message };
  const note = /image_data/.test(err.message)
    ? "Not launched: the token's image isn't usable (a PNG, JPEG, WebP or GIF up to 1 MB)."
    : "Not launched: EarnKit couldn't use this entry's token details.";
  return { status: 'failed', note, agent_note: err.message };
};

/** Where a flow got to: once `deploying`, a launch claim may be pending. */
type Progress = {
  deploying: boolean;
  /** v2.8.1 fix round 1: the tool already replied (withinReply's stand-in); the flow runs on. */
  replied?: boolean;
};

/**
 * The one token flow behind record_submission ('submission'), launch_token ('launch') and, v2.8,
 * confirm_entry ('confirm'). In confirm mode a problem the agent can fix now and retry (no wallet, a
 * name or ticker problem, a taken ticker, the gate's proof line or a transient read) is marked
 * `fixable`; a lasting one (no public repo, the repo's token elsewhere, the daily limit, launches
 * unavailable, a tokens.fun refusal) is not.
 */
async function runTokenFlow(
  project: FlowProject,
  a: {
    mode: 'submission' | 'launch' | 'confirm';
    installationId: number;
    choice: 'skip' | Choice | undefined;
    confirmed: boolean;
    chain: 'base' | 'robinhood' | 'arbitrum';
    /** Ruling 22: the wallet given with this entry (validated), before the entry's own (never a remembered one, Ruling 30). */
    givenWallet?: string | null;
    /** v2.8.1 fix round 1: the agent checking back after "launching": a read, never a launch. */
    checkBack?: boolean;
    /** Rulings G8, G9: whose GitHub sign-in proves the repo (token-gate.ts GateInput.verifiedLogin). */
    verifiedLogin?: string | null;
  },
  deps: TokenFlowDeps,
  progress: Progress = { deploying: false },
): Promise<TokenOutcome> {
  const store = deps.store ?? dbStore;
  const choice = a.choice === 'skip' ? undefined : a.choice;
  // v2.8 Ruling 3 (plan): a skipped entry was entered without a token, and stays so (nothing written).
  if (project.confirm_choice === 'skip') return { status: a.mode === 'launch' ? 'failed' : 'skipped', note: SKIPPED_ENTRY };

  const record = async (status: TokenStatus, note: string, name?: string, symbol?: string, agent_note?: string) => {
    await store.setStatus(project.id, { status, note, name, symbol });
    return { status, note, name, symbol, ...(agent_note && { agent_note }) } satisfies TokenOutcome;
  };
  // Not configured: nothing to check or launch (no GitHub, live-link or tokens.fun calls).
  if (!(deps.available ?? tokenLaunchesAvailable)())
    return project.token_url
      ? { status: 'skipped', note: TOKENS_UNAVAILABLE }
      : record('skipped', TOKENS_UNAVAILABLE);

  // v2.8.1 §A1, §A5: this entry's own launch is in progress: "launching" (the next call has the
  // result), or, past 10 minutes, said plainly (the cron has alerted the owner). Nothing is written.
  if (project.token_url === 'pending') return pendingOutcome(project.token_claimed_at, Boolean(project.token_note));
  // v2.8.1 fix round 1: a check-back is a read; so is any call within 2 minutes of a release the
  // builder hasn't seen (it happened after the "launching" reply). Only a new "go" relaunches.
  const unseen =
    !project.token_url &&
    project.token_released_at != null &&
    Date.now() - new Date(project.token_released_at).getTime() < RELEASE_READ_MS;
  if (!project.token_url && (a.checkBack || unseen)) {
    if (project.token_released_at != null) await store.markReleaseSeen?.(project.id);
    if (!project.token_status || project.token_status === 'launched')
      return a.mode === 'confirm'
        ? { status: 'skipped', note: STILL_CHECKING, agent_note: LAUNCHING_AGENT, fixable: true }
        : { status: 'skipped', note: STILL_CHECKING_LAUNCH, agent_note: LAUNCHING_AGENT };
    return { status: project.token_status, note: project.token_note ?? NOT_LAUNCHED_YET };
  }

  // A confirm-mode problem the agent fixes and retries (v2.8 Ruling 4 (plan)).
  const fix = (o: TokenOutcome): TokenOutcome => (a.mode === 'confirm' ? { ...o, fixable: true } : o);
  // At submission an explicit ticker is the builder's; no proposal (and no ticker lookups) needed.
  const explicit = a.mode === 'submission' && Boolean(choice?.symbol?.trim());
  // A retry (launch_token, or confirm_entry after a taken ticker) uses the stored suggestion.
  const proposed = explicit
    ? null
    : (a.mode !== 'submission' && storedProposal(project)) ||
      (await proposeToken(project.name, deps.check, project.repo_url ?? undefined));
  const proposal = proposed ? { name: proposed.name, symbol: proposed.symbol } : null;
  // At submission a ticker without a name takes the (cleaned) project name.
  const projectName = cleanTokenName(project.name);
  const fallback =
    a.mode === 'submission'
      ? { name: 'name' in projectName ? projectName.name : proposal?.name, symbol: proposal?.symbol }
      : proposal;
  // Rulings 28 and 30: never the installation's remembered wallet, in either mode (it may be
  // another entry's, another person's on a shared registration, or changed since the builder saw
  // it). Only a wallet given in this call (record_submission's payout_wallet, the agent echoing the
  // wallet line the builder confirmed, or creator_wallet) or the entry's own wallet.
  // v2.8 fix round 2: in confirm mode, only the wallet passed with this "go" (the agent echoes the
  // wallet it showed); never the entry's stored wallet, which the builder may not have seen.
  const wallet =
    a.mode === 'confirm'
      ? (choice?.creator_wallet ?? null)
      : (choice?.creator_wallet ?? a.givenWallet ?? project.creator_wallet ?? project.payout_wallet ?? null);
  const decision = decideToken({
    policy: project.token_policy,
    choice: a.choice,
    confirmed: a.confirmed,
    existingTokenUrl: project.token_url,
    proposal: fallback,
    wallet,
    needsSymbol: a.mode === 'submission',
  });
  // Token retry (v2.4 §6, audit C14): a creator wallet given now, or the one a launch uses, is
  // kept, so launch_token after a gate failure doesn't ask for it again (and fee reads know it).
  const keep = choice?.creator_wallet ?? a.givenWallet ?? (decision.action === 'launch' ? wallet : null);
  // v2.9 B9 (fix round 2): on a shared client the entry may be another builder's, so the wallet is
  // kept only once the gate passed for this caller.
  const sharedCaller = a.verifiedLogin !== undefined;
  const saveWallet = async () => {
    if (keep && !project.token_url && keep.toLowerCase() !== project.creator_wallet)
      await store.saveCreatorWallet(project.id, a.installationId, keep);
  };
  if (!sharedCaller) await saveWallet();
  // Not launching here: at submission it's skipped; launch_token was asked to launch, so a refusal
  // there (an existing token, a refused edit, no wallet) has failed.
  const notNow = decision.action === 'refuse' && a.mode === 'launch' ? 'failed' : 'skipped';

  if (decision.action !== 'launch') {
    // A project that has (or is getting) a token is never written to here.
    if (project.token_url)
      return { status: notNow, note: decision.note, ...(decision.agent_note && { agent_note: decision.agent_note }) };
    // Kept for a later launch_token: the builder's valid edits, else the proposal.
    const edits = choice ? editsOf(choice) : {};
    const out = await record(
      notNow,
      decision.note,
      edits.name ?? fallback?.name ?? undefined,
      edits.symbol ?? proposal?.symbol,
      decision.agent_note,
    );
    // Ruling 18 (plan): at submission, no wallet means the entry has no coin yet.
    if (decision.action === 'refuse' && decision.code === 'no_wallet' && a.mode !== 'launch')
      return a.mode === 'confirm'
        ? fix({ ...out, no_wallet: true, agent_note: 'Ask the builder for their wallet and call confirm_entry again with it as wallet.' })
        : { ...out, no_wallet: true };
    // v2.8 Ruling 4 (plan): a name or ticker the builder can change now; a token in progress is not.
    return decision.action === 'refuse' && !project.token_url ? fix(out) : out;
  }

  const { name, symbol } = decision;
  const repoNotNow = a.mode === 'launch' ? 'failed' : 'skipped';
  // One token per repo across EarnKit: checked before the ticker re-check (final review M8: no
  // tokens.fun call for a repo that is refused anyway) and the gate (deployToken's claim enforces it).
  const repoKey = project.repo_url ? normalizeRepoUrl(project.repo_url) : null;
  const other = repoKey && (await store.repoToken(project.id, repoKey));
  if (other) return record(repoNotNow, repoHasTokenNote(other), name, symbol);

  // C6: one last check of the final ticker (proposed or the builder's own). tokens.fun doesn't
  // refuse a duplicate from EarnKit, so a taken ticker is never launched; unreachable (null)
  // launches as in v2.3. The suggestion is stored, so "go" launches it via launch_token.
  const check = deps.check ?? tokensFunTickerCheck;
  if ((await check(symbol)) === false) {
    const next = await proposeToken(
      project.name,
      async (s) => (s === symbol ? false : check(s)),
      project.repo_url ?? undefined,
    );
    return fix({
      ...(await record(
        repoNotNow,
        tickerTakenNote(next.symbol),
        name,
        next.symbol,
        `${symbol} is already used on tokens.fun (check-ticker), so nothing was deployed. ` +
          (a.mode === 'confirm'
            ? `If the builder says go, call confirm_entry again (it uses the stored ${next.symbol}); for their own ticker, pass token.symbol.`
            : `If the builder says go, call launch_token (it uses the stored ${next.symbol}); for their own ticker, pass symbol.`),
      )),
      ticker_taken: symbol,
    });
  }

  const gate = await tokenGate(
    {
      policy: project.token_policy,
      repoUrl: project.repo_url,
      wallet: wallet!,
      symbol,
      installationId: a.installationId,
      projectId: project.id,
      verifiedLogin: a.verifiedLogin,
    },
    deps.gate,
  );
  if (!gate.ok) {
    const out = await record('gate_failed', gate.reason, name, symbol);
    const withNote = {
      ...out,
      ...(gate.agent_note && { agent_note: gate.agent_note }),
      ...(gate.branch && { proof_branch: gate.branch }),
      ...(gate.sign_in && { sign_in_needed: gate.sign_in }),
    };
    return gate.fixable ? fix(withNote) : withNote;
  }
  if (sharedCaller) await saveWallet();

  let image: { bytes: Buffer; type: string } | null;
  try {
    image = choice?.image_data ? decodeImage(choice.image_data) : null;
    if (choice?.builder_x) xProfileUrl(choice.builder_x);
    // Counted only for a launch actually sent: never for skips or gate failures.
    await (deps.limit ?? launchLimit)(a.installationId, wallet!);
  } catch (err) {
    const out = notLaunched(err);
    if (!out) throw err;
    return record('failed', out.note!, name, symbol, out.agent_note);
  }
  // v2.10 item 12: no image from the agent: the site's or the public repo's logo, else (null) the
  // generated mark. Never fails the launch.
  if (!image && !choice?.image_url) {
    const logo = await (deps.logo ?? logoDefaults.launch)({
      liveUrl: project.live_url,
      repoUrl: project.repo_url,
      repoPrivate: gate.private === true || project.repo_private === true,
    }).catch((err: unknown) => {
      console.error('[token] logo', err instanceof Error ? err.name : 'error');
      return null;
    });
    image = logo && { bytes: logo.bytes, type: logo.type };
  }
  try {
    progress.deploying = true;
    const out = await (deps.deploy ?? deployToken)({
      projectId: project.id,
      installationId: a.installationId,
      name,
      symbol,
      creatorWallet: wallet!,
      image,
      imageUrl: choice?.image_url,
      builderX: choice?.builder_x,
      chain: a.chain,
      // The repo the gate just checked (and the live link, a traction signal): the claim is bound to them.
      repoUrl: project.repo_url,
      liveUrl: project.live_url,
      // v2.10 R10 (Pre-flight P4): the gate read the repo through the App, so it isn't public.
      ...(gate.private && { repoPrivate: true }),
      background: () => progress.replied === true,
    });
    // Another entry of the repo claimed a token at the same moment: at submission, skipped.
    if (out.status === 'failed' && out.note?.startsWith(REPO_HAS_TOKEN)) return { ...out, status: repoNotNow };
    // Final review M8: a launched token carries its ticker, for the builder's post-launch line.
    return out.status === 'launched' ? { ...out, name: out.name ?? name, symbol: out.symbol ?? symbol } : out;
  } catch (err) {
    // The project is this installation's (checked by the callers), so a LaunchError here is a
    // refusal before any claim (e.g. launches unavailable): report it, don't throw.
    const out = notLaunched(err);
    if (!out) throw err;
    return record('failed', out.note!, name, symbol, out.agent_note);
  }
}

async function ownProject(store: FlowStore, projectId: number, installationId: number) {
  const project = await store.load(projectId);
  if (!project || project.installation_id !== installationId)
    throw new LaunchError(`No project ${projectId} recorded by you. Call record_submission first.`);
  return project;
}

/** A zod issue list as one line: "image_url: must start with https://; Unrecognized key: …". */
const issuesText = (issues: z.core.$ZodIssue[]) =>
  issues.map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`).join('; ');

/**
 * The token part of record_submission: launches only with the ticker the builder confirmed
 * (`choice.symbol`, passed explicitly) and builder_confirmed. `choice` is checked here, not in
 * RecordSubmissionInput, so a bad token field skips the token instead of failing the entry.
 * `image` (as echoed from token.proposed) is ignored; null is no token object.
 */
export async function tokenAfterSubmission(
  a: {
    projectId: number;
    installationId: number;
    choice: unknown;
    confirmed: boolean;
    /** Ruling 22: the entry's validated wallet (record_submission's payout_wallet, not campaigns). */
    givenWallet?: string | null;
    /** v2.8.1 fix round 1: a check-back reads, never launches. */
    checkBack?: boolean;
    /** Rulings G9, G10: whose GitHub sign-in proves the repo (undefined: not a shared client). */
    verifiedLogin?: string | null;
  },
  deps: TokenFlowDeps = {},
  progress?: Progress,
): Promise<TokenOutcome> {
  const store = deps.store ?? dbStore;
  const project = await ownProject(store, a.projectId, a.installationId);
  let choice: 'skip' | Choice | undefined;
  if (a.choice === 'skip' || a.choice === undefined || a.choice === null) choice = a.choice ?? undefined;
  else if (typeof a.choice !== 'object' || Array.isArray(a.choice)) {
    const note = 'token: pass "skip", or an object like { "name": "…", "symbol": "…" }.';
    if (!project.token_url) await store.setStatus(project.id, { status: 'skipped', note });
    return { status: 'skipped', note };
  } else {
    const { image: _image, ...rest } = a.choice as Record<string, unknown>;
    const parsed = TokenChoice.safeParse(rest);
    if (!parsed.success) {
      const note = `token: ${issuesText(parsed.error.issues)}`;
      if (!project.token_url) await store.setStatus(project.id, { status: 'skipped', note });
      return { status: 'skipped', note };
    }
    choice = parsed.data;
  }
  return runTokenFlow(
    project,
    {
      mode: 'submission',
      installationId: a.installationId,
      choice,
      confirmed: a.confirmed,
      chain: 'base',
      givenWallet: a.givenWallet,
      checkBack: a.checkBack,
      verifiedLogin: a.verifiedLogin,
    },
    deps,
    progress,
  );
}

const TOKEN_ERROR = 'EarnKit hit an error launching the token; say "launch the token" to retry.';
const TOKEN_ERROR_DEPLOYING =
  'EarnKit hit an error while launching the token, which may have launched: check tokens.fun before retrying.';

/**
 * v2.8.1 §A5: how long a launch may run before the tool replies. The whole tool must answer within
 * 50 s (clients time out at 60 s); this leaves room for the reads before the flow and the kit
 * after it. EARNKIT_LAUNCH_REPLY_MS overrides it (tests, the e2e); only a positive integer counts.
 */
export function launchReplyMs(env: Record<string, string | undefined> = process.env) {
  const raw = Number(env.EARNKIT_LAUNCH_REPLY_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : 40_000;
}

export { LAUNCHING, LAUNCHING_AGENT };
/** v2.8.1 §A5: the reply time ran out before the deploy started (the repo checks were slow). */
export const STILL_CHECKING = "EarnKit is still checking your repo for the token; say go again in a minute.";
/** STILL_CHECKING for launch_token, whose retry words are "launch the token". */
export const STILL_CHECKING_LAUNCH = "EarnKit is still checking your repo for the token; say 'launch the token' again in a minute.";
export { LAUNCH_STUCK };

/** v2.8.1 fix round 1: a release after the reply is read, not relaunched, for this long. */
export const RELEASE_READ_MS = 2 * 60_000;

/**
 * v2.8.1 §A1, §A5: an entry whose launch claim is pending: "launching" while its deploy runs, else
 * (the deploy answered without a clear result, `settled`, or the claim is over 10 minutes old) said
 * plainly; the cron alerts the owner. Pure.
 */
export function pendingOutcome(
  claimedAt: Date | string | null | undefined,
  settled = false,
  now = new Date(),
): TokenOutcome {
  return settled || launchStuck(claimedAt, now)
    ? { status: 'pending', note: LAUNCH_STUCK, agent_note: launchStuckAgent('The launch is unconfirmed.') }
    : { status: 'pending', note: LAUNCHING, agent_note: LAUNCHING_AGENT, launching: true };
}

/**
 * v2.8.1 §A5: the flow's outcome, or, once `deadline` passes, a stand-in while the flow runs on in
 * the background (its own writes record the result; the next call reads it): "launching" when the
 * deploy was sent (the claim is pending), else "still checking". The flow's own errors still
 * surface when it ends in time; after the deadline they are logged, never unhandled.
 */
async function withinReply(
  flow: Promise<TokenOutcome>,
  progress: Progress,
  deadline: number | undefined,
  mode: 'confirm' | 'launch' = 'launch',
): Promise<TokenOutcome> {
  if (deadline === undefined) return flow;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
  });
  const out = await Promise.race([flow, late]).finally(() => clearTimeout(timer));
  if (out) return out;
  progress.replied = true;
  flow.catch((err: unknown) => console.error('[token] background', err instanceof Error ? err.name : 'error'));
  if (progress.deploying) return { status: 'pending', note: LAUNCHING, agent_note: LAUNCHING_AGENT, launching: true };
  // Nothing sent yet: confirm_entry's "go" (fixable: no kit yet), else "launch the token".
  return mode === 'confirm'
    ? { status: 'skipped', note: STILL_CHECKING, agent_note: LAUNCHING_AGENT, fixable: true }
    : { status: 'skipped', note: STILL_CHECKING_LAUNCH, agent_note: LAUNCHING_AGENT };
}

/** tokenAfterSubmission that never throws: record_submission must return even if the token part fails. */
export async function submissionToken(
  a: Parameters<typeof tokenAfterSubmission>[0],
  deps: TokenFlowDeps = {},
  deadline?: number,
): Promise<TokenOutcome> {
  const progress: Progress = { deploying: false };
  const flow = (async (): Promise<TokenOutcome> => {
    try {
      return await tokenAfterSubmission(a, deps, progress);
    } catch (err) {
      console.error('[token]', err);
      return { status: 'failed', note: progress.deploying ? TOKEN_ERROR_DEPLOYING : TOKEN_ERROR };
    }
  })();
  return withinReply(flow, progress, deadline);
}

/**
 * v2.8 Part C, Ruling 4 (plan): the token on the builder's "yes" at the confirmation step
 * (confirm_entry). Only `wallet`, the one shown in this exchange (never a remembered one), or the
 * entry's own. A `fixable` outcome means: no kit yet, the agent fixes it and confirms again; its
 * builder note says "say go" (the confirmation), and its agent note names confirm_entry. Any other
 * non-launch is lasting (the entry is recorded with no token and the kit is returned). Never throws
 * for a token problem.
 */
export async function confirmToken(
  a: {
    projectId: number;
    installationId: number;
    token?: { name?: string; symbol?: string };
    wallet: string | null;
    /** v2.8.1 §A5: past this time (ms since epoch) the reply is "launching" and the flow runs on. */
    deadline?: number;
    /** v2.8.1 fix round 1: a check-back reads, never launches. */
    checkBack?: boolean;
    /** Rulings G8, G9: whose GitHub sign-in proves the repo (undefined: not a shared client). */
    verifiedLogin?: string | null;
  },
  deps: TokenFlowDeps = {},
): Promise<TokenOutcome> {
  const store = deps.store ?? dbStore;
  const progress: Progress = { deploying: false };
  // Not this installation's project: thrown at once, before any check or launch.
  let project: FlowProject;
  try {
    project = await ownProject(store, a.projectId, a.installationId);
  } catch (err) {
    if (err instanceof LaunchError) throw err;
    console.error('[token] confirm', err instanceof Error ? err.name : 'error');
    return { status: 'failed', note: TOKEN_ERROR_CONFIRM, fixable: true };
  }
  const flow = (async (): Promise<TokenOutcome> => {
    try {
      const parsed = TokenChoice.safeParse({
        ...(a.token?.name !== undefined && { name: a.token.name }),
        ...(a.token?.symbol !== undefined && { symbol: a.token.symbol }),
        ...(a.wallet && { creator_wallet: a.wallet }),
      });
      if (!parsed.success) {
        return { status: 'skipped', ...plainProblem(issuesText(parsed.error.issues)), fixable: true };
      }
      return await runTokenFlow(
        project,
        { mode: 'confirm', installationId: a.installationId, choice: parsed.data, confirmed: true, chain: 'base', checkBack: a.checkBack, verifiedLogin: a.verifiedLogin },
        deps,
        progress,
      );
    } catch (err) {
      console.error('[token] confirm', err instanceof Error ? err.name : 'error');
      return progress.deploying
        ? { status: 'failed', note: TOKEN_ERROR_DEPLOYING }
        : { status: 'failed', note: TOKEN_ERROR_CONFIRM, fixable: true };
    }
  })();
  return toConfirmWords(await withinReply(flow, progress, a.deadline, 'confirm'));
}

/**
 * confirm_entry's words for a flow outcome: the builder says "go" (never "launch the token"), and the
 * agent's notes name confirm_entry. Ruling C24: a proof-line miss also tells an agent that can't push
 * how to get the kit. Pure.
 */
function toConfirmWords(out: TokenOutcome): TokenOutcome {
  const note = out.note?.replace(/say 'launch the token'/g, 'say go');
  if (!out.fixable) return { ...out, ...(note && { note }) };
  const proofLine = out.note?.startsWith(PROOF_LINE_PREFIX) === true;
  const agentNote = out.agent_note?.replace(/call launch_token/g, 'call confirm_entry again');
  return {
    ...out,
    ...(note && { note }),
    ...((agentNote || proofLine) && {
      agent_note: [agentNote, proofLine && CANT_PUSH_RETRY_NOTE].filter(Boolean).join(' '),
    }),
    ...(proofLine && { proof_line: true as const }),
  };
}

/**
 * v2.8 Ruling C7: the deploy window. A token launched by v2.7 code between the migration (which
 * backfills complete_at once) and the cutover passed C7 but has complete_at NULL. Rows whose token
 * launched in [since, until], with complete_at NULL, no confirmation (v2.7 code never sets one) and
 * a stored entry that passes entryMissing, get complete_at = coin_launched_at. Set-once (only where
 * complete_at is still NULL), so re-running changes nothing. Dry run unless `apply`. Returns counts.
 */
export async function completeAtWindow(a: { since: Date; until: Date; apply: boolean }) {
  const rows = await sql()<(FlowProject & StoredChecks)[]>`
    SELECT p.id, p.name, p.repo_url, p.live_url, p.description, p.demo_url,
      pr.submission_requirements AS requirements, (pr.campaign IS NOT NULL) AS campaign,
      (SELECT s.submission_data FROM submissions s WHERE s.project_id = p.id ORDER BY s.id DESC LIMIT 1) AS submission_data,
      p.live_verified_at, p.contract_verified_at, pr.needs_contract
    FROM projects p JOIN programs pr ON pr.id = p.program_id
    WHERE p.complete_at IS NULL AND p.coin_launched_at IS NOT NULL AND p.confirm_choice IS NULL
      AND p.coin_launched_at >= ${a.since} AND p.coin_launched_at <= ${a.until}
    ORDER BY p.id`;
  // v2.9 A5 (Pre-flight P5): an unverified live link is missing here too.
  const complete = rows
    .filter(({ live_verified_at, contract_verified_at, needs_contract, ...r }) =>
      entryMissing(withStoredChecks(r, { live_verified_at, contract_verified_at, needs_contract })).length === 0)
    .map((r) => r.id);
  let updated = 0;
  if (a.apply && complete.length)
    updated = (
      await sql()`
        UPDATE projects SET complete_at = coin_launched_at
        WHERE id IN ${sql()(complete)} AND complete_at IS NULL AND coin_launched_at IS NOT NULL`
    ).count;
  return { launched_without_complete: rows.length, complete: complete.length, updated };
}

/** v2.8 Ruling 3 (plan): launch_token's refusal on an entry the builder confirmed with "skip". */
export const SKIPPED_ENTRY = 'This entry was entered without a token.';

export const LaunchTokenInput = TokenChoice.extend({
  /** The entry to launch for; or `offer` (v2.9 B10), never both. */
  project_id: z.number().int().positive().optional(),
  /** Required for a launch; a skip (decision 'skip') launches nothing. */
  builder_confirmed: z.literal(true).optional(),
  chain: z.enum(['base', 'robinhood', 'arbitrum']).default('base'),
  /** A new live link (e.g. the old one 404s). */
  live_url: z.string().optional(),
  /** A repo link for an entry recorded without one; a recorded repo never changes (record a new entry). */
  repo_url: z.string().optional(),
  /** v2.8.1 fix round 1: checking back after "launching": a read, never a launch. */
  check_back: z.boolean().optional(),
  /** v2.9 B9 (Ruling G9): the code a shared client's builder pasted after signing in with GitHub. */
  signed_in: z.string().max(40).optional(),
  /** v2.9 B10: the first reply's token offer (list_programs token_offer): a draft entry is made for it. */
  offer: z
    .object({ program_id: z.string().min(1), repo_url: z.string().min(1).max(500), project_name: z.string().trim().min(1).max(200) })
    .strict()
    .optional(),
  /** v2.9 B10: the builder's answer to that offer: 'go' launches, 'skip' records a decline. */
  decision: z.enum(['go', 'skip']).default('go'),
  /**
   * v2.9 B10: what the agent can do (can_push: false, the builder signs in with GitHub instead). The
   * same shape every other tool takes (T12 journey 12.1: an agent passing its usual { browser,
   * can_push } got a ZodError on the yes).
   */
  agent: z.object({ browser: z.boolean().optional(), can_push: z.boolean().optional() }).strict().optional(),
})
  .strict()
  .superRefine((v, c) => {
    if ((v.project_id === undefined) === (v.offer === undefined))
      c.addIssue({ code: 'custom', message: 'pass exactly one of project_id or offer' });
    if (v.decision === 'skip' && !v.offer) c.addIssue({ code: 'custom', path: ['decision'], message: "'skip' answers a token offer: pass offer" });
    if (v.decision === 'go' && v.builder_confirmed !== true)
      c.addIssue({ code: 'custom', path: ['builder_confirmed'], message: 'builder_confirmed: true, after the builder said yes' });
  });

/**
 * launch_token: launches (or retries) the token for a project this installation recorded, with
 * the stored proposal unless the builder changed it, after applying any live_url/repo_url fix.
 * Returns a TokenOutcome for every result; throws only when the project isn't this installation's.
 */
export async function launchToken(
  input: Omit<z.infer<typeof LaunchTokenInput>, 'decision'> & { decision?: 'go' | 'skip' },
  installationId: number,
  deps: TokenFlowDeps = {},
  /** v2.8.1 §A5: past this time (ms since epoch) the reply is "launching" and the flow runs on. */
  deadline?: number,
  /** Rulings G8, G9: whose GitHub sign-in proves the repo (undefined: not a shared client). */
  verifiedLogin?: string | null,
): Promise<TokenOutcome> {
  const { project_id, builder_confirmed: _c, chain, live_url, repo_url, check_back, signed_in: _s, offer: _o, decision: _d, agent: _a, ...choice } = input;
  // v2.9 B10: an offer is made into an entry by the launch_token tool first (tools.ts launchFromOffer).
  if (project_id === undefined) throw new LaunchError('launch_token needs project_id here');
  const store = deps.store ?? dbStore;
  const project = await ownProject(store, project_id, installationId);
  // v2.8 Ruling 3 (plan): refused before anything is checked, changed or launched.
  if (project.confirm_choice === 'skip') return { status: 'failed', note: SKIPPED_ENTRY };
  if ((live_url || repo_url) && !project.token_url) {
    if (repo_url && project.payout_wallet)
      return {
        status: 'failed',
        note: "A campaign entry's repo was proven at entry and can't change; enter the other repo as a new entry.",
        agent_note: "repo_url: a campaign entry's repo can't change; record a new entry for the other repo.",
      };
    // v2.5 Ruling 16: a recorded repo never changes (the builder bonus keys entries by it); a
    // missing one may be filled in.
    if (repo_url && project.repo_url && normalizeRepoUrl(repo_url) !== normalizeRepoUrl(project.repo_url))
      return {
        status: 'failed',
        note: "This entry's repo can't change once recorded; enter the other repo as a new entry.",
        agent_note: "repo_url: this entry's repo can't change once recorded; record a new entry for a different repo.",
      };
    const links: { repo_url?: string; live_url?: string } = {};
    for (const [field, raw] of [['repo_url', repo_url], ['live_url', live_url]] as const) {
      if (!raw) continue;
      const c = canonicalBuilderUrl(raw.trim());
      // Ruling 31: the builder reads which link and why; the agent gets the field name.
      if (c.problem)
        return {
          status: 'failed',
          note: `The ${field === 'repo_url' ? 'repo' : 'live'} link isn't usable: ${c.problem}.`,
          agent_note: `${field}: ${c.problem}.`,
        };
      links[field] = c.url;
    }
    await store.updateLinks(project.id, installationId, links);
    Object.assign(project, links);
  }
  // v2.8 Ruling 2 (plan), Ruling C8: an entry whose stored answers and links are complete (one
  // from before v2.8 that never re-recorded, or a link fixed just now) is marked complete, once.
  if (entryMissing(project).length === 0) await store.markComplete(project.id);
  const progress: Progress = { deploying: false };
  const out = await withinReply(
    runTokenFlow(project, { mode: 'launch', installationId, choice, confirmed: true, chain, checkBack: check_back === true, verifiedLogin }, deps, progress),
    progress,
    deadline,
  );
  if (out.launching || out.note === STILL_CHECKING_LAUNCH) return out;
  // The builder bonus counts Base coins only (Ruling 24): a coin launched on another chain never implies it.
  if (out.status === 'launched' && chain !== 'base' && project.has_bonus) return { ...out, note: [out.note, NON_BASE_NO_BONUS].filter(Boolean).join(' ') };
  return out;
}

/** launch_token's note for a coin on another chain, on a program with a builder bonus (Ruling 24). */
export const NON_BASE_NO_BONUS = 'No builder bonus for this token: the builder bonus counts Base tokens only.';
