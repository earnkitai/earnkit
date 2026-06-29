import { getAddress, isAddress } from 'viem';
import { WETH_BASE } from './uniswap';
import { SUPPORTED_TOKENS } from '../services/tokenService';

// Dynamic token discovery for the buyback flow.
//
// Revenue lands in the split / buyback wallet as "anything and everything":
// WETH, USDC, and arbitrary ERC-20s we can't enumerate ahead of time. The
// workers therefore can't iterate a hardcoded allowlist — they ask this module
// what actually arrived, via Alchemy's token APIs on Base.
//
// Everything degrades gracefully: if no ALCHEMY_API_KEY is set or a call fails,
// we fall back to the SEED set (WETH + SUPPORTED_TOKENS) so the buyback never
// regresses below the previous static-list behaviour.

export interface DiscoveredToken {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY || '';
const ALCHEMY_BASE_RPC = ALCHEMY_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
  : '';

// Always-handled tokens. Seeding with these means discovery can only ever ADD
// to the known-good set, never drop below it — so an Alchemy outage degrades to
// exactly the old behaviour rather than skipping fees entirely.
const SEED_TOKENS: DiscoveredToken[] = [
  { address: WETH_BASE, symbol: 'WETH', decimals: 18 },
  ...SUPPORTED_TOKENS.map((t) => ({
    address: t.address as `0x${string}`,
    symbol: t.symbol,
    decimals: t.decimals,
  })),
];

function seedMap(): Map<string, DiscoveredToken> {
  const map = new Map<string, DiscoveredToken>();
  for (const t of SEED_TOKENS) map.set(t.address.toLowerCase(), t);
  return map;
}

const SEED_TOKEN_ADDRESSES = new Set(SEED_TOKENS.map((t) => t.address.toLowerCase()));

// Always-trusted tokens (WETH + the product's SUPPORTED_TOKENS) skip the
// liquidity/spam guard the workers apply to arbitrary discovered tokens.
export function isSeedToken(address: string): boolean {
  return SEED_TOKEN_ADDRESSES.has(address.toLowerCase());
}

async function alchemyRpc(method: string, params: unknown[]): Promise<any> {
  if (!ALCHEMY_BASE_RPC) throw new Error('no_alchemy_key');
  const res = await fetch(ALCHEMY_BASE_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
  });
  if (!res.ok) throw new Error(`alchemy ${method}: ${res.status} ${res.statusText}`);
  const json: any = await res.json();
  if (json.error) throw new Error(`alchemy ${method}: ${json.error?.message ?? 'rpc error'}`);
  return json.result;
}

// Best-effort metadata; decimals only affect USD logging (transfers/swaps use
// raw bigints), so a wrong default here is cosmetic, never fund-losing.
async function fetchMetadata(address: string): Promise<{ symbol: string; decimals: number }> {
  try {
    const meta = await alchemyRpc('alchemy_getTokenMetadata', [address]);
    return {
      symbol: typeof meta?.symbol === 'string' && meta.symbol ? meta.symbol : 'UNKNOWN',
      decimals: Number.isFinite(meta?.decimals) ? Number(meta.decimals) : 18,
    };
  } catch {
    return { symbol: 'UNKNOWN', decimals: 18 };
  }
}

/**
 * Every ERC-20 the wallet currently holds a non-zero balance of, unioned with
 * the seed set. Used by the fee / swap / sweep steps after withdrawal — those
 * operate on what's actually sitting in the wallet.
 */
export async function discoverWalletErc20s(
  wallet: `0x${string}`,
): Promise<DiscoveredToken[]> {
  const map = seedMap();
  if (!ALCHEMY_BASE_RPC) return [...map.values()];

  try {
    const result = await alchemyRpc('alchemy_getTokenBalances', [wallet, 'erc20']);
    const balances: Array<{ contractAddress: string; tokenBalance: string }> =
      result?.tokenBalances ?? [];

    // Resolve metadata for newly-seen tokens in parallel.
    const fresh = balances.filter((b) => {
      if (!b.contractAddress || !isAddress(b.contractAddress)) return false;
      let nonZero = false;
      try {
        nonZero = b.tokenBalance != null && BigInt(b.tokenBalance) > BigInt(0);
      } catch {
        nonZero = false;
      }
      return nonZero && !map.has(b.contractAddress.toLowerCase());
    });

    const metas = await Promise.all(fresh.map((b) => fetchMetadata(b.contractAddress)));
    fresh.forEach((b, i) => {
      map.set(b.contractAddress.toLowerCase(), {
        address: getAddress(b.contractAddress) as `0x${string}`,
        symbol: metas[i].symbol,
        decimals: metas[i].decimals,
      });
    });
  } catch (err) {
    console.warn('[tokenDiscovery] wallet discovery failed — using seed set:', err);
  }

  return [...map.values()];
}

/**
 * Candidate tokens that may be credited to `owner` inside the Splits Warehouse.
 * Discovers what the split contract has *received* (so the buyback can withdraw
 * every revenue token, not just a hardcoded few), unioned with the seed set.
 * Callers must still filter by a live `readWarehouseBalance > 0` before
 * withdrawing — this only narrows the universe of tokens to check.
 */
export async function discoverWarehouseTokens(
  splitAddress: `0x${string}` | null,
): Promise<DiscoveredToken[]> {
  const map = seedMap();
  if (!ALCHEMY_BASE_RPC || !splitAddress) return [...map.values()];

  try {
    const result = await alchemyRpc('alchemy_getAssetTransfers', [
      {
        toAddress: splitAddress,
        category: ['erc20'],
        withMetadata: false,
        excludeZeroValue: true,
        maxCount: '0x3e8', // 1000 most-relevant transfers
        order: 'desc',
      },
    ]);
    const transfers: Array<{ rawContract?: { address?: string }; asset?: string }> =
      result?.transfers ?? [];

    for (const tr of transfers) {
      const addr = tr.rawContract?.address;
      if (!addr || !isAddress(addr)) continue;
      const key = addr.toLowerCase();
      if (map.has(key)) continue;
      // Defer decimals to wallet-side discovery (run after withdrawal); the
      // warehouse withdraw itself is decimals-agnostic (raw bigint amounts).
      map.set(key, {
        address: getAddress(addr) as `0x${string}`,
        symbol: typeof tr.asset === 'string' && tr.asset ? tr.asset : 'UNKNOWN',
        decimals: 18,
      });
    }
  } catch (err) {
    console.warn('[tokenDiscovery] warehouse discovery failed — using seed set:', err);
  }

  return [...map.values()];
}
