import { encodeFunctionData, erc20Abi, parseAbi, type Abi } from 'viem';
import { getBasePublicClient, type BasePublicClient } from './splitsWarehouse';
import {
  applySlippage,
  encodeExactInput,
  quoteBestPath,
  UNISWAP_V3_SWAP_ROUTER_02,
  WETH_BASE,
} from './uniswap';

export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;

const BURN_ABI = parseAbi(['function burn(uint256 amount)']) as Abi;

export interface TokenMeta {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export class TokenSafetyError extends Error {
  constructor(
    public reason:
      | 'no_code'
      | 'not_erc20'
      | 'no_liquidity'
      | 'honeypot'
      | 'cannot_receive_dead'
      | 'no_burn_function',
    message: string,
  ) {
    super(message);
    this.name = 'TokenSafetyError';
  }
}

export async function assertHasCode(
  address: `0x${string}`,
  client?: BasePublicClient,
): Promise<void> {
  const publicClient = client ?? getBasePublicClient();
  const code = await publicClient.getBytecode({ address });
  if (!code || code === '0x') {
    throw new TokenSafetyError(
      'no_code',
      `Address ${address} has no contract code on Base`,
    );
  }
}

export async function getTokenMeta(
  address: `0x${string}`,
  client?: BasePublicClient,
): Promise<TokenMeta> {
  const publicClient = client ?? getBasePublicClient();
  try {
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({
        address,
        abi: erc20Abi,
        functionName: 'symbol',
      }) as Promise<string>,
      publicClient.readContract({
        address,
        abi: erc20Abi,
        functionName: 'decimals',
      }) as Promise<number>,
    ]);
    return { address, symbol, decimals: Number(decimals) };
  } catch (err: any) {
    throw new TokenSafetyError(
      'not_erc20',
      `Address ${address} does not implement standard ERC-20 (symbol/decimals): ${err?.message ?? err}`,
    );
  }
}

// Detects whether the token can be sold back into liquidity. Honeypots typically
// allow buys but make sells revert via transfer hooks. We simulate a buy that
// settles into the SwapRouter (so it has a balance) and then a sell back to ETH.
export async function assertNotHoneypot(
  token: `0x${string}`,
  client?: BasePublicClient,
): Promise<void> {
  const publicClient = client ?? getBasePublicClient();

  // Buy ~$1 worth at most by quoting from 0.001 WETH. Cheap, avoids needing real funds.
  const probeAmount = BigInt(1_000_000_000_000_000); // 0.001 WETH

  const buyQuote = await quoteBestPath({
    tokenIn: WETH_BASE,
    tokenOut: token,
    amountIn: probeAmount,
    client: publicClient,
  });
  if (!buyQuote || buyQuote.amountOut === BigInt(0)) {
    throw new TokenSafetyError(
      'no_liquidity',
      `No Uniswap V3 buy route found for ${token} on Base`,
    );
  }

  const sellQuote = await quoteBestPath({
    tokenIn: token,
    tokenOut: WETH_BASE,
    amountIn: buyQuote.amountOut,
    client: publicClient,
  });
  if (!sellQuote || sellQuote.amountOut === BigInt(0)) {
    throw new TokenSafetyError(
      'honeypot',
      `Token ${token} can be bought but the reverse swap returns 0 — likely a honeypot`,
    );
  }

  // Also actually simulate the sell tx eth_call from a clean account to catch
  // honeypots that revert sells via transfer hooks (rather than just returning 0).
  const minOut = applySlippage(sellQuote.amountOut, 5000); // 50% — generous, just checking it doesn't revert
  const swapData = encodeExactInput({
    path: sellQuote.path,
    recipient: DEAD_ADDRESS,
    amountIn: buyQuote.amountOut,
    amountOutMinimum: minOut,
  });
  try {
    await publicClient.call({
      to: UNISWAP_V3_SWAP_ROUTER_02,
      data: swapData,
      // Anonymous probe account; eth_call doesn't actually move funds.
      account: DEAD_ADDRESS,
    });
  } catch (err: any) {
    throw new TokenSafetyError(
      'honeypot',
      `Sell-side eth_call reverted for ${token} — likely a honeypot: ${err?.shortMessage ?? err?.message ?? err}`,
    );
  }
}

// Check whether the token's transfer reverts when sending to the dead address.
// Some tokens block transfers to known burn addresses (anti-bot, blacklists).
export async function canReceiveDead(
  token: `0x${string}`,
  client?: BasePublicClient,
): Promise<boolean> {
  const publicClient = client ?? getBasePublicClient();
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [DEAD_ADDRESS, BigInt(1)],
  });
  try {
    // Probe from a contract address that's likely to hold tokens (Uniswap router).
    // Even if it has no balance, ERC-20 transfers usually revert with "insufficient balance"
    // — that's still "transfer logic ran without blacklist check failing first."
    // Tokens with transfer-to-dead blocks revert with a different reason BEFORE balance checks.
    await publicClient.call({
      to: token,
      data,
      account: UNISWAP_V3_SWAP_ROUTER_02,
    });
    return true;
  } catch (err: any) {
    const msg = String(err?.shortMessage ?? err?.message ?? err).toLowerCase();
    // Insufficient balance / amount errors are fine — they prove transfer logic runs.
    if (
      msg.includes('insufficient') ||
      msg.includes('balance') ||
      msg.includes('exceeds')
    ) {
      return true;
    }
    return false;
  }
}

export async function detectBurnFunction(
  token: `0x${string}`,
  client?: BasePublicClient,
): Promise<boolean> {
  const publicClient = client ?? getBasePublicClient();
  const data = encodeFunctionData({
    abi: BURN_ABI,
    functionName: 'burn',
    args: [BigInt(0)],
  });
  try {
    await publicClient.call({
      to: token,
      data,
      account: UNISWAP_V3_SWAP_ROUTER_02,
    });
    return true;
  } catch (err: any) {
    const msg = String(err?.shortMessage ?? err?.message ?? err).toLowerCase();
    // If it reverts with "function not found" / "no method" / similar, no burn fn.
    // If it reverts with permission/allowance errors, the function EXISTS.
    if (
      msg.includes('function') ||
      msg.includes('selector') ||
      msg.includes('does not exist') ||
      msg.includes('not implemented')
    ) {
      return false;
    }
    // Other reverts (insufficient balance, paused, etc.) imply the function exists.
    return true;
  }
}
