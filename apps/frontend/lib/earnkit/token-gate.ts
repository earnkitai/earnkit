import {
  OWNERSHIP_FILE,
  fetchOwnershipFile,
  fetchLinePusher,
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
import { createVerifyLink, githubVerifyEnabled, lineIssuedAt, repoEverDerived, verifiedFor } from './github-verify';
import { appTokenFor, githubAppEnabled } from './github-app';
import { markRepoPublic } from './repo-cache';
import { sharedGroup } from './installations';
import { benchEnabled } from './builder-score-flag';
import type { CoinBranchProof, ProofBranch } from './proof-branch';

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
  /**
   * The repo's code facts (Ruling 3 (plan)); throws GitHub's error for a missing/private repo.
   * v2.10 item 7b: with `token` (a read-only App installation token) a private repo is read.
   */
  repo?: (owner: string, repo: string, token?: string) => Promise<RepoCode>;
  /** Reads the repo's earnkit.txt (GitHub contents API, or the dev/test override); through `token` for a private repo. */
  owner?: (r: { owner: string; repo: string }, token?: string) => Promise<FetchResult>;
  /**
   * v2.8.1 §A3: earnkit.txt on the most recently pushed branch other than the default one, read only
   * when the default branch doesn't prove the launch; null when there is none.
   */
  latest?: (
    r: { owner: string; repo: string },
    defaultBranch: string | undefined,
    token?: string,
  ) => Promise<{ branch: string; file: FetchResult } | null>;
  /**
   * v2.10 item 7b (R9): an installation token for the repo (lowercase owner/repo) when GitHub won't
   * show it publicly and this builder proved it with the read-only App, else null. Defaults to
   * github-app.ts appTokenFor for the gate's installation and login (null while the App is off).
   * Read access only: the launch proof below is unchanged (G10, G11).
   */
  appToken?: (repoKey: string) => Promise<string | null>;
  /**
   * v2.10 Pre-flight P17: the "allow read access" link for a repo GitHub won't show, while the App is
   * on (an `app` nonce for this entry, R8), else null.
   */
  appLink?: (repoKey: string) => Promise<string | null>;
  screen?: (wallet: string) => Promise<void>;
  /**
   * v2.9 B9: the GitHub sign-in that proved this entry's repo (owner/repo), with the fee wallet it
   * was made for (Ruling G11), or null; defaults to the github_verifications row, and is null while
   * the feature is off.
   */
  verified?: (projectId: number, repoKey: string, login?: string) => Promise<{ wallet: string | null } | null>;
  /**
   * Ruling G10 (fix round 2): whether the launching installation's group is a shared (hosted) client,
   * read here so no caller can forget it; false while sign-in is off (nothing changes then).
   */
  shared?: (installationId: number) => Promise<boolean>;
  /**
   * v2.13.1 O1 fix rounds 1 and 2 (rulings): under the Bench the repo (lowercase owner/repo) is proven
   * by a proof branch, never an earnkit.txt line (proof-branch.ts coinBranchProof): the proof stands,
   * a branch for the agent to push, or a plain line. Null: flag off or a shared client (today's gate).
   */
  branchProof?: (installationId: number, repoKey: string) => Promise<CoinBranchProof | null>;
};

/**
 * v2.10 item 13 (R19): repoOwnershipPasses' reads: the gate's, plus `repoVerified`, a GitHub sign-in
 * or read-only App proof of this repo on this installation (scoped as verifiedFor: `login`
 * undefined, any; a login, only its). Defaults to the github_verifications rows, each kind only
 * while its feature is on.
 */
export type OwnershipDeps = GateDeps & {
  repoVerified?: (a: { installationId: number; repoKey: string; login?: string }) => Promise<boolean>;
  /**
   * v2.11 T9 security fix (I1): the login GitHub says pushed the line into earnkit.txt (ownership.ts
   * fetchLinePusher: the push's authenticated actor), or null. A test's injected `owner` reader
   * pairs with no pusher unless the test gives one.
   */
  pusher?: (r: { owner: string; repo: string }, hasLine: (text: string) => boolean, issuedAt: Date | null) => Promise<string | null>;
};
const repoVerified = async (a: { installationId: number; repoKey: string; login?: string }) =>
  (githubVerifyEnabled() && (await verifiedFor(a)) !== null) ||
  (githubAppEnabled() && (await verifiedFor({ ...a, purpose: 'app' })) !== null);
/**
 * `reason`: plain builder words. `agent_note` (M7): the technical detail, for the agent only.
 * `fixable` (v2.8 Ruling 4 (plan)): the agent can fix it now and try again (the proof line not
 * pushed or not readable yet, a transient GitHub read, a wallet the screen refused); absent for a
 * lasting problem (no public repo, no real code, launches not configured, tokens off).
 */
export type GateResult =
  /** v2.10 R10 (Pre-flight P4): `private`: the repo was read through the App (it isn't public). */
  | { ok: true; private?: true }
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

const defaults: Omit<Required<GateDeps>, 'appToken' | 'appLink'> = {
  repo: async (o, r, token) => {
    const facts = await repoCodeFacts(`${o}/${r}`, { token });
    // v2.10 Ruling H6: GitHub said the repo is public (no App token): public pages may show its URL.
    if (facts.public) await markRepoPublic(`${o}/${r}`);
    return facts;
  },
  // Ruling 14 (plan): the dev/test override (token-e2e's mock) is read as before; otherwise the
  // contents API, raw only when rate-limited. v2.10 item 7b: through the App's token for a private repo.
  owner: (r, token) =>
    process.env.EARNKIT_OWNERSHIP_BASE_URL
      ? fetchOwnershipFile(ownershipFileUrl(r, ownershipBaseUrl()))
      : fetchOwnershipViaApi(r, { token }),
  // The dev/test override serves the default branch only.
  latest: (r, defaultBranch, token) =>
    process.env.EARNKIT_OWNERSHIP_BASE_URL ? Promise.resolve(null) : fetchOwnershipLatestBranch(r, defaultBranch, { token }),
  screen: (wallet) => screenWallet(wallet, BASE_MAINNET, "This wallet can't receive token fees on EarnKit."),
  verified: async (projectId, repoKey, login) =>
    githubVerifyEnabled() ? verifiedFor({ projectId, repoKey, login }) : null,
  shared: async (installationId) => githubVerifyEnabled() && (await sharedGroup(installationId)),
  branchProof: async (installationId, repoKey) =>
    benchEnabled() && !(await sharedGroup(installationId).catch(() => true))
      ? (await import('./proof-branch')).coinBranchProof(installationId, repoKey, new Date())
      : null,
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

/** v2.13.1 O1 fix round 2: under the Bench the coin's repo is proven by a temporary branch (the builder's line). */
export const coinBranchReason = (repo: string) =>
  `I'll check ${repo} is yours with a quick temporary branch on GitHub. It's removed right after. Then ${SAY}.`;
/** The agent's note with it: push, confirm again, then delete the branch. */
export const coinBranchNote = (p: ProofBranch) =>
  `Run "${p.push}" in the folder of the repo ${p.repo} (a temporary branch at the current commit: no file, no commit), ` +
  `then call confirm with project_id and yes: true. After the launch, delete the branch: "${p.remove}". Never ask the builder to edit files.`;

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
      'and push it yourself; never ask the builder to edit files. Then call confirm with project_id and yes: true.',
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
  // v2.10 item 7b: who this launch is from, as the sign-in and App reads scope it (Ruling G10 below).
  let who: { shared: boolean; login: string | null | undefined } | null = null;
  const whoIs = async () => {
    if (who) return who;
    // Ruling G10 (fix round 2): a shared client is known here too (a caller that passed no login
    // gets none: only a sign-in with the caller's own code counts there). A failed read fails closed.
    const shared = input.verifiedLogin !== undefined || (await d.shared(input.installationId).catch(() => true));
    who = { shared, login: shared ? (input.verifiedLogin ?? null) : undefined };
    return who;
  };
  const repoKey = `${gh.owner}/${gh.repo}`.toLowerCase();
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
      // Pre-flight P17: with the App on, the builder can allow read access instead of going public.
      const link = await (d.appLink ?? defaultAppLink(input))(repoKey).catch(() => null);
      return link
        ? { ok: false, reason: `EarnKit can't see ${gh.owner}/${gh.repo} on GitHub. Allow read access: ${link} Then ${SAY}.`, fixable: true }
        : { ok: false, reason: `The repo ${gh.owner}/${gh.repo} isn't public on GitHub. Make it public, then ${SAY}.` };
    }
  }
  const noCode = codeProblem(facts);
  if (noCode) return { ok: false, reason: noCode };
  const code = tokenCode(input.installationId, input.repoUrl);
  if (!code) return { ok: false, reason: TOKENS_NOT_CONFIGURED };
  // v2.9 B9: a GitHub sign-in that proved this entry's repo stands in for the proof line (the
  // repo's code above and the wallet screen below still run). A failed read is no verification.
  // Ruling G11: only for the fee wallet the owner saw when signing in.
  const { shared, login } = await whoIs();
  const signIn =
    input.projectId !== undefined && login !== null
      ? await d.verified(input.projectId, repoKey, login).catch(() => null)
      : null;
  const signedIn = signIn !== null && signIn.wallet !== null && signIn.wallet === input.wallet.toLowerCase();
  const walletChanged = { ok: false as const, reason: WALLET_CHANGED, fixable: true as const, sign_in: 'wallet_changed' as const };
  // v2.13.1 O1 fix rounds 1 and 2 (rulings): under the Bench a proof branch proves the repo, never a line.
  const branch = !signedIn && !shared ? await d.branchProof?.(input.installationId, repoKey).catch(() => null) : null;
  if (branch && 'line' in branch) return { ok: false, reason: branch.line, fixable: true };
  if (branch && 'proof' in branch) return { ok: false, reason: coinBranchReason(gh.repo), agent_note: coinBranchNote(branch.proof), fixable: true };
  if (!signedIn && !branch) {
    // Ruling G10: on a shared client (verifiedLogin given) the proof line is the whole agent's, so
    // while sign-in is on it never proves a launch there.
    if (shared && githubVerifyEnabled())
      return signIn ? walletChanged : { ok: false, reason: SIGN_IN_FIRST, fixable: true, sign_in: 'needed' };
    const legacyCode = legacyTokenLineCode(input.installationId, input.repoUrl, input.symbol);
    const legacy = legacyCode ? { symbol: input.symbol.toUpperCase(), code: legacyCode } : null;
    const onDefault = await d.owner(gh, token);
    // v2.8.1 §A3: the default branch first; only when it doesn't prove the launch, the most recently
    // pushed other branch (one more GitHub call).
    const latest = proves(onDefault, code, legacy)
      ? null
      : await d.latest(gh, facts.defaultBranch, token).catch(() => null);
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
  return token ? { ok: true, private: true } : { ok: true };
}

/** Pre-flight P17: the App's "allow read access" link for this entry's repo, or null while the App is off. */
const defaultAppLink = (input: GateInput) => async (repoKey: string) =>
  githubAppEnabled()
    ? createVerifyLink({ installationId: input.installationId, projectId: input.projectId ?? null, repoKey, purpose: 'app' })
    : null;

/**
 * v2.11 T9 security fix (I1): who put this installation's `token: <code>` line into the repo's
 * earnkit.txt, as GitHub's push record says (OwnershipDeps.pusher), lowercase; null when it can't
 * be told. Push access is not identity: only this login, when it is the repo's owner, ties the line
 * to the owner. Off a shared client only (the caller decides). Never throws.
 */
export async function proofLineOwner(a: { installationId: number; repoUrl: string }, deps: OwnershipDeps = {}): Promise<string | null> {
  const gh = githubRepo(a.repoUrl);
  const code = gh ? tokenCode(a.installationId, a.repoUrl) : null;
  if (!gh || !code) return null;
  const pusher =
    deps.pusher ??
    (deps.owner ? async () => null : (r: { owner: string; repo: string }, has: (t: string) => boolean, at: Date | null) => fetchLinePusher(r, has, at, { everDerived: repoEverDerived }));
  try {
    const issuedAt = await lineIssuedAt(a.installationId, `${gh.owner}/${gh.repo}`);
    return (await pusher(gh, (text) => proves({ status: 'ok', text }, code, null), issuedAt))?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * v2.11 T9 security fix R3: whether this installation proved `repoKey` by a GitHub sign-in or the
 * read-only App (OwnershipDeps.repoVerified), the v2.10 proofs a deploy keeps as they were.
 */
export async function repoSignedIn(a: { installationId: number; repoKey: string }, deps: OwnershipDeps = {}): Promise<boolean> {
  try {
    return await (deps.repoVerified ?? repoVerified)({ installationId: a.installationId, repoKey: a.repoKey.toLowerCase() });
  } catch {
    return false;
  }
}

declare const provenRepo: unique symbol;
/**
 * v2.11 T9 security fix (M1): a repo this installation just proved (repoOwnershipPasses), and who
 * pushed its proof line (proofLineOwner). Only proveRepo makes one, so a caller can't pass a bare
 * "already checked" flag.
 */
export type ProvenRepo = { readonly installationId: number; readonly repoKey: string; readonly lineOwner: string | null; readonly [provenRepo]: true };

/** repoOwnershipPasses, then proofLineOwner: the proof as a value, or null when it fails. */
export async function proveRepo(a: { installationId: number; repoUrl: string }, deps: OwnershipDeps = {}): Promise<ProvenRepo | null> {
  const gh = githubRepo(a.repoUrl);
  if (!gh || !(await repoOwnershipPasses(a, deps))) return null;
  const lineOwner = await proofLineOwner(a, deps);
  return { installationId: a.installationId, repoKey: `${gh.owner}/${gh.repo}`.toLowerCase(), lineOwner } as ProvenRepo;
}

/**
 * v2.10 item 13 (R19): whether this installation proved `repoUrl` is the builder's, the way a launch
 * does minus the wallet binding: a GitHub sign-in or read-only App proof of the repo (Pre-flight
 * P11: only here and appTokenFor read App rows), else this agent's `token: <code>` proof line in the
 * repo's earnkit.txt (default branch, then the most recently pushed one). Rulings G7, G10: on a
 * shared client (`verifiedLogin` given, or the group is shared while sign-in is on) only the
 * caller's own verified login counts, and the proof line never does. Fails closed; never throws.
 */
export async function repoOwnershipPasses(
  a: { installationId: number; repoUrl: string; verifiedLogin?: string | null },
  deps: OwnershipDeps = {},
): Promise<boolean> {
  const d = { ...defaults, repoVerified, ...(deps.owner && { latest: async () => null }), ...deps };
  const gh = githubRepo(a.repoUrl);
  if (!gh) return false;
  const repoKey = `${gh.owner}/${gh.repo}`.toLowerCase();
  try {
    const shared = a.verifiedLogin !== undefined || (await d.shared(a.installationId).catch(() => true));
    const login = shared ? (a.verifiedLogin ?? null) : undefined;
    if (login !== null && (await d.repoVerified({ installationId: a.installationId, repoKey, ...(login !== undefined && { login }) })))
      return true;
    if (shared && githubVerifyEnabled()) return false;
    const code = tokenCode(a.installationId, a.repoUrl);
    if (!code) return false;
    const onDefault = await d.owner(gh);
    if (proves(onDefault, code, null)) return true;
    const latest = await d.latest(gh, undefined).catch(() => null);
    return latest !== null && proves(latest.file, code, null);
  } catch (err) {
    console.error('[token-gate] repo ownership', err instanceof Error ? err.name : 'error');
    return false;
  }
}
