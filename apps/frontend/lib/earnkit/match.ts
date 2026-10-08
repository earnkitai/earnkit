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

export type Detection = Partial<
  Record<Chain, { mainnet: boolean; testnet: boolean; evidence: string }>
>;

export function detectChains(
  files: { path: string; text: string }[],
): Detection {
  const found: Detection = {};
  const mark = (chain: Chain, net: 'mainnet' | 'testnet', evidence: string) => {
    const entry = (found[chain] ??= {
      mainnet: false,
      testnet: false,
      evidence,
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
    for (const m of text.matchAll(VIEM_IMPORT)) {
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
};

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

/** The note for a project-tier row: its most actionable missing signal, or null when none is missing. Pure. */
export const missingSignalNote = (p: Product): string | null => {
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
  for (const c of said.testnet) chains[c] = { mainnet: false, testnet: true, evidence: chains[c]?.evidence ?? 'the builder said testnet only' };
  for (const c of said.mainnet) {
    if (said.testnet.includes(c) || chains[c]?.mainnet) continue;
    chains[c] = { mainnet: true, testnet: chains[c]?.testnet ?? false, evidence: CLAIMED_MAINNET };
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
 * v2.9 A3 (item 5 verifies a claim): a contract with code on a claimed chain's mainnet makes that
 * chain's mainnet a fact; the mainnet claim stays only while another claimed chain is unverified. Pure.
 */
export function confirmMainnets<F extends RepoFacts>(f: F, withCode: Chain[]): F {
  const hit = claimedMainnets(f.chains).filter((c) => withCode.includes(c));
  if (hit.length === 0) return f;
  const chains: Detection = { ...f.chains };
  for (const c of hit) chains[c] = { ...chains[c]!, evidence: `a contract with code on ${CHAIN_NAMES[c]} mainnet` };
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
  /** Ruling 13 (plan): the repo's GitHub link, if the local remote is on GitHub. */
  url?: string;
  /** v2.9 A5 (Pre-flight P4): up to 2 mainnet contracts the agent saw deployed, lowercase. */
  contracts?: string[];
};

/** Turns an agent's report into the same facts matching uses for public repos. */
export function reportedFacts(
  r: ReportedRepo,
  programs: ProgramFacts[],
): RepoFacts {
  const chains: Detection = {};
  for (const c of r.chains)
    chains[c.chain] = {
      mainnet: c.mainnet,
      testnet: !c.mainnet,
      evidence: 'reported by the agent',
    };
  const last = r.last_commit_at ? new Date(r.last_commit_at) : null;
  // Ruling 13 (plan): kept only when it parses as a GitHub repo link; anything else is dropped.
  const repo = r.url ? githubRepo(r.url) : null;
  return {
    name: r.name,
    url: repo ? `https://github.com/${repo.owner}/${repo.repo}` : '',
    homepage: r.live_url ?? null,
    created_at: '',
    chains,
    // Unknown commit dates count as active; the verdict still says only new work counts.
    commits_in_window: Object.fromEntries(
      programs.map((p) => [p.id, !last || !p.starts_at || last >= p.starts_at]),
    ),
  };
}

/**
 * Verdicts for one repo. v2.9 A2, when the repo is scored (`product`): noise gets no row; an
 * any_chain or investment program takes product tier only (at least its `min_product_score`); a
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
    const chain = p.chains.find((c) => repo.chains[c]);
    if (!chain && !p.any_chain) continue;
    if (product && product.score < (p.min_product_score ?? 0)) continue;
    if (product && (p.any_chain || p.investment) && product.tier !== 'product') continue;
    // v2.9 A3: the builder's claims this program's verdict relies on that no check backs yet.
    const open: Claim[] = [];
    if (chain && !p.any_chain && repo.chains[chain]?.mainnet && repo.chains[chain]?.evidence === CLAIMED_MAINNET) open.push('mainnet');
    if (claims.includes('live') && repo.live_verified !== true) open.push('live');
    if (claims.includes('users') && p.tag === 'needs a live product') open.push('users');
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

    // v2.9 A2: an investment is a company application, at most one step away and weeks of work.
    if (product && p.investment) {
      v('after_step', INVESTMENT_NOTE, [], 'weeks');
      continue;
    }

    if (p.tag === 'needs a live product') {
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
    if (chain && !p.any_chain && !repo.chains[chain]!.mainnet) missing.push('mainnet_deploy');
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
