import { FETCH_MAX_BYTES, FETCH_TIMEOUT_MS } from './safe-fetch';
import { EntryError, blockscout, normalizeRepoUrl } from './campaigns';

/**
 * Proof that a campaign entry belongs to the person entering it (v2.2 §1 Builders; audits H2/F1).
 * The repo (public GitHub) has `earnkit.txt` at its root on the default branch:
 *
 *   payout_wallet: 0x…
 *   contracts: 0x…, 0x…        (optional)
 *
 * The file's wallet must equal the entry's payout_wallet, and each entered contract must have been
 * created by that wallet (Base Blockscout `creator_address_hash`) or be listed in the file. Only
 * someone who can push to the repo can write the file, so a squatter can't enter someone else's
 * repo with their own wallet.
 */

export const OWNERSHIP_FILE = 'earnkit.txt';
const RAW_GITHUB = 'https://raw.githubusercontent.com';

/**
 * Where earnkit.txt is read from: raw.githubusercontent.com, or EARNKIT_OWNERSHIP_BASE_URL in
 * development and tests (the e2e serves files locally). The override is refused in production.
 */
export function ownershipBaseUrl(
  env: Record<string, string | undefined> = process.env,
) {
  const override = env.EARNKIT_OWNERSHIP_BASE_URL;
  if (!override) return RAW_GITHUB;
  if (env.NODE_ENV === 'production')
    throw new Error(
      'EARNKIT_OWNERSHIP_BASE_URL is for development and tests only; unset it in production.',
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
  if (repo === '.' || repo === '..') return null;
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
  /** Lowercase, unique. */
  contracts: string[];
  /** 1-based line numbers and what's wrong; the file's text is never echoed. */
  problems: string[];
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Parses earnkit.txt: `payout_wallet: 0x…` and `contracts: 0x…, 0x…` lines (keys case-insensitive,
 * `#` starts a comment, other lines ignored, so a sponsor's `earnkit-sponsor:` line can share the
 * file). Pure; exported for tests.
 */
export function parseOwnershipFile(text: string): OwnershipFile {
  const wallets = new Set<string>();
  const contracts = new Set<string>();
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^(payout_wallet|contracts)\s*:\s*(.*)$/i.exec(line);
    if (!m) return;
    const key = m[1].toLowerCase();
    const values = m[2].split(/[\s,]+/).filter(Boolean);
    if (values.length === 0 || values.some((v) => !ADDRESS.test(v))) {
      problems.push(
        `line ${i + 1}: ${key} needs ${key === 'payout_wallet' ? 'one 0x address' : '0x addresses separated by commas'}`,
      );
      return;
    }
    if (key === 'payout_wallet') {
      if (values.length > 1)
        problems.push(`line ${i + 1}: payout_wallet takes one address`);
      else wallets.add(values[0].toLowerCase());
    } else for (const v of values) contracts.add(v.toLowerCase());
  });
  if (wallets.size > 1)
    problems.push('payout_wallet appears with different addresses; keep one');
  return {
    payoutWallet: wallets.size === 1 ? [...wallets][0] : null,
    contracts: [...contracts],
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

/** Who created `contract` on Base (lowercase), from Blockscout; null when it has no creator. */
export type CreatorLookup = (contract: string) => Promise<string | null>;
export const blockscoutCreator: CreatorLookup = async (contract) => {
  const a = await blockscout<{ creator_address_hash?: string | null }>(
    `/api/v2/addresses/${contract}`,
  );
  return a.creator_address_hash?.toLowerCase() ?? null;
};

/** The exact lines the builder should have in earnkit.txt. */
const wantedLines = (wallet: string, contracts: string[]) =>
  `"payout_wallet: ${wallet}"` +
  (contracts.length ? ` and "contracts: ${contracts.join(', ')}"` : '');

export type OwnershipInput = {
  repoUrl: string;
  /** Lowercase. */
  payoutWallet: string;
  /** Lowercase. */
  contracts: string[];
};

/**
 * The decision once the file is read: why the entry isn't proven, or null. `creators` holds the
 * Blockscout creator of each entered contract the file doesn't list (null = none known, undefined
 * = the lookup failed). Pure; exported for tests.
 */
export function ownershipProblem(
  where: { repo: string; fileUrl: string },
  file: OwnershipFile | null,
  entry: Omit<OwnershipInput, 'repoUrl'>,
  creators: Record<string, string | null | undefined> = {},
): string | null {
  const add = `Add a file named ${OWNERSHIP_FILE} at the root of ${where.repo} on its default branch with the line `;
  const again = ', push it, then call record_submission again';
  if (!file)
    return (
      `repo_url: EarnKit needs proof you own ${where.repo}: no ${OWNERSHIP_FILE} found at ${where.fileUrl} ` +
      `(the repo must be public). ${add}${wantedLines(entry.payoutWallet, entry.contracts)}${again}. ` +
      'A just-pushed file can take a few minutes to appear.'
    );
  if (file.problems.length)
    return (
      `repo_url: ${OWNERSHIP_FILE} in ${where.repo} has a problem (${file.problems.join('; ')}). ` +
      `It should contain ${wantedLines(entry.payoutWallet, entry.contracts)}.`
    );
  if (!file.payoutWallet)
    return `repo_url: ${OWNERSHIP_FILE} in ${where.repo} has no payout_wallet line. ${add}${wantedLines(entry.payoutWallet, entry.contracts)}${again}.`;
  if (file.payoutWallet !== entry.payoutWallet)
    return (
      `payout_wallet: ${OWNERSHIP_FILE} in ${where.repo} says payout_wallet: ${file.payoutWallet}, not ${entry.payoutWallet}. ` +
      `Enter with the wallet in the file, or (if the builder owns the repo) change that line to ` +
      `"payout_wallet: ${entry.payoutWallet}"${again}.`
    );
  const listed = new Set(file.contracts);
  const unproven = entry.contracts.filter(
    (c) => !listed.has(c) && creators[c] !== entry.payoutWallet,
  );
  if (unproven.length === 0) return null;
  const why = unproven
    .map((c) =>
      creators[c] === undefined
        ? `${c} (EarnKit couldn't read its creator)`
        : creators[c] === null
          ? `${c} (no creator on record)`
          : `${c} (created by ${creators[c]})`,
    )
    .join(', ');
  return (
    `contracts: ${why} ${unproven.length === 1 ? "wasn't" : "weren't"} created by ${entry.payoutWallet} and ` +
    `${unproven.length === 1 ? "isn't" : "aren't"} listed in ${OWNERSHIP_FILE}. If the builder deployed ` +
    `${unproven.length === 1 ? 'it' : 'them'}, add the line "contracts: ${[...new Set([...file.contracts, ...unproven])].join(', ')}" ` +
    `to ${OWNERSHIP_FILE} in ${where.repo}${again}.`
  );
}

/**
 * Checks that the entry's repo carries earnkit.txt naming its payout wallet, and that every
 * contract was created by that wallet or is listed in the file. Throws EntryError saying exactly
 * what to add. `fetchFile` and `creatorOf` are injectable for tests.
 */
export async function checkOwnership(
  input: OwnershipInput,
  {
    fetchFile = fetchOwnershipFile,
    creatorOf = blockscoutCreator,
    baseUrl = ownershipBaseUrl(),
  }: {
    fetchFile?: OwnershipFetcher;
    creatorOf?: CreatorLookup;
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
  const got = await fetchFile(where.fileUrl);
  if (got.status === 'error')
    throw new EntryError(
      `repo_url: EarnKit couldn't read ${where.fileUrl} (${got.message}). Try again in a minute.`,
    );
  const file = got.status === 'ok' ? parseOwnershipFile(got.text) : null;
  const creators: Record<string, string | null | undefined> = {};
  // Blockscout is asked only about contracts the file doesn't list, once the wallet matches.
  if (file?.payoutWallet === input.payoutWallet && !file.problems.length)
    for (const c of input.contracts.filter((c) => !file.contracts.includes(c)))
      creators[c] = await creatorOf(c).catch((err) => {
        console.error('[ownership] creator lookup failed:', err);
        return undefined;
      });
  const problem = ownershipProblem(where, file, input, creators);
  if (problem) throw new EntryError(problem);
  return where;
}
