/**
 * The integrations EarnKit looks for in a repo, per chain: package.json dependencies, imports and config
 * in source files, and a few file paths. A match says the code uses it, never how much. Pure.
 */
import { builderCodesIn, KNOWN_TOKEN_ADDRESSES } from '../v5/code-signals';

export type Integration = {
  key: string;
  /** The chain it belongs to; null when it spans chains. */
  chain: string | null;
  label: string;
  /** The SDK's docs link. */
  docs: string;
  /** package.json dependency names (exact). */
  packages: string[];
  /** Patterns in source files: imports and config. */
  imports: RegExp[];
  /** Tree paths that show it. */
  paths?: RegExp[];
  /** A text test reused from elsewhere. */
  text?: (text: string) => boolean;
};

/** The USDC contracts in KNOWN_TOKEN_ADDRESSES: Base, Avalanche, Arc, Monad. */
export const USDC_ADDRESSES: readonly string[] = [
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  '0x3600000000000000000000000000000000000000',
  '0x754704bc059f8c67012fed69bc8a327a5aafb603',
].filter((a) => KNOWN_TOKEN_ADDRESSES.has(a));

/** `from 'pkg'`, `from 'pkg/sub'`, `require('pkg')` or `import 'pkg'`. */
const importOf = (pkg: string) => {
  const p = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`(?:from\\s*|require\\(\\s*|import\\s*\\(?\\s*)['"]${p}(?:/[^'"]*)?['"]`);
};

export const INTEGRATIONS: Integration[] = [
  { key: 'onchainkit', docs: 'https://docs.base.org/onchainkit', chain: 'base', label: 'OnchainKit', packages: ['@coinbase/onchainkit'], imports: [importOf('@coinbase/onchainkit')] },
  // The wallet SDK alone is any Coinbase wallet; Smart Wallet is the smart-wallet-only setting.
  { key: 'smart_wallet', docs: 'https://docs.base.org/smart-wallet', chain: 'base', label: 'Smart Wallet', packages: [], imports: [/\bsmartWalletOnly\b/] },
  {
    key: 'paymaster', docs: 'https://docs.base.org/paymaster', chain: null, label: 'Paymaster', packages: ['permissionless'],
    imports: [/\bpaymasterService\b/, /\bpimlico\b/i, /alchemy[\w.-]{0,40}gas[\s_-]?manager|gasManagerPolicyId|\bgas[\s_-]?manager\b[\s\S]{0,80}\balchemy/i],
  },
  { key: 'basenames', docs: 'https://docs.base.org/basenames', chain: 'base', label: 'Basenames', packages: [], imports: [/\bBasenames?\b/, /\bbasenames\b/, /\.base\.eth\b/] },
  { key: 'minikit', docs: 'https://docs.base.org/mini-apps', chain: 'base', label: 'MiniKit', packages: [], imports: [importOf('@coinbase/onchainkit/minikit'), /\bMiniKitProvider\b|\buseMiniKit\b/] },
  {
    key: 'builder_codes', docs: 'https://docs.base.org/builder-codes', chain: 'base', label: 'Builder Codes', packages: [], imports: [], text: builderCodesIn,
    paths: [/(^|\/)builder[-_]?codes?\.[cm]?[jt]sx?$/i],
  },
  {
    key: 'usdc', docs: 'https://developers.circle.com/stablecoins/usdc-contract-addresses', chain: null, label: 'USDC', packages: [],
    imports: [new RegExp(USDC_ADDRESSES.map((a) => `\\b${a}\\b`).join('|'), 'i')],
  },
  { key: 'cctp', docs: 'https://developers.circle.com/cctp', chain: null, label: 'CCTP', packages: ['@circle-fin/cctp'], imports: [importOf('@circle-fin/cctp'), /\bTokenMessenger(V2)?\b/] },
  {
    key: 'circle_wallets', docs: 'https://developers.circle.com/wallets', chain: null, label: 'Circle Wallets',
    packages: ['@circle-fin/developer-controlled-wallets', '@circle-fin/user-controlled-wallets', '@circle-fin/w3s-pw-web-sdk'],
    imports: [importOf('@circle-fin/developer-controlled-wallets'), importOf('@circle-fin/user-controlled-wallets')],
  },
  {
    key: 'anchor', docs: 'https://www.anchor-lang.com/docs', chain: 'solana', label: 'Anchor', packages: ['@coral-xyz/anchor', '@project-serum/anchor'],
    imports: [importOf('@coral-xyz/anchor'), importOf('@project-serum/anchor'), /\buse anchor_lang\b/, /^\s*anchor-lang\s*=/m],
    paths: [/(^|\/)Anchor\.toml$/],
  },
  {
    key: 'solana_web3', docs: 'https://solana.com/docs/clients/javascript', chain: 'solana', label: 'Solana web3.js', packages: ['@solana/web3.js', '@solana/kit'],
    imports: [importOf('@solana/web3.js'), importOf('@solana/kit')],
  },
  { key: 'blinks', docs: 'https://solana.com/docs/advanced/actions', chain: 'solana', label: 'Blinks', packages: ['@solana/actions'], imports: [importOf('@solana/actions')] },
  { key: 'wagmi', docs: 'https://wagmi.sh', chain: null, label: 'wagmi', packages: ['wagmi'], imports: [importOf('wagmi')] },
  { key: 'viem', docs: 'https://viem.sh', chain: null, label: 'viem', packages: ['viem'], imports: [importOf('viem')] },
  { key: 'ethers', docs: 'https://docs.ethers.org', chain: null, label: 'ethers', packages: ['ethers'], imports: [importOf('ethers')] },
  { key: 'hardhat', docs: 'https://hardhat.org/docs', chain: null, label: 'Hardhat', packages: ['hardhat'], imports: [importOf('hardhat')], paths: [/(^|\/)hardhat\.config\.[cm]?[jt]s$/] },
  { key: 'foundry', docs: 'https://getfoundry.sh', chain: null, label: 'Foundry', packages: [], imports: [/import\s+[^;]*["']forge-std\//], paths: [/(^|\/)foundry\.toml$/] },
];

/** The label of an integration key, or null when unknown. Pure. */
export const integrationLabel = (key: string): string | null => INTEGRATIONS.find((i) => i.key === key)?.label ?? null;
/** The docs link of an integration key, or null when unknown. Pure. */
export const integrationDocs = (key: string): string | null => INTEGRATIONS.find((i) => i.key === key)?.docs ?? null;
/** Whether the key is in the registry. Pure. */
export const isIntegrationKey = (key: string): boolean => INTEGRATIONS.some((i) => i.key === key);

/** Source files whose text is read for imports and config; JSON, Markdown and data never count. */
const SOURCE = /\.(?:[cm]?[jt]sx?|sol|rs|py|toml|vue|svelte)$/i;

/** The package.json dependency names (all kinds), or none when it does not parse. */
function dependencies(text: string): Set<string> {
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    const names = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((k) =>
      p[k] && typeof p[k] === 'object' ? Object.keys(p[k] as object) : [],
    );
    return new Set(names);
  } catch {
    return new Set();
  }
}

/** The integration keys the picked files and the tree's paths show, in registry order. Pure. */
export function detectIntegrations(files: { path: string; text: string }[], paths: string[]): string[] {
  const deps = new Set(files.filter((f) => /(^|\/)package\.json$/.test(f.path)).flatMap((f) => [...dependencies(f.text)]));
  const sources = files.filter((f) => SOURCE.test(f.path));
  const tree = [...new Set([...paths, ...files.map((f) => f.path)])].filter((p) => !/(^|\/)(node_modules|vendor|lib\/forge-std)\//.test(p));
  return INTEGRATIONS.filter(
    (i) =>
      i.packages.some((p) => deps.has(p)) ||
      sources.some((f) => i.imports.some((re) => re.test(f.text)) || (i.text?.(f.text) ?? false)) ||
      (i.paths ?? []).some((re) => tree.some((p) => re.test(p))),
  ).map((i) => i.key);
}
