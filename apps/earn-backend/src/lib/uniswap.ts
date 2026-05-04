import { encodeFunctionData, encodePacked, type Abi } from 'viem';
import { getBasePublicClient, type BasePublicClient } from './splitsWarehouse';

// Uniswap V3 on Base — canonical addresses.
export const UNISWAP_V3_SWAP_ROUTER_02 =
  '0x2626664c2603336E57B271c5C0b26F421741e481' as const;
export const UNISWAP_V3_QUOTER_V2 =
  '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a' as const;

// WETH on Base — used for ETH<>token routing.
export const WETH_BASE = '0x4200000000000000000000000000000000000006' as const;

// Standard V3 fee tiers (in hundredths of a bip). 500 = 0.05%, 3000 = 0.3%, 10000 = 1%.
const FEE_TIERS = [500, 3000, 10000] as const;

const SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'exactInput',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'exactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
] as const satisfies Abi;

const QUOTER_V2_ABI = [
  {
    type: 'function',
    name: 'quoteExactInput',
    inputs: [
      { name: 'path', type: 'bytes' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96AfterList', type: 'uint160[]' },
      { name: 'initializedTicksCrossedList', type: 'uint32[]' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
] as const satisfies Abi;

// Build a multi-hop V3 path: tokenA -> fee -> tokenB [-> fee -> tokenC ...]
function encodePath(
  tokens: readonly `0x${string}`[],
  fees: readonly number[],
): `0x${string}` {
  if (tokens.length !== fees.length + 1) {
    throw new Error('encodePath: tokens.length must equal fees.length + 1');
  }
  let parts: any[] = [tokens[0]];
  let types: string[] = ['address'];
  for (let i = 0; i < fees.length; i++) {
    parts.push(fees[i], tokens[i + 1]);
    types.push('uint24', 'address');
  }
  return encodePacked(types, parts);
}

export interface QuoteResult {
  amountOut: bigint;
  path: `0x${string}`;
  pathDescription: string;
  feesUsed: readonly number[];
  tokensUsed: readonly `0x${string}`[];
}

// Try every (direct, single-hop, two-hop via WETH) route at every standard fee tier
// and return the best non-zero quote. Returns null if no route has liquidity.
export async function quoteBestPath({
  tokenIn,
  tokenOut,
  amountIn,
  client,
}: {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  client?: BasePublicClient;
}): Promise<QuoteResult | null> {
  if (amountIn <= BigInt(0)) return null;
  const publicClient = client ?? getBasePublicClient();

  const candidates: { tokens: `0x${string}`[]; fees: number[] }[] = [];

  // Direct paths (tokenIn -> tokenOut)
  for (const fee of FEE_TIERS) {
    candidates.push({ tokens: [tokenIn, tokenOut], fees: [fee] });
  }

  // Two-hop via WETH (tokenIn -> WETH -> tokenOut). Only if neither side is WETH.
  if (
    tokenIn.toLowerCase() !== WETH_BASE.toLowerCase() &&
    tokenOut.toLowerCase() !== WETH_BASE.toLowerCase()
  ) {
    for (const f1 of FEE_TIERS) {
      for (const f2 of FEE_TIERS) {
        candidates.push({
          tokens: [tokenIn, WETH_BASE, tokenOut],
          fees: [f1, f2],
        });
      }
    }
  }

  let best: QuoteResult | null = null;

  for (const candidate of candidates) {
    const path = encodePath(candidate.tokens, candidate.fees);
    try {
      const result = (await publicClient.simulateContract({
        address: UNISWAP_V3_QUOTER_V2,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInput',
        args: [path, amountIn],
      })) as { result: readonly [bigint, readonly bigint[], readonly number[], bigint] };
      const amountOut = result.result[0];
      if (amountOut > BigInt(0) && (!best || amountOut > best.amountOut)) {
        best = {
          amountOut,
          path,
          pathDescription: candidate.tokens.join(' -> '),
          feesUsed: candidate.fees,
          tokensUsed: candidate.tokens,
        };
      }
    } catch {
      // No liquidity at this fee tier / path — try the next candidate.
      continue;
    }
  }

  return best;
}

export function encodeExactInput({
  path,
  recipient,
  amountIn,
  amountOutMinimum,
}: {
  path: `0x${string}`;
  recipient: `0x${string}`;
  amountIn: bigint;
  amountOutMinimum: bigint;
}): `0x${string}` {
  return encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: 'exactInput',
    args: [{ path, recipient, amountIn, amountOutMinimum }],
  });
}

// Apply slippage to a quoted amountOut. slippageBps is in basis points (500 = 5%).
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const denom = BigInt(10_000);
  const numer = denom - BigInt(slippageBps);
  return (amountOut * numer) / denom;
}
