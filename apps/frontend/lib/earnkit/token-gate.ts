import {
  OWNERSHIP_FILE,
  fetchOwnershipFile,
  githubRepo,
  ownershipBaseUrl,
  ownershipFileUrl,
  parseOwnershipFile,
  type FetchResult,
} from './ownership';
import { repoByName, repoHasCommits } from './match-projects';
import type { TokenPolicy } from './program-file';
import { safeProbe } from './safe-fetch';
import { BASE_MAINNET, screenWallet } from './sanctions';

export type GateInput = {
  policy: TokenPolicy;
  repoUrl: string | null;
  liveUrl: string | null;
  wallet: string;
  /**
   * A campaign entry's payout wallet: its earnkit.txt was proven at entry, so a creator wallet
   * equal to it needs no second read. Null for other programs.
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

/**
 * Why the repo's earnkit.txt doesn't prove the creator wallet, or null (v2.3 Ruling 12). The file
 * must name the wallet on its `payout_wallet:` line or on a `creator_wallet:` line (for a campaign
 * entry whose payout wallet differs). Pure; exported for tests.
 */
export function ownerProblem(
  repo: string,
  got: FetchResult,
  wallet: string,
  provenWallet: string | null = null,
): string | null {
  const w = wallet.toLowerCase();
  // A campaign entry keeps payout_wallet for the prize; another creator wallet goes on its own line.
  const line = provenWallet && provenWallet !== w ? `creator_wallet: ${wallet}` : `payout_wallet: ${wallet}`;
  const add = `add a file named ${OWNERSHIP_FILE} at the root of ${repo} (default branch) with the line "${line}", push it, and say 'launch the token'.`;
  if (got.status === 'error')
    return `EarnKit couldn't read ${OWNERSHIP_FILE} in ${repo} (${got.message}). Say 'launch the token' to retry.`;
  if (got.status === 'missing')
    return `A token needs proof the builder owns ${repo}: ${add} A just-pushed file can take a few minutes to appear.`;
  const file = parseOwnershipFile(got.text);
  if (file.problems.length)
    return `${OWNERSHIP_FILE} in ${repo} has a problem (${file.problems.join('; ')}). It should contain "${line}".`;
  if (file.payoutWallet === w || file.creatorWallets.includes(w)) return null;
  return `${OWNERSHIP_FILE} in ${repo} doesn't name the creator wallet ${wallet}. Launch with the wallet the file names, or (if the builder owns the repo) ${add}`;
}

/**
 * Whether a recorded project may get a token (v2.3 §3): the program allows tokens, the public
 * GitHub repo exists with commits and isn't a fork, its earnkit.txt names the creator wallet, the
 * live link loads, and the creator wallet isn't sanctioned. Stops at the first failure; never cached.
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
  const proven = input.provenWallet?.toLowerCase() ?? null;
  if (proven !== input.wallet.toLowerCase()) {
    const problem = ownerProblem(`github.com/${gh.owner}/${gh.repo}`, await d.owner(gh), input.wallet, proven);
    if (problem) return { ok: false, reason: problem };
  }
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
