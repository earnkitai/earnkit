import {
  OWNERSHIP_FILE,
  fetchOwnershipFile,
  githubRepo,
  ownershipBaseUrl,
  ownershipFileUrl,
  parseOwnershipFile,
  type FetchResult,
} from './ownership';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeRepoUrl } from './campaigns';
import { repoByName, repoHasCommits } from './match-projects';
import type { TokenPolicy } from './program-file';
import { safeProbe } from './safe-fetch';
import { BASE_MAINNET, screenWallet } from './sanctions';

export type GateInput = {
  policy: TokenPolicy;
  repoUrl: string | null;
  liveUrl: string | null;
  wallet: string;
  /** The ticker being launched: earnkit.txt must carry `token: <SYMBOL> <code>` for it. */
  symbol: string;
  /** The launching agent: the token line's code is bound to it (tokenLineFor). */
  installationId: number;
  /**
   * A campaign entry's payout wallet, proven by earnkit.txt at entry: a creator wallet equal to it
   * counts as named. The file is still read for the token line. Null for other programs.
   */
  provenWallet?: string | null;
};
export type GateDeps = {
  repo?: (owner: string, repo: string) => Promise<{ fork: boolean; hasCommits: boolean }>;
  /** Reads the repo's earnkit.txt (raw.githubusercontent.com, or the dev/test override). */
  owner?: (r: { owner: string; repo: string }) => Promise<FetchResult>;
  probe?: (url: string) => Promise<void>;
  screen?: (wallet: string) => Promise<void>;
};
export type GateResult = { ok: true } | { ok: false; reason: string };

const defaults: Required<GateDeps> = {
  repo: async (owner, repo) => {
    const r = await repoByName(`${owner}/${repo}`);
    return { fork: r.fork, hasCommits: await repoHasCommits(`${owner}/${repo}`) };
  },
  owner: (r) => fetchOwnershipFile(ownershipFileUrl(r, ownershipBaseUrl())),
  probe: (url) => safeProbe(url),
  screen: (wallet) => screenWallet(wallet, BASE_MAINNET, "This wallet can't receive token fees on EarnKit."),
};

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const RETRY = " Fix it and say 'launch the token'.";

export const TOKENS_NOT_CONFIGURED = "Token launches aren't configured right now.";

/**
 * The code on a launch's earnkit.txt line (v2.3 Ruling 17): the first 10 hex characters of
 * HMAC-SHA256(EARNKIT_AUTH_SECRET, "token-line:<installation>:<normalized repo>:<SYMBOL>"). Only
 * the launching agent is shown it, so a line copied from someone's public file is useless to
 * anyone else. Null when the secret is unset (launches then fail closed). Exported for tests.
 */
export function tokenLineCode(
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

/** The exact earnkit.txt line this agent's launch of `symbol` from `repoUrl` needs, or null (no secret). */
export function tokenLineFor(installationId: number, repoUrl: string, symbol: string): string | null {
  const code = tokenLineCode(installationId, repoUrl, symbol);
  return code && `token: ${symbol.toUpperCase()} ${code}`;
}

const sameCode = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Why the repo's earnkit.txt doesn't prove this launch, or null (v2.3 Rulings 12 and 17). The file
 * must name the creator wallet (its `payout_wallet:` line, a `creator_wallet:` line, or — for a
 * campaign entry — the payout wallet proven at entry) AND carry `token: <SYMBOL> <code>` with the
 * launching agent's code (`code`, from tokenLineCode): a line only someone who can push to the repo
 * can add, and only for the agent EarnKit showed it to. Symbol case-insensitive, code exact
 * (compared timing-safely). Pure; exported for tests.
 */
export function ownerProblem(
  repo: string,
  got: FetchResult,
  wallet: string,
  symbol: string,
  code: string,
  provenWallet: string | null = null,
): string | null {
  const w = wallet.toLowerCase();
  const sym = symbol.toUpperCase();
  if (got.status === 'error')
    return `EarnKit couldn't read ${OWNERSHIP_FILE} in ${repo} (${got.message}). Say 'launch the token' to retry.`;
  const file = got.status === 'ok' ? parseOwnershipFile(got.text) : null;
  // The wallet goes on payout_wallet unless that line is (or must stay) another wallet.
  const otherPayout =
    (file?.payoutWallet && file.payoutWallet !== w) || (provenWallet && provenWallet !== w);
  const walletLine = otherPayout ? `creator_wallet: ${wallet}` : `payout_wallet: ${wallet}`;
  const tokenLine = `token: ${sym} ${code}`;
  const where = `to ${OWNERSHIP_FILE} at the repo root (default branch), then call launch_token.`;
  if (!file)
    return (
      `A token needs proof the builder owns ${repo}: add a file named ${OWNERSHIP_FILE} at its root ` +
      `(default branch) with the lines "${walletLine}" and "${tokenLine}", push it, then call launch_token. ` +
      'A just-pushed file can take a few minutes to appear.'
    );
  if (file.problems.length)
    return `${OWNERSHIP_FILE} in ${repo} has a problem (${file.problems.join('; ')}). Fix it, then call launch_token.`;
  const walletOk = file.payoutWallet === w || file.creatorWallets.includes(w) || provenWallet === w;
  const tokenOk = file.tokens.some((t) => t.symbol === sym && t.code !== null && sameCode(t.code, code));
  if (!walletOk)
    return (
      `${OWNERSHIP_FILE} in ${repo} doesn't name the creator wallet ${wallet}. Launch with the wallet the ` +
      `file names, or (if the builder owns the repo) add the line "${walletLine}"` +
      `${tokenOk ? '' : ` and the line "${tokenLine}"`} ${where}`
    );
  if (!tokenOk) return `Add the line "${tokenLine}" ${where}`;
  return null;
}

/**
 * Whether a recorded project may get a token (v2.3 §3): the program allows tokens, the public
 * GitHub repo exists with commits and isn't a fork, its earnkit.txt names the creator wallet and
 * carries `token: <SYMBOL> <code>` for this ticker and agent, the live link loads, and the creator wallet isn't
 * sanctioned. Stops at the first failure; never cached.
 */
export async function tokenGate(input: GateInput, deps: GateDeps = {}): Promise<GateResult> {
  const d = { ...defaults, ...deps };
  if (input.policy === 'off') return { ok: false, reason: "This program doesn't allow tokens for entries." };
  const gh = input.repoUrl ? githubRepo(input.repoUrl) : null;
  if (!gh)
    return { ok: false, reason: "A token needs the project's public GitHub repo: call launch_token with repo_url." };
  try {
    const facts = await d.repo(gh.owner, gh.repo);
    if (facts.fork) return { ok: false, reason: "The repo is a fork; tokens are for original projects." };
    if (!facts.hasCommits) return { ok: false, reason: 'The repo has no commits yet.' + RETRY };
  } catch (err) {
    return /not found/.test(msg(err))
      ? { ok: false, reason: `The repo ${gh.owner}/${gh.repo} isn't public on GitHub.` + RETRY }
      : { ok: false, reason: "EarnKit couldn't check the repo on GitHub right now. Say 'launch the token' to retry." };
  }
  const code = tokenLineCode(input.installationId, input.repoUrl!, input.symbol);
  if (!code) return { ok: false, reason: TOKENS_NOT_CONFIGURED };
  const problem = ownerProblem(
    `github.com/${gh.owner}/${gh.repo}`,
    await d.owner(gh),
    input.wallet,
    input.symbol,
    code,
    input.provenWallet?.toLowerCase() ?? null,
  );
  if (problem) return { ok: false, reason: problem };
  if (!input.liveUrl)
    return { ok: false, reason: 'There is no live link. A token needs a project that runs: call launch_token with live_url.' };
  try {
    await d.probe(input.liveUrl);
  } catch (err) {
    return { ok: false, reason: `The live link didn't load (${msg(err)}). Fix it, or call launch_token with live_url.` };
  }
  try {
    await d.screen(input.wallet);
  } catch (err) {
    return { ok: false, reason: `creator wallet: ${msg(err)}` };
  }
  return { ok: true };
}
