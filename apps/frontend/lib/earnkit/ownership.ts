import { FETCH_MAX_BYTES, FETCH_TIMEOUT_MS } from './safe-fetch';
import { alchemyCall, alchemyCreationOf } from './alchemy';
import { EntryError, githubRepo } from './campaigns';
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
/** A git branch name safe to show in text (GitHub lets the repo's owner pick it), else null. Pure. */
export const shownBranch = (name: string | null | undefined) =>
  name && /^[A-Za-z0-9._/-]{1,100}$/.test(name) ? name : null;

/**
 * v2.8.1 §A3: earnkit.txt on the repo's most recently pushed branch other than the default one, for
 * an agent that pushed the proof line to a feature branch. One GitHub API call (the repo's push
 * activity, newest first), then the file at that push's commit from raw.githubusercontent.com: a
 * commit-addressed read, so no cache delay and no API quota. Null when there is no such branch or
 * the activity can't be read (the default branch's answer then stands). Never throws.
 */
export async function fetchOwnershipLatestBranch(
  r: { owner: string; repo: string },
  defaultBranch: string | undefined,
  deps: { fetch?: typeof fetch; raw?: OwnershipFetcher; token?: string } = {},
): Promise<{ branch: string; file: FetchResult } | null> {
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  try {
    const res = await (deps.fetch ?? fetch)(
      `https://api.github.com/repos/${r.owner}/${r.repo}/activity?activity_type=push&per_page=10`,
      {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'earnkit',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      },
    );
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const pushes = (await res.json()) as unknown;
    if (!Array.isArray(pushes)) return null;
    for (const p of pushes as { ref?: unknown; after?: unknown }[]) {
      const ref = typeof p?.ref === 'string' ? p.ref : '';
      const sha = typeof p?.after === 'string' ? p.after : '';
      if (!ref.startsWith('refs/heads/') || !/^[0-9a-f]{40}$/.test(sha) || /^0+$/.test(sha)) continue;
      const branch = ref.slice('refs/heads/'.length);
      if (branch === defaultBranch) continue;
      const file = await (deps.raw ?? fetchOwnershipFile)(`${RAW_GITHUB}/${r.owner}/${r.repo}/${sha}/${OWNERSHIP_FILE}`);
      return { branch, file };
    }
    return null;
  } catch {
    return null;
  }
}

/** Activity kinds that move a branch to a new commit (the walk reads them all; only some credit their actor). */
const PUSH_KINDS = new Set(['push', 'force_push', 'branch_creation', 'pr_merge', 'merge_queue_merge']);
/** At most this many commit-addressed earnkit.txt reads per pusher check. */
export const PUSHER_MAX_READS = 6;
/** The activity page read; fewer entries than this means the repo's whole history is on it. */
const ACTIVITY_PAGE = 50;
/**
 * v2.11 T9 security fix R4: how far the crediting push's commits may sit from the repo's creation,
 * the line's first issue and the push. A build commits locally, then creates the repo and pushes,
 * so its commits come minutes before `created_at`; a cloned tutorial or old work comes long before.
 */
export const PUSHER_WINDOW = {
  /** A commit may be dated at most this long before the repo was created. */
  beforeRepoMs: 10 * 60_000,
  /** Clock skew allowed against the line's first issue and the push time. */
  skewMs: 5 * 60_000,
  /** A first-event branch creation must come within this long of the repo's creation (R4 c). */
  firstEventMs: 10 * 60_000,
  /** Commits read per credit check (compare, or a new repo's whole history). */
  maxCommits: 100,
} as const;

/**
 * v2.11 T9 security fixes (I1, R1): the GitHub login that wrote a line into earnkit.txt, as GitHub's
 * own authenticated record says: the `actor` of the push that introduced it (the repo's activity
 * API, newest first). Commit author and committer fields are never used: anyone can write any name
 * or email into a commit, while the activity actor is the account GitHub authenticated for the push.
 *
 * The push that introduced it: on the branch of the newest push whose commit's earnkit.txt has the
 * line (`hasLine`), walk that branch's pushes back (each push's `before` is the older push's `after`)
 * to the first whose `before` commit has no such line. Only a push whose actor wrote its commits
 * credits that actor (R1):
 * - when the same commit was pushed earlier (on any branch), that earlier push decides (followed the
 *   same way), so moving a ref onto someone else's commit (a fast-forward, a reset, a new branch)
 *   never credits the mover;
 * - else a `push` credits its actor;
 * - a `branch_creation` credits its actor only when it is the repo's very first event (the whole
 *   history is on the page and nothing is older), so the commit can't have come from anyone else;
 * - a `force_push` (it may point at any commit), `pr_merge` or `merge_queue_merge` (the merger didn't
 *   write the head; its pusher lives in a fork) credits no one;
 * - and (R4) only when the push carries the actor's own new work (ownWork: not a fork or template
 *   repo; no merge commits; commits dated around the repo's creation, after the line's first issue to
 *   this installation, and before the push; a first-event creation within minutes of the repo's).
 * Null when the activity can't be read, the chain breaks (older than the activity page), more than
 * PUSHER_MAX_READS reads would be needed, or the introducing push credits no one: no login is ever
 * guessed. Never throws.
 */
export async function fetchLinePusher(
  r: { owner: string; repo: string },
  hasLine: (text: string) => boolean,
  /** R4 (b): when EarnKit first showed this installation the line for this repo; null: never credited. */
  issuedAt: Date | null,
  deps: {
    fetch?: typeof fetch;
    raw?: OwnershipFetcher;
    token?: string;
    /**
     * Final fix M6: whether this repo ever read as a fork or as made from a template, given this
     * reading (token-gate.ts repoEverDerived keeps the first reading, and any later one that is
     * set, per repo). Without it only this reading counts.
     */
    everDerived?: (repoKey: string, derivedNow: boolean) => Promise<boolean>;
  } = {},
): Promise<string | null> {
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  const raw = deps.raw ?? fetchOwnershipFile;
  const zero = (sha: string) => /^0+$/.test(sha);
  const api = async (path: string): Promise<unknown> => {
    const res = await (deps.fetch ?? fetch)(`https://api.github.com/repos/${r.owner}/${r.repo}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'earnkit', ...(token && { Authorization: `Bearer ${token}` }) },
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    return res.json();
  };
  if (!issuedAt) return null;
  const issued = issuedAt.getTime();
  try {
    const body = await api(`/activity?per_page=${ACTIVITY_PAGE}`);
    if (!Array.isArray(body)) return null;
    const complete = body.length < ACTIVITY_PAGE;
    type Push = { kind: string; ref: string; before: string; after: string; actor: string; idx: number; at: number };
    const pushes: Push[] = [];
    for (const [idx, p] of (body as { ref?: unknown; before?: unknown; after?: unknown; activity_type?: unknown; timestamp?: unknown; actor?: { login?: unknown } | null }[]).entries()) {
      const kind = String(p?.activity_type);
      const ref = typeof p?.ref === 'string' ? p.ref : '';
      const before = typeof p?.before === 'string' ? p.before : '';
      const after = typeof p?.after === 'string' ? p.after : '';
      const actor = typeof p?.actor?.login === 'string' ? p.actor.login : '';
      if (!PUSH_KINDS.has(kind) || !ref.startsWith('refs/heads/')) continue;
      if (!/^[0-9a-f]{40}$/.test(before) || !/^[0-9a-f]{40}$/.test(after) || zero(after) || !/^[A-Za-z0-9-]{1,39}$/.test(actor)) continue;
      const at = typeof p?.timestamp === 'string' ? Date.parse(p.timestamp) : NaN;
      if (!Number.isFinite(at)) continue;
      pushes.push({ kind, ref, before, after, actor, idx, at });
    }
    let reads = 0;
    const lineAt = async (sha: string) => {
      if (zero(sha)) return false;
      if (++reads > PUSHER_MAX_READS) throw new Error('too many reads');
      const got = await raw(`${RAW_GITHUB}/${r.owner}/${r.repo}/${sha}/${OWNERSHIP_FILE}`);
      return got.status === 'ok' && hasLine(got.text);
    };
    /** From a push whose commit has the line, back along its branch to the push that introduced it, then who that credits. */
    const introducer = async (from: Push, depth: number): Promise<string | null> => {
      let at: Push | undefined = from;
      while (at && (await lineAt(at.before))) {
        const cur: Push = at;
        at = pushes.find((p, i) => i > pushes.indexOf(cur) && p.ref === cur.ref && p.after === cur.before);
      }
      if (!at) return null;
      const i = pushes.indexOf(at);
      const earlier = pushes.find((p, j) => j > i && p.after === at!.after);
      if (earlier) return depth < 3 ? introducer(earlier, depth + 1) : null;
      const first = at.kind === 'branch_creation' && complete && at.idx === body.length - 1;
      if (at.kind !== 'push' && !first) return null;
      return (await ownWork(at, first)) ? at.actor.toLowerCase() : null;
    };
    /**
     * R4: the crediting push carries only the actor's own new work. (a) The repo is neither a fork nor
     * made from a template (one repo read). (c) A first-event creation comes within minutes of the
     * repo's creation. (b) Every commit it brought (compare before...after; for the first event the
     * whole history) has at most one parent (no merge), and is dated from 10 minutes before the
     * repo's creation and from the line's first issue to this installation, up to the push: a cloned
     * tutorial, old work or a merge of someone else's branch is never the owner's.
     */
    const ownWork = async (push: Push, first: boolean): Promise<boolean> => {
      const repo = (await api('')) as { fork?: unknown; template_repository?: unknown; created_at?: unknown } | null;
      const created = typeof repo?.created_at === 'string' ? Date.parse(repo.created_at) : NaN;
      if (!repo || typeof repo.fork !== 'boolean' || !Number.isFinite(created)) return false;
      const derived = repo.fork || (repo.template_repository !== undefined && repo.template_repository !== null);
      // Final fix M6: a fork or template flag erased later (the source deleted or made private) never clears it.
      if (deps.everDerived ? await deps.everDerived(`${r.owner}/${r.repo}`.toLowerCase(), derived) : derived) return false;
      if (first && (push.at < created - PUSHER_WINDOW.skewMs || push.at > created + PUSHER_WINDOW.firstEventMs)) return false;
      type Commit = { parents?: unknown; commit?: { committer?: { date?: unknown } | null } | null };
      let commits: Commit[];
      if (first) {
        const list = await api(`/commits?sha=${push.after}&per_page=${PUSHER_WINDOW.maxCommits}`);
        if (!Array.isArray(list) || list.length === 0 || list.length >= PUSHER_WINDOW.maxCommits) return false;
        commits = list as Commit[];
      } else {
        const cmp = (await api(`/compare/${push.before}...${push.after}`)) as { status?: unknown; total_commits?: unknown; commits?: unknown } | null;
        if (!cmp || cmp.status !== 'ahead' || !Array.isArray(cmp.commits) || cmp.commits.length === 0 || cmp.total_commits !== cmp.commits.length || cmp.commits.length > PUSHER_WINDOW.maxCommits) return false;
        commits = cmp.commits as Commit[];
      }
      const from = Math.max(created - PUSHER_WINDOW.beforeRepoMs, issued - PUSHER_WINDOW.skewMs);
      const to = push.at + PUSHER_WINDOW.skewMs;
      return commits.every((c) => {
        const date = typeof c?.commit?.committer?.date === 'string' ? Date.parse(c.commit.committer.date) : NaN;
        return Array.isArray(c?.parents) && c.parents.length <= 1 && Number.isFinite(date) && date >= from && date <= to;
      });
    };
    // The newest push of each branch first: the branch whose head has the line.
    const heads = pushes.filter((p, i) => pushes.findIndex((q) => q.ref === p.ref) === i);
    for (const h of heads) if (await lineAt(h.after)) return await introducer(h, 0);
    return null;
  } catch {
    return null;
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
 * Who deployed a contract: the sender of the transaction that created it. Two reads, injectable for tests: the
 * address's creation transaction (null when it holds no code), then that transaction's sender. Alchemy, never
 * Blockscout (owner ruling; Blockscout challenges servers).
 */
export type DeployerLookup = {
  creationTx: (contract: string) => Promise<string | null>;
  txSender: (hash: string) => Promise<string>;
};
const DEPLOYER_READ_MS = 60_000;
export const alchemyDeployer: DeployerLookup = {
  creationTx: async (contract) => (await alchemyCreationOf(contract, alchemyCall(Date.now() + DEPLOYER_READ_MS)))?.hash ?? null,
  txSender: async (hash) => {
    const tx = await alchemyCall(Date.now() + DEPLOYER_READ_MS)<{ from?: string } | null>('eth_getTransactionByHash', [hash]);
    if (!tx?.from) throw new Error('Alchemy: transaction not found');
    return tx.from;
  },
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
  const again = ', push it, then call confirm again';
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
    deployer = alchemyDeployer,
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
  // The contracts' deployers are read only once the file names this wallet.
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
