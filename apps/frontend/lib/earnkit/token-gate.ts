import { githubRepo } from './ownership';
import { ForkCheckError, repoCodeFacts, type RepoCode } from './match-projects';
import type { TokenPolicy } from './program-file';
import { BASE_MAINNET, screenWallet } from './sanctions';
import { appTokenFor } from './github-app';
import { markRepoPublic } from './repo-cache';
import { sharedGroup } from './installations';
import { rootOf } from './identity';
import { installLink, repoProof } from './repo-proof';

export type GateInput = {
  policy: TokenPolicy;
  repoUrl: string | null;
  /** The creator wallet: screened for sanctions only (v2.6 §3: earnkit.txt no longer names it). */
  wallet: string;
  /** The ticker being launched (kept for the callers' records; v2.14: no proof line names it). */
  symbol: string;
  /** The launching agent's installation (the person is its group root). */
  installationId: number;
  /** The entry launching. */
  projectId?: number;
};
export type GateDeps = {
  /**
   * The repo's code facts (Ruling 3 (plan)); throws GitHub's error for a missing/private repo.
   * v2.10 item 7b: with `token` (a read-only App installation token) a private repo is read.
   */
  repo?: (owner: string, repo: string, token?: string) => Promise<RepoCode>;
  /**
   * v2.10 item 7b (R9): an installation token for the repo (lowercase owner/repo) when GitHub won't
   * show it publicly and this builder proved it with the read-only App, else null. Defaults to
   * github-app.ts appTokenFor for the gate's installation and login (null while the App is off).
   */
  appToken?: (repoKey: string) => Promise<string | null>;
  /** v2.14 spec 2: the App's install link for this repo (repo-proof.ts installLink), else null (the App is off, no page). */
  appLink?: (repoKey: string) => Promise<string | null>;
  screen?: (wallet: string) => Promise<void>;
  /**
   * Ruling G10 (fix round 2): whether the launching installation's group is a shared (hosted) client,
   * read here so no caller can forget it. A failed read is shared (fails closed).
   */
  shared?: (installationId: number) => Promise<boolean>;
  /**
   * v2.14 spec 2: whether the repo (lowercase owner/repo) is proven by the read-only App (or verified before
   * v2.14). `login`: undefined off a shared client (the person's repoProof); null: a shared client, which has no
   * person and so no proof (Ruling T6-2). Fails closed.
   */
  appProven?: (installationId: number, repoKey: string, login: string | null | undefined) => Promise<boolean>;
};

/**
 * `reason`: plain builder words. `agent_note` (M7): the technical detail, for the agent only.
 * `fixable` (v2.8 Ruling 4 (plan)): the agent can fix it now and try again (the App not installed yet,
 * a transient GitHub read, a wallet the screen refused); absent for a lasting problem (no repo, no
 * real code, launches not configured, tokens off).
 */
export type GateResult =
  /** v2.10 R10 (Pre-flight P4): `private`: the repo was read through the App (it isn't public). */
  | { ok: true; private?: true }
  | { ok: false; reason: string; agent_note?: string; fixable?: true };

const defaults: Required<Pick<GateDeps, 'repo' | 'screen' | 'shared' | 'appProven'>> = {
  repo: async (o, r, token) => {
    const facts = await repoCodeFacts(`${o}/${r}`, { token });
    // v2.10 Ruling H6: GitHub said the repo is public (no App token): public pages may show its URL.
    if (facts.public) await markRepoPublic(`${o}/${r}`);
    return facts;
  },
  screen: (wallet) => screenWallet(wallet, BASE_MAINNET, "This wallet can't receive token fees on EarnKit."),
  shared: (installationId) => sharedGroup(installationId),
  appProven: async (installationId, repoKey, login) =>
    login === undefined && (await repoProof(await rootOf(installationId), repoKey, undefined, { forAction: true })).ok,
};

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** The one retry form in every reason: the builder says it, the agent calls launch_token. */
const SAY = "say 'launch the token'";
const AGAIN = `Try again in a minute: ${SAY}.`;
export const TOKENS_NOT_CONFIGURED = "Token launches aren't configured right now.";
/** v2.14 spec 2: the reason a coin waits for the App, with its install link. */
export const appInstallReason = (repo: string, link: string) =>
  `EarnKit counts ${repo} once the read-only EarnKit app is installed on it (one click): ${link} Then ${SAY}.`;

/** Ruling 3 (plan): a public repo with real code, or why not. Pure. */
export function codeProblem(f: RepoCode): string | null {
  if (!f.hasCommits) return `The repo has no commits yet. Push the project's code, then ${SAY}.`;
  if (f.fork && !(f.aheadOfParent && f.aheadOfParent > 0))
    return `The repo is a fork with no new commits; a token needs your own code. Push your own commits to it, then ${SAY}.`;
  return null;
}

/**
 * Whether a recorded project may get a coin (v2.6 §3, v2.14 spec 2): the program allows tokens, the GitHub
 * repo has real code (Ruling 3 (plan)), the repo is proven by the read-only GitHub App (repo-proof.ts; a
 * source verified before v2.14 stays proven), and the creator wallet isn't sanctioned. Stops at the first
 * failure; never cached.
 */
export async function tokenGate(input: GateInput, deps: GateDeps = {}): Promise<GateResult> {
  const d = { ...defaults, ...deps };
  if (input.policy === 'off') return { ok: false, reason: "This program doesn't allow tokens for entries." };
  const gh = input.repoUrl ? githubRepo(input.repoUrl) : null;
  if (!gh || !input.repoUrl)
    return { ok: false, reason: `A token needs the project's GitHub repo. Share its link, then ${SAY}.` };
  // Ruling G10 (fix round 2), T6-2: a shared client is known here too and has no person, so no App proof
  // counts there (login null). A failed read fails closed.
  let who: { shared: boolean; login: null | undefined } | null = null;
  const whoIs = async () => {
    if (who) return who;
    const shared = await d.shared(input.installationId).catch(() => true);
    who = { shared, login: shared ? null : undefined };
    return who;
  };
  const repoKey = `${gh.owner}/${gh.repo}`.toLowerCase();
  const link = async () => (d.appLink ?? defaultAppLink(input))(repoKey).catch(() => null);
  const installAsk = async (): Promise<GateResult> => {
    const l = await link();
    return l
      ? { ok: false, reason: appInstallReason(`${gh.owner}/${gh.repo}`, l), fixable: true }
      : { ok: false, reason: `EarnKit can count ${gh.owner}/${gh.repo} once the read-only EarnKit app is installed on it. Then ${SAY}.` };
  };
  let facts: RepoCode;
  // v2.10 item 7b (R9): set when the repo is read through the builder's read-only App installation.
  let token: string | undefined;
  try {
    facts = await d.repo(gh.owner, gh.repo);
  } catch (err) {
    if (err instanceof ForkCheckError)
      return { ok: false, reason: `EarnKit couldn't check the fork's commits on GitHub right now. ${AGAIN}`, fixable: true };
    if (!/not found/.test(msg(err))) return { ok: false, reason: `EarnKit couldn't check the repo on GitHub right now. ${AGAIN}`, fixable: true };
    const { login } = await whoIs();
    token =
      (await (d.appToken ?? ((k: string) => appTokenFor({ installationId: input.installationId, login, repoKey: k })))(repoKey).catch(
        () => null,
      )) ?? undefined;
    try {
      if (!token) throw err;
      facts = await d.repo(gh.owner, gh.repo, token);
    } catch (err2) {
      if (err2 instanceof ForkCheckError)
        return { ok: false, reason: `EarnKit couldn't check the fork's commits on GitHub right now. ${AGAIN}`, fixable: true };
      if (token && !/not found/.test(msg(err2)))
        return { ok: false, reason: `EarnKit couldn't check the repo on GitHub right now. ${AGAIN}`, fixable: true };
      // A repo EarnKit can't see (private, or an org's): the App is the way to read it and to prove it.
      return installAsk();
    }
  }
  const noCode = codeProblem(facts);
  if (noCode) return { ok: false, reason: noCode };
  // v2.14 spec 2: the App is the only proof. Off a shared client: this person's App-proven (or kept) repo.
  // A shared client (Ruling T6-2): none.
  const { login } = await whoIs();
  const proven = await d.appProven(input.installationId, repoKey, login).catch(() => false);
  if (!proven) return installAsk();
  try {
    await d.screen(input.wallet);
  } catch (err) {
    return { ok: false, reason: `creator wallet: ${msg(err)}`, fixable: true };
  }
  return token ? { ok: true, private: true } : { ok: true };
}

/** v2.14 spec 2: the App's install link for this repo (repo-proof.ts installLink), or null while the App is off or the person has no page. */
const defaultAppLink = (input: GateInput) => async (repoKey: string) => installLink(await rootOf(input.installationId), repoKey, new Date());

declare const provenRepo: unique symbol;
/**
 * v2.14: a repo this person proved with the read-only App, confirmed by GitHub within a day (repo-proof.ts
 * repoProof `forAction`: a source verified before v2.14 counts on the Bench, never for an action), as a value only proveRepo makes, so a caller can't pass a bare "already checked" flag. `owner` is the repo's
 * GitHub owner (lowercase).
 */
export type ProvenRepo = { readonly installationId: number; readonly repoKey: string; readonly owner: string; readonly [provenRepo]: true };

/** v2.14: a repo this person proved with the App (repoProof forAction), as a value only this makes; never on a shared client. Fails closed. */
export async function proveRepo(a: { installationId: number; repoUrl: string }): Promise<ProvenRepo | null> {
  const gh = githubRepo(a.repoUrl);
  if (!gh || (await sharedGroup(a.installationId).catch(() => true))) return null;
  const repoKey = `${gh.owner}/${gh.repo}`.toLowerCase();
  const p = await repoProof(await rootOf(a.installationId), repoKey, undefined, { forAction: true }).catch(() => null);
  return p?.ok ? ({ installationId: a.installationId, repoKey, owner: p.owner } as ProvenRepo) : null;
}
