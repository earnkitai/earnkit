/**
 * What EarnKit knows about a project's code: a public GitHub repo read with its own token (cached
 * 7 days in repo_cache, re-read when pushed_at moves; swept after 30), merged with what the agent
 * reported. A private or unreadable repo, or one past the installation's daily uncached reads, is
 * reported only. Chains found in code carry basis 'code'.
 */
import { CHAIN_REGISTRY, chainOfId } from './chains';
import { sql } from './db';
import { GitHubError, readRepo, readRepoObject, type RepoRead } from './github';
import { LIMITS, hit } from './rate-limit';
import type { Project } from './project-input';

export type RepoFacts = {
  name: string;
  description: string;
  repo_url: string | null;
  public: boolean;
  as_reported: boolean;
  live_url: string | null;
  demo_url: string | null;
  chains: { chain: string; mainnet: boolean; basis: 'code' | 'reported' }[];
  contracts: { chain: string; address: string }[];
  builder_codes: boolean;
  /** null: not reported. */
  users: boolean | null;
  first_commit_at: string | null;
  last_commit_at: string | null;
  readme_excerpt: string | null;
  homepage: string | null;
  /** Why the repo was not read, when that is worth telling the agent. */
  problems?: string[];
};

type CodeFacts = Pick<RepoFacts, 'chains' | 'contracts' | 'builder_codes' | 'first_commit_at' | 'last_commit_at' | 'readme_excerpt' | 'homepage'> & {
  html_url: string;
  pushed_at: string;
};
type Fetch = typeof fetch;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const ZERO = `0x${'0'.repeat(40)}`;

/** Well-known token contracts (USDC, EURC, WETH, USDT) that config names but that are never the builder's own. */
const KNOWN_TOKEN_ADDRESSES: ReadonlySet<string> = new Set(
  [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    '0x3600000000000000000000000000000000000000',
    '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
    '0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD',
    '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
    '0x4200000000000000000000000000000000000006',
    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
  ].map((a) => a.toLowerCase()),
);

const SUFFIX_LITERAL = /0x[0-9a-f]*80218021802180218021802180218021\b/i;
/** True when source text carries Builder Codes (ERC-8021): the ox import, toDataSuffix, a dataSuffix key or the suffix literal. Pure. */
export function builderCodesIn(text: string): boolean {
  return text.includes('ox/erc8021') || text.includes('Attribution.toDataSuffix') || /\bdataSuffix\s*:/.test(text) || SUFFIX_LITERAL.test(text);
}

// ---- chain detection ----

type Hit = { mainnet: boolean };
const CHAIN_ID = /(?:chain[_-]?id|chainid|\bid)["']?\s*[:=]\s*["']?(\d{3,8})\b|--chain(?:-id)?\s+(\d{3,8})\b/gi;
const VIEM_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"](?:viem|wagmi)\/chains['"]/g;
const VIEM_NAMES: Record<string, [string, boolean]> = {
  base: ['base', true], baseSepolia: ['base', false],
  monad: ['monad', true], monadTestnet: ['monad', false],
  tempo: ['tempo', true], tempoModerato: ['tempo', false],
  arcTestnet: ['arc', false],
  avalanche: ['avalanche', true], avalancheFuji: ['avalanche', false],
  arbitrum: ['arbitrum', true], arbitrumSepolia: ['arbitrum', false],
  optimism: ['optimism', true], optimismSepolia: ['optimism', false],
  polygon: ['polygon', true], polygonAmoy: ['polygon', false],
  mainnet: ['ethereum', true], sepolia: ['ethereum', false],
};
const MAX_CONFIG_MAINNETS = 2;

/** The chains one file signals: registry hosts and ids, viem imports, Solana (web3.js, Anchor.toml). Pure. */
function chainsInFile(path: string, text: string): Map<string, Hit> {
  const found = new Map<string, Hit>();
  const mark = (chain: string, mainnet: boolean) => found.set(chain, { mainnet: mainnet || found.get(chain)?.mainnet === true });
  const lower = text.toLowerCase();
  for (const [slug, c] of Object.entries(CHAIN_REGISTRY)) {
    // A mainnet host inside a testnet host ("snowtrace.io" in "testnet.snowtrace.io") is not a mainnet signal.
    const noTest = c.testnet.hosts.reduce((t, h) => t.split(h).join(' '), lower);
    if (c.mainnet.hosts.some((h) => noTest.includes(h))) mark(slug, true);
    if (c.testnet.hosts.some((h) => lower.includes(h))) mark(slug, false);
  }
  for (const m of text.matchAll(CHAIN_ID)) {
    const hit = chainOfId(Number(m[1] ?? m[2]));
    if (hit) mark(hit.chain, hit.mainnet);
  }
  for (const m of text.matchAll(VIEM_IMPORT)) {
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0])) {
      const hit = VIEM_NAMES[name];
      if (hit) mark(hit[0], hit[1]);
    }
  }
  if (/(^|\/)Anchor\.toml$/.test(path) || /@solana\/web3\.js/.test(text)) {
    mark('solana', /\[programs\.mainnet\]|cluster\s*=\s*["']mainnet|mainnet-beta/i.test(text));
  }
  // A deploy config naming many mainnets is a template, not this project's deploy.
  if (/(^|\/)(hardhat\.config\.[cm]?[jt]s|foundry\.toml)$/.test(path) && [...found.values()].filter((h) => h.mainnet).length > MAX_CONFIG_MAINNETS) return new Map();
  return found;
}

/** Mainnet chains named by deploy folders: broadcast/<script>/<id>/ and ignition/deployments/chain-<id>/. Pure. */
function deployFolderChains(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (/(^|\/)(node_modules|lib|vendor)\//.test(p)) continue;
    const id = /(?:^|\/)broadcast\/[^/]+\/(\d{1,8})\/(?!dry-run\/)/.exec(p)?.[1] ?? /(?:^|\/)ignition\/deployments\/chain-(\d{1,8})\//.exec(p)?.[1];
    const hit = id ? chainOfId(Number(id)) : null;
    if (hit?.mainnet) out.push(hit.chain);
  }
  return out;
}

/** Chains and contract addresses from the picked files plus the tree's deploy folders. Pure. */
export function detectCode(files: { path: string; text: string }[], paths: string[]) {
  const chains = new Map<string, Hit>();
  const found: { chain: string; address: string }[] = [];
  for (const f of files) {
    const here = chainsInFile(f.path, f.text);
    for (const [chain, hit] of here) chains.set(chain, { mainnet: hit.mainnet || chains.get(chain)?.mainnet === true });
    // An address belongs to the file's own signalled chain; a chain slug as a whole word of the path
    // decides between several signals, or names the chain when the file has none. Else it is left out.
    const tokens = new Set(f.path.toLowerCase().split(/[/._-]+/));
    const bySlug = (slugs: string[]) => slugs.filter((c) => tokens.has(c));
    const signalled = [...here.keys()];
    const pool = signalled.length === 1 ? signalled : signalled.length > 1 ? bySlug(signalled) : bySlug(Object.keys(CHAIN_REGISTRY));
    if (pool.length !== 1) continue;
    for (const a of f.text.match(/\b0x[0-9a-fA-F]{40}\b/g) ?? []) {
      const address = a.toLowerCase();
      if (address !== ZERO && !KNOWN_TOKEN_ADDRESSES.has(address) && !found.some((c) => c.address === address)) found.push({ chain: pool[0], address });
    }
  }
  for (const chain of deployFolderChains(paths)) chains.set(chain, { mainnet: true });
  return {
    chains: [...chains].map(([chain, h]) => ({ chain, mainnet: h.mainnet, basis: 'code' as const })),
    contracts: found.filter((c) => chains.has(c.chain)).slice(0, 10),
  };
}

// ---- README ----

/** The first 2 KB of a README with markdown and HTML markup removed. Pure. */
export function readmeExcerpt(md: string | null): string | null {
  if (!md) return null;
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~|#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 2048) : null;
}

// ---- read and cache ----

/** "owner/name" lowercase from a github.com repo link, else null. Pure. */
export function repoKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== 'github.com' && u.hostname.toLowerCase() !== 'www.github.com') return null;
    const [owner, name] = u.pathname.split('/').filter(Boolean);
    const repo = name?.replace(/\.git$/i, '');
    return owner && repo && /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(repo) && !/^\.+$/.test(repo) ? `${owner}/${repo}`.toLowerCase() : null;
  } catch {
    return null;
  }
}

function codeFactsOf(r: RepoRead): CodeFacts {
  const paths = r.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  const { chains, contracts } = detectCode(r.files, paths);
  return {
    chains,
    contracts,
    builder_codes: r.files.some((f) => builderCodesIn(f.text)),
    first_commit_at: r.first_commit_at ?? r.repo.created_at,
    last_commit_at: r.repo.pushed_at,
    readme_excerpt: readmeExcerpt(r.readme),
    homepage: r.repo.homepage?.trim() || null,
    html_url: r.repo.html_url,
    pushed_at: r.repo.pushed_at,
  };
}

/** Thrown when an installation has used its uncached repo reads for the day. */
class ReadsPaused extends Error {}
export const READS_PAUSED = 'repo reads paused until tomorrow';

/** Counts one uncached read for the installation; throws ReadsPaused over the day's cap. */
async function countRead(installationId: number | undefined, now: Date) {
  if (installationId === undefined) return;
  const { limit, windowSeconds } = LIMITS.repoRead;
  if (!(await hit(`repoRead:${installationId}`, limit, windowSeconds, now)).allowed) throw new ReadsPaused();
}

/** Deletes repo_cache rows read over 30 days ago; the count deleted. */
export async function sweepRepoCache(now: Date): Promise<number> {
  const rows = await sql()`DELETE FROM repo_cache WHERE fetched_at < ${new Date(now.getTime() - 30 * DAY_MS)} RETURNING repo`;
  return rows.length;
}

/** The repo's code facts: from repo_cache while fresh and unpushed, else a new read. Throws when the repo cannot be read. */
async function cachedCodeFacts(key: string, f: Fetch, now: Date, installationId?: number): Promise<CodeFacts> {
  const [row] = await sql()<{ facts: CodeFacts; pushed_at: Date | null; fetched_at: Date }[]>`
    SELECT facts, pushed_at, fetched_at FROM repo_cache WHERE repo = ${key}`;
  const forget = () => sql()`DELETE FROM repo_cache WHERE repo = ${key}`;
  if (row) {
    const age = now.getTime() - row.fetched_at.getTime();
    if (age >= 0 && age < HOUR_MS) return row.facts;
    if (age >= 0 && age < 7 * DAY_MS && row.pushed_at) {
      let live;
      try {
        live = await readRepoObject(key, undefined, f);
      } catch (err) {
        // Gone or private: unreadable, so the cached copy must not outlive it. Anything else is transient.
        if (err instanceof GitHubError && err.status === 404) {
          await forget();
          throw err;
        }
        return row.facts;
      }
      if (live.private === true) {
        await forget();
        throw new GitHubError('GitHub: repo is private', 404);
      }
      if (Date.parse(live.pushed_at) === row.pushed_at.getTime()) return row.facts;
    }
  }
  await countRead(installationId, now);
  let read: RepoRead;
  try {
    read = await readRepo(key, { fetch: f });
  } catch (err) {
    if (row && err instanceof GitHubError && err.status === 404) await forget();
    throw err;
  }
  const facts = codeFactsOf(read);
  // A partial read (a failed tree or file) is returned but never cached.
  if (!read.partial) {
    await sql()`
      INSERT INTO repo_cache (repo, facts, fetched_at, pushed_at) VALUES (${key}, ${sql().json(facts)}, ${now}, ${facts.pushed_at})
      ON CONFLICT (repo) DO UPDATE SET facts = EXCLUDED.facts, fetched_at = EXCLUDED.fetched_at, pushed_at = EXCLUDED.pushed_at`;
  }
  return facts;
}

/**
 * The facts for a project: its public GitHub repo read and cached, then the agent's report merged in.
 * The report fills what the read lacks; its live_url and demo_url win; reported chains the code lacks
 * stay with basis 'reported'.
 */
export async function repoFacts(project: Project, deps: { gh?: Fetch; now?: Date; installationId?: number } = {}): Promise<RepoFacts> {
  const key = project.private ? null : repoKey(project.repo_url);
  let code: CodeFacts | null = null;
  let paused = false;
  if (key) {
    try {
      code = await cachedCodeFacts(key, deps.gh ?? fetch, deps.now ?? new Date(), deps.installationId);
    } catch (err) {
      paused = err instanceof ReadsPaused;
      code = null;
    }
  }
  const chains: RepoFacts['chains'] = [...(code?.chains ?? [])];
  const contracts: RepoFacts['contracts'] = [...(code?.contracts ?? [])];
  for (const c of project.chains ?? []) {
    if (!chains.some((x) => x.chain === c.chain)) chains.push({ chain: c.chain, mainnet: c.mainnet, basis: 'reported' });
    if (c.contract && !contracts.some((x) => x.address === c.contract!.toLowerCase())) contracts.push({ chain: c.chain, address: c.contract.toLowerCase() });
  }
  return {
    name: project.name,
    description: project.description,
    repo_url: code ? code.html_url : (project.repo_url ?? null),
    public: code !== null,
    as_reported: code === null,
    live_url: project.live_url ?? code?.homepage ?? null,
    demo_url: project.demo_url ?? null,
    chains,
    contracts,
    builder_codes: Boolean(code?.builder_codes || project.builder_codes),
    users: project.users ?? null,
    first_commit_at: code?.first_commit_at ?? project.first_commit_at ?? null,
    last_commit_at: code?.last_commit_at ?? project.last_commit_at ?? null,
    readme_excerpt: code?.readme_excerpt ?? null,
    homepage: code?.homepage ?? null,
    ...(paused ? { problems: [READS_PAUSED] } : {}),
  };
}
