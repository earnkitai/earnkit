/**
 * The evidence for one project: live, onchain, code, team and depth rows from one repo read, its contracts
 * (each counted toward placement only when plausibly the builder's) and its site, each row a fact with its
 * basis and read time. Repo and contract blocks are kept 7 days in evidence_cache; a partial block and the
 * live rows never are. Never throws for a failed read: it is null with a note, and `partial` says so.
 */
import { chainOfId } from '../v5/chains';
import { sql } from '../v5/db';
import { GitHubError, rateRemaining, readRepo, readRepoObject, type RepoRead } from '../v5/github';
import { detectCode, repoKey } from '../v5/repo-facts';
import { safeProbePage } from '../v5/safe-fetch';
import { type Budget, type CodeRows, forkRef, noteBudget, readCode, starterMaintainers } from './code';
import { type DepthRows, readDepth } from './depth';
import { type Explorer, explorerFor } from './explorers';
import { type LiveRows, type Rdap, rdapOrg, readLive } from './live';
import { type OnchainRows, readContract } from './onchain';
import { readTeam, type TeamRows } from './team';

export type Row = {
  key: string;
  value: string | number | boolean | string[] | number[] | null;
  basis: 'github' | 'explorer' | 'rpc' | 'site' | 'record' | 'earnkit';
  read_at: string;
  note: string | null;
};
export type Evidence = {
  /** "owner/name" lowercase, or null when there is no GitHub repo. */
  repo: string | null;
  live: LiveRows;
  onchain: OnchainRows[];
  code: CodeRows | null;
  team: TeamRows | null;
  depth: DepthRows | null;
  rows: Row[];
  reads: { github: number; explorer: number; site: number };
  partial: boolean;
  read_at: string;
  /** Why a block is missing as a whole (no repo on GitHub, a private repo). */
  notes: string[];
  /** When the repo block and each contract were read (earlier than read_at when cached). */
  read_times: { repo: string | null; onchain: string[] };
};
export type Subject = { repo_url?: string; live_url?: string; contracts?: { chain: string; address: string }[] };
export type EvidenceDeps = {
  gh?: typeof fetch;
  /** A chain's explorer reader over `f` (requests through `f` are counted). Default explorerFor. */
  explorer?: (chain: string, f: typeof fetch) => Explorer | null;
  explorerFetch?: typeof fetch;
  probe?: typeof safeProbePage;
  rdap?: Rdap;
  now: Date;
  /** Read and write evidence_cache (default true). */
  cache?: boolean;
  /** The GitHub allowance, shared across a run's applicants (default: a fresh one for this read). */
  budget?: Budget;
};

type RepoBlock = {
  code: CodeRows;
  team: TeamRows;
  depth: DepthRows;
  contracts: { chain: string; address: string }[];
  /** Contracts created by the repo's own deploy runs (broadcast/, ignition/deployments/). */
  deploy_contracts: { chain: string; address: string }[];
  repo_addresses: string[];
  homepage: string | null;
};

const DAY = 86_400_000;
const CACHE_DAYS = 7;
const MAX_CONTRACTS = 10;
const ZERO = `0x${'0'.repeat(40)}`;
/** Notes that say a read failed but a retry cannot change: no reader for the chain, a private repo. */
const FINAL = [/^not read: no explorer for /, /^not read: private or missing$/, /^not read: parent gone$/];

/** Whether a note holds a failed read worth retrying: a segment starting "not read". Pure. */
export function retryable(note: string | null): boolean {
  return (note ?? '').split('; ').some((s) => s.startsWith('not read') && !FINAL.some((re) => re.test(s)));
}

const counted = (f: typeof fetch, bump: () => void) =>
  ((input: RequestInfo | URL, init?: RequestInit) => {
    bump();
    return f(input, init);
  }) as typeof fetch;
/** Every core API answer updates the budget (the search API has its own limit, so it never does). */
const budgeted = (f: typeof fetch, b: Budget) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await f(input, init);
    const url = String(input);
    if (url.startsWith('https://api.github.com/') && !url.startsWith('https://api.github.com/search/') && rateRemaining(res) !== null) noteBudget(b, res);
    return res;
  }) as typeof fetch;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasKeys = (v: unknown, keys: string[]) => isObject(v) && keys.every((k) => k in v);
const CODE_KEYS = ['fork_of', 'template_overlap', 'own_share', 'commits_own', 'files_own', 'last_push_at', 'commits_90d', 'commits_60d', 'note'];
const TEAM_KEYS = ['contributors_90d', 'top_share', 'account_ages_days', 'logins', 'note'];
const ONCHAIN_KEYS = ['chain', 'address', 'mainnet', 'is_contract', 'deployer', 'tx_90d', 'senders_90d', 'funded_senders_90d', 'note'];
/** A cached repo block of the shape this code writes. Pure. */
function isRepoBlock(v: unknown): v is RepoBlock {
  return (
    isObject(v) && hasKeys(v.code, CODE_KEYS) && hasKeys(v.team, TEAM_KEYS) && Array.isArray((v.team as TeamRows).logins) &&
    hasKeys(v.depth, ['integrations', 'chains_mainnet', 'chains_testnet']) && Array.isArray(v.contracts) &&
    Array.isArray(v.deploy_contracts) && Array.isArray(v.repo_addresses) && (v.homepage === null || typeof v.homepage === 'string')
  );
}
/** Cached contract rows of the shape this code writes. Pure. */
function isOnchainRows(v: unknown): v is OnchainRows {
  return hasKeys(v, ONCHAIN_KEYS) && typeof (v as OnchainRows).chain === 'string' && typeof (v as OnchainRows).address === 'string';
}

/** A cache row under 7 days old whose rows have the expected shape; anything else is a miss. */
async function cacheGet<T>(key: string, now: Date, valid: (v: unknown) => v is T): Promise<{ rows: T; pushed_at: string | null; read_at: Date } | null> {
  try {
    const [row] = await sql()<{ rows: T; pushed_at: string | null; read_at: Date }[]>`
      SELECT rows, pushed_at, read_at FROM evidence_cache WHERE key = ${key}`;
    if (!row || !valid(row.rows)) return null;
    const age = now.getTime() - row.read_at.getTime();
    return age >= 0 && age < CACHE_DAYS * DAY ? row : null;
  } catch {
    return null;
  }
}
async function cachePut(key: string, kind: 'repo' | 'contract', rows: unknown, pushed_at: string | null, now: Date): Promise<void> {
  try {
    await sql()`
      INSERT INTO evidence_cache (key, kind, rows, pushed_at, read_at) VALUES (${key}, ${kind}, ${sql().json(rows as never)}, ${pushed_at}, ${now})
      ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, rows = EXCLUDED.rows, pushed_at = EXCLUDED.pushed_at, read_at = EXCLUDED.read_at`;
  } catch {
    // A cache write that fails costs a re-read later, nothing else.
  }
}
async function cacheForget(key: string): Promise<void> {
  try {
    await sql()`DELETE FROM evidence_cache WHERE key = ${key}`;
  } catch {
    // As above.
  }
}

/** Why the repo could not be read. */
const repoWhy = (e: unknown): string => {
  if (!(e instanceof GitHubError)) return 'not read: github unreachable';
  if (e.status === 404) return 'not read: private or missing';
  if ((e.status === 403 || e.status === 429) && e.remaining === 0) return 'not read: budget';
  return `not read: github ${e.status ?? 'error'}`;
};

/** Why a subject's contract cannot be read (no chain, not a 0x address), or null. Pure. */
function contractProblem(c: unknown): string | null {
  if (!isObject(c)) return 'not a contract';
  if (typeof c.chain !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/i.test(c.chain.trim())) return 'no chain';
  if (typeof c.address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(c.address.trim())) return 'not a 0x address';
  return null;
}

/** Every 0x address in the picked files and the README, lowercased: where a deployer may be listed. */
function addressesIn(read: RepoRead): string[] {
  const texts = [...read.files.map((f) => f.text), read.readme ?? ''];
  const found = new Set(texts.flatMap((t) => (t.match(/\b0x[0-9a-fA-F]{40}\b/g) ?? []).map((a) => a.toLowerCase())));
  found.delete(ZERO);
  return [...found];
}

const DEPLOY_FILE = /(?:^|\/)broadcast\/[^/]+\/(\d{1,8})\/run-latest\.json$|(?:^|\/)ignition\/deployments\/chain-(\d{1,8})\/deployed_addresses\.json$/;
/** Deploy-run files read per repo. */
const MAX_DEPLOY_FILES = 3;

/** The repo's deploy-run files on a mainnet (Foundry broadcast, Hardhat Ignition), with their chain. Pure. */
export function deployFiles(paths: string[]): { path: string; chain: string }[] {
  const out: { path: string; chain: string }[] = [];
  for (const p of paths) {
    if (/(^|\/)(node_modules|lib|vendor)\//.test(p)) continue;
    const m = DEPLOY_FILE.exec(p);
    const hit = m ? chainOfId(Number(m[1] ?? m[2])) : null;
    if (hit?.mainnet && out.length < MAX_DEPLOY_FILES) out.push({ path: p, chain: hit.chain });
  }
  return out;
}

const ADDRESS = /^0x[0-9a-f]{40}$/i;
/** The contracts a deploy-run file says were created: CREATE and CREATE2 runs and their extra contracts, or Ignition's list. Pure. */
export function createdIn(text: string): string[] {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isObject(body)) return [];
  const out: unknown[] = [];
  if (Array.isArray(body.transactions)) {
    for (const t of body.transactions) {
      if (!isObject(t) || !/^CREATE2?$/.test(String(t.transactionType))) continue;
      out.push(t.contractAddress);
      if (Array.isArray(t.additionalContracts)) out.push(...t.additionalContracts.map((c) => (isObject(c) ? c.address : null)));
    }
  } else out.push(...Object.values(body));
  return [...new Set(out.filter((a): a is string => typeof a === 'string' && ADDRESS.test(a)).map((a) => a.toLowerCase()))];
}

/** Reads the deploy-run files from raw.githubusercontent.com: the contracts and whether any read failed. */
async function readDeployContracts(read: RepoRead, paths: string[], f: typeof fetch) {
  const contracts: { chain: string; address: string }[] = [];
  let failed = false;
  for (const { path, chain } of deployFiles(paths)) {
    const url = `https://raw.githubusercontent.com/${read.repo.full_name}/${encodeURIComponent(read.repo.default_branch)}/${path.split('/').map(encodeURIComponent).join('/')}`;
    try {
      const res = await f(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`raw ${res.status}`);
      for (const address of createdIn(await res.text())) if (address !== ZERO) contracts.push({ chain, address });
    } catch {
      failed = true;
    }
  }
  return { contracts, failed };
}

/** Where a contract came from: the applicant's list, the repo's deploy runs, or named in the repo's files. */
export type ContractSource = 'subject' | 'deploy' | 'repo';
/**
 * Whether a contract counts toward placement, and why: the repo's deployer, its deploy runs, or a deploy
 * after the repo's first commit make it plausibly the builder's. A contract only named in the repo (a
 * router, an entry point, a price feed) never counts; a listed one counts unless the deployer is not in
 * the repo and it predates the repo. Pure.
 */
export function countedBy(c: OnchainRows, from: ContractSource, firstCommitAt: string | null): { counted: boolean; counted_reason: string } {
  if (c.deployer_matches_repo === true) return { counted: true, counted_reason: 'deployer is in the repo' };
  if (from === 'deploy') return { counted: true, counted_reason: 'from a deploy folder' };
  const deployed = c.deployed_at ? Date.parse(c.deployed_at) : NaN;
  const first = firstCommitAt ? Date.parse(firstCommitAt) : NaN;
  const known = Number.isFinite(deployed) && Number.isFinite(first);
  if (known && deployed >= first) return { counted: true, counted_reason: "deployed after the repo's first commit" };
  if (from === 'repo') return { counted: false, counted_reason: 'named in the repo, not counted' };
  if (known && c.deployer_matches_repo === false) return { counted: false, counted_reason: 'claimed; deployer not in the repo and deployed before the repo' };
  return { counted: true, counted_reason: 'listed by the applicant' };
}

/** Reads every evidence block for a subject. Never throws for a failed read. */
export async function readEvidence(s: Subject, o: EvidenceDeps): Promise<Evidence> {
  const now = o.now;
  const read_at = now.toISOString();
  const useCache = o.cache !== false;
  const reads = { github: 0, explorer: 0, site: 0 };
  const budget: Budget = o.budget ?? { remaining: null, stopped: false };
  const gh = budgeted(counted(o.gh ?? fetch, () => reads.github++), budget);
  const exFetch = counted(o.explorerFetch ?? fetch, () => reads.explorer++);
  const token = process.env.GITHUB_TOKEN;
  const notes: string[] = [];
  let partial = false;

  // ---- the repo: code, team and depth from one read ----
  const key = typeof s.repo_url === 'string' ? repoKey(s.repo_url) : null;
  if (s.repo_url && !key) notes.push('repo not on github');
  let block: RepoBlock | null = null;
  let repoReadAt: string | null = null;
  if (key) {
    const ck = `repo:${key}`;
    const hit = useCache ? await cacheGet<RepoBlock>(ck, now, isRepoBlock) : null;
    let stop: string | null = null;
    let keep = false;
    // With the run's budget spent, a copy under 7 days old stands unchecked; without one the repo waits.
    if (hit && budget.stopped) keep = true;
    else if (hit) {
      try {
        const obj = await readRepoObject(key, token, gh);
        if (obj.private) stop = 'not read: private or missing';
        else keep = obj.pushed_at === hit.pushed_at;
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) stop = 'not read: private or missing';
        // A transient failure on the check: the copy is under 7 days old, so it stands.
        else keep = true;
      }
      if (stop) await cacheForget(ck);
    }
    if (hit && keep) {
      block = hit.rows;
      repoReadAt = hit.read_at.toISOString();
    }
    if (!block && !stop && budget.stopped) stop = 'not read: budget';
    if (!block && !stop) {
      try {
        const read = await readRepo(key, { fetch: gh, token });
        const g = { gh, token, now, budget };
        const code = await readCode(read, g);
        const team = await readTeam(read.repo.full_name, g, { fork: forkRef(read), drop: starterMaintainers(code.template_name) });
        const paths = read.tree.filter((t) => t.type === 'blob').map((t) => t.path);
        const deploy = await readDeployContracts(read, paths, gh);
        block = {
          code,
          team,
          depth: readDepth(read),
          contracts: detectCode(read.files, paths).contracts,
          deploy_contracts: deploy.contracts,
          repo_addresses: addressesIn(read),
          homepage: read.repo.homepage?.trim() || null,
        };
        repoReadAt = read_at;
        // A budget stop, a failed tree, file or deploy-run read, or any other failed read: kept, never cached.
        if (read.partial || deploy.failed || retryable(code.note) || retryable(team.note)) partial = true;
        else if (useCache) await cachePut(ck, 'repo', block, read.repo.pushed_at, now);
      } catch (e) {
        stop = repoWhy(e);
        if (hit && stop === 'not read: private or missing') await cacheForget(ck);
      }
    }
    if (stop) {
      notes.push(stop);
      if (retryable(stop)) partial = true;
    }
  }

  // ---- the site ----
  const realProbe = o.probe ?? safeProbePage;
  const probe: typeof safeProbePage = (url, deps) => (reads.site++, realProbe(url, deps));
  const realRdap = o.rdap ?? rdapOrg;
  const rdap: Rdap = (d) => (reads.site++, realRdap(d));
  const liveUrl = typeof s.live_url === 'string' && s.live_url.trim() ? s.live_url : (block?.homepage ?? null);
  const live = await readLive(liveUrl, { probe, rdap, now });
  if (retryable(live.note)) partial = true;

  // ---- contracts: the subject's first, then the repo's deploy runs, then those named in its files ----
  const seen = new Set<string>();
  const targets: { chain: string; address: string; from: ContractSource }[] = [];
  const given: unknown[] = Array.isArray(s.contracts) ? s.contracts : [];
  const wellFormed: { chain: string; address: string }[] = [];
  given.forEach((c, i) => {
    const why = contractProblem(c);
    if (why) notes.push(`contract ${i + 1} skipped: ${why}`);
    else wellFormed.push(c as { chain: string; address: string });
  });
  const b = block;
  const sources: [ContractSource, { chain: string; address: string }[]][] = [
    ['subject', wellFormed], ['deploy', b?.deploy_contracts ?? []], ['repo', b?.contracts ?? []],
  ];
  for (const [from, list] of sources) {
    for (const c of list) {
      const t = { chain: c.chain.trim().toLowerCase(), address: c.address.trim().toLowerCase(), from };
      const id = `${t.chain}:${t.address}`;
      if (seen.has(id) || targets.length >= MAX_CONTRACTS) continue;
      seen.add(id);
      targets.push(t);
    }
  }
  const repoAddresses = b?.repo_addresses ?? [];
  const firstCommitAt = b?.code.first_commit_at ?? null;
  const onchain: OnchainRows[] = [];
  const onchainTimes: string[] = [];
  for (const t of targets) {
    const ck = `contract:${t.chain}:${t.address}`;
    const hit = useCache ? await cacheGet<OnchainRows>(ck, now, isOnchainRows) : null;
    let r: OnchainRows;
    if (hit) {
      // Whether the deployer is listed, and so whether it counts, depends on the repo asking: worked out again.
      const mine = new Set(repoAddresses);
      r = { ...hit.rows, deployer_matches_repo: hit.rows.deployer ? mine.has(hit.rows.deployer) : null };
      onchainTimes.push(hit.read_at.toISOString());
    } else {
      const explorer = (o.explorer ?? explorerFor)(t.chain, exFetch);
      r = await readContract(t.chain, t.address, { explorer, repoAddresses, now });
      onchainTimes.push(read_at);
      if (retryable(r.note)) partial = true;
      else if (explorer && useCache) await cachePut(ck, 'contract', r, null, now);
    }
    onchain.push({ ...r, ...countedBy(r, t.from, firstCommitAt) });
  }

  const e: Evidence = {
    repo: key,
    live,
    onchain,
    code: b?.code ?? null,
    team: b?.team ?? null,
    depth: b?.depth ?? null,
    rows: [],
    reads,
    partial,
    read_at,
    notes,
    read_times: { repo: repoReadAt, onchain: onchainTimes },
  };
  e.rows = flattenRows(e);
  return e;
}

/** Labels on rows that are not plain reads. */
const LABEL: Record<string, string> = {
  'live.is_app': 'heuristic: a form, a script bundle or a wallet connect',
  'live.domain_age_days': 'from RDAP',
};

/** Readers' notes that limit rows without naming them. */
const ALIASES: [RegExp, string[]][] = [
  [/^contributors beyond \d+ not read/, ['logins', 'account_ages_days', 'prior_repos_used']],
  [/^commits window capped at/, ['contributors_90d', 'top_share', 'logins']],
  [/^counted the latest \d+ transactions only/, ['tx_90d', 'senders_90d', 'senders_30d', 'funded_senders_90d']],
  [/sampled senders not read$/, ['funded_senders_90d']],
  [/^\d+ starter maintainers? not counted$/, ['logins', 'contributors_90d', 'top_share']],
];
const escape = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether a note segment names row `k`: the key as a word followed by a space, a colon or the end, or an alias. Pure. */
function namesRow(seg: string, k: string): boolean {
  if (new RegExp(`(^|[^\\w])${escape(k)}(?=[ :]|$)`).test(seg)) return true;
  return ALIASES.some(([re, keys]) => re.test(seg) && keys.includes(k));
}

/** Every scalar of the typed blocks as a row with its basis and read time; arrays stay arrays. Pure. */
export function flattenRows(e: Evidence): Row[] {
  const rows: Row[] = [];
  const add = (prefix: string, block: Record<string, unknown> | null, basis: Row['basis'], at: string, label = prefix) => {
    if (!block) return;
    const segments = typeof block.note === 'string' ? block.note.split('; ') : [];
    const keys = Object.keys(block).filter((k) => k !== 'note');
    const names = (seg: string) => keys.filter((k) => namesRow(seg, k));
    for (const k of keys) {
      const v = block[k];
      const key = `${prefix}.${k}`;
      const tag = LABEL[`${label}.${k}`] ?? null;
      const value = v === undefined ? null : (v as Row['value']);
      // Every row carries the note segments naming it; a null row with none carries those naming no row (the block's).
      const own = segments.filter((seg) => names(seg).includes(k));
      const why = own.length || value !== null ? own : segments.filter((seg) => names(seg).length === 0);
      const note = [tag, ...why].filter(Boolean).join('; ') || null;
      rows.push({ key, value, basis, read_at: at, note });
    }
  };
  add('live', e.live, 'site', e.read_at);
  e.onchain.forEach((c, i) => {
    add(`onchain[${i}]`, c, 'explorer', e.read_times.onchain[i] ?? e.read_at, 'onchain');
    const f = rows.find((r) => r.key === `onchain[${i}].funded_senders_90d`);
    if (f && f.value !== null && c.funded_sample !== null) f.note = [`within ${c.funded_sample} sampled senders`, f.note].filter(Boolean).join('; ');
  });
  const repoAt = e.read_times.repo ?? e.read_at;
  add('code', e.code, 'github', repoAt);
  add('team', e.team, 'github', repoAt);
  add('depth', e.depth, 'github', repoAt);
  return rows;
}
