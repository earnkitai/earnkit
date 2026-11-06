/**
 * The chain registry: every chain EarnKit knows by slug, with its ids, RPC, explorer hosts and explorer API.
 * Program files may only name these slugs. Code detection and deploy details use the EVM entries;
 * a non-EVM chain (Solana) matches only through the chains an agent reports. Grows by owner edit.
 */

type Signals = { ids: number[]; hosts: string[] };
export type ChainEntry = {
  name: string;
  evm: boolean;
  mainnet: Signals;
  testnet: Signals;
  explorer: string | null;
  /** The keyless Blockscout API base EarnKit reads contracts through, or null when no reader exists. */
  explorer_api: string | null;
  rpc: string | null;
};

export const CHAIN_REGISTRY: Record<string, ChainEntry> = {
  base: {
    name: 'Base',
    evm: true,
    mainnet: { ids: [8453], hosts: ['mainnet.base.org', 'basescan.org', 'base-mainnet'] },
    testnet: { ids: [84532], hosts: ['sepolia.base.org', 'sepolia.basescan.org', 'base-sepolia'] },
    explorer: 'https://basescan.org',
    explorer_api: 'https://base.blockscout.com/api/v2',
    rpc: 'https://mainnet.base.org',
  },
  arc: {
    name: 'Arc',
    evm: true,
    mainnet: { ids: [5042], hosts: ['mainnet.arc.io', 'rpc.arc.circle.com', 'explorer.arc.io'] },
    testnet: { ids: [5042002], hosts: ['testnet.arc.io', 'testnet.arc.network', 'testnet.arcscan'] },
    explorer: 'https://explorer.arc.io',
    explorer_api: 'https://explorer.arc.io/api/v2',
    rpc: 'https://rpc.mainnet.arc.io',
  },
  tempo: {
    name: 'Tempo',
    evm: true,
    mainnet: { ids: [4217], hosts: ['rpc.tempo.xyz'] },
    testnet: { ids: [42431], hosts: ['moderato.tempo.xyz', 'testnet.tempo.xyz'] },
    explorer: null,
    explorer_api: null,
    rpc: 'https://rpc.tempo.xyz',
  },
  monad: {
    name: 'Monad',
    evm: true,
    mainnet: {
      ids: [143],
      hosts: ['rpc.monad.xyz', 'rpc1.monad.xyz', 'rpc2.monad.xyz', 'rpc3.monad.xyz', 'rpc-mainnet.monadinfra.com'],
    },
    testnet: { ids: [10143], hosts: ['testnet-rpc.monad.xyz', 'rpc-testnet.monadinfra.com'] },
    explorer: null,
    explorer_api: null,
    rpc: 'https://rpc.monad.xyz',
  },
  robinhood: {
    name: 'Robinhood Chain',
    evm: true,
    mainnet: { ids: [4663], hosts: ['mainnet.chain.robinhood.com'] },
    testnet: { ids: [46630], hosts: ['testnet.chain.robinhood.com'] },
    explorer: null,
    explorer_api: null,
    rpc: 'https://mainnet.chain.robinhood.com',
  },
  avalanche: {
    name: 'Avalanche',
    evm: true,
    mainnet: { ids: [43114], hosts: ['api.avax.network', 'snowtrace.io', 'subnets.avax.network'] },
    testnet: { ids: [43113], hosts: ['api.avax-test.network', 'testnet.snowtrace.io'] },
    explorer: 'https://snowtrace.io',
    explorer_api: null,
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
  },
  arbitrum: {
    name: 'Arbitrum',
    evm: true,
    mainnet: { ids: [42161], hosts: ['arb1.arbitrum.io', 'arbiscan.io'] },
    testnet: { ids: [421614], hosts: ['sepolia-rollup.arbitrum.io', 'sepolia.arbiscan.io'] },
    explorer: 'https://arbiscan.io',
    explorer_api: 'https://arbitrum.blockscout.com/api/v2',
    rpc: 'https://arb1.arbitrum.io/rpc',
  },
  ethereum: {
    name: 'Ethereum',
    evm: true,
    mainnet: { ids: [1], hosts: ['etherscan.io'] },
    testnet: { ids: [11155111], hosts: ['sepolia.etherscan.io'] },
    explorer: 'https://etherscan.io',
    explorer_api: 'https://eth.blockscout.com/api/v2',
    rpc: 'https://ethereum-rpc.publicnode.com',
  },
  optimism: {
    name: 'Optimism',
    evm: true,
    mainnet: { ids: [10], hosts: ['mainnet.optimism.io', 'optimistic.etherscan.io'] },
    testnet: { ids: [11155420], hosts: ['sepolia.optimism.io', 'sepolia-optimism.etherscan.io'] },
    explorer: 'https://optimistic.etherscan.io',
    explorer_api: 'https://optimism.blockscout.com/api/v2',
    rpc: 'https://mainnet.optimism.io',
  },
  polygon: {
    name: 'Polygon',
    evm: true,
    mainnet: { ids: [137], hosts: ['polygon-rpc.com', 'polygonscan.com'] },
    testnet: { ids: [80002], hosts: ['rpc-amoy.polygon.technology', 'amoy.polygonscan.com'] },
    explorer: 'https://polygonscan.com',
    explorer_api: 'https://polygon.blockscout.com/api/v2',
    rpc: 'https://polygon-rpc.com',
  },
  solana: {
    name: 'Solana',
    evm: false,
    mainnet: { ids: [], hosts: ['api.mainnet-beta.solana.com'] },
    testnet: { ids: [], hosts: ['api.devnet.solana.com', 'api.testnet.solana.com'] },
    explorer: 'https://explorer.solana.com',
    explorer_api: null,
    rpc: 'https://api.mainnet-beta.solana.com',
  },
};

/** Whether `slug` is a registered chain (own keys only). Pure. */
export const isKnownChain = (slug: string): boolean => Object.hasOwn(CHAIN_REGISTRY, slug);

/** The chain's display name, or the slug itself when unknown. Pure. */
export const chainName = (slug: string): string => (isKnownChain(slug) ? CHAIN_REGISTRY[slug].name : slug);

/** The chain an id belongs to and whether it is the mainnet, or null when unknown. Pure. */
export function chainOfId(id: number): { chain: string; mainnet: boolean } | null {
  for (const [chain, c] of Object.entries(CHAIN_REGISTRY)) {
    if (c.mainnet.ids.includes(id)) return { chain, mainnet: true };
    if (c.testnet.ids.includes(id)) return { chain, mainnet: false };
  }
  return null;
}
