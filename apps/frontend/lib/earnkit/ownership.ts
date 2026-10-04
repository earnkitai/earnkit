import { FETCH_MAX_BYTES, FETCH_TIMEOUT_MS } from './safe-fetch';
import { EntryError, blockscout, normalizeRepoUrl } from './campaigns';
import { GitHubError, repoByName } from './match-projects';

/**
 * Proof that a campaign entry belongs to the person entering it (v2.2 §1 Builders; audits H2/F1).
 * The repo (public GitHub) has `earnkit.txt` at its root on the default branch:
 *
 *   payout_wallet: 0x…
 *
 * The file's wallet must equal the entry's payout_wallet. Each entered contract must have been
 * deployed by a transaction sent from that wallet (Base Blockscout: the address's
 * `creation_transaction_hash`, then that transaction's `from`), which covers direct and
 * factory/CREATE2 deploys alike. A `contracts:` line (v2.2 drafts) is accepted but ignored: listing
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

/**
 * Owner and repo of a GitHub repo link (as spelled in the link; normalizeRepoUrl decides what a
 * repo link is), or null for anything else. Pure; exported for tests.
 */
export function githubRepo(
  url: string,
): { owner: string; repo: string } | null {
  const key = normalizeRepoUrl(url);
  if (!/^github\.com\/[a-z0-9-]{1,39}\/[a-z0-9._-]{1,100}$/.test(key))
    return null;
  const [, owner, repo] = key.split('/');
  // Wikis are world-editable by default; names of only dots aren't repos.
  if (/^\.+$/.test(repo) || repo.endsWith('.wiki')) return null;
  // The original spelling of the same path, so the raw link keeps its case.
  const m = new RegExp(
    `github\\.com/(${owner})/(${repo.replace(/\./g, '\\.')})`,
    'i',
  ).exec(url);
  return m ? { owner: m[1], repo: m[2] } : { owner, repo };
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
  /** 1-based line numbers and what's wrong; the file's text is never echoed. */
  problems: string[];
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Parses earnkit.txt: the `payout_wallet: 0x…` line (key case-insensitive, `#` starts a comment),
 * and any `creator_wallet: 0x…` lines (a token's creator wallet, v2.3). Every other line is ignored, including `contracts:` (accepted for compatibility, never trusted)
 * and a sponsor's `earnkit-sponsor:` line. Pure; exported for tests.
 */
export function parseOwnershipFile(text: string): OwnershipFile {
  const wallets = new Set<string>();
  const creators = new Set<string>();
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^(payout_wallet|creator_wallet)\s*:\s*(.*)$/i.exec(line);
    if (!m) return;
    const key = m[1].toLowerCase();
    const values = m[2].split(/[\s,]+/).filter(Boolean);
    if (values.length !== 1 || !ADDRESS.test(values[0]))
      problems.push(`line ${i + 1}: ${key} needs one 0x address`);
    else
      (key === 'payout_wallet' ? wallets : creators).add(
        values[0].toLowerCase(),
      );
  });
  if (wallets.size > 1)
    problems.push('payout_wallet appears with different addresses; keep one');
  return {
    payoutWallet: wallets.size === 1 ? [...wallets][0] : null,
    creatorWallets: [...creators],
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
    if (res.status === 404) return { status: 'missing' };
    if (res.status >= 300 && res.status < 400)
      return {
        status: 'error',
        message: `it redirects (${res.status}); use the repo's current GitHub link`,
      };
    if (res.status !== 200)
      return { status: 'error', message: `it answered ${res.status}` };
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
  } catch {
    return {
      status: 'error',
      message: signal.aborted
        ? `no answer within ${FETCH_TIMEOUT_MS / 1000} s`
        : 'the fetch failed',
    };
  }
};
const tooLarge = (): FetchResult => ({
  status: 'error',
  message: `it is larger than ${FETCH_MAX_BYTES} bytes`,
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
};

/**
 * The decision once the file is read: why the entry isn't proven, or null. `deployers` holds the
 * deployer of each entered contract (null = no creation transaction on record, undefined = the
 * lookup failed). Pure; exported for tests.
 */
export function ownershipProblem(
  where: { repo: string; fileUrl: string },
  file: OwnershipFile | null,
  entry: Omit<OwnershipInput, 'repoUrl'>,
  deployers: Record<string, string | null | undefined> = {},
): string | null {
  const add = `Add a file named ${OWNERSHIP_FILE} at the root of ${where.repo} on its default branch with the line `;
  const again = ', push it, then call record_submission again';
  if (!file)
    return (
      `repo_url: EarnKit needs proof you own ${where.repo}: no ${OWNERSHIP_FILE} found at ${where.fileUrl} ` +
      `(the repo must be public). ${add}${wantedLine(entry.payoutWallet)}${again}. ` +
      'A just-pushed file can take a few minutes to appear.'
    );
  if (file.problems.length)
    return (
      `repo_url: ${OWNERSHIP_FILE} in ${where.repo} has a problem (${file.problems.join('; ')}). ` +
      `It should contain ${wantedLine(entry.payoutWallet)}.`
    );
  if (!file.payoutWallet)
    return `repo_url: ${OWNERSHIP_FILE} in ${where.repo} has no payout_wallet line. ${add}${wantedLine(entry.payoutWallet)}${again}.`;
  if (file.payoutWallet !== entry.payoutWallet)
    return (
      `payout_wallet: ${OWNERSHIP_FILE} in ${where.repo} says payout_wallet: ${file.payoutWallet}, not ${entry.payoutWallet}. ` +
      `Enter with the wallet in the file, or (if the builder owns the repo) change that line to ` +
      `"payout_wallet: ${entry.payoutWallet}"${again}.`
    );
  const failed = entry.contracts.find((c) => deployers[c] === undefined);
  if (failed)
    return `contracts: EarnKit couldn't read who deployed ${failed} from Base's explorer. Try again in a minute.`;
  const other = entry.contracts.find(
    (c) => deployers[c] !== entry.payoutWallet,
  );
  if (other)
    return `Contract ${other} was deployed by a different wallet. Enter contracts deployed from your payout wallet.`;
  return null;
}

/**
 * Checks that the entry's repo is a public, non-fork GitHub repo carrying earnkit.txt naming its
 * payout wallet, and that every contract was deployed by a transaction from that wallet. Throws
 * EntryError saying exactly what to fix. Returns the repo's GitHub dates (shown to the sponsor) and
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
  const problem = ownershipProblem(where, file, input, deployers);
  if (problem) throw new EntryError(problem);
  return {
    ...where,
    repo_created_at: new Date(facts.created_at),
    repo_pushed_at: new Date(facts.pushed_at),
    deployers: deployers as Record<string, string>,
  };
}
