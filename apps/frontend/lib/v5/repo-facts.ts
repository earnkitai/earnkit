/**
 * What EarnKit knows about a project's code: a public GitHub repo read with its own token (cached
 * 7 days in repo_cache, re-read when pushed_at moves; swept after 30), merged with what the agent
 * reported. A private or unreadable repo, or one past the installation's daily uncached reads, is
 * reported only. Chains found in code carry basis 'code'.
 */
import { detectIntegrations } from '../v6/integrations';
import { builderCodesIn, KNOWN_TOKEN_ADDRESSES } from './code-signals';
import { CHAIN_REGISTRY, chainOfId } from './chains';
import { sql } from './db';
import { GitHubError, readRepo, readRepoObject, type RepoRead } from './github';
import { LIMITS, hit } from './rate-limit';
import { addressKey, type Project } from './project-input';

export type Basis = 'code' | 'reported';
/**
 * What the builder is told about the read, one sentence each (v6.1.8, B20 and C59): reads paused for the day, a
 * private repo, any other repo link not read (a 404, a non-GitHub link, an outage; fix round 1), a fork, an archived repo (counts as not live), an empty repo.
 */
export type RepoNote = 'paused' | 'private' | 'unread' | 'fork' | 'archived' | 'empty';
export type RepoFacts = {
  name: string;
  description: string;
  repo_url: string | null;
  /** Where each link came from: the code read ('code') or the agent's report ('reported'); null when absent. */
  repo_url_basis: Basis | null;
  live_url_basis: Basis | null;
  demo_url_basis: Basis | null;
  public: boolean;
  as_reported: boolean;
  live_url: string | null;
  demo_url: string | null;
  chains: { chain: string; mainnet: boolean; basis: Basis }[];
  contracts: { chain: string; address: string; basis?: Basis }[];
  builder_codes: boolean;
  /** Integration keys the code uses (v6/integrations.ts); none when only reported. */
  integrations: string[];
  /** null: not reported. */
  users: boolean | null;
  first_commit_at: string | null;
  last_commit_at: string | null;
  readme_excerpt: string | null;
  homepage: string | null;
  /** Why the repo was not read, when that is worth telling the agent. */
  problems?: string[];
  /** What the builder is told about the read, in this order; none when absent (built by hand). */
  notes?: RepoNote[];
};

type CodeFacts = Pick<RepoFacts, 'chains' | 'contracts' | 'builder_codes' | 'integrations' | 'first_commit_at' | 'last_commit_at' | 'readme_excerpt' | 'homepage'> & {
  html_url: string;
  pushed_at: string;
  /** From the repo object (v6.1.8); a row cached before has none of these, read as false and null. */
  fork?: boolean;
  archived?: boolean;
  empty?: boolean;
  /** The README's first sentence of prose, the stand-in for a description the agent left out (C58). */
  readme_lead?: string | null;
};
type Fetch = typeof fetch;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const ZERO = `0x${'0'.repeat(40)}`;

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

/** The first sentence of the README's first prose paragraph (no heading, badge, list, table or HTML), up to 280
 *  characters, no pictographs; null when there is none. Pure. */
export function readmeLead(md: string | null): string | null {
  if (!md) return null;
  const paragraphs = md.replace(/```[\s\S]*?```/g, '\n\n').replace(/<!--[\s\S]*?-->/g, ' ').split(/\n\s*\n/);
  for (const raw of paragraphs) {
    const p = raw.trim();
    if (!p || /^(#|!\[|\[!\[|<|\||[-*+]\s|\d+\.\s|>|={3,}|-{3,})/.test(p)) continue;
    const text = (readmeExcerpt(p) ?? '').replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').replace(/\s+/g, ' ').trim();
    if (text.split(' ').length < 3) continue;
    const sentence = /^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text;
    return sentence.slice(0, 280).trim();
  }
  return null;
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
    integrations: detectIntegrations(r.files, paths),
    first_commit_at: r.first_commit_at ?? r.repo.created_at,
    last_commit_at: r.repo.pushed_at,
    readme_excerpt: readmeExcerpt(r.readme),
    homepage: r.repo.homepage?.trim() || null,
    html_url: r.repo.html_url,
    pushed_at: r.repo.pushed_at,
    fork: r.repo.fork === true,
    archived: r.repo.archived === true,
    empty: r.repo.size === 0,
    readme_lead: readmeLead(r.readme),
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

/** A cached row from before integrations were read has none. Pure. */
const withIntegrations = (f: CodeFacts): CodeFacts => ({ ...f, integrations: f.integrations ?? [] });

/** The repo's code facts: from repo_cache while fresh and unpushed, else a new read. Throws when the repo cannot be read. */
async function cachedCodeFacts(key: string, f: Fetch, now: Date, installationId?: number): Promise<CodeFacts> {
  const [row] = await sql()<{ facts: CodeFacts; pushed_at: Date | null; fetched_at: Date }[]>`
    SELECT facts, pushed_at, fetched_at FROM repo_cache WHERE repo = ${key}`;
  const forget = () => sql()`DELETE FROM repo_cache WHERE repo = ${key}`;
  if (row) {
    const age = now.getTime() - row.fetched_at.getTime();
    if (age >= 0 && age < HOUR_MS) return withIntegrations(row.facts);
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
        return withIntegrations(row.facts);
      }
      if (live.private === true) {
        await forget();
        throw new GitHubError('GitHub: repo is private', 404);
      }
      if (Date.parse(live.pushed_at) === row.pushed_at.getTime()) return withIntegrations(row.facts);
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
 * stay with basis 'reported', and a reported mainnet stands where the code found the chain without one (C55): the
 * code adds chains and contracts, never removes a reported one or its mainnet. An archived repo's homepage is not
 * a live link (C59). A description left out is the README's first sentence (C58).
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
  const chains: RepoFacts['chains'] = (code?.chains ?? []).map((c) => ({ ...c }));
  const contracts: RepoFacts['contracts'] = (code?.contracts ?? []).map((c) => ({ ...c, basis: 'code' as const }));
  for (const c of project.chains ?? []) {
    const have = chains.find((x) => x.chain === c.chain);
    if (!have) chains.push({ chain: c.chain, mainnet: c.mainnet, basis: 'reported' });
    else if (c.mainnet) have.mainnet = true;
    const address = c.contract ? addressKey(c.chain, c.contract) : null;
    if (address && !contracts.some((x) => x.address === address)) contracts.push({ chain: c.chain, address, basis: 'reported' });
  }
  const archived = code?.archived === true;
  const homeLive = archived ? null : (code?.homepage ?? null);
  // A repo link given and not read is said once, with the one reason that applies.
  const unread: RepoNote[] = !project.repo_url || code ? [] : [paused ? 'paused' : project.private ? 'private' : 'unread'];
  const notes: RepoNote[] = [
    ...unread,
    ...(code?.fork ? (['fork'] as const) : []),
    ...(archived ? (['archived'] as const) : []),
    ...(code?.empty ? (['empty'] as const) : []),
  ];
  return {
    name: project.name,
    description: project.description || (code ? (code.readme_lead ?? readmeLead(code.readme_excerpt)) : null) || '',
    repo_url: code ? code.html_url : (project.repo_url ?? null),
    repo_url_basis: code ? 'code' : project.repo_url ? 'reported' : null,
    live_url_basis: project.live_url ? 'reported' : homeLive ? 'code' : null,
    demo_url_basis: project.demo_url ? 'reported' : null,
    public: code !== null,
    as_reported: code === null,
    live_url: project.live_url ?? homeLive,
    demo_url: project.demo_url ?? null,
    chains,
    contracts,
    builder_codes: Boolean(code?.builder_codes || project.builder_codes),
    integrations: code?.integrations ?? [],
    users: project.users ?? null,
    first_commit_at: code?.first_commit_at ?? project.first_commit_at ?? null,
    last_commit_at: code?.last_commit_at ?? project.last_commit_at ?? null,
    readme_excerpt: code?.readme_excerpt ?? null,
    homepage: code?.homepage ?? null,
    ...(paused ? { problems: [READS_PAUSED] } : {}),
    notes,
  };
}
