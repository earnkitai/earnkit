/**
 * What an agent reports about a project: name, description, links, chains, dates. Parsed leniently:
 * a bad link, unknown chain or malformed date is dropped and a long name or description cut, with a
 * problem line, never a refusal; only a name missing, a description missing with no repo link (C58), or either not text
 * fails. users is null when not reported.
 */
import { z } from 'zod';
import { CHAIN_REGISTRY, chainOfId, isKnownChain } from './chains';
import { dropControls } from './controls';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A Solana account or program id: base58 (no 0, O, I or l), 32 to 44 characters (B21, v6.1.8). */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Whether `a` is an address on `chain`: 0x and 40 hex on an EVM chain, base58 elsewhere. Pure. */
export const isAddressOn = (chain: string, a: string): boolean => (CHAIN_REGISTRY[chain]?.evm === false ? BASE58 : ADDRESS).test(a);
/** The address as stored and compared: an EVM one in lower case; base58 is case-sensitive, so as given. Pure. */
export const addressKey = (chain: string, a: string): string => (CHAIN_REGISTRY[chain]?.evm === false ? a : a.toLowerCase());

export const ProjectInput = z.object({
  name: z.string().trim().min(1).max(80),
  /** '' when left out beside a repo link (C58, v6.1.8): the README's first sentence stands in. */
  description: z.string().trim().max(280),
  repo_url: z.string().optional(),
  live_url: z.string().optional(),
  demo_url: z.string().optional(),
  /** mainnet left out is mainnet (v6.1.14 T1). */
  chains: z.array(z.object({ chain: z.string(), mainnet: z.boolean().default(true), contract: z.string().optional() })).optional(),
  last_commit_at: z.string().optional(),
  first_commit_at: z.string().optional(),
  private: z.boolean().optional(),
  builder_codes: z.boolean().optional(),
  users: z.boolean().nullable().optional(),
  /** A code host's page that names no repo (an owner, `orgs/...`): kept as given, read as neither repo nor live link,
   *  never evidence (fix round 1, T7-F1). Not advertised; parseProject sets it. */
  link: z.string().optional(),
});
export type Project = z.infer<typeof ProjectInput>;

/** find's and track's project (v6.1.14 T5): one description, so the two never drift. */
export const PROJECT_DESCRIPTION = 'The project you are in; pass track the same object you passed to find, unchanged';
const any = (what: string) => z.unknown().optional().describe(what);
/**
 * The project as find and track advertise it (one schema, v6.1.14 T5). Every field reads leniently (`parseProject`):
 * a bad field is dropped and named, never a refusal.
 */
export const ProjectArg = z
  .object({
    name: any('The project name (required)'),
    description: any('One line on what it does (required without repo_url: then the README first sentence stands in)'),
    repo_url: any('The GitHub link from the git remote; omit when there is none'),
    live_url: any('The live app link'),
    demo_url: any('A demo video link'),
    chains: any(
      'Chains the code deploys to, as a list: "base" alone is Base mainnet, or { "chain": "base", "mainnet": true, "contract": "0x4200000000000000000000000000000000000006" }; an 0x address on EVM chains, base58 on solana, as { "chain": "solana", "mainnet": true, "contract": "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc" }. mainnet defaults to true; send false (or the testnet name or chain id) for a testnet. Pass contract addresses whenever the deploy config has them (chain: base, arc, monad, solana...)',
    ),
    first_commit_at: any('ISO 8601, from git log --reverse'),
    last_commit_at: any('ISO 8601, from git log'),
    private: any('true when the repo is private: EarnKit then matches on what you report'),
    builder_codes: any('true when the app sends Base Builder Codes'),
    users: any('true when real people use it, false when not; omit it when you do not know'),
  })
  .describe(PROJECT_DESCRIPTION);

const MAX = { name: 80, description: 280 } as const;
/**
 * Control and format characters (zero-width, bidi overrides, NUL) are never part of a project string (v6.1.7, C15);
 * a tab or line break becomes a space so two lines keep their word boundary.
 */
const clean = dropControls;
const text = (v: unknown) => (typeof v === 'string' ? clean(v).trim() : '');
/** The chains read from one report; the rest are named, not read. */
const MAX_CHAINS = 20;
/** A commit date this far past now is a mistake, not a clock skew. */
const FUTURE_MS = 86_400_000;

const URL_FIELDS = ['repo_url', 'live_url', 'demo_url'] as const;
const DATE_FIELDS = ['last_commit_at', 'first_commit_at'] as const;

/** An https or http URL as given, or null. */
const webUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 500) return null;
  try {
    const u = new URL(clean(v).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
};

/**
 * L15-5 (v6.1.14): an SSH clone link, `git@host:owner/repo(.git)` or `ssh://git@host/owner/repo`, as https; anything
 * else as given. FR-2 (final fix): the one definition, so find, track and the screen read one repo key. Pure.
 */
export function sshAsHttps(raw: string): string {
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(raw);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = /^(?:ssh|git\+ssh):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/i.exec(raw);
  return ssh ? `https://${ssh[1]}/${ssh[2]}` : raw;
}
/** A repo link as a web link: an SSH clone link read as https first (FR-2). */
const repoWebUrl = (v: unknown): string | null => webUrl(typeof v === 'string' && v.length <= 500 ? sshAsHttps(clean(v).trim()) : v);

/** Words that name a testnet in a chain slug or a network (v6.1.14 fix round 1, F1). */
const TESTNET_WORDS = new Set(['sepolia', 'goerli', 'holesky', 'hoodi', 'testnet', 'devnet', 'amoy', 'mumbai', 'fuji', 'moderato']);
/** A testnet named alone: the chain it belongs to. */
const TESTNET_HOME: Record<string, string> = { sepolia: 'ethereum', goerli: 'ethereum', holesky: 'ethereum', hoodi: 'ethereum', amoy: 'polygon', mumbai: 'polygon', fuji: 'avalanche', moderato: 'tempo' };
/** Retired or extra testnet ids the registry does not list (Goerli, Holesky, Hoodi, Base Goerli, Mumbai, Arbitrum Goerli, OP Goerli). */
const EXTRA_TESTNET_IDS = new Set([5, 17000, 560048, 84531, 80001, 421613, 420]);
const words = (v: string) => v.split(/[-_.\s]+/).filter(Boolean);

/**
 * The chain and network one reported entry names (v6.1.14 T1, fix round 1 F1). A testnet in any form wins: `testnet:
 * true`, a `network` or `chain` with a testnet word (`base-sepolia` is base, `sepolia` alone ethereum), or a
 * `chain_id`/`chainId` that is a testnet id. Only an entry with no testnet signal and no `mainnet` is mainnet; an
 * unknown id is a problem line. `mainnet` is the given value otherwise (checked by the caller). Pure.
 */
function networkOf(o: Record<string, unknown>): { chain: string; mainnet: unknown; problem?: string } {
  let chain = typeof o.chain === 'string' ? clean(o.chain).trim().toLowerCase() : '';
  let testnet = o.testnet === true || o.testnet === 'true';
  if (!isKnownChain(chain)) {
    const parts = words(chain);
    const rest = parts.filter((w) => !TESTNET_WORDS.has(w));
    const marked = parts.find((w) => TESTNET_WORDS.has(w));
    const home = rest.length ? rest.join('-') : marked ? TESTNET_HOME[marked] ?? '' : '';
    if (marked && isKnownChain(home)) {
      chain = home;
      testnet = true;
    }
  }
  if (typeof o.network === 'string' && words(clean(o.network).toLowerCase()).some((w) => TESTNET_WORDS.has(w))) testnet = true;
  const rawId = o.chain_id ?? o.chainId;
  if (rawId != null) {
    const id = typeof rawId === 'number' ? rawId : typeof rawId === 'string' && /^\d{1,12}$/.test(rawId.trim()) ? Number(rawId) : NaN;
    const known = Number.isSafeInteger(id) ? chainOfId(id) : null;
    if (known) {
      if (!chain) chain = known.chain;
      if (!known.mainnet) testnet = true;
    } else if (EXTRA_TESTNET_IDS.has(id)) testnet = true;
    else return { chain, mainnet: boolText(o.mainnet), problem: `chain ${chain || '?'} dropped: chain_id ${String(rawId).slice(0, 20)} is not a known network; send mainnet true or false` };
  }
  return { chain, mainnet: testnet ? false : (boolText(o.mainnet) ?? true) };
}

/** L16-15 (v6.1.16): `mainnet` given as the text `"true"` or `"false"` (trimmed, any case) reads as the boolean. Pure. */
function boolText(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim().toLowerCase();
  return t === 'true' ? true : t === 'false' ? false : v;
}

/**
 * Parses a report into a Project. Optional fields that do not hold up are dropped and named in `problems`; a commit
 * date more than a day past `now` is dropped too. `partial` (track, v6.1.13 B5): the same limits, but a name or
 * description missing or not text is never a refusal: it reads '' (one not text is named in `problems`). Pure.
 */
export function parseProject(v: unknown, now = new Date(), o: { partial?: boolean } = {}): { ok: true; project: Project; problems: string[] } | { ok: false; problem: string } {
  const raw = { ...(typeof v === 'object' && v !== null ? v : {}) } as Record<string, unknown>;
  const problems: string[] = [];
  const out: Record<string, unknown> = { users: null };
  for (const k of ['name', 'description'] as const) {
    if (raw[k] == null || typeof raw[k] === 'string') continue;
    if (!o.partial) return { ok: false, problem: `${k}: not text` };
    problems.push(`${k} dropped: not text`);
    delete raw[k];
  }
  const urlProblems: string[] = [];
  for (const k of URL_FIELDS) {
    if (raw[k] == null) continue;
    const url = k === 'repo_url' ? repoWebUrl(raw[k]) : webUrl(raw[k]);
    // L16-8 (v6.1.16): a shortened link is never read (not the repo, not the live link), before the code-host rule.
    if (url && isShortener(url)) urlProblems.push(`${k} dropped: a shortened link`);
    else if (url) out[k] = url;
    else urlProblems.push(`${k} dropped: not a web link`);
  }
  // L12-6 (v6.1.14), fix round 1 (T7-F1, T7-F6): a code host's link that names no repo (an owner's page,
  // `github.com/owner`, `github.com/orgs/acme`) is neither the repo nor the live link: a plain link, no evidence.
  if (typeof out.repo_url === 'string' && isCodeHost(out.repo_url) && canonicalRepoLink(out.repo_url) === null) {
    out.link = out.repo_url;
    urlProblems.push('repo_url names no repo; kept as a plain link, not read');
    delete out.repo_url;
  }
  // L13-15 (v6.1.14): only a code host's link is a repo; any other link is the live link (or dropped beside one).
  if (typeof out.repo_url === 'string' && !isCodeHost(out.repo_url)) {
    if (out.live_url === undefined) {
      out.live_url = out.repo_url;
      urlProblems.push('repo_url is not a code host; read as the live link');
    } else urlProblems.push('repo_url dropped: not a code host');
    delete out.repo_url;
  }
  for (const k of ['name', 'description'] as const) {
    const t = text(raw[k]);
    // A repo link stands in for the description (C58): the README's first sentence is read in its place.
    if (!t && !o.partial && !(k === 'description' && out.repo_url)) return { ok: false, problem: `${k}: missing` };
    if (t.length > MAX[k]) problems.push(`${k} cut to ${MAX[k]} characters`);
    out[k] = t.slice(0, MAX[k]);
  }
  problems.push(...urlProblems);
  for (const k of DATE_FIELDS) {
    if (raw[k] == null) continue;
    const t = typeof raw[k] === 'string' ? Date.parse(raw[k] as string) : NaN;
    if (Number.isNaN(t)) problems.push(`${k} dropped: not a date`);
    else if (t > now.getTime() + FUTURE_MS) problems.push(`${k} is in the future; not used`);
    else out[k] = new Date(t).toISOString();
  }
  for (const k of ['private', 'builder_codes', 'users'] as const) {
    if (raw[k] == null) continue;
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
    else problems.push(`${k} dropped: not true or false`);
  }
  if (Array.isArray(raw.chains)) {
    const chains: NonNullable<Project['chains']> = [];
    const seen = new Set<string>();
    // Exact repeats are dropped before the cap, so copies never push a real chain out; the cap counts the rest (v6.1.7).
    let read = 0;
    let extra = 0;
    for (const c of raw.chains) {
      // A bare slug ("base") is that chain on mainnet; so is an object that leaves mainnet out and names no testnet (v6.1.14 T1, F1).
      const o = (typeof c === 'string' ? { chain: c } : typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
      const net = networkOf(o);
      const e: Record<string, unknown> = { ...o, mainnet: net.mainnet };
      const chain = net.chain;
      const given = typeof e.contract === 'string' ? clean(e.contract).trim() : e.contract;
      // An entry exactly like an earlier one is a repeat and costs nothing.
      const key = `${chain}|${String(e.mainnet)}|${typeof given === 'string' ? given.toLowerCase() : String(given)}`;
      if (seen.has(key)) continue;
      if (read >= MAX_CHAINS) {
        extra++;
        continue;
      }
      read++;
      seen.add(key);
      if (net.problem) {
        problems.push(net.problem);
        continue;
      }
      if (!isKnownChain(chain)) {
        problems.push(`chain ${typeof e.chain === 'string' ? clean(e.chain).slice(0, 40) : '?'} dropped: not a known chain`);
        continue;
      }
      if (typeof e.mainnet !== 'boolean') {
        problems.push(`chain ${chain} dropped: mainnet must be true or false`);
        continue;
      }
      const contract = typeof given === 'string' && isAddressOn(chain, given) ? given : undefined;
      // The rejected address is named (B21), cut so a long paste stays one line.
      if (e.contract != null && !contract)
        problems.push(`contract on ${chain} dropped: ${typeof given === 'string' && given ? given.slice(0, 64) : 'it'} is not ${CHAIN_REGISTRY[chain].evm ? 'an 0x' : `a ${CHAIN_REGISTRY[chain].name}`} address`);
      // One entry per chain, network and contract (v6.1.7, C13).
      if (chains.some((k) => k.chain === chain && k.mainnet === e.mainnet && (k.contract ? addressKey(chain, k.contract) : '') === (contract ? addressKey(chain, contract) : ''))) continue;
      chains.push({ chain, mainnet: e.mainnet, ...(contract && { contract }) });
    }
    if (chains.length) out.chains = chains;
    if (extra) problems.push(`${extra} chains beyond ${MAX_CHAINS} were not read`);
  } else if (raw.chains != null) problems.push('chains dropped: not a list');

  return { ok: true, project: out as Project, problems };
}

/** The hosts whose links are code in a repo (L13-15, v6.1.14), each with its subdomains. */
export const CODE_HOSTS = ['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org'] as const;

/** Link shorteners (L16-8, v6.1.16): a link on one is never a live link or a repo. */
export const SHORTENERS = ['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'short.io'] as const;

/** The agent's line when a shortened link was dropped (L16-8, v6.1.16). */
export const SHORT_LINK_NOTE = 'Shortened links are not read; send the real one.';

/** Whether `v` is a link on a shortener (SHORTENERS or a subdomain of one), any scheme. Pure. */
export function isShortener(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  let host: string;
  try {
    host = hostOf(new URL(clean(v).trim()));
  } catch {
    return false;
  }
  return SHORTENERS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** github.com first segments that are GitHub's own pages, never an owner (fix round 1, T7-F6). */
const GITHUB_PAGES = new Set(['orgs', 'users', 'sponsors', 'topics', 'marketplace', 'settings', 'apps', 'collections', 'features', 'explore', 'search', 'notifications', 'organizations', 'enterprises', 'login', 'about', 'pricing']);

/** A link's host lower-cased, a trailing dot dropped (`github.com.` is github.com; L12-6, v6.1.14). Pure. */
const hostOf = (u: URL): string => u.hostname.toLowerCase().replace(/\.$/, '');

/** Whether `v` is an http or https link on a code host (CODE_HOSTS or a subdomain of one, `www.` included). Pure. */
export function isCodeHost(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  let host: string;
  try {
    const u = new URL(clean(v).trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    host = hostOf(u);
  } catch {
    return false;
  }
  return CODE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * The one canonical form of a repo link (v6.1.13, B4), shared by projectKeyOf and the repo read's cache key
 * (repo-facts `repoKey`): https, the host lower-cased without `www.`, no port, no `user@`, no query or fragment, no
 * `/tree/...` or `/blob/...` suffix (on github.com only owner and name; on bitbucket.org and codeberg.org the path up to its first `src` segment, L16-6; elsewhere the path up to its first `-` segment), no trailing slash or `.git`, all lower case;
 * a trailing dot on the host dropped (L12-6, v6.1.14); null for anything that is not an http or https link on a code
 * host, or that names no repo (an owner or group alone, L12-6). No length cap here (projectKeyOf caps as parseProject does). Pure.
 */
export function canonicalRepoLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let u: URL;
  try {
    u = new URL(clean(v).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  // T6-F3 (v6.1.14): only a code host's link has a repo key (CODE_HOSTS), for every caller.
  if (!isCodeHost(v)) return null;
  const host = hostOf(u).replace(/^www\./, '');
  if (!host) return null;
  let parts = u.pathname.split('/').filter(Boolean);
  // L12-6 (v6.1.14): an owner or group alone (`github.com/owner`) names no repo, so it has no repo key; nor does one of
  // GitHub's own pages (`orgs/acme`, `users/x`, `sponsors/x`, `topics/x`; fix round 1, T7-F6).
  if (parts.length < 2 || (host === 'github.com' && GITHUB_PAGES.has(parts[0].toLowerCase()))) return null;
  // github.com: owner and name only. Elsewhere (GitLab and the like) the project ends at its first `-` segment, so
  // `-/tree/...`, `-/blob/...` and `-/issues` fold, and a subgroup that happens to be named `tree` stays (fix round 1, M1).
  // L16-6 (v6.1.16): on bitbucket.org and codeberg.org the browse path starts at `src` (`/src/main/`,
  // `/src/branch/main`), cut as `-` is on GitLab.
  const cut = host === 'bitbucket.org' || host === 'codeberg.org' ? 'src' : '-';
  const dash = parts.findIndex((x, i) => i >= 2 && x === cut);
  parts = host === 'github.com' ? parts.slice(0, 2) : dash >= 0 ? parts.slice(0, dash) : parts;
  const path = parts.join('/').replace(/(\.git)+$/i, '');
  return `https://${host}${path ? `/${path}` : ''}`.toLowerCase();
}

/** A name as a key compares it (v6.1.13 Low 13): NFKC, then full case folding (ß and SS, fullwidth letters). Pure. */
const nameFold = (s: string) => s.normalize('NFKC').toUpperCase().toLowerCase();

/**
 * The project a done step belongs to (v6.1.10, L1c-1): the repo link in its canonical form (`canonicalRepoLink`, the
 * key the repo read uses, v6.1.13 B4), else `name:` and the name folded and trimmed; '' when neither (a row from before
 * v6.1.10 reads the same). The link and name are cleaned as parseProject cleans them (a web link of at most 500
 * characters only, controls dropped, spaces collapsed, the name cut to 80), so a raw project and the parsed one give
 * one key. Pure.
 */
export function projectKeyOf(project: { name?: unknown; repo_url?: unknown } | null | undefined): string {
  // Only a code host's link keys by repo (L13-15, v6.1.14; canonicalRepoLink holds the list), as parseProject reads it.
  const url = repoWebUrl(project?.repo_url);
  const repo = url ? canonicalRepoLink(url) : null;
  if (repo) return repo;
  return nameKeyOf(project);
}

/** The `name:` key of a project, whatever its link: what the project was keyed by before its repo was known. Pure. */
export function nameKeyOf(project: { name?: unknown } | null | undefined): string {
  const name = nameFold(text(project?.name).slice(0, MAX.name).trim()).trim();
  return name ? `name:${name}` : '';
}
