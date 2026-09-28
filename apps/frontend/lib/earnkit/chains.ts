/**
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
