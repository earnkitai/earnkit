import { z } from 'zod';
import { sql } from './db';
import { rememberedPayoutWallet } from './installations';
import type { TokenPolicy } from './program-file';
import type { ProgramRow } from './programs';
import { tokenGate, type GateDeps } from './token-gate';
import {
  cleanTokenName,
  proposeToken,
  tickerProblem,
  type TickerCheck,
} from './token-proposal';
import {
  EARNINGS_LINE,
  LaunchError,
  TOKEN_TERMS,
  decodeImage,
  deployToken,
  setTokenStatus,
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
  note?: string;
};

export type Decision =
  | { action: 'skip'; note: string }
  | { action: 'launch'; name: string; symbol: string }
  | { action: 'refuse'; note: string };

const NO_WALLET =
  'Not launched: no creator wallet. Ask the builder for the wallet that receives creator fees and call launch_token with creator_wallet.';

/**
 * Whether to launch, and with which name and ticker. Checks, in order: the program's policy, the
 * builder's "no token", an existing token, the builder's confirmation, the name and ticker (edits
 * over the proposal; the ticker is uppercased and must pass tickerProblem whatever its source),
 * then the creator wallet. Pure; exported for tests.
 */
export function decideToken(a: {
  policy: TokenPolicy;
  choice: 'skip' | Choice | undefined;
  confirmed: boolean;
  existingTokenUrl: string | null;
  proposal: { name: string; symbol: string } | null;
  wallet: string | null;
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
  const rawName = choice.name ?? a.proposal?.name;
  const symbol = (choice.symbol ?? a.proposal?.symbol)?.trim().toUpperCase();
  if (rawName === undefined || symbol === undefined)
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

/** The `token` block of prepare_submission, or null when the program has no tokens or no name is known yet. */
export async function tokenProposalBlock(
  a: { program: ProgramRow; projectName?: string; creatorWallet: string | null },
  deps: { check?: TickerCheck } = {},
): Promise<TokenBlock | null> {
  const { program } = a;
  if (program.token_policy === 'off') return null;
  const projectName = a.projectName?.trim();
  if (!projectName) return null;
  const proposal = await proposeToken(projectName, deps.check);
  const notes: string[] = [];
  if (proposal.name === null) notes.push(proposal.reason);
  if (!a.creatorWallet) notes.push('Ask the builder for the wallet that receives creator fees.');
  return {
    proposed:
      proposal.name === null
        ? null
        : { name: proposal.name, symbol: proposal.symbol, image: 'monogram' },
    chain: 'base',
    paired_with: 'WETH',
    creator_wallet: a.creatorWallet,
    earnings: EARNINGS_LINE(a.creatorWallet ?? '<your wallet>'),
    terms: TOKEN_TERMS,
    policy: program.token_policy,
    say_to_builder:
      proposal.name === null
        ? 'This entry can get a token: pick a name and ticker with the builder (3–6 letters or digits), or say "no token".'
        : `Submitting ${projectName} to ${program.title}, and launching $${proposal.symbol} with your entry. You keep 40% of trading fees. Change the name, ticker or logo, or say "no token".`,
    ...(notes.length > 0 && { note: notes.join(' ') }),
  };
}

/** What the flow reads about a project and its program. */
export type FlowProject = {
  id: number;
  name: string;
  repo_url: string | null;
  live_url: string | null;
  payout_wallet: string | null;
  token_url: string | null;
  token_name: string | null;
  token_symbol: string | null;
  installation_id: number | null;
  token_policy: TokenPolicy;
};

/** The flow's reads and writes, injectable so tests need no database. */
type FlowStore = {
  load: (projectId: number) => Promise<FlowProject | null>;
  setStatus: typeof setTokenStatus;
  rememberedWallet: (installationId: number) => Promise<string | null>;
};

export type TokenFlowDeps = {
  gate?: GateDeps;
  check?: TickerCheck;
  deploy?: typeof deployToken;
  store?: FlowStore;
};

const dbStore: FlowStore = {
  load: async (projectId) => {
    const [row] = await sql()<FlowProject[]>`
      SELECT p.id, p.name, p.repo_url, p.live_url, p.payout_wallet, p.token_url, p.token_name,
        p.token_symbol, p.installation_id, pr.token_policy
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE p.id = ${projectId}`;
    return row ?? null;
  },
  setStatus: setTokenStatus,
  rememberedWallet: rememberedPayoutWallet,
};

/** A stored name and ticker that still pass the rules, else null. */
function storedProposal(p: FlowProject) {
  if (!p.token_name || !p.token_symbol || tickerProblem(p.token_symbol)) return null;
  const name = cleanTokenName(p.token_name);
  return 'name' in name ? { name: name.name, symbol: p.token_symbol } : null;
}

const notLaunched = (err: unknown): TokenOutcome | null =>
  err instanceof LaunchError ? { status: 'failed', note: err.message } : null;

/** The one token flow behind record_submission and launch_token. */
async function runTokenFlow(
  project: FlowProject,
  a: {
    installationId: number;
    choice: 'skip' | Choice | undefined;
    confirmed: boolean;
    chain: 'base' | 'robinhood' | 'arbitrum';
    reuseStored: boolean;
  },
  deps: TokenFlowDeps,
): Promise<TokenOutcome> {
  const store = deps.store ?? dbStore;
  const choice = a.choice === 'skip' ? undefined : a.choice;
  const proposed =
    (a.reuseStored && storedProposal(project)) ||
    (await proposeToken(project.name, deps.check));
  const proposal = proposed.name === null ? null : { name: proposed.name, symbol: proposed.symbol };
  const wallet =
    choice?.creator_wallet ??
    project.payout_wallet ??
    (await store.rememberedWallet(a.installationId));
  const decision = decideToken({
    policy: project.token_policy,
    choice: a.choice,
    confirmed: a.confirmed,
    existingTokenUrl: project.token_url,
    proposal,
    wallet,
  });

  // A project that has (or is getting) a token is never written to here.
  if (project.token_url && decision.action !== 'launch')
    return {
      status: decision.action === 'skip' && project.token_policy === 'off' ? 'skipped' : 'failed',
      note: decision.note,
    };

  const record = async (status: TokenStatus, note: string, name?: string, symbol?: string) => {
    await store.setStatus(project.id, { status, note, name, symbol });
    return { status, note, name, symbol } satisfies TokenOutcome;
  };

  if (decision.action !== 'launch')
    return record('skipped', decision.note, proposal?.name, proposal?.symbol);

  const { name, symbol } = decision;
  const gate = await tokenGate(
    { policy: project.token_policy, repoUrl: project.repo_url, liveUrl: project.live_url, wallet: wallet! },
    deps.gate,
  );
  if (!gate.ok) return record('gate_failed', gate.reason, name, symbol);

  let image: ReturnType<typeof decodeImage> | null;
  try {
    image = choice?.image_data ? decodeImage(choice.image_data) : null;
    if (choice?.builder_x) xProfileUrl(choice.builder_x);
  } catch (err) {
    const out = notLaunched(err);
    if (!out) throw err;
    return record('failed', out.note!, name, symbol);
  }
  try {
    return await (deps.deploy ?? deployToken)({
      projectId: project.id,
      installationId: a.installationId,
      name,
      symbol,
      creatorWallet: wallet!,
      image,
      imageUrl: choice?.image_url,
      builderX: choice?.builder_x,
      chain: a.chain,
    });
  } catch (err) {
    // The project is this installation's (checked by the callers), so a LaunchError here is a
    // refusal before any claim (e.g. launches unavailable): report it, don't throw.
    const out = notLaunched(err);
    if (!out) throw err;
    return record('failed', out.note!, name, symbol);
  }
}

/** The token part of record_submission: launches the proposed (or edited) token when confirmed. */
export async function tokenAfterSubmission(
  a: {
    projectId: number;
    installationId: number;
    choice: 'skip' | Choice | undefined;
    confirmed: boolean;
  },
  deps: TokenFlowDeps = {},
): Promise<TokenOutcome> {
  const project = await (deps.store ?? dbStore).load(a.projectId);
  if (!project || project.installation_id !== a.installationId)
    throw new LaunchError(`No project ${a.projectId} recorded by you. Call record_submission first.`);
  return runTokenFlow(
    project,
    { installationId: a.installationId, choice: a.choice, confirmed: a.confirmed, chain: 'base', reuseStored: false },
    deps,
  );
}

export const LaunchTokenInput = TokenChoice.extend({
  project_id: z.number().int().positive(),
  builder_confirmed: z.literal(true),
  chain: z.enum(['base', 'robinhood', 'arbitrum']).default('base'),
}).strict();

/**
 * launch_token: launches (or retries) the token for a project this installation recorded, with
 * the stored proposal unless the builder changed it. Returns a TokenOutcome for every result;
 * throws only when the project isn't this installation's.
 */
export async function launchToken(
  input: z.infer<typeof LaunchTokenInput>,
  installationId: number,
  deps: TokenFlowDeps = {},
): Promise<TokenOutcome> {
  const { project_id, builder_confirmed: _c, chain, ...choice } = input;
  const project = await (deps.store ?? dbStore).load(project_id);
  if (!project || project.installation_id !== installationId)
    throw new LaunchError(`No project ${project_id} recorded by you. Call record_submission first.`);
  return runTokenFlow(
    project,
    { installationId, choice, confirmed: true, chain, reuseStored: true },
    deps,
  );
}
