import { githubRepo } from './ownership';
import { repoByName, repoHasCommits } from './match-projects';
import type { TokenPolicy } from './program-file';
import { safeProbe } from './safe-fetch';
import { BASE_MAINNET, screenWallet } from './sanctions';

export type GateInput = {
  policy: TokenPolicy;
  repoUrl: string | null;
  liveUrl: string | null;
  wallet: string;
};
export type GateDeps = {
  repo?: (owner: string, repo: string) => Promise<{ fork: boolean; hasCommits: boolean }>;
  probe?: (url: string) => Promise<void>;
  screen?: (wallet: string) => Promise<void>;
};
export type GateResult = { ok: true } | { ok: false; reason: string };

const defaults: Required<GateDeps> = {
  repo: async (owner, repo) => {
    const r = await repoByName(`${owner}/${repo}`);
    return { fork: r.fork, hasCommits: await repoHasCommits(`${owner}/${repo}`) };
  },
  probe: (url) => safeProbe(url),
  screen: (wallet) => screenWallet(wallet, BASE_MAINNET, "This wallet can't receive token fees on EarnKit."),
};

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const RETRY = " Fix it and say 'launch the token'.";

/**
 * Whether a recorded project may get a token (v2.3 §3): the program allows tokens, the public
 * GitHub repo exists with commits and isn't a fork, the live link loads, and the creator wallet
 * isn't sanctioned. Stops at the first failure; never cached.
 */
export async function tokenGate(input: GateInput, deps: GateDeps = {}): Promise<GateResult> {
  const d = { ...defaults, ...deps };
  if (input.policy === 'off') return { ok: false, reason: "This program doesn't allow tokens for entries." };
  const gh = input.repoUrl ? githubRepo(input.repoUrl) : null;
  if (!gh) return { ok: false, reason: 'A token needs the project\'s public GitHub repo (repo_url).' + RETRY };
  try {
    const facts = await d.repo(gh.owner, gh.repo);
    if (facts.fork) return { ok: false, reason: "The repo is a fork; tokens are for original projects." };
    if (!facts.hasCommits) return { ok: false, reason: 'The repo has no commits yet.' + RETRY };
  } catch (err) {
    return /not found/.test(msg(err))
      ? { ok: false, reason: `The repo ${gh.owner}/${gh.repo} isn't public on GitHub.` + RETRY }
      : { ok: false, reason: "EarnKit couldn't check the repo on GitHub right now. Say 'launch the token' to retry." };
  }
  if (!input.liveUrl) return { ok: false, reason: 'There is no live link. A token needs a project that runs: add live_url and say \'launch the token\'.' };
  try {
    await d.probe(input.liveUrl);
  } catch (err) {
    return { ok: false, reason: `The live link didn't load (${msg(err)}).` + RETRY };
  }
  try {
    await d.screen(input.wallet);
  } catch (err) {
    return { ok: false, reason: `creator wallet: ${msg(err)}` };
  }
  return { ok: true };
}
