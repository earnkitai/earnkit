import {
  OWNERSHIP_FILE,
  fetchOwnershipFile,
  fetchOwnershipViaApi,
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

export type GateInput = {
  policy: TokenPolicy;
  repoUrl: string | null;
  /** The creator wallet: screened for sanctions only (v2.6 §3: earnkit.txt no longer names it). */
  wallet: string;
  /** The ticker being launched: only a v2.5 `token: <SYMBOL> <code>` line (Ruling 1 (plan)) uses it. */
  symbol: string;
  /** The launching agent: the token line's code is bound to it and the repo (tokenCode). */
  installationId: number;
};
export type GateDeps = {
  /** The repo's code facts (Ruling 3 (plan)); throws GitHub's error for a missing/private repo. */
  repo?: (owner: string, repo: string) => Promise<RepoCode>;
  /** Reads the repo's earnkit.txt (GitHub contents API, or the dev/test override). */
  owner?: (r: { owner: string; repo: string }) => Promise<FetchResult>;
  screen?: (wallet: string) => Promise<void>;
};
export type GateResult = { ok: true } | { ok: false; reason: string };

const defaults: Required<GateDeps> = {
  repo: (o, r) => repoCodeFacts(`${o}/${r}`),
  // Ruling 14 (plan): the dev/test override (token-e2e's mock) is read as before; otherwise the
  // contents API, raw only when rate-limited.
  owner: (r) =>
    process.env.EARNKIT_OWNERSHIP_BASE_URL
      ? fetchOwnershipFile(ownershipFileUrl(r, ownershipBaseUrl()))
      : fetchOwnershipViaApi(r),
  screen: (wallet) => screenWallet(wallet, BASE_MAINNET, "This wallet can't receive token fees on EarnKit."),
};

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** The one retry form in every reason: the builder says it, the agent calls launch_token. */
const SAY = "say 'launch the token'";
const AGAIN = `Try again in a minute: ${SAY}.`;

export const TOKENS_NOT_CONFIGURED = "Token launches aren't configured right now.";
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

/**
 * Why the repo's earnkit.txt doesn't prove this launch, or null (v2.6 §3). The file must carry
 * `token: <code>` with the launching agent's code for this repo (`code`, from tokenCode): a line only
 * someone who can push to the repo can add, and only for the agent EarnKit showed it to. A v2.5
 * `token: <SYMBOL> <code>` line for the ticker being launched also counts (`legacy`, Ruling 1
 * (plan)). Wallet lines are campaign business (checkOwnership), never needed for a coin. Codes are
 * compared timing-safely. Pure; exported for tests.
 */
export function ownerProblem(
  repo: string,
  got: FetchResult,
  code: string,
  legacy: { symbol: string; code: string } | null,
): string | null {
  const line = `token: ${code}`;
  if (got.status === 'error')
    return `EarnKit couldn't read ${OWNERSHIP_FILE} in ${repo} (${got.message}). ${AGAIN}`;
  const file = got.status === 'ok' ? parseOwnershipFile(got.text) : null;
  if (!file)
    return (
      `A coin needs proof you can push to ${repo}: add a file named ${OWNERSHIP_FILE} at its root ` +
      `(default branch) with the line "${line}", push it, then ${SAY}.`
    );
  const sym = legacy?.symbol.toUpperCase();
  const ok =
    file.codes.some((c) => sameCode(c, code)) ||
    (legacy !== null &&
      file.tokens.some((t) => t.symbol === sym && t.code !== null && sameCode(t.code, legacy.code)));
  return ok
    ? null
    : `Add the line "${line}" to ${OWNERSHIP_FILE} at the repo root (default branch), push it, then ${SAY}.`;
}

/** Ruling 3 (plan): a public repo with real code, or why not. Pure. */
export function codeProblem(f: RepoCode): string | null {
  if (!f.hasCommits) return `The repo has no commits yet. Push the project's code, then ${SAY}.`;
  if (f.fork && !(f.aheadOfParent && f.aheadOfParent > 0))
    return `The repo is a fork with no new commits; a coin needs your own code. Push your own commits to it, then ${SAY}.`;
  return null;
}

/**
 * Whether a recorded project may get a coin (v2.6 §3): the program allows tokens, the public GitHub
 * repo has real code (Ruling 3 (plan)), its earnkit.txt carries this agent's `token: <code>` line
 * for the repo (or a v2.5 line for this ticker), and the creator wallet isn't sanctioned. A live link
 * is no longer required. Stops at the first failure; never cached.
 */
export async function tokenGate(input: GateInput, deps: GateDeps = {}): Promise<GateResult> {
  const d = { ...defaults, ...deps };
  if (input.policy === 'off') return { ok: false, reason: "This program doesn't allow tokens for entries." };
  const gh = input.repoUrl ? githubRepo(input.repoUrl) : null;
  if (!gh || !input.repoUrl)
    return { ok: false, reason: `A coin needs the project's public GitHub repo. Share its link, then ${SAY}.` };
  let facts: RepoCode;
  try {
    facts = await d.repo(gh.owner, gh.repo);
  } catch (err) {
    if (err instanceof ForkCheckError)
      return { ok: false, reason: `EarnKit couldn't check the fork's commits on GitHub right now. ${AGAIN}` };
    return /not found/.test(msg(err))
      ? { ok: false, reason: `The repo ${gh.owner}/${gh.repo} isn't public on GitHub. Make it public, then ${SAY}.` }
      : { ok: false, reason: `EarnKit couldn't check the repo on GitHub right now. ${AGAIN}` };
  }
  const noCode = codeProblem(facts);
  if (noCode) return { ok: false, reason: noCode };
  const code = tokenCode(input.installationId, input.repoUrl);
  if (!code) return { ok: false, reason: TOKENS_NOT_CONFIGURED };
  const legacyCode = legacyTokenLineCode(input.installationId, input.repoUrl, input.symbol);
  const problem = ownerProblem(
    `github.com/${gh.owner}/${gh.repo}`,
    await d.owner(gh),
    code,
    legacyCode ? { symbol: input.symbol.toUpperCase(), code: legacyCode } : null,
  );
  if (problem) return { ok: false, reason: problem };
  try {
    await d.screen(input.wallet);
  } catch (err) {
    return { ok: false, reason: `creator wallet: ${msg(err)}` };
  }
  return { ok: true };
}
