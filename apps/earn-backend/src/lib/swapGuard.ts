import { erc20Abi, formatUnits } from 'viem';
import { priceService } from '../services/priceService';
import { WETH_BASE } from './uniswap';
import type { BasePublicClient } from './splitsWarehouse';

/**
 * Market-price swap guard (fail-closed) — shared by both buyback workers.
 *
 * On-chain slippage (amountOutMinimum) is measured against the SAME pool the
 * swap executes in, so it cannot catch a wrong / thin / mispriced pool (e.g. a
 * Clanker token routed through the wrong Uniswap v4 pool key). This checks the
 * swap's expected output against an INDEPENDENT market price feed and aborts if
 * the value going out is far below the value going in.
 *
 * Fails CLOSED: if an independent market price for either side is unavailable,
 * it throws and the swap is skipped (and retried later) rather than executed
 * blind. The deviation ceiling is policy config (env) — never a price literal.
 */
export function maxMarketDeviationBps(): number {
  const raw = parseInt(process.env.BUYBACK_MAX_MARKET_DEVIATION_BPS ?? '', 10);
  // Default 15%. Clamp to an open interval so a bad env can't disable the guard.
  return Number.isFinite(raw) && raw > 0 && raw < 10_000 ? raw : 1500;
}

/**
 * Hard ceiling on per-swap slippage tolerance (amountOutMinimum vs quote). No
 * stored config value may exceed it — we cannot bear more than this on any swap.
 * Default 150 bps (1.5%), overridable via env. A missing/invalid config value
 * falls back to the ceiling rather than to something looser.
 */
export function clampSlippageBps(configuredBps: number): number {
  const raw = parseInt(process.env.BUYBACK_MAX_SLIPPAGE_BPS ?? '', 10);
  const ceiling = Number.isFinite(raw) && raw > 0 && raw <= 10_000 ? raw : 150;
  if (!Number.isFinite(configuredBps) || configuredBps <= 0) return ceiling;
  return Math.min(configuredBps, ceiling);
}

/**
 * Max age (ms) of the market price the guard will accept. A cached price is fine
 * up to this bound; beyond it the guard forces a live refetch and, if that fails,
 * fails CLOSED (never validates a swap against a stale price). Default 30s.
 */
function guardPriceMaxAgeMs(): number {
  const raw = parseInt(process.env.BUYBACK_PRICE_MAX_AGE_MS ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

export async function assertSwapValueVsMarket(args: {
  client: BasePublicClient;
  inputToken: `0x${string}`;
  amountIn: bigint;
  outputToken: `0x${string}`;
  expectedOut: bigint;
}): Promise<void> {
  const maxAgeMs = guardPriceMaxAgeMs();
  // WETH is priced off the ETH feed (it isn't in SUPPORTED_TOKENS); everything
  // else by contract address. Both require a FRESH price (<= maxAgeMs) and throw
  // otherwise → fail closed. A feed outage can never validate a bad swap.
  const priceOf = (token: `0x${string}`): Promise<number> =>
    token.toLowerCase() === WETH_BASE.toLowerCase()
      ? priceService.getEthPriceUsd(maxAgeMs)
      : priceService.getTokenPriceUsd(token, maxAgeMs);

  // Read decimals on-chain for both sides — never assume 18.
  const decimalsOf = async (token: `0x${string}`): Promise<number> =>
    Number(
      await args.client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    );

  const [inputPrice, outputPrice, inputDecimals, outputDecimals] = await Promise.all([
    priceOf(args.inputToken),
    priceOf(args.outputToken),
    decimalsOf(args.inputToken),
    decimalsOf(args.outputToken),
  ]);

  const inUsd = Number(formatUnits(args.amountIn, inputDecimals)) * inputPrice;
  const outUsd = Number(formatUnits(args.expectedOut, outputDecimals)) * outputPrice;

  if (!(inUsd > 0) || !(outUsd > 0)) {
    throw new Error(
      'swap_value_guard: market price unavailable for one side — aborting (fail-closed)',
    );
  }

  const bps = maxMarketDeviationBps();
  const minOutUsd = (inUsd * (10_000 - bps)) / 10_000;
  if (outUsd < minOutUsd) {
    throw new Error(
      `swap_value_guard: expected out ~$${outUsd.toFixed(4)} for in ~$${inUsd.toFixed(2)} ` +
        `(floor $${minOutUsd.toFixed(2)} at ${bps}bps) — refusing swap into a wrong/mispriced pool`,
    );
  }
}
