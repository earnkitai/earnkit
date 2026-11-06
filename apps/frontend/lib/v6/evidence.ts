/**
 * The evidence for one project: live, onchain, code, team and depth rows from one repo read, its contracts
 * and its site, each row a fact with its basis and read time. Repo and contract blocks are kept 7 days in
 * evidence_cache (a repo only while pushed_at is unchanged); a partial block and the live rows never are.
 * Never throws for a failed read: it is null with a note, and `partial` says something is worth a retry.
 */
import { sql } from '../v5/db';
import { GitHubError, readRepo, readRepoObject, type RepoRead } from '../v5/github';
import { detectCode, repoKey } from '../v5/repo-facts';
import { safeProbePage } from '../v5/safe-fetch';
import { type Budget, type CodeRows, readCode } from './code';
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
};

type RepoBlock = {
  code: CodeRows;
  team: TeamRows;
  depth: DepthRows;
  contracts: { chain: string; address: string }[];
  repo_addresses: string[];
  homepage: string | null;
};

const DAY = 86_400_000;
const CACHE_DAYS = 7;
const MAX_CONTRACTS = 10;
const ZERO = `0x${'0'.repeat(40)}`;
/** Notes that say a read failed but a retry cannot change: no reader for the chain, a private repo. */
const FINAL = [/^not read: no explorer for /, /^not read: private or missing$/];

/** Whether a note holds a failed read worth retrying: a segment starting "not read". Pure. */
export function retryable(note: string | null): boolean {
  return (note ?? '').split('; ').some((s) => s.startsWith('not read') && !FINAL.some((re) => re.test(s)));
}

const counted = (f: typeof fetch, bump: () => void) =>
  ((input: RequestInfo | URL, init?: RequestInit) => {
    bump();
    return f(input, init);
  }) as typeof fetch;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasKeys = (v: unknown, keys: string[]) => isObject(v) && keys.every((k) => k in v);
const CODE_KEYS = ['fork_of', 'template_overlap', 'own_share', 'last_push_at', 'commits_90d', 'note'];
const TEAM_KEYS = ['contributors_90d', 'top_share', 'account_ages_days', 'logins', 'note'];
const ONCHAIN_KEYS = ['chain', 'address', 'mainnet', 'is_contract', 'deployer', 'tx_90d', 'senders_90d', 'funded_senders_90d', 'note'];
/** A cached repo block of the shape this code writes. Pure. */
function isRepoBlock(v: unknown): v is RepoBlock {
  return (
    isObject(v) && hasKeys(v.code, CODE_KEYS) && hasKeys(v.team, TEAM_KEYS) && Array.isArray((v.team as TeamRows).logins) &&
    hasKeys(v.depth, ['integrations', 'chains_mainnet', 'chains_testnet']) && Array.isArray(v.contracts) &&
    Array.isArray(v.repo_addresses) && (v.homepage === null || typeof v.homepage === 'string')
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

/** Reads every evidence block for a subject. Never throws for a failed read. */
export async function readEvidence(s: Subject, o: EvidenceDeps): Promise<Evidence> {
  const now = o.now;
  const read_at = now.toISOString();
  const useCache = o.cache !== false;
  const reads = { github: 0, explorer: 0, site: 0 };
  const gh = counted(o.gh ?? fetch, () => reads.github++);
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
    if (hit) {
      try {
        const obj = await readRepoObject(key, token, gh);
        if (obj.private) stop = 'not read: private or missing';
        else if (obj.pushed_at === hit.pushed_at) {
          block = hit.rows;
          repoReadAt = hit.read_at.toISOString();
        }
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) stop = 'not read: private or missing';
        else {
          // A transient failure on the check: the copy is under 7 days old, so it stands.
          block = hit.rows;
          repoReadAt = hit.read_at.toISOString();
        }
      }
      if (stop) await cacheForget(ck);
    }
    if (!block && !stop) {
      try {
        const read = await readRepo(key, { fetch: gh, token });
        const budget: Budget = { remaining: null, stopped: false };
        const g = { gh, token, now, budget };
        const code = await readCode(read, g);
        const team = await readTeam(read.repo.full_name, g);
        const paths = read.tree.filter((t) => t.type === 'blob').map((t) => t.path);
        block = {
          code,
          team,
          depth: readDepth(read),
          contracts: detectCode(read.files, paths).contracts,
          repo_addresses: addressesIn(read),
          homepage: read.repo.homepage?.trim() || null,
        };
        repoReadAt = read_at;
        // A budget stop, a failed tree or file read, or any other failed read: kept, never cached.
        if (read.partial || retryable(code.note) || retryable(team.note)) partial = true;
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

  // ---- contracts: the subject's first, then the repo's ----
  const seen = new Set<string>();
  const targets: { chain: string; address: string }[] = [];
  const given: unknown[] = Array.isArray(s.contracts) ? s.contracts : [];
  const wellFormed: { chain: string; address: string }[] = [];
  given.forEach((c, i) => {
    const why = contractProblem(c);
    if (why) notes.push(`contract ${i + 1} skipped: ${why}`);
    else wellFormed.push(c as { chain: string; address: string });
  });
  for (const c of [...wellFormed, ...(block?.contracts ?? [])]) {
    const t = { chain: c.chain.trim().toLowerCase(), address: c.address.trim().toLowerCase() };
    const id = `${t.chain}:${t.address}`;
    if (seen.has(id) || targets.length >= MAX_CONTRACTS) continue;
    seen.add(id);
    targets.push(t);
  }
  const repoAddresses = block?.repo_addresses ?? [];
  const onchain: OnchainRows[] = [];
  const onchainTimes: string[] = [];
  for (const t of targets) {
    const ck = `contract:${t.chain}:${t.address}`;
    const hit = useCache ? await cacheGet<OnchainRows>(ck, now, isOnchainRows) : null;
    if (hit) {
      const r = hit.rows;
      // Whether the deployer is listed depends on the repo asking, so it is worked out again.
      const mine = new Set(repoAddresses);
      onchain.push({ ...r, deployer_matches_repo: r.deployer ? mine.has(r.deployer) : null });
      onchainTimes.push(hit.read_at.toISOString());
      continue;
    }
    const explorer = (o.explorer ?? explorerFor)(t.chain, exFetch);
    const r = await readContract(t.chain, t.address, { explorer, repoAddresses, now });
    onchain.push(r);
    onchainTimes.push(read_at);
    if (retryable(r.note)) partial = true;
    else if (explorer && useCache) await cachePut(ck, 'contract', r, null, now);
  }

  const e: Evidence = {
    repo: key,
    live,
    onchain,
    code: block?.code ?? null,
    team: block?.team ?? null,
    depth: block?.depth ?? null,
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
