import {
  OWNERSHIP_FILE,
  fetchOwnershipFile,
  fetchOwnershipLatestBranch,
  fetchOwnershipViaApi,
  shownBranch,
  githubRepo,
  ownershipBaseUrl,
  ownershipFileUrl,
  parseOwnershipFile,
  type FetchResult,
} from './ownership';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeRepoUrl } from './campaigns';
import { ForkCheckError, repoCodeFacts, type RepoCode } from './match-projects';
import type { TokenPolicy } from './program-file';
import { BASE_MAINNET, screenWallet } from './sanctions';
import { githubVerifyEnabled, verifiedFor } from './github-verify';

export type GateInput = {
  policy: TokenPolicy;
  repoUrl: string | null;
  /** The creator wallet: screened for sanctions only (v2.6 §3: earnkit.txt no longer names it). */
  wallet: string;
  /** The ticker being launched: only a v2.5 `token: <SYMBOL> <code>` line (Ruling 1 (plan)) uses it. */
  symbol: string;
  /** The launching agent: the token line's code is bound to it and the repo (tokenCode). */
  installationId: number;
  /** v2.9 B9: the entry launching; a GitHub sign-in verified for it proves the repo instead of the line. */
  projectId?: number;
  /**
   * Rulings G8, G9: whose sign-in counts. Undefined (not a shared client): any for this entry. On a
   * shared client: only this login's (the caller's, from its pasted code); null: none.
   */
  verifiedLogin?: string | null;
};
export type GateDeps = {
  /** The repo's code facts (Ruling 3 (plan)); throws GitHub's error for a missing/private repo. */
  repo?: (owner: string, repo: string) => Promise<RepoCode>;
  /** Reads the repo's earnkit.txt (GitHub contents API, or the dev/test override). */
  owner?: (r: { owner: string; repo: string }) => Promise<FetchResult>;
  /**
   * v2.8.1 §A3: earnkit.txt on the most recently pushed branch other than the default one, read only
   * when the default branch doesn't prove the launch; null when there is none.
   */
  latest?: (r: { owner: string; repo: string }, defaultBranch: string | undefined) => Promise<{ branch: string; file: FetchResult } | null>;
  screen?: (wallet: string) => Promise<void>;
  /**
   * v2.9 B9: the GitHub sign-in that proved this entry's repo (owner/repo), with the fee wallet it
   * was made for (Ruling G11), or null; defaults to the github_verifications row, and is null while
   * the feature is off.
   */
  verified?: (projectId: number, repoKey: string, login?: string) => Promise<{ wallet: string | null } | null>;
};
/**
 * `reason`: plain builder words. `agent_note` (M7): the technical detail, for the agent only.
 * `fixable` (v2.8 Ruling 4 (plan)): the agent can fix it now and try again (the proof line not
 * pushed or not readable yet, a transient GitHub read, a wallet the screen refused); absent for a
 * lasting problem (no public repo, no real code, launches not configured, tokens off).
 */
export type GateResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      agent_note?: string;
      fixable?: true;
      /** v2.8.1 §A3: the proof line is missing; the repo's default branch, when known. */
      branch?: string;
      /**
       * v2.9 B9: only a GitHub sign-in proves this launch (`needed`: a shared client, Ruling G10), or
       * the sign-in was for another fee wallet (`wallet_changed`, Ruling G11).
       */
      sign_in?: 'needed' | 'wallet_changed';
    };

const defaults: Required<GateDeps> = {
  repo: (o, r) => repoCodeFacts(`${o}/${r}`),
  // Ruling 14 (plan): the dev/test override (token-e2e's mock) is read as before; otherwise the
  // contents API, raw only when rate-limited.
  owner: (r) =>
    process.env.EARNKIT_OWNERSHIP_BASE_URL
      ? fetchOwnershipFile(ownershipFileUrl(r, ownershipBaseUrl()))
      : fetchOwnershipViaApi(r),
  // The dev/test override serves the default branch only.
  latest: (r, defaultBranch) =>
    process.env.EARNKIT_OWNERSHIP_BASE_URL ? Promise.resolve(null) : fetchOwnershipLatestBranch(r, defaultBranch),
  screen: (wallet) => screenWallet(wallet, BASE_MAINNET, "This wallet can't receive token fees on EarnKit."),
  verified: async (projectId, repoKey, login) =>
    githubVerifyEnabled() ? verifiedFor({ projectId, repoKey, login }) : null,
};

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** The one retry form in every reason: the builder says it, the agent calls launch_token. */
const SAY = "say 'launch the token'";
const AGAIN = `Try again in a minute: ${SAY}.`;
/**
 * Ruling C24: how the proof-line failure's reason starts (stored as the entry's token_note), so a
 * second "go" whose proof line still can't be confirmed returns the kit instead of looping.
 */
export const PROOF_LINE_PREFIX = 'I need to add a short proof line to your repo';

export const TOKENS_NOT_CONFIGURED = "Token launches aren't configured right now.";
/** v2.9 B9, Ruling G10: on a shared client only a GitHub sign-in proves the repo. */
export const SIGN_IN_FIRST = `Sign in with GitHub to prove the repo is yours first, then ${SAY}.`;
/** v2.9 B9, Ruling G11: the sign-in was for another fee wallet (the reply adds "Sign in again: <link>"). */
export const WALLET_CHANGED = 'Your wallet changed since you signed in.';
export const TOKEN_CODE_LENGTH = 16;

/**
 * v2.6 §3, Ruling 1 (plan): the earnkit.txt code, bound to the launching agent and the repo, never
 * the ticker: the first 16 hex of HMAC-SHA256(EARNKIT_AUTH_SECRET, "token-line:v2:<installation>:
 * <normalized repo>"). Only the launching agent is shown it, so a line copied from someone's public
 * file is useless to anyone else. Null when the secret is unset (launches fail closed).
 */
export function tokenCode(
  installationId: number,
  repoUrl: string,
  secret: string | undefined = process.env.EARNKIT_AUTH_SECRET,
): string | null {
  if (!secret) return null;
  return createHmac('sha256', secret)
    .update(`token-line:v2:${installationId}:${normalizeRepoUrl(repoUrl)}`)
    .digest('hex')
    .slice(0, TOKEN_CODE_LENGTH);
}

/** The exact earnkit.txt line this agent's launches from `repoUrl` need, any ticker; null (no secret). */
export function tokenLineFor(installationId: number, repoUrl: string): string | null {
  const code = tokenCode(installationId, repoUrl);
  return code && `token: ${code}`;
}

/**
 * The v2.3–v2.5 code (v2.3 Ruling 17), kept so a `token: <SYMBOL> <code>` line pushed before v2.6
 * still proves a launch of that ticker (Ruling 1 (plan)): the first 10 hex characters of
 * HMAC-SHA256(EARNKIT_AUTH_SECRET, "token-line:<installation>:<normalized repo>:<SYMBOL>").
 */
export function legacyTokenLineCode(
  installationId: number,
  repoUrl: string,
  symbol: string,
  secret: string | undefined = process.env.EARNKIT_AUTH_SECRET,
): string | null {
  if (!secret) return null;
  return createHmac('sha256', secret)
    .update(`token-line:${installationId}:${normalizeRepoUrl(repoUrl)}:${symbol.toUpperCase()}`)
    .digest('hex')
    .slice(0, 10);
}

const sameCode = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Whether an earnkit.txt answer proves this launch (the agent's code, or a v2.5 line for this ticker). Pure. */
function proves(got: FetchResult, code: string, legacy: { symbol: string; code: string } | null) {
  const file = got.status === 'ok' ? parseOwnershipFile(got.text) : null;
  const sym = legacy?.symbol.toUpperCase();
  return (
    file !== null &&
    (file.codes.some((c) => sameCode(c, code)) ||
      (legacy !== null &&
        file.tokens.some((t) => t.symbol === sym && t.code !== null && sameCode(t.code, legacy.code))))
  );
}

/** v2.8.1 §A3: what an earnkit.txt answer that doesn't prove the launch holds, for the agent. Pure. */
function foundText(got: FetchResult, where: string) {
  if (got.status === 'missing') return `${OWNERSHIP_FILE} isn't on ${where}`;
  if (got.status === 'error') return `${OWNERSHIP_FILE} on ${where} couldn't be read (${got.message})`;
  const file = parseOwnershipFile(got.text);
  return file.codes.length > 0 || file.tokens.length > 0
    ? `${OWNERSHIP_FILE} on ${where} has a token line, but not this agent's code for this repo (another agent's, or an old one)`
    : `${OWNERSHIP_FILE} on ${where} has no token line`;
}

/**
 * Why the repo's earnkit.txt doesn't prove this launch, or null (v2.6 §3). The file must carry
 * `token: <code>` with the launching agent's code for this repo (`code`, from tokenCode): a line only
 * someone who can push to the repo can add, and only for the agent EarnKit showed it to. A v2.5
 * `token: <SYMBOL> <code>` line for the ticker being launched also counts (`legacy`, Ruling 1
 * (plan)). Wallet lines are campaign business (checkOwnership), never needed for a coin. Codes are
 * compared timing-safely. v2.8.1 §A3: `latest`, the most recently pushed other branch's file, also
 * proves it (a push to any branch needs the same access); `defaultBranch` names where the line goes,
 * and the agent note says exactly what was found where. Pure; exported for tests.
 */
export function ownerProblem(
  repo: string,
  got: FetchResult,
  code: string,
  legacy: { symbol: string; code: string } | null,
  more: { defaultBranch?: string; latest?: { branch: string; file: FetchResult } | null } = {},
): { reason: string; agent_note?: string; branch?: string } | null {
  if (proves(got, code, legacy) || (more.latest && proves(more.latest.file, code, legacy))) return null;
  const line = `token: ${code}`;
  // Final review M7: the reason is relayed to the builder, so it never names the file or the line
  // (and never asks the builder to edit anything); the exact line goes in the agent-only note, for
  // the coding agent that writes and pushes it.
  // The default branch couldn't be read (and no other branch proved it): a retry, not a missing line.
  if (got.status === 'error')
    return {
      reason: `EarnKit couldn't read your repo's proof line on GitHub right now. ${AGAIN}`,
      agent_note: `${OWNERSHIP_FILE} in ${repo}: ${got.message}`,
    };
  const branch = shownBranch(more.defaultBranch);
  const onDefault = branch ? `the default branch (${branch})` : 'the default branch';
  const found = [
    foundText(got, onDefault),
    more.latest &&
      foundText(more.latest.file, `the most recently pushed branch (${shownBranch(more.latest.branch) ?? 'another branch'})`),
  ].filter(Boolean);
  return {
    reason: `${PROOF_LINE_PREFIX}${branch ? `'s ${branch} branch` : ''} first, then ${SAY}.`,
    agent_note:
      `${found.join('; ')}. Write the line "${line}" to ${OWNERSHIP_FILE} at the root of ${repo} on ${onDefault} ` +
      'and push it yourself; never ask the builder to edit files. Then call launch_token.',
    ...(branch && { branch }),
  };
}

/** Ruling 3 (plan): a public repo with real code, or why not. Pure. */
export function codeProblem(f: RepoCode): string | null {
  if (!f.hasCommits) return `The repo has no commits yet. Push the project's code, then ${SAY}.`;
  if (f.fork && !(f.aheadOfParent && f.aheadOfParent > 0))
    return `The repo is a fork with no new commits; a token needs your own code. Push your own commits to it, then ${SAY}.`;
  return null;
}

/**
 * Whether a recorded project may get a coin (v2.6 §3): the program allows tokens, the public GitHub
 * repo has real code (Ruling 3 (plan)), its earnkit.txt carries this agent's `token: <code>` line
 * for the repo (or a v2.5 line for this ticker), and the creator wallet isn't sanctioned. A live link
 * is no longer required. Stops at the first failure; never cached.
 */
export async function tokenGate(input: GateInput, deps: GateDeps = {}): Promise<GateResult> {
  // An injected earnkit.txt reader (a test double) never pairs with the real branch read.
  const d = { ...defaults, ...(deps.owner && { latest: async () => null }), ...deps };
  if (input.policy === 'off') return { ok: false, reason: "This program doesn't allow tokens for entries." };
  const gh = input.repoUrl ? githubRepo(input.repoUrl) : null;
  if (!gh || !input.repoUrl)
    return { ok: false, reason: `A token needs the project's public GitHub repo. Share its link, then ${SAY}.` };
  let facts: RepoCode;
  try {
    facts = await d.repo(gh.owner, gh.repo);
  } catch (err) {
    if (err instanceof ForkCheckError)
      return { ok: false, reason: `EarnKit couldn't check the fork's commits on GitHub right now. ${AGAIN}`, fixable: true };
    return /not found/.test(msg(err))
      ? { ok: false, reason: `The repo ${gh.owner}/${gh.repo} isn't public on GitHub. Make it public, then ${SAY}.` }
      : { ok: false, reason: `EarnKit couldn't check the repo on GitHub right now. ${AGAIN}`, fixable: true };
  }
  const noCode = codeProblem(facts);
  if (noCode) return { ok: false, reason: noCode };
  const code = tokenCode(input.installationId, input.repoUrl);
  if (!code) return { ok: false, reason: TOKENS_NOT_CONFIGURED };
  // v2.9 B9: a GitHub sign-in that proved this entry's repo stands in for the proof line (the
  // repo's code above and the wallet screen below still run). A failed read is no verification.
  // Ruling G11: only for the fee wallet the owner saw when signing in.
  const signIn =
    input.projectId !== undefined && input.verifiedLogin !== null
      ? await d.verified(input.projectId, `${gh.owner}/${gh.repo}`.toLowerCase(), input.verifiedLogin).catch(() => null)
      : null;
  const signedIn = signIn !== null && signIn.wallet !== null && signIn.wallet === input.wallet.toLowerCase();
  const walletChanged = { ok: false as const, reason: WALLET_CHANGED, fixable: true as const, sign_in: 'wallet_changed' as const };
  if (!signedIn) {
    // Ruling G10: on a shared client (verifiedLogin given) the proof line is the whole agent's, so
    // while sign-in is on it never proves a launch there.
    if (input.verifiedLogin !== undefined && githubVerifyEnabled())
      return signIn ? walletChanged : { ok: false, reason: SIGN_IN_FIRST, fixable: true, sign_in: 'needed' };
    const legacyCode = legacyTokenLineCode(input.installationId, input.repoUrl, input.symbol);
    const legacy = legacyCode ? { symbol: input.symbol.toUpperCase(), code: legacyCode } : null;
    const onDefault = await d.owner(gh);
    // v2.8.1 §A3: the default branch first; only when it doesn't prove the launch, the most recently
    // pushed other branch (one more GitHub call).
    const latest = proves(onDefault, code, legacy)
      ? null
      : await d.latest(gh, facts.defaultBranch).catch(() => null);
    const problem = ownerProblem(`github.com/${gh.owner}/${gh.repo}`, onDefault, code, legacy, {
      defaultBranch: facts.defaultBranch,
      latest,
    });
    if (problem) return signIn ? walletChanged : { ok: false, ...problem, fixable: true };
  }
  try {
    await d.screen(input.wallet);
  } catch (err) {
    return { ok: false, reason: `creator wallet: ${msg(err)}`, fixable: true };
  }
  return { ok: true };
}
