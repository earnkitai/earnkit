import { createPublicClient, http, type Address, type Hash } from 'viem';
import { ScoreDeadline, beforeDeadline, blockscout, type TxPage } from './campaigns';
import { nativeUsd } from './deploy';
import { ARC_LOG_CHUNK, recentChunks } from './events';
import { codesIn } from './builder-code';
import { gh } from './match-projects';
import { ErrorPageError, LINKCHECK_UA, RedirectError, SafeFetchError, errorPageText, safeFetchText, sameSite, type Resolver, type Transport } from './safe-fetch';
import { providerOfUrl, type Provider } from './read-usage';
import { sharedContract, tradeVenue } from './shared-contracts';
import { rpcFor } from './verify';

/**
 * v2.12 spec 2: one reader per source kind. Every outside read is injected (ReaderDeps), so tests
 * never touch the network and the cron passes the real, free, keyless sources. Readers return
 * signals only: who touched what and when. Anti-farming and scoring happen later. A reader may
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
  /** Blockscout, campaigns.ts blockscout. */
  baseTxs: (path: string) => Promise<TxPage>;
  /** Blockscout token transfers of a coin (Base), newest first. */
  tokenTransfers: (address: string, params: string) => Promise<{ items: { timestamp: string; from?: { hash?: string }; to?: { hash?: string } }[]; next_page_params: Record<string, unknown> | null }>;
  /** The creation transaction of a contract (Base: Blockscout; Arc: unreadable, nulls). */
  contractOrigin: (chain: 'base' | 'arc', address: string) => Promise<ContractOrigin>;
  arcLogs: (address: string, from: bigint, to: bigint) => Promise<{ tx: string }[]>;
  arcHead: () => Promise<bigint>;
  /** `input`: the transaction's calldata (its ERC-8021 codes are read from it). */
  arcSender: (tx: string) => Promise<{ from: string; value: bigint; at: string; input?: string }>;
  usdPerNative: (chain: 'base' | 'arc') => Promise<number>;
  /**
   * v2.12.1 T7: the contracts a wallet created (Base: Blockscout's transactions from it that created a
   * contract, at most READ_CAPS.walletPages pages). Asked only for a signed wallet (person_wallets).
   */
  walletCreations: (wallet: string) => Promise<{ address: string; created_at: string }[]>;
  now: Date;
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

export const READ_CAPS = { stargazerPages: 3, userLookups: 80, basePages: 20, arcSenders: 200, prs: 30, walletPages: 3 } as const;
/** GitHub's stargazer list ends at page 400 (40,000 stars); later pages answer 422. */
const STAR_LAST_PAGE = 400;
/** Below this many core GitHub requests left this hour, the run stops reading GitHub sources. */
export const GH_RATE_FLOOR = 1000;
/**
 * v2.12 final review I5: at most this many GitHub calls per cron run (discovery and source reads
 * together), on top of GH_RATE_FLOOR, so a backfill never spends the hour live find shares.
 */
export const GH_RUN_CAP = 1500;
/** A site read follows at most this many redirects, all within the same site (apex and www). */
export const SITE_MAX_REDIRECTS = 3;
const STAR = 'application/vnd.github.star+json';
const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
const REPO = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/(?!\.\.?$)[a-z0-9._-]{1,100}$/i;
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
/** Native wei as whole tokens times the price; unreadable values are 0. */
const priced = (wei: string | bigint | undefined, usd: number) => {
  try {
    return finite((Number(BigInt(wei ?? 0)) / 1e18) * usd);
  } catch {
    return 0;
  }
};

/** ISO 8601 week, 'YYYY-Www'. Pure. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Account ages already known from a source's previous reading (only real dates; unknowns are read again). */
export function knownAges(prev: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!prev || typeof prev !== 'object') return out;
  for (const key of ['stargazers', 'forkers', 'issue_authors', 'contributors'] as const) {
    const list = (prev as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    for (const w of list as Partial<Who>[])
      if (typeof w?.id === 'string' && typeof w.created_at === 'string' && !Number.isNaN(Date.parse(w.created_at))) out.set(w.id.toLowerCase(), w.created_at);
  }
  return out;
}

/**
 * `prev` is the source's previous reading (sources.ts previousSignals): account ages found there are
 * reused instead of read again.
 */
export async function readRepo(fullName: string, d: ReaderDeps, prev: unknown = null): Promise<RepoSignals> {
  if (!REPO.test(fullName)) throw new Error('not a repo name');
  const meta = await d.gh<{ owner: { login: string; type?: string }; private?: boolean; fork: boolean; is_template?: boolean; created_at?: string; stargazers_count?: number }>(`/repos/${fullName}`);
  const owner = meta.owner.login.toLowerCase();
  let partial = false;
  // Stargazers come oldest first: read the newest READ_CAPS.stargazerPages pages.
  const stars = typeof meta.stargazers_count === 'number' && Number.isFinite(meta.stargazers_count) ? Math.max(0, meta.stargazers_count) : null;
  const lastPage = stars === null ? 1 : Math.min(Math.ceil(stars / 100), STAR_LAST_PAGE);
  const firstPage = Math.max(1, lastPage - READ_CAPS.stargazerPages + 1);
  if (stars !== null && (firstPage > 1 || stars > STAR_LAST_PAGE * 100)) partial = true;
  const stargazers: Who[] = [];
  for (let page = firstPage; page <= lastPage; page++) {
    const rows = await d.gh<{ starred_at: string; user: { login: string } }[]>(`/repos/${fullName}/stargazers?per_page=100&page=${page}`, STAR);
    stargazers.push(...rows.map((r) => ({ id: `gh:${r.user.login.toLowerCase()}`, at: r.starred_at })));
    if (stars === null && rows.length >= 100) partial = true;
  }
  // One page each (the newest 100): a full page means there may be more.
  const forkRows = await d.gh<{ owner: { login: string }; created_at: string }[]>(`/repos/${fullName}/forks?per_page=100`);
  const issueRows = await d.gh<{ user: { login: string }; created_at: string; pull_request?: unknown }[]>(`/repos/${fullName}/issues?state=all&per_page=100`);
  if (forkRows.length >= 100 || issueRows.length >= 100) partial = true;
  const forkers = forkRows.map((f) => ({ id: `gh:${f.owner.login.toLowerCase()}`, at: f.created_at }));
  const issue_authors = issueRows.filter((i) => !i.pull_request).map((i) => ({ id: `gh:${i.user.login.toLowerCase()}`, at: i.created_at }));
  const contributors = (await d.gh<{ login: string }[]>(`/repos/${fullName}/contributors?per_page=100`)).map((c) => ({ id: `gh:${c.login.toLowerCase()}`, at: d.now.toISOString() }));
  const activity = await soft(d.gh<{ week: number; total: number }[]>(`/repos/${fullName}/stats/commit_activity`), []);
  const commit_weeks = (Array.isArray(activity) ? activity : [])
    .filter((w) => finite(w?.total) > 0 && Number.isFinite(w.week))
    .map((w) => isoWeek(new Date(w.week * 1000)));
  // Account ages for the fresh-account rule (R12): known ones reused, at most READ_CAPS.userLookups
  // new reads; the rest stay unknown (counted 50%).
  const outside = [...stargazers, ...forkers, ...issue_authors, ...contributors].filter((w) => w.id !== `gh:${owner}`);
  const known = knownAges(prev);
  const ages = new Map<string, string | null>();
  let lookups = 0;
  for (const w of outside) {
    if (ages.has(w.id)) continue;
    const cached = known.get(w.id);
    if (cached !== undefined) {
      ages.set(w.id, cached);
      continue;
    }
    if (lookups >= READ_CAPS.userLookups) {
      partial = true;
      continue;
    }
    lookups++;
    const login = w.id.slice(3);
    const user = LOGIN.test(login) ? await soft(d.gh<{ created_at?: string }>(`/users/${login}`), {} as { created_at?: string }) : {};
    ages.set(w.id, typeof user.created_at === 'string' ? user.created_at : null);
  }
  const aged = (ws: Who[]) => ws.map((w) => (ages.has(w.id) ? { ...w, created_at: ages.get(w.id) } : w));
  return {
    owner, owner_type: typeof meta.owner.type === 'string' ? meta.owner.type : 'User',
    private: typeof meta.private === 'boolean' ? meta.private : null,
    created_at: typeof meta.created_at === 'string' ? meta.created_at : null,
    fork: meta.fork === true, template: meta.is_template === true,
    stargazers: aged(stargazers), forkers: aged(forkers), issue_authors: aged(issue_authors), contributors: aged(contributors),
    commit_weeks: [...new Set(commit_weeks)], partial,
  };
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

export type CoinSignals = { traders: Who[]; partial: boolean };
const ZERO = '0x0000000000000000000000000000000000000000';
/**
 * v2.12.1 spec "What EarnKit measures": a coin's trades count toward Used. A trader is a wallet that
 * bought the coin since `since`: it received the coin from a pool or router (shared-contracts.ts
 * tradeVenue). An airdrop or a send from a person is not a trade. Never the coin itself, the zero
 * address, a shared contract or one of the person's own accounts (`self`, 'wallet:0x..'). `at` is the
 * wallet's first buy read (transfers come newest first: READ_CAPS.basePages pages of Blockscout).
 */
export async function readCoin(ref: string, since: Date, d: ReaderDeps, self: ReadonlySet<string>): Promise<CoinSignals> {
  const { chain, address } = contractRef(ref);
  if (chain !== 'base') throw new Error('coins are read on Base only');
  const seen = new Map<string, string>();
  const done = (partial: boolean) => ({ traders: [...seen].map(([id, at]) => ({ id, at })), partial });
  let params = '';
  for (let page = 0; page < READ_CAPS.basePages; page++) {
    const data = await d.tokenTransfers(address, params);
    for (const t of data.items) {
      if (!(new Date(t.timestamp) >= since)) return done(false);
      const from = t.from?.hash?.toLowerCase();
      if (!from || !tradeVenue(from)) continue;
      const to = t.to?.hash?.toLowerCase();
      if (!to || !ADDRESS.test(to) || to === address || to === ZERO || sharedContract(to) || self.has(`wallet:${to}`)) continue;
      // Newest first: the last one set is the wallet's earliest buy.
      seen.set(`wallet:${to}`, t.timestamp);
    }
    if (!data.next_page_params) return done(false);
    params = new URLSearchParams(Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  return done(true);
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

export async function readContract(ref: string, since: Date, d: ReaderDeps): Promise<ContractSignals> {
  const { chain, address } = contractRef(ref);
  const usd = await d.usdPerNative(chain);
  if (!Number.isFinite(usd) || usd < 0) throw new Error('no native price');
  const callers: ContractSignals['callers'] = [];
  if (chain === 'base') {
    let params = 'filter=to';
    for (let page = 0; page < READ_CAPS.basePages; page++) {
      const data = await d.baseTxs(`/api/v2/addresses/${address}/transactions?${params}`);
      for (const tx of data.items as (TxPage['items'][number] & { value?: string })[]) {
        if (!(new Date(tx.timestamp) >= since)) return { callers, partial: false };
        if (tx.status !== 'ok' || typeof tx.from?.hash !== 'string') continue;
        callers.push({ id: `wallet:${tx.from.hash.toLowerCase()}`, at: tx.timestamp, value_usd: priced(tx.value, usd), codes: codesIn(tx.raw_input) });
      }
      if (!data.next_page_params) return { callers, partial: false };
      params = new URLSearchParams(Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)])).toString();
    }
    return { callers, partial: true };
  }
  // Arc (R9): recent chunks only, newest first (logs within a chunk come oldest first, so reversed);
  // the newest READ_CAPS.arcSenders transactions are read. Daily readings accumulate the history.
  const head = await d.arcHead();
  const txs = new Set<string>();
  for (const [from, to] of recentChunks(head, ARC_LOG_CHUNK).reverse())
    for (const l of [...(await d.arcLogs(address, from, to))].reverse()) txs.add(l.tx);
  for (const tx of [...txs].slice(0, READ_CAPS.arcSenders)) {
    const s = await d.arcSender(tx);
    if (!(new Date(s.at) >= since)) continue;
    callers.push({ id: `wallet:${s.from.toLowerCase()}`, at: s.at, value_usd: priced(s.value, usd), codes: codesIn(s.input) });
  }
  return { callers, partial: txs.size > READ_CAPS.arcSenders };
}

/**
 * Merged PRs by `login` to repos they don't own, merged by someone else (a self-merged PR doesn't
 * count; an unreadable merger doesn't either). At most READ_CAPS.prs * 2 star lookups and as many
 * PR lookups; the top READ_CAPS.prs by target stars. v2.12 final review I2: `orgs` (the person's
 * GitHub orgs, discovery's /users/:login/orgs read) are their own too: PRs into them never count.
 */
export async function readMergedPrs(login: string, d: ReaderDeps, orgs: readonly string[] = []): Promise<PrSignals[]> {
  if (!LOGIN.test(login)) throw new Error('not a GitHub login');
  const me = login.toLowerCase();
  const own = new Set([me, ...orgs.map((o) => o.toLowerCase())]);
  const lookups = READ_CAPS.prs * 2;
  const q = encodeURIComponent(`type:pr author:${me} is:merged -user:${me}`);
  const found = await d.gh<{ items: { html_url: string; repository_url: string; pull_request?: { merged_at?: string | null } }[] }>(`/search/issues?q=${q}&per_page=100`);
  const stars = new Map<string, number>();
  const candidates: (PrSignals & { number: string })[] = [];
  for (const p of found.items) {
    if (typeof p.repository_url !== 'string' || typeof p.html_url !== 'string') continue;
    const target = p.repository_url.replace('https://api.github.com/repos/', '').toLowerCase();
    const number = /\/pull\/(\d{1,9})$/.exec(p.html_url)?.[1];
    if (!REPO.test(target) || own.has(target.split('/')[0]) || !number) continue;
    if (!stars.has(target)) {
      if (stars.size >= lookups) continue;
      stars.set(target, finite((await soft(d.gh<{ stargazers_count: number }>(`/repos/${target}`), { stargazers_count: 0 })).stargazers_count));
    }
    candidates.push({ target, target_stars: stars.get(target)!, merged_at: p.pull_request?.merged_at ?? null, author: me, number });
  }
  candidates.sort((a, b) => b.target_stars - a.target_stars);
  const out: PrSignals[] = [];
  let pulls = 0;
  for (const { number, ...pr } of candidates) {
    if (out.length >= READ_CAPS.prs || pulls >= lookups) break;
    pulls++;
    const full = await soft(d.gh<{ merged_by?: { login?: string } | null }>(`/repos/${pr.target}/pulls/${number}`), {} as { merged_by?: { login?: string } | null });
    const merger = full.merged_by?.login?.toLowerCase();
    if (!merger || merger === me) continue;
    out.push({ ...pr, url: `https://github.com/${pr.target}/pull/${number}` });
  }
  return out;
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
    if (!graphqlUsable(body)) throw new Error('GitHub GraphQL answered errors');
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
  let arc: ReturnType<typeof createPublicClient> | null = null;
  const arcClient = () => {
    if (arc) return arc;
    const rpc = rpcFor('arc');
    if (!rpc) throw new Error('no RPC for arc');
    arc = createPublicClient({ transport: http(rpc, { timeout: 10_000, retryCount: 0 }) });
    return arc;
  };
  const requests: NonNullable<ReaderDeps['requests']> = { tick: null };
  const tick = (p: Provider) => requests.tick?.(p);
  return {
    gh: <T>(path: string, accept?: string) => by(github<T>(path, accept, () => tick('github_rest'))),
    ghGraphql: <T>(query: string, variables: Record<string, unknown>) => by(githubGraphql<T>(query, variables, github, () => tick('github_graphql'))),
    probe: (url) => by(probeSite(url, { onRequest: () => tick('site') }).then(() => ({ status: 200 }))),
    fetchText: (url) => (tick('site'), by(safeFetchText(url))),
    json: <T>(url: string) => (tick(providerOfUrl(url)), by(packageJson<T>(url, deadline))),
    baseTxs: (path) => (tick('blockscout'), blockscout<TxPage>(path, deadline)),
    tokenTransfers: (address, params) => (tick('blockscout'), blockscout(`/api/v2/tokens/${address}/transfers${params ? `?${params}` : ''}`, deadline)),
    // Arc has no readable explorer API (Cloudflare challenge): its origin is unknown, so a repo_link is refused.
    contractOrigin: async (chain, address) => (chain === 'base' ? blockscoutOrigin(address, deadline, () => tick('blockscout')) : { deployer: null, created_at: null }),
    arcLogs: async (address, from, to) => {
      tick('arc_rpc');
      return (await by(arcClient().getLogs({ address: address as Address, fromBlock: from, toBlock: to }))).map((l) => ({ tx: l.transactionHash }));
    },
    arcHead: () => (tick('arc_rpc'), by(arcClient().getBlockNumber({ cacheTime: 0 }))),
    arcSender: async (tx) => {
      tick('arc_rpc');
      const t = await by(arcClient().getTransaction({ hash: tx as Hash }));
      if (t.blockNumber === null) throw new Error('pending transaction');
      tick('arc_rpc');
      const b = await by(arcClient().getBlock({ blockNumber: t.blockNumber }));
      return { from: t.from, value: t.value, at: new Date(Number(b.timestamp) * 1000).toISOString(), input: t.input };
    },
    usdPerNative: (chain) => by(nativeUsd(chain)),
    walletCreations: (wallet) => walletCreationsFrom(wallet, (path) => (tick('blockscout'), blockscout<CreationPage>(path, deadline))),
    now,
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
