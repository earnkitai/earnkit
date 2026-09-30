/**
 * Matching a builder's public repos to open programs (pure; no network).
 *
 * Recognizing which chains a codebase targets, from chain IDs and RPC hosts in its files.
 * IDs and hosts come from each chain's official docs (checked 2026-09-28).
 */
export const CHAINS = ['base', 'arc', 'tempo', 'monad', 'robinhood'] as const;
export type Chain = (typeof CHAINS)[number];

export const CHAIN_NAMES: Record<Chain, string> = {
  base: 'Base',
  arc: 'Arc',
  tempo: 'Tempo',
  monad: 'Monad',
  robinhood: 'Robinhood Chain',
};

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
};

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
        const host = SIGNALS[chain][net].hosts.find((h) => lower.includes(h));
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
};

export type ProgramFacts = {
  id: string;
  title: string;
  chains: Chain[];
  existing_work: 'allowed' | 'new_work_only' | 'unknown';
  tag: string | null;
  starts_at: Date | null;
};

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
  return {
    name: r.name,
    url: '',
    homepage: r.live_url ?? null,
    created_at: '',
    chains,
    // Unknown commit dates count as active; the verdict still says only new work counts.
    commits_in_window: Object.fromEntries(
      programs.map((p) => [p.id, !last || !p.starts_at || last >= p.starts_at]),
    ),
  };
}

export function matchRepo(
  repo: RepoFacts,
  programs: ProgramFacts[],
): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const p of programs) {
    const chain = p.chains.find((c) => repo.chains[c]);
    if (!chain) continue;
    const signal = repo.chains[chain]!;
    const name = CHAIN_NAMES[chain];
    const v = (
      status: Verdict['status'],
      note: string | null,
      missing: Missing[] = [],
    ) =>
      verdicts.push({
        program_id: p.id,
        program: p.title,
        status,
        missing,
        effort: missing.reduce<Effort>(
          (max, m) =>
            EFFORT_ORDER.indexOf(EFFORT[m]) > EFFORT_ORDER.indexOf(max)
              ? EFFORT[m]
              : max,
          'none',
        ),
        note,
      });

    if (p.existing_work === 'new_work_only') {
      // Existing code doesn't count here; an active repo can only enter with new work.
      const since = p.starts_at ? ` since ${day(p.starts_at)}` : '';
      if (p.starts_at && !repo.commits_in_window[p.id])
        v('no', `no commits${since}; only new work counts`, ['new_work']);
      else v('after_step', `only new work${since} counts`, ['new_work']);
      continue;
    }

    if (p.tag === 'needs a live product') {
      if (!repo.homepage)
        v('after_step', 'needs a live product with real users', [
          'live_url',
          'real_users',
        ]);
      else v('likely', 'looks eligible if it has real users');
      continue;
    }

    // Existing work allowed and the project must be live on the chain.
    const missing: Missing[] = [];
    if (!signal.mainnet) missing.push('mainnet_deploy');
    if (!repo.homepage) missing.push('live_url');
    const words = {
      mainnet_deploy: `a deploy on ${name} mainnet`,
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
