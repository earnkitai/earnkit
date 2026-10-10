import { githubRepo } from './campaigns';
import { CHAINS, CHAIN_NAMES, type Chain } from './chains';
import { EARNKIT_ORGS } from './earnkit-orgs';
import type { SaidRepo } from './builder-memory';

/**
 * Matching a builder's public repos to open programs (pure; no network).
 *
 * Recognizing which chains a codebase targets, from chain IDs and RPC hosts in its files.
 * IDs and hosts come from each chain's official docs (checked 2026-09-28).
 */
export { CHAINS, CHAIN_NAMES, type Chain } from './chains';

type Signals = {
  mainnet: { ids: number[]; hosts: string[] };
  testnet: { ids: number[]; hosts: string[] };
};

const SIGNALS: Record<Chain, Signals> = {
  base: {
    mainnet: {
      ids: [8453],
      hosts: ['mainnet.base.org', 'basescan.org', 'base-mainnet'],
    },
    testnet: {
      ids: [84532],
      hosts: ['sepolia.base.org', 'sepolia.basescan.org', 'base-sepolia'],
    },
  },
  arc: {
    mainnet: {
      ids: [5042],
      hosts: ['mainnet.arc.io', 'rpc.arc.circle.com', 'explorer.arc.io'],
    },
    testnet: {
      ids: [5042002],
      hosts: ['testnet.arc.io', 'testnet.arc.network', 'testnet.arcscan'],
    },
  },
  tempo: {
    mainnet: { ids: [4217], hosts: ['rpc.tempo.xyz'] },
    testnet: {
      ids: [42431],
      hosts: ['moderato.tempo.xyz', 'testnet.tempo.xyz'],
    },
  },
  monad: {
    mainnet: {
      ids: [143],
      hosts: [
        'rpc.monad.xyz',
        'rpc1.monad.xyz',
        'rpc2.monad.xyz',
        'rpc3.monad.xyz',
        'rpc-mainnet.monadinfra.com',
      ],
    },
    testnet: {
      ids: [10143],
      hosts: ['testnet-rpc.monad.xyz', 'rpc-testnet.monadinfra.com'],
    },
  },
  robinhood: {
    mainnet: { ids: [4663], hosts: ['mainnet.chain.robinhood.com'] },
    testnet: { ids: [46630], hosts: ['testnet.chain.robinhood.com'] },
  },
  // v2.8 Ruling 14 (plan): the C-Chain and Fuji. Builder bonus tokens stay on Base.
  avalanche: {
    mainnet: { ids: [43114], hosts: ['api.avax.network', 'snowtrace.io', 'subnets.avax.network'] },
    testnet: { ids: [43113], hosts: ['api.avax-test.network', 'testnet.snowtrace.io'] },
  },
};

/**
 * v2.9 A5 (Pre-flight P1): the block explorer hosts among a chain's mainnet signals (for an
 * explorer `/address/0x...` live link). Rpc hosts are left out. Pure.
 */
export const mainnetExplorerHosts = (chain: Chain): string[] =>
  (SIGNALS[chain]?.mainnet.hosts ?? []).filter((h) => h.includes('.') && /scan|explorer|snowtrace/.test(h));

/** v2.8.1 §B6 (fix round 1): a chain id an agent reports (8453, 84532), or null when EarnKit doesn't know it. Pure. */
export function chainOfId(id: number): { chain: Chain; mainnet: boolean } | null {
  for (const chain of CHAINS) {
    if (SIGNALS[chain].mainnet.ids.includes(id)) return { chain, mainnet: true };
    if (SIGNALS[chain].testnet.ids.includes(id)) return { chain, mainnet: false };
  }
  return null;
}

/** Chain IDs only count next to a chain-id-like key, so a stray "143" in code doesn't match. */
const CHAIN_ID =
  /(?:chain[_-]?id|chainid|\bid)["']?\s*[:=]\s*["']?(\d{3,8})\b|--chain(?:-id)?\s+(\d{3,8})\b/gi;
/** viem/wagmi chain imports, e.g. `import { base, baseSepolia } from 'viem/chains'`. */
const VIEM_IMPORT =
  /import\s*\{([^}]*)\}\s*from\s*['"](?:viem|wagmi)\/chains['"]/g;
const VIEM_NAMES: Record<string, [Chain, 'mainnet' | 'testnet']> = {
  base: ['base', 'mainnet'],
  baseSepolia: ['base', 'testnet'],
  monad: ['monad', 'mainnet'],
  monadTestnet: ['monad', 'testnet'],
  tempo: ['tempo', 'mainnet'],
  tempoModerato: ['tempo', 'testnet'],
  arcTestnet: ['arc', 'testnet'],
  avalanche: ['avalanche', 'mainnet'],
  avalancheFuji: ['avalanche', 'testnet'],
};

/**
 * v2.10 item 9: what backs a chain. Only `deployed` (a contract with code there, v2.9 A5) and
 * `deploy_config` (a deploy config or deploy output names it) credit a mainnet; a `mention` (an
 * import, a host or an id anywhere else) does not. Absent (a v2.9 cached row) reads as `mention` (R6).
 */
export type Basis = 'deployed' | 'deploy_config' | 'mention';
export type Detection = Partial<
  Record<Chain, { mainnet: boolean; testnet: boolean; evidence: string; basis?: Basis }>
>;

/**
 * v2.10 item 9: the chains a repo's files mention (imports, hosts, chain ids), each `basis: 'mention'`.
 * `imports: false` (Ruling H2): hosts and chain ids only. Pure.
 */
function detectMentions(files: { path: string; text: string }[], o: { imports?: boolean } = {}): Detection {
  const found: Detection = {};
  const mark = (chain: Chain, net: 'mainnet' | 'testnet', evidence: string) => {
    const entry = (found[chain] ??= {
      mainnet: false,
      testnet: false,
      evidence,
      basis: 'mention',
    });
    entry[net] = true;
  };

  for (const { path, text } of files) {
    const lower = text.toLowerCase();
    for (const chain of CHAINS) {
      for (const net of ['mainnet', 'testnet'] as const) {
        // v2.8 Task 6 fix round 1: a mainnet host inside a testnet host ("snowtrace.io" in
        // "testnet.snowtrace.io") is not a mainnet signal, so testnet hosts are cut out first.
        const text = net === 'mainnet'
          ? SIGNALS[chain].testnet.hosts.reduce((t, h) => t.split(h).join(' '), lower)
          : lower;
        const host = SIGNALS[chain][net].hosts.find((h) => text.includes(h));
        if (host) mark(chain, net, `${path}: ${host}`);
      }
    }
    for (const m of text.matchAll(CHAIN_ID)) {
      const id = Number(m[1] ?? m[2]);
      for (const chain of CHAINS) {
        for (const net of ['mainnet', 'testnet'] as const) {
          if (SIGNALS[chain][net].ids.includes(id))
            mark(chain, net, `${path}: chain id ${id}`);
        }
      }
    }
    if (o.imports !== false) for (const m of text.matchAll(VIEM_IMPORT)) {
      for (const name of m[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0])) {
        const hit = VIEM_NAMES[name];
        if (hit)
          mark(hit[0], hit[1], `${path}: imports ${name} from viem/wagmi`);
      }
    }
  }
  return found;
}

/** Ruling H2 (I2): dependency folders, whose deploy output is never the builder's. */
const DEP_DIR = /(^|\/)(node_modules|lib|vendor)\//;
const DEPLOY_DIRS: { re: RegExp; chainOf: (m: RegExpMatchArray) => Chain | null }[] = [
  // Foundry: broadcast/<script>/<chainId>/, at any depth (Ruling H2 I2); a dry run is no deployment.
  { re: /(?:^|\/)broadcast\/[^/]+\/(\d{1,8})\/(?!dry-run\/)/, chainOf: (m) => mainnetOf(Number(m[1])) },
  // Hardhat Ignition: ignition/deployments/chain-<id>/
  { re: /(?:^|\/)ignition\/deployments\/chain-(\d{1,8})\//, chainOf: (m) => mainnetOf(Number(m[1])) },
  // hardhat-deploy: deployments/<network>/ (R6)
  { re: /(?:^|\/)deployments\/([^/]+)\//, chainOf: (m) => networkChain(m[1]) },
];
const mainnetOf = (id: number): Chain | null => {
  const c = chainOfId(id);
  return c?.mainnet ? c.chain : null;
};
/** Common network names that aren't `<chain>` (hardhat-deploy, foundry): Avalanche's C-Chain. */
const NETWORK_ALIASES: Record<string, Chain> = { avax: 'avalanche', 'avalanche-c': 'avalanche', avalanchec: 'avalanche' };
/** A network name that names a chain's mainnet (`<chain>`, `<chain>mainnet`, `<chain>-mainnet`, R6), else null. Pure. */
const networkChain = (name: string): Chain | null => {
  const n = name.toLowerCase();
  return CHAINS.find((c) => n === c || n === `${c}mainnet` || n === `${c}-mainnet` || n === `${c}_mainnet`) ?? NETWORK_ALIASES[n] ?? null;
};

/** Testnet and local network names (a config's own entries); everything else is counted as a mainnet. */
const NON_MAINNET_NAME = /sepolia|goerli|holesky|hoodi|test|fuji|amoy|mumbai|cardona|chiado|alfajores|moderato|devnet|local|hardhat|anvil|ganache|fork|dev\b/i;
/** Ruling H2: a config alone naming more mainnet networks than this is a template, never a deploy config. */
const MAX_CONFIG_MAINNETS = 2;

/** `//` and block comments removed, strings kept (so `https://` stays). Pure. */
const stripJsComments = (code: string) =>
  code.replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_, str) => str ?? '');
/** `#` comments removed, strings kept. Pure. */
const stripTomlComments = (toml: string) =>
  toml.replace(/("(?:\\.|[^"\\\n])*"|'[^'\n]*')|#[^\n]*/g, (_, str) => str ?? '');

/** The text inside the braces opening at `open` (balanced; strings already harmless), else ''. Pure. */
function braced(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(open + 1, i);
  }
  return '';
}

/** A hardhat config's `networks: { name: { ... } }` entries, comments removed, else []. Pure. */
function hardhatNetworks(config: string): { name: string; body: string }[] {
  const code = stripJsComments(config);
  const m = /\bnetworks\s*:\s*\{/.exec(code);
  if (!m) return [];
  const block = braced(code, m.index + m[0].length - 1);
  const out: { name: string; body: string }[] = [];
  let depth = 0;
  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0) {
      const key = /^\s*(?:["']([^"']+)["']|([A-Za-z_$][\w$-]*))\s*:\s*\{/.exec(block.slice(i));
      if (key && (i === 0 || /[\s,{]/.test(block[i - 1]))) {
        const open = i + key[0].length - 1;
        const body = braced(block, open);
        out.push({ name: key[1] ?? key[2], body });
        i = open + body.length + 1;
      }
    }
  }
  return out;
}

/** A foundry.toml's `[rpc_endpoints]` entries (`name = "url"`), comments removed, else []. Pure. */
function foundryEndpoints(toml: string): { name: string; body: string }[] {
  const table = stripTomlComments(toml).match(/^\[rpc_endpoints\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? '';
  return [...table.matchAll(/^\s*["']?([\w.-]+)["']?\s*=\s*(.+)$/gm)].map((m) => ({ name: m[1], body: m[2] }));
}

/**
 * v2.10 item 9, Ruling H2: the mainnets a repo's deploy config or deploy output names.
 * - A network entry in `hardhat.config.*` (`networks`) or `[rpc_endpoints]` in `foundry.toml`, by its
 *   RPC host or chain id (foundry: also by its name, e.g. `base = "${BASE_RPC_URL}"`). Comments,
 *   imports and other blocks (etherscan `customChains`) never count. A config naming more than
 *   MAX_CONFIG_MAINNETS mainnet networks is a template and gives nothing.
 * - A deploy folder at any depth outside dependency folders: `broadcast/<script>/<chainId>/` (not a
 *   dry run), `ignition/deployments/chain-<id>/`, `deployments/<network>/` (R6).
 * Chain to evidence. Pure.
 */
export function deployConfigChains(files: { path: string; text: string }[], paths: string[]): Partial<Record<Chain, string>> {
  const out: Partial<Record<Chain, string>> = {};
  for (const p of paths) {
    if (DEP_DIR.test(p)) continue;
    for (const d of DEPLOY_DIRS) {
      const m = p.match(d.re);
      const chain = m && d.chainOf(m);
      if (chain) out[chain] ??= p;
    }
  }
  for (const f of files) {
    if (DEP_DIR.test(f.path)) continue;
    const base = f.path.split('/').at(-1) ?? '';
    const foundry = base === 'foundry.toml';
    if (!foundry && !/^hardhat\.config\.[cm]?[jt]s$/.test(base)) continue;
    const entries = (foundry ? foundryEndpoints(f.text) : hardhatNetworks(f.text)).map((e) => {
      const hits = detectMentions([{ path: f.path, text: e.body }], { imports: false });
      const mainnets = (Object.entries(hits) as [Chain, Detection[Chain]][]).filter(([, v]) => v?.mainnet).map(([c]) => c);
      const named = foundry ? networkChain(e.name) : null;
      const testnet = NON_MAINNET_NAME.test(e.name) || (Object.values(hits).some((v) => v?.testnet) && mainnets.length === 0);
      return { mainnets: named && !mainnets.includes(named) ? [...mainnets, named] : mainnets, testnet };
    });
    // Ruling H2: a template lists many mainnets (Scaffold-ETH: mainnet, arbitrum, optimism, base...).
    if (entries.filter((e) => !e.testnet).length > MAX_CONFIG_MAINNETS) continue;
    for (const e of entries) for (const chain of e.mainnets) out[chain] ??= `${f.path}: deploy config`;
  }
  return out;
}

/**
 * The chains a repo targets. v2.10 item 9: every import, host or id is a `mention`; a chain its
 * deploy config or deploy output names (`paths`: every blob path of the tree, for folder hits) is a
 * mainnet with `basis: 'deploy_config'`. Pure.
 */
export function detectChains(files: { path: string; text: string }[], paths: string[] = []): Detection {
  const found = detectMentions(files);
  for (const [chain, evidence] of Object.entries(deployConfigChains(files, paths)) as [Chain, string][])
    found[chain] = { testnet: false, ...found[chain], mainnet: true, basis: 'deploy_config', evidence };
  return found;
}

/**
 * v2.10 item 9: whether a chain's entry credits a mainnet: deployed or in a deploy config, or a
 * claim (v2.9 A3: the builder's word, credited until a check says otherwise). A mention never does. Pure.
 */
export const creditsMainnet = (d: Detection[Chain]) =>
  Boolean(d?.mainnet && ((d.basis ?? 'mention') !== 'mention' || d.evidence === CLAIMED_MAINNET));

/** v2.10 item 9: the note on a row whose chain is only mentioned. */
export const DEPLOY_FIRST = (chain: Chain) => `deploy to ${CHAIN_NAMES[chain]} first`;

/** The files worth reading for chain signals: configs, env examples, package manifests, chain constants. */
export function pickFiles(paths: { path: string; size: number }[], limit = 12) {
  // Top-level lib/ holds Foundry dependencies; src/lib/ is the project's own code.
  const skip =
    /(^|\/)(node_modules|dist|build|out|\.next|vendor|target|coverage)\/|^lib\//;
  const interesting =
    /(^|\/)(package\.json|hardhat\.config\.[cm]?[jt]s|foundry\.toml|wagmi\.config\.[jt]s|\.env\.(example|sample|template)|[^/]*(chain|network|config|constants|wagmi|viem|contracts?)[^/]*\.(ts|tsx|js|mjs|json|toml|py|rs|go|sol))$/i;
  return paths
    .filter(
      (p) => p.size < 200_000 && !skip.test(p.path) && interesting.test(p.path),
    )
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)
    .slice(0, limit)
    .map((p) => p.path);
}

// ---- v2.9 A1, A2: owned repos and the real-product score ----

/** Whether `owner` is one of EarnKit's own GitHub orgs (kits, starters). Pure. */
export const earnkitOwner = (owner: string): boolean =>
  (EARNKIT_ORGS as readonly string[]).includes(owner.trim().toLowerCase());

/**
 * v2.9 A1: whether a repo owned by `owner` counts as the builder's. Never an EarnKit org. The
 * builder's own; else at least 5 of the builder's commits that are 30% or more of the repo's last
 * 100 (`contrib`). Pure.
 */
export function ownerOk(
  owner: string,
  builder: string | null,
  contrib?: { userCommits: number; recentCommits: number },
): boolean {
  if (earnkitOwner(owner)) return false;
  if (builder && owner.toLowerCase() === builder.toLowerCase()) return true;
  if (!contrib || contrib.recentCommits === 0) return false;
  return contrib.userCommits >= 5 && contrib.userCommits / contrib.recentCommits >= 0.3;
}

/** v2.9 A2: the six signals of a real product (plan Ruling 1 says how each is read). */
export type ProductFacts = {
  active: boolean;
  young: boolean;
  original: boolean;
  readme: boolean;
  deployed: boolean;
  owned: boolean;
};
export type Tier = 'product' | 'project' | 'noise';
export type Product = {
  score: number;
  tier: Tier;
  missing: (keyof ProductFacts)[];
  /** Ruling G4: signals not checked this call (no budget left): not counted, never named as missing. */
  unchecked?: (keyof ProductFacts)[];
  /**
   * v2.10 item 6: the traction score (0 to 10, R1) and the odds it gives (productOdds). Absent on a
   * product scored before v2.10 (older fixtures, remembered fit repos): read as traction 0, low odds
   * (Pre-flight P26).
   */
  traction?: number;
  odds?: Odds;
  low_reason?: string | null;
};

/**
 * v2.10 item 6: a row's odds of winning. Only good odds lead, count as a fit, or alert. v2.11 8a (S3):
 * `unknown` is a repo EarnKit couldn't read (GitHub 404s it) that may be a product: never good, never
 * labelled low; the builder is asked about users instead.
 */
export type Odds = 'good' | 'unknown' | 'low';
/** v2.11 8a (S5): odds as a rank key: good, then unknown, then low (absent reads low, P26). Pure. */
export const oddsRank = (o: Odds | undefined): number => (o === 'good' ? 0 : o === 'unknown' ? 1 : 2);
/** v2.10 item 6: what traction measures. A null count is unknown and scores 0 (never named). */
export type TractionFacts = { tx_count: number | null; live_ok: boolean; commits_90d: number | null };
/** v2.10 item 6: good odds need product tier and at least this much traction. */
export const GOOD_ODDS_TRACTION = 4;
/** 0 for none or unknown, 1 from `mid`, 2 from `high`. Pure. */
const band = (n: number | null, mid: number, high: number) => (n === null || n <= 0 ? 0 : n < high ? (n >= mid ? 1 : 0) : 2);
/** v2.10 item 6 (R1): 3·band(tx: 0, 1-49, 50+) + 2·live_ok + 1·band(commits: 0, 1-9, 10+), 0 to 10. Unknown counts score 0. Pure. */
export function traction(f: TractionFacts): number {
  return 3 * band(f.tx_count, 1, 50) + 2 * Number(f.live_ok) + band(f.commits_90d, 1, 10);
}
/**
 * v2.10.1 B2: measured real use: at least this many transactions to the repo's own contract with code
 * (Blockscout, Base). It is what "users" means for matching: it makes a repo a product whatever its
 * polish signals, clears "needs real users", and is what products-only programs ask for.
 */
export const REAL_USE_TX = 50;
/** v2.10.1 B2: whether a transaction count shows real use. Unknown (null) never does. Pure. */
export const realUse = (tx: number | null | undefined): boolean => (tx ?? 0) >= REAL_USE_TX;
/** v2.10.1 B3: a row that still needs real users (a products-only program without measured use). */
export const NEEDS_USERS = 'needs real users first';
/** v2.10.1 B2, B3: a row's low-odds reason while it still needs real users. */
export const NO_USERS_YET = 'no users yet';
/**
 * v2.10.1 B2: a repo with measured real use is a product, whatever its polish signals (README, age,
 * a known owner), unless it looks like a copy or someone else's repo. Pure.
 */
export const withRealUse = (p: Product, tx: number | null | undefined, usersClaim = false): Product =>
  p.tier !== 'product' && (realUse(tx) || usersClaim) && !p.missing.includes('original') && !p.missing.includes('owned') ? { ...p, tier: 'product' } : p;
/**
 * v2.10.1 fix round 1 (C1 b, I2): real use for matching: measured (50+ transactions to a contract the
 * agent reported) or the builder's own users claim (v2.9 A3; the row still says "confirm: users"). Pure.
 */
export const hasRealUse = (repo: Pick<RepoFacts, 'tx_count' | 'claims'>): boolean => realUse(repo.tx_count) || (repo.claims ?? []).includes('users');
/** v2.11 8b: a row's low-odds reason for each requirement it still misses. */
export const MISSING_REASON: Record<Missing, string> = {
  new_work: 'only new work counts',
  live_url: 'no live link yet',
  mainnet_deploy: 'not deployed yet',
  real_users: NO_USERS_YET,
};
/** v2.11 8a (S3): the reason on an unknown repo's row ("tokens.fun, users unknown"), never "low odds". */
export const USERS_UNKNOWN = 'users unknown';
/** v2.10.2 fix round 1 (I2): a missing deploy when the repo is on a testnet ("not deployed yet" otherwise). */
export const NOT_ON_MAINNET = 'not on mainnet yet';
/** v2.10.2 fix round 1 (M3): a repo whose owner GitHub didn't answer for (a rate limit), never "not enough signs". */
export const OWNER_UNCHECKED = 'owner not checked yet';
/** v2.10.2 fix round 1 (I2): the missing-deploy reason: "not on mainnet yet" when a chain is on testnet only. Pure. */
export const deployReason = (chains: Detection): string =>
  (Object.values(chains) as Detection[Chain][]).some((c) => c?.testnet && !creditsMainnet(c)) ? NOT_ON_MAINNET : MISSING_REASON.mainnet_deploy;
/**
 * v2.11 8a (S4): whether a repo is a product but for signals EarnKit couldn't check: GitHub hid it
 * (a 404; re-review m1: never a rate limit), so `owned` is unchecked; it is original, active and
 * deployed, and it reaches product tier once the unchecked signals count. Pure.
 */
const unreadProduct = (p: Pick<Product, 'tier' | 'missing' | 'unchecked'> & { score?: number }, ownerHidden: boolean): boolean =>
  ownerHidden &&
  p.tier !== 'product' &&
  (p.unchecked ?? []).includes('owned') &&
  !(['original', 'active', 'deployed', 'owned'] as const).some((s) => p.missing.includes(s)) &&
  !(p.unchecked ?? []).includes('deployed') &&
  (p.score ?? 0) + (p.unchecked ?? []).length >= 5;
/** v2.10 item 6's fallback reason, when nothing more specific applies. */
export const NOT_REAL_YET = 'not enough signs of a real product yet';
/**
 * v2.10 item 6, R2, Ruling H5: odds, with the first reason that applies (a chain only mentioned is
 * the row's, rowOdds).
 * - Not product tier: low, its missingSignalNote. A copy or starter (`original` missing): low (I2).
 * - Transaction count known (Base): good at traction 4+; else "no users yet" (0 transactions) or
 *   "live link not loading".
 * - Count unknown (another chain, or no read slot; never named, I1): good with a live link and a
 *   commit in 90 days (an unknown commit count counts: product tier already needs activity); else
 *   "live link not loading" or "no commits in 90 days".
 * Ranking still uses the raw score, so measured users rank first. Pure.
 */
export function productOdds(
  p: Pick<Product, 'tier' | 'missing' | 'unchecked'> & { score?: number },
  t: TractionFacts,
  score: number,
  opts: { ownerHidden?: boolean; saidNoUsers?: boolean } = {},
): { odds: Odds; low_reason: string | null } {
  // v2.11 8a (S4): a hidden repo that may be a product is asked about, never scored low; measured
  // transactions of 0, or the builder's "no" to the users question, still mean no users yet.
  if (unreadProduct(p, opts.ownerHidden === true) && t.live_ok) {
    if (t.tx_count === 0 || opts.saidNoUsers) return { odds: 'low', low_reason: NO_USERS_YET };
    return { odds: 'unknown', low_reason: null };
  }
  if (p.tier !== 'product')
    return { odds: 'low', low_reason: missingSignalNote(p) ?? (p.unchecked?.includes('owned') ? OWNER_UNCHECKED : NOT_REAL_YET) };
  if (p.missing.includes('original')) return { odds: 'low', low_reason: SIGNAL_WORDS.original };
  if (t.tx_count !== null) {
    if (score >= GOOD_ODDS_TRACTION) return { odds: 'good', low_reason: null };
    return { odds: 'low', low_reason: t.tx_count === 0 ? 'no users yet' : 'live link not loading' };
  }
  if (!t.live_ok) return { odds: 'low', low_reason: 'live link not loading' };
  if (t.commits_90d === 0) return { odds: 'low', low_reason: SIGNAL_WORDS.active };
  return { odds: 'good', low_reason: null };
}
/**
 * v2.10 items 6, 9 (Pre-flight P13): a verdict that waits on a deploy to a mainnet the repo only
 * mentions (an import, a host or an id; never a claim). Pure.
 */
export const onlyMentioned = (v: Pick<Verdict, 'missing'>, chains: Detection): boolean =>
  v.missing.includes('mainnet_deploy') &&
  (Object.values(chains) as Detection[Chain][]).some((c) => c?.mainnet && (c.basis ?? 'mention') === 'mention' && c.evidence !== CLAIMED_MAINNET);
/**
 * v2.10 items 6, 9: a row's odds. Low when its repo isn't product tier (that reason first, R2), when
 * its chain is only mentioned ("not deployed yet"), or when the repo's traction is low (or unscored).
 * v2.11 8b, v2.10.2 fix round 1 (I2, owner rule): a row missing new work, or users the program needs,
 * is low for every repo (MISSING_REASON). A missing deploy or live link is low only below product
 * tier: a product one deploy or one link away keeps its odds, since EarnKit does those steps. v2.11
 * 8a (S3): an unknown repo reads "users unknown" while it waits on users; on a row that doesn't need
 * users it has no reason (fix round 1, I1); a missing deploy or link is low for it too. Pure.
 */
export function rowOdds(p: Product | undefined, v: Verdict, chains: Detection): { odds: Odds; low_reason: string | null } {
  if (!p) return { odds: 'low', low_reason: NOT_REAL_YET };
  const unknown = p.odds === 'unknown';
  if (p.tier !== 'product' && !unknown) return { odds: 'low', low_reason: p.low_reason ?? missingSignalNote(p) ?? NOT_REAL_YET };
  if (onlyMentioned(v, chains)) return { odds: 'low', low_reason: deployReason(chains) };
  if (v.missing.includes('new_work')) return { odds: 'low', low_reason: MISSING_REASON.new_work };
  if (unknown) {
    if (v.missing.includes('mainnet_deploy')) return { odds: 'low', low_reason: deployReason(chains) };
    if (v.missing.includes('live_url')) return { odds: 'low', low_reason: MISSING_REASON.live_url };
    return { odds: 'unknown', low_reason: v.missing.includes('real_users') ? USERS_UNKNOWN : null };
  }
  // v2.10.1 B2, B3: a row still waiting on real users is never good odds, and says so.
  if (v.missing.includes('real_users')) return { odds: 'low', low_reason: NO_USERS_YET };
  if (p.odds !== 'good') return { odds: 'low', low_reason: p.low_reason ?? NOT_REAL_YET };
  return { odds: 'good', low_reason: null };
}

/** Names, descriptions or topics of tutorials, course work, starters and docs (Pre-flight P27): not original. */
export const TUTORIAL =
  /\b(tutorial|course|bootcamp|exercise|homework|lesson|example|demo|clone|starter|boilerplate|template|learn|practice|udemy|freecodecamp|covid[- ]?19?[- ]?tracker|todo[- ]?app|antivirus|docs?|documentation)\b/i;
/**
 * Ruling G3: a description counts as tutorial work only on these strong phrases (never "demo" or
 * "example", which real products use too). Names and topics keep the full TUTORIAL pattern.
 */
export const TUTORIAL_DESCRIPTION = /\b(tutorial|course|boilerplate|starter[- ]kit|template|follow[- ]along|homework)\b/i;

/**
 * Ruling G3: well-known token contracts (USDC, EURC, WETH, USDT) that config files name but that are
 * never the builder's own deployment, lowercase. Only addresses from official docs (checked
 * 2026-10-08); a chain without a sourced address is left out.
 */
export const KNOWN_TOKEN_ADDRESSES: ReadonlySet<string> = new Set(
  [
    // https://developers.circle.com/stablecoins/usdc-contract-addresses (Base, Avalanche, Arc, Monad)
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    '0x3600000000000000000000000000000000000000',
    '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    // https://developers.circle.com/stablecoins/eurc-contract-addresses (Base, Avalanche, Arc)
    '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
    '0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD',
    '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
    // https://docs.base.org/base-chain/network-information/base-contracts (WETH9 on Base)
    '0x4200000000000000000000000000000000000006',
    // https://tether.to/en/supported-protocols/ (USDT on Avalanche C-Chain)
    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
  ].map((a) => a.toLowerCase()),
);

/** The README a framework generates: not the builder's own words. */
export const DEFAULT_README =
  /Getting Started with Create React App|This is a \[?Next\.js\]? project bootstrapped|Sample Hardhat Project|This project demonstrates a basic Hardhat use case/i;
export const INVESTMENT_NOTE = 'apply as a company: needs a full-time team';

/** The signals in score order (Pre-flight P1: not `SIGNALS`, which holds chain signals). */
const PRODUCT_SIGNALS: (keyof ProductFacts)[] = ['active', 'young', 'original', 'readme', 'deployed', 'owned'];

/** v2.9 A2: the real-product score and tier. Product: 5+ with active, owned and deployed; project: 3+; else noise. Pure. */
export function productScore(f: ProductFacts, unchecked: (keyof ProductFacts)[] = []): Product {
  const score = PRODUCT_SIGNALS.filter((s) => f[s]).length;
  const tier: Tier = score >= 5 && f.active && f.owned && f.deployed ? 'product' : score >= 3 ? 'project' : 'noise';
  const open = unchecked.filter((s) => !f[s]);
  return {
    score,
    tier,
    missing: PRODUCT_SIGNALS.filter((s) => !f[s] && !open.includes(s)),
    ...(open.length > 0 && { unchecked: open }),
  };
}

/** A missing signal in builder words, for a project-tier row's note. */
export const SIGNAL_WORDS: Record<keyof ProductFacts, string> = {
  deployed: 'no live site or contract found',
  active: 'no commits in 90 days',
  owned: 'not your repo',
  original: 'looks like a copy or tutorial',
  readme: 'needs a README',
  young: 'no recent work',
};
/** Pre-flight P29: the note names the most actionable missing signal first. */
const NOTE_ORDER: (keyof ProductFacts)[] = ['deployed', 'active', 'readme', 'original', 'young', 'owned'];

/**
 * Ruling G15 (spec A2, P27): an any_chain or investment program takes only a product-tier repo that
 * is original, so a docs repo or a tutorial never reaches a16z, while it still matches elsewhere. Pure.
 */
export const fitsWideProgram = (p: Product) => p.tier === 'product' && !(p.missing ?? []).includes('original');

/** The note for a project-tier row: its most actionable missing signal, or null when none is missing. Pure. */
export const missingSignalNote = (p: Pick<Product, 'missing' | 'unchecked'>): string | null => {
  const first = NOTE_ORDER.find((s) => p.missing.includes(s));
  if (first) return SIGNAL_WORDS[first];
  // Ruling G4: a link not checked yet is never "not found"; the next call checks it.
  return p.unchecked?.includes('deployed') ? UNCHECKED_NOTE : null;
};
export const UNCHECKED_NOTE = 'live link not checked yet';

// ---- Matching repos to programs ----

/**
 * Matching a builder's public repos to open programs. Pure: the GitHub facts come in,
 * verdicts come out. Evidence is shown, and anything it can't confirm becomes a "check".
 */
export type RepoFacts = {
  name: string;
  url: string;
  homepage: string | null;
  created_at: string;
  chains: Detection;
  /** Program id -> whether the repo has commits inside that program's build window. */
  commits_in_window: Record<string, boolean>;
  /** v2.9 A2: the real-product score; absent for callers that don't score (v2.8.1 rules apply). */
  product?: Product;
  /** v2.9 A5: the live link loaded from here (a probe passed). */
  live_verified?: boolean;
  /** v2.9 A3: what the builder said that raises eligibility; unverified until a check backs it. */
  claims?: Claim[];
  /**
   * v2.10 item 8: commits in 90 days from one read (at most 100); null when GitHub couldn't say. On a
   * repo someone else owns, the builder's own commits only (not the repo's total).
   */
  commits_90d?: number | null;
  /**
   * v2.10.1 B2: the largest transaction count read for the contracts the agent reported (fix round 1,
   * I1: never an address a config file merely mentions, never a shared contract); null or absent
   * when none was read.
   */
  tx_count?: number | null;
  /** v2.10.1 fix round 1 (C1): what the builder answered about users (tell's has_users), null when never asked. */
  users_said?: boolean | null;
};

/** v2.9 A3: a statement that raises eligibility: a mainnet deploy, a live link, real users. */
export type Claim = 'mainnet' | 'live' | 'users';
/** v2.9 A3: the evidence on a chain whose mainnet only the builder (or their agent's report) vouches for. */
export const CLAIMED_MAINNET = 'the builder said mainnet';
const CLAIM_WORDS: Record<Claim, string> = { mainnet: 'mainnet', live: 'live link', users: 'users' };

/**
 * v2.9 A3: the builder's statements over a repo's facts. A statement that lowers eligibility always
 * wins (testnet only clears that chain's mainnet; not_mine drops the repo: null); one that raises it
 * is a claim (a mainnet chain the code doesn't show, a live link when there is none, users). Pure.
 */
export function applyBuilderFacts(f: RepoFacts, said: SaidRepo | undefined): (RepoFacts & { claims: Claim[] }) | null {
  if (!said) return { ...f, claims: f.claims ?? [] };
  if (said.not_mine) return null;
  const chains: Detection = structuredClone(f.chains);
  const claims = new Set<Claim>(f.claims ?? []);
  for (const c of said.testnet)
    chains[c] = { mainnet: false, testnet: true, evidence: chains[c]?.evidence ?? 'the builder said testnet only', basis: 'mention' };
  for (const c of said.mainnet) {
    // v2.10 Pre-flight P8: a mention doesn't credit a mainnet, so the builder's word becomes a claim over it.
    if (said.testnet.includes(c) || creditsMainnet(chains[c])) continue;
    chains[c] = { mainnet: true, testnet: chains[c]?.testnet ?? false, evidence: CLAIMED_MAINNET, basis: 'mention' };
    claims.add('mainnet');
  }
  let homepage = f.homepage;
  if (!homepage && said.live_url) {
    homepage = said.live_url;
    claims.add('live');
  }
  if (said.has_users) claims.add('users');
  // A mainnet claim the builder took back (testnet only) is no claim.
  if (claimedMainnets(chains).length === 0) claims.delete('mainnet');
  return { ...f, chains, homepage, claims: [...claims] };
}

/** v2.9 A3: the chains whose mainnet only a claim backs. Pure. */
export const claimedMainnets = (d: Detection): Chain[] =>
  (Object.entries(d) as [Chain, Detection[Chain]][]).filter(([, v]) => v?.mainnet && v.evidence === CLAIMED_MAINNET).map(([c]) => c);

/**
 * v2.9 A3 (item 5 verifies a claim): a contract with code on a mainnet makes that chain's mainnet a
 * fact (v2.10 item 9: `basis: 'deployed'`, also over a mention or a deploy config); the mainnet claim
 * stays only while another claimed chain is unverified. Pure.
 */
export function confirmMainnets<F extends RepoFacts>(f: F, withCode: Chain[]): F {
  const hit = withCode.filter((c) => f.chains[c]?.mainnet && f.chains[c]?.basis !== 'deployed');
  if (hit.length === 0) return f;
  const chains: Detection = { ...f.chains };
  for (const c of hit) chains[c] = { ...chains[c]!, evidence: `a contract with code on ${CHAIN_NAMES[c]} mainnet`, basis: 'deployed' };
  const claims = claimedMainnets(chains).length > 0 ? f.claims : f.claims?.filter((x) => x !== 'mainnet');
  return { ...f, chains, claims };
}

export type ProgramFacts = {
  id: string;
  title: string;
  chains: Chain[];
  /** v2.8 Ruling 13 (plan): not tied to one chain; fits any repo (chain and mainnet checks skipped). */
  any_chain: boolean;
  existing_work: 'allowed' | 'new_work_only' | 'unknown';
  tag: string | null;
  starts_at: Date | null;
  /** v2.8 Ruling C5: the award is an investment in a company, not a prize. */
  investment: boolean;
  /** v2.9 A2: the lowest product score a repo needs for a row (a16z: 5); 0: no floor. */
  min_product_score: number;
  /**
   * v2.9 A8 (match-loop.ts): the lowest product score among announced winners, once 30 entries have
   * an announced result; null (or absent) until then. A repo below it is at most after_step.
   */
  match_floor?: number | null;
};

/** v2.9 A8: the note on a row whose repo scores below the program's match floor. */
export const BELOW_FLOOR_NOTE = 'winners so far had a live product and recent commits';

/** What still stands between a repo and a program, as keys agents can act on. */
export type Missing = 'live_url' | 'mainnet_deploy' | 'new_work' | 'real_users';
export type Effort = 'none' | 'minutes' | 'hours' | 'days' | 'weeks';

/** Rough time for each missing piece, for the agent's own plan (and "fastest" in the answer). */
const EFFORT: Record<Missing, Effort> = {
  live_url: 'minutes',
  mainnet_deploy: 'hours', // needs gas funded by the builder
  new_work: 'days',
  real_users: 'weeks',
};
/** v2.9 A4: the slowest of these missing pieces ('none' for none). Pure. */
export const effortOf = (missing: Missing[]): Effort =>
  missing.reduce<Effort>((max, m) => (EFFORT_ORDER.indexOf(EFFORT[m]) > EFFORT_ORDER.indexOf(max) ? EFFORT[m] : max), 'none');
export const EFFORT_ORDER: Effort[] = [
  'none',
  'minutes',
  'hours',
  'days',
  'weeks',
];

export type Verdict = {
  program_id: string;
  program: string;
  status: 'likely' | 'after_step' | 'no';
  missing: Missing[];
  /** The slowest missing piece. */
  effort: Effort;
  /** Shown to the builder as is: what still has to happen, or what to confirm, in a few words. */
  note: string | null;
};

const day = (d: Date) =>
  d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** A private or local repo as the builder's agent describes it (EarnKit never reads its code). */
export type ReportedRepo = {
  name: string;
  chains: { chain: Chain; mainnet: boolean }[];
  live_url?: string;
  last_commit_at?: string;
  /** v2.10.2 fix round 2: the first commit (ISO), the repo's age when GitHub can't give it. */
  first_commit_at?: string;
  /** Ruling 13 (plan): the repo's GitHub link, if the local remote is on GitHub. */
  url?: string;
  /** v2.9 A5 (Pre-flight P4): up to 2 mainnet contracts the agent saw deployed, lowercase. */
  contracts?: string[];
  /** v2.10.1 fix round 1 (C1 a): the builder's own commits in 90 days, from the local git log. */
  my_commits_90d?: number;
};

/** Turns an agent's report into the same facts matching uses for public repos. */
export function reportedFacts(
  r: ReportedRepo,
  programs: ProgramFacts[],
): RepoFacts {
  // v2.10 Pre-flight P8: an agent-reported mainnet is a claim (v2.9 A3), never a fact.
  const chains: Detection = {};
  for (const c of r.chains)
    chains[c.chain] = {
      mainnet: c.mainnet,
      testnet: !c.mainnet,
      evidence: c.mainnet ? CLAIMED_MAINNET : 'reported by the agent',
      basis: 'mention',
    };
  const last = r.last_commit_at ? new Date(r.last_commit_at) : null;
  // Ruling 13 (plan): kept only when it parses as a GitHub repo link; anything else is dropped.
  const repo = r.url ? githubRepo(r.url) : null;
  return {
    name: r.name,
    url: repo ? `https://github.com/${repo.owner}/${repo.repo}` : '',
    homepage: r.live_url ?? null,
    // v2.10.2 fix round 2: the first commit the agent reports is the repo's age; else unknown ('').
    created_at: r.first_commit_at ?? '',
    chains,
    // Unknown commit dates count as active; the verdict still says only new work counts.
    commits_in_window: Object.fromEntries(
      programs.map((p) => [p.id, !last || !p.starts_at || last >= p.starts_at]),
    ),
    ...(claimedMainnets(chains).length > 0 && { claims: ['mainnet'] as Claim[] }),
  };
}

/**
 * Verdicts for one repo. v2.9 A2, when the repo is scored (`product`): noise gets no row; an
 * any_chain or investment program takes an original product-tier repo only (at least its
 * `min_product_score`; Ruling G15); a
 * program tagged "needs a live product" is never likely; only product tier is likely (a project row
 * that would be becomes after_step, naming its most actionable missing signal). Pure.
 */
export function matchRepo(
  repo: RepoFacts,
  programs: ProgramFacts[],
): Verdict[] {
  const verdicts: Verdict[] = [];
  const product = repo.product;
  const claims = repo.claims ?? [];
  if (product?.tier === 'noise') return verdicts;
  for (const p of programs) {
    // v2.10 (Task 1 review): a credited chain first, so a mention listed earlier never hides it.
    const chain = p.chains.find((c) => creditsMainnet(repo.chains[c])) ?? p.chains.find((c) => repo.chains[c]);
    if (!chain && !p.any_chain) continue;
    // v2.10.1 B2: measured real use passes a polish floor (the score counts README, age and the like).
    if (product && product.score < (p.min_product_score ?? 0) && !hasRealUse(repo)) continue;
    if (product && (p.any_chain || p.investment) && !fitsWideProgram(product)) continue;
    // v2.9 A3: the builder's claims this program's verdict relies on that no check backs yet.
    const open: Claim[] = [];
    if (chain && !p.any_chain && repo.chains[chain]?.mainnet && repo.chains[chain]?.evidence === CLAIMED_MAINNET) open.push('mainnet');
    if (claims.includes('live') && repo.live_verified !== true) open.push('live');
    // v2.10.1 fix round 1 (I2): products-only programs rely on the users claim too, until confirmed.
    if (claims.includes('users') && (p.tag === 'needs a live product' || p.any_chain || p.investment)) open.push('users');
    const v = (
      status: Verdict['status'],
      note: string | null,
      missing: Missing[] = [],
      effort?: Effort,
    ) => {
      // v2.9 A8: below the score every announced winner so far had: at most after_step, said first.
      const below = status === 'likely' && product != null && p.match_floor != null && product.score < p.match_floor;
      // v2.9 A2: only a product can be likely. v2.9 A3: never on an unverified claim ("confirm").
      const project = status === 'likely' && !below && product && product.tier !== 'product';
      const unconfirmed = status === 'likely' && !below && !project && open.length > 0;
      verdicts.push({
        program_id: p.id,
        program: p.title,
        status: project || unconfirmed || below ? 'after_step' : status,
        missing,
        effort: effort ?? effortOf(missing),
        note: below
          ? BELOW_FLOOR_NOTE
          : project
            ? missingSignalNote(product!)
            : unconfirmed
              ? `confirm: ${open.map((c) => CLAIM_WORDS[c]).join(' and ')}`
              : note,
      });
    };

    if (p.existing_work === 'new_work_only') {
      // Existing code doesn't count here; an active repo can only enter with new work.
      const since = p.starts_at ? ` since ${day(p.starts_at)}` : '';
      if (p.starts_at && !repo.commits_in_window[p.id])
        v('no', `no commits${since}; only new work counts`, ['new_work']);
      else v('after_step', `only new work${since} counts`, ['new_work']);
      continue;
    }

    // v2.10.1 B3: a products-only program (any chain or an investment, Ruling G15) wants a product
    // people use: without measured real use the row is never a fit, and says what's missing.
    if (product && (p.any_chain || p.investment) && !hasRealUse(repo)) {
      v('after_step', NEEDS_USERS, ['real_users'], 'weeks');
      continue;
    }

    // v2.9 A2: an investment is a company application, at most one step away and weeks of work.
    if (product && p.investment) {
      v('after_step', INVESTMENT_NOTE, [], 'weeks');
      continue;
    }

    // v2.10 item 9: a mainnet only mentioned (an import, a host, an id) gives no fit: the row is one
    // deploy away (hours), whatever else the program asks.
    if (chain && !p.any_chain && repo.chains[chain]?.mainnet && !creditsMainnet(repo.chains[chain])) {
      v('after_step', DEPLOY_FIRST(chain), ['mainnet_deploy', ...(repo.homepage ? [] : (['live_url'] as const))], 'hours');
      continue;
    }

    if (p.tag === 'needs a live product') {
      // v2.10.1 B2: measured real use is real users (no claim to confirm).
      if (realUse(repo.tx_count)) {
        if (!repo.homepage) v('after_step', 'needs a live link', ['live_url']);
        else v('likely', 'looks eligible');
        continue;
      }
      // v2.9 A3: a users claim clears real_users; the row then waits on "confirm: users".
      if (claims.includes('users')) {
        if ((product && !repo.live_verified) || (!product && !repo.homepage)) v('after_step', 'needs a live link', ['live_url']);
        else v('likely', 'looks eligible');
        continue;
      }
      // v2.9 A2: never likely while users are unproven; a link counts once it loaded from here.
      if (product && repo.live_verified) v('after_step', 'needs real users', ['real_users']);
      else if (product) v('after_step', 'needs a live product with real users', ['live_url', 'real_users']);
      else if (!repo.homepage)
        v('after_step', 'needs a live product with real users', [
          'live_url',
          'real_users',
        ]);
      else v('likely', 'looks eligible if it has real users');
      continue;
    }

    // Existing work allowed and the project must be live on the chain. v2.8 Ruling 13 (plan): an
    // any_chain program skips the mainnet check; the live link still applies.
    const missing: Missing[] = [];
    if (chain && !p.any_chain && !creditsMainnet(repo.chains[chain])) missing.push('mainnet_deploy');
    if (!repo.homepage) missing.push('live_url');
    const words = {
      mainnet_deploy: chain ? `a deploy on ${CHAIN_NAMES[chain]} mainnet` : '',
      live_url: 'a live link',
    };
    if (missing.length > 0)
      v(
        'after_step',
        `needs ${missing.map((m) => words[m as keyof typeof words]).join(' and ')}`,
        missing,
      );
    else
      v(
        'likely',
        p.existing_work === 'unknown'
          ? 'looks eligible; confirm existing work is allowed'
          : 'looks eligible',
      );
  }
  return verdicts;
}
