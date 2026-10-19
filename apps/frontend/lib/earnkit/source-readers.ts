import { ScoreDeadline, beforeDeadline, blockscout } from './campaigns';
import { gh } from './match-projects';
import { ErrorPageError, LINKCHECK_UA, RedirectError, SafeFetchError, errorPageText, safeFetchText, sameSite, type Resolver, type Transport } from './safe-fetch';
import { providerOfUrl, type Provider } from './read-usage';

/**
 * v2.12 spec 2: one reader per source kind. Every outside read is injected (ReaderDeps), so tests
 * never touch the network and the cron passes the real, free, keyless sources. Scoring and clarity
 * R16b: only what Shipping, the ship log and matching use is read (a site up, a package's downloads,
 * a contract's deployer); stars, forks, contract callers and coin traders no longer are. A reader may
 * throw; the caller writes a failed reading, except for GitHubBudgetStop (isBudgetStop), which
 * leaves the source unread and still due. Every id is lowercase ('gh:<login>', 'wallet:0x..'),
 * as anti-farming.ts expects, and every number is finite (score.ts does not guard NaN).
 */
export type Who = { id: string; at: string; created_at?: string | null };
export type RepoSignals = {
  /** GitHub's `private` flag at the read (T10 review): the public profile names a repo only when this is false. */
  private?: boolean | null;
  owner: string;
  /** GitHub's owner type ('User' or 'Organization'): only an org repo counts for a top contributor. */
  owner_type: string;
  /** The repo's GitHub created_at (a repo_link contract must be deployed after it). */
  created_at: string | null;
  fork: boolean; template: boolean; stargazers: Who[]; forkers: Who[]; issue_authors: Who[]; contributors: Who[]; commit_weeks: string[]; partial: boolean;
  /** v2.13: commits on the default branch per ISO week, last 52 weeks (the newest 100 read; earlier weeks from the previous reading). */
  commit_counts?: Record<string, number>;
};
export type SiteSignals = { status: number; up: boolean };
export type PackageSignals = { weekly: number; repo_url: string | null };
/** `codes`: the ERC-8021 codes at the end of the call's input (builder-code.ts codesIn), [] for none. */
export type ContractSignals = { callers: (Who & { value_usd: number; first_tx_at?: string | null; codes?: string[] })[]; partial: boolean };
/** Who created a contract onchain: the creation transaction's sender and time; null is unreadable. */
export type ContractOrigin = { deployer: string | null; created_at: string | null };
/** `url`: the PR's own page (a merged_pr source's ref). */
export type PrSignals = { target: string; target_stars: number; merged_at: string | null; author: string; url?: string };
export type ReaderDeps = {
  gh: <T>(path: string, accept?: string) => Promise<T>;
  /** GitHub GraphQL (one call per person, person-github.ts); counted against the run's GitHub budget. */
  ghGraphql: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
  probe: (url: string) => Promise<{ status: number }>;
  fetchText: (url: string) => Promise<string>;
  /** npm and pypistats (public, keyless). */
  json: <T>(url: string) => Promise<T>;
  /** The creation transaction of a contract (Base: Blockscout; Arc: unreadable, nulls). */
  contractOrigin: (chain: 'base' | 'arc', address: string) => Promise<ContractOrigin>;
  /**
   * v2.12.1 T7: the contracts a wallet created (Base: Blockscout's transactions from it that created a
   * contract, at most READ_CAPS.walletPages pages). Asked only for a signed wallet (person_wallets).
   */
  walletCreations: (wallet: string) => Promise<{ address: string; created_at: string }[]>;
  now: Date;
  /**
   * Epoch ms: the read's deadline (defaultReaderDeps'), so a reader can stop between calls rather than start one past
   * it (person-github.ts withAllWeeks). Absent (test fakes): never.
   */
  deadline?: number;
  /** Whether the run's GitHub budget is spent (budgetedGh); absent: never. */
  ghSpent?: () => boolean;
  /**
   * A fetch for GitHub API reads made outside `gh` (the v2.11 proof-line pusher read): counted
   * against the same run budget and stopped at the same deadline. Absent: those reads are skipped.
   */
  ghFetch?: typeof fetch;
  /**
   * v2.12.1 read usage: the real deps call `requests.tick` once per outside HTTP request (a site's
   * redirects, a contract's two Blockscout reads and an Arc sender's two RPC reads each count);
   * read-usage.ts countingDeps sets it. Absent (test fakes): countingDeps counts each call instead.
   */
  requests?: { tick: ((provider: Provider) => void) | null };
};

/** `prs`: v1's merged PR targets (builder-score.ts buildInputs, kept as a record); `walletPages`: walletCreations. */
export const READ_CAPS = { prs: 30, walletPages: 3 } as const;
/** Below this many core GitHub requests left this hour, the run stops reading GitHub sources. */
export const GH_RATE_FLOOR = 1000;
/**
 * v2.12 final review I5: at most this many GitHub calls per cron run (discovery and source reads
 * together), on top of GH_RATE_FLOOR, so a backfill never spends the hour live find shares.
 */
export const GH_RUN_CAP = 1500;
/** A site read follows at most this many redirects, all within the same site (apex and www). */
export const SITE_MAX_REDIRECTS = 3;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]{0,213}$/;

/** The run's GitHub budget is spent (GH_RATE_FLOOR): leave this source unread, it stays due. */
export class GitHubBudgetStop extends Error {
  constructor() {
    super('GitHub budget for this run is spent');
    this.name = 'GitHubBudgetStop';
  }
}
export const isBudgetStop = (err: unknown) => err instanceof GitHubBudgetStop;

/**
 * `p`, or `fallback` on any error except a budget stop or the run's deadline (ScoreDeadline), which
 * always propagate: a read cut short is never a partial reading.
 */
export const soft = <T>(p: Promise<T>, fallback: T) => p.catch((err: unknown) => {
  if (isBudgetStop(err) || err instanceof ScoreDeadline) throw err;
  return fallback;
});

/** A finite number, else 0 (a malformed count never becomes NaN in a reading). */
const finite = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
/** ISO 8601 week, 'YYYY-Www'. Pure. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Up is any 2xx; a non-2xx or a thrown probe (refused host, DNS, timeout) is down, never an error. */
export async function readSite(origin: string, d: ReaderDeps): Promise<SiteSignals> {
  const status = await d.probe(origin).then(
    (r) => finite(r.status),
    (err: unknown) => {
      if (err instanceof ScoreDeadline) throw err; // the run's deadline is not a down site
      return 0;
    },
  );
  return { status, up: status >= 200 && status < 300 };
}

/**
 * Whether a site loads: a 2xx that is not an error page, after at most SITE_MAX_REDIRECTS redirects,
 * each within the same site as `url` (apex and www, any path). Every hop is a fresh safe-fetch:
 * https on 443, a domain name, every DNS answer public, the body and time capped.
 */
export async function probeSite(url: string, deps: { resolve?: Resolver; transport?: Transport; timeoutMs?: number; onRequest?: () => void } = {}): Promise<void> {
  const { onRequest, ...rest } = deps;
  const opts = { ...rest, probe: true, userAgent: LINKCHECK_UA };
  const start = new URL(url).hostname;
  let at = url;
  for (let hop = 0; ; hop++) {
    let page: string;
    try {
      onRequest?.();
      page = await safeFetchText(at, opts);
    } catch (err) {
      if (!(err instanceof RedirectError) || !err.location) throw err;
      if (hop >= SITE_MAX_REDIRECTS) throw new SafeFetchError('too many redirects');
      const next = new URL(err.location, at);
      if (!sameSite(next.hostname, start)) throw new SafeFetchError(`redirects to another site (${next.hostname})`);
      at = next.href;
      continue;
    }
    const phrase = errorPageText(page);
    if (phrase) throw new ErrorPageError(phrase);
    return;
  }
}

const repoUrlOf = (raw: unknown): string | null => {
  const s = typeof raw === 'string' && raw.length <= 500 ? raw : null;
  const m = s && /github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/#].*)?$/.exec(s);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
};

/** A scoped name is one path segment on both npm APIs: '@types/node' -> '%40types%2Fnode' (checked live 2026-10-12). */
export async function readNpm(name: string, d: ReaderDeps): Promise<PackageSignals> {
  if (!NPM_NAME.test(name)) throw new Error('not an npm package name');
  const id = encodeURIComponent(name);
  const range = await d.json<{ downloads?: { day: string; downloads: number }[] }>(`https://api.npmjs.org/downloads/range/last-month/${id}`);
  if (!Array.isArray(range?.downloads)) throw new Error('npm downloads unreadable');
  const last28 = range.downloads.slice(-28);
  const weeks = [0, 1, 2, 3].map((i) => last28.slice(i * 7, i * 7 + 7).reduce((n, x) => n + finite(x?.downloads), 0));
  const meta = await d.json<{ repository?: { url?: string } | string }>(`https://registry.npmjs.org/${id}/latest`);
  const repo = typeof meta?.repository === 'string' ? meta.repository : meta?.repository?.url;
  return { weekly: finite(weeks.reduce((n, w) => n + w, 0) / 4), repo_url: repoUrlOf(repo) };
}

export const NPM_BULK_MAX = 128;
/**
 * v2.12.1 spec "Scale": "npm's bulk endpoint (up to 128 packages per call)". Unscoped names only
 * (npm's bulk read refuses scoped ones; those keep readNpm). One name answers a bare object, many
 * a map by name (null for a package with no downloads data).
 */
export async function readNpmBulk(names: string[], d: ReaderDeps): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const plain = [...new Set(names.filter((n) => NPM_NAME.test(n) && !n.startsWith('@')))];
  for (let i = 0; i < plain.length; i += NPM_BULK_MAX) {
    const batch = plain.slice(i, i + NPM_BULK_MAX);
    const body = await d.json<Record<string, unknown>>(`https://api.npmjs.org/downloads/point/last-week/${batch.join(',')}`);
    const of = (x: unknown) => {
      const n = (x as { downloads?: unknown } | null)?.downloads;
      return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : null;
    };
    if (batch.length === 1) out.set(batch[0], of(body));
    else for (const n of batch) out.set(n, of(body?.[n]));
  }
  return out;
}

/** PEP 503: lowercase, every run of '-', '_' and '.' is one '-'. Pure. */
export const pep503 = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

export async function readPypi(name: string, d: ReaderDeps): Promise<PackageSignals> {
  const id = pep503(name);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(id)) throw new Error('not a PyPI package name');
  const recent = await d.json<{ data?: { last_month?: number } }>(`https://pypistats.org/api/packages/${id}/recent`);
  const month = recent?.data?.last_month;
  if (typeof month !== 'number' || !Number.isFinite(month)) throw new Error('pypi downloads unreadable');
  const meta = await d.json<{ info?: { project_urls?: Record<string, string> | null; home_page?: string | null } }>(`https://pypi.org/pypi/${id}/json`);
  const urls = [...Object.values(meta?.info?.project_urls ?? {}), meta?.info?.home_page ?? ''];
  return { weekly: month / 4, repo_url: urls.map(repoUrlOf).find((u) => u !== null) ?? null };
}

const contractRef = (ref: string): { chain: 'base' | 'arc'; address: string } => {
  const [chain, address, ...rest] = ref.split(':');
  if ((chain !== 'base' && chain !== 'arc') || rest.length > 0 || !ADDRESS.test(address ?? '')) throw new Error('not a contract ref');
  return { chain, address: address.toLowerCase() };
};

/** Who created the contract and when (lowercase deployer); nulls when the chain can't say. */
export async function readContractOrigin(ref: string, d: ReaderDeps): Promise<ContractOrigin> {
  const { chain, address } = contractRef(ref);
  const o = await d.contractOrigin(chain, address);
  const deployer = typeof o?.deployer === 'string' && ADDRESS.test(o.deployer) ? o.deployer.toLowerCase() : null;
  const created_at = typeof o?.created_at === 'string' && !Number.isNaN(Date.parse(o.created_at)) ? o.created_at : null;
  return { deployer, created_at };
}

/** The only hosts `json` reads (npm and PyPI download counts and metadata; public, keyless). */
const JSON_HOSTS = new Set(['api.npmjs.org', 'registry.npmjs.org', 'pypistats.org', 'pypi.org']);
const JSON_MAX_BYTES = 5_000_000;

/** A keyless JSON GET to one of JSON_HOSTS: https only, no redirects, at most 10 s and 5 MB. */
async function packageJson<T>(url: string, deadline: number): Promise<T> {
  const u = URL.canParse(url) ? new URL(url) : null;
  if (!u || u.protocol !== 'https:' || u.port !== '' || u.username || u.password || !JSON_HOSTS.has(u.hostname))
    throw new Error('host not allowed');
  const left = deadline - Date.now();
  if (left <= 0) throw new Error('deadline passed');
  const res = await fetch(u, {
    headers: { Accept: 'application/json', 'User-Agent': 'earnkit' },
    redirect: 'error',
    signal: AbortSignal.timeout(Math.min(10_000, left)),
  });
  if (!res.ok) throw new Error(`${u.hostname} returned ${res.status}`);
  return cappedJson<T>(res, JSON_MAX_BYTES);
}

/** A response body as JSON, read in chunks and refused past `max` bytes (declared or actual). */
async function cappedJson<T>(res: Response, max: number): Promise<T> {
  if (Number(res.headers.get('content-length')) > max || !res.body) throw new Error('too large');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max) throw new Error('too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

type RawGh = <T>(path: string, accept?: string, onResponse?: (res: Response) => void) => Promise<T>;

/**
 * v2.14 final fix 8: whether a GitHub request carries a GitHub App credential: an installation token (`ghs_`) or the
 * App's own JWT (`eyJ`), as github-app.ts, repo-proof.ts and person-github.ts send them (`Bearer <credential>`).
 * EarnKit's GITHUB_TOKEN is never either. Pure; exported for tests.
 */
export function appCredential(input: RequestInfo | URL, init?: RequestInit): boolean {
  const fromInit = init?.headers ? new Headers(init.headers).get('authorization') : null;
  const auth = fromInit ?? (input instanceof Request ? input.headers.get('authorization') : null);
  return auth !== null && /^(Bearer|token) (ghs_|eyJ)/.test(auth.trim());
}

/**
 * `raw` (match-projects.ts gh) with a run budget: once a core response says fewer than `floor`
 * requests are left, or `cap` calls were made this run (GH_RUN_CAP), every later call (and the
 * failing one) throws GitHubBudgetStop. The search API's own small limit (x-ratelimit-resource:
 * search) never trips the floor; every call counts toward the cap. `take()` counts a call made
 * outside `gh` (ghFetch) and says whether it may go.
 */
export function budgetedGh(raw: RawGh, floor = GH_RATE_FLOOR, cap = GH_RUN_CAP): (<T>(path: string, accept?: string, onRequest?: () => void) => Promise<T>) & { spent: () => boolean; watch: (res: Response) => void; take: () => boolean; calls: () => number } {
  let stopped = false;
  let calls = 0;
  const watch = (res: Response) => {
    const resource = res.headers.get('x-ratelimit-resource');
    const left = res.headers.get('x-ratelimit-remaining');
    if (left !== null && (resource === null || resource === 'core') && Number(left) < floor) stopped = true;
  };
  const take = () => {
    if (stopped) return false;
    if (calls >= cap) {
      stopped = true;
      return false;
    }
    calls++;
    return true;
  };
  /** `onRequest`: called once the budget lets the call go (read usage counts real requests only). */
  const gh = async <T>(path: string, accept?: string, onRequest?: () => void) => {
    if (!take()) throw new GitHubBudgetStop();
    onRequest?.();
    try {
      return await raw<T>(path, accept, watch);
    } catch (err) {
      if (stopped) throw new GitHubBudgetStop();
      throw err;
    }
  };
  return Object.assign(gh, { spent: () => stopped, watch, take, calls: () => calls });
}

const GRAPHQL_MAX_BYTES = 5_000_000;
/**
 * A GraphQL answer worth reading: it has data, and every error (if any) is NOT_FOUND (an unknown
 * login or repo reads as null). Any other error (rate limit, timeout, a bad query) throws, so a
 * partial answer is never read as zero. Pure; exported for tests.
 */
export function graphqlUsable(body: unknown): boolean {
  const b = (body ?? {}) as { data?: unknown; errors?: unknown };
  if (!b.data || typeof b.data !== 'object') return false;
  if (b.errors === undefined) return true;
  return Array.isArray(b.errors) && b.errors.every((e) => (e as { type?: unknown } | null)?.type === 'NOT_FOUND');
}

/**
 * What a GraphQL answer graphqlUsable refuses said, for the failed reading and the log: each error's type, path and
 * GitHub's message (at most 3), or why there is no data. GitHub's messages never carry the request's token. Pure;
 * exported for tests.
 */
export function graphqlErrors(body: unknown): string {
  const b = (body ?? {}) as { data?: unknown; errors?: unknown };
  const errors = Array.isArray(b.errors) ? b.errors : [];
  const said = errors.slice(0, 3).map((e) => {
    const x = (e ?? {}) as { type?: unknown; path?: unknown; message?: unknown };
    const path = Array.isArray(x.path) ? x.path.join('.') : '';
    const message = typeof x.message === 'string' ? x.message.slice(0, 80) : '';
    return [typeof x.type === 'string' ? x.type : 'ERROR', path && `at ${path}`, message && `(${message})`].filter(Boolean).join(' ');
  });
  if (said.length === 0) return 'GitHub GraphQL answered no data';
  return `GitHub GraphQL answered errors: ${said.join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`;
}

/**
 * A failed read's error as text, for the failed reading's `error` and the log: its class and message, at most
 * 200 characters. No read puts a token in an error message (GitHub's statuses and messages, fetch's causes). Pure.
 */
export function readError(err: unknown): string {
  if (!(err instanceof Error)) return 'error';
  return (err.message ? `${err.name}: ${err.message}` : err.name).slice(0, 200);
}

/**
 * One GitHub GraphQL call, counted against the run's budget (`github.take()`, GitHubBudgetStop when
 * spent). An answer graphqlUsable refuses throws: the caller writes failed readings.
 */
async function githubGraphql<T>(query: string, variables: Record<string, unknown>, github: ReturnType<typeof budgetedGh>, onRequest?: () => void): Promise<T> {
  if (!github.take()) throw new GitHubBudgetStop();
  onRequest?.();
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'earnkit', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ query, variables }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    github.watch(res);
    if (!res.ok) throw new Error(`GitHub GraphQL returned ${res.status}`);
    const body = await cappedJson<{ data?: unknown; errors?: unknown[] }>(res, GRAPHQL_MAX_BYTES);
    if (!graphqlUsable(body)) throw new Error(graphqlErrors(body));
    return body as T;
  } catch (err) {
    if (github.spent()) throw new GitHubBudgetStop();
    throw err;
  }
}

/** Base: Blockscout's creation transaction, then its sender and time (never creator_address_hash, the factory). */
async function blockscoutOrigin(address: string, deadline: number, tick: () => void): Promise<ContractOrigin> {
  tick();
  const a = await blockscout<{ creation_transaction_hash?: string | null; creation_tx_hash?: string | null }>(`/api/v2/addresses/${address}`, deadline);
  const hash = a.creation_transaction_hash ?? a.creation_tx_hash ?? null;
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return { deployer: null, created_at: null };
  tick();
  const tx = await blockscout<{ from?: { hash?: string }; timestamp?: string | null }>(`/api/v2/transactions/${hash}`, deadline);
  return { deployer: tx.from?.hash ?? null, created_at: tx.timestamp ?? null };
}

type CreationPage = { items?: { timestamp?: string | null; status?: string; created_contract?: { hash?: string | null } | null }[]; next_page_params?: Record<string, unknown> | null };
/**
 * T7: the contracts `wallet` created on Base, newest first: its outgoing transactions that created a
 * contract (successful ones), at most READ_CAPS.walletPages pages of Blockscout.
 */
export async function walletCreationsFrom(wallet: string, page: (path: string) => Promise<CreationPage>): Promise<{ address: string; created_at: string }[]> {
  if (!ADDRESS.test(wallet)) throw new Error('not a wallet');
  const out: { address: string; created_at: string }[] = [];
  let params = 'filter=from';
  for (let i = 0; i < READ_CAPS.walletPages; i++) {
    const data = await page(`/api/v2/addresses/${wallet.toLowerCase()}/transactions?${params}`);
    for (const tx of Array.isArray(data?.items) ? data.items : []) {
      const a = tx?.created_contract?.hash;
      if (typeof a === 'string' && ADDRESS.test(a) && tx.status === 'ok' && typeof tx.timestamp === 'string')
        out.push({ address: a.toLowerCase(), created_at: tx.timestamp });
    }
    if (!data?.next_page_params) break;
    // Blockscout's next_page_params do not carry the filter: it is kept on every page.
    params = new URLSearchParams([['filter', 'from'], ...Object.entries(data.next_page_params).filter(([k]) => k !== 'filter').map(([k, v]): [string, string] => [k, String(v)])]).toString();
  }
  return out;
}

/**
 * The real reads. Sites go through safe-fetch (public addresses only after DNS, https on 443, no
 * IP hosts, up to three same-site redirects each re-vetted, size and time capped), so a site source
 * can never reach inside EarnKit's network. Every read stops at `deadline` (epoch ms).
 */
export function defaultReaderDeps(now: Date, deadline: number): ReaderDeps {
  const by = <T>(p: Promise<T>) => beforeDeadline(p, deadline);
  const github = budgetedGh((path, accept, onResponse) => gh(path, accept, onResponse));
  const requests: NonNullable<ReaderDeps['requests']> = { tick: null };
  const tick = (p: Provider) => requests.tick?.(p);
  return {
    gh: <T>(path: string, accept?: string) => by(github<T>(path, accept, () => tick('github_rest'))),
    ghGraphql: <T>(query: string, variables: Record<string, unknown>) => by(githubGraphql<T>(query, variables, github, () => tick('github_graphql'))),
    probe: (url) => by(probeSite(url, { onRequest: () => tick('site') }).then(() => ({ status: 200 }))),
    fetchText: (url) => (tick('site'), by(safeFetchText(url))),
    json: <T>(url: string) => (tick(providerOfUrl(url)), by(packageJson<T>(url, deadline))),
    // Arc has no readable explorer API (Cloudflare challenge): its origin is unknown, so a repo_link is refused.
    contractOrigin: async (chain, address) => (chain === 'base' ? blockscoutOrigin(address, deadline, () => tick('blockscout')) : { deployer: null, created_at: null }),
    walletCreations: (wallet) => walletCreationsFrom(wallet, (path) => (tick('blockscout'), blockscout<CreationPage>(path, deadline))),
    now,
    deadline,
    ghSpent: github.spent,
    ghFetch: async (input, init) => {
      // v2.14 final fix 8: a call with an App credential (an installation token or the App's JWT) spends the
      // App installation's own rate limit, not EarnKit's GITHUB_TOKEN: it never counts toward GH_RUN_CAP and its
      // rate headers never stop the run. The steps' own per-run caps and the deadline bound it.
      const app = appCredential(input, init);
      if (!app && !github.take()) throw new GitHubBudgetStop();
      tick('github_rest');
      const res = await by(fetch(input, init));
      if (!app) github.watch(res);
      return res;
    },
    requests,
  };
}
