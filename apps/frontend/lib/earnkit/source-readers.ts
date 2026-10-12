import { createPublicClient, http, type Address, type Hash } from 'viem';
import { beforeDeadline, blockscout, type TxPage } from './campaigns';
import { nativeUsd } from './deploy';
import { ARC_LOG_CHUNK, recentChunks } from './events';
import { gh } from './match-projects';
import { safeFetchText, safeProbe } from './safe-fetch';
import { rpcFor } from './verify';

/**
 * v2.12 spec 2: one reader per source kind. Every outside read is injected (ReaderDeps), so tests
 * never touch the network and the cron passes the real, free, keyless sources. Readers return
 * signals only: who touched what and when. Anti-farming and scoring happen later. A reader may
 * throw; the caller writes a failed reading. Every id is lowercase ('gh:<login>', 'wallet:0x..'),
 * as anti-farming.ts expects, and every number is finite (score.ts does not guard NaN).
 */
export type Who = { id: string; at: string; created_at?: string | null };
export type RepoSignals = { owner: string; fork: boolean; template: boolean; stargazers: Who[]; forkers: Who[]; issue_authors: Who[]; contributors: Who[]; commit_weeks: string[]; partial: boolean };
export type SiteSignals = { status: number; up: boolean };
export type PackageSignals = { weekly: number; repo_url: string | null };
export type ContractSignals = { callers: (Who & { value_usd: number; first_tx_at?: string | null })[]; partial: boolean };
export type PrSignals = { target: string; target_stars: number; merged_at: string | null; author: string };
export type ReaderDeps = {
  gh: <T>(path: string, accept?: string) => Promise<T>;
  probe: (url: string) => Promise<{ status: number }>;
  fetchText: (url: string) => Promise<string>;
  /** npm and pypistats (public, keyless). */
  json: <T>(url: string) => Promise<T>;
  /** Blockscout, campaigns.ts blockscout. */
  baseTxs: (path: string) => Promise<TxPage>;
  arcLogs: (address: string, from: bigint, to: bigint) => Promise<{ tx: string }[]>;
  arcHead: () => Promise<bigint>;
  arcSender: (tx: string) => Promise<{ from: string; value: bigint; at: string }>;
  usdPerNative: (chain: 'base' | 'arc') => Promise<number>;
  now: Date;
};

export const READ_CAPS = { stargazerPages: 3, userLookups: 80, basePages: 20, arcSenders: 200, prs: 30 } as const;
const STAR = 'application/vnd.github.star+json';
const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
const REPO = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/(?!\.\.?$)[a-z0-9._-]{1,100}$/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

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

export async function readRepo(fullName: string, d: ReaderDeps): Promise<RepoSignals> {
  if (!REPO.test(fullName)) throw new Error('not a repo name');
  const meta = await d.gh<{ owner: { login: string }; fork: boolean; is_template?: boolean }>(`/repos/${fullName}`);
  const owner = meta.owner.login.toLowerCase();
  let partial = false;
  const stargazers: Who[] = [];
  for (let page = 1; page <= READ_CAPS.stargazerPages; page++) {
    const rows = await d.gh<{ starred_at: string; user: { login: string } }[]>(`/repos/${fullName}/stargazers?per_page=100&page=${page}`, STAR);
    stargazers.push(...rows.map((r) => ({ id: `gh:${r.user.login.toLowerCase()}`, at: r.starred_at })));
    if (rows.length < 100) break;
    if (page === READ_CAPS.stargazerPages) partial = true;
  }
  // One page each (the newest 100): a full page means there may be more.
  const forkRows = await d.gh<{ owner: { login: string }; created_at: string }[]>(`/repos/${fullName}/forks?per_page=100`);
  const issueRows = await d.gh<{ user: { login: string }; created_at: string; pull_request?: unknown }[]>(`/repos/${fullName}/issues?state=all&per_page=100`);
  if (forkRows.length >= 100 || issueRows.length >= 100) partial = true;
  const forkers = forkRows.map((f) => ({ id: `gh:${f.owner.login.toLowerCase()}`, at: f.created_at }));
  const issue_authors = issueRows.filter((i) => !i.pull_request).map((i) => ({ id: `gh:${i.user.login.toLowerCase()}`, at: i.created_at }));
  const contributors = (await d.gh<{ login: string }[]>(`/repos/${fullName}/contributors?per_page=100`)).map((c) => ({ id: `gh:${c.login.toLowerCase()}`, at: d.now.toISOString() }));
  const activity = await d.gh<{ week: number; total: number }[]>(`/repos/${fullName}/stats/commit_activity`).catch(() => []);
  const commit_weeks = (Array.isArray(activity) ? activity : [])
    .filter((w) => finite(w?.total) > 0 && Number.isFinite(w.week))
    .map((w) => isoWeek(new Date(w.week * 1000)));
  // Account ages for the fresh-account rule (R12), at most READ_CAPS.userLookups; the rest stay unknown (counted 50%).
  const outside = [...stargazers, ...forkers, ...issue_authors, ...contributors].filter((w) => w.id !== `gh:${owner}`);
  const ages = new Map<string, string | null>();
  for (const w of outside) {
    if (ages.has(w.id)) continue;
    if (ages.size >= READ_CAPS.userLookups) {
      partial = true;
      break;
    }
    const login = w.id.slice(3);
    const user = LOGIN.test(login) ? await d.gh<{ created_at?: string }>(`/users/${login}`).catch(() => ({ created_at: undefined })) : {};
    ages.set(w.id, typeof user.created_at === 'string' ? user.created_at : null);
  }
  const aged = (ws: Who[]) => ws.map((w) => (ages.has(w.id) ? { ...w, created_at: ages.get(w.id) } : w));
  return {
    owner, fork: meta.fork === true, template: meta.is_template === true,
    stargazers: aged(stargazers), forkers: aged(forkers), issue_authors: aged(issue_authors), contributors: aged(contributors),
    commit_weeks: [...new Set(commit_weeks)], partial,
  };
}

/** Up is any 2xx; a non-2xx or a thrown probe (refused host, DNS, timeout) is down, never an error. */
export async function readSite(origin: string, d: ReaderDeps): Promise<SiteSignals> {
  const status = await d.probe(origin).then((r) => finite(r.status), () => 0);
  return { status, up: status >= 200 && status < 300 };
}

const repoUrlOf = (raw: unknown): string | null => {
  const s = typeof raw === 'string' && raw.length <= 500 ? raw : null;
  const m = s && /github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/#].*)?$/.exec(s);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
};

export async function readNpm(name: string, d: ReaderDeps): Promise<PackageSignals> {
  const range = await d.json<{ downloads?: { day: string; downloads: number }[] }>(`https://api.npmjs.org/downloads/range/last-month/${encodeURIComponent(name)}`);
  if (!Array.isArray(range?.downloads)) throw new Error('npm downloads unreadable');
  const last28 = range.downloads.slice(-28);
  const weeks = [0, 1, 2, 3].map((i) => last28.slice(i * 7, i * 7 + 7).reduce((n, x) => n + finite(x?.downloads), 0));
  const meta = await d.json<{ repository?: { url?: string } | string }>(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
  const repo = typeof meta?.repository === 'string' ? meta.repository : meta?.repository?.url;
  return { weekly: finite(weeks.reduce((n, w) => n + w, 0) / 4), repo_url: repoUrlOf(repo) };
}

export async function readPypi(name: string, d: ReaderDeps): Promise<PackageSignals> {
  const recent = await d.json<{ data?: { last_month?: number } }>(`https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`);
  const month = recent?.data?.last_month;
  if (typeof month !== 'number' || !Number.isFinite(month)) throw new Error('pypi downloads unreadable');
  const meta = await d.json<{ info?: { project_urls?: Record<string, string> | null; home_page?: string | null } }>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  const urls = [...Object.values(meta?.info?.project_urls ?? {}), meta?.info?.home_page ?? ''];
  return { weekly: month / 4, repo_url: urls.map(repoUrlOf).find((u) => u !== null) ?? null };
}

export async function readContract(ref: string, since: Date, d: ReaderDeps): Promise<ContractSignals> {
  const [chain, address, ...rest] = ref.split(':');
  if ((chain !== 'base' && chain !== 'arc') || rest.length > 0 || !ADDRESS.test(address ?? '')) throw new Error('not a contract ref');
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
        callers.push({ id: `wallet:${tx.from.hash.toLowerCase()}`, at: tx.timestamp, value_usd: priced(tx.value, usd) });
      }
      if (!data.next_page_params) return { callers, partial: false };
      params = new URLSearchParams(Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)])).toString();
    }
    return { callers, partial: true };
  }
  // Arc (R9): recent chunks only, newest first; daily readings accumulate the history.
  const head = await d.arcHead();
  const txs = new Set<string>();
  for (const [from, to] of recentChunks(head, ARC_LOG_CHUNK).reverse())
    for (const l of await d.arcLogs(address, from, to)) txs.add(l.tx);
  for (const tx of [...txs].slice(0, READ_CAPS.arcSenders)) {
    const s = await d.arcSender(tx);
    if (!(new Date(s.at) >= since)) continue;
    callers.push({ id: `wallet:${s.from.toLowerCase()}`, at: s.at, value_usd: priced(s.value, usd) });
  }
  return { callers, partial: txs.size > READ_CAPS.arcSenders };
}

export async function readMergedPrs(login: string, d: ReaderDeps): Promise<PrSignals[]> {
  if (!LOGIN.test(login)) throw new Error('not a GitHub login');
  const me = login.toLowerCase();
  const q = encodeURIComponent(`type:pr author:${me} is:merged -user:${me}`);
  const found = await d.gh<{ items: { html_url: string; repository_url: string; pull_request?: { merged_at?: string | null } }[] }>(`/search/issues?q=${q}&per_page=100`);
  const prs = found.items.filter((i) => typeof i.repository_url === 'string' && !i.repository_url.toLowerCase().includes(`/repos/${me}/`));
  const stars = new Map<string, number>();
  const out: PrSignals[] = [];
  for (const p of prs) {
    const target = p.repository_url.replace('https://api.github.com/repos/', '').toLowerCase();
    if (!REPO.test(target)) continue;
    if (!stars.has(target))
      stars.set(target, finite((await d.gh<{ stargazers_count: number }>(`/repos/${target}`).catch(() => ({ stargazers_count: 0 }))).stargazers_count));
    out.push({ target, target_stars: stars.get(target)!, merged_at: p.pull_request?.merged_at ?? null, author: me });
  }
  return out.sort((a, b) => b.target_stars - a.target_stars).slice(0, READ_CAPS.prs);
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
  if (Number(res.headers.get('content-length')) > JSON_MAX_BYTES || !res.body) throw new Error('too large');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > JSON_MAX_BYTES) throw new Error('too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

/**
 * The real reads. Sites go through safe-fetch (public addresses only after DNS, https on 443, no
 * IP hosts, one same-site redirect re-vetted, size and time capped), so a site source can never
 * reach inside EarnKit's network. Every read stops at `deadline` (epoch ms).
 */
export function defaultReaderDeps(now: Date, deadline: number): ReaderDeps {
  const by = <T>(p: Promise<T>) => beforeDeadline(p, deadline);
  let arc: ReturnType<typeof createPublicClient> | null = null;
  const arcClient = () => {
    if (arc) return arc;
    const rpc = rpcFor('arc');
    if (!rpc) throw new Error('no RPC for arc');
    arc = createPublicClient({ transport: http(rpc, { timeout: 10_000, retryCount: 0 }) });
    return arc;
  };
  return {
    gh: <T>(path: string, accept?: string) => by(gh<T>(path, accept)),
    probe: (url) => by(safeProbe(url).then(() => ({ status: 200 }))),
    fetchText: (url) => by(safeFetchText(url)),
    json: <T>(url: string) => by(packageJson<T>(url, deadline)),
    baseTxs: (path) => blockscout<TxPage>(path, deadline),
    arcLogs: async (address, from, to) =>
      (await by(arcClient().getLogs({ address: address as Address, fromBlock: from, toBlock: to }))).map((l) => ({ tx: l.transactionHash })),
    arcHead: () => by(arcClient().getBlockNumber({ cacheTime: 0 })),
    arcSender: async (tx) => {
      const t = await by(arcClient().getTransaction({ hash: tx as Hash }));
      if (t.blockNumber === null) throw new Error('pending transaction');
      const b = await by(arcClient().getBlock({ blockNumber: t.blockNumber }));
      return { from: t.from, value: t.value, at: new Date(Number(b.timestamp) * 1000).toISOString() };
    },
    usdPerNative: (chain) => by(nativeUsd(chain)),
    now,
  };
}
