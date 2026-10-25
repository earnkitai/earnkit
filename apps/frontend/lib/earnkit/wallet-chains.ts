/**
 * v3.1 Highlights competence (2026-10-25, owner ruling: contracts deployed are a good signal, across chains): the
 * chains a proven wallet's own contracts are read on. `network` is Alchemy's subdomain (alchemy.ts alchemyCall), a
 * network the owner has not switched on in the Alchemy dashboard answers "not enabled for this app" and is skipped
 * until it is; `explorer` links the Highlights item; `label` names a single chain ("3 contracts on Base"). Pure.
 */
export const WALLET_CHAINS = [
  { chain: 'base', network: 'base-mainnet', explorer: 'basescan.org', label: 'Base' },
  { chain: 'ethereum', network: 'eth-mainnet', explorer: 'etherscan.io', label: 'Ethereum' },
  { chain: 'arbitrum', network: 'arb-mainnet', explorer: 'arbiscan.io', label: 'Arbitrum' },
  { chain: 'optimism', network: 'opt-mainnet', explorer: 'optimistic.etherscan.io', label: 'Optimism' },
  { chain: 'polygon', network: 'polygon-mainnet', explorer: 'polygonscan.com', label: 'Polygon' },
] as const;
export type WalletChain = (typeof WALLET_CHAINS)[number]['chain'];

/** One contract a proven wallet created itself on one chain; `counts`: not a token and used by another address. */
export type WalletContract = { chain: WalletChain; address: string; created_at: string; counts: boolean };

export const walletChain = (chain: string) => WALLET_CHAINS.find((c) => c.chain === chain) ?? null;
