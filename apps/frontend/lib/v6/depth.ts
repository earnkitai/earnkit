/**
 * Ecosystem depth rows for a repo already read: the integrations its code uses (integrations.ts) and the
 * chains it names on mainnet and on testnet (v5 chain detection). Pure.
 */
import type { RepoRead } from '../v5/github';
import { detectCode } from '../v5/repo-facts';
import { detectIntegrations } from './integrations';

export type DepthRows = { integrations: string[]; chains_mainnet: string[]; chains_testnet: string[] };

export function readDepth(read: RepoRead): DepthRows {
  const paths = read.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  const { chains } = detectCode(read.files, paths);
  return {
    integrations: detectIntegrations(read.files, paths),
    chains_mainnet: chains.filter((c) => c.mainnet).map((c) => c.chain),
    chains_testnet: chains.filter((c) => !c.mainnet).map((c) => c.chain),
  };
}
