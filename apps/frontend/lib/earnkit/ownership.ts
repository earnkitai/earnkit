import { FETCH_MAX_BYTES, FETCH_TIMEOUT_MS } from './safe-fetch';
import { EntryError, blockscout, githubRepo } from './campaigns';
import { GitHubError, repoByName } from './match-projects';

/** Re-exported for callers that already import it from here (ownership.test.ts, token-gate.ts). */
export { githubRepo };

/**
 * Proof that a campaign entry belongs to the person entering it (v2.2 §1 Builders; audits H2/F1).
 * The repo (public GitHub) has `earnkit.txt` at its root on the default branch:
 *
 *   payout_wallet: 0x…
 *
 * The file's wallet must equal the entry's payout_wallet. Each entered contract must have been
 * deployed by a transaction sent from that wallet (Base Blockscout: the address's
 * `creation_transaction_hash`, then that transaction's `from`), which covers direct and
 * factory/CREATE2 deploys alike. v2.4 §2: a contract deployed from another wallet (the agent's own)
 * counts when that wallet signed the entry message (entry-proof.ts, deployer_signature); the signer
 * is matched to the creation transaction's sender, never to Blockscout's creator_address_hash (the
 * factory, for factory deploys). A `contracts:` line (v2.2 drafts) is accepted but ignored: listing
 * a contract proves nothing. Only someone who can push to the repo can write the file, and only the
 * deployer's wallet can claim a contract, so a squatter can't take someone else's repo slot or
 * contract.
 *
 * Copied work is only partly covered: forks are refused (GitHub `fork: true`), a live link enters
 * once per campaign, and the sponsor sees when the repo was created. A non-fork clone of someone
 * else's project with a different live link still enters (spec §1, residual risk).
 */

export const OWNERSHIP_FILE = 'earnkit.txt';
const RAW_GITHUB = 'https://raw.githubusercontent.com';

/**
 * Where earnkit.txt is read from: raw.githubusercontent.com, or EARNKIT_OWNERSHIP_BASE_URL when
 * NODE_ENV is exactly `development` or `test` (the e2e serves files locally); refused otherwise.
 */
export function ownershipBaseUrl(
  env: Record<string, string | undefined> = process.env,
) {
  const override = env.EARNKIT_OWNERSHIP_BASE_URL;
  if (!override) return RAW_GITHUB;
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test')
    throw new Error(
      'EARNKIT_OWNERSHIP_BASE_URL is for development and tests only (NODE_ENV=development or test); unset it.',
    );
  return override.replace(/\/+$/, '');
}

export const ownershipFileUrl = (
  r: { owner: string; repo: string },
  baseUrl = RAW_GITHUB,
) => `${baseUrl}/${r.owner}/${r.repo}/HEAD/${OWNERSHIP_FILE}`;

export type OwnershipFile = {
  /** Lowercase; null when the file has no payout_wallet line. */
  payoutWallet: string | null;
  /**
   * Lowercase wallets on `creator_wallet:` lines (v2.3): a token creator wallet other than a
   * campaign entry's payout wallet. Campaign checks ignore them.
   */
  creatorWallets: string[];
  /**
   * `token: <SYMBOL> <code>` lines (v2.3 Ruling 17): the symbol uppercased, the code as written
   * (null when the line has none). A launch needs the line for its ticker with the launching
   * agent's code. Since v2.6 only a launch of that ticker still accepts one (Ruling 1 (plan),
   * token-gate.ts legacyTokenLineCode). Campaign checks ignore them.
   */
  tokens: { symbol: string; code: string | null }[];
  /**
   * v2.6 §3: ticker-free `token: <code>` lines, the code lowercase 16-hex (token-gate.ts
   * tokenLineFor). Sixteen hex characters can never be a v2.5 symbol (at most 10). Campaign checks
   * ignore them.
   */
  codes: string[];
  /** 1-based line numbers and what's wrong; the file's text is never echoed. */
  problems: string[];
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Parses earnkit.txt: the `payout_wallet: 0x…` line (key case-insensitive, `#` starts a comment),
 * plus `creator_wallet: 0x…` and `token: <SYMBOL> <code>` lines for token launches (v2.3; malformed ones
 * are ignored, never a problem). Every other line is ignored, including `contracts:` (accepted for compatibility, never trusted)
 * and a sponsor's `earnkit-sponsor:` line. Pure; exported for tests.
 */
export function parseOwnershipFile(text: string): OwnershipFile {
  const wallets = new Set<string>();
  const creators = new Set<string>();
  const tokens: OwnershipFile['tokens'] = [];
  const codes: string[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^(payout_wallet|creator_wallet|token)\s*:\s*(.*)$/i.exec(line);
    if (!m) return;
    const key = m[1].toLowerCase();
    const values = m[2].split(/[\s,]+/).filter(Boolean);
    const one = values.length === 1 ? values[0] : null;
    // Only payout_wallet lines can make the file wrong: creator_wallet and token lines are for
    // token launches, and a malformed one is ignored (it never fails a campaign entry).
    if (key === 'token') {
      if (values.length === 1 && /^[0-9a-f]{16}$/i.test(values[0])) {
        codes.push(values[0].toLowerCase());
        return;
      }
      const [symbol, code, ...rest] = values;
      if (
        symbol &&
        /^[A-Za-z0-9]{1,10}$/.test(symbol) &&
        rest.length === 0 &&
        (code === undefined || /^[A-Za-z0-9]{1,64}$/.test(code))
      )
        tokens.push({ symbol: symbol.toUpperCase(), code: code ?? null });
    } else if (key === 'creator_wallet') {
      if (one && ADDRESS.test(one)) creators.add(one.toLowerCase());
    } else if (!one || !ADDRESS.test(one))
      problems.push(`line ${i + 1}: payout_wallet needs one 0x address`);
    else wallets.add(one.toLowerCase());
  });
  if (wallets.size > 1)
    problems.push('payout_wallet appears with different addresses; keep one');
  return {
    payoutWallet: wallets.size === 1 ? [...wallets][0] : null,
    creatorWallets: [...creators],
    tokens,
    codes,
    problems,
  };
}

export type FetchResult =
  | { status: 'ok'; text: string }
  | { status: 'missing' }
  | { status: 'error'; message: string };
export type OwnershipFetcher = (url: string) => Promise<FetchResult>;

/**
 * GETs one small text file: 5 s for the whole fetch, a 4 KB cap, no redirects (a renamed repo must
 * be entered under its current name). The host is fixed (raw.githubusercontent.com) and the path
 * is a validated owner/repo, so no SSRF guard beyond that is needed.
 */
export const fetchOwnershipFile: OwnershipFetcher = async (url) => {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: { accept: 'text/plain', 'user-agent': 'EarnKit-verifier/1' },
    });
    return await readSmallBody(res);
  } catch {
    return fetchFailed(signal);
  }
};

const fetchFailed = (signal: AbortSignal): FetchResult => ({
  status: 'error',
  message: signal.aborted
    ? `no answer within ${FETCH_TIMEOUT_MS / 1000} s`
    : "GitHub couldn't be reached",
});

/**
 * One small text file's answer: 404 is missing, a redirect or any other non-200 is an error, more
 * than 4 KB is an error, else the body as UTF-8. Throws only when reading the body fails (callers
 * turn that into an error).
 */
async function readSmallBody(res: Response): Promise<FetchResult> {
  if (res.status === 404) return { status: 'missing' };
  if (res.status >= 300 && res.status < 400)
    return {
      status: 'error',
      message: "the repo moved; use its current GitHub link",
    };
  if (res.status !== 200)
    return { status: 'error', message: "GitHub didn't answer" };
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > FETCH_MAX_BYTES) return tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  for (;;) {
    const chunk = reader ? await reader.read() : { done: true as const };
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > FETCH_MAX_BYTES) {
      await reader?.cancel().catch(() => {});
      return tooLarge();
    }
    chunks.push(chunk.value);
  }
  return { status: 'ok', text: Buffer.concat(chunks).toString('utf8') };
}

/**
 * v2.6 §3: earnkit.txt through GitHub's contents API with EarnKit's GITHUB_TOKEN (no raw-CDN cache
 * delay after a push). Ruling 14 (plan): raw.githubusercontent.com is read only when the API is
 * rate-limited (rateLimited: primary or secondary); a 404 is missing; a redirect, another status or
 * a network failure is a retryable error. The token is sent, never logged.
 */
export async function fetchOwnershipViaApi(
  r: { owner: string; repo: string },
  deps: { fetch?: typeof fetch; raw?: OwnershipFetcher; token?: string } = {},
): Promise<FetchResult> {
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    const res = await (deps.fetch ?? fetch)(
      `https://api.github.com/repos/${r.owner}/${r.repo}/contents/${OWNERSHIP_FILE}`,
      {
        redirect: 'manual',
        signal,
        headers: {
          Accept: 'application/vnd.github.raw',
          'User-Agent': 'earnkit',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      },
    );
    if (await rateLimited(res))
      return (deps.raw ?? fetchOwnershipFile)(ownershipFileUrl(r));
    return await readSmallBody(res);
  } catch {
    return fetchFailed(signal);
  }
}
/**
 * Whether a GitHub API answer is a rate limit (Ruling 14 (plan), fix round 1): 429; a 403 with
 * x-ratelimit-remaining 0 (primary); or a 403 with retry-after or GitHub's "secondary rate limit" /
 * "abuse" message (secondary). Consumes the body when it says yes.
 */
async function rateLimited(res: Response): Promise<boolean> {
  if (res.status === 429) return cancelled(res);
  if (res.status !== 403) return false;
  if (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')) return cancelled(res);
  const text = await res.text().catch(() => '');
  return /secondary rate limit|abuse/i.test(text.slice(0, FETCH_MAX_BYTES));
}
const cancelled = async (res: Response) => {
  await res.body?.cancel().catch(() => {});
  return true;
};

const tooLarge = (): FetchResult => ({
  status: 'error',
  message: `the file is larger than ${FETCH_MAX_BYTES / 1024} KB`,
});

/**
 * Who deployed a contract: the sender of the transaction that created it. Two Blockscout reads,
 * injectable for tests: the address's creation transaction (null when it has none on record), then
 * that transaction's sender.
 */
export type DeployerLookup = {
  creationTx: (contract: string) => Promise<string | null>;
  txSender: (hash: string) => Promise<string>;
};
export const blockscoutDeployer: DeployerLookup = {
  creationTx: async (contract) =>
    (
      await blockscout<{ creation_transaction_hash?: string | null }>(
        `/api/v2/addresses/${contract}`,
      )
    ).creation_transaction_hash ?? null,
  txSender: async (hash) =>
    (
      await blockscout<{ from: { hash: string } }>(
        `/api/v2/transactions/${hash}`,
      )
    ).from.hash,
};

/** The deployer of `contract` (lowercase), or null when no creation transaction is on record. */
export async function deployerOf(contract: string, lookup: DeployerLookup) {
  const tx = await lookup.creationTx(contract);
  return tx ? (await lookup.txSender(tx)).toLowerCase() : null;
}

/** The exact line the builder should have in earnkit.txt. */
const wantedLine = (wallet: string) => `"payout_wallet: ${wallet}"`;

/** What GitHub says about the repo; injectable for tests and the e2e. */
export type RepoFacts = {
  fork: boolean;
  created_at: string;
  pushed_at: string;
};
export type RepoFactsLookup = (
  owner: string,
  repo: string,
) => Promise<RepoFacts>;
export const githubRepoFacts: RepoFactsLookup = (owner, repo) =>
  repoByName(`${owner}/${repo}`);

export const FORK_REFUSED = "Forks can't be entered; enter the original repo.";

export type OwnershipInput = {
  repoUrl: string;
  /** Lowercase. */
  payoutWallet: string;
  /** Lowercase. */
  contracts: string[];
  /** v2.4 §2: the wallet that signed the entry message (deployer_signature), lowercase. */
  signer?: string | null;
};

/**
 * The decision once the file is read: why the entry isn't proven, or an empty list. A file problem
 * is the only problem; otherwise every contract not proven is listed. A contract is proven when
 * its deployer (the creation transaction's sender) is the payout wallet or the wallet that signed
 * the entry (`entry.signer`, v2.4 §2). `deployers` holds the deployer of each entered contract
 * (null = no creation transaction on record, undefined = the lookup failed). Pure; exported for tests.
 */
export function ownershipProblems(
  where: { repo: string; fileUrl: string },
  file: OwnershipFile | null,
  entry: Omit<OwnershipInput, 'repoUrl'>,
  deployers: Record<string, string | null | undefined> = {},
): string[] {
  const add = `Add a file named ${OWNERSHIP_FILE} at the root of ${where.repo} on its default branch with the line `;
  const again = ', push it, then call record_submission again';
  if (!file)
    return [
      `repo_url: EarnKit needs proof you own ${where.repo}: no ${OWNERSHIP_FILE} found at ${where.fileUrl} ` +
      `(the repo must be public). ${add}${wantedLine(entry.payoutWallet)}${again}. ` +
      'A just-pushed file can take a few minutes to appear.',
    ];
  if (file.problems.length)
    return [
      `repo_url: ${OWNERSHIP_FILE} in ${where.repo} has a problem (${file.problems.join('; ')}). ` +
      `It should contain ${wantedLine(entry.payoutWallet)}.`,
    ];
  if (!file.payoutWallet)
    return [
      `repo_url: ${OWNERSHIP_FILE} in ${where.repo} has no payout_wallet line. ${add}${wantedLine(entry.payoutWallet)}${again}.`,
    ];
  if (file.payoutWallet !== entry.payoutWallet)
    return [
      `payout_wallet: ${OWNERSHIP_FILE} in ${where.repo} says payout_wallet: ${file.payoutWallet}, not ${entry.payoutWallet}. ` +
      `Enter with the wallet in the file, or (if the builder owns the repo) change that line to ` +
      `"payout_wallet: ${entry.payoutWallet}"${again}.`,
    ];
  const problems: string[] = [];
  for (const c of entry.contracts) {
    const d = deployers[c];
    if (d === undefined)
      problems.push(`contracts: EarnKit couldn't read who deployed ${c} from Base's explorer. Try again in a minute.`);
    else if (d !== entry.payoutWallet && !(entry.signer && d === entry.signer))
      problems.push(
        entry.signer
          ? `Contract ${c} was deployed by ${d ?? 'an unknown wallet'}, not by the wallet that signed the entry (${entry.signer}) or the payout wallet.`
          : `Contract ${c} was deployed by ${d ?? 'an unknown wallet'}, not by your payout wallet.`,
      );
  }
  return problems;
}

/** The first ownership problem, or null (kept for existing callers and tests). Pure. */
export const ownershipProblem = (...a: Parameters<typeof ownershipProblems>) =>
  ownershipProblems(...a)[0] ?? null;

/**
 * Checks that the entry's repo is a public, non-fork GitHub repo carrying earnkit.txt naming its
 * payout wallet, and that every contract was deployed by a transaction from that wallet (or from
 * the wallet that signed the entry, `input.signer`). Throws EntryError listing what to fix. Returns the repo's GitHub dates (shown to the sponsor) and
 * each contract's deployer. `repoFacts`, `fetchFile` and `deployer` are injectable for tests and
 * the e2e.
 */
export async function checkOwnership(
  input: OwnershipInput,
  {
    fetchFile = fetchOwnershipFile,
    deployer = blockscoutDeployer,
    repoFacts = githubRepoFacts,
    baseUrl = ownershipBaseUrl(),
  }: {
    fetchFile?: OwnershipFetcher;
    repoFacts?: RepoFactsLookup;
    deployer?: DeployerLookup;
    baseUrl?: string;
  } = {},
) {
  const gh = githubRepo(input.repoUrl);
  if (!gh)
    throw new EntryError(
      'repo_url: campaign entries need a public GitHub repo (https://github.com/<owner>/<repo>), so ' +
        `EarnKit can check you own it through its ${OWNERSHIP_FILE}.`,
    );
  const where = {
    repo: `github.com/${gh.owner}/${gh.repo}`,
    fileUrl: ownershipFileUrl(gh, baseUrl),
  };
  let facts: RepoFacts;
  try {
    facts = await repoFacts(gh.owner, gh.repo);
  } catch (err) {
    if (err instanceof GitHubError && /not found/.test(err.message))
      throw new EntryError(
        `repo_url: GitHub doesn't show ${where.repo}; campaign entries need a public repo.`,
      );
    console.error('[ownership] GitHub repo read failed:', err);
    throw new EntryError(
      `repo_url: EarnKit couldn't read ${where.repo} from GitHub. Try again in a minute.`,
    );
  }
  if (facts.fork) throw new EntryError(FORK_REFUSED);
  const got = await fetchFile(where.fileUrl);
  if (got.status === 'error')
    throw new EntryError(
      `repo_url: EarnKit couldn't read ${where.fileUrl} (${got.message}). Try again in a minute.`,
    );
  const file = got.status === 'ok' ? parseOwnershipFile(got.text) : null;
  const deployers: Record<string, string | null | undefined> = {};
  // Blockscout is asked about the contracts only once the file names this wallet.
  if (file?.payoutWallet === input.payoutWallet && !file.problems.length)
    for (const c of input.contracts)
      deployers[c] = await deployerOf(c, deployer).catch((err) => {
        console.error('[ownership] deployer lookup failed:', err);
        return undefined;
      });
  const problems = ownershipProblems(where, file, input, deployers);
  if (problems.length) throw EntryError.of(problems);
  return {
    ...where,
    repo_created_at: new Date(facts.created_at),
    repo_pushed_at: new Date(facts.pushed_at),
    deployers: deployers as Record<string, string>,
  };
}
