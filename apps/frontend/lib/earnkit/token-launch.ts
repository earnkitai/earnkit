import { z } from 'zod';
import { normalizeLiveUrl, normalizeRepoUrl } from './campaigns';
import { sql } from './db';
import { rememberWallets, rememberedPayoutWallet } from './installations';
import { OWNERSHIP_FILE } from './ownership';
import type { TokenPolicy } from './program-file';
import type { ProgramRow } from './programs';
import { canonicalBuilderUrl } from './untrusted-text';
import { RateLimitError, enforce } from './rate-limit';
import { tokenGate, tokenLineFor, type GateDeps } from './token-gate';
import { tokenFootnote, tokenRow } from './entry-text';
import {
  cleanTokenName,
  proposeToken,
  tickerProblem,
  type TickerCheck,
} from './token-proposal';
import {
  EARNINGS_LINE,
  LaunchError,
  REPO_HAS_TOKEN,
  TOKENS_UNAVAILABLE,
  TOKEN_TERMS,
  decodeImage,
  deployToken,
  repoCoinPrograms,
  repoHasTokenNote,
  repoTokenUrl,
  setTokenStatus,
  tokenLaunchesAvailable,
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
    creator_wallet: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, 'a 0x wallet address')
      .optional(),
    builder_x: z.string().trim().min(1).optional(),
  })
  .strict();
type Choice = z.infer<typeof TokenChoice>;

export type TokenBlock = {
  proposed: { name: string; symbol: string; image: 'agent' | 'monogram' } | null;
  chain: 'base';
  paired_with: 'WETH';
  creator_wallet: string | null;
  earnings: string;
  terms: { agreement: string; risks: string };
  policy: 'encouraged' | 'allowed';
  say_to_builder: string;
  note: string;
  /** v2.5 §3: the program is active and has a submission_proof pattern (hasBuilderBonus). */
  has_bonus: boolean;
  /**
   * Ruling 25: the program this repo's coin is already entered in (one coin per repo), on a
   * program with a builder bonus: no new coin and no builder bonus here. Null otherwise.
   */
  repo_coin_program: string | null;
};

/**
 * Whether a program's entries can earn the builder bonus (v2.5 §3): it has a submission_proof
 * pattern (so EarnKit can fetch public proof of an entry) and the program is active. Pure.
 */
export const hasBuilderBonus = (program: Pick<ProgramRow, 'status' | 'submission_proof'>) =>
  program.status === 'active' && program.submission_proof != null;

export type Decision =
  | { action: 'skip'; note: string }
  | { action: 'launch'; name: string; symbol: string }
  | { action: 'refuse'; note: string };

const NO_WALLET =
  'Not launched: no creator wallet. Ask the builder for the wallet that receives creator fees and call launch_token with creator_wallet.';
const NEEDS_SYMBOL =
  "Not launched: pass token: { name, symbol } exactly as shown to the builder (from prepare_submission's token.proposed), or call launch_token.";

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
    return { action: 'skip', note: 'Not launched: the builder said no token. Call launch_token later if they change their mind.' };
  if (a.existingTokenUrl)
    return {
      action: 'refuse',
      note:
        a.existingTokenUrl === 'pending'
          ? 'A launch for this project is in progress or unconfirmed. Check tokens.fun before trying again.'
          : `This project already has a token: ${a.existingTokenUrl}`,
    };
  if (!a.confirmed)
    return {
      action: 'skip',
      note: 'Not launched: pass builder_confirmed: true once the builder has seen the token line, or call launch_token later.',
    };
  const choice = a.choice ?? {};
  if (a.needsSymbol && !choice.symbol?.trim()) return { action: 'skip', note: NEEDS_SYMBOL };
  const edits = editsOf(choice);
  if (edits.problem) return { action: 'refuse', note: edits.problem };
  const rawName = edits.name ?? a.proposal?.name;
  const symbol = edits.symbol ?? a.proposal?.symbol?.trim().toUpperCase();
  if (!rawName || !symbol)
    return {
      action: 'refuse',
      note: 'Not launched: EarnKit has no proposed token for this project. Pick a name and ticker (3–6 letters or digits) with the builder and pass them.',
    };
  const name = cleanTokenName(rawName);
  if ('problem' in name) return { action: 'refuse', note: name.problem };
  const tickerIssue = tickerProblem(symbol);
  if (tickerIssue) return { action: 'refuse', note: tickerIssue };
  if (!a.wallet) return { action: 'refuse', note: NO_WALLET };
  return { action: 'launch', name: name.name, symbol };
}

/** What the builder must have in the repo before a launch (v2.3 Ruling 12 and its fix round). */
const ownershipLine = (wallet: string | null, tokenLine: string | null) =>
  `The project's public GitHub repo needs a file named ${OWNERSHIP_FILE} at its root with the line ` +
  `"payout_wallet: ${wallet ?? '<creator wallet>'}" (campaign entries already have it; if that line ` +
  `names another wallet, add "creator_wallet: ${wallet ?? '<creator wallet>'}") and, for each launch, ` +
  (tokenLine
    ? `the line "${tokenLine}" (it is for this agent, this repo and this ticker only; a changed ticker gets a new line).`
    : "a line \"token: <SYMBOL> <code>\" for this agent: pass the project's repo_url (and the ticker) to get it, or record_submission's token note gives it.");

/**
 * The `token` block of prepare_submission, or null when the program has no tokens, launches aren't
 * configured, or no name is known yet. `say_to_builder` is the consent text (v2.4): the one token
 * row (the ticker, a default the builder can turn off) and the footnote with the earnings, the fee
 * wallet when known, and both terms links. What the repo needs is in `note`, for the agent.
 */
export async function tokenProposalBlock(
  a: {
    program: ProgramRow;
    projectName?: string;
    creatorWallet: string | null;
    /** The asking agent and the project's repo: the earnkit.txt token line is bound to both. */
    installationId: number;
    repoUrl?: string;
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
  const projectName = a.projectName?.trim();
  if (!projectName) return null;
  const proposal = await proposeToken(projectName, deps.check);
  const earnings = EARNINGS_LINE(a.creatorWallet ?? '<your wallet>');
  const notes: string[] = [];
  if (proposal.name === null) notes.push(proposal.reason);
  else if (proposal.note) notes.push(proposal.note);
  if (!a.creatorWallet) notes.push('Ask the builder for the wallet that receives creator fees.');
  // Shown only to this agent (prepare_submission's reply): its code is useless to anyone else.
  const tokenLine =
    a.repoUrl && proposal.symbol ? tokenLineFor(a.installationId, a.repoUrl, proposal.symbol) : null;
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
    notes.push(`This repo already has its coin, entered in ${coinIn}: don't pass token; this entry gets no new coin and no builder bonus`);
  else notes.push(ownershipLine(a.creatorWallet, tokenLine));
  return {
    proposed:
      proposal.name === null
        ? null
        : { name: proposal.name, symbol: proposal.symbol, image: 'monogram' },
    chain: 'base',
    paired_with: 'WETH',
    creator_wallet: a.creatorWallet,
    earnings,
    terms: TOKEN_TERMS,
    policy: program.token_policy,
    has_bonus: hasBonus,
    repo_coin_program: coinIn,
    // v2.4: one row in the confirmation (prepare_submission's show_to_builder carries it), with
    // the earnings and terms under the table, naming the fee wallet when known (Ruling 14). What
    // the repo needs is the agent's job (note). v2.5: on a program with a builder bonus, skipping
    // the coin costs the bonus (tokenRow's hasBonus), never advertised past this one row.
    say_to_builder: coinIn
      ? tokenRow(null, hasBonus, coinIn)
      : `${tokenRow(proposal.name === null ? null : proposal.symbol, hasBonus)}\n\n${tokenFootnote(a.creatorWallet)}`,
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
  /** Set for campaign entries only: proven by the repo's earnkit.txt at entry. */
  payout_wallet: string | null;
  /** The creator wallet given before (record_submission or a launch); launch_token reuses it. */
  creator_wallet: string | null;
  token_url: string | null;
  token_name: string | null;
  token_symbol: string | null;
  installation_id: number | null;
  token_policy: TokenPolicy;
  /** The program has a builder bonus (hasBuilderBonus), for launch_token's non-Base note. */
  has_bonus?: boolean;
};

/** The flow's reads and writes, injectable so tests need no database. */
type FlowStore = {
  load: (projectId: number) => Promise<FlowProject | null>;
  setStatus: typeof setTokenStatus;
  rememberedWallet: (installationId: number) => Promise<string | null>;
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
};

export type TokenFlowDeps = {
  gate?: GateDeps;
  check?: TickerCheck;
  deploy?: typeof deployToken;
  store?: FlowStore;
  /** Counts one launch for the installation; throws RateLimitError over LIMITS.tokenLaunch. */
  limit?: (installationId: number) => Promise<unknown>;
  /** Whether launches are configured (default: the tokens.fun deploy key is set). */
  available?: () => boolean;
};

const dbStore: FlowStore = {
  load: async (projectId) => {
    const [row] = await sql()<FlowProject[]>`
      SELECT p.id, p.name, p.repo_url, p.live_url, p.payout_wallet, p.creator_wallet, p.token_url, p.token_name,
        p.token_symbol, p.installation_id, pr.token_policy,
        (pr.status = 'active' AND pr.submission_proof IS NOT NULL) AS has_bonus
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE p.id = ${projectId}`;
    return row ?? null;
  },
  setStatus: setTokenStatus,
  rememberedWallet: rememberedPayoutWallet,
  repoToken: repoTokenUrl,
  updateLinks: async (projectId, installationId, links) => {
    const live = links.live_url ?? null;
    const repo = links.repo_url ?? null;
    // Campaign entries (payout_wallet set) keep live_key, the normalized live link, in step.
    // A recorded repo never changes (v2.5 Ruling 16): only a missing one is filled in, and an
    // external entry's bonus_repo_key with it.
    // N1 (Ruling 22): a proof that passed without a repo (on the live site) is re-checked once a
    // repo is filled in, so it must then link the repo: cleared here, the daily re-check reads it.
    await sql()`
      UPDATE projects SET repo_url = COALESCE(repo_url, ${repo}),
        bonus_repo_key = CASE WHEN repo_url IS NULL AND payout_wallet IS NULL AND ${repo}::text IS NOT NULL
          THEN ${repo && normalizeRepoUrl(repo)} ELSE bonus_repo_key END,
        submission_proof_ok_at = CASE WHEN repo_url IS NULL AND ${repo}::text IS NOT NULL
          THEN NULL ELSE submission_proof_ok_at END,
        submission_proof_checked_at = CASE WHEN repo_url IS NULL AND ${repo}::text IS NOT NULL
          THEN NULL ELSE submission_proof_checked_at END,
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
    await rememberWallets(installationId, [w]);
  },
};

const LIMITED = 'This agent has launched 3 tokens today, the daily limit.';
const defaultLimit = (installationId: number) => enforce('tokenLaunch', installationId, LIMITED);

/** A stored name and ticker that still pass the rules, else null. */
function storedProposal(p: FlowProject) {
  if (!p.token_name || !p.token_symbol || tickerProblem(p.token_symbol)) return null;
  const name = cleanTokenName(p.token_name);
  return 'name' in name ? { name: name.name, symbol: p.token_symbol } : null;
}

const notLaunched = (err: unknown): TokenOutcome | null =>
  err instanceof LaunchError || err instanceof RateLimitError
    ? { status: 'failed', note: err.message }
    : null;

/** Where a flow got to: once `deploying`, a launch claim may be pending. */
type Progress = { deploying: boolean };

/** The one token flow behind record_submission ('submission') and launch_token ('launch'). */
async function runTokenFlow(
  project: FlowProject,
  a: {
    mode: 'submission' | 'launch';
    installationId: number;
    choice: 'skip' | Choice | undefined;
    confirmed: boolean;
    chain: 'base' | 'robinhood' | 'arbitrum';
  },
  deps: TokenFlowDeps,
  progress: Progress = { deploying: false },
): Promise<TokenOutcome> {
  const store = deps.store ?? dbStore;
  const choice = a.choice === 'skip' ? undefined : a.choice;

  const record = async (status: TokenStatus, note: string, name?: string, symbol?: string) => {
    await store.setStatus(project.id, { status, note, name, symbol });
    return { status, note, name, symbol } satisfies TokenOutcome;
  };
  // Not configured: nothing to check or launch (no GitHub, live-link or tokens.fun calls).
  if (!(deps.available ?? tokenLaunchesAvailable)())
    return project.token_url
      ? { status: 'skipped', note: TOKENS_UNAVAILABLE }
      : record('skipped', TOKENS_UNAVAILABLE);

  // At submission an explicit ticker is the builder's; no proposal (and no ticker lookups) needed.
  const explicit = a.mode === 'submission' && Boolean(choice?.symbol?.trim());
  const proposed = explicit
    ? null
    : (a.mode === 'launch' && storedProposal(project)) ||
      (await proposeToken(project.name, deps.check));
  const proposal = proposed && proposed.name !== null ? { name: proposed.name, symbol: proposed.symbol } : null;
  // At submission a ticker without a name takes the (cleaned) project name.
  const projectName = cleanTokenName(project.name);
  const fallback =
    a.mode === 'submission'
      ? { name: 'name' in projectName ? projectName.name : proposal?.name, symbol: proposal?.symbol }
      : proposal;
  const wallet =
    choice?.creator_wallet ??
    project.creator_wallet ??
    project.payout_wallet ??
    (await store.rememberedWallet(a.installationId));
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
  const keep = choice?.creator_wallet ?? (decision.action === 'launch' ? wallet : null);
  if (keep && !project.token_url && keep.toLowerCase() !== project.creator_wallet)
    await store.saveCreatorWallet(project.id, a.installationId, keep);
  // Not launching here: at submission it's skipped; launch_token was asked to launch, so a refusal
  // there (an existing token, a refused edit, no wallet) has failed.
  const notNow = decision.action === 'refuse' && a.mode === 'launch' ? 'failed' : 'skipped';

  if (decision.action !== 'launch') {
    // A project that has (or is getting) a token is never written to here.
    if (project.token_url) return { status: notNow, note: decision.note };
    // Kept for a later launch_token: the builder's valid edits, else the proposal.
    const edits = choice ? editsOf(choice) : {};
    return record(
      notNow,
      decision.note,
      edits.name ?? fallback?.name ?? undefined,
      edits.symbol ?? proposal?.symbol,
    );
  }

  const { name, symbol } = decision;
  const repoNotNow = a.mode === 'launch' ? 'failed' : 'skipped';
  // One token per repo across EarnKit: checked before the gate (deployToken's claim enforces it).
  const repoKey = project.repo_url ? normalizeRepoUrl(project.repo_url) : null;
  const other = repoKey && (await store.repoToken(project.id, repoKey));
  if (other) return record(repoNotNow, repoHasTokenNote(other), name, symbol);

  const gate = await tokenGate(
    {
      policy: project.token_policy,
      repoUrl: project.repo_url,
      liveUrl: project.live_url,
      wallet: wallet!,
      symbol,
      installationId: a.installationId,
      provenWallet: project.payout_wallet,
    },
    deps.gate,
  );
  if (!gate.ok) return record('gate_failed', gate.reason, name, symbol);

  let image: ReturnType<typeof decodeImage> | null;
  try {
    image = choice?.image_data ? decodeImage(choice.image_data) : null;
    if (choice?.builder_x) xProfileUrl(choice.builder_x);
    // Counted only for a launch actually sent: never for skips or gate failures.
    await (deps.limit ?? defaultLimit)(a.installationId);
  } catch (err) {
    const out = notLaunched(err);
    if (!out) throw err;
    return record('failed', out.note!, name, symbol);
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
      // The links the gate just checked: the claim is bound to them.
      repoUrl: project.repo_url,
      liveUrl: project.live_url,
    });
    // Another entry of the repo claimed a token at the same moment: at submission, skipped.
    return out.status === 'failed' && out.note?.startsWith(REPO_HAS_TOKEN)
      ? { ...out, status: repoNotNow }
      : out;
  } catch (err) {
    // The project is this installation's (checked by the callers), so a LaunchError here is a
    // refusal before any claim (e.g. launches unavailable): report it, don't throw.
    const out = notLaunched(err);
    if (!out) throw err;
    return record('failed', out.note!, name, symbol);
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
    { mode: 'submission', installationId: a.installationId, choice, confirmed: a.confirmed, chain: 'base' },
    deps,
    progress,
  );
}

const TOKEN_ERROR = 'EarnKit hit an error launching the token; say "launch the token" to retry.';
const TOKEN_ERROR_DEPLOYING =
  'EarnKit hit an error while launching the token, which may have launched: check tokens.fun before retrying.';

/** tokenAfterSubmission that never throws: record_submission must return even if the token part fails. */
export async function submissionToken(
  a: Parameters<typeof tokenAfterSubmission>[0],
  deps: TokenFlowDeps = {},
): Promise<TokenOutcome> {
  const progress: Progress = { deploying: false };
  try {
    return await tokenAfterSubmission(a, deps, progress);
  } catch (err) {
    console.error('[token]', err);
    return { status: 'failed', note: progress.deploying ? TOKEN_ERROR_DEPLOYING : TOKEN_ERROR };
  }
}

export const LaunchTokenInput = TokenChoice.extend({
  project_id: z.number().int().positive(),
  builder_confirmed: z.literal(true),
  chain: z.enum(['base', 'robinhood', 'arbitrum']).default('base'),
  /** A new live link (e.g. the old one 404s). */
  live_url: z.string().optional(),
  /** A repo link for an entry recorded without one; a recorded repo never changes (record a new entry). */
  repo_url: z.string().optional(),
}).strict();

/**
 * launch_token: launches (or retries) the token for a project this installation recorded, with
 * the stored proposal unless the builder changed it, after applying any live_url/repo_url fix.
 * Returns a TokenOutcome for every result; throws only when the project isn't this installation's.
 */
export async function launchToken(
  input: z.infer<typeof LaunchTokenInput>,
  installationId: number,
  deps: TokenFlowDeps = {},
): Promise<TokenOutcome> {
  const { project_id, builder_confirmed: _c, chain, live_url, repo_url, ...choice } = input;
  const store = deps.store ?? dbStore;
  const project = await ownProject(store, project_id, installationId);
  if ((live_url || repo_url) && !project.token_url) {
    if (repo_url && project.payout_wallet)
      return {
        status: 'failed',
        note: "repo_url: a campaign entry's repo was proven at entry and can't change; enter the other repo as a new entry.",
      };
    // v2.5 Ruling 16: a recorded repo never changes (the builder bonus keys entries by it); a
    // missing one may be filled in.
    if (repo_url && project.repo_url && normalizeRepoUrl(repo_url) !== normalizeRepoUrl(project.repo_url))
      return {
        status: 'failed',
        note: "repo_url: this entry's repo can't change once recorded; record a new entry for a different repo.",
      };
    const links: { repo_url?: string; live_url?: string } = {};
    for (const [field, raw] of [['repo_url', repo_url], ['live_url', live_url]] as const) {
      if (!raw) continue;
      const c = canonicalBuilderUrl(raw.trim());
      if (c.problem) return { status: 'failed', note: `${field}: ${c.problem}.` };
      links[field] = c.url;
    }
    await store.updateLinks(project.id, installationId, links);
    Object.assign(project, links);
  }
  const out = await runTokenFlow(project, { mode: 'launch', installationId, choice, confirmed: true, chain }, deps);
  // The builder bonus counts Base coins only (Ruling 24): a coin launched on another chain never implies it.
  if (out.status === 'launched' && chain !== 'base' && project.has_bonus) return { ...out, note: [out.note, NON_BASE_NO_BONUS].filter(Boolean).join(' ') };
  return out;
}

/** launch_token's note for a coin on another chain, on a program with a builder bonus (Ruling 24). */
export const NON_BASE_NO_BONUS = 'No builder bonus for this coin: the builder bonus counts Base coins only.';
