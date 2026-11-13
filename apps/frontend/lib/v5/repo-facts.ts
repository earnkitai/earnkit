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
import { GitHubError, GitHubSlow, RepoPrivateError, gh, isPublicMember, readBudget, readRepo, readRepoObject, type RepoRead } from './github';
import { LIMITS, hit, uncountHit } from './rate-limit';
import { addressKey, canonicalRepoLink, type Project } from './project-input';
import { cleanText } from './controls';
import { MANIFEST_PATH, manifestUrl } from './funding-manifest';

export type Basis = 'code' | 'reported';
/**
 * What the builder is told about the read, one sentence each (v6.1.8, B20 and C59): reads paused for the day, a
 * private repo, a public repo on another code host (EarnKit reads GitHub only, L1g-3 v6.1.15), any other repo link not
 * read (a 404, an outage; fix round 1), a fork, an archived repo (counts as not live), an empty repo,
 * Builder Codes reported but not in the code read (v6.1.9); a read past its time budget (`slow`, L26-8 v6.1.16).
 */
export type RepoNote = 'slow' | 'paused' | 'private' | 'other_host' | 'unread' | 'fork' | 'archived' | 'empty' | 'no_builder_codes';
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
  /** The repo's GitHub topics (v6.1.10, L1c-2); none when not read or cached before. */
  topics?: string[];
  /** Why the repo was not read, when that is worth telling the agent. */
  problems?: string[];
  /** What the builder is told about the read, in this order; none when absent (built by hand). */
  notes?: RepoNote[];
  /** v6.1.14 L1f-1: the agent reported the repo private (a public read never sees a private repo: it reads as gone). */
  private?: true;
  /** L28-6 (v6.1.16 Task 14): GitHub's repo id, from the read; none when not read. */
  repo_id?: number;
  /** L28-3 (v6.1.16 Task 14): the read's contributor logins, lower-case; none when not read (unknown). */
  contributors?: string[];
  /** L28-3: 'Organization' when the repo's owner is an organization. */
  owner_type?: string;
  /** L38-27 (v6.1.18 Task 11): the license GitHub detects, its SPDX id ("MIT", "NOASSERTION" for a license file it
   *  does not recognize); null when the read found no license file; none when not read (unknown). */
  license?: string | null;
  /** L38-1 (v6.1.18 Task 11): the raw GitHub URL of the funding manifest the read found at the repo root; none else. */
  funding_json_url?: string;
};

type CodeFacts = Pick<RepoFacts, 'chains' | 'contracts' | 'builder_codes' | 'integrations' | 'first_commit_at' | 'last_commit_at' | 'readme_excerpt' | 'homepage' | 'topics'> & {
  html_url: string;
  pushed_at: string;
  /** From the repo object (v6.1.8); a row cached before has none of these and is re-read (N-6, v6.1.9). */
  fork?: boolean;
  archived?: boolean;
  empty?: boolean;
  /** The README's first sentence of prose, the stand-in for a description the agent left out (C58). */
  readme_lead?: string | null;
  /** When a code step sent this row back to GitHub and the repo was found unpushed (F7, v6.1.12); a new read has none. */
  checked_at?: string;
  /** L28-6, L28-3 (v6.1.16 Task 14): the repo id, the contributor logins and the owner's type, from the read. A row
   *  seeded or cached with `id` reads it as the repo id. `members`: public org membership answers, by login. */
  repo_id?: number;
  id?: number;
  contributors?: string[];
  owner_type?: string;
  members?: Record<string, boolean>;
  /** L35-3 (v6.1.16.1 Task 2): a fork's parent, GitHub's repo id and full name, from the read's `parent`. */
  parent_repo_id?: number;
  parent_full_name?: string;
  /** L38-27 (v6.1.18 Task 11): the detected license's SPDX id, null for none; a row cached before has none (unknown). */
  license?: string | null;
  /** v6.1.18.1 (review M2): set on every read since v6.1.18.1, so a read whose body had no license key (unknown) is
   *  still a complete row and is not re-read on every find. */
  license_read?: true;
  /** L38-1 (v6.1.18 Task 11): a funding.json at the repo root. */
  funding_json?: boolean;
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

/** The first 2 KB of a README with markdown and HTML markup removed; inline code spans are dropped too (C3, v6.1.13),
 *  except for the lead sentence (`keepCode`), which keeps their words. Pure. */
export function readmeExcerpt(md: string | null, keepCode = false): string | null {
  if (!md) return null;
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(keepCode ? /(?!)/g : /`[^`\n]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~|#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Task 11 fix round 1 (I1): repo text is builder-written text: no control, bidi or zero-width character.
  const clean = cleanText(text, 2048);
  return clean || null;
}

/** The first sentence of the README's first prose paragraph (no heading, badge, list, table or HTML), up to 280
 *  characters, no pictographs; null when there is none. Pure. */
export function readmeLead(md: string | null): string | null {
  if (!md) return null;
  const paragraphs = md.replace(/```[\s\S]*?```/g, '\n\n').replace(/<!--[\s\S]*?-->/g, ' ').split(/\n\s*\n/);
  for (const raw of paragraphs) {
    const p = raw.trim();
    if (!p || /^(#|!\[|\[!\[|<|\||[-*+]\s|\d+\.\s|>|={3,}|-{3,})/.test(p)) continue;
    const text = (readmeExcerpt(p, true) ?? '').replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').replace(/\s+/g, ' ').trim();
    if (text.split(' ').length < 3) continue;
    const sentence = /^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text;
    return sentence.slice(0, 280).trim();
  }
  return null;
}

// ---- read and cache ----

/** "owner/name" lowercase from a github.com repo link, else null: the cache key, read from the one canonical link
 *  (`canonicalRepoLink`, shared with projectKeyOf; v6.1.13 B4). Pure. */
export function repoKey(url: string | undefined): string | null {
  const link = canonicalRepoLink(url);
  if (!link?.startsWith('https://github.com/')) return null;
  const [owner, repo] = link.slice('https://github.com/'.length).split('/');
  return owner && repo && /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(repo) && !/^\.+$/.test(repo) ? `${owner}/${repo}` : null;
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
    homepage: r.repo.homepage ? cleanText(r.repo.homepage, 500) || null : null,
    topics: (r.repo.topics ?? []).filter((t): t is string => typeof t === 'string').slice(0, 20),
    html_url: r.repo.html_url,
    pushed_at: r.repo.pushed_at,
    fork: r.repo.fork === true,
    archived: r.repo.archived === true,
    empty: r.repo.size === 0,
    readme_lead: readmeLead(r.readme),
    ...(typeof r.repo.id === 'number' ? { repo_id: r.repo.id } : {}),
    ...(r.contributors ? { contributors: r.contributors } : {}),
    ...(r.repo.owner?.type ? { owner_type: r.repo.owner.type } : {}),
    // L35-3 (v6.1.16.1 Task 2): a fork keeps its parent, so the one-per-repo rule reads the parent's repo too.
    ...(r.repo.fork === true && typeof r.repo.parent?.id === 'number' ? { parent_repo_id: r.repo.parent.id } : {}),
    ...(r.repo.fork === true && typeof r.repo.parent?.full_name === 'string' ? { parent_full_name: r.repo.parent.full_name } : {}),
    // Fix round 1 (I4): a repo body with no license key says nothing about the license (unknown, left out). GitHub's
    // /repos body always carries the key (null or an object); v6.1.18.1 (review M2): `license_read` marks the read
    // either way, so a body without it never makes the row incomplete.
    ...('license' in r.repo ? { license: r.repo.license === null ? null : licenseOf(r.repo.license) } : {}),
    license_read: true,
    // Fix round 1 (M7): found at the root, the file is there; not found in a truncated tree, it is unknown (left out),
    // so the step is still offered and nothing is claimed done. The read lists the tree through the API and never
    // fetches the raw URL, which can lag a push by a few minutes: the agent sends it only after it pushed.
    ...(paths.includes(MANIFEST_PATH) ? { funding_json: true } : r.truncated ? {} : { funding_json: false }),
  };
}

/** L38-27 (v6.1.18 Task 11): the SPDX id of a license object GitHub detects, cleaned; `NOASSERTION` for one it does
 *  not name. Fix round 1 (I4): only for a license object; the read sets null itself for a null license. Pure. */
export function licenseOf(l: unknown): string {
  if (!l || typeof l !== 'object') return 'NOASSERTION';
  const id = (l as { spdx_id?: unknown }).spdx_id;
  return typeof id === 'string' && /^[A-Za-z0-9.+-]{1,64}$/.test(id) ? id : 'NOASSERTION';
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

/**
 * L26-8, L26-9 (v6.1.16 Task 12, controller ruling on review): a read that timed out or found no public repo gives the
 * day's real read back, and counts instead on the installation's own miss budget (LIMITS.repoMiss, 20 a day), so
 * distinct missing repos never spend the shared GitHub token freely. Over that budget the real read stays counted and
 * the reply is the paused line (throws ReadsPaused).
 */
async function missRead(installationId: number | undefined, now: Date) {
  if (installationId === undefined) return;
  const { limit, windowSeconds } = LIMITS.repoMiss;
  if (!(await hit(`repoMiss:${installationId}`, limit, windowSeconds, now)).allowed) throw new ReadsPaused();
  await uncountHit(`repoRead:${installationId}`, LIMITS.repoRead.windowSeconds, now);
}

/** L26-9 (v6.1.16 Task 12): how long a 404 or a private answer is kept, so a missing repo is read once per window. */
export const MISS_KEEP_MS = 30 * 60_000;
/** Controller ruling (review of L26-8): how long a slow read is kept, so the same slow repo is not re-read freely. */
export const SLOW_KEEP_MS = 10 * 60_000;
/** A kept miss in repo_cache: the facts are only `{ miss }`, never complete, so no other reader takes them as a read. */
type Miss = { miss: 'gone' | 'private' | 'slow' };
const isMiss = (f: unknown): f is Miss => typeof f === 'object' && f !== null && 'miss' in f;

/** v6.1.18.1 (review M4): the miss a repo's cache row keeps (gone, private, slow), or null; never a fetch. v6.1.19: only
 *  while the row is younger than `MISS_KEEP_MS` (`SLOW_KEEP_MS` for slow), as `cachedCodeFacts` reads it; older is null. */
export async function cachedRepoMiss(url: string | undefined, now: Date = new Date()): Promise<'gone' | 'private' | 'slow' | null> {
  const key = repoKey(url);
  if (!key) return null;
  const [row] = await sql()<{ facts: unknown; fetched_at: Date }[]>`SELECT facts, fetched_at FROM repo_cache WHERE repo = ${key}`;
  if (!row || !isMiss(row.facts)) return null;
  const age = now.getTime() - row.fetched_at.getTime();
  return age >= 0 && age < (row.facts.miss === 'slow' ? SLOW_KEEP_MS : MISS_KEEP_MS) ? row.facts.miss : null;
}

/** Deletes repo_cache rows read over 30 days ago; the count deleted. */
export async function sweepRepoCache(now: Date): Promise<number> {
  const rows = await sql()`DELETE FROM repo_cache WHERE fetched_at < ${new Date(now.getTime() - 30 * DAY_MS)} RETURNING repo`;
  return rows.length;
}

/** A cached row from before integrations were read has none. Pure. */
const withIntegrations = (f: CodeFacts): CodeFacts => ({ ...f, integrations: f.integrations ?? [] });

/** N-6 (v6.1.9): a row saved before v6.1.8 lacks the fork and archived fields, so it is not usable whatever its age.
 *  Pure. */
const usable = (f: CodeFacts) => !isMiss(f) && 'fork' in f && 'archived' in f;
/** v6.1.18.1: a usable row saved before v6.1.18 lacks the license (null, no license file, is a read): not complete, so
 *  it is re-read when the day's reads allow, and meanwhile answers with its license unknown (review I1 to I3). Pure. */
const complete = (f: CodeFacts) => usable(f) && ('license' in f || f.license_read === true);

/**
 * The repo's code facts: from repo_cache while fresh and unpushed, else a new read. Throws when the repo cannot be read.
 * A row read before `staleAfter` (the builder marked a code change done since, v6.1.9 S4) skips the hour's trust and
 * checks for a push first; found unpushed, the row keeps that check's time (`checked_at`, F7 v6.1.12), so the step sends
 * the read back once and the row is trusted again until the next push or step.
 */
async function cachedCodeFacts(key: string, f: Fetch, now: Date, installationId?: number, staleAfter?: Date | null): Promise<CodeFacts> {
  const [row] = await sql()<{ facts: CodeFacts; pushed_at: Date | null; fetched_at: Date }[]>`
    SELECT facts, pushed_at, fetched_at FROM repo_cache WHERE repo = ${key}`;
  const keepMiss = (miss: Miss['miss']) => sql()`
    INSERT INTO repo_cache (repo, facts, fetched_at, pushed_at) VALUES (${key}, ${sql().json({ miss })}, ${now}, NULL)
    ON CONFLICT (repo) DO UPDATE SET facts = EXCLUDED.facts, fetched_at = EXCLUDED.fetched_at, pushed_at = NULL`;
  // L26-9: a miss kept under 30 minutes answers as a fresh one did, with no GitHub call and no read counted; a step the
  // builder marked done since sends it back to GitHub.
  if (row && isMiss(row.facts)) {
    const age = now.getTime() - row.fetched_at.getTime();
    const keep = row.facts.miss === 'slow' ? SLOW_KEEP_MS : MISS_KEEP_MS;
    if (age >= 0 && age < keep && !(staleAfter != null && row.fetched_at.getTime() < staleAfter.getTime())) {
      if (row.facts.miss === 'private') throw new RepoPrivateError();
      if (row.facts.miss === 'slow') throw new GitHubSlow();
      throw new GitHubError(`GitHub: /repos/${key} not found (or private)`, 404);
    }
  }
  // L26-8 (fix round 1, I1): one budget for the whole GitHub read, the cached row's push check included.
  const budget = readBudget();
  if (row && complete(row.facts)) {
    const age = now.getTime() - row.fetched_at.getTime();
    const checked = Math.max(row.fetched_at.getTime(), Date.parse(row.facts.checked_at ?? '') || 0);
    const stale = staleAfter != null && checked < staleAfter.getTime();
    if (age >= 0 && age < HOUR_MS && !stale) return withIntegrations(row.facts);
    if (age >= 0 && age < 7 * DAY_MS && (row.pushed_at || stale)) {
      let live;
      try {
        // The check's own 15 s, inside the read's one budget; slow or failed, the cached copy stands (below).
        live = await readRepoObject(key, undefined, f, AbortSignal.any([budget, AbortSignal.timeout(15_000)]));
      } catch (err) {
        // Gone or private: unreadable, so the cached copy must not outlive it. Anything else is transient.
        if (err instanceof GitHubError && err.status === 404) {
          await keepMiss('gone');
          throw err;
        }
        return withIntegrations(row.facts);
      }
      if (live.private === true) {
        await keepMiss('private');
        throw new RepoPrivateError();
      }
      if (row.pushed_at && Date.parse(live.pushed_at) === row.pushed_at.getTime()) {
        if (stale) await sql()`UPDATE repo_cache SET facts = jsonb_set(facts, '{checked_at}', to_jsonb(${now.toISOString()}::text)) WHERE repo = ${key}`;
        return withIntegrations(row.facts);
      }
    }
  }
  try {
    await countRead(installationId, now);
  } catch (err) {
    // v6.1.18.1 (review I1): reads paused, an old but usable row under 7 days answers (license unknown), as before.
    const age = row ? now.getTime() - row.fetched_at.getTime() : -1;
    if (err instanceof ReadsPaused && row && usable(row.facts) && age >= 0 && age < 7 * DAY_MS) return withIntegrations(row.facts);
    throw err;
  }
  let read: RepoRead;
  try {
    read = await readRepo(key, { fetch: f, signal: budget });
  } catch (err) {
    // L26-8, L26-9: a timed-out read and a missing or private repo never count against the day's reads; the miss is kept.
    const miss: Miss['miss'] | null = err instanceof GitHubSlow ? 'slow' : err instanceof RepoPrivateError ? 'private' : err instanceof GitHubError && err.status === 404 ? 'gone' : null;
    // N1 (fix round 1): a slow read over a complete cached row answers with that row, kept, and counts no read.
    // v6.1.18.1 (review I2): any usable row, so a slow re-read of an old row never overwrites it with a miss.
    if (miss === 'slow' && row && usable(row.facts)) {
      if (installationId !== undefined) await uncountHit(`repoRead:${installationId}`, LIMITS.repoRead.windowSeconds, now);
      return withIntegrations(row.facts);
    }
    if (miss) {
      await keepMiss(miss);
      await missRead(installationId, now);
    }
    throw err;
  }
  const facts = codeFactsOf(read);
  // A partial read (a failed tree or file) is returned but never cached; an empty repo has no tree to read, so its
  // failed tree read is the whole answer and it is cached like any other (v6.1.10 L1c-4).
  if (!read.partial || facts.empty) {
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
export async function repoFacts(project: Project, deps: { gh?: Fetch; now?: Date; installationId?: number; staleAfter?: Date | null } = {}): Promise<RepoFacts> {
  const key = project.private ? null : repoKey(project.repo_url);
  let code: CodeFacts | null = null;
  let paused: Unread = false;
  // M1 (v6.1.14 fix round 1): a repo the read finds private is private, never gone, report or not.
  let found = false;
  if (key) {
    try {
      code = await cachedCodeFacts(key, deps.gh ?? fetch, deps.now ?? new Date(), deps.installationId, deps.staleAfter);
    } catch (err) {
      paused = err instanceof ReadsPaused ? 'paused' : err instanceof GitHubSlow ? 'slow' : false;
      found = err instanceof RepoPrivateError;
      code = null;
    }
  }
  return mergedFacts(found ? { ...project, private: true } : project, code, paused);
}

/**
 * The facts find last read for a project, from its repo_cache row alone (never a fetch, never counted as a read), merged
 * with the report exactly as repoFacts merges them; null when the repo has no complete cached row (v6.1.10 final, I3:
 * track's send check sees the same contracts and chains find vouched for).
 */
export async function cachedRepoFacts(project: Project, fresh?: { now: Date; ms: number }): Promise<RepoFacts | null> {
  const key = project.private ? null : repoKey(project.repo_url);
  if (!key) return null;
  const [row] = await sql()<{ facts: CodeFacts; fetched_at: Date }[]>`SELECT facts, fetched_at FROM repo_cache WHERE repo = ${key}`;
  // v6.1.18.1 (review I3): a usable row from before v6.1.18 merges with its license unknown. Review M1: with `fresh`,
  // only a row read within `ms` of `now`.
  if (!row || !usable(row.facts)) return null;
  if (fresh && !(fresh.now.getTime() - row.fetched_at.getTime() < fresh.ms)) return null;
  return mergedFacts(project, withIntegrations(row.facts), false);
}

/** The agent's report alone as facts, merged as find merges a report with no repo read (v6.1.13, Task 1 review I2). Pure. */
export const reportOnlyFacts = (project: Project): RepoFacts => mergedFacts(project, null, false);

/** Whether a repo link is on github.com, the one code host EarnKit reads (L1g-3, v6.1.15). Pure. */
function onGitHub(url: string): boolean {
  try {
    return /^(www\.)?github\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The code read (or none) and the agent's report as one set of facts (repoFacts' merge rules). Pure. */
/** Why a GitHub repo was not read, when it is no fault of the repo: the day's reads used, or the read's budget (L26-8). */
type Unread = 'paused' | 'slow' | false;
function mergedFacts(project: Project, code: CodeFacts | null, paused: Unread): RepoFacts {
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
  // Task 11 fix round 1 (I1): repo text cleaned on read too, so a read cached before v6.1.16 is clean.
  const homepage = code?.homepage ? cleanText(code.homepage, 500) || null : null;
  const readme = code?.readme_excerpt ? cleanText(code.readme_excerpt, 2048) || null : null;
  const lead = code?.readme_lead ? cleanText(code.readme_lead, 280) || null : null;
  const homeLive = archived ? null : homepage;
  // A repo link given and not read is said once, with the one reason that applies.
  const unread: RepoNote[] = !project.repo_url || code ? [] : [paused || (project.private ? 'private' : onGitHub(project.repo_url) ? 'unread' : 'other_host')];
  const notes: RepoNote[] = [
    ...unread,
    ...(code?.fork ? (['fork'] as const) : []),
    ...(archived ? (['archived'] as const) : []),
    ...(code?.empty ? (['empty'] as const) : []),
    ...(code && !code.builder_codes && project.builder_codes ? (['no_builder_codes'] as const) : []),
  ];
  return {
    name: project.name,
    description: project.description || (code ? (lead ?? readmeLead(readme)) : null) || '',
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
    // A code read beats the report: a repo read that finds none says so (v6.1.9); unread, the report stands.
    builder_codes: code ? code.builder_codes : Boolean(project.builder_codes),
    integrations: code?.integrations ?? [],
    users: project.users ?? null,
    first_commit_at: code?.first_commit_at ?? project.first_commit_at ?? null,
    last_commit_at: code?.last_commit_at ?? project.last_commit_at ?? null,
    readme_excerpt: readme,
    homepage,
    ...(code?.topics && code.topics.length > 0 ? { topics: code.topics } : {}),
    ...(paused === 'paused' ? { problems: [READS_PAUSED] } : {}),
    notes,
    ...(project.private ? { private: true as const } : {}),
    ...(code && repoIdIn(code) !== null ? { repo_id: repoIdIn(code)! } : {}),
    ...(code && Array.isArray(code.contributors) ? { contributors: code.contributors.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()) } : {}),
    ...(code?.owner_type ? { owner_type: code.owner_type } : {}),
    ...(code && code.license !== undefined ? { license: code.license === null ? null : typeof code.license === 'string' ? licenseOf({ spdx_id: code.license }) : 'NOASSERTION' } : {}),
    ...(code?.funding_json === true && manifestUrl(code.html_url) ? { funding_json_url: manifestUrl(code.html_url)! } : {}),
  };
}

/** A cached read's repo id (`repo_id`, else `id`), or null. Pure. */
const repoIdIn = (f: Pick<CodeFacts, 'repo_id' | 'id'>): number | null => {
  const v = f.repo_id ?? f.id;
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
};

/**
 * Whether a cached read answers for this repo key (L35-20, v6.1.16.1 Task 2): its `full_name`, else its `html_url`,
 * names the same repo (case aside). A read whose name moved on (a rename, a deleted and recreated name) does not. Pure.
 */
export function readAgrees(f: Pick<CodeFacts, 'html_url'> & { full_name?: unknown }, key: string): boolean {
  const named = typeof f.full_name === 'string' ? f.full_name : typeof f.html_url === 'string' ? (repoKey(f.html_url) ?? '') : '';
  return named.toLowerCase() === key.toLowerCase();
}

/**
 * L28-6 (v6.1.16 Task 14): the repo id the cached read of this repo link holds, or null (never a fetch). L35-20
 * (v6.1.16.1 Task 2): only when the read's name agrees with the link (`readAgrees`).
 */
export async function cachedRepoId(repoUrl: string | null | undefined): Promise<number | null> {
  const key = repoKey(repoUrl ?? undefined);
  if (!key) return null;
  const [row] = await sql()<{ facts: CodeFacts }[]>`SELECT facts FROM repo_cache WHERE repo = ${key}`;
  return row && !isMiss(row.facts) && readAgrees(row.facts, key) ? repoIdIn(row.facts) : null;
}

/**
 * L35-3 (v6.1.16.1 Task 2): a fork's parent from the cached read of this repo link (never a fetch): GitHub's repo id
 * of the parent and its canonical repo key (either may be null); null when the read is not a fork.
 */
export async function cachedRepoParent(repoUrl: string | null | undefined): Promise<{ id: number | null; key: string | null } | null> {
  const key = repoKey(repoUrl ?? undefined);
  if (!key) return null;
  const [row] = await sql()<{ facts: CodeFacts }[]>`SELECT facts FROM repo_cache WHERE repo = ${key}`;
  if (!row || isMiss(row.facts) || row.facts.fork !== true) return null;
  const f = row.facts;
  const id = typeof f.parent_repo_id === 'number' && Number.isSafeInteger(f.parent_repo_id) && f.parent_repo_id > 0 ? f.parent_repo_id : null;
  const parent = typeof f.parent_full_name === 'string' ? canonicalRepoLink(`https://github.com/${f.parent_full_name}`) : null;
  return id === null && parent === null ? null : { id, key: parent };
}

/** L28-6: the canonical repo link the cached read of this repo link answers with (its html_url after a rename), or null. */
export async function cachedRepoLink(repoUrl: string | null | undefined): Promise<string | null> {
  const key = repoKey(repoUrl ?? undefined);
  if (!key) return null;
  const [row] = await sql()<{ facts: CodeFacts }[]>`SELECT facts FROM repo_cache WHERE repo = ${key}`;
  return row && !isMiss(row.facts) && typeof row.facts.html_url === 'string' ? canonicalRepoLink(row.facts.html_url) : null;
}

/** L28-3 (v6.1.16 Task 14): how a login is tied to a repo: its owner, a committer, a public org member; null for none. */
export type RepoTie = 'owner' | 'committer' | 'member' | null;

/** L28-3: the cached read's row for a github.com repo key, or null (a miss, or none). */
async function cachedRow(key: string | null): Promise<CodeFacts | null> {
  if (!key) return null;
  const [row] = await sql()<{ facts: CodeFacts }[]>`SELECT facts FROM repo_cache WHERE repo = ${key}`;
  return row && !isMiss(row.facts) ? row.facts : null;
}

/**
 * L28-3 (v6.1.16 Task 14, controller ruling: fails closed): how `login` is tied to the repo, by evidence only. `owner`:
 * the login is the owner segment of a github.com link. `committer`: among the contributor logins of a real read (the
 * cached read's, else one read of GitHub's contributors under the read's budget, kept with the cached row). `member`: a
 * public member of the owner organization (GitHub's public_members, 204; kept with the cached row). No login, another
 * host, a private or unread repo, a failed read: null, so no claim or send is made with it. `noFetch`: cache only.
 */
export async function repoTie(login: string | null | undefined, facts: Pick<RepoFacts, 'repo_url' | 'contributors' | 'owner_type'>, deps: { gh?: Fetch; repoUrl?: string | null; noFetch?: boolean } = {}): Promise<RepoTie> {
  if (!login) return null;
  const me = login.toLowerCase();
  const key = repoKey(deps.repoUrl ?? facts.repo_url ?? undefined);
  if (!key) return null;
  const owner = key.split('/')[0];
  if (owner === me) return 'owner';
  const row = await cachedRow(key);
  let contributors: string[] | null = facts.contributors ?? (Array.isArray(row?.contributors) ? row!.contributors! : null);
  if (contributors === null && !deps.noFetch) {
    try {
      const rows = await gh<unknown>(`/repos/${key}/contributors?per_page=100`, undefined, deps.gh ?? fetch, readBudget());
      contributors = Array.isArray(rows) ? rows.flatMap((r) => (r && typeof r === 'object' && typeof (r as { login?: unknown }).login === 'string' ? [(r as { login: string }).login.toLowerCase()] : [])) : null;
    } catch {
      contributors = null;
    }
    if (contributors && row) await sql()`UPDATE repo_cache SET facts = jsonb_set(facts, '{contributors}', ${sql().json(contributors)}) WHERE repo = ${key}`;
  }
  if (contributors?.map((c) => c.toLowerCase()).includes(me)) return 'committer';
  if ((facts.owner_type ?? row?.owner_type) !== 'Organization') return null;
  const kept = row?.members?.[me];
  if (typeof kept === 'boolean') return kept ? 'member' : null;
  if (deps.noFetch) return null;
  const member = await isPublicMember(owner, me, { fetch: deps.gh ?? fetch });
  if (member === null) return null;
  if (row) await sql()`UPDATE repo_cache SET facts = jsonb_set(facts, '{members}', COALESCE(facts->'members', '{}'::jsonb) || jsonb_build_object(${me}::text, ${member}::boolean)) WHERE repo = ${key}`;
  return member ? 'member' : null;
}

/**
 * L28-3 (fix round 1, M1): the tie and whether the evidence is against the builder: a GitHub repo whose contributor list
 * was read (cached or now) without their login, and no other tie. No tie with no evidence (another host, a private or
 * unread repo, no login) is "could not confirm", never "not yours".
 */
export async function repoEvidence(login: string | null | undefined, facts: Pick<RepoFacts, 'repo_url' | 'contributors' | 'owner_type'>, deps: { gh?: Fetch; repoUrl?: string | null; noFetch?: boolean } = {}): Promise<{ tie: RepoTie; against: boolean }> {
  const tie = await repoTie(login, facts, deps);
  if (tie !== null || !login) return { tie, against: false };
  const key = repoKey(deps.repoUrl ?? facts.repo_url ?? undefined);
  const row = await cachedRow(key);
  return { tie, against: key !== null && (Array.isArray(facts.contributors) || Array.isArray(row?.contributors)) };
}

/** L28-3 (v6.1.16 Task 14): whether the repo counts as this login's (`repoTie`, fails closed). */
export async function ownsRepo(login: string | null | undefined, facts: Pick<RepoFacts, 'repo_url' | 'contributors' | 'owner_type'>, deps: { gh?: Fetch; repoUrl?: string | null; noFetch?: boolean } = {}): Promise<boolean> {
  return (await repoTie(login, facts, deps)) !== null;
}
